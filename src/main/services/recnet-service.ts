import * as fs from 'fs-extra';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as os from 'os';
import {
  RecNetSettings,
  Progress,
  CollectionResult,
  DownloadPreflightSourceSummary,
  DownloadPreflightSummary,
  DownloadResult,
  ProfileHistoryAccessResult,
  ProfileHistoryCollectionResult,
  Photo,
  IterationDetail,
  DownloadResultItem,
  DownloadStats,
  AccountInfo,
  BulkDataRefreshOptions,
  AvailableEvent,
  AvailableEventCreator,
  AvailableRoom,
  EventDiscoveryResult,
  EventPhotoBatchResult,
  RoomPhotoBatchResult,
  RoomPhotoSort,
  LibraryMoveProgress,
  LibraryMoveResult,
} from '../../shared/types';
import { buildCdnImageUrl, DEFAULT_CDN_BASE } from '../../shared/cdnUrl';
import {
  DownloadSource,
  DownloadSourceSelection,
  getSelectedDownloadSources,
} from '../../shared/download-sources';
import { EventDto } from '../models/EventDto';
import { ImageCommentDto } from '../models/ImageCommentDto';
import { ImageDto } from '../models/ImageDto';
import { PlayerResult } from '../models/PlayerDto';
import { ProfileHistoryImageDto } from '../models/ProfileHistoryImageDto';
import { RoomDto } from '../models/RoomDto';
import { AccountsController } from './recnet/accounts-controller';
import { EventsController } from './recnet/events-controller';
import { RecNetHttpClient } from './recnet/http-client';
import { ImageCommentsController } from './recnet/image-comments-controller';
import { PhotosController } from './recnet/photos-controller';
import { RoomsController } from './recnet/rooms-controller';
import { Semaphore } from '../utils/semaphore';
import {
  LibraryMoveCancelledError,
  pathsEffectivelyEqual,
  removePartialLibraryCopy,
  runLibraryMove,
} from './library-move';

/** Absolute directory used for reads/writes; empty if `outputRoot` is unset. */
export function computeResolvedOutputRoot(outputRoot: string): string {
  const t = typeof outputRoot === 'string' ? outputRoot.trim() : '';
  if (!t) {
    return '';
  }
  return path.isAbsolute(t) ? t : path.resolve(process.cwd(), t);
}

export function isOutputRootConfiguredForWrites(outputRoot: string): boolean {
  const root = typeof outputRoot === 'string' ? outputRoot.trim() : '';
  if (!root) {
    return false;
  }
  return path.isAbsolute(root);
}

export function describeOutputConfigurationError(settings: {
  outputRoot: string;
}): string | null {
  if (isOutputRootConfiguredForWrites(settings.outputRoot)) {
    return null;
  }
  if (!settings.outputRoot.trim()) {
    return 'Choose an output folder before downloading or saving data.';
  }
  return 'Choose an absolute output folder path (use Browse) before downloading or saving data.';
}

interface CurrentOperation {
  cancelled: boolean;
  controller: AbortController;
}

type ErrorWithCode = Error & {
  code?: string;
};

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

type JwtPayload = {
  sub?: string;
  exp?: number;
};

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

type RoomFolderMetaV1 = {
  schemaVersion: 1;
  roomId: string;
  roomName: string;
  displayLabel: string;
  updatedAt: string;
  nextSkip?: number;
  roomPhotoCursors?: Partial<
    Record<
      RoomPhotoSort,
      {
        nextSkip?: number;
        completed?: boolean;
        updatedAt?: string;
      }
    >
  >;
  cache?: Record<string, unknown>;
};

type EventFolderMetaV1 = {
  schemaVersion: 1;
  creatorAccountId: string;
  eventId: string;
  name: string;
  imageName?: string | null;
  startTime?: string;
  endTime?: string;
  attendeeCount: number;
  photoCount: number;
  downloadedPhotoCount: number;
  hasPhotos: boolean;
  isDownloaded: boolean;
  updatedAt: string;
};

type BulkDataStorageContext = {
  directory: string;
  fileStem: string;
  writeOwnerMeta?: boolean;
};

type DownloadBatchTrace = {
  label: string;
  startedAt: number;
  totalPhotos: number;
  maxConcurrentDownloads: number;
  interPageDelayMs: number;
  inFlight: number;
  completed: number;
};

const DEFAULT_SETTINGS: RecNetSettings = {
  outputRoot: '',
  cdnBase: DEFAULT_CDN_BASE,
  interPageDelayMs: 100,
  maxConcurrentDownloads: 3,
};

const PHOTO_DOWNLOAD_RETRY_COUNT = 3;
const PHOTO_DOWNLOAD_MAX_ATTEMPTS = PHOTO_DOWNLOAD_RETRY_COUNT + 1;
const PHOTO_DOWNLOAD_RETRY_DELAY_MS = 750;
const PHOTO_DOWNLOAD_TIMEOUT_MS = 15_000;
const PHOTO_MAX_PAGE_SIZE = 1_000;
const ROOM_PHOTO_DEFAULT_PAGE_SIZE = 100;
const ROOM_PHOTO_DEFAULT_BATCH_PAGES = 5;
const ROOM_PHOTO_DEFAULT_SORT: RoomPhotoSort = 0;
const EVENT_DISCOVERY_PAGE_SIZE = 50;
const EVENT_PHOTO_PAGE_SIZE = 100;
// RecNet API returns 429s for this if requested too frequently.
// Serialized globally: one in-flight request and minimum gap between starts.
const IMAGE_COMMENT_REQUEST_MIN_INTERVAL_MS = 250;

type PersistedRecNetSettings = Omit<
  RecNetSettings,
  | 'interPageDelayMs'
  | 'maxConcurrentDownloads'
  | 'resolvedOutputRoot'
  | 'outputPathConfiguredForDownload'
>;

function normalizeRecNetSettings(input: unknown): RecNetSettings {
  const raw =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};

  const interRaw = raw.interPageDelayMs;
  const interPageDelayMs =
    typeof interRaw === 'number' && Number.isFinite(interRaw)
      ? Math.min(1000, Math.max(0, Math.floor(interRaw)))
      : DEFAULT_SETTINGS.interPageDelayMs;

  const maxConcurrentRaw = raw.maxConcurrentDownloads;
  const maxConcurrentDownloads =
    typeof maxConcurrentRaw === 'number' && Number.isFinite(maxConcurrentRaw)
      ? Math.min(30, Math.max(1, Math.floor(maxConcurrentRaw)))
      : DEFAULT_SETTINGS.maxConcurrentDownloads;

  const maxRaw = raw.maxPhotosToDownload;
  const maxPhotosToDownload =
    typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw > 0
      ? Math.floor(maxRaw)
      : undefined;

  const outputRoot =
    typeof raw.outputRoot === 'string' ? raw.outputRoot.trim() : '';

  return {
    outputRoot,
    cdnBase:
      typeof raw.cdnBase === 'string' && raw.cdnBase.length > 0
        ? raw.cdnBase
        : DEFAULT_SETTINGS.cdnBase,
    interPageDelayMs,
    maxPhotosToDownload,
    maxConcurrentDownloads,
  };
}

function extractPersistedRecNetSettings(
  input: unknown
): Partial<PersistedRecNetSettings> {
  const raw =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};

  return {
    outputRoot:
      typeof raw.outputRoot === 'string' && raw.outputRoot.length > 0
        ? raw.outputRoot
        : undefined,
    cdnBase:
      typeof raw.cdnBase === 'string' && raw.cdnBase.length > 0
        ? raw.cdnBase
        : undefined,
    maxPhotosToDownload:
      typeof raw.maxPhotosToDownload === 'number' &&
      Number.isFinite(raw.maxPhotosToDownload) &&
      raw.maxPhotosToDownload > 0
        ? Math.floor(raw.maxPhotosToDownload)
        : undefined,
  };
}

function hasLegacyRuntimeOnlySettings(input: unknown): boolean {
  if (!input || typeof input !== 'object') {
    return false;
  }

  const raw = input as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(raw, 'interPageDelayMs') ||
    Object.prototype.hasOwnProperty.call(raw, 'maxConcurrentDownloads')
  );
}

