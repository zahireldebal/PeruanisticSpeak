const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');

let mainWindow = null;
let currentShortcuts = {
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

  // Allow getDisplayMedia to capture screen or window directly
  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
        if (sources && sources.length > 0) {
          callback({
            video: sources[0],
            audio: request.audioRequested ? 'loopback' : undefined
          });
        } else {
          callback({});
        }
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

function registerShortcuts(shortcuts) {
  // Clear any existing registered shortcuts
  globalShortcut.unregisterAll();
  currentShortcuts = { ...currentShortcuts, ...shortcuts };

  // Helper to register safely
  const bindKey = (accelerator, action) => {
    if (!accelerator || typeof accelerator !== 'string') return;
    try {
      const success = globalShortcut.register(accelerator, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log(`[Electron] Global shortcut triggered: ${action} (${accelerator})`);
          mainWindow.webContents.send('shortcut-triggered', action);
        }
      });
      if (success) {
        console.log(`[Electron] Registered global shortcut: ${action} -> ${accelerator}`);
      } else {
        console.warn(`[Electron] Could not register global shortcut: ${accelerator}`);
      }
    } catch (err) {
      console.warn(`[Electron] Failed to register accelerator "${accelerator}":`, err.message);
    }
  };

  bindKey(currentShortcuts.toggleMute, 'toggleMute');
  bindKey(currentShortcuts.toggleDeafen, 'toggleDeafen');
  bindKey(currentShortcuts.toggleScreen, 'toggleScreen');
  bindKey(currentShortcuts.ptt, 'pttDown');
}

// App Lifecycle
app.whenReady().then(() => {
  createWindow();
  registerShortcuts(currentShortcuts);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
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
  registerShortcuts(newShortcuts);
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

