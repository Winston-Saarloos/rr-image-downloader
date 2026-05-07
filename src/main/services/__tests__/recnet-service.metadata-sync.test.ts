import * as fs from 'fs-extra';
import * as path from 'path';
import { RecNetService } from '../recnet-service';

jest.mock('fs-extra', () => {
  const actualFs = jest.requireActual('fs-extra');
  return {
    ...actualFs,
    pathExists: jest.fn(),
    readJson: jest.fn(),
    writeFile: jest.fn(),
    writeJson: jest.fn(),
    ensureDir: jest.fn(),
    readdir: jest.fn(),
  };
});

jest.mock('../recnet/http-client');
jest.mock('../recnet/photos-controller');
jest.mock('../recnet/accounts-controller');
jest.mock('../recnet/rooms-controller');
jest.mock('../recnet/events-controller');
jest.mock('../recnet/image-comments-controller');

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('RecNetService - metadata library sync', () => {
  let service: RecNetService;
  const outputRoot = path.join(__dirname, 'test-output', 'metadata-sync');

  beforeEach(async () => {
    jest.clearAllMocks();
    service = new RecNetService();
    await service.updateSettings({
      outputRoot,
      maxConcurrentDownloads: 1,
      interPageDelayMs: 0,
    });
    jest.spyOn<any, any>(service as any, 'delay').mockResolvedValue(undefined);
  });

  it('returns zero counts when output root is missing', async () => {
    mockedFs.pathExists.mockImplementation(async () => false);
    const result = await service.syncMetadataLibraryAssets({ force: false });
    expect(result).toEqual({
      accountsProcessed: 0,
      creatorsProcessed: 0,
      eventsProcessed: 0,
      roomsProcessed: 0,
    });
  });

  it('processes a user library folder with accounts json', async () => {
    const accountId = '12345';
    const accountDir = path.join(outputRoot, accountId);
    mockedFs.pathExists.mockImplementation(async (p: fs.PathLike) => {
      const s = String(p);
      if (s === outputRoot) {
        return true;
      }
      if (s === path.join(accountDir, `${accountId}_accounts.json`)) {
        return true;
      }
      if (s.includes(`${path.sep}metadata`)) {
        return true;
      }
      return false;
    });
    mockedFs.readdir.mockImplementation(async (p: fs.PathLike) => {
      const s = String(p);
      if (s === outputRoot) {
        return [{ name: accountId, isDirectory: () => true }] as any;
      }
      return [];
    });
    mockedFs.readJson.mockImplementation(async (p: fs.PathLike) => {
      const s = String(p);
      if (s.endsWith(`${accountId}_accounts.json`)) {
        return [
          {
            accountId,
            username: 'u',
            displayName: 'U',
            displayEmoji: '',
            profileImage: 'p.jpg',
            bannerImage: 'b.jpg',
            isJunior: false,
            platforms: 0,
            personalPronouns: 0,
            identityFlags: 0,
            createdAt: '',
            isMetaPlatformBlocked: false,
          },
        ];
      }
      return [];
    });

    jest.spyOn(service as any, 'downloadPhotoWithRetry').mockResolvedValue({
      response: { success: true, value: new Uint8Array([1, 2, 3]).buffer },
      attempts: 1,
    });

    const result = await service.syncMetadataLibraryAssets({ force: true });
    expect(result.accountsProcessed).toBe(1);
    expect(mockedFs.writeJson).toHaveBeenCalled();
  });
});
