import * as fs from 'fs-extra';
import * as path from 'path';
import { RecNetService } from '../recnet-service';
import { PlayerResult } from '../../models/PlayerDto';

jest.mock('fs-extra', () => {
  const actualFs = jest.requireActual('fs-extra');
  return {
    ...actualFs,
    pathExists: jest.fn(),
    readJson: jest.fn(),
    writeJson: jest.fn(),
    ensureDir: jest.fn(),
    remove: jest.fn(),
    readdir: jest.fn(),
  };
});

jest.mock('../recnet/http-client');
jest.mock('../recnet/photos-controller');
jest.mock('../recnet/accounts-controller');
jest.mock('../recnet/rooms-controller');
jest.mock('../recnet/events-controller');

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('RecNetService - listAvailableAccounts (folder meta)', () => {
  let service: RecNetService;
  let testOutputDir: string;

  beforeEach(() => {
    testOutputDir = path.join(__dirname, 'test-output', `test-${Date.now()}`);
    jest.clearAllMocks();

    service = new RecNetService();
    service.updateSettings({ outputRoot: testOutputDir });
  });

  const makeDirent = (name: string) =>
    ({
      name,
      isDirectory: () => true,
    }) as any;

  it('prefers folder-meta.json owner.displayLabel (no accounts backfill read)', async () => {
    const accountId = '256147';
    const accountDir = path.join(testOutputDir, accountId);
    const photosJsonPath = path.join(accountDir, `${accountId}_photos.json`);
    const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);
    const accountsJsonPath = path.join(accountDir, `${accountId}_accounts.json`);
    const metaPath = path.join(accountDir, 'folder-meta.json');

    (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
      if (p === testOutputDir) return true;
      if (p === photosJsonPath) return true;
      if (p === feedJsonPath) return false;
      if (p === metaPath) return true;
      if (p === accountsJsonPath) return true; // even if it exists, shouldn't be read
      return false;
    });

    (mockedFs.readdir as jest.Mock).mockResolvedValue([makeDirent(accountId)]);

    (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
      if (p === photosJsonPath) return [{ Id: '1' }];
      if (p === metaPath) {
        return {
          schemaVersion: 1,
          accountId,
          updatedAt: new Date().toISOString(),
          owner: {
            accountId,
            username: 'alice',
            displayName: 'Alice',
            displayLabel: 'Alice (@alice)',
          },
        };
      }
      throw new Error(`Unexpected readJson(${p})`);
    });

    const result = await service.listAvailableAccounts();
    expect(result).toEqual([
      {
        accountId,
        hasPhotos: true,
        hasFeed: false,
        hasProfileHistory: false,
        photoCount: 1,
        feedCount: 0,
        profileHistoryCount: 0,
        displayLabel: 'Alice (@alice)',
      },
    ]);

    expect(mockedFs.readJson).not.toHaveBeenCalledWith(accountsJsonPath);
    expect(mockedFs.writeJson).not.toHaveBeenCalledWith(
      metaPath,
      expect.anything(),
      expect.anything()
    );
  });

  it('upgrades older meta displayLabel using owner fields', async () => {
    const accountId = '256147';
    const accountDir = path.join(testOutputDir, accountId);
    const photosJsonPath = path.join(accountDir, `${accountId}_photos.json`);
    const metaPath = path.join(accountDir, 'folder-meta.json');

    (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
      if (p === testOutputDir) return true;
      if (p === photosJsonPath) return true;
      if (p === metaPath) return true;
      return false;
    });

    (mockedFs.readdir as jest.Mock).mockResolvedValue([makeDirent(accountId)]);

    (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
      if (p === photosJsonPath) return [{ Id: '1' }];
      if (p === metaPath) {
        return {
          schemaVersion: 1,
          accountId,
          updatedAt: new Date().toISOString(),
          owner: {
            accountId,
            username: 'alice',
            displayName: 'Alice',
            displayLabel: 'alice', // older / wrong format
          },
        };
      }
      throw new Error(`Unexpected readJson(${p})`);
    });

    const result = await service.listAvailableAccounts();
    expect(result[0]?.displayLabel).toBe('Alice (@alice)');
    expect(mockedFs.writeJson).toHaveBeenCalledWith(
      metaPath,
      expect.objectContaining({
        owner: expect.objectContaining({
          displayLabel: 'Alice (@alice)',
        }),
      }),
      expect.anything()
    );
  });

  it('backfills folder-meta.json from *_accounts.json when meta missing', async () => {
    const accountId = '256147';
    const accountDir = path.join(testOutputDir, accountId);
    const photosJsonPath = path.join(accountDir, `${accountId}_photos.json`);
    const accountsJsonPath = path.join(accountDir, `${accountId}_accounts.json`);
    const metaPath = path.join(accountDir, 'folder-meta.json');

    (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
      if (p === testOutputDir) return true;
      if (p === photosJsonPath) return true;
      if (p === metaPath) return false;
      if (p === accountsJsonPath) return true;
      return false;
    });

    (mockedFs.readdir as jest.Mock).mockResolvedValue([makeDirent(accountId)]);

    const accountsData: PlayerResult[] = [
      {
        accountId,
        username: 'alice',
        displayName: 'Alice',
        displayEmoji: '',
        profileImage: '',
        bannerImage: '',
        isJunior: false,
        platforms: 0,
        personalPronouns: 0,
        identityFlags: 0,
        createdAt: new Date().toISOString(),
        isMetaPlatformBlocked: false,
      },
    ];

    (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
      if (p === photosJsonPath) return [{ Id: '1' }];
      if (p === accountsJsonPath) return accountsData;
      throw new Error(`Unexpected readJson(${p})`);
    });

    const result = await service.listAvailableAccounts();

    expect(result[0]?.displayLabel).toBe('Alice (@alice)');
    expect(mockedFs.writeJson).toHaveBeenCalledWith(
      metaPath,
      expect.objectContaining({
        schemaVersion: 1,
        accountId,
        owner: expect.objectContaining({
          accountId,
          displayLabel: 'Alice (@alice)',
        }),
      }),
      expect.anything()
    );
  });

  it('includes accounts that only have profile history metadata', async () => {
    const accountId = '256147';
    const accountDir = path.join(testOutputDir, accountId);
    const profileHistoryJsonPath = path.join(
      accountDir,
      `${accountId}_profile_history.json`
    );

    (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
      if (p === testOutputDir) return true;
      if (p === profileHistoryJsonPath) return true;
      return false;
    });

    (mockedFs.readdir as jest.Mock).mockResolvedValue([makeDirent(accountId)]);
    (mockedFs.readJson as jest.Mock).mockImplementation(async (p: string) => {
      if (p === profileHistoryJsonPath) return [{ Id: '1' }];
      throw new Error(`Unexpected readJson(${p})`);
    });

    const result = await service.listAvailableAccounts();

    expect(result).toEqual([
      {
        accountId,
        hasPhotos: false,
        hasFeed: false,
        hasProfileHistory: true,
        photoCount: 0,
        feedCount: 0,
        profileHistoryCount: 1,
        displayLabel: undefined,
      },
    ]);
  });
});

