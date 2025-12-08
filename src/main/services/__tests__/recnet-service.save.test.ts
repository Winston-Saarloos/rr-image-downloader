/**
 * Tests for RecNetService file saving functionality
 *
 * This test suite verifies that data is correctly saved to disk:
 * - Photos are saved to the correct directory structure
 * - File sizes are tracked accurately
 * - Directories are created as needed
 * - Multiple files can be saved in sequence
 * - File write errors are handled gracefully
 * - Metadata JSON files are saved with proper formatting
 *
 * These tests ensure data persistence works correctly and files are
 * organized properly for easy access and management.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { RecNetService } from '../recnet-service';
import { PhotosController } from '../recnet/photos-controller';
import { ImageDto } from '../../models/ImageDto';
import { GenericResponse } from '../../models/GenericResponse';

// Mock dependencies
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
    copy: jest.fn(),
    remove: jest.fn(),
  };
});

jest.mock('../recnet/http-client');
jest.mock('../recnet/photos-controller');
jest.mock('../recnet/accounts-controller');
jest.mock('../recnet/rooms-controller');
jest.mock('../recnet/events-controller');

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('RecNetService - File Saving Functionality', () => {
  let service: RecNetService;
  let testOutputDir: string;
  let testAccountId: string;
  let mockPhotosController: jest.Mocked<PhotosController>;

  beforeEach(() => {
    testOutputDir = path.join(__dirname, 'test-output', `test-${Date.now()}`);
    testAccountId = 'test-account-123';

    jest.clearAllMocks();

    service = new RecNetService();
    service.updateSettings({ outputRoot: testOutputDir });

    mockPhotosController = {
      downloadPhoto: jest.fn(),
      fetchPlayerPhotos: jest.fn(),
      fetchFeedPhotos: jest.fn(),
    } as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).photosController = mockPhotosController;
  });

  afterEach(async () => {
    // Cleanup test directory if it exists
    try {
      const actualFs = jest.requireActual('fs-extra');
      if (await actualFs.pathExists(testOutputDir)) {
        await actualFs.remove(testOutputDir);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Tests for saving photo files to disk
   *
   * Photos are saved as JPEG files in the account's photos directory.
   * These tests verify the file saving process works correctly.
   */
  describe('Photo File Saving', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createMockPhoto = (id: string, imageName: string): ImageDto => ({
      Id: id,
      Type: 1,
      Accessibility: 0,
      AccessibilityLocked: false,
      ImageName: imageName,
      Description: '',
      PlayerId: 'player-123',
      TaggedPlayerIds: [],
      RoomId: 'room-123',
      PlayerEventId: 'event-123',
      CreatedAt: new Date().toISOString(),
      CheerCount: 0,
      CommentCount: 0,
    });

    /**
     * Verifies that downloaded photos are saved to the correct file path.
     * Photos should be saved as {photoId}.jpg in the account's photos directory.
     */
    it('should save downloaded photo to correct path', async () => {
      const photos: ImageDto[] = [createMockPhoto('photo-1', 'image1.jpg')];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );
      const photosDir = path.join(testOutputDir, testAccountId, 'photos');
      const expectedPhotoPath = path.join(photosDir, 'photo-1.jpg');

      (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);
      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      const mockImageData = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG header
      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: mockImageData.buffer,
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      // Mock pathExists to return true for photos.json after it's created
      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === photosJsonPath) return true;
          if (p === expectedPhotoPath) return false;
          return false;
        }
      );

      await service.downloadPhotos(testAccountId);

      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expectedPhotoPath,
        expect.any(Buffer)
      );
    });

    /**
     * Verifies that the file size of downloaded photos is tracked correctly.
     * File size information is useful for statistics and verification purposes.
     */
    it('should save photo with correct file size', async () => {
      const photos: ImageDto[] = [createMockPhoto('photo-1', 'image1.jpg')];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === photosJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      const imageSize = 2048;
      const mockImageData = new ArrayBuffer(imageSize);
      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: mockImageData,
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.downloadResults[0].size).toBe(imageSize);
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer)
      );
    });

    /**
     * Verifies that the photos directory is created automatically if it doesn't exist.
     * This ensures the save operation doesn't fail due to missing directories.
     */
    it('should create photos directory if it does not exist', async () => {
      const photos: ImageDto[] = [createMockPhoto('photo-1', 'image1.jpg')];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );
      const photosDir = path.join(testOutputDir, testAccountId, 'photos');

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === photosJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: new ArrayBuffer(1024),
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      await service.downloadPhotos(testAccountId);

      expect(mockedFs.ensureDir).toHaveBeenCalledWith(photosDir);
    });

    /**
     * Verifies that file write errors (e.g., disk full, permissions) are caught
     * and recorded in the results rather than crashing the entire download process.
     * Other photos should continue downloading even if one fails to save.
     */
    it('should handle file write errors gracefully', async () => {
      const photos: ImageDto[] = [createMockPhoto('photo-1', 'image1.jpg')];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === photosJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);
      (mockedFs.writeFile as jest.Mock).mockRejectedValue(
        new Error('Disk full')
      );

      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: new ArrayBuffer(1024),
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.downloadStats.failedDownloads).toBeGreaterThan(0);
      expect(result.downloadResults[0].status).toBe('error');
    });

    /**
     * Verifies that multiple photos can be saved sequentially without issues.
     * Each photo should be saved to its own file with the correct naming convention.
     */
    it('should save multiple photos in sequence', async () => {
      const photos: ImageDto[] = [
        createMockPhoto('photo-1', 'image1.jpg'),
        createMockPhoto('photo-2', 'image2.jpg'),
        createMockPhoto('photo-3', 'image3.jpg'),
      ];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );
      const photosDir = path.join(testOutputDir, testAccountId, 'photos');

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === photosJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: new ArrayBuffer(1024),
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      await service.downloadPhotos(testAccountId);

      expect(mockedFs.writeFile).toHaveBeenCalledTimes(3);
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        path.join(photosDir, 'photo-1.jpg'),
        expect.any(Buffer)
      );
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        path.join(photosDir, 'photo-2.jpg'),
        expect.any(Buffer)
      );
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        path.join(photosDir, 'photo-3.jpg'),
        expect.any(Buffer)
      );
    });
  });

  /**
   * Tests for saving feed photo files
   *
   * Feed photos are saved separately from regular photos in a 'feed' directory.
   * This keeps them organized and allows for different handling if needed.
   */
  describe('Feed Photo File Saving', () => {
    const createMockFeedPhoto = (id: string, imageName: string): ImageDto => ({
      Id: id,
      Type: 1,
      Accessibility: 0,
      AccessibilityLocked: false,
      ImageName: imageName,
      Description: '',
      PlayerId: 'player-123',
      TaggedPlayerIds: [],
      RoomId: 'room-123',
      PlayerEventId: 'event-123',
      CreatedAt: new Date().toISOString(),
      CheerCount: 0,
      CommentCount: 0,
    });

    /**
     * Verifies that feed photos are saved to the feed directory, separate from
     * regular photos. This maintains organization and allows for different
     * processing of feed vs. regular photos.
     */
    it('should save feed photos to feed directory', async () => {
      const feedPhotos: ImageDto[] = [
        createMockFeedPhoto('feed-1', 'feed1.jpg'),
      ];

      const feedJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_feed.json`
      );
      const feedDir = path.join(testOutputDir, testAccountId, 'feed');
      const expectedFeedPath = path.join(feedDir, 'feed-1.jpg');

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === feedJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(feedPhotos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      const mockImageData = new ArrayBuffer(1024);
      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: mockImageData,
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      await service.downloadFeedPhotos(testAccountId);

      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expectedFeedPath,
        expect.any(Buffer)
      );
    });
  });

  /**
   * Tests for saving metadata JSON files
   *
   * Metadata files store account, room, and event information in JSON format.
   * These files are used for caching and for the UI to display photo context.
   */
  describe('Metadata File Saving', () => {
    /**
     * Verifies that account data is saved to a JSON file with proper formatting.
     * The file should be saved as {accountId}_accounts.json in the account directory.
     */
    it('should save accounts data to JSON file', async () => {
      const accountDir = path.join(testOutputDir, testAccountId);
      const accountsJsonPath = path.join(
        accountDir,
        `${testAccountId}_accounts.json`
      );

      (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);
      (mockedFs.ensureDir as jest.Mock).mockResolvedValue(undefined);

      const mockAccounts = [
        {
          accountId: 'account-1',
          username: 'user1',
          displayName: 'User 1',
          displayEmoji: '😀',
          profileImage: 'profile.jpg',
          bannerImage: 'banner.jpg',
          isJunior: false,
          platforms: 1,
          personalPronouns: 0,
          identityFlags: 0,
          createdAt: new Date().toISOString(),
          isMetaPlatformBlocked: false,
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).accountsController = {
        fetchBulkAccounts: jest.fn().mockResolvedValue(mockAccounts),
      };

      const photos: ImageDto[] = [
        {
          Id: 'photo-1',
          Type: 1,
          Accessibility: 0,
          AccessibilityLocked: false,
          ImageName: 'image.jpg',
          Description: '',
          PlayerId: 'account-1',
          TaggedPlayerIds: [],
          RoomId: 'room-1',
          PlayerEventId: 'event-1',
          CreatedAt: new Date().toISOString(),
          CheerCount: 0,
          CommentCount: 0,
        },
      ];

      await service.fetchAndSaveBulkData(testAccountId, photos);

      expect(mockedFs.writeJson).toHaveBeenCalledWith(
        accountsJsonPath,
        expect.any(Array),
        { spaces: 2 }
      );
    });

    /**
     * Verifies that room data is saved to a JSON file.
     * The file should be saved as {accountId}_rooms.json.
     */
    it('should save rooms data to JSON file', async () => {
      const accountDir = path.join(testOutputDir, testAccountId);
      const roomsJsonPath = path.join(
        accountDir,
        `${testAccountId}_rooms.json`
      );

      (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);

      const mockRooms = [
        {
          RoomId: 'room-1',
          Name: 'Test Room',
          Description: '',
          ImageName: 'room.jpg',
          WarningMask: 0,
          CustomWarning: null,
          CreatorAccountId: 'creator-1',
          State: 0,
          Accessibility: 0,
          PublishState: 0,
          SupportsLevelVoting: false,
          IsRRO: false,
          IsRecRoomApproved: false,
          ExcludeFromLists: false,
          ExcludeFromSearch: false,
          SupportsScreens: false,
          SupportsWalkVR: false,
          SupportsTeleportVR: false,
          SupportsVRLow: false,
          SupportsQuest2: false,
          SupportsMobile: false,
          SupportsJuniors: false,
          MinLevel: 0,
          AgeRating: 0,
          CreatedAt: new Date().toISOString(),
          PublishedAt: new Date().toISOString(),
          BecameRRStudioRoomAt: '',
          Stats: {
            CheerCount: 0,
            FavoriteCount: 0,
            VisitorCount: 0,
            VisitCount: 0,
          },
          RankingContext: null,
          IsDorm: false,
          IsPlacePlay: false,
          MaxPlayersCalculationMode: 0,
          MaxPlayers: 0,
          CloningAllowed: false,
          DisableMicAutoMute: false,
          DisableRoomComments: false,
          EncryptVoiceChat: false,
          ToxmodEnabled: false,
          LoadScreenLocked: false,
          UgcVersion: 0,
          PersistenceVersion: 0,
          UgcSubVersion: 0,
          MinUgcSubVersion: 0,
          AutoLocalizedRoom: false,
          IsDeveloperOwned: false,
          RankedEntityId: '',
          BoostCount: 0,
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).roomsController = {
        fetchBulkRooms: jest.fn().mockResolvedValue(mockRooms),
      };

      const photos: ImageDto[] = [
        {
          Id: 'photo-1',
          Type: 1,
          Accessibility: 0,
          AccessibilityLocked: false,
          ImageName: 'image.jpg',
          Description: '',
          PlayerId: 'player-1',
          TaggedPlayerIds: [],
          RoomId: 'room-1',
          PlayerEventId: 'event-1',
          CreatedAt: new Date().toISOString(),
          CheerCount: 0,
          CommentCount: 0,
        },
      ];

      await service.fetchAndSaveBulkData(testAccountId, photos);

      expect(mockedFs.writeJson).toHaveBeenCalledWith(
        roomsJsonPath,
        expect.any(Array),
        { spaces: 2 }
      );
    });

    /**
     * Verifies that event data is saved to a JSON file.
     * The file should be saved as {accountId}_events.json.
     */
    it('should save events data to JSON file', async () => {
      const accountDir = path.join(testOutputDir, testAccountId);
      const eventsJsonPath = path.join(
        accountDir,
        `${testAccountId}_events.json`
      );

      (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);

      const mockEvents = [
        {
          PlayerEventId: 'event-1',
          CreatorPlayerId: 'creator-1',
          ImageName: null,
          RoomId: 'room-1',
          SubRoomId: null,
          ClubId: null,
          Name: 'Test Event',
          Description: '',
          StartTime: new Date().toISOString(),
          EndTime: new Date().toISOString(),
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).eventsController = {
        fetchBulkEvents: jest.fn().mockResolvedValue(mockEvents),
      };

      const photos: ImageDto[] = [
        {
          Id: 'photo-1',
          Type: 1,
          Accessibility: 0,
          AccessibilityLocked: false,
          ImageName: 'image.jpg',
          Description: '',
          PlayerId: 'player-1',
          TaggedPlayerIds: [],
          RoomId: 'room-1',
          PlayerEventId: 'event-1',
          CreatedAt: new Date().toISOString(),
          CheerCount: 0,
          CommentCount: 0,
        },
      ];

      await service.fetchAndSaveBulkData(testAccountId, photos);

      expect(mockedFs.writeJson).toHaveBeenCalledWith(
        eventsJsonPath,
        expect.any(Array),
        { spaces: 2 }
      );
    });
  });
});
