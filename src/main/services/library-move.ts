import * as fs from 'fs-extra';
import * as path from 'path';
import type { LibraryMoveProgress } from '../../shared/types';

function logLibraryMoveLine(line: string): void {
  console.log(`[LibraryMove] ${line}`);
}

export class LibraryMoveCancelledError extends Error {
  readonly name = 'LibraryMoveCancelledError';
  constructor(message = 'Library move cancelled') {
    super(message);
  }
}

export type LibraryMoveProgressFn = (p: LibraryMoveProgress) => void;

type FilePlan = {
  relativePath: string;
  srcAbs: string;
  destAbs: string;
  size: number;
};

export function pathsEffectivelyEqual(a: string, b: string): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (process.platform === 'win32') {
    return ra.toLowerCase() === rb.toLowerCase();
  }
  return ra === rb;
}

function destAbsFor(destRoot: string, relativePath: string): string {
  const parts = relativePath.split(/[/\\]/).filter(Boolean);
  return path.join(destRoot, ...parts);
}

async function assertNotAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new LibraryMoveCancelledError();
  }
}

async function walkSourceFiles(
  srcRoot: string,
  destRoot: string,
  signal: AbortSignal
): Promise<FilePlan[]> {
  const plans: FilePlan[] = [];

  async function walk(dir: string, relPrefix: string): Promise<void> {
    await assertNotAborted(signal);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs, rel);
      } else if (ent.isFile()) {
        const st = await fs.stat(abs);
        plans.push({
          relativePath: rel,
          srcAbs: abs,
          destAbs: destAbsFor(destRoot, rel),
          size: st.size,
        });
      }
    }
  }

  await walk(srcRoot, '');
  return plans;
}

async function ensureDestinationEmptyOrCreatable(
  destRoot: string,
  signal: AbortSignal
): Promise<void> {
  await assertNotAborted(signal);
  if (await fs.pathExists(destRoot)) {
    const stat = await fs.stat(destRoot);
    if (!stat.isDirectory()) {
      throw new Error('Destination exists but is not a directory.');
    }
    const children = await fs.readdir(destRoot);
    if (children.length > 0) {
      throw new Error(
        'Destination folder must be empty. Choose an empty folder or create a new one.'
      );
    }
  } else {
    await fs.ensureDir(destRoot);
  }
}

export interface RunLibraryMoveParams {
  srcRoot: string;
  destRoot: string;
  signal: AbortSignal;
  onProgress: LibraryMoveProgressFn;
}

export interface RunLibraryMoveOutcome {
  previousRoot: string;
  newRoot: string;
  filesCopied: number;
  bytesCopied: number;
  /** Top-level names under destRoot created during this run (for partial cleanup on cancel). */
  topLevelDestNames: string[];
  operationLog: string[];
}

/**
 * Copy library from `srcRoot` to empty `destRoot`, verify sizes, then caller updates settings and removes `srcRoot`.
 * Does not delete source or change settings — orchestrator does that after success.
 */
