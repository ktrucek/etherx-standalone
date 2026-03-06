'use strict';

const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  protocol,
  clipboard,
} = require('electron');
const path = require('path');

// ─── Command-line switches ─────────────────────────────────────────────────────
// Server / headless environment flags (keep existing)
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-dev-shm-usage');
// TLS 1.3 enforcement (new)
app.commandLine.appendSwitch('ssl-version-min', 'tls1.3');
app.commandLine.appendSwitch(
  'cipher-suite-blacklist',
  'TLS_RSA_WITH_RC4_128_MD5,TLS_RSA_WITH_RC4_128_SHA,TLS_RSA_WITH_3DES_EDE_CBC_SHA'
);

app.setName('EtherX Browser');

// ─── New modules ──────────────────────────────────────────────────────────────
const DatabaseManager  = require('./src/main/database');
const AdBlocker        = require('./src/main/adBlocker');
const SecurityManager  = require('./src/main/security');
const PasswordManager  = require('./src/main/passwordManager');
const QRSyncManager    = require('./src/main/qrSync');
const DefaultBrowser   = require('./src/main/defaultBrowser');
const UserAgentManager = require('./src/main/userAgent');
const I18nManager      = require('./src/main/i18n');
const AIManager        = require('./src/main/ai');

// ─── Global state ─────────────────────────────────────────────────────────────
let mainWindow       = null;
let db               = null;
let adBlocker        = null;
let ai               = null;
const INCOGNITO_TABS = new Map(); // RAM-only, never persisted

// ─── Single instance lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const url = argv.find(a => a.startsWith('http') || a.startsWith('etherx'));
      if (url) mainWindow.webContents.send('open-url', url);
    }
  });
}

