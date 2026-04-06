import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../shared/electron-api';

const electronAPI: ElectronAPI = {
  collectPhotos: (params) => ipcRenderer.invoke('collect-photos', params),
  collectFeedPhotos: (params) => ipcRenderer.invoke('collect-feed-photos', params),
  collectProfileHistoryManifest: (params) =>
    ipcRenderer.invoke('collect-profile-history-manifest', params),
  buildDownloadPreflight: (params) =>
    ipcRenderer.invoke('build-download-preflight', params),

  downloadPhotos: (params) => ipcRenderer.invoke('download-photos', params),
  downloadFeedPhotos: (params) => ipcRenderer.invoke('download-feed-photos', params),
  downloadProfileHistory: (params) =>
    ipcRenderer.invoke('download-profile-history', params),
  validateProfileHistoryAccess: (params) =>
    ipcRenderer.invoke('validate-profile-history-access', params),

  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),

  getProgress: () => ipcRenderer.invoke('get-progress'),
  cancelOperation: () => ipcRenderer.invoke('cancel-operation'),

  onProgress: (callback) => {
    ipcRenderer.on('progress-update', callback);
  },
  removeProgressListener: (callback) => {
    ipcRenderer.removeListener('progress-update', callback);
  },

  lookupAccountById: (accountId) => ipcRenderer.invoke('lookup-account-by-id', accountId),
  lookupAccountByUsername: (username: string, token?: string) =>
    ipcRenderer.invoke('lookup-account-by-username', username, token),
  searchAccounts: (username: string, token?: string) =>
    ipcRenderer.invoke('search-accounts', username, token),
  clearAccountData: (accountId) => ipcRenderer.invoke('clear-account-data', accountId),

  loadPhotos: (accountId) => ipcRenderer.invoke('load-photos', accountId),
  loadFeedPhotos: (accountId) => ipcRenderer.invoke('load-feed-photos', accountId),
  loadProfileHistoryPhotos: (accountId) =>
    ipcRenderer.invoke('load-profile-history-photos', accountId),
  listAvailableAccounts: () => ipcRenderer.invoke('list-available-accounts'),
  loadAccountsData: (accountId) => ipcRenderer.invoke('load-accounts-data', accountId),
  loadRoomsData: (accountId) => ipcRenderer.invoke('load-rooms-data', accountId),
  loadEventsData: (accountId) => ipcRenderer.invoke('load-events-data', accountId),

  getFavorites: () => ipcRenderer.invoke('get-favorites'),
  toggleFavorite: (photoId) => ipcRenderer.invoke('toggle-favorite', photoId),
  isFavorite: (photoId) => ipcRenderer.invoke('is-favorite', photoId),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openPathInExplorer: (targetPath: string) =>
    ipcRenderer.invoke('open-path-in-explorer', targetPath),
  revealPathInExplorer: (targetPath: string) =>
    ipcRenderer.invoke('reveal-path-in-explorer', targetPath),

  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (_event, data) => callback(data));
  },
  onUpdateNotAvailable: (callback) => {
    ipcRenderer.on('update-not-available', () => callback());
  },
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.on('update-download-progress', (_event, data) => callback(data));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (_event, data) => callback(data));
  },
  onUpdateError: (callback) => {
    ipcRenderer.on('update-error', (_event, data) => callback(data));
  },
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.removeAllListeners('update-not-available');
    ipcRenderer.removeAllListeners('update-download-progress');
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.removeAllListeners('update-error');
  },

  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
