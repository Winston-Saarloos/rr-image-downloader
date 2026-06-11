import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  describeLibraryMoveDestinationError,
  LibraryMoveCancelledError,
  removeAbsolutePathsFromMovedLibraryMetadata,
  runLibraryMove,
  verifyLibraryMoveSnapshot,
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
      onProgress: jest.fn(),
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

  it('rejects destination content that differs even when size matches', async () => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    await fs.ensureDir(src);
    await fs.ensureDir(dest);
    await fs.writeFile(path.join(src, 'same-size.txt'), 'abc123');

    await expect(
      runLibraryMove({
        srcRoot: src,
        destRoot: dest,
        signal: new AbortController().signal,
        onProgress: p => {
          if (p.phase === 'copy' && p.filesDone === 1) {
            fs.writeFileSync(path.join(dest, 'same-size.txt'), 'zzz999');
          }
        },
      })
    ).rejects.toThrow(/content mismatch/i);
  });

  it('final snapshot verification rejects a source file added after copy', async () => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    await fs.ensureDir(src);
    await fs.ensureDir(dest);
    await fs.writeFile(path.join(src, 'photo.jpg'), 'original');

    const result = await runLibraryMove({
      srcRoot: src,
      destRoot: dest,
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    });

    await fs.writeFile(path.join(src, 'new-photo.jpg'), 'late');

    await expect(
      verifyLibraryMoveSnapshot({
        srcRoot: src,
        destRoot: dest,
        files: result.verifiedFiles,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/source library changed/i);
  });

  it('describeLibraryMoveDestinationError reports a non-empty destination', async () => {
    const dest = path.join(base, 'dest');
    await fs.ensureDir(dest);
    await fs.writeFile(path.join(dest, 'keep.txt'), 'x');

    await expect(describeLibraryMoveDestinationError(dest)).resolves.toMatch(
      /empty/i
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
        onProgress: jest.fn(),
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

  it('removes absolutePath keys from moved metadata while preserving relative paths', async () => {
    const dest = path.join(base, 'dest');
    const manifestPath = path.join(dest, 'metadata', 'accounts-metadata.json');
    const nonMetadataJsonPath = path.join(dest, 'not-metadata.json');
    await fs.ensureDir(path.dirname(manifestPath));
    await fs.writeJson(
      manifestPath,
      {
        schemaVersion: 1,
        kind: 'account-metadata',
        accounts: {
          '1': {
            profile: {
              imageName: 'profile.png',
              relativePath: 'accounts/1/profile.png',
              absolutePath: 'C:\\old\\metadata\\accounts\\1\\profile.png',
            },
            banner: {
              imageName: 'banner.png',
              relativePath: 'accounts/1/banner.png',
              absolutePath: 'C:\\old\\metadata\\accounts\\1\\banner.png',
            },
          },
        },
      },
      { spaces: 2 }
    );
    await fs.writeJson(nonMetadataJsonPath, {
      absolutePath: 'C:\\old\\leave-alone.png',
    });

    const result = await removeAbsolutePathsFromMovedLibraryMetadata(
      dest,
      new AbortController().signal
    );

    const manifest = await fs.readJson(manifestPath);
    expect(result.absolutePathsRemoved).toBe(2);
    expect(manifest.accounts['1'].profile.relativePath).toBe(
      'accounts/1/profile.png'
    );
    expect(manifest.accounts['1'].profile.absolutePath).toBeUndefined();
    expect(manifest.accounts['1'].banner.absolutePath).toBeUndefined();
    expect((await fs.readJson(nonMetadataJsonPath)).absolutePath).toBe(
      'C:\\old\\leave-alone.png'
    );
  });
});
