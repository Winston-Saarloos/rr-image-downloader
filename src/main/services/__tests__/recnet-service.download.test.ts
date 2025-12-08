/**
 * Tests for RecNetService photo downloading functionality
 *
 * This test suite verifies the core photo downloading logic, including:
 * - Downloading photos from the CDN
 * - Skipping already-downloaded photos to avoid duplicates
 * - Copying photos from feed folder when they exist there
 * - Handling download failures gracefully
 * - Respecting download limits for testing
 * - Operation cancellation support
 *
 * These tests use mocked file system and HTTP clients to ensure
 * fast, isolated, and reliable test execution.
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

describe('RecNetService - Download Functionality', () => {
  let service: RecNetService;
  let testOutputDir: string;
  let testAccountId: string;
  let mockPhotosController: jest.Mocked<PhotosController>;

  beforeEach(() => {
    // Create a unique test directory for each test
    testOutputDir = path.join(__dirname, 'test-output', `test-${Date.now()}`);
    testAccountId = 'test-account-123';

    // Reset all mocks
    jest.clearAllMocks();

    // Create service instance
    service = new RecNetService();
    service.updateSettings({ outputRoot: testOutputDir });
    jest.spyOn<any, any>(service as any, 'delay').mockResolvedValue(undefined);

    // Setup PhotosController mock
    mockPhotosController = {
      downloadPhoto: jest.fn(),
      fetchPlayerPhotos: jest.fn(),
      fetchFeedPhotos: jest.fn(),
    } as any;

    // Replace the photosController with our mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).photosController = mockPhotosController;
  });

  afterEach(async () => {
    // Cleanup test directory if it exists
    try {
      // Use actual fs for cleanup
      const actualFs = jest.requireActual('fs-extra');
      if (await actualFs.pathExists(testOutputDir)) {
        await actualFs.remove(testOutputDir);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Tests for the downloadPhotos method
   *
   * This method downloads user photos from the CDN based on metadata
   * collected in a previous step. It handles deduplication, rate limiting,
   * and error recovery.
   */
  describe('downloadPhotos', () => {
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
     * Verifies the basic photo download functionality.
     * Tests that photos are downloaded from the API and saved to the correct location.
     */
    it('should download photos successfully', async () => {
      const photos: ImageDto[] = [
        createMockPhoto('photo-1', 'image1.jpg'),
        createMockPhoto('photo-2', 'image2.jpg'),
      ];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );
      const photosDir = path.join(testOutputDir, testAccountId, 'photos');

      // Setup mocks
      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === photosJsonPath) return true;
          if (p === photosDir) return true;
          if (p.startsWith(path.join(photosDir, 'photo-'))) return false;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      const mockImageData = new ArrayBuffer(1024);
      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: mockImageData,
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.accountId).toBe(testAccountId);
      expect(result.downloadStats.newDownloads).toBe(2);
      expect(result.downloadStats.failedDownloads).toBe(0);
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(2);
      expect(mockedFs.writeFile).toHaveBeenCalledTimes(2);
    });

    /**
     * Verifies that photos already present on disk are not re-downloaded.
     * This prevents wasting bandwidth and time on duplicate downloads.
     * The photo is marked as 'already_exists_in_photos' in the results.
     */
    it('should skip photos that already exist', async () => {
      const photos: ImageDto[] = [
        createMockPhoto('photo-1', 'image1.jpg'),
        createMockPhoto('photo-2', 'image2.jpg'),
      ];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );
      const photosDir = path.join(testOutputDir, testAccountId, 'photos');
      const existingPhotoPath = path.join(photosDir, 'photo-1.jpg');

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === photosJsonPath) return true;
          if (p === existingPhotoPath) return true; // Photo already exists
          if (p === path.join(photosDir, 'photo-2.jpg')) return false;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue(['photo-1.jpg']);

      const mockImageData = new ArrayBuffer(1024);
      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: mockImageData,
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.downloadStats.alreadyDownloaded).toBe(1);
      expect(result.downloadStats.newDownloads).toBe(1);
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(1); // Only called for photo-2
    });

    /**
     * Verifies that if a photo exists in the feed folder, it's copied
     * to the photos folder instead of being re-downloaded. This optimizes
     * storage by reusing already-downloaded feed photos.
     */
    it('should copy photos from feed folder if they exist there', async () => {
      const photos: ImageDto[] = [createMockPhoto('photo-1', 'image1.jpg')];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );
      const photosDir = path.join(testOutputDir, testAccountId, 'photos');
      const feedDir = path.join(testOutputDir, testAccountId, 'feed');
      const feedPhotoPath = path.join(feedDir, 'photo-1.jpg');
      const photoPath = path.join(photosDir, 'photo-1.jpg');

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === photosJsonPath) return true;
          if (p === photoPath) return false; // Not in photos folder
          if (p === feedPhotoPath) return true; // Exists in feed folder
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.downloadStats.alreadyDownloaded).toBe(1);
      expect(mockedFs.copy).toHaveBeenCalledWith(feedPhotoPath, photoPath);
      expect(mockPhotosController.downloadPhoto).not.toHaveBeenCalled();
    });

    /**
     * Verifies that individual photo download failures don't stop the entire process.
     * Failed downloads are recorded in the results with appropriate error information,
     * allowing the download of other photos to continue.
     */
    it('should handle download failures gracefully', async () => {
      const photos: ImageDto[] = [
        createMockPhoto('photo-1', 'image1.jpg'),
        createMockPhoto('photo-2', 'image2.jpg'),
      ];

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

      // First photo succeeds, second fails
      mockPhotosController.downloadPhoto
        .mockResolvedValueOnce({
          success: true,
          value: new ArrayBuffer(1024),
          status: 200,
        } as GenericResponse<ArrayBuffer>)
        .mockResolvedValueOnce({
          success: false,
          value: null,
          status: 404,
          error: 'Not Found',
        } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.downloadStats.newDownloads).toBe(1);
      expect(result.downloadStats.failedDownloads).toBe(1);
      expect(result.downloadResults[1].status).toBe('failed');
      expect(mockedFs.writeFile).toHaveBeenCalledTimes(1);
    });

    /**
     * Verifies that download limits (maxPhotosToDownload setting) are respected.
     * This is useful for testing scenarios where you want to limit the number
     * of photos downloaded. Once the limit is reached, remaining photos are skipped.
     */
    it('should respect download limits', async () => {
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

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === photosJsonPath) return true;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      // Set download limit to 2
      service.updateSettings({ maxPhotosToDownload: 2 });

      const mockImageData = new ArrayBuffer(1024);
      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: mockImageData,
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.downloadStats.newDownloads).toBe(2);
      expect(result.downloadStats.skipped).toBe(1);
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(2);
    });

    /**
     * Verifies that the method fails fast if the photos metadata file is missing.
     * The metadata file must be created by collectPhotos() before downloading.
     */
    it('should throw error if photos metadata file does not exist', async () => {
      (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);

      await expect(service.downloadPhotos(testAccountId)).rejects.toThrow(
        'Photos not collected. Run collect photos first.'
      );
    });

    /**
     * Verifies that the download process can be cancelled mid-operation.
     * When cancelled, the operation should stop gracefully and throw an error
     * to signal cancellation to the caller.
     */
    it('should handle cancellation', async () => {
      const photos: ImageDto[] = [
        createMockPhoto('photo-1', 'image1.jpg'),
        createMockPhoto('photo-2', 'image2.jpg'),
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
          // Photos don't exist yet, so they'll be downloaded
          if (p.startsWith(path.join(photosDir, 'photo-'))) return false;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      // Simulate cancellation during download
      mockPhotosController.downloadPhoto.mockImplementation(async () => {
        service.cancelCurrentOperation();
        return {
          success: true,
          value: new ArrayBuffer(1024),
          status: 200,
        } as GenericResponse<ArrayBuffer>;
      });

      await expect(service.downloadPhotos(testAccountId)).rejects.toThrow(
        'Operation cancelled'
      );
    });

    /**
     * Verifies that photos with missing or invalid data (no ID or image name)
     * are skipped and recorded as errors rather than causing the entire process to fail.
     */
    it('should handle invalid photo data', async () => {
      const photos: ImageDto[] = [
        { ...createMockPhoto('photo-1', ''), ImageName: '' }, // Invalid: no image name
        createMockPhoto('photo-2', 'image2.jpg'),
      ];

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

      const mockImageData = new ArrayBuffer(1024);
      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: mockImageData,
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.downloadStats.newDownloads).toBe(1); // Only photo-2 downloaded
      expect(result.downloadResults[0].error).toBe('invalid_photo_data');
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Tests for the downloadFeedPhotos method
   *
   * This method downloads feed photos (photos from other users that appear in
   * the user's feed). The logic is similar to downloadPhotos but uses a
   * different metadata file and directory.
   */
  describe('downloadFeedPhotos', () => {
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
     * Verifies that feed photos are downloaded and saved to the feed directory.
     * Similar to regular photos but stored separately for organizational purposes.
     */
    it('should download feed photos successfully', async () => {
      const feedPhotos: ImageDto[] = [
        createMockFeedPhoto('feed-1', 'feed1.jpg'),
        createMockFeedPhoto('feed-2', 'feed2.jpg'),
      ];

      const feedJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_feed.json`
      );
      const feedDir = path.join(testOutputDir, testAccountId, 'feed');

      (mockedFs.pathExists as jest.Mock).mockImplementation(
        async (p: string) => {
          if (p === feedJsonPath) return true;
          if (p.startsWith(path.join(feedDir, 'feed-'))) return false;
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

      const result = await service.downloadFeedPhotos(testAccountId);

      expect(result.accountId).toBe(testAccountId);
      expect(result.downloadStats.newDownloads).toBe(2);
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(2);
    });

    /**
     * Verifies that the method fails if the feed metadata file is missing.
     * The metadata must be collected via collectFeedPhotos() first.
     */
    it('should throw error if feed metadata file does not exist', async () => {
      (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);

      await expect(service.downloadFeedPhotos(testAccountId)).rejects.toThrow(
        'Feed photos not collected. Run collect feed photos first.'
      );
    });
  });
});
