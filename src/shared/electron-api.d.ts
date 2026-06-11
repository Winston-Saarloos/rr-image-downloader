/**
 * Type declarations for the Electron preload API exposed to the renderer.
 * Keeps preload and renderer type-checking in sync with the main process IPC surface.
 */
import type {
  ApiResponse,
  AvailableAccount,
  AvailableEvent,
  AvailableEventCreator,
  AvailableRoom,
  EventDto,
  ImageCommentDto,
  Photo,
  PlayerResult,
  RecNetSettings,
  RoomDto,
  LibraryMoveProgress,
  LibraryMoveResult,
} from './types';

export interface ElectronAPI {
  selectOutputFolder: () => Promise<string | null>;
  getSettings: () => Promise<RecNetSettings>;
  updateSettings: (settings: Partial<RecNetSettings>) => Promise<RecNetSettings>;

  startLibraryMove: (dest: string) => Promise<ApiResponse<LibraryMoveResult>>;
  cancelLibraryMove: () => Promise<boolean>;
  onLibraryMoveProgress: (
    callback: (event: unknown, progress: LibraryMoveProgress) => void
  ) => void;
  removeLibraryMoveProgressListener: (
    callback: (event: unknown, progress: LibraryMoveProgress) => void
  ) => void;

  clearAccountData: (accountId: string) => Promise<ApiResponse<{ filesRemoved: number }>>;
  loadPhotos: (accountId: string) => Promise<ApiResponse<Photo[]>>;
  loadFeedPhotos: (accountId: string) => Promise<ApiResponse<Photo[]>>;
  loadProfileHistoryPhotos: (accountId: string) => Promise<ApiResponse<Photo[]>>;
  listAvailableAccounts: () => Promise<ApiResponse<AvailableAccount[]>>;
  listAvailableRooms: () => Promise<ApiResponse<AvailableRoom[]>>;
  listAvailableEvents: (
    creatorAccountId?: string
  ) => Promise<ApiResponse<AvailableEvent[]>>;
  listAvailableEventCreators: () => Promise<
    ApiResponse<AvailableEventCreator[]>
  >;
  loadAccountsData: (accountId: string) => Promise<ApiResponse<PlayerResult[]>>;
  loadRoomsData: (accountId: string) => Promise<ApiResponse<RoomDto[]>>;
  loadEventsData: (accountId: string) => Promise<ApiResponse<EventDto[]>>;
  loadImageCommentsData: (
    accountId: string
  ) => Promise<ApiResponse<ImageCommentDto[]>>;
  loadRoomPhotos: (roomId: string) => Promise<ApiResponse<Photo[]>>;
  loadRoomAccountsData: (roomId: string) => Promise<ApiResponse<PlayerResult[]>>;
  loadRoomRoomsData: (roomId: string) => Promise<ApiResponse<RoomDto[]>>;
  loadRoomEventsData: (roomId: string) => Promise<ApiResponse<EventDto[]>>;
  loadRoomImageCommentsData: (
    roomId: string
  ) => Promise<ApiResponse<ImageCommentDto[]>>;
  loadEventAlbumPhotos: (params: {
    creatorAccountId: string;
    eventId: string;
  }) => Promise<ApiResponse<Photo[]>>;
  loadEventAlbumAccountsData: (params: {
    creatorAccountId: string;
    eventId: string;
  }) => Promise<ApiResponse<PlayerResult[]>>;
  loadEventAlbumRoomsData: (params: {
    creatorAccountId: string;
    eventId: string;
  }) => Promise<ApiResponse<RoomDto[]>>;
  loadEventAlbumEventsData: (params: {
    creatorAccountId: string;
    eventId: string;
  }) => Promise<ApiResponse<EventDto[]>>;
  loadEventAlbumImageCommentsData: (params: {
    creatorAccountId: string;
    eventId: string;
  }) => Promise<ApiResponse<ImageCommentDto[]>>;
  loadEventAlbumsForCreator: (
    creatorAccountId: string
  ) => Promise<ApiResponse<AvailableEvent[]>>;

  getFavorites: () => Promise<ApiResponse<string[]>>;
  toggleFavorite: (photoId: string) => Promise<ApiResponse<boolean>>;
  isFavorite: (photoId: string) => Promise<ApiResponse<boolean>>;

  openPathInExplorer: (
    targetPath: string
  ) => Promise<{ success: boolean; error?: string }>;
  revealPathInExplorer: (
    targetPath: string
  ) => Promise<{ success: boolean; error?: string }>;

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
