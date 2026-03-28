import * as fs from 'fs-extra';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as os from 'os';
import {
  RecNetSettings,
  Progress,
  ProgressPhase,
  CollectionResult,
  DownloadResult,
  CombinedUserAndFeedDownloadResult,
  Photo,
  IterationDetail,
  DownloadResultItem,
  DownloadStats,
  AccountInfo,
  BulkDataRefreshOptions,
} from '../../shared/types';
import {
  buildCdnImageUrl,
  DEFAULT_CDN_BASE,
  normalizeCdnBase,
} from '../../shared/cdnUrl';
import { EventDto } from '../models/EventDto';
import { ImageDto } from '../models/ImageDto';
import { PlayerResult } from '../models/PlayerDto';
import { RoomDto } from '../models/RoomDto';
import { AccountsController } from './recnet/accounts-controller';
import { EventsController } from './recnet/events-controller';
import { RecNetHttpClient } from './recnet/http-client';
import { PhotosController } from './recnet/photos-controller';
import { RoomsController } from './recnet/rooms-controller';
import { Semaphore } from '../utils/semaphore';

interface CurrentOperation {
  cancelled: boolean;
}

interface PhotoDownloadAttempt {
  response?: {
    success: boolean;
    value: ArrayBuffer | null;
    error?: string | null;
    message?: string | null;
    status?: number;
  };
  error?: Error;
  attempts: number;
}

type FolderMetaOwner = {
  accountId: string;
  username?: string;
  displayName?: string;
  displayLabel?: string;
};

type FolderMetaV1 = {
  schemaVersion: 1;
  accountId: string;
  updatedAt: string;
  owner?: FolderMetaOwner;
  cache?: Record<string, unknown>;
};

const DEFAULT_SETTINGS: RecNetSettings = {
  outputRoot: 'output',
  cdnBase: DEFAULT_CDN_BASE,
  interPageDelayMs: 500,
};

const PHOTO_DOWNLOAD_RETRY_COUNT = 3;
const PHOTO_DOWNLOAD_MAX_ATTEMPTS = PHOTO_DOWNLOAD_RETRY_COUNT + 1;
const PHOTO_DOWNLOAD_RETRY_DELAY_MS = 750;
const PHOTO_DOWNLOAD_MAX_CONCURRENT_REQUESTS = 30;
const PHOTO_MAX_PAGE_SIZE = 1_000;

function normalizeRecNetSettings(input: unknown): RecNetSettings {
  const raw =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};

  const interRaw = raw.interPageDelayMs;
  const interPageDelayMs =
    typeof interRaw === 'number' && Number.isFinite(interRaw)
      ? interRaw
      : DEFAULT_SETTINGS.interPageDelayMs;

  const maxRaw = raw.maxPhotosToDownload;
  const maxPhotosToDownload =
    typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw > 0
      ? Math.floor(maxRaw)
      : undefined;

  return {
    outputRoot:
      typeof raw.outputRoot === 'string' && raw.outputRoot.length > 0
        ? raw.outputRoot
        : DEFAULT_SETTINGS.outputRoot,
    cdnBase: normalizeCdnBase(
      typeof raw.cdnBase === 'string' ? raw.cdnBase : DEFAULT_SETTINGS.cdnBase
    ),
    interPageDelayMs,
    maxPhotosToDownload,
  };
}

export class RecNetService extends EventEmitter {
  private settingsPath: string;
  private settings: RecNetSettings;
  private settingsLoaded: Promise<void>;
  private currentOperation: CurrentOperation | null = null;
  private progress: Progress;
  private httpClient: RecNetHttpClient;
  private photosController: PhotosController;
  private accountsController: AccountsController;
  private roomsController: RoomsController;
  private eventsController: EventsController;

  constructor() {
    super();
    this.settingsPath = path.join(
      os.homedir(),
      '.recnet-photo-downloader',
      'settings.json'
    );
    this.settings = { ...DEFAULT_SETTINGS };
    this.progress = this.createProgressState({
      isRunning: false,
      currentStep: '',
      progress: 0,
      total: 0,
      current: 0,
      progressPhase: 'metadata',
    });

    this.httpClient = new RecNetHttpClient();
    this.photosController = new PhotosController(this.httpClient);
    this.accountsController = new AccountsController(this.httpClient);
    this.roomsController = new RoomsController(this.httpClient);
    this.eventsController = new EventsController(this.httpClient);

    // Load settings from disk
    this.settingsLoaded = this.loadSettings();
  }

  private async ensureSettingsLoaded(): Promise<void> {
    await this.settingsLoaded;
  }

