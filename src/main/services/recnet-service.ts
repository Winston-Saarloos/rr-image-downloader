import { AxiosRequestConfig } from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as os from 'os';
import {
  RecNetSettings,
  Progress,
  CollectionResult,
  DownloadResult,
  Photo,
  IterationDetail,
  DownloadResultItem,
  DownloadStats,
  AccountInfo,
  BulkDataRefreshOptions,
} from '../../shared/types';
import { GenericResponse } from '../models/GenericResponse';
import { axiosRequest } from '../utils/axiosRequest';
import { Event } from '../models/Event';

interface CurrentOperation {
  cancelled: boolean;
}

export class RecNetService extends EventEmitter {
  private settingsPath: string;
  private settings: RecNetSettings;
  private currentOperation: CurrentOperation | null = null;
  private progress: Progress;

  constructor() {
    super();
    this.settingsPath = path.join(
      os.homedir(),
      '.recnet-photo-downloader',
      'settings.json'
    );
    this.settings = {
      outputRoot: 'output',
      cdnBase: 'https://img.rec.net/',
      globalMaxConcurrentDownloads: 1,
      interPageDelayMs: 500,
    };
    this.progress = {
      isRunning: false,
      currentStep: '',
      progress: 0,
      total: 0,
      current: 0,
    };

    // Load settings from disk
    this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    try {
      if (await fs.pathExists(this.settingsPath)) {
        const savedSettings = await fs.readJson(this.settingsPath);
        this.settings = { ...this.settings, ...savedSettings };
        console.log('Settings loaded from disk:', this.settings);
      }
    } catch (error) {
      console.log('Failed to load settings:', (error as Error).message);
    }
    // Ensure output directory exists
    this.ensureOutputDirectory();
  }

