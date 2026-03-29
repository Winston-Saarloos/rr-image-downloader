import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  IpcMainInvokeEvent,
  Menu,
  protocol,
  shell,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs-extra';
import { autoUpdater } from 'electron-updater';
import { RecNetService } from './services/recnet-service';
import {
  CollectionResult,
  DownloadResult,
  ProfileHistoryAccessResult,
  RecNetSettings,
  Progress,
  AccountInfo,
  Photo,
  PlayerResult,
  RoomDto,
} from '../shared/types';
import { EventDto } from './models/EventDto';

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;
let recNetService: RecNetService;
const isDev = process.argv.includes('--dev');

interface CollectPhotosParams {
  accountId: string;
  token?: string;
  forceAccountsRefresh?: boolean;
  forceRoomsRefresh?: boolean;
  forceEventsRefresh?: boolean;
}

interface CollectFeedPhotosParams {
  accountId: string;
  token?: string;
  incremental?: boolean;
  forceAccountsRefresh?: boolean;
  forceRoomsRefresh?: boolean;
  forceEventsRefresh?: boolean;
}

interface DownloadPhotosParams {
  accountId: string;
  token?: string;
}

interface ValidateProfileHistoryAccessParams {
  username: string;
  token: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const normalizeId = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '';
    }
    return Math.trunc(value).toString();
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
};

const normalizePhotoRecord = (photo: Photo): Photo => {
  const taggedPlayerIds = Array.isArray(photo.TaggedPlayerIds)
    ? photo.TaggedPlayerIds.map(id => normalizeId(id)).filter(Boolean)
    : [];
  const playerEventId = normalizeId(photo.PlayerEventId);
  const eventId = normalizeId(photo.EventId);
  const eventInstanceId = normalizeId(photo.EventInstanceId);

  return {
    ...photo,
    Id: normalizeId(photo.Id),
    PlayerId: normalizeId(photo.PlayerId),
    RoomId: normalizeId(photo.RoomId),
    TaggedPlayerIds: taggedPlayerIds,
    PlayerEventId: playerEventId || undefined,
    EventId: eventId || undefined,
    EventInstanceId: eventInstanceId || undefined,
  };
};

const normalizePlayerRecord = (player: PlayerResult): PlayerResult => ({
  ...player,
  accountId: normalizeId(player.accountId),
});

const normalizeRoomRecord = (room: RoomDto): RoomDto => ({
  ...room,
  RoomId: normalizeId(room.RoomId),
  CreatorAccountId: normalizeId(room.CreatorAccountId),
  RankedEntityId: normalizeId(room.RankedEntityId),
});

const normalizeEventRecord = (event: EventDto): EventDto => ({
  ...event,
  PlayerEventId: normalizeId(event.PlayerEventId),
  CreatorPlayerId: normalizeId(event.CreatorPlayerId),
  RoomId: normalizeId(event.RoomId),
});

function attachEditableContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const { editFlags, isEditable, selectionText } = params;
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (isEditable) {
      template.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll }
      );
    } else if ((selectionText ?? '').trim()) {
      template.push({ role: 'copy', enabled: editFlags.canCopy });
    }

    if (template.length === 0) {
      return;
    }

    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: false, // Remove default title bar for custom header
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../../public/favicon.ico'),
    title: 'Rec Room Photo Downloader',
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // Use app.getAppPath() in production to get the correct app directory
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, 'index.html');
    console.log('Loading index.html from:', indexPath); // Debug log
    mainWindow.loadFile(indexPath).catch(error => {
      console.error('Error loading index.html:', error);
      // Fallback: try alternative path
      if (mainWindow) {
        const altPath = path.join(__dirname, '../../index.html');
        console.log('Trying alternative path:', altPath);
        mainWindow.loadFile(altPath).catch(fallbackError => {
          console.error('Fallback path also failed:', fallbackError);
        });
      }
    });
  }

  // Add error handlers to debug loading issues
  if (mainWindow) {
    mainWindow.webContents.on(
      'did-fail-load',
      (event, errorCode, errorDescription, validatedURL) => {
        console.error('Failed to load:', {
          errorCode,
          errorDescription,
          validatedURL,
        });
      }
    );

    mainWindow.webContents.on('dom-ready', () => {
      console.log('DOM ready');
    });
  }

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  attachEditableContextMenu(mainWindow);

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

