/**
 * Type declarations for the Electron preload API exposed to the renderer.
 * Keeps preload and renderer type-checking in sync with the main process IPC surface.
 */
import type {
  AccountInfo,
  ApiResponse,
  AvailableAccount,
  CollectionResult,
  DownloadResult,
  EventDto,
  Photo,
  PlayerResult,
  Progress,
  RecNetSettings,
  RoomDto,
} from './types';

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

  downloadPhotos: (params: { accountId: string }) => Promise<ApiResponse<DownloadResult>>;
  downloadFeedPhotos: (params: { accountId: string }) => Promise<ApiResponse<DownloadResult>>;

  selectOutputFolder: () => Promise<string | null>;
  getSettings: () => Promise<RecNetSettings>;
  updateSettings: (settings: Partial<RecNetSettings>) => Promise<RecNetSettings>;
  getProgress: () => Promise<Progress>;
  cancelOperation: () => Promise<boolean>;
  onProgress: (callback: (event: unknown, progress: Progress) => void) => void;
  removeProgressListener: (callback: (event: unknown, progress: Progress) => void) => void;

  lookupAccount: (accountId: string) => Promise<ApiResponse<AccountInfo[]>>;
  searchAccounts: (username: string) => Promise<ApiResponse<AccountInfo[]>>;
  clearAccountData: (accountId: string) => Promise<ApiResponse<{ filesRemoved: number }>>;
  loadPhotos: (accountId: string) => Promise<ApiResponse<Photo[]>>;
  loadFeedPhotos: (accountId: string) => Promise<ApiResponse<Photo[]>>;
  listAvailableAccounts: () => Promise<ApiResponse<AvailableAccount[]>>;
  loadAccountsData: (accountId: string) => Promise<ApiResponse<PlayerResult[]>>;
  loadRoomsData: (accountId: string) => Promise<ApiResponse<RoomDto[]>>;
  loadEventsData: (accountId: string) => Promise<ApiResponse<EventDto[]>>;

  getFavorites: () => Promise<ApiResponse<string[]>>;
  toggleFavorite: (photoId: string) => Promise<ApiResponse<boolean>>;
  isFavorite: (photoId: string) => Promise<ApiResponse<boolean>>;

  openExternal: (url: string) => Promise<void>;

  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string; releaseNotes?: string }) => void) => void;
  onUpdateNotAvailable: (callback: () => void) => void;
  onUpdateDownloadProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => void;
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => void;
  onUpdateError: (callback: (error: { message: string }) => void) => void;
  removeUpdateListeners: () => void;

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