  async saveSettings(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.settingsPath));
      await fs.writeJson(this.settingsPath, this.settings, { spaces: 2 });
      console.log('Settings saved to disk:', this.settings);
    } catch (error) {
      console.log('Failed to save settings:', (error as Error).message);
    }
  }

  private ensureOutputDirectory(): void {
    fs.ensureDirSync(this.settings.outputRoot);
  }

  getSettings(): RecNetSettings {
    return { ...this.settings };
  }

  async updateSettings(
    newSettings: Partial<RecNetSettings>
  ): Promise<RecNetSettings> {
    this.settings = { ...this.settings, ...newSettings };
    this.ensureOutputDirectory();
    await this.saveSettings();
    return this.settings;
  }

  getProgress(): Progress {
    return { ...this.progress };
  }

  private updateProgress(
    step: string,
    current: number,
    total: number,
    progress?: number
  ): void {
    this.progress = {
      isRunning: true,
      currentStep: step,
      current,
      total,
      progress: progress || (total > 0 ? (current / total) * 100 : 0),
    };
    this.emit('progress-update', this.progress);
  }

  private setOperationComplete(): void {
    this.progress = {
      isRunning: false,
      currentStep: 'Complete',
      current: 0,
      total: 0,
      progress: 100,
    };
    this.emit('progress-update', this.progress);
  }

  cancelCurrentOperation(): boolean {
    if (this.currentOperation) {
      this.currentOperation.cancelled = true;
      this.setOperationComplete();
      return true;
    }
    return false;
  }

  async collectPhotos(
    accountId: string,
    token?: string,
    options?: BulkDataRefreshOptions
  ): Promise<CollectionResult> {
    this.currentOperation = { cancelled: false };
    const {
      forceAccountsRefresh = false,
      forceRoomsRefresh = false,
      forceEventsRefresh = false,
    } = options || {};

    try {
      this.updateProgress('Downloading user photo data...', 0, 0, 0);

      const all: Photo[] = [];
      let skip = 0;
      let totalFetched = 0;
      const iterationDetails: IterationDetail[] = [];

      // Create account-specific directory
      const accountDir = path.join(this.settings.outputRoot, accountId);
      console.log(`Using output root: ${this.settings.outputRoot}`);
      console.log(`Creating account directory: ${accountDir}`);
      await fs.ensureDir(accountDir);
      console.log(`Account directory created successfully`);

      // Check for existing photos file
      const jsonPath = path.join(accountDir, `${accountId}_photos.json`);
      let lastSortValue: string | undefined = undefined;
      let existingPhotoCount = 0;

      console.log(`Looking for existing photos file at: ${jsonPath}`);

      // Check for old file in root directory and migrate it
      const oldJsonPath = path.join(
        this.settings.outputRoot,
        `${accountId}_photos.json`
      );
      if (await fs.pathExists(oldJsonPath)) {
        console.log(
          `Found old photos file at: ${oldJsonPath}, migrating to: ${jsonPath}`
        );
        const oldData = await fs.readJson(oldJsonPath);
        await fs.writeJson(jsonPath, oldData, {
          spaces: 2,
        });
        console.log(`Migration completed`);

        // Remove the old file after successful migration
        try {
          await fs.remove(oldJsonPath);
          console.log(`Removed old file: ${oldJsonPath}`);
        } catch (error) {
          console.log(
            `Warning: Could not remove old file: ${(error as Error).message}`
          );
        }
      }

      if (await fs.pathExists(jsonPath)) {
        console.log(`Found existing photos file at: ${jsonPath}`);
        try {
          const existingJson: Photo[] = await fs.readJson(jsonPath);
          if (existingJson && existingJson.length > 0) {
            existingPhotoCount = existingJson.length;

            // Find the newest photo's sort value
            for (const photo of existingJson) {
              if (photo.sort) {
                const currentSort = photo.sort;
                if (!lastSortValue || currentSort > lastSortValue) {
                  lastSortValue = currentSort;
                }
              }
            }

            all.push(...existingJson);
            iterationDetails.push({
              note: 'resumed_from_existing_file',
              existingPhotos: existingPhotoCount,
              lastSortValue,
            });
          }
        } catch (error) {
          iterationDetails.push({
            note: 'existing_file_read_failed',
            error: (error as Error).message,
          });
        }
      }

      // Collect photos in pages
      let iteration = 0;
      let isIncrementalMode = false;

      // If we have existing data, optimize by starting from the end (newest photos)
      if (lastSortValue && existingPhotoCount > 0) {
        isIncrementalMode = true;
        console.log(
          `Incremental mode: checking for new photos after existing ${existingPhotoCount} photos`
        );
        console.log(
          `Starting from newest photos (after sort value: ${lastSortValue})`
        );
      } else {
        console.log(`Full collection mode: fetching all photos from beginning`);
      }

      while (true) {
        if (this.currentOperation.cancelled) {
          throw new Error('Operation cancelled');
        }

        const modeText = isIncrementalMode ? ' (incremental)' : '';
        this.updateProgress(
          `Fetching page ${iteration + 1}${modeText}...`,
          iteration,
          0 // Total unknown since we loop until done
        );

        let url = `https://apim.rec.net/apis/api/images/v4/player/${encodeURIComponent(
          accountId
        )}?skip=${skip}&take=${150}&sort=2`;

        if (lastSortValue) {
          url += `&after=${encodeURIComponent(lastSortValue)}`;
        }

        const photos = await this.requestOrThrow<Photo[]>(
          { url, method: 'GET' },
          token
        );
        if (!Array.isArray(photos)) {
          throw new Error('Unexpected response format: expected array');
        }

        let newPhotosAdded = 0;
        let newestSortValue: string | undefined = undefined;

        for (const photo of photos) {
          if (this.currentOperation.cancelled) {
            throw new Error('Operation cancelled');
          }

          let shouldAdd = true;

          // Check if photo already exists by ID
          const photoId = this.normalizeId(photo.Id);
          if (photoId) {
            for (const existingPhoto of all) {
              if (this.normalizeId(existingPhoto.Id) === photoId) {
                shouldAdd = false;
                break;
              }
            }
          }

          // Also check by sort value for additional safety
          if (shouldAdd && lastSortValue && photo.sort) {
            if (photo.sort <= lastSortValue) {
              shouldAdd = false;
            }
          }

          if (shouldAdd) {
            all.push(photo);
            newPhotosAdded++;
          }

          if (
            photo.sort &&
            (!newestSortValue || photo.sort > newestSortValue)
          ) {
            newestSortValue = photo.sort;
          }
        }

        totalFetched += photos.length;

        iterationDetails.push({
          iteration: iteration + 1,
          url,
          skip,
          take: 150,
          itemsReceived: photos.length,
          newPhotosAdded,
          totalSoFar: totalFetched,
          totalInCollection: all.length,
          newestSortValue,
          incrementalMode: !!lastSortValue,
        });

        // In incremental mode, if we found no new photos, we can stop early
        if (isIncrementalMode && newPhotosAdded === 0 && photos.length > 0) {
          console.log(
            `No new photos found in incremental check, stopping early`
          );
          break;
        }

        if (photos.length < 150) {
          // No more photos available
          break;
        }

        skip += 150;
        iteration++;

        if (this.settings.interPageDelayMs > 0) {
          await this.delay(this.settings.interPageDelayMs);
        }
      }

      // Save updated collection
      await fs.ensureDir(path.dirname(jsonPath));
      console.log(`Saving photos metadata to: ${jsonPath}`);
      await fs.writeJson(jsonPath, all, {
        spaces: 2,
      });
      console.log(`Photos metadata saved successfully`);

      const totalNewPhotosAdded = all.length - existingPhotoCount;

      // Fetch and save bulk account and room data (from photos + any existing feed)
      try {
        this.updateProgress(
          'Fetching account, room, and event data...',
          0,
          0,
          0
        );

        let combinedForMetadata: Photo[] = [...all];
        const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);
        if (await fs.pathExists(feedJsonPath)) {
          try {
            const feedPhotos: Photo[] = await fs.readJson(feedJsonPath);
            combinedForMetadata = combinedForMetadata.concat(feedPhotos);
          } catch (error) {
            console.log(
              `Warning: Failed to read feed photos for metadata merge: ${(error as Error).message}`
            );
          }
        }

        const bulkData = await this.fetchAndSaveBulkData(
          accountId,
          combinedForMetadata,
          token,
          { forceAccountsRefresh, forceRoomsRefresh, forceEventsRefresh }
        );
        console.log(
          `Fetched ${bulkData.accountsFetched} accounts, ${bulkData.roomsFetched} rooms, and ${bulkData.eventsFetched} events`
        );
      } catch (error) {
        console.log(
          `Warning: Failed to fetch bulk data: ${(error as Error).message}`
        );
        // Don't fail the entire operation if bulk fetch fails
      }

      this.setOperationComplete();

      return {
        accountId,
        saved: jsonPath,
        existingPhotos: existingPhotoCount,
        totalNewPhotosAdded,
        totalPhotos: all.length,
        totalFetched,
        pageSize: 150,
        delayMs: this.settings.interPageDelayMs,
        iterationsCompleted: iterationDetails.length,
        lastSortValue,
        incrementalMode: !!lastSortValue,
        iterationDetails,
      };
    } catch (error) {
      this.setOperationComplete();
      throw error;
    }
  }

  async collectFeedPhotos(
    accountId: string,
    token?: string,
    incremental = true,
    options?: BulkDataRefreshOptions
  ): Promise<CollectionResult> {
    this.currentOperation = { cancelled: false };
    const {
      forceAccountsRefresh = false,
      forceRoomsRefresh = false,
      forceEventsRefresh = false,
    } = options || {};

    try {
      this.updateProgress('Downloading user feed data...', 0, 0, 0);

      const accountDir = path.join(this.settings.outputRoot, accountId);
      console.log(`Creating account directory for feed: ${accountDir}`);
      await fs.ensureDir(accountDir);
      console.log(`Account directory for feed created successfully`);

      const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);
      const all: Photo[] = [];
      let skip = 0;
      let totalFetched = 0;
      const iterationDetails: IterationDetail[] = [];

      // Check for old feed file in root directory and migrate it
      const oldFeedJsonPath = path.join(
        this.settings.outputRoot,
        `${accountId}_feed.json`
      );
      if (await fs.pathExists(oldFeedJsonPath)) {
        console.log(
          `Found old feed file at: ${oldFeedJsonPath}, migrating to: ${feedJsonPath}`
        );
        const oldFeedData = await fs.readJson(oldFeedJsonPath);
        await fs.writeJson(feedJsonPath, oldFeedData, { spaces: 2 });
        console.log(`Feed migration completed`);

        // Remove the old file after successful migration
        try {
          await fs.remove(oldFeedJsonPath);
          console.log(`Removed old feed file: ${oldFeedJsonPath}`);
        } catch (error) {
          console.log(
            `Warning: Could not remove old feed file: ${(error as Error).message}`
          );
        }
      }

      // Check for existing feed file
      let existingPhotoCount = 0;
      let lastSince: Date | undefined = undefined;

      if (await fs.pathExists(feedJsonPath)) {
        try {
          const existingPhotos: Photo[] = await fs.readJson(feedJsonPath);
          if (existingPhotos && existingPhotos.length > 0) {
            existingPhotoCount = existingPhotos.length;

            // Find the oldest photo's CreatedAt
            for (const photo of existingPhotos) {
              if (photo.CreatedAt) {
                const createdAt = new Date(photo.CreatedAt);
                if (!lastSince || createdAt < lastSince) {
                  lastSince = createdAt;
                }
              }
            }

            all.push(...existingPhotos);
            iterationDetails.push({
              note: 'resumed_from_existing_feed_file',
              existingPhotos: existingPhotoCount,
              oldestPhotoDate: lastSince?.toISOString(),
            });
          }
        } catch (error) {
          iterationDetails.push({
            note: 'existing_feed_file_read_failed',
            error: (error as Error).message,
          });
        }
      }

      // Determine the since parameter
      let sinceTime: Date;
      if (incremental && lastSince) {
        sinceTime = lastSince;
        iterationDetails.push({
          note: 'incremental_mode_using_oldest_photo_date',
          sinceTime: sinceTime.toISOString(),
          incremental: true,
        });
      } else {
        sinceTime = new Date();
        iterationDetails.push({
          note: 'full_collection_mode_using_current_time',
          sinceTime: sinceTime.toISOString(),
          incremental: false,
        });
      }

      // Collect feed photos
      let iteration = 0;
      while (true) {
        if (this.currentOperation.cancelled) {
          throw new Error('Operation cancelled');
        }

        this.updateProgress(
          `Fetching feed page ${iteration + 1}...`,
          iteration,
          0 // Total unknown since we loop until done
        );

        const sinceParam = sinceTime.toISOString();
        const url = `https://apim.rec.net/apis/api/images/v3/feed/player/${encodeURIComponent(
          accountId
        )}?skip=${skip}&take=${150}&since=${encodeURIComponent(sinceParam)}`;

        const photos = await this.requestOrThrow<Photo[]>(
          { url, method: 'GET' },
          token
        );
        if (!Array.isArray(photos)) {
          throw new Error('Unexpected response format: expected array');
        }

        let newPhotosAdded = 0;
        let newestCreatedAt: Date | undefined = undefined;

        for (const photo of photos) {
          if (this.currentOperation.cancelled) {
            throw new Error('Operation cancelled');
          }

          let shouldAdd = true;
          const photoId = this.normalizeId(photo.Id);
          if (photoId) {
            // Check if this photo already exists
            for (const existingPhoto of all) {
              if (this.normalizeId(existingPhoto.Id) === photoId) {
                shouldAdd = false;
                break;
              }
            }
          }

          if (shouldAdd) {
            all.push(photo);
            newPhotosAdded++;
          }

          if (photo.CreatedAt) {
            const createdAt = new Date(photo.CreatedAt);
            if (!newestCreatedAt || createdAt > newestCreatedAt) {
              newestCreatedAt = createdAt;
            }
          }
        }

        totalFetched += photos.length;

        iterationDetails.push({
          iteration: iteration + 1,
          url,
          skip,
          take: 150,
          since: sinceParam,
          itemsReceived: photos.length,
          newPhotosAdded,
          totalSoFar: totalFetched,
          totalInCollection: all.length,
          newestCreatedAt: newestCreatedAt?.toISOString(),
          incrementalMode: existingPhotoCount > 0,
        });

        if (photos.length < 150) {
          // No more photos available
          break;
        }

        skip += 150;
        iteration++;

        if (this.settings.interPageDelayMs > 0) {
          await this.delay(this.settings.interPageDelayMs);
        }
      }

      // Save updated feed collection
      await fs.writeJson(feedJsonPath, all, {
        spaces: 2,
      });

      const totalNewPhotosAdded = all.length - existingPhotoCount;

      // Fetch and save bulk account and room data (feed + any existing photos)
      try {
        this.updateProgress(
          'Fetching feed account, room, and event data...',
          0,
          0,
          0
        );

        let combinedForMetadata: Photo[] = [...all];
        const photosJsonPath = path.join(
          accountDir,
          `${accountId}_photos.json`
        );
        if (await fs.pathExists(photosJsonPath)) {
          try {
            const photoMetadata: Photo[] = await fs.readJson(photosJsonPath);
            combinedForMetadata = combinedForMetadata.concat(photoMetadata);
          } catch (error) {
            console.log(
              `Warning: Failed to read photos metadata for feed merge: ${(error as Error).message}`
            );
          }
        }

        const bulkData = await this.fetchAndSaveBulkData(
          accountId,
          combinedForMetadata,
          token,
          { forceAccountsRefresh, forceRoomsRefresh, forceEventsRefresh }
        );
        console.log(
          `Fetched (feed) ${bulkData.accountsFetched} accounts, ${bulkData.roomsFetched} rooms, and ${bulkData.eventsFetched} events`
        );
      } catch (error) {
        console.log(
          `Warning: Failed to fetch bulk data from feed collection: ${(error as Error).message}`
        );
      }

      this.setOperationComplete();

      return {
        accountId,
        saved: feedJsonPath,
        existingPhotos: existingPhotoCount,
        totalNewPhotosAdded,
        totalPhotos: all.length,
        totalFetched,
        pageSize: 150,
        delayMs: this.settings.interPageDelayMs,
        iterationsCompleted: iterationDetails.length,
        sinceTime: sinceTime.toISOString(),
        incrementalMode: existingPhotoCount > 0,
        incremental,
        iterationDetails,
      };
    } catch (error) {
      this.setOperationComplete();
      throw error;
    }
  }

  async downloadPhotos(accountId: string): Promise<DownloadResult> {
    this.currentOperation = { cancelled: false };

    try {
      this.updateProgress('Downloading user photos...', 0, 0, 0);
      const accountDir = path.join(this.settings.outputRoot, accountId);
      const jsonPath = path.join(accountDir, `${accountId}_photos.json`);

      console.log(`Looking for photos metadata at: ${jsonPath}`);
      if (!(await fs.pathExists(jsonPath))) {
        console.log(`Photos metadata file not found at: ${jsonPath}`);
        throw new Error('Photos not collected. Run collect photos first.');
      }
      console.log(`Found photos metadata file at: ${jsonPath}`);

      const photosDir = path.join(accountDir, 'photos');
      const feedDir = path.join(accountDir, 'feed');
      await fs.ensureDir(photosDir);
      await fs.ensureDir(feedDir);

      const photos: Photo[] = await fs.readJson(jsonPath);
      if (!photos || photos.length === 0) {
        throw new Error('No photos found in the JSON file.');
      }

      const sortedPhotos = [...photos].sort((a, b) => {
        const timeA = a.CreatedAt
          ? new Date(a.CreatedAt).getTime()
          : Number.MAX_SAFE_INTEGER;
        const timeB = b.CreatedAt
          ? new Date(b.CreatedAt).getTime()
          : Number.MAX_SAFE_INTEGER;
        if (timeA !== timeB) return timeA - timeB;
        return this.compareIds(a.Id, b.Id);
      });

      const totalPhotos = sortedPhotos.length;
      const maxPhotosToDownload = this.settings.maxPhotosToDownload;
      const hasDownloadLimit =
        typeof maxPhotosToDownload === 'number' && maxPhotosToDownload > 0;
      const existingPhotoFiles = (await fs.readdir(photosDir)).filter(file =>
        file.toLowerCase().endsWith('.jpg')
      ).length;
      let remainingDownloadSlots = hasDownloadLimit
        ? Math.max(0, maxPhotosToDownload - existingPhotoFiles)
        : undefined;
      const decrementRemainingSlots = () => {
        if (remainingDownloadSlots === undefined) return;
        if (remainingDownloadSlots > 0) {
          remainingDownloadSlots--;
        }
      };
      if (hasDownloadLimit && remainingDownloadSlots === 0) {
        console.log(
          `Skipping photo downloads: limit ${maxPhotosToDownload} reached by existing files (${existingPhotoFiles})`
        );
        this.updateProgress(
          'Download limit reached for photos',
          totalPhotos,
          totalPhotos,
          100
        );
        this.setOperationComplete();
        return {
          accountId,
          photosDirectory: photosDir,
          processedCount: 0,
          downloadStats: {
            totalPhotos,
            alreadyDownloaded: existingPhotoFiles,
            newDownloads: 0,
            failedDownloads: 0,
            skipped: totalPhotos,
          },
          downloadResults: [],
          totalResults: 0,
        };
      }
      console.log(
        `Starting download of ${totalPhotos} photos from ${jsonPath}`
      );
      if (hasDownloadLimit && remainingDownloadSlots !== undefined) {
        console.log(
          `Limiting downloads to ${remainingDownloadSlots} photos for testing`
        );
      }
      let alreadyDownloaded = 0;
      let newDownloads = 0;
      let failedDownloads = 0;
      let skipped = 0;
      const downloadResults: DownloadResultItem[] = [];
      const rateLimitMs = 1000;
      let processedCount = 0;

      this.updateProgress('Downloading user photos...', 0, totalPhotos, 0);

      for (const photo of sortedPhotos) {
        if (this.currentOperation.cancelled) {
          throw new Error('Operation cancelled');
        }

        const photoId = this.normalizeId(photo.Id);
        const imageName = photo.ImageName;
        const photoUrl = `https://img.rec.net/${imageName}`;

        if (!photoId || !imageName) {
          downloadResults.push({
            error: 'invalid_photo_data',
            photoId,
            imageName,
            photo: JSON.stringify(photo),
          });
          processedCount++;
          continue;
        }

        const photoPath = path.join(photosDir, `${photoId}.jpg`);

        // Check if photo already exists
        if (await fs.pathExists(photoPath)) {
          alreadyDownloaded++;
          downloadResults.push({
            photoId,
            status: 'already_exists_in_photos',
            path: photoPath,
          });
          processedCount++;
          continue;
        }

        // Check if photo exists in feed folder and copy it
        const feedPhotoPath = path.join(feedDir, `${photoId}.jpg`);
        if (await fs.pathExists(feedPhotoPath)) {
          await fs.copy(feedPhotoPath, photoPath);
          alreadyDownloaded++;
          decrementRemainingSlots();
          downloadResults.push({
            photoId,
            status: 'copied_from_feed',
            sourcePath: feedPhotoPath,
            destinationPath: photoPath,
          });
          processedCount++;
          continue;
        }

        // If we've hit the limit (including existing photos), skip any further downloads
        if (
          remainingDownloadSlots !== undefined &&
          remainingDownloadSlots <= 0
        ) {
          skipped++;
          downloadResults.push({
            photoId,
            status: 'skipped_limit_reached',
            url: photoUrl,
          });
          processedCount++;
          continue;
        }

        // Check if we've reached the download limit (only for new downloads)
        try {
          const response = await this.sendRequest<ArrayBuffer>({
            url: photoUrl,
            method: 'GET',
            responseType: 'arraybuffer',
          });
          if (response.success && response.value) {
            const data = Buffer.from(response.value);
            await fs.writeFile(photoPath, data);
            newDownloads++;
            decrementRemainingSlots();
            downloadResults.push({
              photoId,
              status: 'downloaded',
              size: data.length,
              path: photoPath,
              url: photoUrl,
            });
          } else {
            failedDownloads++;
            downloadResults.push({
              photoId,
              status: 'failed',
              statusCode: response.status,
              reason: (response.message || response.error) ?? undefined,
              url: photoUrl,
            });
          }
        } catch (error) {
          failedDownloads++;
          downloadResults.push({
            photoId,
            status: 'error',
            error: (error as Error).message,
            url: photoUrl,
          });
        }

        // Rate limiting
        if (rateLimitMs > 0) {
          await this.delay(rateLimitMs);
        }

        processedCount++;
        this.updateProgress(
          'Downloading photos...',
          processedCount,
          totalPhotos
        );
      }

      this.setOperationComplete();

      const downloadStats: DownloadStats = {
        totalPhotos,
        alreadyDownloaded,
        newDownloads,
        failedDownloads,
        skipped,
      };

      return {
        accountId,
        photosDirectory: photosDir,
        processedCount,
        downloadStats,
        downloadResults,
        totalResults: downloadResults.length,
      };
    } catch (error) {
      this.setOperationComplete();
      throw error;
    }
  }

  async downloadFeedPhotos(accountId: string): Promise<DownloadResult> {
    this.currentOperation = { cancelled: false };

    try {
      this.updateProgress('Downloading feed photos...', 0, 0, 0);
      const accountDir = path.join(this.settings.outputRoot, accountId);
      const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);

      if (!(await fs.pathExists(feedJsonPath))) {
        throw new Error(
          'Feed photos not collected. Run collect feed photos first.'
        );
      }

      const feedPhotosDir = path.join(accountDir, 'feed');
      const photosDir = path.join(accountDir, 'photos');
      await fs.ensureDir(feedPhotosDir);
      await fs.ensureDir(photosDir);

      const photos: Photo[] = await fs.readJson(feedJsonPath);
      if (!photos || photos.length === 0) {
        throw new Error('No feed photos found in the JSON file.');
      }

      const sortedPhotos = [...photos].sort((a, b) => {
        const timeA = a.CreatedAt
          ? new Date(a.CreatedAt).getTime()
          : Number.MAX_SAFE_INTEGER;
        const timeB = b.CreatedAt
          ? new Date(b.CreatedAt).getTime()
          : Number.MAX_SAFE_INTEGER;
        if (timeA !== timeB) return timeA - timeB;
        return this.compareIds(a.Id, b.Id);
      });

      const totalPhotos = sortedPhotos.length;
      const maxPhotosToDownload = this.settings.maxPhotosToDownload;
      const hasDownloadLimit =
        typeof maxPhotosToDownload === 'number' && maxPhotosToDownload > 0;
      const existingFeedFiles = (await fs.readdir(feedPhotosDir)).filter(file =>
        file.toLowerCase().endsWith('.jpg')
      ).length;
      let remainingDownloadSlots = hasDownloadLimit
        ? Math.max(0, maxPhotosToDownload - existingFeedFiles)
        : undefined;
      const decrementRemainingSlots = () => {
        if (remainingDownloadSlots === undefined) return;
        if (remainingDownloadSlots > 0) {
          remainingDownloadSlots--;
        }
      };
      if (hasDownloadLimit && remainingDownloadSlots === 0) {
        console.log(
          `Skipping feed photo downloads: limit ${maxPhotosToDownload} reached by existing files (${existingFeedFiles})`
        );
        this.updateProgress(
          'Download limit reached for feed photos',
          totalPhotos,
          totalPhotos,
          100
        );
        this.setOperationComplete();
        return {
          accountId,
          feedPhotosDirectory: feedPhotosDir,
          processedCount: 0,
          downloadStats: {
            totalPhotos,
            alreadyDownloaded: existingFeedFiles,
            newDownloads: 0,
            failedDownloads: 0,
            skipped: totalPhotos,
          },
          downloadResults: [],
          totalResults: 0,
        };
      }
      console.log(
        `Starting download of ${totalPhotos} feed photos from ${feedJsonPath}`
      );
      if (hasDownloadLimit && remainingDownloadSlots !== undefined) {
        console.log(
          `Limiting downloads to ${remainingDownloadSlots} photos for testing`
        );
      }
      let alreadyDownloaded = 0;
      let newDownloads = 0;
      let failedDownloads = 0;
      let skipped = 0;
      const downloadResults: DownloadResultItem[] = [];
      const rateLimitMs = 1000;
      let processedCount = 0;

      this.updateProgress('Downloading feed photos...', 0, totalPhotos, 0);

      for (const photo of sortedPhotos) {
        if (this.currentOperation.cancelled) {
          throw new Error('Operation cancelled');
        }

        const photoId = this.normalizeId(photo.Id);
        const imageName = photo.ImageName;
        const photoUrl = `https://img.rec.net/${imageName}`;

        if (!photoId || !imageName) {
          downloadResults.push({
            error: 'invalid_photo_data',
            photoId,
            imageName,
            photo: JSON.stringify(photo),
          });
          processedCount++;
          continue;
        }

        const photoPath = path.join(feedPhotosDir, `${photoId}.jpg`);

        // Check if photo already exists
        if (await fs.pathExists(photoPath)) {
          alreadyDownloaded++;
          downloadResults.push({
            photoId,
            status: 'already_exists_in_feed',
            path: photoPath,
          });
          processedCount++;
          continue;
        }

        // Check if photo exists in photos folder and copy it
        const regularPhotoPath = path.join(photosDir, `${photoId}.jpg`);
        if (await fs.pathExists(regularPhotoPath)) {
          await fs.copy(regularPhotoPath, photoPath);
          alreadyDownloaded++;
          decrementRemainingSlots();
          downloadResults.push({
            photoId,
            status: 'copied_from_photos',
            sourcePath: regularPhotoPath,
            destinationPath: photoPath,
          });
          processedCount++;
          continue;
        }

        if (
          remainingDownloadSlots !== undefined &&
          remainingDownloadSlots <= 0
        ) {
          skipped++;
          downloadResults.push({
            photoId,
            status: 'skipped_limit_reached',
            url: photoUrl,
          });
          processedCount++;
          continue;
        }

        try {
          const response = await this.sendRequest<ArrayBuffer>({
            url: photoUrl,
            method: 'GET',
            responseType: 'arraybuffer',
          });
          if (response.success && response.value) {
            const data = Buffer.from(response.value);
            await fs.writeFile(photoPath, data);
            newDownloads++;
            decrementRemainingSlots();
            downloadResults.push({
              photoId,
              status: 'downloaded',
              size: data.length,
              path: photoPath,
              url: photoUrl,
            });
          } else {
            failedDownloads++;
            downloadResults.push({
              photoId,
              status: 'failed',
              statusCode: response.status,
              reason: (response.message || response.error) ?? undefined,
              url: photoUrl,
            });
          }
        } catch (error) {
          failedDownloads++;
          downloadResults.push({
            photoId,
            status: 'error',
            error: (error as Error).message,
            url: photoUrl,
          });
        }

        // Rate limiting
        if (rateLimitMs > 0) {
          await this.delay(rateLimitMs);
        }

        processedCount++;
        this.updateProgress(
          'Downloading feed photos...',
          processedCount,
          totalPhotos
        );
      }

      this.setOperationComplete();

      const downloadStats: DownloadStats = {
        totalPhotos,
        alreadyDownloaded,
        newDownloads,
        failedDownloads,
        skipped,
      };

      return {
        accountId,
        feedPhotosDirectory: feedPhotosDir,
        processedCount,
        downloadStats,
        downloadResults,
        totalResults: downloadResults.length,
      };
    } catch (error) {
      this.setOperationComplete();
      throw error;
    }
  }

  private buildRequestConfig(
    config: AxiosRequestConfig,
    token?: string
  ): AxiosRequestConfig {
    const headers: Record<string, string> = {
      'User-Agent': 'RecNetPhotoDownloader/1.0',
      ...((config.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return {
      timeout: 30000,
      ...config,
      headers,
    };
  }

  private async sendRequest<T>(
    config: AxiosRequestConfig,
    token?: string
  ): Promise<GenericResponse<T>> {
    return axiosRequest<T>(this.buildRequestConfig(config, token));
  }

  private async requestOrThrow<T>(
    config: AxiosRequestConfig,
    token?: string
  ): Promise<T> {
    const response = await this.sendRequest<T>(config, token);
    if (
      !response.success ||
      response.value === null ||
      response.value === undefined
    ) {
      const statusText = response.status
        ? `HTTP ${response.status}`
        : 'Request failed';
      const message = response.message || response.error || 'Request failed';
      throw new Error(`${statusText}: ${message}`);
    }

    return response.value;
  }

  private normalizeId(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return '';
      }
      return Math.trunc(value).toString();
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    return '';
  }

  private toBigIntSafe(value: unknown): bigint | null {
    const normalized = this.normalizeId(value);
    if (!normalized || !/^-?\d+$/.test(normalized)) {
      return null;
    }

    try {
      return BigInt(normalized);
    } catch {
      return null;
    }
  }

  private compareIds(a: unknown, b: unknown): number {
    const aBig = this.toBigIntSafe(a);
    const bBig = this.toBigIntSafe(b);

    if (aBig !== null && bBig !== null) {
      if (aBig === bBig) return 0;
      return aBig < bBig ? -1 : 1;
    }

    const aStr = this.normalizeId(a);
    const bStr = this.normalizeId(b);
    if (!aStr && !bStr) return 0;
    if (!aStr) return -1;
    if (!bStr) return 1;
    return aStr.localeCompare(bStr);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private extractUniqueIds(photos: Photo[]): {
    accountIds: Set<string>;
    roomIds: Set<string>;
    eventIds: Set<string>;
  } {
    const accountIds = new Set<string>();
    const roomIds = new Set<string>();
    const eventIds = new Set<string>();

    for (const photo of photos) {
      // Extract room ID - handle multiple possible field shapes
      const extended = photo as any;
      if (extended.Room && typeof extended.Room === 'string') {
        // Room might be an ID string
        roomIds.add(extended.Room);
      } else if (extended.RoomId) {
        roomIds.add(String(extended.RoomId));
      } else if (extended.roomId) {
        roomIds.add(String(extended.roomId));
      } else if (extended.RoomID) {
        roomIds.add(String(extended.RoomID));
      }

      // Extract user IDs - could be in Users array or TaggedUsers array
      if (extended.Users && Array.isArray(extended.Users)) {
        for (const userId of extended.Users) {
          if (userId) {
            accountIds.add(String(userId));
          }
        }
      }
      if (extended.TaggedUsers && Array.isArray(extended.TaggedUsers)) {
        for (const userId of extended.TaggedUsers) {
          if (userId) {
            accountIds.add(String(userId));
          }
        }
      }
      if (extended.TaggedPlayerIds && Array.isArray(extended.TaggedPlayerIds)) {
        for (const userId of extended.TaggedPlayerIds) {
          if (userId) {
            accountIds.add(String(userId));
          }
        }
      }
      // Also check for creator/owner/account fields commonly present on feed photos
      if (extended.CreatorId) {
        accountIds.add(String(extended.CreatorId));
      }
      if (extended.AccountId) {
        accountIds.add(String(extended.AccountId));
      }
      if (extended.CreatorAccountId) {
        accountIds.add(String(extended.CreatorAccountId));
      }
      if (extended.PlayerId || extended.playerId) {
        accountIds.add(String(extended.PlayerId || extended.playerId));
      }
      if (extended.OwnerId) {
        accountIds.add(String(extended.OwnerId));
      }

      // Extract event IDs so we can hydrate event metadata
      const eventIdCandidates = [
        extended.EventId,
        extended.eventId,
        extended.PlayerEventId,
        extended.playerEventId,
        extended.EventInstanceId,
        extended.eventInstanceId,
      ];
      for (const candidate of eventIdCandidates) {
        if (candidate !== undefined && candidate !== null && candidate !== '') {
          eventIds.add(String(candidate));
        }
      }

      // Some payloads may embed an Event object
      if (extended.Event && typeof extended.Event === 'object') {
        const embeddedId =
          extended.Event.Id ??
          extended.Event.id ??
          extended.Event.eventId ??
          extended.Event.EventId;
        if (
          embeddedId !== undefined &&
          embeddedId !== null &&
          embeddedId !== ''
        ) {
          eventIds.add(String(embeddedId));
        }
      }

      const playerEventObject =
        extended.PlayerEvent && typeof extended.PlayerEvent === 'object'
          ? extended.PlayerEvent
          : extended.playerEvent && typeof extended.playerEvent === 'object'
            ? extended.playerEvent
            : undefined;
      if (playerEventObject) {
        const playerEventId =
          playerEventObject.Id ??
          playerEventObject.id ??
          playerEventObject.EventId ??
          playerEventObject.eventId;
        if (
          playerEventId !== undefined &&
          playerEventId !== null &&
          playerEventId !== ''
        ) {
          eventIds.add(String(playerEventId));
        }
      }
    }

    return { accountIds, roomIds, eventIds };
  }

  async fetchBulkAccounts(
    accountIds: string[],
    token?: string
  ): Promise<any[]> {
    if (accountIds.length === 0) {
      return [];
    }

    const results: any[] = [];

    // Process in batches to avoid URL length limits
    const batchSize = 100;
    for (let i = 0; i < accountIds.length; i += batchSize) {
      const batch = accountIds.slice(i, i + batchSize);

      try {
        const formData = new URLSearchParams();
        for (const id of batch) {
          formData.append('id', id);
        }

        const response = await this.sendRequest<any[]>(
          {
            url: 'https://accounts.rec.net/account/bulk',
            method: 'POST',
            data: formData.toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
          token
        );

        if (response.success && Array.isArray(response.value)) {
          results.push(...response.value);
        } else {
          console.log(
            `Failed to fetch batch of accounts: status ${response.status} - ${response.message || response.error}`
          );
        }
      } catch (error) {
        console.log(
          `Failed to fetch batch of accounts: ${(error as Error).message}`
        );
      }

      // Small delay between batches
      if (i + batchSize < accountIds.length) {
        await this.delay(100);
      }
    }

    return results;
  }

  async fetchBulkRooms(roomIds: string[], token?: string): Promise<any[]> {
    if (roomIds.length === 0) {
      return [];
    }

    const results: any[] = [];

    // Process in batches to avoid URL length limits
    const batchSize = 100;
    for (let i = 0; i < roomIds.length; i += batchSize) {
      const batch = roomIds.slice(i, i + batchSize);

      try {
        const formData = new URLSearchParams();
        for (const id of batch) {
          formData.append('id', id);
        }

        const response = await this.sendRequest<any[]>(
          {
            url: 'https://rooms.rec.net/rooms/bulk',
            method: 'POST',
            data: formData.toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
          token
        );

        if (response.success && Array.isArray(response.value)) {
          results.push(...response.value);
        } else {
          console.log(
            `Failed to fetch batch of rooms: status ${response.status} - ${response.message || response.error}`
          );
        }
      } catch (error) {
        console.log(
          `Failed to fetch batch of rooms: ${(error as Error).message}`
        );
      }

      // Small delay between batches
      if (i + batchSize < roomIds.length) {
        await this.delay(100);
      }
    }

    return results;
  }

  async fetchBulkEvents(eventIds: string[], token?: string): Promise<Event[]> {
    if (eventIds.length === 0) {
      return [];
    }

    const results: Event[] = [];
    const batchSize = 100;

    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize);

      try {
        const response = await this.sendRequest<Event[]>(
          {
            url: 'https://apim.rec.net/apis/api/playerevents/v1/bulk',
            method: 'POST',
            data: { ids: batch },
            headers: {
              'Content-Type': 'application/json',
            },
          },
          token
        );

        if (response.success && Array.isArray(response.value)) {
          // Convert IDs to strings to ensure consistency
          const transformedEvents = response.value.map((event: Event) => ({
            ...event,
            PlayerEventId: event.PlayerEventId.toString(),
            CreatorPlayerId: event.CreatorPlayerId.toString(),
            RoomId: event.RoomId.toString(),
          }));
          results.push(...transformedEvents);
        } else {
          console.log(
            `Failed to fetch batch of events: status ${response.status} - ${response.message || response.error}`
          );
        }
      } catch (error) {
        console.log(
          `Failed to fetch batch of events: ${(error as Error).message}`
        );
      }

      if (i + batchSize < eventIds.length) {
        await this.delay(100);
      }
    }

    return results;
  }

  async fetchAndSaveBulkData(
    accountId: string,
    photos: Photo[],
    token?: string,
    options: BulkDataRefreshOptions = {}
  ): Promise<{
    accountsFetched: number;
    roomsFetched: number;
    eventsFetched: number;
  }> {
    try {
      const {
        forceAccountsRefresh = false,
        forceRoomsRefresh = false,
        forceEventsRefresh = false,
      } = options;
      this.updateProgress('Extracting IDs from photos...', 0, 0, 0);

      // Extract unique IDs
      const { accountIds, roomIds, eventIds } = this.extractUniqueIds(photos);
      const accountIdsArray = Array.from(accountIds);
      const roomIdsArray = Array.from(roomIds);
      const eventIdsArray = Array.from(eventIds);
      this.updateProgress('Grabbing unique accounts', 0, 0, 0);
      this.updateProgress('Grabbing unique rooms', 0, 0, 0);
      this.updateProgress('Grabbing unique events', 0, 0, 0);

      console.log(
        `Found ${accountIdsArray.length} unique account IDs, ${roomIdsArray.length} unique room IDs, and ${eventIdsArray.length} unique event IDs`
      );

      const accountDir = path.join(this.settings.outputRoot, accountId);
      await fs.ensureDir(accountDir);

      let accountsFetched = 0;
      let roomsFetched = 0;
      let eventsFetched = 0;
      const accountsJsonPath = path.join(
        accountDir,
        `${accountId}_accounts.json`
      );
      const roomsJsonPath = path.join(accountDir, `${accountId}_rooms.json`);
      const eventsJsonPath = path.join(accountDir, `${accountId}_events.json`);
      const accountsFileExists = await fs.pathExists(accountsJsonPath);
      const roomsFileExists = await fs.pathExists(roomsJsonPath);
      const eventsFileExists = await fs.pathExists(eventsJsonPath);

      // Fetch and save account data
      if (accountIdsArray.length > 0) {
        this.updateProgress(
          'Checking account cache',
          0,
          accountIdsArray.length,
          0
        );
        if (accountsFileExists && !forceAccountsRefresh) {
          console.log(
            `Account data already exists at ${accountsJsonPath}, skipping fetch (force refresh disabled)`
          );
          this.updateProgress(
            'Using cached account data',
            accountIdsArray.length,
            accountIdsArray.length,
            100
          );
        } else {
          this.updateProgress(
            `Downloading new account data and updating cache (${accountIdsArray.length} accounts)...`,
            0,
            0,
            0
          );
          const accountsData = await this.fetchBulkAccounts(
            accountIdsArray,
            token
          );
          accountsFetched = accountsData.length;

          await fs.writeJson(accountsJsonPath, accountsData, { spaces: 2 });
          console.log(
            `Saved ${accountsData.length} accounts to ${accountsJsonPath}`
          );
        }
      }

      // Fetch and save room data
      if (roomIdsArray.length > 0) {
        this.updateProgress('Checking rooms cache', 0, roomIdsArray.length, 0);
        if (roomsFileExists && !forceRoomsRefresh) {
          console.log(
            `Room data already exists at ${roomsJsonPath}, skipping fetch (force refresh disabled)`
          );
          this.updateProgress(
            'Using cached room data',
            roomIdsArray.length,
            roomIdsArray.length,
            100
          );
        } else {
          this.updateProgress(
            `Downloading new rooms data and updating cache (${roomIdsArray.length} rooms)...`,
            0,
            0,
            0
          );
          const roomsData = await this.fetchBulkRooms(roomIdsArray, token);
          roomsFetched = roomsData.length;

          await fs.writeJson(roomsJsonPath, roomsData, { spaces: 2 });
          console.log(`Saved ${roomsData.length} rooms to ${roomsJsonPath}`);
        }
      }

      // Fetch and save event data
      if (eventIdsArray.length > 0) {
        this.updateProgress(
          'Checking events cache',
          0,
          eventIdsArray.length,
          0
        );
        if (eventsFileExists && !forceEventsRefresh) {
          console.log(
            `Event data already exists at ${eventsJsonPath}, skipping fetch (force refresh disabled)`
          );
          this.updateProgress(
            'Using cached event data',
            eventIdsArray.length,
            eventIdsArray.length,
            100
          );
        } else {
          this.updateProgress(
            `Downloading new events data and updating cache (${eventIdsArray.length} events)...`,
            0,
            0,
            0
          );
          const eventsData = await this.fetchBulkEvents(eventIdsArray, token);
          eventsFetched = eventsData.length;

          await fs.writeJson(eventsJsonPath, eventsData, { spaces: 2 });
          console.log(`Saved ${eventsData.length} events to ${eventsJsonPath}`);
        }
      }

      return { accountsFetched, roomsFetched, eventsFetched };
    } catch (error) {
      console.log(
        `Failed to fetch and save bulk data: ${(error as Error).message}`
      );
      throw error;
    }
  }

  async lookupAccount(accountId: string): Promise<AccountInfo[]> {
    try {
      const response = await this.requestOrThrow<AccountInfo[]>({
        url: `https://accounts.rec.net/account/bulk?id=${encodeURIComponent(accountId)}`,
        method: 'GET',
      });
      return response;
    } catch (error) {
      throw new Error(`Failed to lookup account: ${(error as Error).message}`);
    }
  }

  async searchAccounts(username: string): Promise<AccountInfo[]> {
    try {
      const response = await this.requestOrThrow<AccountInfo[]>({
        url: `https://apim.rec.net/accounts/account/search?name=${encodeURIComponent(username)}`,
        method: 'GET',
      });
      return response;
    } catch (error) {
      throw new Error(`Failed to search accounts: ${(error as Error).message}`);
    }
  }

  async clearAccountData(accountId: string): Promise<{ filesRemoved: number }> {
    const accountDir = path.join(this.settings.outputRoot, accountId);
    const photosJsonPath = path.join(accountDir, `${accountId}_photos.json`);
    const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);

    let filesRemoved = 0;

    try {
      // Remove photos JSON file
      if (await fs.pathExists(photosJsonPath)) {
        await fs.remove(photosJsonPath);
        filesRemoved++;
        console.log(`Removed photos file: ${photosJsonPath}`);
      }

      // Remove feed JSON file
      if (await fs.pathExists(feedJsonPath)) {
        await fs.remove(feedJsonPath);
        filesRemoved++;
        console.log(`Removed feed file: ${feedJsonPath}`);
      }

      // Remove the account directory if it's empty
      try {
        const files = await fs.readdir(accountDir);
        if (files.length === 0) {
          await fs.remove(accountDir);
          console.log(`Removed empty account directory: ${accountDir}`);
        }
      } catch (error) {
        // Directory might not exist or might not be empty, that's fine
        console.log(
          `Account directory not empty or doesn't exist: ${accountDir}`
        );
      }

      return { filesRemoved };
    } catch (error) {
      throw new Error(
        `Failed to clear account data: ${(error as Error).message}`
      );
    }
  }

  async listAvailableAccounts(): Promise<
    Array<{
      accountId: string;
      hasPhotos: boolean;
      hasFeed: boolean;
      photoCount: number;
      feedCount: number;
    }>
  > {
    const accounts: Array<{
      accountId: string;
      hasPhotos: boolean;
      hasFeed: boolean;
      photoCount: number;
      feedCount: number;
    }> = [];

    try {
      // Ensure output directory exists
      if (!(await fs.pathExists(this.settings.outputRoot))) {
        return accounts;
      }

      // Read all directories in output root
      const entries = await fs.readdir(this.settings.outputRoot, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const accountId = entry.name;
        const accountDir = path.join(this.settings.outputRoot, accountId);
        const photosJsonPath = path.join(
          accountDir,
          `${accountId}_photos.json`
        );
        const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);

        let hasPhotos = false;
        let hasFeed = false;
        let photoCount = 0;
        let feedCount = 0;

        // Check for photos metadata
        if (await fs.pathExists(photosJsonPath)) {
          try {
            const photos: Photo[] = await fs.readJson(photosJsonPath);
            if (Array.isArray(photos) && photos.length > 0) {
              hasPhotos = true;
              photoCount = photos.length;
            }
          } catch (error) {
            // Invalid JSON, skip
            console.log(
              `Failed to read photos JSON for ${accountId}: ${(error as Error).message}`
            );
          }
        }

        // Check for feed metadata
        if (await fs.pathExists(feedJsonPath)) {
          try {
            const feed: Photo[] = await fs.readJson(feedJsonPath);
            if (Array.isArray(feed) && feed.length > 0) {
              hasFeed = true;
              feedCount = feed.length;
            }
          } catch (error) {
            // Invalid JSON, skip
            console.log(
              `Failed to read feed JSON for ${accountId}: ${(error as Error).message}`
            );
          }
        }

        // Only include accounts that have at least one metadata file
        if (hasPhotos || hasFeed) {
          accounts.push({
            accountId,
            hasPhotos,
            hasFeed,
            photoCount,
            feedCount,
          });
        }
      }

      // Sort by accountId
      accounts.sort((a, b) => a.accountId.localeCompare(b.accountId));
    } catch (error) {
      console.log(
        `Failed to list available accounts: ${(error as Error).message}`
      );
    }

    return accounts;
  }
}
