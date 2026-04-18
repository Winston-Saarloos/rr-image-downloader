import { EventDto } from '../../main/models/EventDto';
import { ImageDto } from '../../main/models/ImageDto';
import { ImageCommentDto } from '../../main/models/ImageCommentDto';
import { PlayerResult } from '../../main/models/PlayerDto';
import { RoomDto } from '../../main/models/RoomDto';
import type { DownloadSource } from '../download-sources';

export type { EventDto, ImageDto, ImageCommentDto, PlayerResult, RoomDto };

export interface RecNetSettings {
  outputRoot: string;
  /**
   * Absolute path where files are written (computed in main `getSettings` from `outputRoot` and cwd).
   */
  resolvedOutputRoot?: string;
  /**
   * True when output is configured so downloads may start; set by main `getSettings` only.
   */
  outputPathConfiguredForDownload?: boolean;
  /** Image CDN base URL (image name is appended automatically). */
  cdnBase: string;
  interPageDelayMs?: number;
  maxPhotosToDownload?: number; // Limit for testing - undefined means no limit
  maxConcurrentDownloads: number;
}

export interface BulkDataRefreshOptions {
  forceAccountsRefresh?: boolean;
  forceRoomsRefresh?: boolean;
  forceEventsRefresh?: boolean;
  forceImageCommentsRefresh?: boolean;
}

export type LibraryMode = 'user' | 'room' | 'event';
export type RoomPhotoSort = 0 | 1;

/** Open download flow from an event album tile (event library mode). */
export type EventDownloadIntent = {
  kind: 'eventAlbum';
  creatorAccountId: string;
  eventId: string;
  username?: string;
};

/** Seed the download dialog when opening from an event tile (no output path yet). */
export interface EventDownloadPanelPrefill {
  creatorAccountId: string;
  eventIds: string[];
  usernameHint?: string;
}

export type LibraryMovePhase =
  | 'validating'
  | 'preflight'
  | 'copy'
  | 'verify'
  /** Copy and per-file verification finished; settings update / cleanup not started yet. */
  | 'verified'
  | 'saving_settings'
  | 'removing_old'
  | 'complete';

/** Progress events from main during `library-move-start` (via preload). */
export interface LibraryMoveProgress {
  phase: LibraryMovePhase;
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
  currentLabel: string;
  done: boolean;
  /** Set when `done` is true and the move failed. */
  error?: string;
  /** Non-fatal: library is on new path but old folder could not be removed. */
  sourceDeleteWarning?: string;
  /** Human-readable milestones for the current move (newest entries last). */
  operationLog?: string[];
}

export interface LibraryMoveResult {
  success: boolean;
  /** Absolute path the library was moved from (resolved source root). */
  previousRoot: string;
  /** Absolute path the library now lives under. */
  newRoot: string;
  filesCopied: number;
  bytesCopied: number;
  error?: string;
  sourceDeleteWarning?: string;
  /** Summary of major steps and outcomes (for UI or support). */
  operationLog?: string[];
}

export interface Progress {
  isRunning: boolean;
  phase:
    | 'metadata'
    | 'confirm'
    | 'download'
    | 'complete'
    | 'cancelled'
    | 'failed';
  currentStep: string;
  progress: number;
  total: number;
  current: number;
  statusLevel: 'info' | 'warning' | 'error';
  issueCount: number;
  retryAttempts: number;
  failedItems: number;
  recoveredAfterRetry: number;
  currentSource?: DownloadSource;
  pageLabel?: string;
  activeItemLabel?: string;
  recentActivity?: string;
  lastIssue?: string;
  confirmation?: DownloadPreflightSummary;
}

export type Photo = Omit<ImageDto, 'PlayerEventId'> & {
  PlayerEventId?: string;
  sort?: string;
  EventId?: string | null;
  EventInstanceId?: string | null;
  localFilePath?: string;
};

export type AccountInfo = PlayerResult;

export interface IterationDetail {
  iteration?: number;
  note?: string;
  url?: string;
  skip?: number;
  take?: number;
  since?: string;
  itemsReceived?: number;
  newPhotosAdded?: number;
  totalSoFar?: number;
  totalInCollection?: number;
  newestSortValue?: string;
  newestCreatedAt?: string;
  incrementalMode?: boolean;
  existingPhotos?: number;
  lastSortValue?: string;
  oldestPhotoDate?: string;
  sinceTime?: string;
  incremental?: boolean;
  error?: string;
}

export interface CollectionResult {
  accountId: string;
  saved: string;
  existingPhotos: number;
  totalNewPhotosAdded: number;
  totalPhotos: number;
  totalFetched: number;
  pageSize: number;
  delayMs: number;
  iterationsCompleted: number;
  lastSortValue?: string;
  incrementalMode: boolean;
  iterationDetails: IterationDetail[];
  sinceTime?: string;
  incremental?: boolean;
}

