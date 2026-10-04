import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;

// Disable hardware acceleration issues if needed for headless/remote scenarios
// app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let serverProcessStarted = false;

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

function setupIpcHandlers() {
  ipcMain.handle('get-app-version', () => app.getVersion());

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

  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}

async function startInternalServer() {
  if (serverProcessStarted) return;
  serverProcessStarted = true;
  try {
    const serverModule = await import('../dist/api/server.js');
    if (serverModule && typeof serverModule.buildApp === 'function') {
      const fastifyApp = await serverModule.buildApp();
      const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;
      await fastifyApp.listen({ port, host: '0.0.0.0' });
      console.log(`[Electron Main] Internal FreeLLM Gateway server running on port ${port}`);
    }
  } catch (err) {
    console.error('[Electron Main] Failed to start internal server:', err);
  }
}

async function createWindow() {
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

  // Open target links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const distWebPath = path.join(app.getAppPath(), 'dist-web', 'index.html');
    await mainWindow.loadFile(distWebPath);
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
    setupIpcHandlers();
    setupAutoUpdater();
    await startInternalServer();
    await createWindow();

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
}