export class RecNetService extends EventEmitter {
  private settingsPath: string;
  private settings: RecNetSettings;
  private settingsLoaded: Promise<void>;
  private currentOperation: CurrentOperation | null = null;
  private libraryMoveInProgress = false;
  private libraryMoveAbort: AbortController | null = null;
  private progress: Progress;
  private httpClient: RecNetHttpClient;
  private photosController: PhotosController;
  private accountsController: AccountsController;
  private roomsController: RoomsController;
  private eventsController: EventsController;
  private imageCommentsController: ImageCommentsController;
  /** Serializes image-comment HTTP calls across overlapping downloads. */
  private imageCommentRequestGate: Promise<void> = Promise.resolve();
  private lastImageCommentRequestStartedAt = 0;

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
      phase: 'complete',
      currentStep: '',
      progress: 0,
      total: 0,
      current: 0,
    });

    this.httpClient = new RecNetHttpClient();
    this.syncHttpClientSettings();
    this.photosController = new PhotosController(this.httpClient);
    this.accountsController = new AccountsController(this.httpClient);
    this.roomsController = new RoomsController(this.httpClient);
    this.eventsController = new EventsController(this.httpClient);
    this.imageCommentsController = new ImageCommentsController(this.httpClient);

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
        const savedRecord = savedSettings as Record<string, unknown>;

        this.settings = normalizeRecNetSettings({
          ...DEFAULT_SETTINGS,
          ...extractPersistedRecNetSettings(savedSettings),
        });

        let shouldRewriteDisk = false;
        const root = this.settings.outputRoot.trim();
        if (root !== '' && !path.isAbsolute(root)) {
          this.settings = { ...this.settings, outputRoot: '' };
          shouldRewriteDisk = true;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            savedRecord,
            'legacyRelativeOutputAllowed'
          )
        ) {
          shouldRewriteDisk = true;
        }
        if (hasLegacyRuntimeOnlySettings(savedSettings)) {
          shouldRewriteDisk = true;
        }

        if (shouldRewriteDisk) {
          await this.saveSettings();
        }
      } else {
        this.settings = normalizeRecNetSettings({
          ...DEFAULT_SETTINGS,
        });
      }
    } catch (error) {
      console.log('Failed to load settings:', (error as Error).message);
    }
    this.syncHttpClientSettings();
    console.log('Settings loaded from disk:', this.settings);
    // Ensure output directory exists
    this.ensureOutputDirectory();
  }

  async saveSettings(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.settingsPath));
      const persistedSettings = this.getPersistedSettingsForDisk();
      await fs.writeJson(this.settingsPath, persistedSettings, { spaces: 2 });
      console.log('Settings saved to disk:', persistedSettings);
    } catch (error) {
      console.log('Failed to save settings:', (error as Error).message);
    }
  }

  private getResolvedOutputRoot(): string {
    return computeResolvedOutputRoot(this.settings.outputRoot);
  }

  private ensureOutputDirectory(): void {
    const resolved = this.getResolvedOutputRoot();
    if (!resolved) {
      return;
    }
    fs.ensureDirSync(resolved);
  }

  private syncHttpClientSettings(): void {
    this.httpClient.setRequestDelayMs(this.settings.interPageDelayMs || 100);
  }

  private getPersistedSettingsForDisk(): PersistedRecNetSettings {
    return {
      outputRoot: this.settings.outputRoot,
      cdnBase: this.settings.cdnBase,
      maxPhotosToDownload: this.settings.maxPhotosToDownload,
    };
  }

  async getOutputConfigurationError(): Promise<string | null> {
    await this.ensureSettingsLoaded();
    if (this.libraryMoveInProgress) {
      return 'Photo library move in progress. Wait for it to finish or cancel it.';
    }
    return describeOutputConfigurationError(this.settings);
  }

  isLibraryMoveInProgress(): boolean {
    return this.libraryMoveInProgress;
  }

  cancelLibraryMove(): boolean {
    if (this.libraryMoveAbort && !this.libraryMoveAbort.signal.aborted) {
      this.libraryMoveAbort.abort();
      return true;
    }
    return false;
  }

  /**
   * Copy library to an absolute empty folder, verify, update settings, then remove the old root.
   */
  async moveLibraryTo(
    destAbsolute: string,
    onProgress: (p: LibraryMoveProgress) => void
  ): Promise<LibraryMoveResult> {
    await this.ensureSettingsLoaded();

    const logMove = (line: string) => {
      console.log(`[LibraryMove] ${line}`);
    };

    if (this.libraryMoveInProgress) {
      logMove('Rejected: a library move is already in progress.');
      return {
        success: false,
        previousRoot: '',
        newRoot: '',
        filesCopied: 0,
        bytesCopied: 0,
        error: 'A library move is already in progress.',
        operationLog: ['Rejected: a library move is already in progress.'],
      };
    }
    if (this.currentOperation) {
      logMove('Rejected: another operation is running.');
      return {
        success: false,
        previousRoot: '',
        newRoot: '',
        filesCopied: 0,
        bytesCopied: 0,
        error:
          'Another operation is running. Cancel it before moving the library.',
        operationLog: ['Rejected: another operation is running.'],
      };
    }

    const srcRoot = this.getResolvedOutputRoot();
    const outputOk =
      isOutputRootConfiguredForWrites(this.settings.outputRoot) &&
      srcRoot.trim() !== '';

    if (!outputOk) {
      const err =
        describeOutputConfigurationError(this.settings) ??
        'No output library folder is configured.';
      logMove(`Rejected before start: ${err}`);
      return {
        success: false,
        previousRoot: '',
        newRoot: '',
        filesCopied: 0,
        bytesCopied: 0,
        error: err,
        operationLog: [`Rejected: ${err}`],
      };
    }

    const destRoot = path.resolve(destAbsolute.trim());
    if (!path.isAbsolute(destRoot)) {
      logMove('Rejected: destination must be an absolute path.');
      return {
        success: false,
        previousRoot: srcRoot,
        newRoot: '',
        filesCopied: 0,
        bytesCopied: 0,
        error: 'Destination must be an absolute path.',
        operationLog: ['Rejected: destination must be an absolute path.'],
      };
    }

    if (pathsEffectivelyEqual(srcRoot, destRoot)) {
      logMove('Rejected: source and destination are the same folder.');
      return {
        success: false,
        previousRoot: srcRoot,
        newRoot: destRoot,
        filesCopied: 0,
        bytesCopied: 0,
        error: 'Source and destination are the same folder.',
        operationLog: ['Rejected: source and destination are the same folder.'],
      };
    }

    this.libraryMoveInProgress = true;
    this.libraryMoveAbort = new AbortController();
    const signal = this.libraryMoveAbort.signal;

    let outcome: Awaited<ReturnType<typeof runLibraryMove>> | null = null;
    let copyAndVerifySucceeded = false;

    try {
      outcome = await runLibraryMove({
        srcRoot,
        destRoot,
        signal,
        onProgress,
      });
      copyAndVerifySucceeded = true;

      let workingLog = [...outcome.operationLog];

      const pushOrchestrationLog = (line: string) => {
        workingLog = [...workingLog, line];
        logMove(line);
      };

      const emitOrchestration = (
        partial: Partial<LibraryMoveProgress> & Pick<LibraryMoveProgress, 'phase'>
      ) => {
        onProgress({
          phase: partial.phase,
          bytesDone: partial.bytesDone ?? outcome!.bytesCopied,
          bytesTotal: partial.bytesTotal ?? outcome!.bytesCopied,
          filesDone: partial.filesDone ?? outcome!.filesCopied,
          filesTotal: partial.filesTotal ?? outcome!.filesCopied,
          currentLabel: partial.currentLabel ?? '',
          done: partial.done ?? false,
          error: partial.error,
          sourceDeleteWarning: partial.sourceDeleteWarning,
          operationLog: [...workingLog],
        });
      };

      pushOrchestrationLog(`Settings: saving new library path "${destRoot}".`);
      emitOrchestration({
        phase: 'saving_settings',
        currentLabel: 'Updating app settings to the new library folder…',
      });
      await this.updateSettings({ outputRoot: destRoot });
      pushOrchestrationLog('Settings: saved successfully.');

      emitOrchestration({
        phase: 'removing_old',
        currentLabel: 'Removing the old library folder…',
      });

      let sourceDeleteWarning: string | undefined;
      try {
        if (
          !pathsEffectivelyEqual(srcRoot, destRoot) &&
          (await fs.pathExists(srcRoot))
        ) {
          pushOrchestrationLog(`Old library: deleting "${srcRoot}"…`);
          await fs.remove(srcRoot);
          pushOrchestrationLog('Old library: removed successfully.');
        } else {
          pushOrchestrationLog(
            'Old library: skipped delete (same path or source already absent).'
          );
        }
      } catch (err) {
        sourceDeleteWarning = `Library is now at ${destRoot}, but the old folder could not be fully removed: ${(err as Error).message}`;
        pushOrchestrationLog(
          `Old library: delete failed — ${(err as Error).message}`
        );
      }

      emitOrchestration({
        phase: 'complete',
        currentLabel: sourceDeleteWarning
          ? 'Move finished with a warning about the old folder.'
          : 'Move finished.',
        done: true,
        sourceDeleteWarning,
      });

      logMove(
        sourceDeleteWarning
          ? `Finished with warning: ${sourceDeleteWarning}`
          : 'Finished successfully.'
      );

      return {
        success: true,
        previousRoot: outcome.previousRoot,
        newRoot: outcome.newRoot,
        filesCopied: outcome.filesCopied,
        bytesCopied: outcome.bytesCopied,
        sourceDeleteWarning,
        operationLog: workingLog,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      if (error instanceof LibraryMoveCancelledError) {
        logMove('Cancelled by user; cleaning up partial destination data…');
        try {
          await removePartialLibraryCopy(
            destRoot,
            outcome?.topLevelDestNames ?? []
          );
          if (
            !(outcome?.topLevelDestNames?.length) &&
            (await fs.pathExists(destRoot))
          ) {
            const kids = await fs.readdir(destRoot);
            for (const k of kids) {
              await fs.remove(path.join(destRoot, k));
            }
          }
          logMove('Cancel cleanup: destination partial copy removed where possible.');
        } catch {
          logMove('Cancel cleanup: some destination files may remain.');
          // ignore cleanup failure
        }
        const cancelLog = [
          ...(outcome?.operationLog ?? []),
          'Cancelled: partial data under the destination was removed where possible.',
        ];
        return {
          success: false,
          previousRoot: srcRoot,
          newRoot: destRoot,
          filesCopied: 0,
          bytesCopied: 0,
          error:
            'Library move was cancelled. Partial files under the destination may have been removed.',
          operationLog: cancelLog,
        };
      }

      if (!copyAndVerifySucceeded) {
        logMove(`Copy/verify failed: ${message}; cleaning destination…`);
        try {
          if (await fs.pathExists(destRoot)) {
            const kids = await fs.readdir(destRoot);
            for (const k of kids) {
              await fs.remove(path.join(destRoot, k));
            }
          }
          logMove('Failure cleanup: emptied destination folder where possible.');
        } catch {
          logMove('Failure cleanup: could not fully empty destination.');
          // ignore
        }
      } else {
        logMove(
          `After copy/verify failure on commit: ${message} (new folder may still hold files).`
        );
      }

      const failLog = [
        ...(outcome?.operationLog ?? []),
        copyAndVerifySucceeded
          ? `Failed after successful copy: ${message}`
          : `Failed during copy or verify: ${message}`,
      ];

      return {
        success: false,
        previousRoot: srcRoot,
        newRoot: destRoot,
        filesCopied: outcome?.filesCopied ?? 0,
        bytesCopied: outcome?.bytesCopied ?? 0,
        error: copyAndVerifySucceeded
          ? `${message} Your files are still under the new folder; settings may not have updated. Try choosing that folder in Settings.`
          : message,
        operationLog: failLog,
      };
    } finally {
      this.libraryMoveInProgress = false;
      this.libraryMoveAbort = null;
    }
  }

  async getSettings(): Promise<RecNetSettings> {
    await this.ensureSettingsLoaded();
    const resolvedOutputRoot = computeResolvedOutputRoot(
      this.settings.outputRoot
    );
    const outputPathConfiguredForDownload = isOutputRootConfiguredForWrites(
      this.settings.outputRoot
    );
    return {
      ...this.settings,
      resolvedOutputRoot,
      outputPathConfiguredForDownload,
    };
  }

  async updateSettings(
    newSettings: Partial<RecNetSettings>
  ): Promise<RecNetSettings> {
    await this.ensureSettingsLoaded();
    const { resolvedOutputRoot, outputPathConfiguredForDownload, ...rest } =
      newSettings;
    void resolvedOutputRoot;
    void outputPathConfiguredForDownload;

    this.settings = normalizeRecNetSettings({
      ...this.settings,
      ...rest,
    });

    this.syncHttpClientSettings();
    this.ensureOutputDirectory();
    await this.saveSettings();
    return this.getSettings();
  }

  getProgress(): Progress {
    return { ...this.progress };
  }

  private updateProgress(
    step: string,
    current: number,
    total: number,
    progress?: number,
    overrides: Partial<Progress> = {}
  ): void {
    if (!this.currentOperation || this.currentOperation.cancelled) {
      return;
    }
    this.progress = this.createProgressState({
      ...this.progress,
      isRunning: true,
      currentStep: step,
      current,
      total,
      progress: progress || (total > 0 ? (current / total) * 100 : 0),
      ...overrides,
    });
    this.emit('progress-update', this.progress);
  }

  private setOperationComplete(): void {
    this.progress = this.createProgressState({
      ...this.progress,
      isRunning: false,
      phase: 'complete',
      currentStep: 'Complete',
      current: 0,
      total: 0,
      progress: 100,
      currentSource: undefined,
      pageLabel: undefined,
      activeItemLabel: undefined,
      confirmation: undefined,
    });
    this.emit('progress-update', this.progress);
  }

  private setOperationFailed(message: string): void {
    this.progress = this.createProgressState({
      ...this.progress,
      isRunning: false,
      phase: 'failed',
      currentStep: 'Failed',
      current: 0,
      total: 0,
      progress: 100,
      statusLevel: 'error',
      issueCount: Math.max(this.progress.issueCount, 1),
      failedItems: Math.max(this.progress.failedItems, 1),
      lastIssue: message,
      confirmation: undefined,
    });
    this.emit('progress-update', this.progress);
  }

  cancelCurrentOperation(): boolean {
    if (this.currentOperation) {
      this.currentOperation.cancelled = true;
      this.currentOperation.controller.abort();
      this.progress = this.createProgressState({
        ...this.progress,
        isRunning: false,
        phase: 'cancelled',
        currentStep: 'Cancelled',
        current: 0,
        total: 0,
        progress: 100,
        confirmation: undefined,
      });
      this.emit('progress-update', this.progress);
      return true;
    }
    return false;
  }

  private startOperation(): CurrentOperation {
    const operation: CurrentOperation = {
      cancelled: false,
      controller: new AbortController(),
    };
    this.currentOperation = operation;
    return operation;
  }

  private finishOperation(operation: CurrentOperation): void {
    if (this.currentOperation === operation) {
      this.currentOperation = null;
    }
  }

  private createOperationCancelledError(): Error {
    return new Error('Operation cancelled');
  }

  private isOperationCancelledError(error: unknown): boolean {
    return error instanceof Error && error.message === 'Operation cancelled';
  }

  private isOutOfDiskSpaceError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const code = ((error as ErrorWithCode).code || '').toUpperCase();
    const message = error.message || '';
    return (
      code === 'ENOSPC' ||
      /ENOSPC|no space|disk full|disk is full|drive is full/i.test(message)
    );
  }

  private abortOperationForDiskFull(
    imageLabel: string,
    operation?: CurrentOperation
  ): never {
    const targetOperation =
      operation && this.currentOperation === operation
        ? operation
        : this.currentOperation;

    if (targetOperation && !targetOperation.cancelled) {
      targetOperation.cancelled = true;
      targetOperation.controller.abort();
    }

    throw new Error(
      `The download stopped because there is no space left on your disk while saving ${imageLabel}. Free up space and run the same download again. Anything already saved will be skipped automatically.`
    );
  }

  private isCancelledResponse(response?: {
    error?: string | null;
    message?: string | null;
  }): boolean {
    return (
      response?.error === 'ERR_CANCELED' ||
      response?.message === 'Operation cancelled'
    );
  }

  async collectPhotos(
    accountId: string,
    token?: string,
    options?: BulkDataRefreshOptions
  ): Promise<CollectionResult> {
    await this.ensureSettingsLoaded();
    const operation = this.startOperation();
    const {
      forceAccountsRefresh = false,
      forceRoomsRefresh = false,
      forceEventsRefresh = false,
      forceImageCommentsRefresh = false,
    } = options || {};

    try {
      this.resetProgressIssueState();
      this.updateSourceProgress(
        'metadata',
        'user-photos',
        'Collecting user photos metadata...',
        0,
        0,
        0,
        {
          recentActivity: 'Preparing to collect user photos metadata...',
        }
      );

      const all: Photo[] = [];
      let skip = 0;
      let totalFetched = 0;
      const iterationDetails: IterationDetail[] = [];

      // Create account-specific directory
      const accountDir = path.join(this.getResolvedOutputRoot(), accountId);
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
        this.getResolvedOutputRoot(),
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
        if (operation.cancelled) {
          throw this.createOperationCancelledError();
        }

        const pageNumber = iteration + 1;
        const modeText = isIncrementalMode ? ' (incremental)' : '';
        const pageLabel = `Page ${pageNumber}${modeText}`;
        this.updateSourceProgress(
          'metadata',
          'user-photos',
          'Collecting user photos metadata...',
          iteration,
          0,
          undefined,
          {
            pageLabel,
            recentActivity: `Checking ${pageLabel.toLowerCase()} for user photos...`,
          }
        );

        let url = `https://apim.rec.net/apis/api/images/v4/player/${encodeURIComponent(
          accountId
        )}?skip=${skip}&take=${PHOTO_MAX_PAGE_SIZE}&sort=2`;

        if (lastSortValue) {
          url += `&after=${encodeURIComponent(lastSortValue)}`;
        }

        const photos = this.normalizePhotos(
          await this.runMetadataRequestWithRetry({
            label: `user photos page ${pageNumber}`,
            source: 'user-photos',
            operationRef: operation,
            pageLabel,
            recentActivity: `Collected ${pageLabel.toLowerCase()} for user photos metadata.`,
            operation: () =>
              this.photosController.fetchPlayerPhotos(
                accountId,
                {
                  skip,
                  take: PHOTO_MAX_PAGE_SIZE,
                  sort: 2,
                  after: lastSortValue,
                },
                token,
                { signal: operation.controller.signal }
              ),
          })
        );
        if (!Array.isArray(photos)) {
          throw new Error('Unexpected response format: expected array');
        }

        let newPhotosAdded = 0;
        let newestSortValue: string | undefined = undefined;

        for (const photo of photos) {
          if (operation.cancelled) {
            throw this.createOperationCancelledError();
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
          iteration: pageNumber,
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
        this.updateSourceProgress(
          'metadata',
          'user-photos',
          'Collecting related account, room, event, and image comment data...',
          0,
          0,
          0,
          {
            pageLabel: 'Related data',
            recentActivity:
              'Collecting related account, room, event, and image comment data for user photos...',
          }
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
          {
            forceAccountsRefresh,
            forceRoomsRefresh,
            forceEventsRefresh,
            forceImageCommentsRefresh,
          },
          'user-photos'
        );
        console.log(
          `Fetched ${bulkData.accountsFetched} accounts, ${bulkData.roomsFetched} rooms, ${bulkData.eventsFetched} events, and ${bulkData.imageCommentsFetched} image comment record(s)`
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
        totalPhotos: normalizedAll.length,
        totalFetched,
        pageSize: PHOTO_MAX_PAGE_SIZE,
        delayMs: this.settings.interPageDelayMs || 0,
        iterationsCompleted: iterationDetails.length,
        lastSortValue,
        incrementalMode: !!lastSortValue,
        iterationDetails,
      };
    } catch (error) {
      if (!this.isOperationCancelledError(error)) {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    } finally {
      this.finishOperation(operation);
    }
  }

  async collectFeedPhotos(
    accountId: string,
    token?: string,
    incremental = true,
    options?: BulkDataRefreshOptions
  ): Promise<CollectionResult> {
    await this.ensureSettingsLoaded();
    const operation = this.startOperation();
    const {
      forceAccountsRefresh = false,
      forceRoomsRefresh = false,
      forceEventsRefresh = false,
      forceImageCommentsRefresh = false,
    } = options || {};

    try {
      this.resetProgressIssueState();
      this.updateSourceProgress(
        'metadata',
        'user-feed',
        'Collecting user feed metadata...',
        0,
        0,
        0,
        {
          recentActivity: 'Preparing to collect user feed metadata...',
        }
      );

      const accountDir = path.join(this.getResolvedOutputRoot(), accountId);
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
        this.getResolvedOutputRoot(),
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
        if (operation.cancelled) {
          throw this.createOperationCancelledError();
        }

        const pageNumber = iteration + 1;
        const pageLabel = `Page ${pageNumber}`;
        this.updateSourceProgress(
          'metadata',
          'user-feed',
          'Collecting user feed metadata...',
          iteration,
          0,
          undefined,
          {
            pageLabel,
            recentActivity: `Checking ${pageLabel.toLowerCase()} for user feed...`,
          }
        );

        const sinceParam = sinceTime.toISOString();
        const url = `https://apim.rec.net/apis/api/images/v3/feed/player/${encodeURIComponent(
          accountId
        )}?skip=${skip}&take=${PHOTO_MAX_PAGE_SIZE}&since=${encodeURIComponent(sinceParam)}`;

        const photos = this.normalizePhotos(
          await this.runMetadataRequestWithRetry({
            label: `user feed page ${pageNumber}`,
            source: 'user-feed',
            operationRef: operation,
            pageLabel,
            recentActivity: `Collected ${pageLabel.toLowerCase()} for user feed metadata.`,
            operation: () =>
              this.photosController.fetchFeedPhotos(
                accountId,
                { skip, take: PHOTO_MAX_PAGE_SIZE, since: sinceParam },
                token,
                { signal: operation.controller.signal }
              ),
          })
        );
        if (!Array.isArray(photos)) {
          throw new Error('Unexpected response format: expected array');
        }

        let newPhotosAdded = 0;
        let newestCreatedAt: Date | undefined = undefined;

        for (const photo of photos) {
          if (operation.cancelled) {
            throw this.createOperationCancelledError();
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
          iteration: pageNumber,
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
        this.updateSourceProgress(
          'metadata',
          'user-feed',
          'Collecting related account, room, event, and image comment data...',
          0,
          0,
          0,
          {
            pageLabel: 'Related data',
            recentActivity:
              'Collecting related account, room, event, and image comment data for user feed...',
          }
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
          {
            forceAccountsRefresh,
            forceRoomsRefresh,
            forceEventsRefresh,
            forceImageCommentsRefresh,
          },
          'user-feed'
        );
        console.log(
          `Fetched (feed) ${bulkData.accountsFetched} accounts, ${bulkData.roomsFetched} rooms, ${bulkData.eventsFetched} events, and ${bulkData.imageCommentsFetched} image comment record(s)`
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
        totalPhotos: normalizedFeed.length,
        totalFetched,
        pageSize: PHOTO_MAX_PAGE_SIZE,
        delayMs: this.settings.interPageDelayMs || 0,
        iterationsCompleted: iterationDetails.length,
        sinceTime: sinceTime.toISOString(),
        incrementalMode: existingPhotoCount > 0,
        incremental,
        iterationDetails,
      };
    } catch (error) {
      if (!this.isOperationCancelledError(error)) {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    } finally {
      this.finishOperation(operation);
    }
  }

  async downloadPhotos(
    accountId: string,
    token?: string
  ): Promise<DownloadResult> {
    await this.ensureSettingsLoaded();
    const operation = this.startOperation();

    try {
      this.resetProgressIssueState();
      this.updateSourceProgress(
        'download',
        'user-photos',
        'Downloading user photos...',
        0,
        0,
        0
      );
      const accountDir = path.join(this.getResolvedOutputRoot(), accountId);
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
      const hasDownloadLimit = maxPhotosToDownload && maxPhotosToDownload > 0;

      const existingPhotoFiles = (await fs.readdir(photosDir)).filter(file =>
        file.toLowerCase().endsWith('.jpg')
      ).length;
      let remainingDownloadSlots =
        (maxPhotosToDownload || 0) - existingPhotoFiles;

      if (hasDownloadLimit && remainingDownloadSlots <= 0) {
        console.log(
          `Skipping photo downloads: limit ${maxPhotosToDownload} reached by existing files (${existingPhotoFiles})`
        );
        this.updateSourceProgress(
          'download',
          'user-photos',
          'Download limit reached for photos',
          totalPhotos,
          totalPhotos,
          100,
          {
            recentActivity:
              'Everything in user photos is already on disk for this run.',
          }
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
      const trace = this.createDownloadBatchTrace(
        'user-photo-downloads',
        totalPhotos
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
      let retryAttempts = 0;
      let recoveredAfterRetry = 0;
      let processedCount = 0;

      this.updateSourceProgress(
        'download',
        'user-photos',
        'Downloading user photos...',
        0,
        totalPhotos,
        0
      );

      const promises: Array<Promise<DownloadResultItem>> = [];
      const semaphore = new Semaphore(this.settings.maxConcurrentDownloads);
      let scheduledPhotoCount = 0;
      for (const photo of sortedPhotos) {
        if (hasDownloadLimit && remainingDownloadSlots <= 0) {
          skipped = sortedPhotos.length - scheduledPhotoCount;
          break;
        } else {
          remainingDownloadSlots--;
        }

        scheduledPhotoCount++;
        const scheduledIndex = scheduledPhotoCount;
        promises.push(
          new Promise<DownloadResultItem>((resolve, reject) => {
            void (async () => {
              const photoId = this.normalizeId(photo.Id);
              const imageName = photo.ImageName;
              const runStartedAt = Date.now();
              let result: DownloadResultItem | undefined;
              try {
                const slotWaitStartedAt = Date.now();
                await semaphore.acquire();
                const slotWaitMs = Date.now() - slotWaitStartedAt;
                trace.inFlight++;
                this.logDownloadWorkerStart(trace, {
                  scheduledIndex,
                  photoId,
                  imageName,
                  scheduledDelayMs: 0,
                  slotWaitMs,
                });
                try {
                  this.setDownloadItemActivity(
                    'user-photos',
                    imageName || photoId || `image ${scheduledIndex}`
                  );
                  result = await this.downloadImage(
                    photo,
                    photosDir,
                    feedDir,
                    false,
                    token,
                    operation
                  );
                  const status = result.status;
                  if (status === 'downloaded') {
                    newDownloads++;
                    // result attempts can be undefined and we don't want to increment successful attempts
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
                  } else if (
                    status &&
                    (status === 'error' || status === 'failed')
                  ) {
                    failedDownloads++;
                    retryAttempts += (result.attempts || 1) - 1;
                  } else if (status && status === 'cancelled') {
                    skipped++;
                  }
                  resolve(result);
                } catch (error) {
                  // downloadImage already has error handling, if it throws, we'll assume it's fatal
                  reject(error);
                } finally {
                  trace.inFlight = Math.max(0, trace.inFlight - 1);
                  trace.completed++;
                  this.logDownloadWorkerFinish(trace, {
                    scheduledIndex,
                    photoId,
                    imageName,
                    result,
                    runDurationMs: Date.now() - runStartedAt,
                  });
                  semaphore.release();
                  if (this.currentOperation === operation) {
                    processedCount++;
                    this.setDownloadResultActivity('user-photos', result);
                    this.updateSourceProgress(
                      'download',
                      'user-photos',
                      'Downloading user photos...',
                      processedCount,
                      totalPhotos
                    );
                  }
                }
              } catch (error) {
                reject(error);
              }
            })();
          })
        );
      }
      const downloadResults: DownloadResultItem[] =
        await Promise.all<DownloadResultItem>(promises);

      if (operation.cancelled) {
        throw this.createOperationCancelledError();
      }

      this.setOperationComplete();

      const downloadStats: DownloadStats = {
        totalPhotos,
        alreadyDownloaded,
        newDownloads,
        failedDownloads,
        skipped,
        retryAttempts,
        recoveredAfterRetry,
      };
      this.logDownloadBatchSummary(trace, downloadStats);

      return {
        accountId,
        photosDirectory: photosDir,
        processedCount,
        downloadStats,
        downloadResults,
        totalResults: downloadResults.length,
        guidance: this.buildDownloadGuidance('user photos', downloadStats),
      };
    } catch (error) {
      if (!this.isOperationCancelledError(error)) {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    } finally {
      this.finishOperation(operation);
    }
  }

  async downloadFeedPhotos(
    accountId: string,
    token?: string
  ): Promise<DownloadResult> {
    await this.ensureSettingsLoaded();
    if (this.currentOperation?.cancelled) {
      throw this.createOperationCancelledError();
    }
    const operation = this.startOperation();

    try {
      this.resetProgressIssueState();
      this.updateSourceProgress(
        'download',
        'user-feed',
        'Downloading feed photos...',
        0,
        0,
        0
      );
      const accountDir = path.join(this.getResolvedOutputRoot(), accountId);
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
      const hasDownloadLimit = maxPhotosToDownload && maxPhotosToDownload > 0;

      const existingFeedFiles = (await fs.readdir(feedPhotosDir)).filter(file =>
        file.toLowerCase().endsWith('.jpg')
      ).length;
      let remainingDownloadSlots =
        (maxPhotosToDownload || 0) - existingFeedFiles;

      if (operation.cancelled) {
        throw this.createOperationCancelledError();
      }

      if (hasDownloadLimit && remainingDownloadSlots === 0) {
        console.log(
          `Skipping feed photo downloads: limit ${maxPhotosToDownload} reached by existing files (${existingFeedFiles})`
        );
        this.updateSourceProgress(
          'download',
          'user-feed',
          'Download limit reached for feed photos',
          totalPhotos,
          totalPhotos,
          100,
          {
            recentActivity:
              'Everything in user feed is already on disk for this run.',
          }
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
      const trace = this.createDownloadBatchTrace(
        'feed-photo-downloads',
        totalPhotos
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
      let retryAttempts = 0;
      let recoveredAfterRetry = 0;
      let processedCount = 0;

      this.updateSourceProgress(
        'download',
        'user-feed',
        'Downloading feed photos...',
        0,
        totalPhotos,
        0
      );

      const promises: Array<Promise<DownloadResultItem>> = [];
      const semaphore = new Semaphore(this.settings.maxConcurrentDownloads);
      let scheduledPhotoCount = 0;
      for (const photo of sortedPhotos) {
        if (hasDownloadLimit && remainingDownloadSlots <= 0) {
          skipped = sortedPhotos.length - scheduledPhotoCount;
          break;
        } else {
          remainingDownloadSlots--;
        }

        scheduledPhotoCount++;
        const scheduledIndex = scheduledPhotoCount;
        promises.push(
          new Promise<DownloadResultItem>((resolve, reject) => {
            void (async () => {
              const photoId = this.normalizeId(photo.Id);
              const imageName = photo.ImageName;
              const runStartedAt = Date.now();
              let result: DownloadResultItem | undefined;
              try {
                const slotWaitStartedAt = Date.now();
                await semaphore.acquire();
                const slotWaitMs = Date.now() - slotWaitStartedAt;
                trace.inFlight++;
                this.logDownloadWorkerStart(trace, {
                  scheduledIndex,
                  photoId,
                  imageName,
                  scheduledDelayMs: 0,
                  slotWaitMs,
                });
                try {
                  this.setDownloadItemActivity(
                    'user-feed',
                    imageName || photoId || `image ${scheduledIndex}`
                  );
                  result = await this.downloadImage(
                    photo,
                    photosDir,
                    feedPhotosDir,
                    true,
                    token,
                    operation
                  );
                  const status = result.status;
                  if (status === 'downloaded') {
                    newDownloads++;
                    // result attempts can be undefined and we don't want to increment successful attempts
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
                  } else if (
                    status &&
                    (status === 'error' || status === 'failed')
                  ) {
                    failedDownloads++;
                    retryAttempts += (result.attempts || 1) - 1;
                  } else if (status && status === 'cancelled') {
                    skipped++;
                  }
                  resolve(result);
                } catch (error) {
                  // downloadImage already has error handling, if it throws, we'll assume it's fatal
                  reject(error);
                } finally {
                  trace.inFlight = Math.max(0, trace.inFlight - 1);
                  trace.completed++;
                  this.logDownloadWorkerFinish(trace, {
                    scheduledIndex,
                    photoId,
                    imageName,
                    result,
                    runDurationMs: Date.now() - runStartedAt,
                  });
                  semaphore.release();
                  if (this.currentOperation === operation) {
                    processedCount++;
                    this.setDownloadResultActivity('user-feed', result);
                    this.updateSourceProgress(
                      'download',
                      'user-feed',
                      'Downloading feed photos...',
                      processedCount,
                      totalPhotos
                    );
                  }
                }
              } catch (error) {
                reject(error);
              }
            })();
          })
        );
      }
      const downloadResults: DownloadResultItem[] =
        await Promise.all<DownloadResultItem>(promises);

      if (operation.cancelled) {
        throw this.createOperationCancelledError();
      }

      this.setOperationComplete();

      const downloadStats: DownloadStats = {
        totalPhotos,
        alreadyDownloaded,
        newDownloads,
        failedDownloads,
        skipped,
        retryAttempts,
        recoveredAfterRetry,
      };
      this.logDownloadBatchSummary(trace, downloadStats);

      return {
        accountId,
        feedPhotosDirectory: feedPhotosDir,
        processedCount,
        downloadStats,
        downloadResults,
        totalResults: downloadResults.length,
        guidance: this.buildDownloadGuidance('feed photos', downloadStats),
      };
    } catch (error) {
      if (!this.isOperationCancelledError(error)) {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    } finally {
      this.finishOperation(operation);
    }
  }

  async validateProfileHistoryAccess(
    username: string,
    token: string
  ): Promise<ProfileHistoryAccessResult> {
    const cleanedUsername = username.trim();
    const cleanedToken = token.trim();

    if (!cleanedUsername) {
      throw new Error('Username is required.');
    }
    if (!cleanedToken) {
      throw new Error('Access token is required for profile picture history.');
    }

    const payload = this.decodeJwtPayload(cleanedToken);
    if (!payload) {
      throw new Error('Token is invalid or could not be parsed.');
    }
    if (!payload.sub) {
      throw new Error('Token is missing an account id.');
    }
    if (payload.exp && payload.exp * 1000 <= Date.now()) {
      throw new Error('Token has expired.');
    }

    const account = await this.lookupAccountByUsername(cleanedUsername);
    const accountId = this.normalizeId(account.accountId);
    const tokenAccountId = this.normalizeId(payload.sub);

    if (!accountId) {
      throw new Error('Could not resolve an account id for this username.');
    }
    if (tokenAccountId !== accountId) {
      throw new Error('Token does not belong to this user.');
    }

    try {
      await this.photosController.fetchProfilePhotoHistory(cleanedToken);
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      if (/HTTP\s+(401|403)\b/.test(message)) {
        throw new Error(
          'Token is not authorized to access profile picture history.'
        );
      }
      throw error;
    }

    return {
      accountId,
      username: (account.username || cleanedUsername).trim(),
      tokenAccountId,
    };
  }

  async collectProfileHistoryManifest(
    accountId: string,
    token: string
  ): Promise<ProfileHistoryCollectionResult> {
    await this.ensureSettingsLoaded();
    const operation = this.startOperation();

    try {
      this.resetProgressIssueState();
      this.updateSourceProgress(
        'metadata',
        'profile-history',
        'Collecting profile picture history metadata...',
        0,
        0,
        0,
        {
          recentActivity:
            'Preparing to collect profile picture history metadata...',
        }
      );

      const cleanedToken = token.trim();
      if (!cleanedToken) {
        throw new Error(
          'Profile picture history requires a valid access token.'
        );
      }

      const accountDir = path.join(this.getResolvedOutputRoot(), accountId);
      await fs.ensureDir(accountDir);

      const manifestPath = path.join(
        accountDir,
        `${accountId}_profile_history.json`
      );
      let existingPhotos = 0;

      if (await fs.pathExists(manifestPath)) {
        try {
          const existingPayload = (await fs.readJson(
            manifestPath
          )) as ProfileHistoryImageDto[];
          existingPhotos = this.normalizeProfileHistoryPhotos(
            existingPayload,
            accountId
          ).length;
        } catch (error) {
          console.log(
            `Warning: Failed to read existing profile history manifest: ${(error as Error).message}`
          );
        }
      }

      const historyPayload = await this.runMetadataRequestWithRetry({
        label: 'profile picture history manifest',
        source: 'profile-history',
        operationRef: operation,
        pageLabel: 'Manifest',
        recentActivity: 'Collected profile picture history manifest.',
        operation: () =>
          this.photosController.fetchProfilePhotoHistory(cleanedToken, {
            signal: operation.controller.signal,
          }),
      });

      if (operation.cancelled) {
        throw this.createOperationCancelledError();
      }

      await fs.writeJson(manifestPath, historyPayload, { spaces: 2 });

      const totalPhotos = this.normalizeProfileHistoryPhotos(
        historyPayload,
        accountId
      ).length;

      this.setOperationComplete();

      return {
        accountId,
        saved: manifestPath,
        existingPhotos,
        totalNewPhotosAdded: Math.max(0, totalPhotos - existingPhotos),
        totalPhotos,
      };
    } catch (error) {
      if (!this.isOperationCancelledError(error)) {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    } finally {
      this.finishOperation(operation);
    }
  }

  async downloadProfileHistory(
    accountId: string,
    token: string
  ): Promise<DownloadResult> {
    await this.ensureSettingsLoaded();
    if (this.currentOperation?.cancelled) {
      throw this.createOperationCancelledError();
    }
    const operation = this.startOperation();

    try {
      this.resetProgressIssueState();
      this.updateSourceProgress(
        'download',
        'profile-history',
        'Downloading profile picture history...',
        0,
        0,
        0
      );

      const cleanedToken = token.trim();
      if (!cleanedToken) {
        throw new Error(
          'Profile picture history requires a valid access token.'
        );
      }

      const accountDir = path.join(this.getResolvedOutputRoot(), accountId);
      await fs.ensureDir(accountDir);

      const manifestPath = path.join(
        accountDir,
        `${accountId}_profile_history.json`
      );
      if (!(await fs.pathExists(manifestPath))) {
        throw new Error(
          'Profile picture history metadata not collected. Run metadata collection first.'
        );
      }

      const profileHistoryDir = path.join(accountDir, 'profile-history');
      await fs.ensureDir(profileHistoryDir);

      const historyPayload = (await fs.readJson(
        manifestPath
      )) as ProfileHistoryImageDto[];
      const profilePhotos = this.normalizeProfileHistoryPhotos(
        historyPayload,
        accountId
      );
      const totalPhotos = profilePhotos.length;
      const maxPhotosToDownload = this.settings.maxPhotosToDownload;
      const hasDownloadLimit = maxPhotosToDownload && maxPhotosToDownload > 0;

      const existingFiles = (await fs.readdir(profileHistoryDir)).filter(file =>
        file.toLowerCase().endsWith('.jpg')
      ).length;
      let remainingDownloadSlots = (maxPhotosToDownload || 0) - existingFiles;

      if (hasDownloadLimit && remainingDownloadSlots <= 0) {
        this.updateSourceProgress(
          'download',
          'profile-history',
          'Download limit reached for profile picture history',
          totalPhotos,
          totalPhotos,
          100,
          {
            recentActivity:
              'Everything in profile picture history is already on disk for this run.',
          }
        );
        this.setOperationComplete();
        return {
          accountId,
          profileHistoryDirectory: profileHistoryDir,
          profileHistoryManifestPath: manifestPath,
          processedCount: 0,
          downloadStats: {
            totalPhotos,
            alreadyDownloaded: existingFiles,
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

      if (totalPhotos === 0) {
        this.setOperationComplete();
        return {
          accountId,
          profileHistoryDirectory: profileHistoryDir,
          profileHistoryManifestPath: manifestPath,
          processedCount: 0,
          downloadStats: {
            totalPhotos: 0,
            alreadyDownloaded: 0,
            newDownloads: 0,
            failedDownloads: 0,
            skipped: 0,
            retryAttempts: 0,
            recoveredAfterRetry: 0,
          },
          downloadResults: [],
          totalResults: 0,
        };
      }

      const trace = this.createDownloadBatchTrace(
        'profile-history-downloads',
        totalPhotos
      );
      let alreadyDownloaded = 0;
      let newDownloads = 0;
      let failedDownloads = 0;
      let skipped = 0;
      let retryAttempts = 0;
      let recoveredAfterRetry = 0;
      let processedCount = 0;

      this.updateSourceProgress(
        'download',
        'profile-history',
        'Downloading profile picture history...',
        0,
        totalPhotos,
        0
      );

      const promises: Array<Promise<DownloadResultItem>> = [];
      const semaphore = new Semaphore(this.settings.maxConcurrentDownloads);
      let scheduledPhotoCount = 0;

      for (const photo of profilePhotos) {
        if (hasDownloadLimit && remainingDownloadSlots <= 0) {
          skipped = profilePhotos.length - scheduledPhotoCount;
          break;
        } else {
          remainingDownloadSlots--;
        }

        scheduledPhotoCount++;
        const scheduledIndex = scheduledPhotoCount;
        promises.push(
          new Promise<DownloadResultItem>((resolve, reject) => {
            void (async () => {
              const photoId = this.normalizeId(photo.Id);
              const imageName = photo.ImageName;
              const runStartedAt = Date.now();
              let result: DownloadResultItem | undefined;

              try {
                const slotWaitStartedAt = Date.now();
                await semaphore.acquire();
                const slotWaitMs = Date.now() - slotWaitStartedAt;
                trace.inFlight++;
                this.logDownloadWorkerStart(trace, {
                  scheduledIndex,
                  photoId,
                  imageName,
                  scheduledDelayMs: 0,
                  slotWaitMs,
                });

                try {
                  this.setDownloadItemActivity(
                    'profile-history',
                    imageName || photoId || `image ${scheduledIndex}`
                  );
                  result = await this.downloadProfileHistoryImage(
                    photo,
                    profileHistoryDir,
                    cleanedToken,
                    operation
                  );
                  const status = result.status;

                  if (status === 'downloaded') {
                    newDownloads++;
                    retryAttempts += (result.attempts || 1) - 1;
                    if (result.recoveredAfterRetry) {
                      recoveredAfterRetry++;
                    }
                  } else if (status && status.startsWith('already_exists')) {
                    alreadyDownloaded++;
                  } else if (
                    status &&
                    (status === 'error' || status === 'failed')
                  ) {
                    failedDownloads++;
                    retryAttempts += (result.attempts || 1) - 1;
                  } else if (status === 'cancelled') {
                    skipped++;
                  }

                  resolve(result);
                } catch (error) {
                  reject(error);
                } finally {
                  trace.inFlight = Math.max(0, trace.inFlight - 1);
                  trace.completed++;
                  this.logDownloadWorkerFinish(trace, {
                    scheduledIndex,
                    photoId,
                    imageName,
                    result,
                    runDurationMs: Date.now() - runStartedAt,
                  });
                  semaphore.release();
                  if (this.currentOperation === operation) {
                    processedCount++;
                    this.setDownloadResultActivity('profile-history', result);
                    this.updateSourceProgress(
                      'download',
                      'profile-history',
                      'Downloading profile picture history...',
                      processedCount,
                      totalPhotos
                    );
                  }
                }
              } catch (error) {
                reject(error);
              }
            })();
          })
        );
      }

      const downloadResults = await Promise.all<DownloadResultItem>(promises);

      if (operation.cancelled) {
        throw this.createOperationCancelledError();
      }

      this.setOperationComplete();

      const downloadStats: DownloadStats = {
        totalPhotos,
        alreadyDownloaded,
        newDownloads,
        failedDownloads,
        skipped,
        retryAttempts,
        recoveredAfterRetry,
      };
      this.logDownloadBatchSummary(trace, downloadStats);

      return {
        accountId,
        profileHistoryDirectory: profileHistoryDir,
        profileHistoryManifestPath: manifestPath,
        processedCount,
        downloadStats,
        downloadResults,
        totalResults: downloadResults.length,
        guidance: this.buildDownloadGuidance(
          'profile picture history images',
          downloadStats
        ),
      };
    } catch (error) {
      if (!this.isOperationCancelledError(error)) {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    } finally {
      this.finishOperation(operation);
    }
  }

  async downloadImage(
    photo: Photo,
    photosDir: string,
    feedPhotosDir: string,
    isFeed: boolean,
    token?: string,
    operation?: CurrentOperation
  ): Promise<DownloadResultItem> {
    const photoId = this.normalizeId(photo.Id);
    const imageName = this.normalizeImageName(photo.ImageName) || '';
    const photoUrl = buildCdnImageUrl(this.settings.cdnBase, imageName);

    if (!photoId || !imageName) {
      return {
        error: 'invalid_photo_data',
        photoId,
        imageName,
        photo: JSON.stringify(photo),
      };
    }

    if (operation?.cancelled || this.currentOperation?.cancelled) {
      return {
        photoId,
        imageName,
        status: 'cancelled',
      };
    }

    const photoDir = isFeed ? feedPhotosDir : photosDir;
    const photoPath = path.join(photoDir, `${photoId}.jpg`);

    // Check if photo already exists
    if (await fs.pathExists(photoPath)) {
      return {
        photoId,
        imageName,
        status: isFeed ? 'already_exists_in_feed' : 'already_exists_in_photos',
        path: photoPath,
      };
    }

    // Check if photo exists in photos folder and copy it
    const otherPhotoPath = path.join(
      isFeed ? photosDir : feedPhotosDir,
      `${photoId}.jpg`
    );
    if (await fs.pathExists(otherPhotoPath)) {
      try {
        await fs.copy(otherPhotoPath, photoPath);
      } catch (error) {
        if (this.isOutOfDiskSpaceError(error)) {
          this.abortOperationForDiskFull(imageName, operation);
        }
        throw error;
      }
      return {
        photoId,
        imageName,
        status: isFeed ? 'copied_from_photos' : 'copied_from_feed',
        sourcePath: otherPhotoPath,
        destinationPath: photoPath,
      };
    }

    let attemptsUsed = 1;
    try {
      const attempt = await this.downloadPhotoWithRetry(
        imageName,
        token,
        operation
      );
      attemptsUsed = attempt.attempts;
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
        try {
          await fs.writeFile(photoPath, data);
        } catch (error) {
          if (this.isOutOfDiskSpaceError(error)) {
            this.abortOperationForDiskFull(imageName, operation);
          }
          throw error;
        }
        return {
          photoId,
          imageName,
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
          imageName,
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
        return {
          photoId,
          imageName,
          status: 'cancelled',
        };
      }

      if (this.isOutOfDiskSpaceError(error)) {
        this.abortOperationForDiskFull(imageName, operation);
      }

      return {
        photoId,
        imageName,
        status: 'error',
        error: (error as Error).message,
        url: photoUrl,
        attempts: attemptsUsed,
        retries: Math.max(0, attemptsUsed - 1),
      };
    }
  }

  private async downloadImageToDirectory(
    photo: Photo,
    targetDir: string,
    token?: string,
    operation?: CurrentOperation
  ): Promise<DownloadResultItem> {
    const photoId = this.sanitizeFileStem(this.normalizeId(photo.Id));
    const imageName = this.normalizeImageName(photo.ImageName) || '';
    const photoUrl = buildCdnImageUrl(this.settings.cdnBase, imageName);

    if (!photoId || !imageName) {
      return {
        error: 'invalid_photo_data',
        photoId,
        imageName,
        photo: JSON.stringify(photo),
      };
    }

    if (operation?.cancelled || this.currentOperation?.cancelled) {
      return {
        photoId,
        imageName,
        status: 'cancelled',
      };
    }

    const photoPath = path.join(targetDir, `${photoId}.jpg`);
    if (await fs.pathExists(photoPath)) {
      return {
        photoId,
        imageName,
        status: 'already_exists_in_room_photos',
        path: photoPath,
      };
    }

    let attemptsUsed = 1;
    try {
      const attempt = await this.downloadPhotoWithRetry(
        imageName,
        token,
        operation
      );
      attemptsUsed = attempt.attempts;
      const response = attempt.response;
      const recoveredAfterRetry =
        attempt.attempts > 1 && !!response?.success && !!response.value;

      if (response?.success && response.value) {
        const data = Buffer.from(response.value);
        try {
          await fs.writeFile(photoPath, data);
        } catch (error) {
          if (this.isOutOfDiskSpaceError(error)) {
            this.abortOperationForDiskFull(imageName, operation);
          }
          throw error;
        }
        return {
          photoId,
          imageName,
          status: 'downloaded',
          size: data.length,
          path: photoPath,
          url: photoUrl,
          attempts: attempt.attempts,
          retries: Math.max(0, attempt.attempts - 1),
          recoveredAfterRetry,
        };
      }

      if (response) {
        return {
          photoId,
          imageName,
          status: 'failed',
          statusCode: response.status,
          reason: (response.message || response.error) ?? undefined,
          url: photoUrl,
          attempts: attempt.attempts,
          retries: Math.max(0, attempt.attempts - 1),
        };
      }

      throw attempt.error ?? new Error('Download failed after retries');
    } catch (error) {
      if (error instanceof Error && error.message === 'Operation cancelled') {
        return {
          photoId,
          imageName,
          status: 'cancelled',
        };
      }

      if (this.isOutOfDiskSpaceError(error)) {
        this.abortOperationForDiskFull(imageName, operation);
      }

      return {
        photoId,
        imageName,
        status: 'error',
        error: (error as Error).message,
        url: photoUrl,
        attempts: attemptsUsed,
        retries: Math.max(0, attemptsUsed - 1),
      };
    }
  }

  private applyDownloadResultToStats(
    stats: DownloadStats,
    result?: DownloadResultItem
  ): void {
    const status = result?.status;
    if (status === 'downloaded') {
      stats.newDownloads++;
      stats.retryAttempts += (result?.attempts || 1) - 1;
      if (result?.recoveredAfterRetry) {
        stats.recoveredAfterRetry++;
      }
    } else if (status?.startsWith('already_exists')) {
      stats.alreadyDownloaded++;
    } else if (status === 'failed' || status === 'error') {
      stats.failedDownloads++;
      stats.retryAttempts += (result?.attempts || 1) - 1;
    } else if (status === 'cancelled') {
      stats.skipped++;
    }
  }

  private async countJpgFiles(directory: string): Promise<number> {
    if (!(await fs.pathExists(directory))) {
      return 0;
    }

    const files = await fs.readdir(directory);
    return files.filter(file => path.extname(file).toLowerCase() === '.jpg')
      .length;
  }

  private async pathExistsWithContent(filePath: string): Promise<boolean> {
    try {
      if (!(await fs.pathExists(filePath))) {
        return false;
      }

      const stats = await fs.stat(filePath);
      return stats.isFile() && stats.size > 0;
    } catch {
      return false;
    }
  }

  private async downloadEventCoverImage(
    event: EventDto,
    eventDir: string,
    token?: string,
    operation?: CurrentOperation
  ): Promise<string | undefined> {
    const imageName = this.normalizeImageName(event.ImageName);
    if (!imageName) {
      return undefined;
    }

    const imagePath = path.join(eventDir, 'event-image.jpg');
    if (await this.pathExistsWithContent(imagePath)) {
      return imagePath;
    }

    const attempt = await this.downloadPhotoWithRetry(imageName, token, operation);
    if (attempt.response?.success && attempt.response.value) {
      await fs.writeFile(imagePath, Buffer.from(attempt.response.value));
      return imagePath;
    }

    return undefined;
  }

  private async downloadProfileHistoryImage(
    photo: Photo,
    profileHistoryDir: string,
    token: string,
    operation?: CurrentOperation
  ): Promise<DownloadResultItem> {
    const photoId = this.sanitizeFileStem(this.normalizeId(photo.Id));
    const imageName = photo.ImageName;
    const photoUrl = buildCdnImageUrl(this.settings.cdnBase, imageName);

    if (!photoId || !imageName) {
      return {
        error: 'invalid_profile_history_entry',
        photoId,
        imageName,
        photo: JSON.stringify(photo),
      };
    }

    if (operation?.cancelled || this.currentOperation?.cancelled) {
      return {
        photoId,
        imageName,
        status: 'cancelled',
      };
    }

    const photoPath = path.join(profileHistoryDir, `${photoId}.jpg`);
    if (await fs.pathExists(photoPath)) {
      return {
        photoId,
        imageName,
        status: 'already_exists_in_profile_history',
        path: photoPath,
      };
    }

    let attemptsUsed = 1;
    try {
      const attempt = await this.downloadPhotoWithRetry(
        imageName,
        token,
        operation
      );
      attemptsUsed = attempt.attempts;
      const response = attempt.response;
      const recoveredAfterRetry =
        attempt.attempts > 1 && !!response?.success && !!response.value;

      if (response?.success && response.value) {
        const data = Buffer.from(response.value);
        try {
          await fs.writeFile(photoPath, data);
        } catch (error) {
          if (this.isOutOfDiskSpaceError(error)) {
            this.abortOperationForDiskFull(imageName, operation);
          }
          throw error;
        }
        return {
          photoId,
          imageName,
          status: 'downloaded',
          size: data.length,
          path: photoPath,
          url: photoUrl,
          attempts: attempt.attempts,
          retries: Math.max(0, attempt.attempts - 1),
          recoveredAfterRetry,
        };
      }

      if (response) {
        return {
          photoId,
          imageName,
          status: 'failed',
          statusCode: response.status,
          reason: (response.message || response.error) ?? undefined,
          url: photoUrl,
          attempts: attempt.attempts,
          retries: Math.max(0, attempt.attempts - 1),
        };
      }

      throw attempt.error ?? new Error('Download failed after retries');
    } catch (error) {
      if (error instanceof Error && error.message === 'Operation cancelled') {
        return {
          photoId,
          imageName,
          status: 'cancelled',
        };
      }

      if (this.isOutOfDiskSpaceError(error)) {
        this.abortOperationForDiskFull(imageName, operation);
      }

      return {
        photoId,
        imageName,
        status: 'error',
        error: (error as Error).message,
        url: photoUrl,
        attempts: attemptsUsed,
        retries: Math.max(0, attemptsUsed - 1),
      };
    }
  }

  private decodeJwtPayload(token: string): JwtPayload | null {
    try {
      const parts = token.trim().split('.');
      if (parts.length !== 3) {
        return null;
      }

      const payload = parts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
      const decoded = Buffer.from(payload, 'base64').toString('utf8');
      return JSON.parse(decoded) as JwtPayload;
    } catch {
      return null;
    }
  }

  private normalizeProfileHistoryPhotos(
    payload: ProfileHistoryImageDto[],
    accountId: string
  ): Photo[] {
    const normalizedAccountId = this.normalizeId(accountId);

    return payload
      .map<Photo>(photo => ({
        ...photo,
        Id: this.sanitizeFileStem(this.normalizeId(photo.Id)),
        Description: photo.Description ?? '',
        PlayerId: this.normalizeId(photo.PlayerId) || normalizedAccountId,
        TaggedPlayerIds: Array.isArray(photo.TaggedPlayerIds)
          ? photo.TaggedPlayerIds.map(id => this.normalizeId(id)).filter(
              Boolean
            )
          : [],
        RoomId: this.normalizeId(photo.RoomId),
        PlayerEventId: this.normalizeId(photo.PlayerEventId) || undefined,
      }))
      .filter(photo => !!photo.Id && !!photo.ImageName)
      .sort((a, b) => {
        const timeA = a.CreatedAt
          ? new Date(a.CreatedAt).getTime()
          : Number.MAX_SAFE_INTEGER;
        const timeB = b.CreatedAt
          ? new Date(b.CreatedAt).getTime()
          : Number.MAX_SAFE_INTEGER;
        if (timeA !== timeB) {
          return timeA - timeB;
        }
        return this.compareIds(a.Id, b.Id);
      });
  }

  private sanitizeFileStem(value: string): string {
    return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
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

  private normalizeImageName(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null') {
      return null;
    }

    return trimmed;
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

  private getRoomsRoot(): string {
    return path.join(this.getResolvedOutputRoot(), 'rooms');
  }

  private getRoomDirectory(roomId: string): string {
    return path.join(this.getRoomsRoot(), this.sanitizeFileStem(roomId));
  }

  private getEventsRoot(): string {
    return path.join(this.getResolvedOutputRoot(), 'events');
  }

  private getCreatorEventsDirectory(creatorAccountId: string): string {
    return path.join(
      this.getEventsRoot(),
      this.sanitizeFileStem(this.normalizeId(creatorAccountId))
    );
  }

  private getEventDirectory(
    creatorAccountId: string,
    eventId: string
  ): string {
    return path.join(
      this.getCreatorEventsDirectory(creatorAccountId),
      this.sanitizeFileStem(this.normalizeId(eventId))
    );
  }

  private async readEventFolderMeta(
    eventDir: string
  ): Promise<EventFolderMetaV1 | null> {
    try {
      const metaPath = this.getFolderMetaPath(eventDir);
      if (!(await fs.pathExists(metaPath))) {
        return null;
      }
      const parsed = (await fs.readJson(
        metaPath
      )) as Partial<EventFolderMetaV1>;
      if (!parsed || parsed.schemaVersion !== 1 || !parsed.eventId) {
        return null;
      }
      return parsed as EventFolderMetaV1;
    } catch {
      return null;
    }
  }

  private async writeEventFolderMeta(
    eventDir: string,
    event: EventDto,
    patch: Partial<EventFolderMetaV1> = {}
  ): Promise<EventFolderMetaV1> {
    const existing = await this.readEventFolderMeta(eventDir);
    const eventId = this.normalizeId(event.PlayerEventId);
    const creatorAccountId = this.normalizeId(event.CreatorPlayerId);
    const next: EventFolderMetaV1 = {
      schemaVersion: 1,
      creatorAccountId,
      eventId,
      name: event.Name || eventId,
      imageName: this.normalizeImageName(event.ImageName),
      startTime: event.StartTime,
      endTime: event.EndTime,
      attendeeCount:
        typeof event.AttendeeCount === 'number' ? event.AttendeeCount : 0,
      photoCount: existing?.photoCount ?? 0,
      downloadedPhotoCount: existing?.downloadedPhotoCount ?? 0,
      hasPhotos: existing?.hasPhotos ?? false,
      isDownloaded: existing?.isDownloaded ?? false,
      updatedAt: new Date().toISOString(),
      ...patch,
    };

    await fs.ensureDir(eventDir);
    await fs.writeJson(this.getFolderMetaPath(eventDir), next, { spaces: 2 });
    return next;
  }

  private async readCreatorEventsManifest(
    creatorAccountId: string
  ): Promise<EventDto[]> {
    const creatorDir = this.getCreatorEventsDirectory(creatorAccountId);
    const manifestPath = path.join(creatorDir, 'events.json');
    if (!(await fs.pathExists(manifestPath))) {
      return [];
    }

    const raw = (await fs.readJson(manifestPath)) as EventDto[];
    return Array.isArray(raw) ? this.normalizeEvents(raw) : [];
  }

  private eventToAvailableEvent(
    event: EventDto,
    meta?: EventFolderMetaV1 | null
  ): AvailableEvent {
    const creatorAccountId = this.normalizeId(event.CreatorPlayerId);
    const eventId = this.normalizeId(event.PlayerEventId);
    const downloadedPhotoCount = meta?.downloadedPhotoCount ?? 0;
    const photoCount = meta?.photoCount ?? downloadedPhotoCount;

    return {
      creatorAccountId,
      eventId,
      name: event.Name || meta?.name || eventId,
      imageName:
        this.normalizeImageName(event.ImageName) ??
        this.normalizeImageName(meta?.imageName),
      startTime: event.StartTime || meta?.startTime,
      endTime: event.EndTime || meta?.endTime,
      attendeeCount:
        typeof event.AttendeeCount === 'number'
          ? event.AttendeeCount
          : meta?.attendeeCount ?? 0,
      photoCount,
      downloadedPhotoCount,
      hasPhotos: meta?.hasPhotos ?? downloadedPhotoCount > 0,
      isDownloaded: meta?.isDownloaded ?? downloadedPhotoCount > 0,
      updatedAt: meta?.updatedAt,
    };
  }

  private async readRoomFolderMeta(
    roomDir: string
  ): Promise<RoomFolderMetaV1 | null> {
    try {
      const metaPath = this.getFolderMetaPath(roomDir);
      if (!(await fs.pathExists(metaPath))) {
        return null;
      }
      const parsed = (await fs.readJson(
        metaPath
      )) as Partial<RoomFolderMetaV1>;
      if (!parsed || parsed.schemaVersion !== 1 || !parsed.roomId) {
        return null;
      }
      return parsed as RoomFolderMetaV1;
    } catch {
      return null;
    }
  }

  private async writeRoomFolderMeta(
    roomDir: string,
    room: RoomDto,
    patch: Partial<RoomFolderMetaV1> = {}
  ): Promise<void> {
    const roomId = this.normalizeId(room.RoomId);
    const roomName = (room.Name || roomId).trim();
    const existing = await this.readRoomFolderMeta(roomDir);
    const next: RoomFolderMetaV1 = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      ...patch,
      nextSkip: patch.nextSkip ?? existing?.nextSkip,
      roomId,
      roomName,
      displayLabel: patch.displayLabel || existing?.displayLabel || roomName,
      roomPhotoCursors: {
        ...(existing?.roomPhotoCursors ?? {}),
        ...(patch.roomPhotoCursors ?? {}),
      },
      cache: { ...(existing?.cache ?? {}), ...(patch.cache ?? {}) },
    };

    await fs.writeJson(this.getFolderMetaPath(roomDir), next, { spaces: 2 });
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
      ImageName: this.normalizeImageName(event.ImageName),
      RoomId: this.normalizeId(event.RoomId),
    }));
  }

  private normalizeImageComments(
    comments: ImageCommentDto[]
  ): ImageCommentDto[] {
    return comments.map(comment => ({
      ...comment,
      SavedImageCommentId: this.normalizeId(comment.SavedImageCommentId),
      SavedImageId: this.normalizeId(comment.SavedImageId),
      PlayerId: this.normalizeId(comment.PlayerId),
    }));
  }

  private async rateLimitedFetchImageComments(
    imageId: string,
    token?: string,
    options?: { signal?: AbortSignal }
  ): Promise<ImageCommentDto[]> {
    const previous = this.imageCommentRequestGate;
    let unlock!: () => void;
    this.imageCommentRequestGate = new Promise<void>(resolve => {
      unlock = resolve;
    });
    await previous;

    try {
      if (IMAGE_COMMENT_REQUEST_MIN_INTERVAL_MS > 0) {
        const now = Date.now();
        const waitMs = Math.max(
          0,
          this.lastImageCommentRequestStartedAt +
            IMAGE_COMMENT_REQUEST_MIN_INTERVAL_MS -
            now
        );
        if (waitMs > 0) {
          await this.delay(waitMs, this.currentOperation ?? undefined);
        }
      }

      this.lastImageCommentRequestStartedAt = Date.now();
      return await this.imageCommentsController.fetchImageComments(
        imageId,
        token,
        options
      );
    } finally {
      unlock();
    }
  }

  private async fetchAndSaveImageCommentsMetadata(params: {
    source: DownloadSource;
    token?: string;
    requestOptions?: { signal?: AbortSignal };
    normalizedPhotos: Photo[];
    imageIdsWithComments: string[];
    imageCommentCounts: Map<string, number>;
    imageCommentsJsonPath: string;
    imageCommentsFileExists: boolean;
    forceRefresh: boolean;
  }): Promise<{
    imageCommentsFetched: number;
    imageComments: ImageCommentDto[];
  }> {
    if (
      params.imageIdsWithComments.length === 0 &&
      !params.imageCommentsFileExists
    ) {
      return { imageCommentsFetched: 0, imageComments: [] };
    }

    this.updateSourceProgress(
      'metadata',
      params.source,
      'Checking image comments cache',
      0,
      params.imageIdsWithComments.length,
      0,
      {
        pageLabel: 'Image comments',
      }
    );

    let cachedImageComments: ImageCommentDto[] = [];
    let imageCommentsFetched = 0;
    const cachedCommentCountsByImageId = new Map<string, number>();
    const currentPhotoIds = new Set(
      params.normalizedPhotos.map(photo => photo.Id).filter(Boolean)
    );

    if (params.imageCommentsFileExists) {
      try {
        const existing = (await fs.readJson(
          params.imageCommentsJsonPath
        )) as ImageCommentDto[];
        if (Array.isArray(existing)) {
          cachedImageComments = this.normalizeImageComments(existing);
          for (const comment of cachedImageComments) {
            const imageId = comment.SavedImageId;
            if (!imageId) {
              continue;
            }
            cachedCommentCountsByImageId.set(
              imageId,
              (cachedCommentCountsByImageId.get(imageId) ?? 0) + 1
            );
          }
          await fs.writeJson(
            params.imageCommentsJsonPath,
            cachedImageComments,
            {
              spaces: 2,
            }
          );
        }
      } catch (error) {
        console.log(
          `Warning: Failed to normalize cached image comment data: ${(error as Error).message}`
        );
      }
    }

    const missingOrChangedImageIds = params.forceRefresh
      ? params.imageIdsWithComments
      : params.imageIdsWithComments.filter(imageId => {
          const cachedCount = cachedCommentCountsByImageId.get(imageId) ?? 0;
          const expectedCount = params.imageCommentCounts.get(imageId) ?? 0;
          return cachedCount !== expectedCount;
        });
    const retainedCachedImageComments = cachedImageComments.filter(comment => {
      const imageId = comment.SavedImageId;
      if (!imageId) {
        return false;
      }
      if (
        currentPhotoIds.has(imageId) &&
        !params.imageCommentCounts.has(imageId)
      ) {
        return false;
      }
      return true;
    });

    if (missingOrChangedImageIds.length === 0) {
      if (retainedCachedImageComments.length !== cachedImageComments.length) {
        await fs.writeJson(
          params.imageCommentsJsonPath,
          retainedCachedImageComments,
          {
            spaces: 2,
          }
        );
        this.updateSourceProgress(
          'metadata',
          params.source,
          'Image comment data updated',
          params.imageIdsWithComments.length,
          params.imageIdsWithComments.length,
          100,
          {
            pageLabel: 'Image comments',
            recentActivity: 'Removed stale image comment cache entries.',
          }
        );
      } else {
        this.updateSourceProgress(
          'metadata',
          params.source,
          'Using cached image comment data',
          params.imageIdsWithComments.length,
          params.imageIdsWithComments.length,
          100,
          {
            pageLabel: 'Image comments',
            recentActivity: 'Using cached image comment data.',
          }
        );
      }

      return {
        imageCommentsFetched: 0,
        imageComments: retainedCachedImageComments,
      };
    }

    this.updateSourceProgress(
      'metadata',
      params.source,
      `Downloading image comment data (${missingOrChangedImageIds.length} image(s) need refresh)...`,
      0,
      missingOrChangedImageIds.length,
      0,
      {
        pageLabel: 'Image comments',
        recentActivity: `Downloading comments for ${missingOrChangedImageIds.length} image(s)...`,
      }
    );

    const refreshedComments: ImageCommentDto[] = [];
    for (let index = 0; index < missingOrChangedImageIds.length; index++) {
      const imageId = missingOrChangedImageIds[index];
      const commentsData = await this.runMetadataRequestWithRetry({
        label: `image comment metadata for image ${imageId}`,
        source: params.source,
        operationRef: this.currentOperation ?? undefined,
        pageLabel: 'Image comments',
        recentActivity: `Downloaded comments for image ${index + 1}/${missingOrChangedImageIds.length}.`,
        operation: () =>
          this.rateLimitedFetchImageComments(
            imageId,
            params.token,
            params.requestOptions
          ),
      });
      const normalizedComments = Array.isArray(commentsData)
        ? this.normalizeImageComments(commentsData)
        : [];
      refreshedComments.push(...normalizedComments);
      imageCommentsFetched += normalizedComments.length;
      this.updateSourceProgress(
        'metadata',
        params.source,
        `Downloaded image comments for ${index + 1}/${missingOrChangedImageIds.length} image(s)`,
        index + 1,
        missingOrChangedImageIds.length,
        Math.round(((index + 1) / missingOrChangedImageIds.length) * 100),
        {
          pageLabel: 'Image comments',
        }
      );
    }

    const refreshedImageIds = new Set(missingOrChangedImageIds);
    const mergedImageCommentsMap = new Map<string, ImageCommentDto>();

    for (const comment of retainedCachedImageComments) {
      const imageId = comment.SavedImageId;
      if (!imageId || refreshedImageIds.has(imageId)) {
        continue;
      }
      mergedImageCommentsMap.set(comment.SavedImageCommentId, comment);
    }

    for (const comment of refreshedComments) {
      mergedImageCommentsMap.set(comment.SavedImageCommentId, comment);
    }

    const mergedImageComments = Array.from(mergedImageCommentsMap.values());
    await fs.writeJson(params.imageCommentsJsonPath, mergedImageComments, {
      spaces: 2,
    });
    console.log(
      `Saved ${mergedImageComments.length} image comments to ${params.imageCommentsJsonPath} (downloaded ${refreshedComments.length} refreshed entries)`
    );

    this.updateSourceProgress(
      'metadata',
      params.source,
      'Image comment data updated',
      params.imageIdsWithComments.length,
      params.imageIdsWithComments.length,
      100,
      {
        pageLabel: 'Image comments',
      }
    );

    return {
      imageCommentsFetched,
      imageComments: mergedImageComments,
    };
  }

  private delay(ms: number, operation?: CurrentOperation): Promise<void> {
    if (operation?.cancelled || operation?.controller.signal.aborted) {
      return Promise.reject(this.createOperationCancelledError());
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        operation?.controller.signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timeout);
        reject(this.createOperationCancelledError());
      };

      operation?.controller.signal.addEventListener('abort', onAbort, {
        once: true,
      });
    });
  }

  private createDownloadBatchTrace(
    label: string,
    totalPhotos: number
  ): DownloadBatchTrace {
    const trace: DownloadBatchTrace = {
      label,
      startedAt: Date.now(),
      totalPhotos,
      maxConcurrentDownloads: this.settings.maxConcurrentDownloads,
      interPageDelayMs: this.settings.interPageDelayMs || 0,
      inFlight: 0,
      completed: 0,
    };
    console.log(
      `[${trace.label}] batch-start total=${trace.totalPhotos} maxConcurrentDownloads=${trace.maxConcurrentDownloads} interPageDelayMs=${trace.interPageDelayMs}`
    );
    return trace;
  }

  private logDownloadWorkerStart(
    trace: DownloadBatchTrace,
    details: {
      scheduledIndex: number;
      photoId: string;
      imageName?: string;
      scheduledDelayMs: number;
      slotWaitMs: number;
    }
  ): void {
    console.log(
      `[${trace.label}] start ${details.scheduledIndex}/${trace.totalPhotos} photoId=${details.photoId} image=${details.imageName || 'unknown'} launchOffsetMs=${Date.now() - trace.startedAt} scheduledDelayMs=${details.scheduledDelayMs} slotWaitMs=${details.slotWaitMs} inFlight=${trace.inFlight}/${trace.maxConcurrentDownloads}`
    );
  }

  private logDownloadWorkerFinish(
    trace: DownloadBatchTrace,
    details: {
      scheduledIndex: number;
      photoId: string;
      imageName?: string;
      result?: DownloadResultItem;
      runDurationMs: number;
    }
  ): void {
    console.log(
      `[${trace.label}] finish ${details.scheduledIndex}/${trace.totalPhotos} photoId=${details.photoId} image=${details.imageName || 'unknown'} status=${details.result?.status || details.result?.error || 'unknown'} durationMs=${details.runDurationMs} completed=${trace.completed}/${trace.totalPhotos} remainingInFlight=${trace.inFlight}/${trace.maxConcurrentDownloads}`
    );
  }

  private logDownloadBatchSummary(
    trace: DownloadBatchTrace,
    stats: DownloadStats
  ): void {
    console.log(
      `[${trace.label}] batch-complete elapsedMs=${Date.now() - trace.startedAt} total=${stats.totalPhotos} downloaded=${stats.newDownloads} alreadyHadFile=${stats.alreadyDownloaded} failed=${stats.failedDownloads} skipped=${stats.skipped} retryAttempts=${stats.retryAttempts} recoveredAfterRetry=${stats.recoveredAfterRetry}`
    );
  }

  private createProgressState(overrides: Partial<Progress>): Progress {
    return {
      isRunning: false,
      phase: 'complete',
      currentStep: 'Ready',
      progress: 0,
      total: 0,
      current: 0,
      statusLevel: 'info',
      issueCount: 0,
      retryAttempts: 0,
      failedItems: 0,
      recoveredAfterRetry: 0,
      currentSource: undefined,
      pageLabel: undefined,
      activeItemLabel: undefined,
      recentActivity: undefined,
      lastIssue: undefined,
      confirmation: undefined,
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
      recentActivity: undefined,
      lastIssue: undefined,
      confirmation: undefined,
    });
  }

  private markProgressIssue(
    level: 'warning' | 'error',
    message: string,
    options?: { retryIncrement?: number; failedItemIncrement?: number }
  ): void {
    if (!this.currentOperation || this.currentOperation.cancelled) {
      return;
    }
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
    if (!this.currentOperation || this.currentOperation.cancelled) {
      return;
    }
    this.progress = this.createProgressState({
      ...this.progress,
      statusLevel: this.progress.failedItems > 0 ? 'error' : 'warning',
      recoveredAfterRetry: this.progress.recoveredAfterRetry + 1,
      lastIssue: message,
    });
    this.emit('progress-update', this.progress);
  }

  private updateProgressActivity(
    recentActivity: string,
    overrides: Partial<Progress> = {}
  ): void {
    if (!this.currentOperation || this.currentOperation.cancelled) {
      return;
    }

    this.progress = this.createProgressState({
      ...this.progress,
      recentActivity,
      ...overrides,
    });
    this.emit('progress-update', this.progress);
  }

  private updateSourceProgress(
    phase: Progress['phase'],
    source: DownloadSource,
    step: string,
    current: number,
    total: number,
    progress?: number,
    overrides: Partial<Progress> = {}
  ): void {
    this.updateProgress(step, current, total, progress, {
      phase,
      currentSource: source,
      ...overrides,
    });
  }

  private getSourceLabel(source: DownloadSource): string {
    switch (source) {
      case 'user-feed':
        return 'user feed';
      case 'user-photos':
        return 'user photos';
      case 'profile-history':
        return 'profile picture history';
      case 'room-photos':
        return 'room photos';
      case 'event-photos':
        return 'event photos';
      default:
        return source;
    }
  }

  private async runMetadataRequestWithRetry<T>(params: {
    label: string;
    source: DownloadSource;
    operation: () => Promise<T>;
    operationRef?: CurrentOperation;
    pageLabel?: string;
    recentActivity?: string;
  }): Promise<T> {
    let attempts = 0;
    let lastError: Error | undefined;

    while (attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS) {
      if (params.operationRef?.cancelled || this.currentOperation?.cancelled) {
        throw this.createOperationCancelledError();
      }

      attempts++;

      try {
        const result = await params.operation();

        if (attempts > 1) {
          this.markProgressRecovery(
            `Recovered ${params.label} after ${attempts - 1} retr${
              attempts - 1 === 1 ? 'y' : 'ies'
            }. Metadata collection is continuing.`
          );
        }

        if (params.recentActivity) {
          this.updateProgressActivity(params.recentActivity, {
            phase: 'metadata',
            currentSource: params.source,
            pageLabel: params.pageLabel,
          });
        }

        return result;
      } catch (error) {
        if (this.isOperationCancelledError(error)) {
          throw error;
        }

        lastError = error as Error;
        const failureReason = lastError.message || 'unknown_error';
        const issueMessage =
          attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS
            ? `Issue collecting ${params.label}: ${failureReason}. Retry ${attempts}/${PHOTO_DOWNLOAD_RETRY_COUNT} will start now.`
            : `Metadata collection failed for ${params.label}: ${failureReason}.`;

        this.markProgressIssue(
          attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS ? 'warning' : 'error',
          issueMessage,
          {
            retryIncrement: attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS ? 1 : 0,
            failedItemIncrement:
              attempts >= PHOTO_DOWNLOAD_MAX_ATTEMPTS ? 1 : 0,
          }
        );

        if (attempts < PHOTO_DOWNLOAD_MAX_ATTEMPTS) {
          await this.delay(PHOTO_DOWNLOAD_RETRY_DELAY_MS, params.operationRef);
          continue;
        }
      }
    }

    throw new Error(
      `Failed to collect ${params.label} after ${PHOTO_DOWNLOAD_RETRY_COUNT} retries: ${
        lastError?.message || 'unknown_error'
      }`
    );
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
      if (operation?.cancelled || this.currentOperation?.cancelled) {
        throw this.createOperationCancelledError();
      }

      attempts++;

      try {
        const response = await this.photosController.downloadPhoto(
          imageName,
          this.settings.cdnBase,
          token,
          {
            signal: operation?.controller.signal,
            timeoutMs: PHOTO_DOWNLOAD_TIMEOUT_MS,
          }
        );
        if (this.isCancelledResponse(response)) {
          throw this.createOperationCancelledError();
        }
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
        if (this.isOperationCancelledError(error)) {
          throw error;
        }
        lastError = error as Error;
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
        await this.delay(PHOTO_DOWNLOAD_RETRY_DELAY_MS, operation);
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
    imageCommentCounts: Map<string, number>;
  } {
    const accountIds = new Set<string>();
    const roomIds = new Set<string>();
    const eventIds = new Set<string>();
    const imageCommentCounts = new Map<string, number>();

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

      if (
        photo.Id &&
        typeof photo.CommentCount === 'number' &&
        photo.CommentCount > 0
      ) {
        imageCommentCounts.set(photo.Id, photo.CommentCount);
      }
    }

    return { accountIds, roomIds, eventIds, imageCommentCounts };
  }

  async fetchAndSaveBulkData(
    accountId: string,
    photos: Photo[],
    token?: string,
    options: BulkDataRefreshOptions = {},
    source: DownloadSource = 'user-photos',
    storageContext?: BulkDataStorageContext
  ): Promise<{
    accountsFetched: number;
    roomsFetched: number;
    eventsFetched: number;
    imageCommentsFetched: number;
  }> {
    await this.ensureSettingsLoaded();
    try {
      const requestOptions = this.currentOperation
        ? { signal: this.currentOperation.controller.signal }
        : undefined;
      const {
        forceAccountsRefresh = false,
        forceRoomsRefresh = false,
        forceEventsRefresh = false,
        forceImageCommentsRefresh = false,
      } = options;
      const normalizedPhotos = this.normalizePhotos(photos);
      this.updateSourceProgress(
        'metadata',
        source,
        'Collecting related account, room, event, and image comment data...',
        0,
        0,
        0,
        {
          pageLabel: 'Related data',
          recentActivity: `Extracting related IDs from ${this.getSourceLabel(source)} metadata...`,
        }
      );

      // Extract unique IDs
      const { accountIds, roomIds, eventIds, imageCommentCounts } =
        this.extractUniqueIds(normalizedPhotos);
      let accountIdsArray = Array.from(accountIds);
      const roomIdsArray = Array.from(roomIds);
      const eventIdsArray = Array.from(eventIds);
      const imageIdsWithComments = Array.from(imageCommentCounts.keys());
      this.updateProgressActivity(
        `Found ${accountIdsArray.length} accounts, ${roomIdsArray.length} rooms, ${eventIdsArray.length} events, and ${imageIdsWithComments.length} image(s) with comments in ${this.getSourceLabel(source)} metadata.`,
        {
          phase: 'metadata',
          currentSource: source,
          pageLabel: 'Related data',
        }
      );

      console.log(
        `Found ${accountIdsArray.length} unique account IDs, ${roomIdsArray.length} unique room IDs, ${eventIdsArray.length} unique event IDs, and ${imageIdsWithComments.length} image IDs with comments`
      );

      const accountDir =
        storageContext?.directory ?? path.join(this.getResolvedOutputRoot(), accountId);
      const fileStem = storageContext?.fileStem ?? accountId;
      const shouldWriteOwnerMeta = storageContext?.writeOwnerMeta !== false;
      await fs.ensureDir(accountDir);

      let accountsFetched = 0;
      let roomsFetched = 0;
      let eventsFetched = 0;
      let imageCommentsFetched = 0;
      const accountsJsonPath = path.join(
        accountDir,
        `${fileStem}_accounts.json`
      );
      const roomsJsonPath = path.join(accountDir, `${fileStem}_rooms.json`);
      const eventsJsonPath = path.join(accountDir, `${fileStem}_events.json`);
      const imageCommentsJsonPath = path.join(
        accountDir,
        `${fileStem}_image_comments.json`
      );
      const accountsFileExists = await fs.pathExists(accountsJsonPath);
      const roomsFileExists = await fs.pathExists(roomsJsonPath);
      const eventsFileExists = await fs.pathExists(eventsJsonPath);
      const imageCommentsFileExists = await fs.pathExists(
        imageCommentsJsonPath
      );

      const initialPhotoDerivedAccountCount = accountIdsArray.length;
      const imageCommentMetadata = await this.fetchAndSaveImageCommentsMetadata(
        {
          source,
          token,
          requestOptions,
          normalizedPhotos,
          imageIdsWithComments,
          imageCommentCounts,
          imageCommentsJsonPath,
          imageCommentsFileExists,
          forceRefresh: forceImageCommentsRefresh,
        }
      );
      imageCommentsFetched = imageCommentMetadata.imageCommentsFetched;

      for (const comment of imageCommentMetadata.imageComments) {
        if (comment.PlayerId) {
          accountIds.add(comment.PlayerId);
        }
      }
      accountIdsArray = Array.from(accountIds);

      if (accountIdsArray.length !== initialPhotoDerivedAccountCount) {
        const commentOnlyAccounts = Math.max(
          0,
          accountIdsArray.length - initialPhotoDerivedAccountCount
        );
        this.updateProgressActivity(
          `Found ${commentOnlyAccounts} additional commenter account(s) from image comments.`,
          {
            phase: 'metadata',
            currentSource: source,
            pageLabel: 'Accounts',
          }
        );
        console.log(
          `Added ${commentOnlyAccounts} commenter account ID(s) from image comment metadata`
        );
      }

      // Fetch and save account data
      if (accountIdsArray.length > 0) {
        this.updateSourceProgress(
          'metadata',
          source,
          'Checking account cache',
          0,
          accountIdsArray.length,
          0,
          {
            pageLabel: 'Accounts',
          }
        );

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
              if (owner && shouldWriteOwnerMeta) {
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
          this.updateSourceProgress(
            'metadata',
            source,
            'Using cached account data',
            accountIdsArray.length,
            accountIdsArray.length,
            100,
            {
              pageLabel: 'Accounts',
              recentActivity: 'Using cached account data.',
            }
          );
        } else {
          this.updateSourceProgress(
            'metadata',
            source,
            `Downloading account data (${missingAccountIds.length} missing of ${accountIdsArray.length})...`,
            0,
            accountIdsArray.length,
            0,
            {
              pageLabel: 'Accounts',
              recentActivity: `Downloading ${missingAccountIds.length} missing account record(s)...`,
            }
          );

          const accountsData = await this.runMetadataRequestWithRetry({
            label: 'account metadata',
            source,
            operationRef: this.currentOperation ?? undefined,
            pageLabel: 'Accounts',
            recentActivity: 'Account metadata downloaded.',
            operation: () =>
              this.accountsController.fetchBulkAccounts(
                missingAccountIds,
                token,
                requestOptions
              ),
          });
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
           if (owner && shouldWriteOwnerMeta) {
             await this.writeFolderMeta(accountDir, accountId, { owner });
           }
          console.log(
            `Saved ${mergedAccounts.length} accounts to ${accountsJsonPath} (downloaded ${normalizedAccounts.length} new entries)`
          );

          this.updateSourceProgress(
            'metadata',
            source,
            'Account data updated',
            accountIdsArray.length,
            accountIdsArray.length,
            100,
            {
              pageLabel: 'Accounts',
            }
          );
        }
      }

      // Fetch and save room data
      if (roomIdsArray.length > 0) {
        this.updateSourceProgress(
          'metadata',
          source,
          'Checking rooms cache',
          0,
          roomIdsArray.length,
          0,
          {
            pageLabel: 'Rooms',
          }
        );

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
          this.updateSourceProgress(
            'metadata',
            source,
            'Using cached room data',
            roomIdsArray.length,
            roomIdsArray.length,
            100,
            {
              pageLabel: 'Rooms',
              recentActivity: 'Using cached room data.',
            }
          );
        } else {
          this.updateSourceProgress(
            'metadata',
            source,
            `Downloading room data (${missingRoomIds.length} missing of ${roomIdsArray.length})...`,
            0,
            roomIdsArray.length,
            0,
            {
              pageLabel: 'Rooms',
              recentActivity: `Downloading ${missingRoomIds.length} missing room record(s)...`,
            }
          );
          const roomsData = await this.runMetadataRequestWithRetry({
            label: 'room metadata',
            source,
            operationRef: this.currentOperation ?? undefined,
            pageLabel: 'Rooms',
            recentActivity: 'Room metadata downloaded.',
            operation: () =>
              this.roomsController.fetchBulkRooms(
                missingRoomIds,
                token,
                requestOptions
              ),
          });
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

          this.updateSourceProgress(
            'metadata',
            source,
            'Room data updated',
            roomIdsArray.length,
            roomIdsArray.length,
            100,
            {
              pageLabel: 'Rooms',
            }
          );
        }
      }

      // Fetch and save event data
      if (eventIdsArray.length > 0) {
        this.updateSourceProgress(
          'metadata',
          source,
          'Checking events cache',
          0,
          eventIdsArray.length,
          0,
          {
            pageLabel: 'Events',
          }
        );

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
          this.updateSourceProgress(
            'metadata',
            source,
            'Using cached event data',
            eventIdsArray.length,
            eventIdsArray.length,
            100,
            {
              pageLabel: 'Events',
              recentActivity: 'Using cached event data.',
            }
          );
        } else {
          this.updateSourceProgress(
            'metadata',
            source,
            `Downloading event data (${missingEventIds.length} missing of ${eventIdsArray.length})...`,
            0,
            eventIdsArray.length,
            0,
            {
              pageLabel: 'Events',
              recentActivity: `Downloading ${missingEventIds.length} missing event record(s)...`,
            }
          );
          const eventsData = await this.runMetadataRequestWithRetry({
            label: 'event metadata',
            source,
            operationRef: this.currentOperation ?? undefined,
            pageLabel: 'Events',
            recentActivity: 'Event metadata downloaded.',
            operation: () =>
              this.eventsController.fetchBulkEvents(
                missingEventIds,
                token,
                requestOptions
              ),
          });
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

          this.updateSourceProgress(
            'metadata',
            source,
            'Event data updated',
            eventIdsArray.length,
            eventIdsArray.length,
            100,
            {
              pageLabel: 'Events',
            }
          );
        }
      }

      return {
        accountsFetched,
        roomsFetched,
        eventsFetched,
        imageCommentsFetched,
      };
    } catch (error) {
      console.log(
        `Failed to fetch and save bulk data: ${(error as Error).message}`
      );
      throw error;
    }
  }

  async buildDownloadPreflightSummary(
    accountId: string,
    selection: DownloadSourceSelection
  ): Promise<DownloadPreflightSummary> {
    await this.ensureSettingsLoaded();

    const sourceSummaries = await Promise.all(
      getSelectedDownloadSources(selection).map(source =>
        this.buildPreflightSourceSummary(accountId, source)
      )
    );

    return {
      accountId,
      sourceSummaries,
      totalImages: sourceSummaries.reduce(
        (sum, summary) => sum + summary.totalImages,
        0
      ),
      totalAlreadyOnDisk: sourceSummaries.reduce(
        (sum, summary) => sum + summary.alreadyOnDisk,
        0
      ),
      totalRemainingToDownload: sourceSummaries.reduce(
        (sum, summary) => sum + summary.remainingToDownload,
        0
      ),
    };
  }

  private async buildPreflightSourceSummary(
    accountId: string,
    source: DownloadSource
  ): Promise<DownloadPreflightSourceSummary> {
    const accountDir = path.join(this.getResolvedOutputRoot(), accountId);

    if (source === 'user-photos') {
      const metadataPath = path.join(accountDir, `${accountId}_photos.json`);
      const photosDir = path.join(accountDir, 'photos');
      const feedDir = path.join(accountDir, 'feed');
      const metadata = await this.readPhotoMetadataFile(metadataPath);
      const photosInfo = await this.readImageDirectoryInfo(photosDir);
      const feedInfo = await this.readImageDirectoryInfo(feedDir);
      const isOnDisk = (photo: Photo): boolean => {
        const photoId = this.normalizeId(photo.Id);
        return (
          !!photoId &&
          (photosInfo.ids.has(photoId) || feedInfo.ids.has(photoId))
        );
      };
      const alreadyOnDisk = metadata.filter(isOnDisk).length;
      const remainingToDownload = Math.max(0, metadata.length - alreadyOnDisk);
      const privateImagesToDownload = metadata.filter(
        photo => photo.Accessibility === 0 && !isOnDisk(photo)
      ).length;

      return {
        source,
        label: 'User Photos',
        totalImages: metadata.length,
        alreadyOnDisk,
        remainingToDownload,
        privateImagesToDownload,
        metadataPath,
        downloadDirectory: photosDir,
      };
    }

    if (source === 'user-feed') {
      const metadataPath = path.join(accountDir, `${accountId}_feed.json`);
      const feedDir = path.join(accountDir, 'feed');
      const photosDir = path.join(accountDir, 'photos');
      const metadata = await this.readPhotoMetadataFile(metadataPath);
      const feedInfo = await this.readImageDirectoryInfo(feedDir);
      const photosInfo = await this.readImageDirectoryInfo(photosDir);
      const isOnDisk = (photo: Photo): boolean => {
        const photoId = this.normalizeId(photo.Id);
        return (
          !!photoId &&
          (feedInfo.ids.has(photoId) || photosInfo.ids.has(photoId))
        );
      };
      const alreadyOnDisk = metadata.filter(isOnDisk).length;
      const remainingToDownload = Math.max(0, metadata.length - alreadyOnDisk);
      const privateImagesToDownload = metadata.filter(
        photo => photo.Accessibility === 0 && !isOnDisk(photo)
      ).length;

      return {
        source,
        label: 'User Feed',
        totalImages: metadata.length,
        alreadyOnDisk,
        remainingToDownload,
        privateImagesToDownload,
        metadataPath,
        downloadDirectory: feedDir,
      };
    }

    const metadataPath = path.join(
      accountDir,
      `${accountId}_profile_history.json`
    );
    const profileHistoryDir = path.join(accountDir, 'profile-history');
    const manifestPayload = await this.readProfileHistoryManifest(metadataPath);
    const metadata = this.normalizeProfileHistoryPhotos(
      manifestPayload,
      accountId
    );
    const directoryInfo = await this.readImageDirectoryInfo(profileHistoryDir);
    const alreadyOnDisk = metadata.filter(photo => {
      const photoId = this.normalizeId(photo.Id);
      return !!photoId && directoryInfo.ids.has(photoId);
    }).length;
    const remainingToDownload = Math.max(0, metadata.length - alreadyOnDisk);

    return {
      source,
      label: 'Profile Picture History',
      totalImages: metadata.length,
      alreadyOnDisk,
      remainingToDownload,
      metadataPath,
      downloadDirectory: profileHistoryDir,
    };
  }

  private async readPhotoMetadataFile(metadataPath: string): Promise<Photo[]> {
    if (!(await fs.pathExists(metadataPath))) {
      return [];
    }

    const payload = (await fs.readJson(metadataPath)) as ImageDto[];
    return Array.isArray(payload) ? this.normalizePhotos(payload) : [];
  }

  private async readProfileHistoryManifest(
    metadataPath: string
  ): Promise<ProfileHistoryImageDto[]> {
    if (!(await fs.pathExists(metadataPath))) {
      return [];
    }

    const payload = (await fs.readJson(
      metadataPath
    )) as ProfileHistoryImageDto[];
    return Array.isArray(payload) ? payload : [];
  }

  private async readImageDirectoryInfo(directoryPath: string): Promise<{
    ids: Set<string>;
  }> {
    const ids = new Set<string>();

    if (!(await fs.pathExists(directoryPath))) {
      return { ids };
    }

    const entries = await fs.readdir(directoryPath);
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.jpg')) {
        continue;
      }

      const id = path.parse(entry).name;
      if (id) {
        ids.add(id);
      }
    }

    return { ids };
  }

  private setDownloadItemActivity(
    source: DownloadSource,
    imageLabel: string
  ): void {
    this.updateProgressActivity(`Downloading ${imageLabel}...`, {
      phase: 'download',
      currentSource: source,
      activeItemLabel: imageLabel,
    });
  }

  private setDownloadResultActivity(
    source: DownloadSource,
    result?: DownloadResultItem
  ): void {
    if (!result) {
      return;
    }

    const imageLabel = result.imageName || result.photoId || 'image';
    let recentActivity: string | undefined;

    if (result.status === 'downloaded') {
      recentActivity = `Downloaded ${imageLabel}.`;
    } else if (
      result.status &&
      (result.status.startsWith('already_exists') ||
        result.status.startsWith('copied_from'))
    ) {
      recentActivity = `Grabbed from disk: ${imageLabel}.`;
    } else if (result.status === 'failed' || result.status === 'error') {
      const retryCount = Math.max(0, (result.attempts || 1) - 1);
      recentActivity =
        retryCount > 0
          ? `Could not download ${imageLabel} after ${retryCount} retr${
              retryCount === 1 ? 'y' : 'ies'
            }.`
          : `Could not download ${imageLabel}.`;
    }

    if (!recentActivity) {
      return;
    }

    this.updateProgressActivity(recentActivity, {
      phase: 'download',
      currentSource: source,
      activeItemLabel: imageLabel,
    });
  }

  async lookupAccountById(accountId: string): Promise<AccountInfo> {
    try {
      return await this.accountsController.lookupAccountById(accountId);
    } catch (error) {
      throw new Error(
        `Failed to lookup account by account ID: ${(error as Error).message}`
      );
    }
  }

  async lookupAccountByUsername(
    username: string,
    token?: string
  ): Promise<AccountInfo> {
    try {
      return await this.accountsController.lookupAccountByUsername(
        username,
        token
      );
    } catch (error) {
      throw new Error(
        `Failed to lookup account by username: ${(error as Error).message}`
      );
    }
  }

  async searchAccounts(
    username: string,
    token?: string
  ): Promise<AccountInfo[]> {
    try {
      return await this.accountsController.searchAccounts(username, token);
    } catch (error) {
      throw new Error(`Failed to search accounts: ${(error as Error).message}`);
    }
  }

  async discoverEventsForUsername(
    username: string,
    token?: string
  ): Promise<EventDiscoveryResult> {
    await this.ensureSettingsLoaded();
    const cleanedUsername = username.trim();
    if (!cleanedUsername) {
      throw new Error('Username is required.');
    }

    const account = await this.lookupAccountByUsername(cleanedUsername, token);
    const creatorAccountId = this.normalizeId(account.accountId);
    if (!creatorAccountId) {
      throw new Error('Account not found.');
    }

    const creatorDir = this.getCreatorEventsDirectory(creatorAccountId);
    await fs.ensureDir(creatorDir);

    const events: EventDto[] = [];
    let skip = 0;
    while (true) {
      const page = this.normalizeEvents(
        await this.eventsController.fetchCreatorEvents(
          creatorAccountId,
          { skip, take: EVENT_DISCOVERY_PAGE_SIZE },
          token
        )
      );
      events.push(...page);
      if (page.length < EVENT_DISCOVERY_PAGE_SIZE) {
        break;
      }
      skip += EVENT_DISCOVERY_PAGE_SIZE;
    }

    const dedupedEvents = Array.from(
      new Map(events.map(event => [event.PlayerEventId, event])).values()
    ).sort((a, b) => {
      const timeA = a.StartTime ? new Date(a.StartTime).getTime() : 0;
      const timeB = b.StartTime ? new Date(b.StartTime).getTime() : 0;
      return timeB - timeA;
    });

    await fs.writeJson(path.join(creatorDir, 'events.json'), dedupedEvents, {
      spaces: 2,
    });
    await fs.writeJson(
      path.join(creatorDir, 'creator.json'),
      this.normalizeAccounts([account as PlayerResult])[0],
      { spaces: 2 }
    );

    const availableEvents: AvailableEvent[] = [];
    for (const event of dedupedEvents) {
      const eventDir = this.getEventDirectory(
        creatorAccountId,
        event.PlayerEventId
      );
      const meta = await this.writeEventFolderMeta(eventDir, event);
      availableEvents.push(this.eventToAvailableEvent(event, meta));
    }

    return {
      creatorAccountId,
      username: account.username || cleanedUsername,
      displayName: account.displayName,
      events: availableEvents,
    };
  }

  async listAvailableEvents(
    creatorAccountId?: string
  ): Promise<AvailableEvent[]> {
    await this.ensureSettingsLoaded();
    const eventsRoot = this.getEventsRoot();
    const available: AvailableEvent[] = [];

    if (!(await fs.pathExists(eventsRoot))) {
      return available;
    }

    const creatorIds = creatorAccountId
      ? [this.sanitizeFileStem(this.normalizeId(creatorAccountId))]
      : (await fs.readdir(eventsRoot, { withFileTypes: true }))
          .filter(entry => entry.isDirectory())
          .map(entry => entry.name);

    for (const id of creatorIds) {
      const events = await this.readCreatorEventsManifest(id);
      for (const event of events) {
        const eventDir = this.getEventDirectory(id, event.PlayerEventId);
        const meta = await this.readEventFolderMeta(eventDir);
        const availableEvent = this.eventToAvailableEvent(event, meta);
        const localImagePath = path.join(eventDir, 'event-image.jpg');
        if (await this.pathExistsWithContent(localImagePath)) {
          availableEvent.localImagePath = localImagePath;
        }
        available.push(availableEvent);
      }
    }

    return available.sort((a, b) => {
      const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
      const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
      return timeB - timeA;
    });
  }

  async listAvailableEventCreators(): Promise<AvailableEventCreator[]> {
    await this.ensureSettingsLoaded();
    const eventsRoot = this.getEventsRoot();
    const creators: AvailableEventCreator[] = [];

    if (!(await fs.pathExists(eventsRoot))) {
      return creators;
    }

    const entries = await fs.readdir(eventsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const creatorAccountId = entry.name;
      const creatorDir = path.join(eventsRoot, creatorAccountId);
      const creatorPath = path.join(creatorDir, 'creator.json');
      let creator: Partial<PlayerResult> | null = null;
      if (await fs.pathExists(creatorPath)) {
        try {
          creator = (await fs.readJson(creatorPath)) as Partial<PlayerResult>;
        } catch {
          creator = null;
        }
      }

      const events = await this.listAvailableEvents(creatorAccountId);
      if (events.length === 0) {
        continue;
      }

      const displayName = (creator?.displayName || '').trim();
      const username = (creator?.username || '').trim();
      const displayLabel =
        displayName && username
          ? `${displayName} (@${username})`
          : displayName || (username ? `@${username}` : creatorAccountId);

      const updatedAtValues = events
        .map(event => event.updatedAt)
        .filter((value): value is string => !!value)
        .sort();

      creators.push({
        creatorAccountId,
        username: username || undefined,
        displayName: displayName || undefined,
        displayLabel,
        eventCount: events.length,
        downloadedEventCount: events.filter(event => event.isDownloaded).length,
        photoCount: events.reduce(
          (sum, event) => sum + event.downloadedPhotoCount,
          0
        ),
        updatedAt: updatedAtValues[updatedAtValues.length - 1],
      });
    }

    return creators.sort((a, b) =>
      a.displayLabel.localeCompare(b.displayLabel, undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    );
  }

  async loadEventAlbumsForCreator(
    creatorAccountId: string
  ): Promise<AvailableEvent[]> {
    return this.listAvailableEvents(creatorAccountId);
  }

  async loadEventAlbumPhotos(params: {
    creatorAccountId: string;
    eventId: string;
  }): Promise<Photo[]> {
    await this.ensureSettingsLoaded();
    const creatorAccountId = this.normalizeId(params.creatorAccountId);
    const eventId = this.normalizeId(params.eventId);
    if (!creatorAccountId || !eventId) {
      return [];
    }

    const eventDir = this.getEventDirectory(creatorAccountId, eventId);
    const photosJsonPath = path.join(eventDir, `${eventId}_photos.json`);
    if (!(await fs.pathExists(photosJsonPath))) {
      return [];
    }

    const photos = this.normalizePhotos((await fs.readJson(photosJsonPath)) as Photo[]);
    const photosDir = path.join(eventDir, 'photos');
    const photoFileIds = new Set<string>();
    if (await fs.pathExists(photosDir)) {
      for (const file of await fs.readdir(photosDir)) {
        const id = path.parse(file).name;
        if (id) {
          photoFileIds.add(id);
        }
      }
    }

    return photos
      .filter(photo => photo.Id && photoFileIds.has(this.normalizeId(photo.Id)))
      .map(photo => ({
        ...photo,
        localFilePath: path.join(photosDir, `${this.sanitizeFileStem(photo.Id)}.jpg`),
      }));
  }

  async loadEventAlbumAccountsData(params: {
    creatorAccountId: string;
    eventId: string;
  }): Promise<PlayerResult[]> {
    await this.ensureSettingsLoaded();
    const creatorAccountId = this.normalizeId(params.creatorAccountId);
    const eventId = this.normalizeId(params.eventId);
    if (!creatorAccountId || !eventId) {
      return [];
    }
    const eventDir = this.getEventDirectory(creatorAccountId, eventId);
    const jsonPath = path.join(eventDir, `${eventId}_accounts.json`);
    if (!(await fs.pathExists(jsonPath))) {
      return [];
    }
    try {
      const raw = (await fs.readJson(jsonPath)) as PlayerResult[];
      return Array.isArray(raw) ? this.normalizeAccounts(raw) : [];
    } catch {
      return [];
    }
  }

  async loadEventAlbumRoomsData(params: {
    creatorAccountId: string;
    eventId: string;
  }): Promise<RoomDto[]> {
    await this.ensureSettingsLoaded();
    const creatorAccountId = this.normalizeId(params.creatorAccountId);
    const eventId = this.normalizeId(params.eventId);
    if (!creatorAccountId || !eventId) {
      return [];
    }
    const eventDir = this.getEventDirectory(creatorAccountId, eventId);
    const jsonPath = path.join(eventDir, `${eventId}_rooms.json`);
    if (!(await fs.pathExists(jsonPath))) {
      return [];
    }
    try {
      const raw = (await fs.readJson(jsonPath)) as RoomDto[];
      return Array.isArray(raw) ? this.normalizeRooms(raw) : [];
    } catch {
      return [];
    }
  }

  async loadEventAlbumEventsData(params: {
    creatorAccountId: string;
    eventId: string;
  }): Promise<EventDto[]> {
    await this.ensureSettingsLoaded();
    const creatorAccountId = this.normalizeId(params.creatorAccountId);
    const eventId = this.normalizeId(params.eventId);
    if (!creatorAccountId || !eventId) {
      return [];
    }
    const eventDir = this.getEventDirectory(creatorAccountId, eventId);
    const jsonPath = path.join(eventDir, `${eventId}_events.json`);
    if (!(await fs.pathExists(jsonPath))) {
      return [];
    }
    try {
      const raw = (await fs.readJson(jsonPath)) as EventDto[];
      return Array.isArray(raw) ? this.normalizeEvents(raw) : [];
    } catch {
      return [];
    }
  }

  async loadEventAlbumImageCommentsData(params: {
    creatorAccountId: string;
    eventId: string;
  }): Promise<ImageCommentDto[]> {
    await this.ensureSettingsLoaded();
    const creatorAccountId = this.normalizeId(params.creatorAccountId);
    const eventId = this.normalizeId(params.eventId);
    if (!creatorAccountId || !eventId) {
      return [];
    }
    const eventDir = this.getEventDirectory(creatorAccountId, eventId);
    const jsonPath = path.join(eventDir, `${eventId}_image_comments.json`);
    if (!(await fs.pathExists(jsonPath))) {
      return [];
    }
    try {
      const raw = (await fs.readJson(jsonPath)) as ImageCommentDto[];
      return Array.isArray(raw) ? this.normalizeImageComments(raw) : [];
    } catch {
      return [];
    }
  }

  async downloadEventPhotos(params: {
    creatorAccountId: string;
    eventIds: string[];
    token?: string;
  }): Promise<EventPhotoBatchResult> {
    await this.ensureSettingsLoaded();
    const operation = this.startOperation();
    const creatorAccountId = this.normalizeId(params.creatorAccountId);
    const eventIds = Array.from(
      new Set((params.eventIds || []).map(id => this.normalizeId(id)).filter(Boolean))
    );
    if (!creatorAccountId || eventIds.length === 0) {
      throw new Error('Choose at least one event to download.');
    }

    const eventsDirectory = this.getCreatorEventsDirectory(creatorAccountId);
    const downloadStats: DownloadStats = {
      totalPhotos: 0,
      alreadyDownloaded: 0,
      newDownloads: 0,
      failedDownloads: 0,
      skipped: 0,
      retryAttempts: 0,
      recoveredAfterRetry: 0,
    };
    const downloadResults: DownloadResultItem[] = [];
    const downloadedEvents: AvailableEvent[] = [];
    let photosFetched = 0;

    try {
      await fs.ensureDir(eventsDirectory);
      const manifest = await this.readCreatorEventsManifest(creatorAccountId);
      const eventsById = new Map(
        manifest.map(event => [this.normalizeId(event.PlayerEventId), event])
      );

      this.resetProgressIssueState();
      this.updateSourceProgress(
        'metadata',
        'event-photos',
        'Preparing event photo download...',
        0,
        eventIds.length,
        0
      );

      for (let eventIndex = 0; eventIndex < eventIds.length; eventIndex++) {
        if (operation.cancelled) {
          throw this.createOperationCancelledError();
        }

        const eventId = eventIds[eventIndex];
        const event = eventsById.get(eventId);
        if (!event) {
          downloadStats.failedDownloads++;
          downloadResults.push({
            photoId: eventId,
            status: 'failed',
            reason: 'Event metadata was not found. Refresh events and try again.',
          });
          continue;
        }

        const eventDir = this.getEventDirectory(creatorAccountId, eventId);
        const photosDir = path.join(eventDir, 'photos');
        const metadataPath = path.join(eventDir, `${eventId}_photos.json`);
        await fs.ensureDir(eventDir);
        await fs.ensureDir(photosDir);
        await this.writeEventFolderMeta(eventDir, event);
        const localImagePath = await this.downloadEventCoverImage(
          event,
          eventDir,
          params.token,
          operation
        );

        const eventPhotos: Photo[] = [];
        let skip = 0;
        while (true) {
          if (operation.cancelled) {
            throw this.createOperationCancelledError();
          }

          const page = this.normalizePhotos(
            await this.runMetadataRequestWithRetry({
              label: `event ${eventId} photos page ${Math.floor(skip / EVENT_PHOTO_PAGE_SIZE) + 1}`,
              source: 'event-photos',
              operationRef: operation,
              pageLabel: event.Name || eventId,
              recentActivity: `Collected event photos for ${event.Name || eventId}.`,
              operation: () =>
                this.photosController.fetchPlayerEventPhotos(
                  eventId,
                  { skip, take: EVENT_PHOTO_PAGE_SIZE },
                  params.token,
                  { signal: operation.controller.signal }
                ),
            })
          );
          eventPhotos.push(...page);
          photosFetched += page.length;
          if (page.length < EVENT_PHOTO_PAGE_SIZE) {
            break;
          }
          skip += EVENT_PHOTO_PAGE_SIZE;
        }

        const normalizedEventPhotos = Array.from(
          new Map(eventPhotos.map(photo => [photo.Id, photo])).values()
        );
        await fs.writeJson(metadataPath, normalizedEventPhotos, { spaces: 2 });
        downloadStats.totalPhotos += normalizedEventPhotos.length;

        const eventBulkContextPhoto: ImageDto = {
          Id: 'stm-event-bulk-context',
          Type: 1,
          Accessibility: 1,
          AccessibilityLocked: false,
          ImageName: '',
          Description: '',
          PlayerId: this.normalizeId(event.CreatorPlayerId),
          TaggedPlayerIds: [],
          RoomId: this.normalizeId(event.RoomId),
          PlayerEventId: this.normalizeId(event.PlayerEventId),
          CreatedAt: new Date().toISOString(),
          CheerCount: 0,
          CommentCount: 0,
        };
        const hasBulkContextIds =
          !!eventBulkContextPhoto.PlayerId ||
          !!eventBulkContextPhoto.RoomId ||
          !!eventBulkContextPhoto.PlayerEventId;
        const photosForBulk = hasBulkContextIds
          ? this.normalizePhotos([
              ...normalizedEventPhotos,
              eventBulkContextPhoto,
            ])
          : normalizedEventPhotos;

        try {
          const bulkData = await this.fetchAndSaveBulkData(
            creatorAccountId,
            photosForBulk,
            params.token,
            {},
            'event-photos',
            { directory: eventDir, fileStem: eventId, writeOwnerMeta: false }
          );
          console.log(
            `Fetched (event ${eventId}) ${bulkData.accountsFetched} accounts, ${bulkData.roomsFetched} rooms, ${bulkData.eventsFetched} events, and ${bulkData.imageCommentsFetched} image comment record(s)`
          );
        } catch (error) {
          console.log(
            `Warning: Failed to fetch bulk data for event ${eventId}: ${(error as Error).message}`
          );
        }

        const trace = this.createDownloadBatchTrace(
          `event-${eventId}-photo-downloads`,
          normalizedEventPhotos.length
        );
        const semaphore = new Semaphore(this.settings.maxConcurrentDownloads);
        let processedCount = 0;
        this.updateSourceProgress(
          'download',
          'event-photos',
          `Downloading ${event.Name || eventId} photos...`,
          eventIndex,
          eventIds.length,
          Math.round((eventIndex / eventIds.length) * 100),
          { activeItemLabel: event.Name || eventId }
        );

        const promises = normalizedEventPhotos.map((photo, index) =>
          (async (): Promise<DownloadResultItem> => {
            await semaphore.acquire();
            const scheduledIndex = index + 1;
            const runStartedAt = Date.now();
            const photoId = this.normalizeId(photo.Id);
            const imageName = photo.ImageName;
            trace.inFlight++;
            this.logDownloadWorkerStart(trace, {
              scheduledIndex,
              photoId,
              imageName,
              scheduledDelayMs: 0,
              slotWaitMs: 0,
            });
            let result: DownloadResultItem | undefined;
            try {
              this.setDownloadItemActivity(
                'event-photos',
                imageName || photoId || `image ${scheduledIndex}`
              );
              result = await this.downloadImageToDirectory(
                photo,
                photosDir,
                params.token,
                operation
              );
              this.applyDownloadResultToStats(downloadStats, result);
              return result;
            } finally {
              trace.inFlight = Math.max(0, trace.inFlight - 1);
              trace.completed++;
              this.logDownloadWorkerFinish(trace, {
                scheduledIndex,
                photoId,
                imageName,
                result,
                runDurationMs: Date.now() - runStartedAt,
              });
              semaphore.release();
              if (this.currentOperation === operation) {
                processedCount++;
                this.setDownloadResultActivity('event-photos', result);
                this.updateSourceProgress(
                  'download',
                  'event-photos',
                  `Downloading ${event.Name || eventId} photos...`,
                  processedCount,
                  normalizedEventPhotos.length
                );
              }
            }
          })()
        );
        downloadResults.push(...(await Promise.all(promises)));

        const downloadedPhotoCount = await this.countJpgFiles(photosDir);
        const meta = await this.writeEventFolderMeta(eventDir, event, {
          photoCount: normalizedEventPhotos.length,
          downloadedPhotoCount,
          hasPhotos: normalizedEventPhotos.length > 0,
          isDownloaded:
            normalizedEventPhotos.length > 0 &&
            downloadedPhotoCount >= normalizedEventPhotos.length,
        });
        const availableEvent = this.eventToAvailableEvent(event, meta);
        if (localImagePath) {
          availableEvent.localImagePath = localImagePath;
        }
        downloadedEvents.push(availableEvent);
        this.logDownloadBatchSummary(trace, downloadStats);
      }

      this.setOperationComplete();
      return {
        creatorAccountId,
        eventIds,
        eventsDirectory,
        eventsProcessed: downloadedEvents.length,
        photosFetched,
        downloadedEvents,
        downloadStats,
        downloadResults,
        totalResults: downloadResults.length,
        guidance: this.buildDownloadGuidance('event photos', downloadStats),
      };
    } catch (error) {
      if (!this.isOperationCancelledError(error)) {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    } finally {
      this.finishOperation(operation);
    }
  }

  async lookupRoomByName(roomName: string, token?: string): Promise<RoomDto> {
    await this.ensureSettingsLoaded();
    const cleanedRoomName = roomName.trim();
    if (!cleanedRoomName) {
      throw new Error('Room name is required.');
    }

    try {
      const room = this.normalizeRooms([
        await this.roomsController.lookupRoomByName(cleanedRoomName, token),
      ])[0];
      if (!room?.RoomId) {
        throw new Error('Room not found');
      }
      return room;
    } catch (error) {
      throw new Error(
        `Failed to lookup room by name: ${(error as Error).message}`
      );
    }
  }

  async downloadRoomPhotoBatch(params: {
    roomName: string;
    token?: string;
    startSkip?: number;
    batchPages?: number;
    pageSize?: number;
    sort?: RoomPhotoSort;
    forceAccountsRefresh?: boolean;
    forceRoomsRefresh?: boolean;
    forceEventsRefresh?: boolean;
    forceImageCommentsRefresh?: boolean;
  }): Promise<RoomPhotoBatchResult> {
    await this.ensureSettingsLoaded();
    const operation = this.startOperation();
    const pageSize = Math.min(
      ROOM_PHOTO_DEFAULT_PAGE_SIZE,
      Math.max(1, Math.floor(params.pageSize ?? ROOM_PHOTO_DEFAULT_PAGE_SIZE))
    );
    const batchPages = Math.max(
      1,
      Math.floor(params.batchPages ?? ROOM_PHOTO_DEFAULT_BATCH_PAGES)
    );
    const requestedStartSkip =
      params.startSkip === undefined
        ? undefined
        : Math.max(0, Math.floor(params.startSkip));
    const roomPhotoSort: RoomPhotoSort =
      params.sort === 1 ? 1 : ROOM_PHOTO_DEFAULT_SORT;

    try {
      this.resetProgressIssueState();
      this.updateSourceProgress(
        'metadata',
        'room-photos',
        'Validating room...',
        0,
        0,
        0,
        { recentActivity: `Looking up room ${params.roomName.trim()}...` }
      );

      const room = await this.lookupRoomByName(params.roomName, params.token);
      const roomId = this.normalizeId(room.RoomId);
      const roomName = room.Name || params.roomName.trim();
      const roomDir = this.getRoomDirectory(roomId);
      const photosDir = path.join(roomDir, 'photos');
      const metadataPath = path.join(roomDir, `${roomId}_photos.json`);

      await fs.ensureDir(roomDir);
      await fs.ensureDir(photosDir);
      const existingRoomMeta = await this.readRoomFolderMeta(roomDir);
      const roomPhotoCursor = existingRoomMeta?.roomPhotoCursors?.[roomPhotoSort];
      const startSkip =
        requestedStartSkip ??
        Math.max(
          0,
          roomPhotoCursor?.nextSkip ??
            (roomPhotoSort === ROOM_PHOTO_DEFAULT_SORT
              ? existingRoomMeta?.nextSkip
              : undefined) ??
            0
        );

      let existingPhotos: Photo[] = [];
      if (await fs.pathExists(metadataPath)) {
        try {
          const existing = (await fs.readJson(metadataPath)) as ImageDto[];
          existingPhotos = Array.isArray(existing)
            ? this.normalizePhotos(existing)
            : [];
        } catch (error) {
          console.log(
            `Warning: Failed to read room photo metadata: ${(error as Error).message}`
          );
        }
      }

      const allPhotosById = new Map<string, Photo>();
      for (const photo of existingPhotos) {
        const photoId = this.normalizeId(photo.Id);
        if (photoId) {
          allPhotosById.set(photoId, photo);
        }
      }

      const batchPhotos: Photo[] = [];
      let photosFetched = 0;
      let pagesFetched = 0;
      let hasMore = true;

      for (let pageIndex = 0; pageIndex < batchPages; pageIndex++) {
        if (operation.cancelled) {
          throw this.createOperationCancelledError();
        }

        const skip = startSkip + pageIndex * pageSize;
        const pageNumber = pageIndex + 1;
        this.updateSourceProgress(
          'metadata',
          'room-photos',
          'Collecting room photos metadata...',
          pageIndex,
          batchPages,
          Math.round((pageIndex / batchPages) * 100),
          {
            pageLabel: `Room page ${pageNumber}`,
            recentActivity: `Checking room page ${pageNumber} for ${roomName}...`,
          }
        );

        const pagePhotos = this.normalizePhotos(
          await this.runMetadataRequestWithRetry({
            label: `room photos page ${pageNumber}`,
            source: 'room-photos',
            operationRef: operation,
            pageLabel: `Room page ${pageNumber}`,
            recentActivity: `Collected room page ${pageNumber} for ${roomName}.`,
            operation: () =>
              this.photosController.fetchRoomPhotos(
                roomId,
                { skip, take: pageSize, filter: 1, sort: roomPhotoSort },
                params.token,
                { signal: operation.controller.signal }
              ),
          })
        );

        pagesFetched++;
        photosFetched += pagePhotos.length;
        batchPhotos.push(...pagePhotos);

        for (const photo of pagePhotos) {
          const photoId = this.normalizeId(photo.Id);
          if (photoId && !allPhotosById.has(photoId)) {
            allPhotosById.set(photoId, photo);
          }
        }

        if (pagePhotos.length < pageSize) {
          hasMore = false;
          break;
        }
      }

      const normalizedAll = this.normalizePhotos(
        Array.from(allPhotosById.values())
      );
      const newPhotosAdded = Math.max(
        0,
        normalizedAll.length - existingPhotos.length
      );
      await fs.writeJson(metadataPath, normalizedAll, { spaces: 2 });

      const relatedMetadata = await this.fetchAndSaveBulkData(
        roomId,
        normalizedAll,
        params.token,
        {
          forceAccountsRefresh: params.forceAccountsRefresh,
          forceRoomsRefresh: params.forceRoomsRefresh,
          forceEventsRefresh: params.forceEventsRefresh,
          forceImageCommentsRefresh: params.forceImageCommentsRefresh,
        },
        'room-photos',
        { directory: roomDir, fileStem: roomId, writeOwnerMeta: false }
      );

      const uniqueBatchPhotos = Array.from(
        new Map(
          this.normalizePhotos(batchPhotos).map(photo => [photo.Id, photo])
        ).values()
      );
      const downloadResults: DownloadResultItem[] = [];
      const downloadStats: DownloadStats = {
        totalPhotos: uniqueBatchPhotos.length,
        alreadyDownloaded: 0,
        newDownloads: 0,
        failedDownloads: 0,
        skipped: 0,
        retryAttempts: 0,
        recoveredAfterRetry: 0,
      };

      this.updateSourceProgress(
        'download',
        'room-photos',
        'Downloading room photos...',
        0,
        uniqueBatchPhotos.length,
        0
      );

      const trace = this.createDownloadBatchTrace(
        'room-photo-downloads',
        uniqueBatchPhotos.length
      );
      const semaphore = new Semaphore(this.settings.maxConcurrentDownloads);
      let processedCount = 0;
      const promises = uniqueBatchPhotos.map((photo, index) =>
        (async (): Promise<DownloadResultItem> => {
          await semaphore.acquire();
          const scheduledIndex = index + 1;
          const runStartedAt = Date.now();
          const photoId = this.normalizeId(photo.Id);
          const imageName = photo.ImageName;
          trace.inFlight++;
          this.logDownloadWorkerStart(trace, {
            scheduledIndex,
            photoId,
            imageName,
            scheduledDelayMs: 0,
            slotWaitMs: 0,
          });
          let result: DownloadResultItem | undefined;
          try {
            this.setDownloadItemActivity(
              'room-photos',
              imageName || photoId || `image ${scheduledIndex}`
            );
            result = await this.downloadImageToDirectory(
              photo,
              photosDir,
              params.token,
              operation
            );
            const status = result.status;
            if (status === 'downloaded') {
              downloadStats.newDownloads++;
              downloadStats.retryAttempts += (result.attempts || 1) - 1;
              if (result.recoveredAfterRetry) {
                downloadStats.recoveredAfterRetry++;
              }
            } else if (status?.startsWith('already_exists')) {
              downloadStats.alreadyDownloaded++;
            } else if (status === 'failed' || status === 'error') {
              downloadStats.failedDownloads++;
              downloadStats.retryAttempts += (result.attempts || 1) - 1;
            } else if (status === 'cancelled') {
              downloadStats.skipped++;
            }
            return result;
          } finally {
            trace.inFlight = Math.max(0, trace.inFlight - 1);
            trace.completed++;
            this.logDownloadWorkerFinish(trace, {
              scheduledIndex,
              photoId,
              imageName,
              result,
              runDurationMs: Date.now() - runStartedAt,
            });
            semaphore.release();
            if (this.currentOperation === operation) {
              processedCount++;
              this.setDownloadResultActivity('room-photos', result);
              this.updateSourceProgress(
                'download',
                'room-photos',
                'Downloading room photos...',
                processedCount,
                uniqueBatchPhotos.length
              );
            }
          }
        })()
      );
      downloadResults.push(...(await Promise.all(promises)));

      if (operation.cancelled) {
        throw this.createOperationCancelledError();
      }

      const nextSkip = startSkip + pagesFetched * pageSize;
      await this.writeRoomFolderMeta(roomDir, room, {
        nextSkip:
          roomPhotoSort === ROOM_PHOTO_DEFAULT_SORT ? nextSkip : undefined,
        roomPhotoCursors: {
          [roomPhotoSort]: {
            nextSkip,
            completed: !hasMore,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      this.logDownloadBatchSummary(trace, downloadStats);
      this.setOperationComplete();

      return {
        roomId,
        roomName,
        roomPhotoSort,
        roomDirectory: roomDir,
        photosDirectory: photosDir,
        metadataPath,
        startSkip,
        nextSkip,
        pageSize,
        batchPages,
        pagesFetched,
        photosFetched,
        newPhotosAdded,
        totalPhotos: normalizedAll.length,
        hasMore,
        relatedMetadata,
        downloadStats,
        downloadResults,
        totalResults: downloadResults.length,
        guidance: this.buildDownloadGuidance('room photos', downloadStats),
      };
    } catch (error) {
      if (!this.isOperationCancelledError(error)) {
        this.setOperationFailed((error as Error).message);
      }
      throw error;
    } finally {
      this.finishOperation(operation);
    }
  }

  async resetAppState(): Promise<{
    removedAccountDirectories: number;
    removedLegacyFiles: number;
  }> {
    await this.ensureSettingsLoaded();
    let removedAccountDirectories = 0;
    let removedLegacyFiles = 0;
    const currentOutputRoot = this.getResolvedOutputRoot();

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
              `${entry.name}_profile_history.json`,
              `${entry.name}_accounts.json`,
              `${entry.name}_rooms.json`,
              `${entry.name}_events.json`,
              `${entry.name}_image_comments.json`,
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
              /.+_(photos|feed|profile_history|accounts|rooms|events|image_comments)\.json$/i.test(
                entry.name
              );
            if (isLegacyMetadata) {
              await fs.remove(entryPath);
              removedLegacyFiles++;
            }
          }
        }
      }

      this.settings = { ...DEFAULT_SETTINGS };
      this.syncHttpClientSettings();
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
    const accountDir = path.join(this.getResolvedOutputRoot(), accountId);
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
      hasProfileHistory: boolean;
      photoCount: number;
      feedCount: number;
      profileHistoryCount: number;
      displayLabel?: string;
    }>
  > {
    await this.ensureSettingsLoaded();
    const accounts: Array<{
      accountId: string;
      hasPhotos: boolean;
      hasFeed: boolean;
      hasProfileHistory: boolean;
      photoCount: number;
      feedCount: number;
      profileHistoryCount: number;
      displayLabel?: string;
    }> = [];

    try {
      // Ensure output directory exists
      if (!(await fs.pathExists(this.getResolvedOutputRoot()))) {
        return accounts;
      }

      // Read all directories in output root
      const entries = await fs.readdir(this.getResolvedOutputRoot(), {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const accountId = entry.name;
        const accountDir = path.join(this.getResolvedOutputRoot(), accountId);
        const photosJsonPath = path.join(
          accountDir,
          `${accountId}_photos.json`
        );
        const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);
        const profileHistoryJsonPath = path.join(
          accountDir,
          `${accountId}_profile_history.json`
        );
        const accountsJsonPath = path.join(
          accountDir,
          `${accountId}_accounts.json`
        );

        let hasPhotos = false;
        let hasFeed = false;
        let hasProfileHistory = false;
        let photoCount = 0;
        let feedCount = 0;
        let profileHistoryCount = 0;
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

        if (await fs.pathExists(profileHistoryJsonPath)) {
          try {
            const profileHistory: Photo[] = await fs.readJson(
              profileHistoryJsonPath
            );
            if (Array.isArray(profileHistory) && profileHistory.length > 0) {
              hasProfileHistory = true;
              profileHistoryCount = profileHistory.length;
            }
          } catch (error) {
            console.log(
              `Failed to read profile history JSON for ${accountId}: ${(error as Error).message}`
            );
          }
        }

        // Only include accounts that have at least one metadata file
        if (hasPhotos || hasFeed || hasProfileHistory) {
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
            hasProfileHistory,
            photoCount,
            feedCount,
            profileHistoryCount,
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

  async listAvailableRooms(): Promise<AvailableRoom[]> {
    await this.ensureSettingsLoaded();
    const rooms: AvailableRoom[] = [];
    const roomsRoot = this.getRoomsRoot();

    try {
      if (!(await fs.pathExists(roomsRoot))) {
        return rooms;
      }

      const entries = await fs.readdir(roomsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const roomId = entry.name;
        const roomDir = path.join(roomsRoot, roomId);
        const photosJsonPath = path.join(roomDir, `${roomId}_photos.json`);
        let photoCount = 0;
        let hasPhotos = false;

        if (await fs.pathExists(photosJsonPath)) {
          try {
            const photos = (await fs.readJson(photosJsonPath)) as Photo[];
            if (Array.isArray(photos)) {
              photoCount = photos.length;
              hasPhotos = photoCount > 0;
            }
          } catch (error) {
            console.log(
              `Failed to read room photos JSON for ${roomId}: ${(error as Error).message}`
            );
          }
        }

        if (!hasPhotos) {
          continue;
        }

        const meta = await this.readRoomFolderMeta(roomDir);
        const name = meta?.roomName || roomId;
        rooms.push({
          roomId,
          name,
          photoCount,
          hasPhotos,
          displayLabel: meta?.displayLabel || name,
          updatedAt: meta?.updatedAt,
        });
      }

      rooms.sort((a, b) =>
        (a.displayLabel || a.name || a.roomId).localeCompare(
          b.displayLabel || b.name || b.roomId,
          undefined,
          { sensitivity: 'base', numeric: true }
        )
      );
    } catch (error) {
      console.log(`Failed to list available rooms: ${(error as Error).message}`);
    }

    return rooms;
  }
}
