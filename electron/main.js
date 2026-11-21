const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');
const { GlobalShortcuts } = require('./shortcuts');
const { initUpdater } = require('./updater');

// One instance only: a second launch (or the updater relaunching) focuses the existing window
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let pendingScreenSourceId = null;
// 'loopbackWithoutChrome' = system audio minus our own process tree (no feedback loop).
// The renderer can fall back to plain 'loopback' if this mode is rejected.
let screenAudioMode = 'loopbackWithoutChrome';
const DEFAULT_SHORTCUTS = {
  toggleMute: 'Ctrl+Shift+M',
  toggleDeafen: 'Ctrl+Shift+D',
  toggleScreen: 'Ctrl+Shift+S',
  ptt: 'F9'
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    frame: false,
    icon: path.join(__dirname, '../client/public/icon.png'),
    backgroundColor: '#1A1B1E',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../client/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle media permissions for WebRTC
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') return true;
    return false;
  });

  session.defaultSession.setDevicePermissionHandler(() => true);

  // getDisplayMedia handler: captures the source picked in the renderer (via
  // 'set-screen-source') and, when audio is requested, system loopback audio
  // EXCLUDING this app's own output ('loopbackWithoutChrome'). Without that,
  // peers' voices and app sounds get re-captured and sent back (echo loop).
  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const wantedId = pendingScreenSourceId;
      pendingScreenSourceId = null;
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
        if (!sources || sources.length === 0) {
          callback({});
          return;
        }
        const source = sources.find(s => s.id === wantedId) || sources[0];
        const streams = { video: source };
        if (request.audioRequested) {
          streams.audio = screenAudioMode;
        }
        callback(streams);
      }).catch((err) => {
        console.error('[Electron] Display media request error:', err);
        callback({});
      });
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Global shortcuts (keyboard + mouse hook; detects PTT key release)
const shortcuts = new GlobalShortcuts((action) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('shortcut-triggered', action);
  }
});

// App Lifecycle
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  createWindow();
  shortcuts.start();
  // The renderer sends the user's saved shortcuts as soon as it loads
  shortcuts.update(DEFAULT_SHORTCUTS);
  initUpdater(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  shortcuts.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Window Controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// IPC Dynamic Shortcuts update
ipcMain.on('update-shortcuts', (_event, newShortcuts) => {
  console.log('[Electron] Updating shortcuts from renderer:', newShortcuts);
  shortcuts.update({ ...DEFAULT_SHORTCUTS, ...newShortcuts });
});

// IPC Screen Capture Sources (Desktop Capturer)
ipcMain.handle('get-screen-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 }
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }));
  } catch (err) {
    console.error('[Electron] Failed to get screen sources:', err);
    return [];
  }
});

// IPC: renderer picks which source the next getDisplayMedia() call captures
ipcMain.handle('set-screen-source', (_event, sourceId, audioMode) => {
  pendingScreenSourceId = typeof sourceId === 'string' ? sourceId : null;
  screenAudioMode = audioMode === 'loopback' ? 'loopback' : 'loopbackWithoutChrome';
  return true;
});
