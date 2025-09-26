export interface RecNetSettings {
  outputRoot: string;
  pageSize: number;
  cdnBase: string;
  globalMaxConcurrentDownloads: number;
  interPageDelayMs: number;
}

export interface Progress {
  isRunning: boolean;
  currentStep: string;
  progress: number;
  total: number;
  current: number;
}

export interface Photo {
  Id: number;
  ImageName: string;
  sort?: string;
  CreatedAt?: string;
  [key: string]: any;
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
  maxIterations: number;
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
  limit: number;
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

export interface ElectronAPI {
  collectPhotos: (params: {
    accountId: string;
    token?: string;
    incremental?: boolean;
    maxIterations?: number;
  }) => Promise<ApiResponse<CollectionResult>>;

  collectFeedPhotos: (params: {
    accountId: string;
    token?: string;
    incremental?: boolean;
    maxIterations?: number;
  }) => Promise<ApiResponse<CollectionResult>>;

  downloadPhotos: (params: {
    accountId: string;
    limit?: number;
  }) => Promise<ApiResponse<DownloadResult>>;

  downloadFeedPhotos: (params: {
    accountId: string;
    limit?: number;
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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
