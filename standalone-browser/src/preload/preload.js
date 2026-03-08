const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  version: process.env.npm_package_version || '1.0.0',
  openExternal: (url) => ipcRenderer.send('open-external', url),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close')
});
