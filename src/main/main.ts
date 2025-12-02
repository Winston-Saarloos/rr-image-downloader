import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  IpcMainInvokeEvent,
  protocol,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs-extra';
import { RecNetService } from './services/recnet-service';
import {
  CollectionResult,
  DownloadResult,
  RecNetSettings,
  Progress,
  AccountInfo,
  Photo,
} from '../shared/types';

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;
let recNetService: RecNetService;

interface CollectPhotosParams {
  accountId: string;
  token?: string;
  forceAccountsRefresh?: boolean;
  forceRoomsRefresh?: boolean;
}

interface CollectFeedPhotosParams {
  accountId: string;
  token?: string;
  incremental?: boolean;
  forceAccountsRefresh?: boolean;
  forceRoomsRefresh?: boolean;
}

interface DownloadPhotosParams {
  accountId: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../../public/favicon.ico'),
    title: 'Rec Room Photo Downloader',
  });

  // Load the app
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // Use app.getAppPath() in production to get the correct app directory
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, 'index.html');
    console.log('Loading index.html from:', indexPath); // Debug log
    mainWindow.loadFile(indexPath).catch((error) => {
      console.error('Error loading index.html:', error);
      // Fallback: try alternative path
      if (mainWindow) {
        const altPath = path.join(__dirname, '../../index.html');
        console.log('Trying alternative path:', altPath);
        mainWindow.loadFile(altPath).catch((fallbackError) => {
          console.error('Fallback path also failed:', fallbackError);
        });
      }
    });
  }

  // Add error handlers to debug loading issues
  if (mainWindow) {
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error('Failed to load:', {
        errorCode,
        errorDescription,
        validatedURL
      });
    });

    mainWindow.webContents.on('dom-ready', () => {
      console.log('DOM ready');
    });
  }

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Forward progress events from service to renderer
function setupProgressForwarding() {
  if (recNetService && mainWindow && !mainWindow.isDestroyed()) {
    // Remove any existing listeners to avoid duplicates
    recNetService.removeAllListeners('progress-update');
    recNetService.on('progress-update', (progress: Progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress-update', progress);
      }
    });
  }
}

// Register custom protocol for serving local files
function registerLocalFileProtocol() {
  protocol.registerFileProtocol('local', (request, callback) => {
    const filePath = request.url.replace('local://', '');
    try {
      // Decode the file path
      const decodedPath = decodeURIComponent(filePath);
      callback({ path: decodedPath });
    } catch (error) {
      console.error('Error serving local file:', error);
      callback({ error: -2 }); // FILE_NOT_FOUND
    }
  });
}

