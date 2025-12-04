const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Photo collection
  collectPhotos: params => ipcRenderer.invoke('collect-photos', params),
  collectFeedPhotos: params =>
    ipcRenderer.invoke('collect-feed-photos', params),

  // Photo downloads
  downloadPhotos: params => ipcRenderer.invoke('download-photos', params),
  downloadFeedPhotos: params =>
    ipcRenderer.invoke('download-feed-photos', params),

  // File operations
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: settings => ipcRenderer.invoke('update-settings', settings),

  // Progress tracking
  getProgress: () => ipcRenderer.invoke('get-progress'),
  cancelOperation: () => ipcRenderer.invoke('cancel-operation'),

  // Progress updates (listen for progress events)
  onProgress: callback => {
    ipcRenderer.on('progress-update', callback);
  },

  // Remove progress listener
  removeProgressListener: callback => {
    ipcRenderer.removeListener('progress-update', callback);
  },

  // Account lookup
  lookupAccount: accountId => ipcRenderer.invoke('lookup-account', accountId),
  searchAccounts: username => ipcRenderer.invoke('search-accounts', username),
  clearAccountData: accountId =>
    ipcRenderer.invoke('clear-account-data', accountId),

  // Load photos from JSON file
  loadPhotos: accountId => ipcRenderer.invoke('load-photos', accountId),

  // Load feed photos from JSON file
  loadFeedPhotos: accountId =>
    ipcRenderer.invoke('load-feed-photos', accountId),

  // List available accounts with metadata
  listAvailableAccounts: () => ipcRenderer.invoke('list-available-accounts'),

  // Load account data from JSON file
  loadAccountsData: accountId =>
    ipcRenderer.invoke('load-accounts-data', accountId),

  // Load room data from JSON file
  loadRoomsData: accountId => ipcRenderer.invoke('load-rooms-data', accountId),

  // Load event data from JSON file
  loadEventsData: accountId =>
    ipcRenderer.invoke('load-events-data', accountId),

  // Favorites management
  getFavorites: () => ipcRenderer.invoke('get-favorites'),
  toggleFavorite: photoId => ipcRenderer.invoke('toggle-favorite', photoId),
  isFavorite: photoId => ipcRenderer.invoke('is-favorite', photoId),

  // Open external URL in system browser
  openExternal: url => ipcRenderer.invoke('open-external', url),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Update event listeners
  onUpdateAvailable: callback => {
    ipcRenderer.on('update-available', (event, data) => callback(data));
  },
  onUpdateNotAvailable: callback => {
    ipcRenderer.on('update-not-available', () => callback());
  },
  onUpdateDownloadProgress: callback => {
    ipcRenderer.on('update-download-progress', (event, data) => callback(data));
  },
  onUpdateDownloaded: callback => {
    ipcRenderer.on('update-downloaded', (event, data) => callback(data));
  },
  onUpdateError: callback => {
    ipcRenderer.on('update-error', (event, data) => callback(data));
  },

  // Remove update listeners
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.removeAllListeners('update-not-available');
    ipcRenderer.removeAllListeners('update-download-progress');
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.removeAllListeners('update-error');
  },
});
