/**
 * Auto-update via GitHub Releases (free for public repos).
 * Releases are produced by .github/workflows/release.yml when a "vX.Y.Z" tag is pushed.
 * Flow: check on start + every 4h -> download in background -> the renderer shows a banner ->
 * "Reiniciar y actualizar" installs silently and reopens the app.
 */
const { app, ipcMain } = require('electron');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  console.warn('[Updater] electron-updater unavailable:', err.message);
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
// app.getVersion() is Electron's version when running unpackaged; package.json is always right
const APP_VERSION = (() => {
  try { return require('../package.json').version; } catch (_) { return app.getVersion(); }
})();
let lastStatus = { state: 'idle', currentVersion: APP_VERSION };
let getWindow = () => null;

function send(status) {
  lastStatus = { ...status, currentVersion: APP_VERSION };
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-status', lastStatus);
  }
}

function check() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[Updater] Check failed:', err && err.message);
  });
}

function initUpdater(windowGetter) {
  getWindow = windowGetter;

  ipcMain.handle('get-app-version', () => APP_VERSION);
  ipcMain.handle('get-update-status', () => lastStatus);
  ipcMain.handle('check-for-updates', () => { check(); return true; });
  ipcMain.handle('install-update', () => {
    if (autoUpdater && lastStatus.state === 'ready') {
      // Silent install, then relaunch the updated app
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return true;
    }
    return false;
  });

  if (!autoUpdater || !app.isPackaged) {
    console.log('[Updater] Disabled (development build)');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    send({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => {
    send({ state: 'downloading', version: lastStatus.version, percent: Math.round(p.percent || 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    send({ state: 'ready', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    if (lastStatus.state !== 'ready') send({ state: 'idle' });
  });
  autoUpdater.on('error', (err) => {
    console.warn('[Updater] Error:', err && err.message);
    if (lastStatus.state !== 'ready') send({ state: 'error', message: err && err.message });
  });

  setTimeout(check, 5000);
  setInterval(check, CHECK_INTERVAL_MS);
}

module.exports = { initUpdater };
