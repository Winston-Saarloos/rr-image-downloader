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
});
