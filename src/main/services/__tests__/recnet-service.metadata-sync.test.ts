import * as fs from 'fs-extra';
import * as path from 'path';
import { RecNetService } from '../recnet-service';
import { Semaphore } from '../../utils/semaphore';

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
  let delaySpy: jest.SpyInstance;
  const outputRoot = path.join(__dirname, 'test-output', 'metadata-sync');

  beforeEach(async () => {
    jest.clearAllMocks();
    service = new RecNetService();
    await service.updateSettings({
      outputRoot,
      maxConcurrentDownloads: 1,
      interPageDelayMs: 0,
    });
    delaySpy = jest
      .spyOn<any, any>(service as any, 'delay')
      .mockResolvedValue(undefined);
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
      if (s === path.join(accountDir, `${accountId}_photos.json`)) {
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
          {
            accountId: 'related-1',
            username: 'related',
            displayName: 'Related',
            displayEmoji: '',
            profileImage: 'related-p.jpg',
            bannerImage: 'related-b.jpg',
            isJunior: false,
            platforms: 0,
            personalPronouns: 0,
            identityFlags: 0,
            createdAt: '',
            isMetaPlatformBlocked: false,
          },
        ];
      }
      if (s.endsWith(`${accountId}_photos.json`)) {
        return [
          {
            Id: 'image-1',
            Type: 1,
            Accessibility: 0,
            AccessibilityLocked: false,
            ImageName: 'image.jpg',
            Description: '',
            PlayerId: accountId,
            TaggedPlayerIds: ['related-1'],
            RoomId: '',
            PlayerEventId: '',
            CreatedAt: '',
            CheerCount: 0,
            CommentCount: 0,
          },
        ];
      }
      return [];
    });

    jest.spyOn(service as any, 'downloadPhotoWithRetry').mockResolvedValue({
      response: { success: true, value: new Uint8Array([1, 2, 3]).buffer },
      attempts: 1,
    });
    jest
      .spyOn<any, any>(service as any, 'pathExistsWithContent')
      .mockImplementation(async (p: unknown) => {
        return String(p) === path.join(accountDir, 'photos', 'image-1.jpg');
      });

    const result = await service.syncMetadataLibraryAssets({ force: true });
    expect(result.accountsProcessed).toBe(1);
    expect(mockedFs.writeJson).toHaveBeenCalled();
    expect((service as any).downloadPhotoWithRetry).toHaveBeenCalledWith(
      'p.jpg',
      undefined,
      undefined,
      undefined
    );
    expect((service as any).downloadPhotoWithRetry).not.toHaveBeenCalledWith(
      'b.jpg',
      undefined,
      undefined,
      undefined
    );
    expect((service as any).downloadPhotoWithRetry).not.toHaveBeenCalledWith(
      'related-p.jpg',
      undefined,
      undefined,
      undefined
    );
  });

  it('skips user profile metadata sync when only photo metadata exists', async () => {
    const accountId = '12345';
    const accountDir = path.join(outputRoot, accountId);
    mockedFs.pathExists.mockImplementation(async (p: fs.PathLike) => {
      const s = String(p);
      return (
        s === outputRoot ||
        s === path.join(accountDir, `${accountId}_accounts.json`) ||
        s === path.join(accountDir, `${accountId}_photos.json`)
      );
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
      if (s.endsWith(`${accountId}_photos.json`)) {
        return [
          {
            Id: 'image-1',
            Type: 1,
            Accessibility: 0,
            AccessibilityLocked: false,
            ImageName: 'image.jpg',
            Description: '',
            PlayerId: accountId,
            TaggedPlayerIds: [],
            RoomId: '',
            PlayerEventId: '',
            CreatedAt: '',
            CheerCount: 0,
            CommentCount: 0,
          },
        ];
      }
      return [];
    });
    jest
      .spyOn<any, any>(service as any, 'pathExistsWithContent')
      .mockResolvedValue(false);
    const downloadSpy = jest
      .spyOn(service as any, 'downloadPhotoWithRetry')
      .mockResolvedValue({
        response: { success: true, value: new Uint8Array([1, 2, 3]).buffer },
        attempts: 1,
      });

    const result = await service.syncMetadataLibraryAssets({ force: true });

    expect(result.accountsProcessed).toBe(0);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it('saves extensionless metadata images with a jpg extension', async () => {
    const metadataDir = path.join(outputRoot, 'metadata');
    const imageName = 'profile-image-without-extension';
    jest.spyOn(service as any, 'downloadPhotoWithRetry').mockResolvedValue({
      response: { success: true, value: new Uint8Array([1, 2, 3]).buffer },
      attempts: 1,
    });

    const result = await (service as any).downloadMetadataAssetToDir(
      imageName,
      metadataDir,
      true
    );

    const expectedPath = path.join(metadataDir, `${imageName}.jpg`);
    expect(mockedFs.writeFile).toHaveBeenCalledWith(
      expectedPath,
      Buffer.from([1, 2, 3])
    );
    expect(result.entry).toEqual({
      imageName,
      relativePath: `${imageName}.jpg`,
      absolutePath: expectedPath,
    });
  });

  it('cancels metadata sync before scanning when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.syncMetadataLibraryAssets({
        force: false,
        signal: controller.signal,
      })
    ).rejects.toThrow('Metadata sync cancelled');
    expect(mockedFs.readdir).not.toHaveBeenCalled();
  });

  it('does not rate-limit when the metadata profile image already exists locally', async () => {
    await service.updateSettings({ interPageDelayMs: 100 });
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
      if (s === path.join(accountDir, `${accountId}_photos.json`)) {
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
          {
            accountId: 'related-1',
            username: 'related',
            displayName: 'Related',
            displayEmoji: '',
            profileImage: 'related-p.jpg',
            bannerImage: 'related-b.jpg',
            isJunior: false,
            platforms: 0,
            personalPronouns: 0,
            identityFlags: 0,
            createdAt: '',
            isMetaPlatformBlocked: false,
          },
        ];
      }
      if (s.endsWith(`${accountId}_photos.json`)) {
        return [
          {
            Id: 'image-1',
            Type: 1,
            Accessibility: 0,
            AccessibilityLocked: false,
            ImageName: 'image.jpg',
            Description: '',
            PlayerId: accountId,
            TaggedPlayerIds: ['related-1'],
            RoomId: '',
            PlayerEventId: '',
            CreatedAt: '',
            CheerCount: 0,
            CommentCount: 0,
          },
        ];
      }
      return [];
    });

    jest
      .spyOn<any, any>(service as any, 'pathExistsWithContent')
      .mockResolvedValue(true);
    const downloadSpy = jest
      .spyOn(service as any, 'downloadPhotoWithRetry')
      .mockResolvedValue({
        response: { success: true, value: new Uint8Array([1, 2, 3]).buffer },
        attempts: 1,
      });

    const result = await service.syncMetadataLibraryAssets({ force: false });
    expect(result.accountsProcessed).toBe(1);
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(delaySpy).not.toHaveBeenCalled();
  });

  it('uses the configured metadata download concurrency without an extra sync delay', async () => {
    await service.updateSettings({
      maxConcurrentDownloads: 2,
      interPageDelayMs: 100,
    });
    let inFlight = 0;
    let maxInFlight = 0;
    jest
      .spyOn<any, any>(service as any, 'downloadPhotoWithRetry')
      .mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 0));
        inFlight--;
        return {
          response: { success: true, value: new Uint8Array([1, 2, 3]).buffer },
          attempts: 1,
        };
      });

    const synced = await (service as any).syncAccountMetadataAssets(
      [
        {
          accountId: 'account-1',
          username: 'one',
          displayName: 'One',
          displayEmoji: '',
          profileImage: 'one.jpg',
          bannerImage: '',
          isJunior: false,
          platforms: 0,
          personalPronouns: 0,
          identityFlags: 0,
          createdAt: '',
          isMetaPlatformBlocked: false,
        },
        {
          accountId: 'account-2',
          username: 'two',
          displayName: 'Two',
          displayEmoji: '',
          profileImage: 'two.jpg',
          bannerImage: '',
          isJunior: false,
          platforms: 0,
          personalPronouns: 0,
          identityFlags: 0,
          createdAt: '',
          isMetaPlatformBlocked: false,
        },
        {
          accountId: 'account-3',
          username: 'three',
          displayName: 'Three',
          displayEmoji: '',
          profileImage: 'three.jpg',
          bannerImage: '',
          isJunior: false,
          platforms: 0,
          personalPronouns: 0,
          identityFlags: 0,
          createdAt: '',
          isMetaPlatformBlocked: false,
        },
      ],
      path.join(outputRoot, 'metadata'),
      true,
      undefined,
      undefined,
      undefined,
      false,
      new Semaphore(2)
    );

    expect(Object.keys(synced)).toHaveLength(3);
    expect(maxInFlight).toBe(2);
    expect(delaySpy).not.toHaveBeenCalled();
  });

  it('downloads shared event creator profile and banner metadata', async () => {
    const creatorId = 'creator-1';
    const eventId = 'event-1';
    const eventsRoot = path.join(outputRoot, 'events');
    const creatorDir = path.join(eventsRoot, creatorId);
    const eventDir = path.join(creatorDir, eventId);

    mockedFs.pathExists.mockImplementation(async (p: fs.PathLike) => {
      const s = String(p);
      return (
        s === outputRoot ||
        s === eventsRoot ||
        s === path.join(creatorDir, 'creator.json') ||
        s === path.join(creatorDir, 'events.json') ||
        s === path.join(eventDir, `${eventId}_photos.json`)
      );
    });
    mockedFs.readdir.mockImplementation(async (p: fs.PathLike) => {
      const s = String(p);
      if (s === outputRoot) {
        return [{ name: 'events', isDirectory: () => true }] as any;
      }
      if (s === eventsRoot) {
        return [{ name: creatorId, isDirectory: () => true }] as any;
      }
      if (s === creatorDir) {
        return [{ name: eventId, isDirectory: () => true }] as any;
      }
      return [];
    });
    mockedFs.readJson.mockImplementation(async (p: fs.PathLike) => {
      const s = String(p);
      if (s.endsWith('creator.json')) {
        return {
          accountId: creatorId,
          username: 'creator',
          displayName: 'Creator',
          displayEmoji: '',
          profileImage: 'creator-p.jpg',
          bannerImage: 'creator-b.jpg',
          isJunior: false,
          platforms: 0,
          personalPronouns: 0,
          identityFlags: 0,
          createdAt: '',
          isMetaPlatformBlocked: false,
        };
      }
      if (s.endsWith('events.json')) {
        return [
          {
            PlayerEventId: eventId,
            CreatorPlayerId: creatorId,
            ImageName: null,
            RoomId: '',
            SubRoomId: null,
            ClubId: null,
            Name: 'Event',
            Description: '',
            StartTime: '',
            EndTime: '',
            AttendeeCount: 0,
            State: 0,
            AccessibilityLevel: 0,
            IsMultiInstance: false,
            SupportMultiInstanceRoomChat: false,
            BroadcastingRoomInstanceId: null,
            DefaultBroadcastPermissions: 0,
            CanRequestBroadcastPermissions: 0,
            RecurrenceSchedule: null,
          },
        ];
      }
      if (s.endsWith(`${eventId}_photos.json`)) {
        return [];
      }
      return [];
    });

    jest.spyOn(service as any, 'downloadPhotoWithRetry').mockResolvedValue({
      response: { success: true, value: new Uint8Array([1, 2, 3]).buffer },
      attempts: 1,
    });

    const result = await service.syncMetadataLibraryAssets({ force: true });

    expect(result.creatorsProcessed).toBe(1);
    expect((service as any).downloadPhotoWithRetry).toHaveBeenCalledWith(
      'creator-p.jpg',
      undefined,
      undefined,
      undefined
    );
    expect((service as any).downloadPhotoWithRetry).toHaveBeenCalledWith(
      'creator-b.jpg',
      undefined,
      undefined,
      undefined
    );
  });
});
