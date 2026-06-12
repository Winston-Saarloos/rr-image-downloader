import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { RecNetService } from '../recnet-service';

jest.mock('../recnet/http-client');
jest.mock('../recnet/photos-controller');
jest.mock('../recnet/accounts-controller');
jest.mock('../recnet/rooms-controller');
jest.mock('../recnet/events-controller');
jest.mock('../recnet/image-comments-controller');

describe('RecNetService library move', () => {
  let base: string;

  beforeEach(async () => {
    base = path.join(
      os.tmpdir(),
      `recnet-libmove-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    await fs.ensureDir(base);
  });

  afterEach(async () => {
    if (await fs.pathExists(base)) {
      await fs.remove(base);
    }
  });

  it('rejects a non-empty destination without deleting its files', async () => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    await fs.ensureDir(src);
    await fs.writeFile(path.join(src, 'photo.jpg'), 'library');
    await fs.ensureDir(dest);
    await fs.writeFile(path.join(dest, 'user-file.txt'), 'keep me');

    const service = new RecNetService();
    await service.updateSettings({ outputRoot: src });

    const result = await service.moveLibraryTo(dest, jest.fn());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty/i);
    expect(await fs.readFile(path.join(dest, 'user-file.txt'), 'utf8')).toBe(
      'keep me'
    );
    expect(service.isLibraryMoveInProgress()).toBe(false);
  });
});
