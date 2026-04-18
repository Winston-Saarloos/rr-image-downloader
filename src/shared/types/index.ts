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
   * When false (new installs), downloads require a non-empty absolute `outputRoot`.
   * When true (legacy settings files without this key), relative `outputRoot` is allowed.
   */
  legacyRelativeOutputAllowed: boolean;
  /**
   * Absolute path where files are written (computed in main `getSettings` from `outputRoot` and cwd).
   */
  resolvedOutputRoot?: string;
  /**
   * True when the legacy default relative folder name `output` is in use; informational for UI.
   */
  legacyDefaultRelativeOutputWarning?: boolean;
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
