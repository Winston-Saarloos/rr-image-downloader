import * as fs from 'fs-extra';
import { createHash } from 'crypto';
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
  sha256?: string;
};

export type VerifiedLibraryMoveFile = {
  relativePath: string;
  size: number;
  sha256: string;
};

export type LibraryMoveMetadataCleanupResult = {
  filesScanned: number;
  filesUpdated: number;
  absolutePathsRemoved: number;
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

/** Returns an error message when the destination cannot be used, otherwise null. */
export async function describeLibraryMoveDestinationError(
  destRoot: string
): Promise<string | null> {
  const resolved = path.resolve(destRoot.trim());
  if (!resolved) {
    return 'Destination path is required.';
  }
  if (!path.isAbsolute(resolved)) {
    return 'Destination must be an absolute path.';
  }
  try {
    await ensureDestinationEmptyOrCreatable(
      resolved,
      new AbortController().signal
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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
  verifiedFiles: VerifiedLibraryMoveFile[];
  operationLog: string[];
}

/**
 * Copy library from `srcRoot` to empty `destRoot` and verify every file.
 * Does not delete anything or change settings — the orchestrator updates settings after success.
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
  const verifiedManifest: VerifiedLibraryMoveFile[] = [];
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
    const [srcHash, destHash] = await Promise.all([
      hashFile(plan.srcAbs, signal),
      hashFile(plan.destAbs, signal),
    ]);
    if (srcHash !== destHash) {
      throw new Error(
        `Verification failed: content mismatch for ${plan.relativePath}.`
      );
    }
    plan.sha256 = srcHash;
    verifiedManifest.push({
      relativePath: plan.relativePath,
      size: plan.size,
      sha256: srcHash,
    });
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
      : `Verify: passed for all ${filesTotal} file(s) (SHA-256 hashes match source).`
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
    verifiedFiles: verifiedManifest,
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

export interface VerifyLibraryMoveSnapshotParams {
  srcRoot: string;
  destRoot: string;
  files: VerifiedLibraryMoveFile[];
  signal: AbortSignal;
  onProgress?: LibraryMoveProgressFn;
  operationLog?: string[];
}

/**
 * Confirms the source tree is unchanged and the destination still matches the
 * verified copy manifest. Run immediately before deleting the old source root.
 */
export async function verifyLibraryMoveSnapshot(
  params: VerifyLibraryMoveSnapshotParams
): Promise<void> {
  const srcRoot = path.resolve(params.srcRoot.trim());
  const destRoot = path.resolve(params.destRoot.trim());
  const files = [...params.files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );
  const sourceNow = (await walkSourceFiles(srcRoot, destRoot, params.signal)).sort(
    (a, b) => a.relativePath.localeCompare(b.relativePath)
  );
  const bytesTotal = files.reduce((sum, file) => sum + file.size, 0);

  if (sourceNow.length !== files.length) {
    throw new Error(
      `Final safety check failed: source library changed during move (expected ${files.length} file(s), found ${sourceNow.length}).`
    );
  }

  const emit = (
    partial: Partial<LibraryMoveProgress> & Pick<LibraryMoveProgress, 'phase'>
  ) => {
    params.onProgress?.({
      phase: partial.phase,
      bytesDone: partial.bytesDone ?? 0,
      bytesTotal: partial.bytesTotal ?? bytesTotal,
      filesDone: partial.filesDone ?? 0,
      filesTotal: partial.filesTotal ?? files.length,
      currentLabel: partial.currentLabel ?? '',
      done: partial.done ?? false,
      error: partial.error,
      operationLog: [...(params.operationLog ?? [])],
    });
  };

  let bytesDone = 0;
  for (let i = 0; i < files.length; i += 1) {
    await assertNotAborted(params.signal);
    const expected = files[i];
    const current = sourceNow[i];
    if (current.relativePath !== expected.relativePath) {
      throw new Error(
        `Final safety check failed: source library changed during move near ${expected.relativePath}.`
      );
    }
    if (current.size !== expected.size) {
      throw new Error(
        `Final safety check failed: source file size changed for ${expected.relativePath}.`
      );
    }

    const destAbs = destAbsFor(destRoot, expected.relativePath);
    if (!(await fs.pathExists(destAbs))) {
      throw new Error(
        `Final safety check failed: missing destination file ${expected.relativePath}.`
      );
    }
    const destStat = await fs.stat(destAbs);
    if (!destStat.isFile() || destStat.size !== expected.size) {
      throw new Error(
        `Final safety check failed: destination file changed for ${expected.relativePath}.`
      );
    }

    const [srcHash, destHash] = await Promise.all([
      hashFile(current.srcAbs, params.signal),
      hashFile(destAbs, params.signal),
    ]);
    if (srcHash !== expected.sha256) {
      throw new Error(
        `Final safety check failed: source file content changed for ${expected.relativePath}.`
      );
    }
    if (destHash !== expected.sha256) {
      throw new Error(
        `Final safety check failed: destination file content changed for ${expected.relativePath}.`
      );
    }

    bytesDone += expected.size;
    emit({
      phase: 'verify',
      currentLabel: expected.relativePath,
      bytesDone,
      filesDone: i + 1,
    });
  }
}

export async function removeAbsolutePathsFromMovedLibraryMetadata(
  libraryRoot: string,
  signal: AbortSignal
): Promise<LibraryMoveMetadataCleanupResult> {
  const root = path.resolve(libraryRoot.trim());
  const result: LibraryMoveMetadataCleanupResult = {
    filesScanned: 0,
    filesUpdated: 0,
    absolutePathsRemoved: 0,
  };

  async function walk(dir: string, relPrefix: string): Promise<void> {
    await assertNotAborted(signal);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      await assertNotAborted(signal);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (
        !entry.isFile() ||
        path.extname(entry.name).toLowerCase() !== '.json' ||
        !isMetadataRelativePath(rel)
      ) {
        continue;
      }

      result.filesScanned += 1;
      const json = await fs.readJson(abs);
      const removed = removeAbsolutePathKeys(json);
      if (removed > 0) {
        await fs.writeJson(abs, json, { spaces: 2 });
        result.filesUpdated += 1;
        result.absolutePathsRemoved += removed;
      }
    }
  }

  if (await fs.pathExists(root)) {
    await walk(root, '');
  }

  return result;
}

function isMetadataRelativePath(relativePath: string): boolean {
  return relativePath
    .split(/[/\\]/)
    .some(part => part.toLowerCase() === 'metadata');
}

function removeAbsolutePathKeys(value: unknown): number {
  if (!value || typeof value !== 'object') {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + removeAbsolutePathKeys(item), 0);
  }

  let removed = 0;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === 'absolutePath') {
      delete record[key];
      removed += 1;
    } else {
      removed += removeAbsolutePathKeys(record[key]);
    }
  }
  return removed;
}

async function hashFile(filePath: string, signal: AbortSignal): Promise<string> {
  await assertNotAborted(signal);
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', chunk => {
      if (signal.aborted) {
        stream.destroy(new LibraryMoveCancelledError());
        return;
      }
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      try {
        resolve(hash.digest('hex'));
      } catch (error) {
        reject(error);
      }
    });
  });
}
