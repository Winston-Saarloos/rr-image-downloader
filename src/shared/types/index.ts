import { EventDto } from '../../main/models/EventDto';
import { ImageDto } from '../../main/models/ImageDto';
import { PlayerResult } from '../../main/models/PlayerDto';
import { RoomDto } from '../../main/models/RoomDto';

export type { EventDto, ImageDto, PlayerResult, RoomDto };

export interface RecNetSettings {
  outputRoot: string;
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
}

export interface Progress {
  isRunning: boolean;
  currentStep: string;
  progress: number;
  total: number;
  current: number;
  statusLevel: 'info' | 'warning' | 'error';
  issueCount: number;
  retryAttempts: number;
  failedItems: number;
  recoveredAfterRetry: number;
  lastIssue?: string;
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
  processedCount: number;
  downloadStats: DownloadStats;
  downloadResults: DownloadResultItem[];
  totalResults: number;
  guidance?: string[];
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
  photoCount: number;
  feedCount: number;
  /**
   * Optional human-friendly label for the folder owner.
   * Populated from per-folder metadata when available.
   */
  displayLabel?: string;
}
