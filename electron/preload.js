const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script for PeruanisticSPEAK.
 * Secure context bridge exposing only strictly necessary IPC methods.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Window control actions
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Dynamic global shortcuts
  updateShortcuts: (shortcuts) => ipcRenderer.send('update-shortcuts', shortcuts),
  onShortcutTriggered: (callback) => {
    ipcRenderer.on('shortcut-triggered', (_event, action) => callback(action));
  },

  // Screen capture source selection
  getScreenSources: async () => {
    return await ipcRenderer.invoke('get-screen-sources');
  },
  // Select the source (and loopback audio mode) for the next getDisplayMedia() call
  setScreenSource: (sourceId, audioMode) => ipcRenderer.invoke('set-screen-source', sourceId, audioMode)
});