// Setup auto-updater event handlers
function setupAutoUpdater() {
  if (isDev) {
    console.log('Auto-updater disabled in development mode');
    return;
  }

  // Configure auto-updater — do not auto-download; user must confirm
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true; // Install on app quit

  // Update available — notify renderer with size when available so user can confirm before download
  autoUpdater.on('update-available', info => {
    console.log('Update available:', info.version);
    const files = (info as { files?: Array<{ size?: number }> }).files;
    const sizeBytes =
      files?.reduce((sum, f) => sum + (f.size ?? 0), 0) ?? undefined;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
        sizeBytes,
      });
    }
  });

  // Update not available
  autoUpdater.on('update-not-available', () => {
    console.log('Update not available');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-not-available');
    }
  });

  // Update download progress
  autoUpdater.on('download-progress', progressObj => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', {
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
    }
  });

  // Update downloaded and ready to install
  autoUpdater.on('update-downloaded', info => {
    console.log('Update downloaded:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', {
        version: info.version,
      });
    }
  });

  // Error handling
  autoUpdater.on('error', error => {
    console.error('Auto-updater error:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', {
        message: error.message,
      });
    }
  });

  // Check for updates when the main window has finished loading
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once('did-finish-load', () => {
      autoUpdater.checkForUpdates().catch(error => {
        console.error('Error checking for updates:', error);
      });
    });
  }
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

  // Setup auto-updater
  setupAutoUpdater();

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
          forceEventsRefresh: params.forceEventsRefresh,
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
          forceEventsRefresh: params.forceEventsRefresh,
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
      const result = await recNetService.downloadPhotos(
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
  'download-feed-photos',
  async (
    event: IpcMainInvokeEvent,
    params: DownloadPhotosParams
  ): Promise<ApiResponse<DownloadResult>> => {
    try {
      const result = await recNetService.downloadFeedPhotos(
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
  'download-profile-history',
  async (
    event: IpcMainInvokeEvent,
    params: ValidateProfileHistoryAccessParams & { accountId: string }
  ): Promise<ApiResponse<DownloadResult>> => {
    try {
      const result = await recNetService.downloadProfileHistory(
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
  'validate-profile-history-access',
  async (
    event: IpcMainInvokeEvent,
    params: ValidateProfileHistoryAccessParams
  ): Promise<ApiResponse<ProfileHistoryAccessResult>> => {
    try {
      const result = await recNetService.validateProfileHistoryAccess(
        params.username,
        params.token
      );
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
  return await recNetService.getSettings();
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

// Lookup account information by account ID
ipcMain.handle(
  'lookup-account-by-id',
  async (
    event: IpcMainInvokeEvent,
    accountId: string
  ): Promise<ApiResponse<AccountInfo>> => {
    try {
      const result = await recNetService.lookupAccountById(accountId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

// Lookup account information by username
ipcMain.handle(
  'lookup-account-by-username',
  async (
    event: IpcMainInvokeEvent,
    username: string,
    token?: string
  ): Promise<ApiResponse<AccountInfo>> => {
    try {
      const result = await recNetService.lookupAccountByUsername(username, token);
      return { success: true, data: result };
    } catch (error) {
      const message = (error as Error).message ?? String(error);

      if (token && /HTTP\s+(401|403)\b/.test(message)) {
        try {
          const fallback = await recNetService.lookupAccountByUsername(username);
          return { success: true, data: fallback };
        } catch (fallbackError) {
          return {
            success: false,
            error:
              (fallbackError as Error).message ?? String(fallbackError),
          };
        }
      }

      return { success: false, error: message };
    }
  }
);

// Search accounts by username
ipcMain.handle(
  'search-accounts',
  async (
    event: IpcMainInvokeEvent,
    username: string,
    token?: string
  ): Promise<ApiResponse<AccountInfo[]>> => {
    try {
      const result = token
        ? await recNetService.searchAccounts(username, token)
        : await recNetService.searchAccounts(username);
      return { success: true, data: result };
    } catch (error) {
      const message = (error as Error).message ?? String(error);

      // If the provided token isn't authorized, still allow downloads by
      // falling back to unauthenticated account search.
      if (token && /HTTP\s+(401|403)\b/.test(message)) {
        try {
          const result = await recNetService.searchAccounts(username);
          return { success: true, data: result };
        } catch (fallbackError) {
          return {
            success: false,
            error: (fallbackError as Error).message ?? String(fallbackError),
          };
        }
      }

      return { success: false, error: message };
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
      const settings = await recNetService.getSettings();
      const accountDir = path.join(settings.outputRoot, accountId);
      const jsonPath = path.join(accountDir, `${accountId}_photos.json`);

      if (!(await fs.pathExists(jsonPath))) {
        return { success: true, data: [] };
      }

      const rawPhotos: Photo[] = await fs.readJson(jsonPath);
      const photos = rawPhotos.map(normalizePhotoRecord);

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
      const settings = await recNetService.getSettings();
      const accountDir = path.join(settings.outputRoot, accountId);
      const feedJsonPath = path.join(accountDir, `${accountId}_feed.json`);

      if (!(await fs.pathExists(feedJsonPath))) {
        return { success: true, data: [] };
      }

      const feedPhotos: Photo[] = (await fs.readJson(feedJsonPath)).map(
        normalizePhotoRecord
      );

      // Pre-scan directories once to avoid thousands of individual path checks
      const feedDir = path.join(accountDir, 'feed');
      const photosDir = path.join(accountDir, 'photos');

      const feedFileIds = new Set<string>();
      const photoFileIds = new Set<string>();

      if (await fs.pathExists(feedDir)) {
        const files = await fs.readdir(feedDir);
        for (const file of files) {
          const id = path.parse(file).name;
          if (id) {
            feedFileIds.add(id);
          }
        }
      }

      if (await fs.pathExists(photosDir)) {
        const files = await fs.readdir(photosDir);
        for (const file of files) {
          const id = path.parse(file).name;
          if (id) {
            photoFileIds.add(id);
          }
        }
      }

      const photosWithFiles: Photo[] = [];
      for (const photo of feedPhotos) {
        if (!photo.Id) {
          continue;
        }

        const photoId = photo.Id.toString();

        let localFilePath: string | undefined;
        if (feedFileIds.has(photoId)) {
          localFilePath = path.join(feedDir, `${photoId}.jpg`);
        } else if (photoFileIds.has(photoId)) {
          localFilePath = path.join(photosDir, `${photoId}.jpg`);
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

ipcMain.handle(
  'load-profile-history-photos',
  async (
    event: IpcMainInvokeEvent,
    accountId: string
  ): Promise<ApiResponse<Photo[]>> => {
    try {
      const settings = await recNetService.getSettings();
      const accountDir = path.join(settings.outputRoot, accountId);
      const profileHistoryJsonPath = path.join(
        accountDir,
        `${accountId}_profile_history.json`
      );

      if (!(await fs.pathExists(profileHistoryJsonPath))) {
        return { success: true, data: [] };
      }

      const profileHistoryPhotos: Photo[] = (await fs.readJson(
        profileHistoryJsonPath
      )).map(normalizePhotoRecord);
      const profileHistoryDir = path.join(accountDir, 'profile-history');

      const profileHistoryFileIds = new Set<string>();
      if (await fs.pathExists(profileHistoryDir)) {
        const files = await fs.readdir(profileHistoryDir);
        for (const file of files) {
          const id = path.parse(file).name;
          if (id) {
            profileHistoryFileIds.add(id);
          }
        }
      }

      const photosWithFiles: Photo[] = [];
      for (const photo of profileHistoryPhotos) {
        if (!photo.Id) {
          continue;
        }

        const photoId = photo.Id.toString();
        if (!profileHistoryFileIds.has(photoId)) {
          continue;
        }

        photosWithFiles.push({
          ...photo,
          localFilePath: path.join(profileHistoryDir, `${photoId}.jpg`),
        });
      }

      return { success: true, data: photosWithFiles };
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
        hasProfileHistory: boolean;
        photoCount: number;
        feedCount: number;
        profileHistoryCount: number;
        displayLabel?: string;
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
  ): Promise<ApiResponse<PlayerResult[]>> => {
    try {
      const settings = await recNetService.getSettings();
      const accountDir = path.join(settings.outputRoot, accountId);
      const accountsJsonPath = path.join(
        accountDir,
        `${accountId}_accounts.json`
      );

      if (await fs.pathExists(accountsJsonPath)) {
        const accountsData: PlayerResult[] = (
          await fs.readJson(accountsJsonPath)
        ).map(normalizePlayerRecord);
        return {
          success: true,
          data: accountsData,
        };
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
  ): Promise<ApiResponse<RoomDto[]>> => {
    try {
      const settings = await recNetService.getSettings();
      const accountDir = path.join(settings.outputRoot, accountId);
      const roomsJsonPath = path.join(accountDir, `${accountId}_rooms.json`);

      if (await fs.pathExists(roomsJsonPath)) {
        const roomsData: RoomDto[] = (await fs.readJson(roomsJsonPath)).map(
          normalizeRoomRecord
        );
        return { success: true, data: roomsData };
      } else {
        return { success: true, data: [] };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

// Load event data from JSON file
ipcMain.handle(
  'load-events-data',
  async (
    event: IpcMainInvokeEvent,
    accountId: string
  ): Promise<ApiResponse<EventDto[]>> => {
    try {
      const settings = await recNetService.getSettings();
      const accountDir = path.join(settings.outputRoot, accountId);
      const eventsJsonPath = path.join(accountDir, `${accountId}_events.json`);

      if (await fs.pathExists(eventsJsonPath)) {
        const eventsData: EventDto[] = (await fs.readJson(eventsJsonPath)).map(
          normalizeEventRecord
        );
        return { success: true, data: eventsData };
      } else {
        return { success: true, data: [] };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

const getFavoritesPath = (): string => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'favorites.json');
};

ipcMain.handle('get-favorites', async (): Promise<ApiResponse<string[]>> => {
  try {
    const favoritesPath = getFavoritesPath();
    if (await fs.pathExists(favoritesPath)) {
      const favoritesArray: string[] = await fs.readJson(favoritesPath);
      return { success: true, data: favoritesArray };
    } else {
      return { success: true, data: [] };
    }
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle(
  'toggle-favorite',
  async (
    event: IpcMainInvokeEvent,
    photoId: string
  ): Promise<ApiResponse<boolean>> => {
    try {
      const favoritesPath = getFavoritesPath();
      let favorites: Set<string>;

      if (await fs.pathExists(favoritesPath)) {
        const favoritesArray: string[] = await fs.readJson(favoritesPath);
        favorites = new Set(favoritesArray);
      } else {
        favorites = new Set<string>();
      }

      const isFavorite = favorites.has(photoId);
      if (isFavorite) {
        favorites.delete(photoId);
      } else {
        favorites.add(photoId);
      }

      // Ensure directory exists
      await fs.ensureDir(path.dirname(favoritesPath));

      // Save as array for JSON serialization
      await fs.writeJson(favoritesPath, Array.from(favorites), { spaces: 2 });

      return { success: true, data: !isFavorite };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

ipcMain.handle(
  'is-favorite',
  async (
    event: IpcMainInvokeEvent,
    photoId: string
  ): Promise<ApiResponse<boolean>> => {
    try {
      const favoritesPath = getFavoritesPath();
      if (await fs.pathExists(favoritesPath)) {
        const favoritesArray: string[] = await fs.readJson(favoritesPath);
        const favorites = new Set(favoritesArray);
        return { success: true, data: favorites.has(photoId) };
      } else {
        return { success: true, data: false };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
);

// Allowlist of URL prefixes that the renderer may open in the system browser
const ALLOWED_EXTERNAL_URL_PREFIXES = ['https://rec.net/'];

// Open external URL in system browser
ipcMain.handle(
  'open-external',
  async (event: IpcMainInvokeEvent, url: string): Promise<void> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`Blocked non-HTTPS URL: ${url}`);
    }
    if (
      !ALLOWED_EXTERNAL_URL_PREFIXES.some(prefix =>
        parsed.href.startsWith(prefix)
      )
    ) {
      throw new Error(`URL not in allowlist: ${url}`);
    }
    await shell.openExternal(parsed.href);
  }
);

ipcMain.handle(
  'open-path-in-explorer',
  async (_event: IpcMainInvokeEvent, targetPath: string) => {
    const resolved = path.resolve(targetPath);
    if (!(await fs.pathExists(resolved))) {
      return { success: false as const, error: 'Path does not exist' };
    }
    const errMsg = await shell.openPath(resolved);
    if (errMsg) {
      return { success: false as const, error: errMsg };
    }
    return { success: true as const };
  }
);

ipcMain.handle(
  'reveal-path-in-explorer',
  async (_event: IpcMainInvokeEvent, targetPath: string) => {
    const resolved = path.resolve(targetPath);
    if (!(await fs.pathExists(resolved))) {
      return { success: false as const, error: 'Path does not exist' };
    }

    shell.showItemInFolder(resolved);
    return { success: true as const };
  }
);

// Auto-updater IPC handlers
ipcMain.handle('check-for-updates', async (): Promise<void> => {
  if (!isDev) {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('Error checking for updates:', error);
      throw error;
    }
  }
});

ipcMain.handle('download-update', async (): Promise<void> => {
  if (!isDev) {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      console.error('Error downloading update:', error);
      throw error;
    }
  }
});

ipcMain.handle('install-update', async (): Promise<void> => {
  if (!isDev) {
    autoUpdater.quitAndInstall(false, true);
  }
});

ipcMain.handle('get-app-version', async (): Promise<string> => {
  return app.getVersion();
});

// Window controls
ipcMain.handle('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});