  async loadSettings(): Promise<void> {
    try {
      if (await fs.pathExists(this.settingsPath)) {
        const savedSettings = await fs.readJson(this.settingsPath);
        this.settings = normalizeRecNetSettings({
          ...DEFAULT_SETTINGS,
          ...savedSettings,
        });
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

  async getSettings(): Promise<RecNetSettings> {
    await this.ensureSettingsLoaded();
    return { ...this.settings };
  }

  async updateSettings(
    newSettings: Partial<RecNetSettings>
  ): Promise<RecNetSettings> {
    await this.ensureSettingsLoaded();
    this.settings = normalizeRecNetSettings({
      ...this.settings,
      ...newSettings,
    });
    this.ensureOutputDirectory();
    await this.saveSettings();
    return this.settings;
  }

  getProgress(): Progress {
    return { ...this.progress };
  }

  private isOperationCancelled(): boolean {
    return this.currentOperation?.cancelled === true;
  }

  private isTrackedOperationCancelled(
    operation?: CurrentOperation | null
  ): boolean {
    return (
      !operation || operation.cancelled || this.currentOperation !== operation
    );
  }

  private throwIfCancelled(): void {
    if (this.isOperationCancelled()) {
      throw new Error('Operation cancelled');
    }
  }

  private throwIfTrackedOperationCancelled(
    operation?: CurrentOperation | null
  ): void {
    if (this.isTrackedOperationCancelled(operation)) {
      throw new Error('Operation cancelled');
    }
  }

  private updateProgress(
    step: string,
    current: number,
    total: number,
    progress?: number,
    progressPhase?: ProgressPhase
  ): void {
    if (
      this.isOperationCancelled() ||
      (!this.currentOperation &&
        !this.progress.isRunning &&
        ['Cancelled', 'Complete', 'Failed'].includes(this.progress.currentStep))
    ) {
      return;
    }

    const phase: ProgressPhase =
      progressPhase ?? (total > 0 ? 'files' : 'metadata');

    this.progress = this.createProgressState({
      ...this.progress,
      isRunning: true,
      currentStep: step,
      current,
      total,
      progress:
        progress !== undefined
          ? progress
          : total > 0
            ? (current / total) * 100
            : 0,
      progressPhase: phase,
    });
    this.emit('progress-update', this.progress);
  }

  private setOperationComplete(): void {
    this.progress = this.createProgressState({
      ...this.progress,
      isRunning: false,
      currentStep: 'Complete',
      current: 0,
      total: 0,
      progress: 100,
      progressPhase: 'metadata',
    });
    this.currentOperation = null;
    this.emit('progress-update', this.progress);
  }

  private setOperationFailed(message: string): void {
    this.progress = this.createProgressState({
      ...this.progress,
      isRunning: false,
      currentStep: 'Failed',
      current: 0,
      total: 0,
      progress: 100,
      progressPhase: 'metadata',
      statusLevel: 'error',
      issueCount: Math.max(this.progress.issueCount, 1),
      failedItems: Math.max(this.progress.failedItems, 1),
      lastIssue: message,
    });
    this.currentOperation = null;
    this.emit('progress-update', this.progress);
  }

  private setOperationCancelled(): void {
    this.progress = this.createProgressState({
      ...this.progress,
      isRunning: false,
      currentStep: 'Cancelled',
      current: 0,
      total: 0,
      progressPhase: 'metadata',
      statusLevel: 'info',
      lastIssue: undefined,
    });
    this.currentOperation = null;
    this.emit('progress-update', this.progress);
  }

  cancelCurrentOperation(): boolean {
    if (this.currentOperation) {
      this.currentOperation.cancelled = true;
      this.httpClient.cancelActiveRequests();
      this.progress = this.createProgressState({
        ...this.progress,
        isRunning: true,
        currentStep: 'Cancelling...',
        progressPhase: 'metadata',
        statusLevel: 'info',
        lastIssue: undefined,
      });
      this.emit('progress-update', this.progress);
      return true;
    }
    return false;
  }

  async collectPhotos(
    accountId: string,
    token?: string,
    options?: BulkDataRefreshOptions
  ): Promise<CollectionResult> {
    await this.ensureSettingsLoaded();
    this.currentOperation = { cancelled: false };
    const {
      forceAccountsRefresh = false,
      forceRoomsRefresh = false,
      forceEventsRefresh = false,
    } = options || {};

    try {
      this.resetProgressIssueState();
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
        const normalizedOldData = this.normalizePhotos(oldData as ImageDto[]);
        await fs.writeJson(jsonPath, normalizedOldData, {
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
          const existingJson: ImageDto[] = await fs.readJson(jsonPath);
          const normalizedExisting = this.normalizePhotos(existingJson);
          if (normalizedExisting && normalizedExisting.length > 0) {
            existingPhotoCount = normalizedExisting.length;

            // Find the newest photo's sort value
            for (const photo of normalizedExisting) {
              if (photo.sort) {
                const currentSort = photo.sort;
                if (!lastSortValue || currentSort > lastSortValue) {
                  lastSortValue = currentSort;
                }
              }
            }

            all.push(...normalizedExisting);
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

      let hasMorePhotos = true;
      while (hasMorePhotos) {
        if (this.currentOperation.cancelled) {
          throw new Error('Operation cancelled');
        }

        const modeText = isIncrementalMode ? ' (incremental)' : '';
        this.updateProgress(
          `User photos metadata: fetching page ${iteration + 1}${modeText} — ${all.length} photos in catalog so far…`,
          0,
          0,
          0
        );

        let url = `https://apim.rec.net/apis/api/images/v4/player/${encodeURIComponent(
          accountId
        )}?skip=${skip}&take=${PHOTO_MAX_PAGE_SIZE}&sort=2`;

        if (lastSortValue) {
          url += `&after=${encodeURIComponent(lastSortValue)}`;
        }

        const photos = this.normalizePhotos(
          await this.photosController.fetchPlayerPhotos(
            accountId,
            { skip, take: PHOTO_MAX_PAGE_SIZE, sort: 2, after: lastSortValue },
            token
          )
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
          take: PHOTO_MAX_PAGE_SIZE,
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
          hasMorePhotos = false;
        }

        if (photos.length < PHOTO_MAX_PAGE_SIZE) {
          // No more photos available
          hasMorePhotos = false;
        }

        if (hasMorePhotos) {
          skip += PHOTO_MAX_PAGE_SIZE;
          iteration++;

          if (this.settings.interPageDelayMs > 0) {
            await this.delay(this.settings.interPageDelayMs);
          }
        }
      }

      // Save updated collection
      await fs.ensureDir(path.dirname(jsonPath));
      console.log(`Saving photos metadata to: ${jsonPath}`);
      const normalizedAll = this.normalizePhotos(all);
      await fs.writeJson(jsonPath, normalizedAll, {
        spaces: 2,
      });
      console.log(`Photos metadata saved successfully`);

      const totalNewPhotosAdded = normalizedAll.length - existingPhotoCount;

      // Fetch and save bulk account and room data (from photos + any existing feed)
      try {
        this.updateProgress(
          'Fetching account, room, and event data…',
          0,
          0,
          0
        );

        let combinedForMetadata: Photo[] = [...normalizedAll];
        const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);
        if (await fs.pathExists(feedJsonPath)) {
          try {
            const feedPhotos: ImageDto[] = await fs.readJson(feedJsonPath);
            const normalizedFeed = this.normalizePhotos(feedPhotos);
            combinedForMetadata = combinedForMetadata.concat(normalizedFeed);
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
        if ((error as Error).message === 'Operation cancelled') {
          throw error;
        }
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
        totalPhotos: normalizedAll.length,
        totalFetched,
        pageSize: PHOTO_MAX_PAGE_SIZE,
        delayMs: this.settings.interPageDelayMs,
        iterationsCompleted: iterationDetails.length,
        lastSortValue,
        incrementalMode: !!lastSortValue,
        iterationDetails,
      };
    } catch (error) {
      if ((error as Error).message === 'Operation cancelled') {
        this.setOperationCancelled();
      } else {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    }
  }

  async collectFeedPhotos(
    accountId: string,
    token?: string,
    incremental = true,
    options?: BulkDataRefreshOptions
  ): Promise<CollectionResult> {
    await this.ensureSettingsLoaded();
    this.currentOperation = { cancelled: false };
    const {
      forceAccountsRefresh = false,
      forceRoomsRefresh = false,
      forceEventsRefresh = false,
    } = options || {};

    try {
      this.resetProgressIssueState();
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
        const normalizedOldFeed = this.normalizePhotos(
          oldFeedData as ImageDto[]
        );
        await fs.writeJson(feedJsonPath, normalizedOldFeed, { spaces: 2 });
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
          const existingPhotos: ImageDto[] = await fs.readJson(feedJsonPath);
          const normalizedExisting = this.normalizePhotos(existingPhotos);
          if (normalizedExisting && normalizedExisting.length > 0) {
            existingPhotoCount = normalizedExisting.length;

            // Find the oldest photo's CreatedAt
            for (const photo of normalizedExisting) {
              if (photo.CreatedAt) {
                const createdAt = new Date(photo.CreatedAt);
                if (!lastSince || createdAt < lastSince) {
                  lastSince = createdAt;
                }
              }
            }

            all.push(...normalizedExisting);
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
      let hasMoreFeedPhotos = true;
      while (hasMoreFeedPhotos) {
        if (this.currentOperation.cancelled) {
          throw new Error('Operation cancelled');
        }

        this.updateProgress(
          `Feed metadata: fetching page ${iteration + 1} — ${all.length} photos in catalog so far…`,
          0,
          0,
          0
        );

        const sinceParam = sinceTime.toISOString();
        const url = `https://apim.rec.net/apis/api/images/v3/feed/player/${encodeURIComponent(
          accountId
        )}?skip=${skip}&take=${PHOTO_MAX_PAGE_SIZE}&since=${encodeURIComponent(sinceParam)}`;

        const photos = this.normalizePhotos(
          await this.photosController.fetchFeedPhotos(
            accountId,
            { skip, take: PHOTO_MAX_PAGE_SIZE, since: sinceParam },
            token
          )
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
          take: PHOTO_MAX_PAGE_SIZE,
          since: sinceParam,
          itemsReceived: photos.length,
          newPhotosAdded,
          totalSoFar: totalFetched,
          totalInCollection: all.length,
          newestCreatedAt: newestCreatedAt?.toISOString(),
          incrementalMode: existingPhotoCount > 0,
        });

        if (photos.length < PHOTO_MAX_PAGE_SIZE) {
          // No more photos available
          hasMoreFeedPhotos = false;
        }

        if (hasMoreFeedPhotos) {
          skip += PHOTO_MAX_PAGE_SIZE;
          iteration++;

          if (this.settings.interPageDelayMs > 0) {
            await this.delay(this.settings.interPageDelayMs);
          }
        }
      }

      // Save updated feed collection
      const normalizedFeed = this.normalizePhotos(all);
      await fs.writeJson(feedJsonPath, normalizedFeed, {
        spaces: 2,
      });

      const totalNewPhotosAdded = normalizedFeed.length - existingPhotoCount;

      // Fetch and save bulk account and room data (feed + any existing photos)
      try {
        this.updateProgress(
          'Fetching feed account, room, and event data...',
          0,
          0,
          0
        );

        let combinedForMetadata: Photo[] = [...normalizedFeed];
        const photosJsonPath = path.join(
          accountDir,
          `${accountId}_photos.json`
        );
        if (await fs.pathExists(photosJsonPath)) {
          try {
            const photoMetadata: ImageDto[] = await fs.readJson(photosJsonPath);
            const normalizedPhotos = this.normalizePhotos(photoMetadata);
            combinedForMetadata = combinedForMetadata.concat(normalizedPhotos);
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
        if ((error as Error).message === 'Operation cancelled') {
          throw error;
        }
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
        totalPhotos: normalizedFeed.length,
        totalFetched,
        pageSize: PHOTO_MAX_PAGE_SIZE,
        delayMs: this.settings.interPageDelayMs,
        iterationsCompleted: iterationDetails.length,
        sinceTime: sinceTime.toISOString(),
        incrementalMode: existingPhotoCount > 0,
        incremental,
        iterationDetails,
      };
    } catch (error) {
      if ((error as Error).message === 'Operation cancelled') {
        this.setOperationCancelled();
      } else {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    }
  }

  private sortPhotosChronologically(photos: Photo[]): Photo[] {
    return [...photos].sort((a, b) => {
      const timeA = a.CreatedAt
        ? new Date(a.CreatedAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      const timeB = b.CreatedAt
        ? new Date(b.CreatedAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      if (timeA !== timeB) return timeA - timeB;
      return this.compareIds(a.Id, b.Id);
    });
  }

  /**
   * Concurrent download of a sorted photo list; used by user-only, feed-only, and combined flows.
   */
  private async downloadPhotoBatch(
    sortedPhotos: Photo[],
    photosDir: string,
    companionDir: string,
    isFeed: boolean,
    token: string | undefined,
    operation: CurrentOperation,
    progressEach: () => void,
    limit: { hasLimit: boolean; remainingSlots: number }
  ): Promise<{
    downloadResults: DownloadResultItem[];
    alreadyDownloaded: number;
    newDownloads: number;
    failedDownloads: number;
    skipped: number;
    retryAttempts: number;
    recoveredAfterRetry: number;
    processedCount: number;
    queuedCount: number;
  }> {
    const hasDownloadLimit = limit.hasLimit;
    let remainingDownloadSlots = limit.remainingSlots;

    let alreadyDownloaded = 0;
    let newDownloads = 0;
    let failedDownloads = 0;
    let skipped = 0;
    let retryAttempts = 0;
    let recoveredAfterRetry = 0;
    let processedCount = 0;

    let delay = 0;
    const promises: Promise<DownloadResultItem>[] = [];
    const semaphore = new Semaphore(PHOTO_DOWNLOAD_MAX_CONCURRENT_REQUESTS);
    const totalPhotos = sortedPhotos.length;

    for (const photo of sortedPhotos) {
      if (hasDownloadLimit && remainingDownloadSlots <= 0) {
        skipped = totalPhotos - promises.length;
        break;
      }
      if (hasDownloadLimit) {
        remainingDownloadSlots--;
      }

      const delayForPhoto = delay;
      promises.push(
        new Promise<DownloadResultItem>((resolve, reject) => {
          void (async () => {
            let acquired = false;
            try {
              let result = await this.resolveLocalDownloadResult(
                photo,
                photosDir,
                companionDir,
                isFeed,
                operation
              );
              if (!result) {
                if (delayForPhoto > 0) {
                  await this.delay(delayForPhoto);
                  this.throwIfTrackedOperationCancelled(operation);
                }

                await semaphore.acquire();
                acquired = true;
                this.throwIfTrackedOperationCancelled(operation);

                result = await this.downloadImage(
                  photo,
                  photosDir,
                  companionDir,
                  isFeed,
                  token,
                  0,
                  operation
                );
              }
              const status = result.status;
              if (status === 'downloaded') {
                newDownloads++;
                retryAttempts += (result.attempts || 1) - 1;
                if (
                  result.recoveredAfterRetry &&
                  result.recoveredAfterRetry === true
                ) {
                  recoveredAfterRetry++;
                }
              } else if (
                status &&
                (status.startsWith('already_exists') ||
                  status.startsWith('copied_from'))
              ) {
                alreadyDownloaded++;
              } else if (status && (status === 'error' || status === 'failed')) {
                failedDownloads++;
                retryAttempts += (result.attempts || 1) - 1;
              } else if (status && status === 'cancelled') {
                skipped++;
              }
              resolve(result);
            } catch (error) {
              reject(error as Error);
            } finally {
              if (acquired) {
                semaphore.release();
              }
              processedCount++;
              progressEach();
            }
          })();
        })
      );
      delay += this.settings.interPageDelayMs;
    }

    const downloadResults: DownloadResultItem[] =
      await Promise.all<DownloadResultItem>(promises);

    return {
      downloadResults,
      alreadyDownloaded,
      newDownloads,
      failedDownloads,
      skipped,
      retryAttempts,
      recoveredAfterRetry,
      processedCount,
      queuedCount: promises.length,
    };
  }

  async downloadUserAndFeedPhotos(
    accountId: string,
    token?: string
  ): Promise<CombinedUserAndFeedDownloadResult> {
    await this.ensureSettingsLoaded();
    this.currentOperation = { cancelled: false };
    const operation = this.currentOperation;

    try {
      this.resetProgressIssueState();
      this.updateProgress('Preparing user and feed photo downloads…', 0, 0, 0);

      const accountDir = path.join(this.settings.outputRoot, accountId);
      const jsonPath = path.join(accountDir, `${accountId}_photos.json`);
      const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);

      if (!(await fs.pathExists(jsonPath))) {
        throw new Error('Photos not collected. Run collect photos first.');
      }
      if (!(await fs.pathExists(feedJsonPath))) {
        throw new Error(
          'Feed photos not collected. Run collect feed photos first.'
        );
      }

      const photosDir = path.join(accountDir, 'photos');
      const feedDir = path.join(accountDir, 'feed');
      await fs.ensureDir(photosDir);
      await fs.ensureDir(feedDir);

      const userPhotos: Photo[] = this.normalizePhotos(
        (await fs.readJson(jsonPath)) as ImageDto[]
      );
      const feedPhotos: Photo[] = this.normalizePhotos(
        (await fs.readJson(feedJsonPath)) as ImageDto[]
      );
      if (!userPhotos || userPhotos.length === 0) {
        throw new Error('No photos found in the JSON file.');
      }
      if (!feedPhotos || feedPhotos.length === 0) {
        throw new Error('No feed photos found in the JSON file.');
      }

      const userSorted = this.sortPhotosChronologically(userPhotos);
      const feedSorted = this.sortPhotosChronologically(feedPhotos);
      const userTotal = userSorted.length;
      const feedTotal = feedSorted.length;

      const maxPhotosToDownload = this.settings.maxPhotosToDownload;
      const hasDownloadLimit = !!(maxPhotosToDownload && maxPhotosToDownload > 0);

      const existingUserFiles = (await fs.readdir(photosDir)).filter(file =>
        file.toLowerCase().endsWith('.jpg')
      ).length;
      const existingFeedFiles = (await fs.readdir(feedDir)).filter(file =>
        file.toLowerCase().endsWith('.jpg')
      ).length;

      let remainingUserSlots = (maxPhotosToDownload || 0) - existingUserFiles;
      let remainingFeedSlots = (maxPhotosToDownload || 0) - existingFeedFiles;

      const countQueuedUser = hasDownloadLimit
        ? Math.min(userTotal, Math.max(0, remainingUserSlots))
        : userTotal;
      const countQueuedFeed = hasDownloadLimit
        ? Math.min(feedTotal, Math.max(0, remainingFeedSlots))
        : feedTotal;
      const totalWork = countQueuedUser + countQueuedFeed;

      let userDone = 0;
      let feedDone = 0;

      const emitCombinedProgress = () => {
        const globalDone = userDone + feedDone;
        if (totalWork <= 0) {
          return;
        }
        this.updateProgress(
          `Downloading files ${globalDone}/${totalWork} — User ${userDone}/${userTotal} · Feed ${feedDone}/${feedTotal}`,
          globalDone,
          totalWork
        );
      };

      if (hasDownloadLimit && remainingUserSlots <= 0) {
        console.log(
          `Skipping user photo downloads: limit ${maxPhotosToDownload} reached by existing files (${existingUserFiles})`
        );
      }
      if (hasDownloadLimit && remainingFeedSlots <= 0) {
        console.log(
          `Skipping feed photo downloads: limit ${maxPhotosToDownload} reached by existing files (${existingFeedFiles})`
        );
      }

      if (hasDownloadLimit && totalWork === 0) {
        this.updateProgress(
          'Download limit reached for user and feed photos',
          1,
          1,
          100
        );
        this.setOperationComplete();
        return {
          user: {
            accountId,
            photosDirectory: photosDir,
            processedCount: 0,
            downloadStats: {
              totalPhotos: userTotal,
              alreadyDownloaded: existingUserFiles,
              newDownloads: 0,
              failedDownloads: 0,
              skipped: userTotal,
              retryAttempts: 0,
              recoveredAfterRetry: 0,
            },
            downloadResults: [],
            totalResults: 0,
          },
          feed: {
            accountId,
            feedPhotosDirectory: feedDir,
            processedCount: 0,
            downloadStats: {
              totalPhotos: feedTotal,
              alreadyDownloaded: existingFeedFiles,
              newDownloads: 0,
              failedDownloads: 0,
              skipped: feedTotal,
              retryAttempts: 0,
              recoveredAfterRetry: 0,
            },
            downloadResults: [],
            totalResults: 0,
          },
        };
      }

      emitCombinedProgress();

      const userBatch = await this.downloadPhotoBatch(
        userSorted,
        photosDir,
        feedDir,
        false,
        token,
        operation,
        () => {
          userDone++;
          emitCombinedProgress();
        },
        { hasLimit: hasDownloadLimit, remainingSlots: remainingUserSlots }
      );

      if (this.isOperationCancelled()) {
        throw new Error('Operation cancelled');
      }

      const feedBatch = await this.downloadPhotoBatch(
        feedSorted,
        photosDir,
        feedDir,
        true,
        token,
        operation,
        () => {
          feedDone++;
          emitCombinedProgress();
        },
        { hasLimit: hasDownloadLimit, remainingSlots: remainingFeedSlots }
      );

      if (this.isOperationCancelled()) {
        throw new Error('Operation cancelled');
      }

      this.setOperationComplete();

      const userStats: DownloadStats = {
        totalPhotos: userTotal,
        alreadyDownloaded: userBatch.alreadyDownloaded,
        newDownloads: userBatch.newDownloads,
        failedDownloads: userBatch.failedDownloads,
        skipped: userBatch.skipped,
        retryAttempts: userBatch.retryAttempts,
        recoveredAfterRetry: userBatch.recoveredAfterRetry,
      };
      const feedStats: DownloadStats = {
        totalPhotos: feedTotal,
        alreadyDownloaded: feedBatch.alreadyDownloaded,
        newDownloads: feedBatch.newDownloads,
        failedDownloads: feedBatch.failedDownloads,
        skipped: feedBatch.skipped,
        retryAttempts: feedBatch.retryAttempts,
        recoveredAfterRetry: feedBatch.recoveredAfterRetry,
      };

      return {
        user: {
          accountId,
          photosDirectory: photosDir,
          processedCount: userBatch.processedCount,
          downloadStats: userStats,
          downloadResults: userBatch.downloadResults,
          totalResults: userBatch.downloadResults.length,
          guidance: this.buildDownloadGuidance('user photos', userStats),
        },
        feed: {
          accountId,
          feedPhotosDirectory: feedDir,
          processedCount: feedBatch.processedCount,
          downloadStats: feedStats,
          downloadResults: feedBatch.downloadResults,
          totalResults: feedBatch.downloadResults.length,
          guidance: this.buildDownloadGuidance('feed photos', feedStats),
        },
      };
    } catch (error) {
      if ((error as Error).message === 'Operation cancelled') {
        this.setOperationCancelled();
      } else {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    }
  }

  async downloadPhotos(
    accountId: string,
    token?: string
  ): Promise<DownloadResult> {
    await this.ensureSettingsLoaded();
    this.currentOperation = { cancelled: false };
    const operation = this.currentOperation;

    try {
      this.resetProgressIssueState();
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

      const photos: Photo[] = this.normalizePhotos(
        (await fs.readJson(jsonPath)) as ImageDto[]
      );
      if (!photos || photos.length === 0) {
        throw new Error('No photos found in the JSON file.');
      }

      const sortedPhotos = this.sortPhotosChronologically(photos);

      const totalPhotos = sortedPhotos.length;
      const maxPhotosToDownload = this.settings.maxPhotosToDownload;
      const hasDownloadLimit = Boolean(
        maxPhotosToDownload && maxPhotosToDownload > 0
      );

      const existingPhotoFiles = (await fs.readdir(photosDir)).filter(file =>
        file.toLowerCase().endsWith('.jpg')
      ).length;
      let remainingDownloadSlots =
        (maxPhotosToDownload || 0) - existingPhotoFiles;

      if (hasDownloadLimit && remainingDownloadSlots <= 0) {
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
            retryAttempts: 0,
            recoveredAfterRetry: 0,
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
      this.updateProgress('Downloading user photos...', 0, totalPhotos, 0);

      let processedCount = 0;
      const batch = await this.downloadPhotoBatch(
        sortedPhotos,
        photosDir,
        feedDir,
        false,
        token,
        operation,
        () => {
          processedCount++;
          this.updateProgress(
            'Downloading user photos...',
            processedCount,
            totalPhotos
          );
        },
        {
          hasLimit: hasDownloadLimit,
          remainingSlots: remainingDownloadSlots,
        }
      );

      if (this.isOperationCancelled()) {
        throw new Error('Operation cancelled');
      }

      this.setOperationComplete();

      const downloadStats: DownloadStats = {
        totalPhotos,
        alreadyDownloaded: batch.alreadyDownloaded,
        newDownloads: batch.newDownloads,
        failedDownloads: batch.failedDownloads,
        skipped: batch.skipped,
        retryAttempts: batch.retryAttempts,
        recoveredAfterRetry: batch.recoveredAfterRetry,
      };

      return {
        accountId,
        photosDirectory: photosDir,
        processedCount: batch.processedCount,
        downloadStats,
        downloadResults: batch.downloadResults,
        totalResults: batch.downloadResults.length,
        guidance: this.buildDownloadGuidance('user photos', downloadStats),
      };
    } catch (error) {
      if ((error as Error).message === 'Operation cancelled') {
        this.setOperationCancelled();
      } else {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    }
  }

  async downloadFeedPhotos(
    accountId: string,
    token?: string
  ): Promise<DownloadResult> {
    await this.ensureSettingsLoaded();
    this.currentOperation = { cancelled: false };
    const operation = this.currentOperation;

    try {
      this.resetProgressIssueState();
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

      const photos: Photo[] = this.normalizePhotos(
        (await fs.readJson(feedJsonPath)) as ImageDto[]
      );
      if (!photos || photos.length === 0) {
        throw new Error('No feed photos found in the JSON file.');
      }

      const sortedPhotos = this.sortPhotosChronologically(photos);

      const totalPhotos = sortedPhotos.length;
      const maxPhotosToDownload = this.settings.maxPhotosToDownload;
      const hasDownloadLimit = Boolean(
        maxPhotosToDownload && maxPhotosToDownload > 0
      );

      const existingFeedFiles = (await fs.readdir(feedPhotosDir)).filter(file =>
        file.toLowerCase().endsWith('.jpg')
      ).length;
      let remainingDownloadSlots =
        (maxPhotosToDownload || 0) - existingFeedFiles;

      if (this.isOperationCancelled()) {
        throw new Error('Operation cancelled');
      }

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
            retryAttempts: 0,
            recoveredAfterRetry: 0,
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
      this.updateProgress('Downloading feed photos...', 0, totalPhotos, 0);

      let processedCount = 0;
      const batch = await this.downloadPhotoBatch(
        sortedPhotos,
        photosDir,
        feedPhotosDir,
        true,
        token,
        operation,
        () => {
          processedCount++;
          this.updateProgress(
            'Downloading feed photos...',
            processedCount,
            totalPhotos
          );
        },
        {
          hasLimit: hasDownloadLimit,
          remainingSlots: remainingDownloadSlots,
        }
      );

      if (this.isOperationCancelled()) {
        throw new Error('Operation cancelled');
      }

      this.setOperationComplete();

      const downloadStats: DownloadStats = {
        totalPhotos,
        alreadyDownloaded: batch.alreadyDownloaded,
        newDownloads: batch.newDownloads,
        failedDownloads: batch.failedDownloads,
        skipped: batch.skipped,
        retryAttempts: batch.retryAttempts,
        recoveredAfterRetry: batch.recoveredAfterRetry,
      };

      return {
        accountId,
        feedPhotosDirectory: feedPhotosDir,
        processedCount: batch.processedCount,
        downloadStats,
        downloadResults: batch.downloadResults,
        totalResults: batch.downloadResults.length,
        guidance: this.buildDownloadGuidance('feed photos', downloadStats),
      };
    } catch (error) {
      if ((error as Error).message === 'Operation cancelled') {
        this.setOperationCancelled();
      } else {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    }
  }

  async downloadImage(
    photo: Photo,
    photosDir: string,
    feedPhotosDir: string,
    isFeed: boolean,
    token?: string,
    delayBeforeDownloadMs = 0,
    operation?: CurrentOperation
  ): Promise<DownloadResultItem> {
    const localResult = await this.resolveLocalDownloadResult(
      photo,
      photosDir,
      feedPhotosDir,
      isFeed,
      operation
    );
    if (localResult) {
      return localResult;
    }

    const photoId = this.normalizeId(photo.Id);
    const imageName = photo.ImageName;
    const photoUrl = buildCdnImageUrl(this.settings.cdnBase, imageName);

    const photoDir = isFeed ? feedPhotosDir : photosDir;
    const photoPath = path.join(photoDir, `${photoId}.jpg`);

    if (delayBeforeDownloadMs > 0) {
      await this.delay(delayBeforeDownloadMs);
      this.throwIfTrackedOperationCancelled(operation);
    }

    let attemptsUsed = 1;
    try {
      const attempt = await this.downloadPhotoWithRetry(
        imageName,
        token,
        operation
      );
      attemptsUsed = attempt.attempts;

      this.throwIfTrackedOperationCancelled(operation);

      let recoveredAfterRetry = false;
      if (
        attempt.attempts > 1 &&
        attempt.response?.success &&
        attempt.response.value
      ) {
        recoveredAfterRetry = true;
      }

      const response = attempt.response;
      if (response?.success && response.value) {
        const data = Buffer.from(response.value);
        await fs.writeFile(photoPath, data);
        return {
          photoId,
          status: 'downloaded',
          size: data.length,
          path: photoPath,
          url: photoUrl,
          attempts: attempt.attempts,
          retries: Math.max(0, attempt.attempts - 1),
          recoveredAfterRetry,
        };
      } else if (response) {
        return {
          photoId,
          status: 'failed',
          statusCode: response.status,
          reason: (response.message || response.error) ?? undefined,
          url: photoUrl,
          attempts: attempt.attempts,
          retries: Math.max(0, attempt.attempts - 1),
        };
      } else {
        throw attempt.error ?? new Error('Download failed after retries');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Operation cancelled') {
        throw error;
      }

      return {
        photoId,
        status: 'error',
        error: (error as Error).message,
        url: photoUrl,
        attempts: attemptsUsed,
        retries: Math.max(0, attemptsUsed - 1),
      };
    }
  }

  private async resolveLocalDownloadResult(
    photo: Photo,
    photosDir: string,
    feedPhotosDir: string,
    isFeed: boolean,
    operation?: CurrentOperation
  ): Promise<DownloadResultItem | null> {
    const photoId = this.normalizeId(photo.Id);
    const imageName = photo.ImageName;

    if (!photoId || !imageName) {
      return {
        error: 'invalid_photo_data',
        photoId,
        imageName,
        photo: JSON.stringify(photo),
      };
    }

    if (this.isTrackedOperationCancelled(operation)) {
      return {
        photoId,
        status: 'cancelled',
      };
    }

    const photoDir = isFeed ? feedPhotosDir : photosDir;
    const photoPath = path.join(photoDir, `${photoId}.jpg`);

    if (await fs.pathExists(photoPath)) {
      return {
        photoId,
        status: isFeed ? 'already_exists_in_feed' : 'already_exists_in_photos',
        path: photoPath,
      };
    }

    const otherPhotoPath = path.join(
      isFeed ? photosDir : feedPhotosDir,
      `${photoId}.jpg`
    );
    if (await fs.pathExists(otherPhotoPath)) {
      await fs.copy(otherPhotoPath, photoPath);
      return {
        photoId,
        status: isFeed ? 'copied_from_photos' : 'copied_from_feed',
        sourcePath: otherPhotoPath,
        destinationPath: photoPath,
      };
    }

    return null;
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

  private normalizePhotos(photos: Array<ImageDto | Photo>): Photo[] {
    return photos.map(photo => this.normalizePhotoItem(photo));
  }

  private normalizePhotoItem(photo: ImageDto | Photo): Photo {
    const normalizedTagged =
      Array.isArray(photo.TaggedPlayerIds) && photo.TaggedPlayerIds.length > 0
        ? photo.TaggedPlayerIds.map(id => this.normalizeId(id)).filter(Boolean)
        : [];
    const normalizedPlayerEventId = this.normalizeId(photo.PlayerEventId);
    // EventId and EventInstanceId only exist on Photo, not ImageDto
    const photoFields = photo as Photo;
    const normalizedEventId = this.normalizeId(photoFields.EventId);
    const normalizedEventInstanceId = this.normalizeId(
      photoFields.EventInstanceId
    );

    return {
      ...photo,
      Id: this.normalizeId(photo.Id),
      PlayerId: this.normalizeId(photo.PlayerId),
      RoomId: this.normalizeId(photo.RoomId),
      PlayerEventId: normalizedPlayerEventId || undefined,
      EventId: normalizedEventId || undefined,
      EventInstanceId: normalizedEventInstanceId || undefined,
      TaggedPlayerIds: normalizedTagged,
    };
  }

  private normalizeAccounts(accounts: PlayerResult[]): PlayerResult[] {
    return accounts.map(account => ({
      ...account,
      accountId: this.normalizeId(account.accountId),
    }));
  }

  private getFolderMetaPath(accountDir: string): string {
    return path.join(accountDir, 'folder-meta.json');
  }

  private async readFolderMeta(
    accountDir: string
  ): Promise<FolderMetaV1 | null> {
    try {
      const metaPath = this.getFolderMetaPath(accountDir);
      if (!(await fs.pathExists(metaPath))) {
        return null;
      }
      const parsed = (await fs.readJson(metaPath)) as Partial<FolderMetaV1>;
      if (!parsed || parsed.schemaVersion !== 1 || !parsed.accountId) {
        return null;
      }
      return parsed as FolderMetaV1;
    } catch {
      return null;
    }
  }

  private async writeFolderMeta(
    accountDir: string,
    accountId: string,
    patch: Partial<FolderMetaV1>
  ): Promise<void> {
    const metaPath = this.getFolderMetaPath(accountDir);
    const existing = (await this.readFolderMeta(accountDir)) ?? null;
    const next: FolderMetaV1 = {
      schemaVersion: 1,
      accountId: this.normalizeId(accountId),
      updatedAt: new Date().toISOString(),
      owner: existing?.owner,
      cache: existing?.cache,
      ...patch,
    };

    // Shallow-merge owner/cache so future additions don't get dropped.
    next.owner = {
      ...(existing?.owner ?? {}),
      ...(patch.owner ?? {}),
      accountId: this.normalizeId(
        patch.owner?.accountId ?? existing?.owner?.accountId ?? accountId
      ),
    };
    next.cache = { ...(existing?.cache ?? {}), ...(patch.cache ?? {}) };

    await fs.writeJson(metaPath, next, { spaces: 2 });
  }

  private computeOwnerFromAccounts(
    accounts: PlayerResult[],
    ownerAccountId: string
  ): FolderMetaOwner | null {
    const normalizedOwnerId = this.normalizeId(ownerAccountId);
    const owner = accounts.find(
      a => this.normalizeId(a.accountId) === normalizedOwnerId
    );
    if (!owner) {
      return null;
    }
    const username = (owner.username || '').trim() || undefined;
    const displayName = (owner.displayName || '').trim() || undefined;
    const displayLabel = this.formatOwnerDisplayLabel({
      ownerAccountId: normalizedOwnerId,
      displayName,
      username,
    });
    return {
      accountId: normalizedOwnerId,
      username,
      displayName,
      displayLabel,
    };
  }

  private formatOwnerDisplayLabel(params: {
    ownerAccountId: string;
    displayName?: string;
    username?: string;
  }): string {
    const ownerAccountId = this.normalizeId(params.ownerAccountId);
    const displayName = (params.displayName || '').trim() || undefined;
    const username = (params.username || '').trim() || undefined;

    if (displayName && username) {
      return `${displayName} (@${username})`;
    }
    if (displayName) {
      return displayName;
    }
    if (username) {
      return `@${username}`;
    }
    return ownerAccountId;
  }

  private normalizeRooms(rooms: RoomDto[]): RoomDto[] {
    return rooms.map(room => ({
      ...room,
      RoomId: this.normalizeId(room.RoomId),
      CreatorAccountId: this.normalizeId(room.CreatorAccountId),
      RankedEntityId: this.normalizeId(room.RankedEntityId),
    }));
  }

  private normalizeEvents(events: EventDto[]): EventDto[] {
    return events.map(event => ({
      ...event,
      PlayerEventId: this.normalizeId(event.PlayerEventId),
      CreatorPlayerId: this.normalizeId(event.CreatorPlayerId),
      RoomId: this.normalizeId(event.RoomId),
    }));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private createProgressState(overrides: Partial<Progress>): Progress {
    return {
      isRunning: false,
      currentStep: 'Ready',
      progress: 0,
      total: 0,
      current: 0,
      progressPhase: 'metadata',
      statusLevel: 'info',
      issueCount: 0,
      retryAttempts: 0,
      failedItems: 0,
      recoveredAfterRetry: 0,
      lastIssue: undefined,
      ...overrides,
    };
  }

  private resetProgressIssueState(): void {
    this.progress = this.createProgressState({
      ...this.progress,
      statusLevel: 'info',
      issueCount: 0,
      retryAttempts: 0,
      failedItems: 0,
      recoveredAfterRetry: 0,
      lastIssue: undefined,
    });
  }

  private markProgressIssue(
    level: 'warning' | 'error',
    message: string,
    options?: { retryIncrement?: number; failedItemIncrement?: number }
  ): void {
    const retryIncrement = options?.retryIncrement ?? 0;
    const failedItemIncrement = options?.failedItemIncrement ?? 0;
    const failedItems = this.progress.failedItems + failedItemIncrement;

    this.progress = this.createProgressState({
      ...this.progress,
      statusLevel: level === 'error' || failedItems > 0 ? 'error' : 'warning',
      issueCount: this.progress.issueCount + 1,
      retryAttempts: this.progress.retryAttempts + retryIncrement,
      failedItems,
      lastIssue: message,
    });
    this.emit('progress-update', this.progress);
  }

  private markProgressRecovery(message: string): void {
    this.progress = this.createProgressState({
      ...this.progress,
      statusLevel: this.progress.failedItems > 0 ? 'error' : 'warning',
      recoveredAfterRetry: this.progress.recoveredAfterRetry + 1,
      lastIssue: message,
    });
    this.emit('progress-update', this.progress);
  }

  private async downloadPhotoWithRetry(
    imageName: string,
    token?: string,
    operation?: CurrentOperation
  ): Promise<PhotoDownloadAttempt> {
    let attempts = 0;
    let lastResponse: PhotoDownloadAttempt['response'];
    let lastError: Error | undefined;

    while (attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS) {
      this.throwIfTrackedOperationCancelled(operation);

      attempts++;

      try {
        const response = await this.photosController.downloadPhoto(
          imageName,
          this.settings.cdnBase,
          token
        );
        if (response?.success && response.value) {
          if (attempts > 1) {
            this.markProgressRecovery(
              `Recovered ${imageName} after ${attempts - 1} retr${
                attempts - 1 === 1 ? 'y' : 'ies'
              }. Download is continuing.`
            );
          }
          return { response, attempts };
        }

        if (
          response?.error === 'ERR_CANCELED' ||
          response?.message === 'Operation cancelled' ||
          this.isTrackedOperationCancelled(operation)
        ) {
          throw new Error('Operation cancelled');
        }

        lastResponse = response ?? {
          success: false,
          value: null,
          error: 'No response returned from photo download',
        };
        const failureReason =
          lastResponse.message ||
          lastResponse.error ||
          (lastResponse.status
            ? `HTTP ${lastResponse.status}`
            : 'unknown_error');
        const issueMessage =
          attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS
            ? `Issue downloading ${imageName}: ${failureReason}. Retry ${attempts}/${PHOTO_DOWNLOAD_RETRY_COUNT} will start now.`
            : `Download failed for ${imageName}: ${failureReason}.`;
        this.markProgressIssue(
          attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS ? 'warning' : 'error',
          issueMessage,
          {
            retryIncrement: attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS ? 1 : 0,
            failedItemIncrement:
              attempts >= PHOTO_DOWNLOAD_MAX_ATTEMPTS ? 1 : 0,
          }
        );
        console.warn(
          `Photo download attempt ${attempts}/${PHOTO_DOWNLOAD_MAX_ATTEMPTS} failed for ${imageName}: ${
            lastResponse.message ||
            lastResponse.error ||
            lastResponse.status ||
            'unknown_error'
          }`
        );
      } catch (error) {
        lastError = error as Error;
        if (lastError.message === 'Operation cancelled') {
          throw lastError;
        }
        const failureReason = lastError.message || 'unknown_error';
        const issueMessage =
          attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS
            ? `Issue downloading ${imageName}: ${failureReason}. Retry ${attempts}/${PHOTO_DOWNLOAD_RETRY_COUNT} will start now.`
            : `Download failed for ${imageName}: ${failureReason}.`;
        this.markProgressIssue(
          attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS ? 'warning' : 'error',
          issueMessage,
          {
            retryIncrement: attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS ? 1 : 0,
            failedItemIncrement:
              attempts >= PHOTO_DOWNLOAD_MAX_ATTEMPTS ? 1 : 0,
          }
        );
        console.warn(
          `Photo download attempt ${attempts}/${PHOTO_DOWNLOAD_MAX_ATTEMPTS} failed for ${imageName}: ${lastError.message}`
        );
      }

      if (attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS) {
        this.throwIfTrackedOperationCancelled(operation);
        await this.delay(PHOTO_DOWNLOAD_RETRY_DELAY_MS);
      }
    }

    if (lastResponse) {
      return {
        response: lastResponse,
        error: lastError,
        attempts,
      };
    }

    if (lastError) {
      return { error: lastError, attempts };
    }

    return {
      error: new Error('Download failed after retries'),
      attempts,
    };
  }

  private buildDownloadGuidance(
    label: string,
    stats: DownloadStats
  ): string[] | undefined {
    if (stats.failedDownloads === 0) {
      return undefined;
    }

    return [
      `Some ${label} could not be downloaded after ${PHOTO_DOWNLOAD_RETRY_COUNT} retries, but the download completed.`,
      'You can retry the same download after it finishes to grab any missed images. Existing files are checked first, so the app will continue from what is already saved.',
      'You do not need to delete the output folder to resume.',
    ];
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
      if (photo.RoomId) {
        roomIds.add(photo.RoomId);
      }

      if (photo.PlayerId) {
        accountIds.add(photo.PlayerId);
      }

      if (Array.isArray(photo.TaggedPlayerIds)) {
        photo.TaggedPlayerIds.forEach(tagged => {
          if (tagged) {
            accountIds.add(tagged);
          }
        });
      }

      if (photo.PlayerEventId) {
        eventIds.add(photo.PlayerEventId);
      }
      if (photo.EventId) {
        eventIds.add(photo.EventId);
      }
      if (photo.EventInstanceId) {
        eventIds.add(photo.EventInstanceId);
      }
    }

    return { accountIds, roomIds, eventIds };
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
    await this.ensureSettingsLoaded();
    try {
      const {
        forceAccountsRefresh = false,
        forceRoomsRefresh = false,
        forceEventsRefresh = false,
      } = options;
      this.throwIfCancelled();
      const normalizedPhotos = this.normalizePhotos(photos);
      this.updateProgress('Extracting IDs from photos…', 0, 0, 0);

      // Extract unique IDs
      const { accountIds, roomIds, eventIds } =
        this.extractUniqueIds(normalizedPhotos);
      const accountIdsArray = Array.from(accountIds);
      const roomIdsArray = Array.from(roomIds);
      const eventIdsArray = Array.from(eventIds);
      this.updateProgress(
        `Resolving related data: ${accountIdsArray.length} accounts, ${roomIdsArray.length} rooms, ${eventIdsArray.length} events…`,
        0,
        0,
        0
      );

      console.log(
        `Found ${accountIdsArray.length} unique account IDs, ${roomIdsArray.length} unique room IDs, and ${eventIdsArray.length} unique event IDs`
      );

      this.throwIfCancelled();
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
        this.throwIfCancelled();
        this.updateProgress('Checking account cache…', 0, 0, 0);

        let cachedAccounts: PlayerResult[] = [];
        let cachedAccountIds = new Set<string>();

        if (accountsFileExists) {
          try {
            const existing = (await fs.readJson(
              accountsJsonPath
            )) as PlayerResult[];
            if (Array.isArray(existing)) {
              cachedAccounts = this.normalizeAccounts(existing);
              cachedAccountIds = new Set(
                cachedAccounts
                  .map(account => account.accountId)
                  .filter((id): id is string => !!id)
              );
              // Normalize and persist cached data to keep IDs consistent
              await fs.writeJson(accountsJsonPath, cachedAccounts, {
                spaces: 2,
              });

              const owner = this.computeOwnerFromAccounts(
                cachedAccounts,
                accountId
              );
              if (owner) {
                await this.writeFolderMeta(accountDir, accountId, { owner });
              }
            }
          } catch (error) {
            console.log(
              `Warning: Failed to normalize cached account data: ${(error as Error).message}`
            );
          }
        }

        const missingAccountIds =
          accountsFileExists && !forceAccountsRefresh
            ? accountIdsArray.filter(id => !cachedAccountIds.has(String(id)))
            : accountIdsArray;

        if (missingAccountIds.length === 0) {
          this.updateProgress('Using cached account data.', 0, 0, 0);
        } else {
          this.throwIfCancelled();
          this.updateProgress(
            `Downloading account data (${missingAccountIds.length} missing of ${accountIdsArray.length})…`,
            0,
            0,
            0
          );

          const accountsData = await this.accountsController.fetchBulkAccounts(
            missingAccountIds,
            token
          );
          this.throwIfCancelled();
          const normalizedAccounts = Array.isArray(accountsData)
            ? this.normalizeAccounts(accountsData)
            : [];
          accountsFetched = normalizedAccounts.length;

          // Merge new data with cached data (prefer freshly downloaded entries)
          const mergedAccountsMap = new Map<string, PlayerResult>();
          for (const account of cachedAccounts) {
            mergedAccountsMap.set(account.accountId, account);
          }
          for (const account of normalizedAccounts) {
            mergedAccountsMap.set(account.accountId, account);
          }

          const mergedAccounts = Array.from(mergedAccountsMap.values());
          await fs.writeJson(accountsJsonPath, mergedAccounts, {
            spaces: 2,
          });

          const owner = this.computeOwnerFromAccounts(
            mergedAccounts,
            accountId
          );
          if (owner) {
            await this.writeFolderMeta(accountDir, accountId, { owner });
          }
          console.log(
            `Saved ${mergedAccounts.length} accounts to ${accountsJsonPath} (downloaded ${normalizedAccounts.length} new entries)`
          );

          this.updateProgress('Account data updated.', 0, 0, 0);
        }
      }

      // Fetch and save room data
      if (roomIdsArray.length > 0) {
        this.throwIfCancelled();
        this.updateProgress('Checking rooms cache…', 0, 0, 0);

        let cachedRooms: RoomDto[] = [];
        let cachedRoomIds = new Set<string>();

        if (roomsFileExists) {
          try {
            const existing = (await fs.readJson(roomsJsonPath)) as RoomDto[];
            if (Array.isArray(existing)) {
              cachedRooms = this.normalizeRooms(existing);
              cachedRoomIds = new Set(cachedRooms.map(room => room.RoomId));
              await fs.writeJson(roomsJsonPath, cachedRooms, { spaces: 2 });
            }
          } catch (error) {
            console.log(
              `Warning: Failed to normalize cached room data: ${(error as Error).message}`
            );
          }
        }

        const missingRoomIds =
          roomsFileExists && !forceRoomsRefresh
            ? roomIdsArray.filter(id => !cachedRoomIds.has(String(id)))
            : roomIdsArray;

        if (missingRoomIds.length === 0) {
          this.updateProgress('Using cached room data.', 0, 0, 0);
        } else {
          this.throwIfCancelled();
          this.updateProgress(
            `Downloading room data (${missingRoomIds.length} missing of ${roomIdsArray.length})…`,
            0,
            0,
            0
          );
          const roomsData = await this.roomsController.fetchBulkRooms(
            missingRoomIds,
            token
          );
          this.throwIfCancelled();
          const normalizedRooms = Array.isArray(roomsData)
            ? this.normalizeRooms(roomsData)
            : [];
          roomsFetched = normalizedRooms.length;

          const mergedRoomsMap = new Map<string, RoomDto>();
          for (const room of cachedRooms) {
            mergedRoomsMap.set(room.RoomId, room);
          }
          for (const room of normalizedRooms) {
            mergedRoomsMap.set(room.RoomId, room);
          }

          const mergedRooms = Array.from(mergedRoomsMap.values());
          await fs.writeJson(roomsJsonPath, mergedRooms, { spaces: 2 });
          console.log(
            `Saved ${mergedRooms.length} rooms to ${roomsJsonPath} (downloaded ${normalizedRooms.length} new entries)`
          );

          this.updateProgress('Room data updated.', 0, 0, 0);
        }
      }

      // Fetch and save event data
      if (eventIdsArray.length > 0) {
        this.throwIfCancelled();
        this.updateProgress('Checking events cache…', 0, 0, 0);

        let cachedEvents: EventDto[] = [];
        let cachedEventIds = new Set<string>();

        if (eventsFileExists) {
          try {
            const existing = (await fs.readJson(eventsJsonPath)) as EventDto[];
            if (Array.isArray(existing)) {
              cachedEvents = this.normalizeEvents(existing);
              cachedEventIds = new Set(
                cachedEvents
                  .map(event => event.PlayerEventId)
                  .filter((id): id is string => !!id)
              );
              await fs.writeJson(eventsJsonPath, cachedEvents, { spaces: 2 });
            }
          } catch (error) {
            console.log(
              `Warning: Failed to normalize cached event data: ${(error as Error).message}`
            );
          }
        }

        const missingEventIds =
          eventsFileExists && !forceEventsRefresh
            ? eventIdsArray.filter(id => !cachedEventIds.has(String(id)))
            : eventIdsArray;

        if (missingEventIds.length === 0) {
          this.updateProgress('Using cached event data.', 0, 0, 0);
        } else {
          this.throwIfCancelled();
          this.updateProgress(
            `Downloading event data (${missingEventIds.length} missing of ${eventIdsArray.length})…`,
            0,
            0,
            0
          );
          const eventsData = await this.eventsController.fetchBulkEvents(
            missingEventIds,
            token
          );
          this.throwIfCancelled();
          const normalizedEvents = Array.isArray(eventsData)
            ? this.normalizeEvents(eventsData)
            : [];
          eventsFetched = normalizedEvents.length;

          const mergedEventsMap = new Map<string, EventDto>();
          for (const event of cachedEvents) {
            mergedEventsMap.set(event.PlayerEventId, event);
          }
          for (const event of normalizedEvents) {
            mergedEventsMap.set(event.PlayerEventId, event);
          }

          const mergedEvents = Array.from(mergedEventsMap.values());
          await fs.writeJson(eventsJsonPath, mergedEvents, { spaces: 2 });
          console.log(
            `Saved ${mergedEvents.length} events to ${eventsJsonPath} (downloaded ${normalizedEvents.length} new entries)`
          );

          this.updateProgress('Event data updated.', 0, 0, 0);
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

  async lookupAccountById(accountId: string): Promise<AccountInfo> {
    this.currentOperation = { cancelled: false };
    try {
      return await this.accountsController.lookupAccountById(accountId);
    } catch (error) {
      if ((error as Error).message === 'Operation cancelled') {
        this.setOperationCancelled();
        throw error;
      }
      throw new Error(
        `Failed to lookup account by account ID: ${(error as Error).message}`
      );
    } finally {
      if (this.currentOperation && !this.currentOperation.cancelled) {
        this.currentOperation = null;
      }
    }
  }

  async lookupAccountByUsername(username: string): Promise<AccountInfo> {
    this.currentOperation = { cancelled: false };
    try {
      return await this.accountsController.lookupAccountByUsername(username);
    } catch (error) {
      if ((error as Error).message === 'Operation cancelled') {
        this.setOperationCancelled();
        throw error;
      }
      throw new Error(
        `Failed to lookup account by username: ${(error as Error).message}`
      );
    } finally {
      if (this.currentOperation && !this.currentOperation.cancelled) {
        this.currentOperation = null;
      }
    }
  }

  async searchAccounts(
    username: string,
    token?: string
  ): Promise<AccountInfo[]> {
    this.currentOperation = { cancelled: false };
    try {
      return await this.accountsController.searchAccounts(username, token);
    } catch (error) {
      if ((error as Error).message === 'Operation cancelled') {
        this.setOperationCancelled();
        throw error;
      }
      throw new Error(`Failed to search accounts: ${(error as Error).message}`);
    } finally {
      if (this.currentOperation && !this.currentOperation.cancelled) {
        this.currentOperation = null;
      }
    }
  }

  async resetAppState(): Promise<{
    removedAccountDirectories: number;
    removedLegacyFiles: number;
  }> {
    await this.ensureSettingsLoaded();
    let removedAccountDirectories = 0;
    let removedLegacyFiles = 0;
    const currentOutputRoot = this.settings.outputRoot;

    try {
      if (await fs.pathExists(currentOutputRoot)) {
        const entries = await fs.readdir(currentOutputRoot, {
          withFileTypes: true,
        });

        for (const entry of entries) {
          const entryPath = path.join(currentOutputRoot, entry.name);

          if (entry.isDirectory()) {
            const metadataFiles = [
              `${entry.name}_photos.json`,
              `${entry.name}_feed.json`,
              `${entry.name}_accounts.json`,
              `${entry.name}_rooms.json`,
              `${entry.name}_events.json`,
            ];

            let hasAppMetadata = false;
            for (const metadataFile of metadataFiles) {
              if (await fs.pathExists(path.join(entryPath, metadataFile))) {
                hasAppMetadata = true;
                break;
              }
            }

            if (hasAppMetadata) {
              await fs.remove(entryPath);
              removedAccountDirectories++;
            }
          } else if (entry.isFile()) {
            const isLegacyMetadata =
              /.+_(photos|feed|accounts|rooms|events)\.json$/i.test(entry.name);
            if (isLegacyMetadata) {
              await fs.remove(entryPath);
              removedLegacyFiles++;
            }
          }
        }
      }

      this.settings = { ...DEFAULT_SETTINGS };
      this.currentOperation = null;
      this.progress = this.createProgressState({
        isRunning: false,
        currentStep: 'Ready',
        progress: 0,
        total: 0,
        current: 0,
      });
      this.ensureOutputDirectory();
      await this.saveSettings();
      this.emit('progress-update', this.progress);

      return { removedAccountDirectories, removedLegacyFiles };
    } catch (error) {
      throw new Error(`Failed to reset app state: ${(error as Error).message}`);
    }
  }
  async clearAccountData(accountId: string): Promise<{ filesRemoved: number }> {
    await this.ensureSettingsLoaded();
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
      displayLabel?: string;
    }>
  > {
    await this.ensureSettingsLoaded();
    const accounts: Array<{
      accountId: string;
      hasPhotos: boolean;
      hasFeed: boolean;
      photoCount: number;
      feedCount: number;
      displayLabel?: string;
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
        const accountsJsonPath = path.join(
          accountDir,
          `${accountId}_accounts.json`
        );

        let hasPhotos = false;
        let hasFeed = false;
        let photoCount = 0;
        let feedCount = 0;
        let displayLabel: string | undefined;

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
          // Prefer small folder metadata for owner display.
          const meta = await this.readFolderMeta(accountDir);
          if (meta?.owner) {
            // Compute label from fields so older metas can be upgraded automatically.
            const computedLabel = this.formatOwnerDisplayLabel({
              ownerAccountId: accountId,
              displayName: meta.owner.displayName,
              username: meta.owner.username,
            });
            displayLabel = computedLabel;

            if (meta.owner.displayLabel !== computedLabel) {
              await this.writeFolderMeta(accountDir, accountId, {
                owner: { ...meta.owner, displayLabel: computedLabel },
              });
            }
          } else {
            displayLabel = undefined;
          }

          // One-time backfill for legacy folders: derive owner from accounts cache once.
          if (!displayLabel && (await fs.pathExists(accountsJsonPath))) {
            try {
              const accountsData = (await fs.readJson(
                accountsJsonPath
              )) as PlayerResult[];
              const normalized = Array.isArray(accountsData)
                ? this.normalizeAccounts(accountsData)
                : [];
              const owner = this.computeOwnerFromAccounts(
                normalized,
                accountId
              );
              if (owner) {
                displayLabel = owner.displayLabel;
                await this.writeFolderMeta(accountDir, accountId, { owner });
              }
            } catch {
              // ignore backfill errors; fallback to showing id
            }
          }

          accounts.push({
            accountId,
            hasPhotos,
            hasFeed,
            photoCount,
            feedCount,
            displayLabel,
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
