import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  LibraryMoveCancelledError,
  removePartialLibraryCopy,
  runLibraryMove,
} from '../library-move';

describe('library-move', () => {
  let base: string;

  beforeEach(async () => {
    base = path.join(
      os.tmpdir(),
      `libmove-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    await fs.ensureDir(base);
  });

  afterEach(async () => {
    if (await fs.pathExists(base)) {
      await fs.remove(base);
    }
  });

  it('copies an empty library root and completes verification', async () => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    await fs.ensureDir(src);
    await fs.ensureDir(dest);

    const phases: string[] = [];
    const result = await runLibraryMove({
      srcRoot: src,
      destRoot: dest,
      signal: new AbortController().signal,
      onProgress: p => phases.push(p.phase),
    });

    expect(result.filesCopied).toBe(0);
    expect(result.bytesCopied).toBe(0);
    expect(phases).toContain('preflight');
    expect(phases).toContain('copy');
    expect(phases).toContain('verify');
    expect(phases).toContain('verified');
    expect(result.operationLog.length).toBeGreaterThan(0);
    expect(result.operationLog.some(l => l.includes('Preflight'))).toBe(true);
    expect(result.operationLog.some(l => l.includes('Verify'))).toBe(true);
  });

  it('copies nested files and preserves content at destination', async () => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    await fs.ensureDir(path.join(src, 'acc', 'photos'));
    await fs.writeFile(path.join(src, 'acc', 'photos', '1.jpg'), 'hello-data');
    await fs.ensureDir(dest);

    await runLibraryMove({
      srcRoot: src,
      destRoot: dest,
      signal: new AbortController().signal,
      onProgress: () => {},
    });

    const text = await fs.readFile(
      path.join(dest, 'acc', 'photos', '1.jpg'),
      'utf8'
    );
    expect(text).toBe('hello-data');
    expect(await fs.pathExists(path.join(src, 'acc', 'photos', '1.jpg'))).toBe(
      true
    );
  });

  it('rejects a non-empty destination', async () => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    await fs.ensureDir(src);
    await fs.ensureDir(dest);
    await fs.writeFile(path.join(dest, 'keep.txt'), 'x');

    await expect(
      runLibraryMove({
        srcRoot: src,
        destRoot: dest,
        signal: new AbortController().signal,
        onProgress: () => {},
      })
    ).rejects.toThrow(/empty/i);
  });

  it('throws LibraryMoveCancelledError when aborted during copy', async () => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    await fs.ensureDir(src);
    await fs.ensureDir(dest);

    for (let i = 0; i < 8; i++) {
      await fs.writeFile(path.join(src, `f${i}.txt`), 'x'.repeat(100));
    }

    const ac = new AbortController();
    let startedCopy = false;

    await expect(
      runLibraryMove({
        srcRoot: src,
        destRoot: dest,
        signal: ac.signal,
        onProgress: p => {
          if (p.phase === 'copy' && p.filesDone >= 2) {
            startedCopy = true;
            ac.abort();
          }
        },
      })
    ).rejects.toThrow(LibraryMoveCancelledError);

    expect(startedCopy).toBe(true);
  });

  it('removePartialLibraryCopy removes listed top-level entries', async () => {
    const dest = path.join(base, 'dest');
    await fs.ensureDir(path.join(dest, 'a'));
    await fs.ensureDir(path.join(dest, 'b'));
    await removePartialLibraryCopy(dest, ['a']);
    expect(await fs.pathExists(path.join(dest, 'a'))).toBe(false);
    expect(await fs.pathExists(path.join(dest, 'b'))).toBe(true);
  });
});
