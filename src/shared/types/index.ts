export type { Event } from '../../main/models/Event';

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

export interface Photo {
  Id: string;
  ImageName: string;
  sort?: string;
  CreatedAt?: string;
  Description?: string;
  EventId?: string | number | null;
  eventId?: string | number | null;
  PlayerEventId?: string | number | null;
  playerEventId?: string | number | null;
  EventInstanceId?: string | number | null;
  eventInstanceId?: string | number | null;
  localFilePath?: string; // Path to local file on disk (added when loading photos)
  [key: string]: any;
}

// Legacy PlayerEvent interface - kept for backward compatibility
export interface PlayerEvent {
  Id: string | number;
  Name?: string;
  Description?: string;
  StartTime?: string;
  EndTime?: string;
  RoomId?: string | number | null;
  RoomName?: string | null;
  [key: string]: any;
}

export interface AccountInfo {
  accountId: string;
  username: string;
  displayName: string;
  displayEmoji: string;
  profileImage: string;
  bannerImage: string;
  isJunior: boolean;
  platforms: number;
  personalPronouns: number;
  identityFlags: number;
  createdAt: string;
  isMetaPlatformBlocked: boolean;
}

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
  loadAccountsData: (accountId: string) => Promise<ApiResponse<any[]>>;
  loadRoomsData: (accountId: string) => Promise<ApiResponse<any[]>>;
  loadEventsData: (
    accountId: string
  ) => Promise<ApiResponse<import('../../main/models/Event').Event[]>>;

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
