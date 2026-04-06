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
import type { Progress } from '../../../shared/types';

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
jest.mock('../recnet/image-comments-controller');

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('RecNetService - Download Functionality', () => {
  let service: RecNetService;
  let testOutputDir: string;
  let testAccountId: string;
  let mockPhotosController: jest.Mocked<PhotosController>;

  const createJwt = (payload: Record<string, unknown>): string => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.signature`;
  };

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
      fetchProfilePhotoHistory: jest.fn(),
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
        .mockResolvedValue({
          success: false,
          value: null,
          status: 404,
          error: 'Not Found',
        } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.downloadStats.newDownloads).toBe(1);
      expect(result.downloadStats.failedDownloads).toBe(1);
      expect(result.downloadStats.retryAttempts).toBe(3);
      expect(result.downloadResults[1].status).toBe('failed');
      expect(result.downloadResults[1].attempts).toBe(4);
      expect(mockedFs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('should retry failed downloads and recover within the retry limit', async () => {
      const photos: ImageDto[] = [createMockPhoto('photo-1', 'image1.jpg')];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === photosJsonPath) return true;
        return false;
      });

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      mockPhotosController.downloadPhoto
        .mockResolvedValueOnce({
          success: false,
          value: null,
          status: 503,
          error: 'Temporary outage',
        } as GenericResponse<ArrayBuffer>)
        .mockResolvedValueOnce({
          success: false,
          value: null,
          status: 503,
          error: 'Temporary outage',
        } as GenericResponse<ArrayBuffer>)
        .mockResolvedValueOnce({
          success: true,
          value: new ArrayBuffer(1024),
          status: 200,
        } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.downloadStats.newDownloads).toBe(1);
      expect(result.downloadStats.failedDownloads).toBe(0);
      expect(result.downloadStats.retryAttempts).toBe(2);
      expect(result.downloadStats.recoveredAfterRetry).toBe(1);
      expect(result.downloadResults[0].status).toBe('downloaded');
      expect(result.downloadResults[0].attempts).toBe(3);
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(3);
    });

    it('should stop retrying after three retries', async () => {
      const photos: ImageDto[] = [createMockPhoto('photo-1', 'image1.jpg')];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === photosJsonPath) return true;
        return false;
      });

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);
      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: false,
        value: null,
        status: 503,
        error: 'Still failing',
      } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadPhotos(testAccountId);

      expect(result.downloadStats.newDownloads).toBe(0);
      expect(result.downloadStats.failedDownloads).toBe(1);
      expect(result.downloadStats.retryAttempts).toBe(3);
      expect(result.downloadResults[0].status).toBe('failed');
      expect(result.downloadResults[0].attempts).toBe(4);
      expect(result.guidance).toEqual([
        'Some user photos could not be downloaded after 3 retries, but the download completed.',
        'You can retry the same download after it finishes to grab any missed images. Existing files are checked first, so the app will continue from what is already saved.',
        'You do not need to delete the output folder to resume.',
      ]);
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(4);
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

    it('should abort an in-flight photo request when cancelled', async () => {
      const photos: ImageDto[] = [createMockPhoto('photo-1', 'image1.jpg')];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );
      const photosDir = path.join(testOutputDir, testAccountId, 'photos');

      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === photosJsonPath) return true;
        if (p.startsWith(path.join(photosDir, 'photo-'))) return false;
        return false;
      });

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      let resolveStarted!: () => void;
      const started = new Promise<void>(resolve => {
        resolveStarted = resolve;
      });

      mockPhotosController.downloadPhoto.mockImplementation(
        async (_imageName, _cdnBase, _token, options) =>
          await new Promise<GenericResponse<ArrayBuffer>>((_, reject) => {
            resolveStarted();
            options?.signal?.addEventListener(
              'abort',
              () => reject(new Error('Operation cancelled')),
              { once: true }
            );
          })
      );

      const done = service.downloadPhotos(testAccountId);
      await started;

      expect(service.cancelCurrentOperation()).toBe(true);
      await expect(done).rejects.toThrow('Operation cancelled');
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(1);
    });

    it('should stop waiting for retry delay when cancelled', async () => {
      const photos: ImageDto[] = [createMockPhoto('photo-1', 'image1.jpg')];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === photosJsonPath) return true;
        return false;
      });

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);
      (service as any).delay.mockImplementation(function (
        this: RecNetService,
        ms: number,
        operation: unknown
      ) {
        return (RecNetService.prototype as unknown as { delay: Function }).delay.call(
          this,
          ms,
          operation
        );
      });

      mockPhotosController.downloadPhoto
        .mockResolvedValueOnce({
          success: false,
          value: null,
          status: 503,
          error: 'Temporary outage',
        } as GenericResponse<ArrayBuffer>)
        .mockResolvedValue({
          success: true,
          value: new ArrayBuffer(1024),
          status: 200,
        } as GenericResponse<ArrayBuffer>);

      const done = service.downloadPhotos(testAccountId);

      for (let i = 0; i < 20 && mockPhotosController.downloadPhoto.mock.calls.length < 1; i++) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }

      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(1);
      expect(service.cancelCurrentOperation()).toBe(true);
      await expect(done).rejects.toThrow('Operation cancelled');
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(1);
    });

    /**
     * When every parallel worker returns { status: 'cancelled' } (no rejection),
     * downloadPhotos must still reject so the UI pipeline stops instead of showing Complete.
     * After cancel, progress must not flip back to isRunning (worker finally blocks
     * must not revive a running bar).
     */
    it('should reject when cancelled after download loop starts and not revive running progress', async () => {
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
          if (p.startsWith(path.join(photosDir, 'photo-'))) return false;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      mockPhotosController.downloadPhoto.mockImplementation(
        async () =>
          ({
            success: true,
            value: new ArrayBuffer(8),
            status: 200,
          }) as GenericResponse<ArrayBuffer>
      );

      let cancelRequested = false;
      let sawCancelledState = false;
      let cancelJustEmitted = false;
      const runningAfterCancelled: Progress[] = [];

      service.on('progress-update', (prog: Progress) => {
        if (
          !cancelRequested &&
          prog.isRunning &&
          prog.total === photos.length &&
          prog.currentStep?.includes('Downloading user photos')
        ) {
          cancelRequested = true;
          service.cancelCurrentOperation();
        }
        if (!prog.isRunning && prog.currentStep === 'Cancelled') {
          sawCancelledState = true;
          cancelJustEmitted = true;
        }
        if (sawCancelledState && prog.isRunning) {
          if (!cancelJustEmitted) {
            runningAfterCancelled.push({ ...prog });
          }
          cancelJustEmitted = false;
        }
      });

      await expect(service.downloadPhotos(testAccountId)).rejects.toThrow(
        'Operation cancelled'
      );

      expect(sawCancelledState).toBe(true);
      expect(runningAfterCancelled.length).toBe(0);
    });

    it('should emit progress issues and recovery details for transient network failures', async () => {
      const photos: ImageDto[] = [createMockPhoto('photo-1', 'image1.jpg')];

      const photosJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_photos.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === photosJsonPath) return true;
        return false;
      });

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      mockPhotosController.downloadPhoto
        .mockResolvedValueOnce({
          success: false,
          value: null,
          status: 503,
          error: 'Temporary outage',
        } as GenericResponse<ArrayBuffer>)
        .mockResolvedValueOnce({
          success: true,
          value: new ArrayBuffer(1024),
          status: 200,
        } as GenericResponse<ArrayBuffer>);

      const progressEvents: Progress[] = [];
      const onProgress = (progress: Progress) => progressEvents.push({ ...progress });
      service.on('progress-update', onProgress);

      const result = await service.downloadPhotos(testAccountId);

      service.off('progress-update', onProgress);

      expect(result.downloadStats.retryAttempts).toBe(1);
      expect(result.downloadStats.recoveredAfterRetry).toBe(1);
      expect(
        progressEvents.some(
          progress =>
            progress.issueCount > 0 &&
            progress.retryAttempts > 0 &&
            progress.lastIssue?.includes('Retry 1/3 will start now.')
        )
      ).toBe(true);
      expect(
        progressEvents.some(
          progress =>
            progress.recoveredAfterRetry > 0 &&
            progress.lastIssue?.includes('Recovered image1.jpg after 1 retry.')
        )
      ).toBe(true);
    });

    /**
     * When currentOperation is replaced (simulating a new download run) while a worker
     * from the previous run is still finishing, that worker's finally must not call
     * updateProgress — otherwise the UI flashes between user and feed steps.
     */
    it('should not emit user photo progress from stale workers after currentOperation is replaced', async () => {
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
          if (p.startsWith(path.join(photosDir, 'photo-'))) return false;
          return false;
        }
      );

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      let releaseDownload: (() => void) | undefined;
      mockPhotosController.downloadPhoto.mockImplementation(
        () =>
          new Promise(resolve => {
            releaseDownload = () =>
              resolve({
                success: true,
                value: new ArrayBuffer(8),
                status: 200,
              } as GenericResponse<ArrayBuffer>);
          })
      );

      let replaced = false;
      const userPhotoProgressAfterReplace: Progress[] = [];
      const onProgress = (prog: Progress) => {
        if (
          replaced &&
          prog.currentStep?.includes('Downloading user photos')
        ) {
          userPhotoProgressAfterReplace.push({ ...prog });
        }
      };
      service.on('progress-update', onProgress);

      const done = service.downloadPhotos(testAccountId);

      for (let i = 0; i < 50 && !releaseDownload; i++) {
        await new Promise<void>(r => setImmediate(r));
      }
      expect(releaseDownload).toBeDefined();

      replaced = true;
      (service as any).currentOperation = {
        cancelled: false,
        controller: new AbortController(),
      };

      releaseDownload!();

      const result = await done;
      expect(result.downloadStats.newDownloads).toBe(1);

      service.off('progress-update', onProgress);
      expect(userPhotoProgressAfterReplace.length).toBe(0);
    });

    it('should resume after cancellation and only download missing files', async () => {
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
      const existingPhotoFiles = new Set<string>();

      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === photosJsonPath) return true;
        return existingPhotoFiles.has(p);
      });

      (mockedFs.readJson as jest.Mock).mockResolvedValue(photos);
      (mockedFs.readdir as jest.Mock).mockImplementation(async (dir: string) => {
        if (dir !== photosDir) {
          return [];
        }

        return Array.from(existingPhotoFiles)
          .filter(file => path.dirname(file) === photosDir)
          .map(file => path.basename(file));
      });
      (mockedFs.writeFile as jest.Mock).mockImplementation(async (p: string) => {
        existingPhotoFiles.add(p);
      });

      let firstRun = true;
      mockPhotosController.downloadPhoto.mockImplementation(async (_imageName) => {
        if (firstRun) {
          firstRun = false;
          service.cancelCurrentOperation();
        }

        return {
          success: true,
          value: new ArrayBuffer(1024),
          status: 200,
        } as GenericResponse<ArrayBuffer>;
      });

      await expect(service.downloadPhotos(testAccountId)).rejects.toThrow(
        'Operation cancelled'
      );

      expect(existingPhotoFiles.has(path.join(photosDir, 'photo-1.jpg'))).toBe(true);
      expect(existingPhotoFiles.has(path.join(photosDir, 'photo-2.jpg'))).toBe(false);

      mockPhotosController.downloadPhoto.mockClear();
      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: new ArrayBuffer(1024),
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      const resumed = await service.downloadPhotos(testAccountId);

      expect(resumed.downloadStats.alreadyDownloaded).toBe(1);
      expect(resumed.downloadStats.newDownloads).toBe(1);
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(1);
      expect(existingPhotoFiles.has(path.join(photosDir, 'photo-2.jpg'))).toBe(true);
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

  describe('collectPhotos metadata retries', () => {
    const createMetadataPhoto = (id: string, imageName: string): ImageDto => ({
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

    it('retries failed metadata page requests and recovers cleanly', async () => {
      const progressUpdates: Progress[] = [];
      service.on('progress-update', progress => progressUpdates.push(progress));
      jest.spyOn(service, 'fetchAndSaveBulkData').mockResolvedValue({
        accountsFetched: 0,
        roomsFetched: 0,
        eventsFetched: 0,
        imageCommentsFetched: 0,
      });
      (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);

      mockPhotosController.fetchPlayerPhotos
        .mockRejectedValueOnce(new Error('Temporary outage'))
        .mockResolvedValueOnce([createMetadataPhoto('photo-1', 'image1.jpg')]);

      const result = await service.collectPhotos(testAccountId);

      expect(result.totalPhotos).toBe(1);
      expect(mockPhotosController.fetchPlayerPhotos).toHaveBeenCalledTimes(2);
      expect(
        progressUpdates.some(progress =>
          progress.lastIssue?.includes(
            'Issue collecting user photos page 1: Temporary outage. Retry 1/3 will start now.'
          )
        )
      ).toBe(true);
      expect(
        progressUpdates.some(progress =>
          progress.lastIssue?.includes(
            'Recovered user photos page 1 after 1 retry. Metadata collection is continuing.'
          )
        )
      ).toBe(true);
    });

    it('fails metadata collection after exhausting retries', async () => {
      jest.spyOn(service, 'fetchAndSaveBulkData').mockResolvedValue({
        accountsFetched: 0,
        roomsFetched: 0,
        eventsFetched: 0,
        imageCommentsFetched: 0,
      });
      (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);
      mockPhotosController.fetchPlayerPhotos.mockRejectedValue(
        new Error('Temporary outage')
      );

      await expect(service.collectPhotos(testAccountId)).rejects.toThrow(
        'Failed to collect user photos page 1 after 3 retries: Temporary outage'
      );
      expect(mockPhotosController.fetchPlayerPhotos).toHaveBeenCalledTimes(4);
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

    it('should retry feed photo downloads before failing', async () => {
      const feedPhotos: ImageDto[] = [createMockFeedPhoto('feed-1', 'feed1.jpg')];

      const feedJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_feed.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === feedJsonPath) return true;
        return false;
      });

      (mockedFs.readJson as jest.Mock).mockResolvedValue(feedPhotos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);
      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: false,
        value: null,
        status: 500,
        error: 'CDN failure',
      } as GenericResponse<ArrayBuffer>);

      const result = await service.downloadFeedPhotos(testAccountId);

      expect(result.downloadStats.failedDownloads).toBe(1);
      expect(result.downloadStats.retryAttempts).toBe(3);
      expect(result.downloadResults[0].attempts).toBe(4);
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(4);
    });

    it('should stop the whole feed download when the disk is full', async () => {
      service.updateSettings({
        outputRoot: testOutputDir,
        maxConcurrentDownloads: 1,
      });

      const feedPhotos: ImageDto[] = [
        createMockFeedPhoto('feed-1', 'feed1.jpg'),
        createMockFeedPhoto('feed-2', 'feed2.jpg'),
      ];

      const feedJsonPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_feed.json`
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === feedJsonPath) return true;
        return false;
      });

      (mockedFs.readJson as jest.Mock).mockResolvedValue(feedPhotos);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      const diskFullError = Object.assign(
        new Error('ENOSPC: no space left on device'),
        { code: 'ENOSPC' }
      );
      (mockedFs.writeFile as jest.Mock)
        .mockRejectedValueOnce(diskFullError)
        .mockResolvedValue(undefined);

      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: new ArrayBuffer(1024),
        status: 200,
      } as GenericResponse<ArrayBuffer>);

      await expect(service.downloadFeedPhotos(testAccountId)).rejects.toThrow(
        /no space left on your disk/i
      );
      expect(mockedFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(1);
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

    it('should reject when cancelled flag is set before feed download starts', async () => {
      (service as unknown as { currentOperation: { cancelled: boolean } }).currentOperation =
        { cancelled: true };

      await expect(service.downloadFeedPhotos(testAccountId)).rejects.toThrow(
        'Operation cancelled'
      );
    });
  });

  describe('validateProfileHistoryAccess', () => {
    it('rejects malformed JWT tokens', async () => {
      await expect(
        service.validateProfileHistoryAccess('test-user', 'not-a-jwt')
      ).rejects.toThrow('Token is invalid or could not be parsed.');
    });

    it('rejects expired JWT tokens', async () => {
      const expiredToken = createJwt({
        sub: testAccountId,
        exp: Math.floor(Date.now() / 1000) - 60,
      });

      await expect(
        service.validateProfileHistoryAccess('test-user', expiredToken)
      ).rejects.toThrow('Token has expired.');
    });

    it('rejects when the username cannot be resolved', async () => {
      const token = createJwt({
        sub: testAccountId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const mockAccountsController = (
        service as unknown as {
          accountsController: { lookupAccountByUsername: jest.Mock };
        }
      ).accountsController;

      mockAccountsController.lookupAccountByUsername.mockRejectedValue(
        new Error('HTTP 404: Not found')
      );

      await expect(
        service.validateProfileHistoryAccess('missing-user', token)
      ).rejects.toThrow('Failed to lookup account by username: HTTP 404: Not found');
    });

    it('rejects when the token belongs to a different user', async () => {
      const token = createJwt({
        sub: 'someone-else',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const mockAccountsController = (
        service as unknown as {
          accountsController: { lookupAccountByUsername: jest.Mock };
        }
      ).accountsController;

      mockAccountsController.lookupAccountByUsername.mockResolvedValue({
        accountId: testAccountId,
        username: 'test-user',
        displayName: 'Test User',
      });

      await expect(
        service.validateProfileHistoryAccess('test-user', token)
      ).rejects.toThrow('Token does not belong to this user.');
    });

    it('validates matching tokens and confirms profile history access', async () => {
      const token = createJwt({
        sub: testAccountId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const mockAccountsController = (
        service as unknown as {
          accountsController: { lookupAccountByUsername: jest.Mock };
        }
      ).accountsController;

      mockAccountsController.lookupAccountByUsername.mockResolvedValue({
        accountId: testAccountId,
        username: 'test-user',
        displayName: 'Test User',
      });
      mockPhotosController.fetchProfilePhotoHistory.mockResolvedValue([]);

      const result = await service.validateProfileHistoryAccess(
        'test-user',
        token
      );

      expect(result).toEqual({
        accountId: testAccountId,
        username: 'test-user',
        tokenAccountId: testAccountId,
      });
      expect(mockPhotosController.fetchProfilePhotoHistory).toHaveBeenCalledWith(
        token
      );
    });
  });

  describe('profile history preflight and download', () => {
    const createProfileHistoryEntry = (id: number, imageName: string) => ({
      Id: id,
      Type: 4,
      Accessibility: 0,
      AccessibilityLocked: false,
      ImageName: imageName,
      Description: null,
      PlayerId: 256147,
      TaggedPlayerIds: [],
      RoomId: 517859,
      PlayerEventId: null,
      CreatedAt: new Date().toISOString(),
      CheerCount: 0,
      CommentCount: 0,
    });

    it('collects the manifest before downloading profile history images', async () => {
      const historyPayload = [
        createProfileHistoryEntry(85498573, 'avatar1.jpg'),
        createProfileHistoryEntry(85498574, 'avatar2.jpg'),
      ];
      const manifestPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_profile_history.json`
      );

      mockPhotosController.fetchProfilePhotoHistory.mockResolvedValue(historyPayload);
      (mockedFs.pathExists as jest.Mock).mockResolvedValue(false);

      const result = await service.collectProfileHistoryManifest(
        testAccountId,
        'token'
      );

      expect(result.saved).toBe(manifestPath);
      expect(result.totalPhotos).toBe(2);
      expect(mockedFs.writeJson).toHaveBeenCalledWith(
        manifestPath,
        historyPayload,
        { spaces: 2 }
      );
    });

    it('downloads profile history images from an existing manifest', async () => {
      const historyPayload = [
        createProfileHistoryEntry(85498573, 'avatar1.jpg'),
        createProfileHistoryEntry(85498574, 'avatar2.jpg'),
      ];
      const profileHistoryDir = path.join(
        testOutputDir,
        testAccountId,
        'profile-history'
      );
      const manifestPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_profile_history.json`
      );

      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: true,
        value: new ArrayBuffer(512),
        status: 200,
      } as GenericResponse<ArrayBuffer>);
      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === manifestPath) {
          return true;
        }
        return false;
      });
      (mockedFs.readJson as jest.Mock).mockResolvedValue(historyPayload);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      const result = await service.downloadProfileHistory(testAccountId, 'token');

      expect(result.profileHistoryDirectory).toBe(profileHistoryDir);
      expect(result.profileHistoryManifestPath).toBe(manifestPath);
      expect(result.downloadStats.newDownloads).toBe(2);
      expect(mockedFs.writeFile).toHaveBeenCalledTimes(2);
      expect(mockPhotosController.fetchProfilePhotoHistory).not.toHaveBeenCalled();
    });

    it('skips already-downloaded profile history images on rerun', async () => {
      const historyPayload = [createProfileHistoryEntry(85498573, 'avatar1.jpg')];
      const manifestPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_profile_history.json`
      );
      const existingPhotoPath = path.join(
        testOutputDir,
        testAccountId,
        'profile-history',
        '85498573.jpg'
      );

      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === manifestPath) {
          return true;
        }
        if (p === existingPhotoPath) {
          return true;
        }
        return false;
      });
      (mockedFs.readJson as jest.Mock).mockResolvedValue(historyPayload);
      (mockedFs.readdir as jest.Mock).mockResolvedValue(['85498573.jpg']);

      const result = await service.downloadProfileHistory(testAccountId, 'token');

      expect(result.downloadStats.alreadyDownloaded).toBe(1);
      expect(result.downloadStats.newDownloads).toBe(0);
      expect(mockPhotosController.downloadPhoto).not.toHaveBeenCalled();
    });

    it('retries failed profile history downloads before reporting failure', async () => {
      const historyPayload = [createProfileHistoryEntry(85498573, 'avatar1.jpg')];
      const manifestPath = path.join(
        testOutputDir,
        testAccountId,
        `${testAccountId}_profile_history.json`
      );

      mockPhotosController.downloadPhoto.mockResolvedValue({
        success: false,
        value: null,
        status: 500,
        error: 'CDN failure',
      } as GenericResponse<ArrayBuffer>);
      (mockedFs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === manifestPath) {
          return true;
        }
        return false;
      });
      (mockedFs.readJson as jest.Mock).mockResolvedValue(historyPayload);
      (mockedFs.readdir as jest.Mock).mockResolvedValue([]);

      const result = await service.downloadProfileHistory(testAccountId, 'token');

      expect(result.downloadStats.failedDownloads).toBe(1);
      expect(result.downloadStats.retryAttempts).toBe(3);
      expect(result.downloadResults[0].attempts).toBe(4);
      expect(result.guidance?.[0]).toContain('profile picture history images');
      expect(mockPhotosController.downloadPhoto).toHaveBeenCalledTimes(4);
    });

    it('rejects when no token is provided', async () => {
      await expect(
        service.downloadProfileHistory(testAccountId, '')
      ).rejects.toThrow('Profile picture history requires a valid access token.');
    });

    it('rejects unauthorized manifest collection requests', async () => {
      mockPhotosController.fetchProfilePhotoHistory.mockRejectedValue(
        new Error('HTTP 401: Unauthorized')
      );

      await expect(
        service.collectProfileHistoryManifest(testAccountId, 'token')
      ).rejects.toThrow('HTTP 401: Unauthorized');
    });
  });
});
