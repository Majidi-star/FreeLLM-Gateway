import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { autoUpdater } from 'electron-updater';

let mainWindow: BrowserWindow | null = null;
let fastifyAppInstance: any = null;
let endpointsServiceInstance: any = null;
let currentAdminToken = '';

// Configure autoUpdater log and options
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function sendToWindow(channel: string, data?: any) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => {
    sendToWindow('update-status', { stage: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendToWindow('update-status', { stage: 'available', info });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendToWindow('update-status', { stage: 'not-available', info });
  });

  autoUpdater.on('error', (err) => {
    sendToWindow('update-status', { stage: 'error', message: err?.message || String(err) });
  });

  autoUpdater.on('download-progress', (progressInfo) => {
    sendToWindow('update-status', { stage: 'downloading', progress: progressInfo });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendToWindow('update-status', { stage: 'downloaded', info });
  });
}

function initDesktopEnvironment(): { adminApiToken: string; encryptionMasterKey: string } {
  const userDataDir = app.getPath('userData');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const configPath = path.join(userDataDir, 'goalroute-config.json');
  let config: { adminApiToken?: string; encryptionMasterKey?: string } = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[Electron Main] Error reading desktop config:', e);
    }
  }

  let modified = false;

  // D3: Ensure ENCRYPTION_MASTER_KEY is generated once and persisted
  if (!config.encryptionMasterKey || !/^[0-9a-fA-F]{64}$/.test(config.encryptionMasterKey)) {
    config.encryptionMasterKey = crypto.randomBytes(32).toString('hex');
    modified = true;
  }

  // D3: Ensure ADMIN_API_TOKEN is generated and persisted
  if (!config.adminApiToken || typeof config.adminApiToken !== 'string' || config.adminApiToken.length < 8) {
    config.adminApiToken = `sk-admin-${crypto.randomBytes(16).toString('hex')}`;
    modified = true;
  }

  if (modified) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
      console.error('[Electron Main] Failed to write desktop config:', e);
    }
  }

  // Set environment variables before loading server module
  process.env.ENCRYPTION_MASTER_KEY = config.encryptionMasterKey;
  process.env.ADMIN_API_TOKEN = config.adminApiToken;
  process.env.DATABASE_PATH = path.join(userDataDir, 'goalroute.db'); // D4
  process.env.GOALROUTE_USER_DATA = userDataDir;
  process.env.HOST = '127.0.0.1'; // A6
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';

  currentAdminToken = config.adminApiToken;
  return config as { adminApiToken: string; encryptionMasterKey: string };
}

function setupIpcHandlers() {
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-admin-token', () => currentAdminToken);

  ipcMain.handle('check-for-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: result?.updateInfo };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // U2: Windows update silent install
  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall(true, true);
  });
}

async function startInternalServer(): Promise<number> {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;
  try {
    // D1: Correct path resolution using app.getAppPath()
    const serverPath = path.join(app.getAppPath(), 'dist', 'api', 'server.js');
    if (!fs.existsSync(serverPath)) {
      throw new Error(`Server entry point not found at "${serverPath}". Please build the project before launching.`);
    }

    const serverModule = await import(pathToFileURL(serverPath).href);
    if (!serverModule || typeof serverModule.buildApp !== 'function') {
      throw new Error(`Invalid server bundle: buildApp function not exported from "${serverPath}".`);
    }

    const fastifyApp = await serverModule.buildApp();
    fastifyAppInstance = fastifyApp;

    // D5 & A6: Listen on 127.0.0.1
    await fastifyApp.listen({ port, host: '127.0.0.1' });
    console.log(`[Electron Main] Internal GoalRoute Gateway server running on 127.0.0.1:${port}`);

    // D5: Start all 4 multi-port endpoints (8788, 8789, 8790)
    if (typeof serverModule.getActiveEndpointsService === 'function') {
      endpointsServiceInstance = serverModule.getActiveEndpointsService();
      if (endpointsServiceInstance && typeof endpointsServiceInstance.startAll === 'function') {
        await endpointsServiceInstance.startAll();
        console.log('[Electron Main] Multi-protocol endpoints (8788, 8789, 8790) started successfully');
      }
    }

    return port;
  } catch (err: any) {
    console.error('[Electron Main] Failed to start internal server:', err);
    // D7: Show real error and terminate gracefully
    dialog.showErrorBox(
      'GoalRoute Startup Failure',
      `Failed to initialize internal gateway server on port ${port}.\n\nReason: ${err?.message || String(err)}`
    );
    app.quit();
    throw err;
  }
}

async function createWindow(serverPort: number) {
  const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const preloadPath = path.join(currentDir, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    title: 'GoalRoute - FreeLLM Gateway Cockpit',
    backgroundColor: '#090d16',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // D2: Load UI via http://127.0.0.1:<serverPort> so API and static assets have matching origin
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev && process.env.VITE_DEV_SERVER === 'true') {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      initDesktopEnvironment();
      setupIpcHandlers();
      setupAutoUpdater();
      const port = await startInternalServer();
      await createWindow(port);

      // U3: Check for updates once on startup in packaged app
      if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch((err) => {
          console.warn('[AutoUpdater] Initial update check error:', err?.message || err);
        });
      }
    } catch (e) {
      console.error('[Electron Main] Startup error:', e);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;
        createWindow(port);
      }
    });
  });

  // D7: Clean shutdown on quit
  app.on('before-quit', async (event) => {
    if (fastifyAppInstance || endpointsServiceInstance) {
      event.preventDefault();
      try {
        if (endpointsServiceInstance && typeof endpointsServiceInstance.stopAll === 'function') {
          await endpointsServiceInstance.stopAll();
        }
        if (fastifyAppInstance && typeof fastifyAppInstance.close === 'function') {
          await fastifyAppInstance.close();
        }
      } catch (err) {
        console.error('[Electron Main] Error during server cleanup:', err);
      } finally {
        fastifyAppInstance = null;
        endpointsServiceInstance = null;
        app.exit(0);
      }
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