// App event handlers
app.whenReady().then(() => {
  // Register custom protocol before creating window
  registerLocalFileProtocol();
  
  createWindow();

  // Initialize RecNet service
  recNetService = new RecNetService();

  // Forward progress events from service to renderer
  setupProgressForwarding();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      setupProgressForwarding();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for communication with renderer process
ipcMain.handle(
  'collect-photos',
  async (
    event: IpcMainInvokeEvent,
    params: CollectPhotosParams
  ): Promise<ApiResponse<CollectionResult>> => {
    try {
      const result = await recNetService.collectPhotos(
        params.accountId,
        params.token,
        {
          forceAccountsRefresh: params.forceAccountsRefresh,
          forceRoomsRefresh: params.forceRoomsRefresh,
        }
      );
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

ipcMain.handle(
  'collect-feed-photos',
  async (
    event: IpcMainInvokeEvent,
    params: CollectFeedPhotosParams
  ): Promise<ApiResponse<CollectionResult>> => {
    try {
      const result = await recNetService.collectFeedPhotos(
        params.accountId,
        params.token,
        params.incremental ?? true,
        {
          forceAccountsRefresh: params.forceAccountsRefresh,
          forceRoomsRefresh: params.forceRoomsRefresh,
        }
      );
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

ipcMain.handle(
  'download-photos',
  async (
    event: IpcMainInvokeEvent,
    params: DownloadPhotosParams
  ): Promise<ApiResponse<DownloadResult>> => {
    try {
      const result = await recNetService.downloadPhotos(params.accountId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

ipcMain.handle(
  'download-feed-photos',
  async (
    event: IpcMainInvokeEvent,
    params: DownloadPhotosParams
  ): Promise<ApiResponse<DownloadResult>> => {
    try {
      const result = await recNetService.downloadFeedPhotos(params.accountId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

ipcMain.handle('select-output-folder', async (): Promise<string | null> => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Output Folder',
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-settings', async (): Promise<RecNetSettings> => {
  return recNetService.getSettings();
});

ipcMain.handle(
  'update-settings',
  async (
    event: IpcMainInvokeEvent,
    settings: Partial<RecNetSettings>
  ): Promise<RecNetSettings> => {
    return await recNetService.updateSettings(settings);
  }
);

// Progress tracking
ipcMain.handle('get-progress', async (): Promise<Progress> => {
  return recNetService.getProgress();
});

// Cancel operations
ipcMain.handle('cancel-operation', async (): Promise<boolean> => {
  return recNetService.cancelCurrentOperation();
});

// Lookup account information
ipcMain.handle(
  'lookup-account',
  async (
    event: IpcMainInvokeEvent,
    accountId: string
  ): Promise<ApiResponse<AccountInfo[]>> => {
    try {
      const result = await recNetService.lookupAccount(accountId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

// Search accounts by username
ipcMain.handle(
  'search-accounts',
  async (
    event: IpcMainInvokeEvent,
    username: string
  ): Promise<ApiResponse<AccountInfo[]>> => {
    try {
      const result = await recNetService.searchAccounts(username);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

// Clear account data
ipcMain.handle(
  'clear-account-data',
  async (
    event: IpcMainInvokeEvent,
    accountId: string
  ): Promise<ApiResponse<{ filesRemoved: number }>> => {
    try {
      const result = await recNetService.clearAccountData(accountId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

// Load photos from JSON file, filtering to only include photos that exist on disk
ipcMain.handle(
  'load-photos',
  async (
    event: IpcMainInvokeEvent,
    accountId: string
  ): Promise<ApiResponse<Photo[]>> => {
    try {
      const settings = recNetService.getSettings();
      const accountDir = path.join(settings.outputRoot, accountId);
      const jsonPath = path.join(accountDir, `${accountId}_photos.json`);

      if (!(await fs.pathExists(jsonPath))) {
        return { success: true, data: [] };
      }

      const photos: Photo[] = await fs.readJson(jsonPath);

      // Pre-scan directories once to avoid thousands of individual path checks
      const photosDir = path.join(accountDir, 'photos');
      const feedDir = path.join(accountDir, 'feed');

      const photoFileIds = new Set<string>();
      const feedFileIds = new Set<string>();

      if (await fs.pathExists(photosDir)) {
        const files = await fs.readdir(photosDir);
        for (const file of files) {
          const id = path.parse(file).name;
          if (id) {
            photoFileIds.add(id);
          }
        }
      }

      if (await fs.pathExists(feedDir)) {
        const files = await fs.readdir(feedDir);
        for (const file of files) {
          const id = path.parse(file).name;
          if (id) {
            feedFileIds.add(id);
          }
        }
      }

      const photosWithFiles: Photo[] = [];
      for (const photo of photos) {
        if (!photo.Id) {
          continue;
        }

        const photoId = photo.Id.toString();

        let localFilePath: string | undefined;
        if (photoFileIds.has(photoId)) {
          localFilePath = path.join(photosDir, `${photoId}.jpg`);
        } else if (feedFileIds.has(photoId)) {
          localFilePath = path.join(feedDir, `${photoId}.jpg`);
        }

        if (localFilePath) {
          photosWithFiles.push({
            ...photo,
            localFilePath,
          });
        }
      }

      return { success: true, data: photosWithFiles };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

// Load feed photos from JSON file, filtering to only include photos that exist on disk
ipcMain.handle(
  'load-feed-photos',
  async (
    event: IpcMainInvokeEvent,
    accountId: string
  ): Promise<ApiResponse<Photo[]>> => {
    try {
      const settings = recNetService.getSettings();
      const accountDir = path.join(settings.outputRoot, accountId);
      const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);

      if (await fs.pathExists(feedJsonPath)) {
        const feedPhotos: Photo[] = await fs.readJson(feedJsonPath);
        
        // Filter to only include photos that have corresponding image files
        const feedDir = path.join(accountDir, 'feed');
        const photosDir = path.join(accountDir, 'photos');
        
        const photosWithFiles: Photo[] = [];
        for (const photo of feedPhotos) {
          if (!photo.Id) {
            continue;
          }
          
          const photoId = photo.Id.toString();
          const feedPhotoPath = path.join(feedDir, `${photoId}.jpg`);
          const photoPath = path.join(photosDir, `${photoId}.jpg`);
          
          // Check which file exists and add local file path to photo data
          let localFilePath: string | undefined;
          if (await fs.pathExists(feedPhotoPath)) {
            localFilePath = feedPhotoPath;
          } else if (await fs.pathExists(photoPath)) {
            localFilePath = photoPath;
          }
          
          // Include photo if it exists in either feed or photos folder
          if (localFilePath) {
            // Add local file path to photo object for use in renderer
            const photoWithPath = {
              ...photo,
              localFilePath: localFilePath,
            };
            photosWithFiles.push(photoWithPath);
          }
        }
        
        return { success: true, data: photosWithFiles };
      } else {
        return { success: true, data: [] };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

// List available accounts with metadata
ipcMain.handle(
  'list-available-accounts',
  async (): Promise<
    ApiResponse<
      Array<{
        accountId: string;
        hasPhotos: boolean;
        hasFeed: boolean;
        photoCount: number;
        feedCount: number;
      }>
    >
  > => {
    try {
      const accounts = await recNetService.listAvailableAccounts();
      return { success: true, data: accounts };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

// Load account data from JSON file
ipcMain.handle(
  'load-accounts-data',
  async (
    event: IpcMainInvokeEvent,
    accountId: string
  ): Promise<ApiResponse<any[]>> => {
    try {
      const settings = recNetService.getSettings();
      const accountDir = path.join(settings.outputRoot, accountId);
      const accountsJsonPath = path.join(accountDir, `${accountId}_accounts.json`);

      if (await fs.pathExists(accountsJsonPath)) {
        const accountsData: any[] = await fs.readJson(accountsJsonPath);
        return { success: true, data: accountsData };
      } else {
        return { success: true, data: [] };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

// Load room data from JSON file
ipcMain.handle(
  'load-rooms-data',
  async (
    event: IpcMainInvokeEvent,
    accountId: string
  ): Promise<ApiResponse<any[]>> => {
    try {
      const settings = recNetService.getSettings();
      const accountDir = path.join(settings.outputRoot, accountId);
      const roomsJsonPath = path.join(accountDir, `${accountId}_rooms.json`);

      if (await fs.pathExists(roomsJsonPath)) {
        const roomsData: any[] = await fs.readJson(roomsJsonPath);
        return { success: true, data: roomsData };
      } else {
        return { success: true, data: [] };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);
