const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true } });
  win.webContents.executeJavaScript('typeof window.BarcodeDetector').then(console.log).then(() => app.quit());
});