export async function runLibraryMove(
  params: RunLibraryMoveParams
): Promise<RunLibraryMoveOutcome> {
  const srcRoot = path.resolve(params.srcRoot.trim());
  const destRoot = path.resolve(params.destRoot.trim());
  const { signal, onProgress } = params;

  if (!srcRoot || !destRoot) {
    throw new Error('Source and destination paths are required.');
  }
  if (pathsEffectivelyEqual(srcRoot, destRoot)) {
    throw new Error('Source and destination are the same folder.');
  }
  if (!path.isAbsolute(srcRoot) || !path.isAbsolute(destRoot)) {
    throw new Error('Source and destination must be absolute paths.');
  }

  const operationLog: string[] = [];
  const pushLog = (line: string) => {
    operationLog.push(line);
    logLibraryMoveLine(line);
  };

  const emit = (partial: Partial<LibraryMoveProgress> & Pick<LibraryMoveProgress, 'phase'>) => {
    onProgress({
      phase: partial.phase,
      bytesDone: partial.bytesDone ?? 0,
      bytesTotal: partial.bytesTotal ?? 0,
      filesDone: partial.filesDone ?? 0,
      filesTotal: partial.filesTotal ?? 0,
      currentLabel: partial.currentLabel ?? '',
      done: partial.done ?? false,
      error: partial.error,
      sourceDeleteWarning: partial.sourceDeleteWarning,
      operationLog: [...operationLog],
    });
  };

  await assertNotAborted(signal);

  if (!(await fs.pathExists(srcRoot))) {
    throw new Error('Source library folder does not exist.');
  }
  const srcStat = await fs.stat(srcRoot);
  if (!srcStat.isDirectory()) {
    throw new Error('Source path is not a directory.');
  }

  pushLog(`Move started (copy + verify): "${srcRoot}" → "${destRoot}"`);

  emit({
    phase: 'validating',
    currentLabel: 'Validating paths…',
    bytesDone: 0,
    bytesTotal: 0,
    filesDone: 0,
    filesTotal: 0,
  });

  await ensureDestinationEmptyOrCreatable(destRoot, signal);
  pushLog('Validation OK: destination exists or was created and is empty.');

  emit({
    phase: 'preflight',
    currentLabel: 'Scanning library…',
    bytesDone: 0,
    bytesTotal: 0,
    filesDone: 0,
    filesTotal: 0,
  });

  const plans = await walkSourceFiles(srcRoot, destRoot, signal);
  const bytesTotal = plans.reduce((s, p) => s + p.size, 0);
  const filesTotal = plans.length;

  const preflightLabel =
    filesTotal === 0
      ? 'No files found under library root (empty library is OK).'
      : `Found ${filesTotal} file(s), ${formatBytes(bytesTotal)}.`;
  pushLog(
    filesTotal === 0
      ? 'Preflight: library root has no files (empty library).'
      : `Preflight: found ${filesTotal} file(s), ${formatBytes(bytesTotal)} total.`
  );

  emit({
    phase: 'preflight',
    currentLabel: preflightLabel,
    bytesDone: 0,
    bytesTotal,
    filesDone: 0,
    filesTotal,
  });

  const topLevelDestNames = new Set<string>();
  for (const p of plans) {
    const top = p.relativePath.split(/[/\\]/)[0];
    if (top) {
      topLevelDestNames.add(top);
    }
  }

  let bytesDone = 0;
  let filesDone = 0;

  pushLog(
    filesTotal === 0
      ? 'Copy: nothing to copy.'
      : `Copy: starting ${filesTotal} file(s), ${formatBytes(bytesTotal)}.`
  );

  emit({
    phase: 'copy',
    currentLabel: 'Copying files…',
    bytesDone: 0,
    bytesTotal,
    filesDone: 0,
    filesTotal,
  });

  for (const plan of plans) {
    await assertNotAborted(signal);
    await fs.ensureDir(path.dirname(plan.destAbs));
    await fs.copyFile(plan.srcAbs, plan.destAbs);
    bytesDone += plan.size;
    filesDone += 1;
    emit({
      phase: 'copy',
      currentLabel: plan.relativePath,
      bytesDone,
      bytesTotal,
      filesDone,
      filesTotal,
    });
  }

  pushLog(
    filesTotal === 0
      ? 'Copy: finished (no files).'
      : `Copy: finished ${filesTotal} file(s), ${formatBytes(bytesTotal)} written.`
  );

  emit({
    phase: 'verify',
    currentLabel: 'Verifying copy…',
    bytesDone,
    bytesTotal,
    filesDone,
    filesTotal,
  });

  let verifiedBytes = 0;
  let verifiedFiles = 0;
  for (const plan of plans) {
    await assertNotAborted(signal);
    if (!(await fs.pathExists(plan.destAbs))) {
      throw new Error(`Verification failed: missing destination file ${plan.relativePath}`);
    }
    const st = await fs.stat(plan.destAbs);
    if (!st.isFile()) {
      throw new Error(`Verification failed: not a file at ${plan.relativePath}`);
    }
    if (st.size !== plan.size) {
      throw new Error(
        `Verification failed: size mismatch for ${plan.relativePath} (expected ${plan.size}, got ${st.size}).`
      );
    }
    verifiedBytes += st.size;
    verifiedFiles += 1;
    emit({
      phase: 'verify',
      currentLabel: plan.relativePath,
      bytesDone: verifiedBytes,
      bytesTotal,
      filesDone: verifiedFiles,
      filesTotal,
    });
  }

  pushLog(
    filesTotal === 0
      ? 'Verify: skipped (no files).'
      : `Verify: passed for all ${filesTotal} file(s) (sizes match source).`
  );

  pushLog('Copy and verify stage complete; application will update settings next.');

  emit({
    phase: 'verified',
    currentLabel: 'Copy and verification finished. Updating settings next…',
    bytesDone: bytesTotal,
    bytesTotal,
    filesDone: filesTotal,
    filesTotal,
    done: false,
  });

  return {
    previousRoot: srcRoot,
    newRoot: destRoot,
    filesCopied: filesTotal,
    bytesCopied: bytesTotal,
    topLevelDestNames: [...topLevelDestNames],
    operationLog,
  };
}

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  if (n < 1024 * 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Best-effort removal of partial data after cancel (before settings commit).
 */
export async function removePartialLibraryCopy(
  destRoot: string,
  topLevelNames: string[]
): Promise<void> {
  for (const name of topLevelNames) {
    const target = path.join(destRoot, name);
    try {
      if (await fs.pathExists(target)) {
        await fs.remove(target);
      }
    } catch {
      // ignore per-item cleanup errors
    }
  }
}