export interface ProfileHistoryCollectionResult {
  accountId: string;
  saved: string;
  existingPhotos: number;
  totalNewPhotosAdded: number;
  totalPhotos: number;
}

export interface DownloadPreflightSourceSummary {
  source: DownloadSource;
  label: string;
  totalImages: number;
  alreadyOnDisk: number;
  remainingToDownload: number;
  privateImagesToDownload?: number;
  metadataPath?: string;
  downloadDirectory?: string;
}

export interface DownloadPreflightSummary {
  accountId: string;
  sourceSummaries: DownloadPreflightSourceSummary[];
  totalImages: number;
  totalAlreadyOnDisk: number;
  totalRemainingToDownload: number;
}

export interface DownloadStats {
  totalPhotos: number;
  alreadyDownloaded: number;
  newDownloads: number;
  failedDownloads: number;
  skipped: number;
  retryAttempts: number;
  recoveredAfterRetry: number;
}

export interface DownloadResultItem {
  photoId?: string;
  status?: string;
  path?: string;
  sourcePath?: string;
  destinationPath?: string;
  size?: number;
  url?: string;
  statusCode?: number;
  reason?: string;
  error?: string;
  photo?: string;
  imageName?: string;
  attempts?: number;
  retries?: number;
  recoveredAfterRetry?: boolean;
}

export interface DownloadResult {
  accountId: string;
  photosDirectory?: string;
  feedPhotosDirectory?: string;
  profileHistoryDirectory?: string;
  profileHistoryManifestPath?: string;
  processedCount: number;
  downloadStats: DownloadStats;
  downloadResults: DownloadResultItem[];
  totalResults: number;
  guidance?: string[];
}

export interface AvailableRoom {
  roomId: string;
  name: string;
  photoCount: number;
  hasPhotos: boolean;
  displayLabel?: string;
  updatedAt?: string;
}

export interface AvailableEvent {
  creatorAccountId: string;
  eventId: string;
  name: string;
  imageName?: string | null;
  localImagePath?: string;
  startTime?: string;
  endTime?: string;
  attendeeCount: number;
  photoCount: number;
  downloadedPhotoCount: number;
  hasPhotos: boolean;
  isDownloaded: boolean;
  updatedAt?: string;
}

export interface AvailableEventCreator {
  creatorAccountId: string;
  username?: string;
  displayName?: string;
  displayLabel: string;
  eventCount: number;
  downloadedEventCount: number;
  photoCount: number;
  updatedAt?: string;
}

export interface RoomPhotoBatchResult {
  roomId: string;
  roomName: string;
  roomPhotoSort: RoomPhotoSort;
  roomDirectory: string;
  photosDirectory: string;
  metadataPath: string;
  startSkip: number;
  nextSkip: number;
  pageSize: number;
  batchPages: number;
  pagesFetched: number;
  photosFetched: number;
  newPhotosAdded: number;
  totalPhotos: number;
  hasMore: boolean;
  relatedMetadata: {
    accountsFetched: number;
    roomsFetched: number;
    eventsFetched: number;
    imageCommentsFetched: number;
  };
  downloadStats: DownloadStats;
  downloadResults: DownloadResultItem[];
  totalResults: number;
  guidance?: string[];
}

export interface EventDiscoveryResult {
  creatorAccountId: string;
  username: string;
  displayName?: string;
  events: AvailableEvent[];
}

export interface EventPhotoBatchResult {
  creatorAccountId: string;
  eventIds: string[];
  eventsDirectory: string;
  eventsProcessed: number;
  photosFetched: number;
  downloadedEvents: AvailableEvent[];
  downloadStats: DownloadStats;
  downloadResults: DownloadResultItem[];
  totalResults: number;
  guidance?: string[];
}

export interface ProfileHistoryAccessResult {
  accountId: string;
  username: string;
  tokenAccountId: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Where a user-facing error originated (drives copy and recovery actions). */
export type ErrorContext =
  | 'download'
  | 'settings'
  | 'photos'
  | 'updateSettings';

export type UserErrorCategory =
  | 'empty'
  | 'auth'
  | 'network'
  | 'account'
  | 'disk'
  | 'cancelled'
  | 'settings'
  | 'unknown';

/** Stored on failed operation rows in Operation Results. */
export interface OperationResultErrorData {
  error: string;
  guidance?: string[];
  category?: UserErrorCategory;
  title?: string;
}

/** Inline banner / recovery state in the shell. */
export interface UserFacingIncident {
  id: string;
  source: ErrorContext;
  severity: 'error' | 'warning';
  category: UserErrorCategory;
  title: string;
  detail: string;
  guidance: string[];
  technicalDetail?: string;
}

export interface AvailableAccount {
  accountId: string;
  hasPhotos: boolean;
  hasFeed: boolean;
  hasProfileHistory: boolean;
  photoCount: number;
  feedCount: number;
  profileHistoryCount: number;
  /**
   * Optional human-friendly label for the folder owner.
   * Populated from per-folder metadata when available.
   */
  displayLabel?: string;
}
