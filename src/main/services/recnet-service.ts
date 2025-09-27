import axios, { AxiosInstance, AxiosResponse } from 'axios';
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
} from '../../shared/types';

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
    token?: string
  ): Promise<CollectionResult> {
    this.currentOperation = { cancelled: false };

    try {
      this.updateProgress('Collecting photos...', 0, 0, 0);

      const client = this.createHttpClient(token);
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
        await fs.writeJson(jsonPath, oldData, { spaces: 2 });
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
      while (true) {
        if (this.currentOperation.cancelled) {
          throw new Error('Operation cancelled');
        }

        this.updateProgress(
          `Fetching page ${iteration + 1}...`,
          iteration,
          0 // Total unknown since we loop until done
        );

        let url = `https://apim.rec.net/apis/api/images/v4/player/${encodeURIComponent(
          accountId
        )}?skip=${skip}&take=${150}&sort=2`;

        if (lastSortValue) {
          url += `&after=${encodeURIComponent(lastSortValue)}`;
        }

        const response: AxiosResponse<Photo[]> = await client.get(url);

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const photos = response.data;
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
          if (lastSortValue && photo.sort) {
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
      await fs.writeJson(jsonPath, all, { spaces: 2 });
      console.log(`Photos metadata saved successfully`);

      const totalNewPhotosAdded = all.length - existingPhotoCount;

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
    incremental = true
  ): Promise<CollectionResult> {
    this.currentOperation = { cancelled: false };

    try {
      this.updateProgress('Collecting feed photos...', 0, 0, 0);

      const client = this.createHttpClient(token);
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

        const response: AxiosResponse<Photo[]> = await client.get(url);

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const photos = response.data;
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
          if (photo.Id) {
            // Check if this photo already exists
            for (const existingPhoto of all) {
              if (existingPhoto.Id === photo.Id) {
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
      await fs.writeJson(feedJsonPath, all, { spaces: 2 });

      const totalNewPhotosAdded = all.length - existingPhotoCount;

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

      const client = this.createHttpClient();
      const totalPhotos = photos.length;
      let alreadyDownloaded = 0;
      let newDownloads = 0;
      let failedDownloads = 0;
      const downloadResults: DownloadResultItem[] = [];
      const rateLimitMs = 1000;
      let processedCount = 0;

      this.updateProgress('Downloading photos...', 0, totalPhotos, 0);

      for (const photo of photos) {
        if (this.currentOperation.cancelled) {
          throw new Error('Operation cancelled');
        }

        if (!photo.Id || !photo.ImageName) {
          downloadResults.push({
            error: 'missing_photo_data',
            photo: JSON.stringify(photo),
          });
          processedCount++;
          continue;
        }

        const photoId = photo.Id.toString();
        const imageName = photo.ImageName;
        const photoUrl = `https://img.rec.net/${imageName}`;

        if (!photoId || !imageName) {
          downloadResults.push({
            error: 'invalid_photo_data',
            photoId,
            imageName,
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
          downloadResults.push({
            photoId,
            status: 'copied_from_feed',
            sourcePath: feedPhotoPath,
            destinationPath: photoPath,
          });
          processedCount++;
          continue;
        }

        try {
          const response = await client.get(photoUrl, {
            responseType: 'arraybuffer',
          });
          if (response.status === 200) {
            await fs.writeFile(photoPath, response.data);
            newDownloads++;
            downloadResults.push({
              photoId,
              status: 'downloaded',
              size: response.data.length,
              path: photoPath,
              url: photoUrl,
            });
          } else {
            failedDownloads++;
            downloadResults.push({
              photoId,
              status: 'failed',
              statusCode: response.status,
              reason: response.statusText,
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
        skipped: 0,
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

      const client = this.createHttpClient();
      const totalPhotos = photos.length;
      let alreadyDownloaded = 0;
      let newDownloads = 0;
      let failedDownloads = 0;
      const downloadResults: DownloadResultItem[] = [];
      const rateLimitMs = 1000;
      let processedCount = 0;

      this.updateProgress('Downloading feed photos...', 0, totalPhotos, 0);

      for (const photo of photos) {
        if (this.currentOperation.cancelled) {
          throw new Error('Operation cancelled');
        }

        if (!photo.Id || !photo.ImageName) {
          downloadResults.push({
            error: 'missing_photo_data',
            photo: JSON.stringify(photo),
          });
          processedCount++;
          continue;
        }

        const photoId = photo.Id.toString();
        const imageName = photo.ImageName;
        const photoUrl = `https://img.rec.net/${imageName}`;

        if (!photoId || !imageName) {
          downloadResults.push({
            error: 'invalid_photo_data',
            photoId,
            imageName,
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
          downloadResults.push({
            photoId,
            status: 'copied_from_photos',
            sourcePath: regularPhotoPath,
            destinationPath: photoPath,
          });
          processedCount++;
          continue;
        }

        try {
          const response = await client.get(photoUrl, {
            responseType: 'arraybuffer',
          });
          if (response.status === 200) {
            await fs.writeFile(photoPath, response.data);
            newDownloads++;
            downloadResults.push({
              photoId,
              status: 'downloaded',
              size: response.data.length,
              path: photoPath,
              url: photoUrl,
            });
          } else {
            failedDownloads++;
            downloadResults.push({
              photoId,
              status: 'failed',
              statusCode: response.status,
              reason: response.statusText,
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
        skipped: 0,
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

  private createHttpClient(token?: string): AxiosInstance {
    const client = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': 'RecNetPhotoDownloader/1.0',
      },
    });

    if (token) {
      client.defaults.headers.Authorization = `Bearer ${token}`;
    }

    return client;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async lookupAccount(accountId: string): Promise<AccountInfo[]> {
    try {
      const client = this.createHttpClient();
      const response = await client.get(
        `https://accounts.rec.net/account/bulk?id=${encodeURIComponent(accountId)}`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to lookup account: ${(error as Error).message}`);
    }
  }

  async searchAccounts(username: string): Promise<AccountInfo[]> {
    try {
      const client = this.createHttpClient();
      const response = await client.get(
        `https://apim.rec.net/accounts/account/search?name=${encodeURIComponent(username)}`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to search accounts: ${(error as Error).message}`);
    }
  }
}
