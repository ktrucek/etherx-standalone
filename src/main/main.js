const { app, BrowserWindow, Menu, shell, session, ipcMain, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// Force dark mode
nativeTheme.themeSource = 'dark';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'EtherX Browser',
    icon: path.join(__dirname, '../build/icon.png'),
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1a1a2e',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,           // Allow cross-origin iframes (needed for browser-in-browser)
      allowRunningInsecureContent: true,
      webviewTag: true,
      sandbox: false
    }
  });

  // Remove all CSP/security headers that block iframes
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    // Remove headers that block iframe embedding
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    callback({ responseHeaders: headers });
  });

  // Load the browser HTML
  const browserPath = path.join(__dirname, 'browser.html');
  if (fs.existsSync(browserPath)) {
    mainWindow.loadFile(browserPath);
  } else {
    mainWindow.loadURL('https://n8n.kriptoentuzijasti.io/browser.html');
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Allow all new windows (tabs/popups from iframes)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return { action: 'allow' };
  });

  // Inject CSS fix for Electron title bar
  mainWindow.webContents.on('did-finish-load', () => {
    if (process.platform === 'darwin') {
      mainWindow.webContents.insertCSS(`
        .title-bar { padding-left: 78px !important; }
        .win-btns { display: none !important; }
      `);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Build application menu
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: 'EtherX Browser',
      submenu: [
        { label: 'About EtherX Browser', role: 'about' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'Cmd+,', click: () => mainWindow?.webContents.executeJavaScript("document.getElementById('btnSettings')?.click()") },
        { type: 'separator' },
        { label: 'Hide EtherX', role: 'hide' },
        { label: 'Hide Others', role: 'hideOthers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit EtherX', role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => mainWindow?.webContents.executeJavaScript("createTab()") },
        { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow?.webContents.executeJavaScript("togglePrivate()") },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => mainWindow?.webContents.executeJavaScript("closeTab(STATE.activeTabId)") },
        { type: 'separator' },
        ...(process.platform !== 'darwin' ? [{ role: 'quit' }] : [])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.executeJavaScript("reloadPage()") },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => mainWindow?.webContents.executeJavaScript("changeZoom(10)") },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => mainWindow?.webContents.executeJavaScript("changeZoom(-10)") },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => mainWindow?.webContents.executeJavaScript("changeZoom(0,100)") },
        { type: 'separator' },
        { label: 'Toggle Full Screen', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' },
          { role: 'front' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'EtherX Website', click: () => shell.openExternal('https://etherx.io') },
        { label: 'Kriptoentuzijasti', click: () => shell.openExternal('https://kriptoentuzijasti.io') },
        { type: 'separator' },
        { label: 'Report Issue', click: () => shell.openExternal('https://kriptoentuzijasti.io/contact') }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App lifecycle
app.whenReady().then(() => {
  // Disable all security features that block iframes/external content
  app.commandLine.appendSwitch('disable-site-isolation-trials');
  app.commandLine.appendSwitch('disable-web-security');
  app.commandLine.appendSwitch('allow-running-insecure-content');

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Handle certificate errors - trust all (browser app needs this)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

app.setName('EtherX Browser');