// ─── App ready ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Init database
  db = new DatabaseManager(app.getPath('userData'));
  await db.init();

  // Init ad blocker
  adBlocker = new AdBlocker(session.defaultSession);
  await adBlocker.init();

  // Init security (TLS enforcement on session)
  SecurityManager.enforce(session.defaultSession);

  // Init AI
  ai = new AIManager();

  createWindow();

  // Register etherx:// protocol for settings
  protocol.registerHttpProtocol('etherx', (request, callback) => {
    const { URL: NURL } = require('url');
    const parsed = new NURL(request.url);
    if (parsed.hostname === 'settings') {
      callback({ path: path.join(__dirname, 'src', 'settings.html') });
    } else {
      callback({ error: -6 });
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  INCOGNITO_TABS.clear();
  if (process.platform !== 'darwin') app.quit();
});

// ─── Create main window ───────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',                      // macOS: hidden title bar, shows traffic lights
    trafficLightPosition: { x: 16, y: 16 },       // macOS: traffic lights on LEFT (like Safari)
    backgroundColor: '#1a1a2e',                   // deep navy/purple — matches UI theme
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,                           // keep WebView tabs
      allowRunningInsecureContent: false,
      webSecurity: false,                         // allow cross-origin webviews / iframes
    },
    icon: path.join(__dirname, 'src', 'icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // macOS: inject CSS so traffic lights don't overlap left-side content
  if (process.platform === 'darwin') {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents.insertCSS(
        '.title-bar { padding-left: 78px !important; }' +
        '.win-btns { display: none !important; }'        // hide custom buttons on macOS (OS provides them)
      );
    });
  }

  // Window controls (keep existing IPC names)
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window-close', () => mainWindow?.close());

  setupIPC();
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
function setupIPC() {

  // ── Tabs ───────────────────────────────────────────────────────────────────
  ipcMain.handle('db:saveTab', (_e, tab) => {
    if (tab.incognito) { INCOGNITO_TABS.set(tab.id, tab); return { ok: true, incognito: true }; }
    return db.saveTab(tab);
  });
  ipcMain.handle('db:getTabs', () => db.getTabs());
  ipcMain.handle('db:deleteTab', (_e, tabId) => { INCOGNITO_TABS.delete(tabId); return db.deleteTab(tabId); });
  ipcMain.handle('db:clearIncognitoTab', (_e, tabId) => { INCOGNITO_TABS.delete(tabId); return { ok: true }; });
  ipcMain.handle('db:updateTabOrder', (_e, tabs) => db.updateTabOrder(tabs));

  // ── History ────────────────────────────────────────────────────────────────
  ipcMain.handle('db:addHistory', (_e, entry) => {
    if (entry.incognito) return { ok: true, skipped: true };
    return db.addHistory(entry);
  });
  ipcMain.handle('db:getHistory', (_e, opts) => db.getHistory(opts));
  ipcMain.handle('db:clearHistory', () => db.clearHistory());
  ipcMain.handle('db:clearHistoryRange', (_e, from, to) => db.clearHistoryRange(from, to));

  // ── Bookmarks ──────────────────────────────────────────────────────────────
  ipcMain.handle('db:addBookmark', (_e, bm) => db.addBookmark(bm));
  ipcMain.handle('db:getBookmarks', () => db.getBookmarks());
  ipcMain.handle('db:deleteBookmark', (_e, id) => db.deleteBookmark(id));
  ipcMain.handle('db:updateBookmark', (_e, bm) => db.updateBookmark(bm));

  // ── Settings ───────────────────────────────────────────────────────────────
  ipcMain.handle('db:getSettings', () => db.getSettings());
  ipcMain.handle('db:saveSettings', (_e, s) => db.saveSettings(s));

  // ── Passwords ─────────────────────────────────────────────────────────────
  ipcMain.handle('passwords:save', (_e, site, username, encryptedPayload) =>
    PasswordManager.save(app.getPath('userData'), site, username, encryptedPayload));
  ipcMain.handle('passwords:get', (_e, site) =>
    PasswordManager.get(app.getPath('userData'), site));
  ipcMain.handle('passwords:list', () => PasswordManager.list(app.getPath('userData')));
  ipcMain.handle('passwords:delete', (_e, id) => PasswordManager.remove(app.getPath('userData'), id));

  // ── AI ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('ai:smartSearch', (_e, query) => ai.smartSearch(query));
  ipcMain.handle('ai:checkPhishing', (_e, url, content) => ai.checkPhishing(url, content));
  ipcMain.handle('ai:readingMode', (_e, html) => ai.extractReadingContent(html));
  ipcMain.handle('ai:groupTabs', (_e, tabs) => ai.groupTabs(tabs));
  ipcMain.handle('ai:translate', (_e, text, targetLang) => ai.translate(text, targetLang));

  // ── Ad Blocker ─────────────────────────────────────────────────────────────
  ipcMain.handle('adblock:isEnabled', () => adBlocker.isEnabled());
  ipcMain.handle('adblock:toggle', (_e, enabled) => adBlocker.toggle(enabled));
  ipcMain.handle('adblock:stats', () => adBlocker.getStats());

  // ── Security ───────────────────────────────────────────────────────────────
  ipcMain.handle('security:getCertInfo', (_e, url) => SecurityManager.getCertInfo(url));

  // ── User Agent ─────────────────────────────────────────────────────────────
  ipcMain.handle('ua:get', () => UserAgentManager.get());
  ipcMain.handle('ua:set', (_e, ua) => UserAgentManager.set(session.defaultSession, ua));

  // ── QR Sync ────────────────────────────────────────────────────────────────
  ipcMain.handle('qrsync:generate', (_e, data) => QRSyncManager.generateQR(data));
  ipcMain.handle('qrsync:exportProfile', () => {
    const tabs = db.getTabs();
    const bookmarks = db.getBookmarks();
    const settings = db.getSettings();
    return QRSyncManager.generateQR(JSON.stringify({ tabs, bookmarks, settings }));
  });
  ipcMain.handle('qrsync:importProfile', (_e, data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.bookmarks) parsed.bookmarks.forEach(b => db.addBookmark(b));
      if (parsed.settings) db.saveSettings(parsed.settings);
      if (parsed.tabs) parsed.tabs.forEach(t => db.saveTab(t));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Default Browser ────────────────────────────────────────────────────────
  ipcMain.handle('defaultBrowser:check', () => DefaultBrowser.isDefault());
  ipcMain.handle('defaultBrowser:set', () => DefaultBrowser.setAsDefault());

  // ── I18n ───────────────────────────────────────────────────────────────────
  ipcMain.handle('i18n:getStrings', (_e, lang) => I18nManager.getInstance().getStrings(lang));
  ipcMain.handle('i18n:setLanguage', (_e, lang) => {
    I18nManager.getInstance().setLanguage(lang);
    db.saveSettings({ ...db.getSettings(), language: lang });
    return { ok: true };
  });
  ipcMain.handle('i18n:getAvailableLanguages', () => I18nManager.getInstance().getAvailableLanguages());

  // ── Cast / Share ───────────────────────────────────────────────────────────
  ipcMain.handle('cast:getDevices', () => [{ id: 'local', name: 'This Screen', type: 'local' }]);
  ipcMain.handle('share:shareUrl', (_e, url) => { clipboard.writeText(url); return { ok: true }; });
  ipcMain.handle('share:savePageAs', async (_e, url, title) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${(title || 'page').replace(/[/\\?%*:|"<>]/g, '-')}.html`,
      filters: [{ name: 'HTML Files', extensions: ['html'] }, { name: 'All Files', extensions: ['*'] }],
    });
    return { ok: !!filePath, filePath };
  });

  // ── Navigation helpers ─────────────────────────────────────────────────────
  ipcMain.handle('nav:openExternal', (_e, url) => shell.openExternal(url));

  // ── App info ──────────────────────────────────────────────────────────────
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getPlatform', () => process.platform);
  ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'));

  // ── Icon management ───────────────────────────────────────────────────────
  ipcMain.handle('app:chooseIcon', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Odaberi ikonu preglednika',
      buttonLabel: 'Odaberi',
      filters: [
        { name: 'Slike', extensions: ['png', 'jpg', 'jpeg', 'ico'] },
        { name: 'Sve datoteke', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    return { ok: true, filePath: result.filePaths[0] };
  });

  ipcMain.handle('app:setIcon', (_e, filePath) => {
    try {
      const img = nativeImage.createFromPath(filePath);
      if (img.isEmpty()) return { ok: false, error: 'Slika nije ispravna.' };
      mainWindow?.setIcon(img);
      db.saveSettings({ ...db.getSettings(), app_icon_path: filePath });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app:resetIcon', () => {
    try {
      const iconPath = path.join(__dirname, 'src', 'icon.png');
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) mainWindow?.setIcon(img);
      db.saveSettings({ ...db.getSettings(), app_icon_path: '' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Clipboard ─────────────────────────────────────────────────────────────
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(text); return { ok: true }; });
  ipcMain.handle('clipboard:read', () => clipboard.readText());

  // ── DevTools ──────────────────────────────────────────────────────────────
  ipcMain.on('devtools:toggle', () => mainWindow?.webContents.toggleDevTools());

  // ── Open settings page ────────────────────────────────────────────────────
  ipcMain.on('app:openSettings', () => {
    const settingsPath = path.join(__dirname, 'src', 'settings.html');
    const settingsWin = new BrowserWindow({
      width: 960,
      height: 700,
      parent: mainWindow,
      modal: false,
      backgroundColor: '#1e1e1e',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    settingsWin.loadFile(settingsPath);
    settingsWin.setMenuBarVisibility(false);
  });
}

// ─── Navigation safety ────────────────────────────────────────────────────────
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (_e, url) => {
    try {
      const { URL: NURL } = require('url');
      const parsed = new NURL(url);
      if (!['http:', 'https:', 'file:', 'about:'].includes(parsed.protocol)) {
        _e.preventDefault();
      }
    } catch {
      _e.preventDefault();
    }
  });
});
