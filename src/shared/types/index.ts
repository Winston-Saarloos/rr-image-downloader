import { EventDto } from '../../main/models/EventDto';
import { ImageDto } from '../../main/models/ImageDto';
import { PlayerResult } from '../../main/models/PlayerDto';
import { RoomDto } from '../../main/models/RoomDto';

export type { EventDto, ImageDto, PlayerResult, RoomDto };

export interface RecNetSettings {
  outputRoot: string;
  cdnBase: string;
  globalMaxConcurrentDownloads: number;
  interPageDelayMs: number;
  maxPhotosToDownload?: number; // Limit for testing - undefined means no limit
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
}

export interface DownloadResult {
  accountId: string;
  photosDirectory?: string;
  feedPhotosDirectory?: string;
  processedCount: number;
  downloadStats: DownloadStats;
  downloadResults: DownloadResultItem[];
  totalResults: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AvailableAccount {
  accountId: string;
  hasPhotos: boolean;
  hasFeed: boolean;
  photoCount: number;
  feedCount: number;
}

export interface ElectronAPI {
  collectPhotos: (params: {
    accountId: string;
    token?: string;
    forceAccountsRefresh?: boolean;
    forceRoomsRefresh?: boolean;
  }) => Promise<ApiResponse<CollectionResult>>;

  collectFeedPhotos: (params: {
    accountId: string;
    token?: string;
    incremental?: boolean;
    forceAccountsRefresh?: boolean;
    forceRoomsRefresh?: boolean;
  }) => Promise<ApiResponse<CollectionResult>>;

  downloadPhotos: (params: {
    accountId: string;
  }) => Promise<ApiResponse<DownloadResult>>;

  downloadFeedPhotos: (params: {
    accountId: string;
  }) => Promise<ApiResponse<DownloadResult>>;

  selectOutputFolder: () => Promise<string | null>;
  getSettings: () => Promise<RecNetSettings>;
  updateSettings: (
    settings: Partial<RecNetSettings>
  ) => Promise<RecNetSettings>;
  getProgress: () => Promise<Progress>;
  cancelOperation: () => Promise<boolean>;
  onProgress: (callback: (event: any, progress: Progress) => void) => void;
  removeProgressListener: (
    callback: (event: any, progress: Progress) => void
  ) => void;
  lookupAccount: (accountId: string) => Promise<ApiResponse<AccountInfo[]>>;
  searchAccounts: (username: string) => Promise<ApiResponse<AccountInfo[]>>;
  clearAccountData: (
    accountId: string
  ) => Promise<ApiResponse<{ filesRemoved: number }>>;
  loadPhotos: (accountId: string) => Promise<ApiResponse<Photo[]>>;
  loadFeedPhotos: (accountId: string) => Promise<ApiResponse<Photo[]>>;
  listAvailableAccounts: () => Promise<ApiResponse<AvailableAccount[]>>;
  loadAccountsData: (accountId: string) => Promise<ApiResponse<PlayerResult[]>>;
  loadRoomsData: (accountId: string) => Promise<ApiResponse<RoomDto[]>>;
  loadEventsData: (accountId: string) => Promise<ApiResponse<EventDto[]>>;

  // Favorites management
  getFavorites: () => Promise<ApiResponse<string[]>>;
  toggleFavorite: (photoId: string) => Promise<ApiResponse<boolean>>;
  isFavorite: (photoId: string) => Promise<ApiResponse<boolean>>;

  // Open external URL in system browser
  openExternal: (url: string) => Promise<void>;

  // Auto-updater
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  onUpdateAvailable: (
    callback: (info: {
      version: string;
      releaseDate?: string;
      releaseNotes?: string;
    }) => void
  ) => void;
  onUpdateNotAvailable: (callback: () => void) => void;
  onUpdateDownloadProgress: (
    callback: (progress: {
      percent: number;
      transferred: number;
      total: number;
    }) => void
  ) => void;
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => void;
  onUpdateError: (callback: (error: { message: string }) => void) => void;
  removeUpdateListeners: () => void;

  // Window controls
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
