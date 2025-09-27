import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  IpcMainInvokeEvent,
} from 'electron';
import * as path from 'path';
import { RecNetService } from './services/recnet-service';
import {
  CollectionResult,
  DownloadResult,
  RecNetSettings,
  Progress,
  AccountInfo,
} from '../shared/types';

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;
let recNetService: RecNetService;

interface CollectPhotosParams {
  accountId: string;
  token?: string;
}

interface CollectFeedPhotosParams {
  accountId: string;
  token?: string;
  incremental?: boolean;
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
    icon: path.join(__dirname, '../assets/icon.png'),
    title: 'RecNet Photo Downloader',
  });

  // Load the app
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../build/index.html'));
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

// App event handlers
app.whenReady().then(() => {
  createWindow();

  // Initialize RecNet service
  recNetService = new RecNetService();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
        params.token
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
        params.incremental ?? true
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
