/**
 * EtherX Browser — Main Process
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 */

'use strict';

const {
  app,
  BrowserWindow,
  BrowserView,
  session,
  ipcMain,
  dialog,
  shell,
  Menu,
  nativeImage,
  protocol,
  net,
  clipboard,
  globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

// ─── Sub-modules ────────────────────────────────────────────────────────────
const DatabaseManager = require('./database');
const AdBlocker = require('./adBlocker');
const SecurityManager = require('./security');
const PasswordManager = require('./passwordManager');
const QRSyncManager = require('./qrSync');
const DefaultBrowser = require('./defaultBrowser');
const UserAgentManager = require('./userAgent');
const I18nManager = require('./i18n');
const AIManager = require('./ai');

// ─── App Identity ────────────────────────────────────────────────────────────
app.setName('EtherX Browser');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox'); // for AppImage on some distros
}

// Force TLS 1.3 minimum
app.commandLine.appendSwitch('ssl-version-min', 'tls1.3');
app.commandLine.appendSwitch('cipher-suite-blacklist', 'TLS_RSA_WITH_RC4_128_MD5,TLS_RSA_WITH_RC4_128_SHA,TLS_RSA_WITH_3DES_EDE_CBC_SHA');

// ─── Global State ────────────────────────────────────────────────────────────
let mainWindow = null;
let db = null;
let adBlocker = null;
let ai = null;
const INCOGNITO_TABS = new Map(); // tabId → { url, title, ... } — RAM only, never persisted

// ─── Single Instance Lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const url = argv.find(a => a.startsWith('http') || a.startsWith('etherx'));
      if (url && mainWindow.webContents) {
        mainWindow.webContents.send('open-url', url);
      }
    }
  });
}

// ─── App Ready ───────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Init database (persistent)
  db = new DatabaseManager(app.getPath('userData'));
  await db.init();

  // Init ad blocker
  adBlocker = new AdBlocker(session.defaultSession);
  await adBlocker.init();

  // Init security (TLS enforcement)
  SecurityManager.enforce(session.defaultSession);

  // Init AI
  ai = new AIManager();

  // Create window
  createMainWindow();

  // Register protocol handler for etherx://
  protocol.registerHttpProtocol('etherx', (request, callback) => {
    const parsed = new URL(request.url);
    if (parsed.hostname === 'settings') {
      callback({ path: path.join(__dirname, '../renderer/settings.html') });
    } else if (parsed.hostname === 'newtab') {
      callback({ path: path.join(__dirname, '../renderer/newtab.html') });
    } else {
      callback({ error: -6 });
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Clear all incognito data from RAM
  INCOGNITO_TABS.clear();
  if (process.platform !== 'darwin') app.quit();
});

// ─── Create Main Window ───────────────────────────────────────────────────────
function createMainWindow() {
  const i18n = I18nManager.getInstance();
  const settings = db.getSettings();
  const lang = (settings && settings.language) || 'hr';
  i18n.setLanguage(lang);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // custom title bar
    backgroundColor: '#1a1a1a',
    show: false,
    icon: path.join(__dirname, '../../logo_novi.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/browser.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Window controls via IPC
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

  // ── Tabs & Session ──────────────────────────────────────────────────────────

  ipcMain.handle('db:saveTab', (_e, tab) => {
    if (tab.incognito) {
      INCOGNITO_TABS.set(tab.id, tab);
      return { ok: true, incognito: true };
    }
    return db.saveTab(tab);
  });

  ipcMain.handle('db:getTabs', () => db.getTabs());

  ipcMain.handle('db:deleteTab', (_e, tabId) => {
    INCOGNITO_TABS.delete(tabId);
    return db.deleteTab(tabId);
  });

  ipcMain.handle('db:clearIncognitoTab', (_e, tabId) => {
    INCOGNITO_TABS.delete(tabId);
    return { ok: true };
  });

  ipcMain.handle('db:updateTabOrder', (_e, tabs) => db.updateTabOrder(tabs));

  // ── History ─────────────────────────────────────────────────────────────────
  ipcMain.handle('db:addHistory', (_e, entry) => {
    if (entry.incognito) return { ok: true, skipped: true }; // never persist incognito
    return db.addHistory(entry);
  });

  ipcMain.handle('db:getHistory', (_e, opts) => db.getHistory(opts));
  ipcMain.handle('db:clearHistory', () => db.clearHistory());
  ipcMain.handle('db:clearHistoryRange', (_e, from, to) => db.clearHistoryRange(from, to));

  // ── Bookmarks ───────────────────────────────────────────────────────────────
  ipcMain.handle('db:addBookmark', (_e, bm) => db.addBookmark(bm));
  ipcMain.handle('db:getBookmarks', () => db.getBookmarks());
  ipcMain.handle('db:deleteBookmark', (_e, id) => db.deleteBookmark(id));
  ipcMain.handle('db:updateBookmark', (_e, bm) => db.updateBookmark(bm));

  // ── Settings ─────────────────────────────────────────────────────────────────
  ipcMain.handle('db:getSettings', () => db.getSettings());
  ipcMain.handle('db:saveSettings', (_e, s) => db.saveSettings(s));

  // ── Passwords (encrypted, owner has NO access to plaintext) ─────────────────
  ipcMain.handle('passwords:save', (_e, site, username, encryptedPayload) => {
    return PasswordManager.save(app.getPath('userData'), site, username, encryptedPayload);
  });
  ipcMain.handle('passwords:get', (_e, site) => {
    return PasswordManager.get(app.getPath('userData'), site);
  });
  ipcMain.handle('passwords:list', () => PasswordManager.list(app.getPath('userData')));
  ipcMain.handle('passwords:delete', (_e, id) => PasswordManager.remove(app.getPath('userData'), id));

  // ── AI ───────────────────────────────────────────────────────────────────────
  ipcMain.handle('ai:smartSearch', (_e, query) => ai.smartSearch(query));
  ipcMain.handle('ai:checkPhishing', (_e, url, content) => ai.checkPhishing(url, content));
  ipcMain.handle('ai:readingMode', (_e, html) => ai.extractReadingContent(html));
  ipcMain.handle('ai:groupTabs', (_e, tabs) => ai.groupTabs(tabs));
  ipcMain.handle('ai:translate', (_e, text, targetLang) => ai.translate(text, targetLang));

  // ── Ad Blocker ───────────────────────────────────────────────────────────────
  ipcMain.handle('adblock:isEnabled', () => adBlocker.isEnabled());
  ipcMain.handle('adblock:toggle', (_e, enabled) => adBlocker.toggle(enabled));
  ipcMain.handle('adblock:stats', () => adBlocker.getStats());

  // ── Security ─────────────────────────────────────────────────────────────────
  ipcMain.handle('security:getCertInfo', (_e, url) => SecurityManager.getCertInfo(url));

  // ── User Agent ───────────────────────────────────────────────────────────────
  ipcMain.handle('ua:get', () => UserAgentManager.get());
  ipcMain.handle('ua:set', (_e, ua) => UserAgentManager.set(session.defaultSession, ua));

  // ── QR Sync ──────────────────────────────────────────────────────────────────
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

  // ── Default Browser ──────────────────────────────────────────────────────────
  ipcMain.handle('defaultBrowser:check', () => DefaultBrowser.isDefault());
  ipcMain.handle('defaultBrowser:set', () => DefaultBrowser.setAsDefault());

  // ── I18n ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('i18n:getStrings', (_e, lang) => {
    return I18nManager.getInstance().getStrings(lang);
  });
  ipcMain.handle('i18n:setLanguage', (_e, lang) => {
    I18nManager.getInstance().setLanguage(lang);
    db.saveSettings({ ...db.getSettings(), language: lang });
    return { ok: true };
  });
  ipcMain.handle('i18n:getAvailableLanguages', () => I18nManager.getInstance().getAvailableLanguages());

  // ── Cast / Share ─────────────────────────────────────────────────────────────
  ipcMain.handle('cast:getDevices', () => {
    // Cast device discovery placeholder — real Chromecast uses mDNS
    return [{ id: 'local', name: 'This Screen', type: 'local' }];
  });

  ipcMain.handle('share:shareUrl', (_e, url, title) => {
    if (process.platform === 'darwin') {
      shell.openExternal(`https://wa.me/?text=${encodeURIComponent(title + ' ' + url)}`);
    } else {
      clipboard.writeText(url);
    }
    return { ok: true };
  });

  ipcMain.handle('share:savePageAs', async (_e, url, title) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${title.replace(/[/\\?%*:|"<>]/g, '-')}.html`,
      filters: [
        { name: 'HTML Files', extensions: ['html'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return { ok: !!filePath, filePath };
  });

  // ── Navigation helpers ──────────────────────────────────────────────────────
  ipcMain.handle('nav:openExternal', (_e, url) => shell.openExternal(url));

  // ── App info ─────────────────────────────────────────────────────────────────
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getPlatform', () => process.platform);
  ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'));

  // ── Icon management ───────────────────────────────────────────────────────
  ipcMain.handle('app:chooseIcon', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Odaberi ikonu preglednika',
      buttonLabel: 'Odaberi',
      filters: [
        { name: 'Slike', extensions: ['png', 'jpg', 'jpeg', 'ico', 'svg'] },
        { name: 'Sve datoteke', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    return { ok: true, filePath: result.filePaths[0] };
  });

  ipcMain.handle('app:setIcon', (_e, filePath) => {
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromPath(filePath);
      if (img.isEmpty()) return { ok: false, error: 'Slika nije ispravna ili nije podržana.' };
      mainWindow?.setIcon(img);
      db.saveSettings({ ...db.getSettings(), app_icon_path: filePath });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app:resetIcon', () => {
    try {
      const path = require('path');
      const iconPath = path.join(__dirname, '../../logo_novi.png');
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) mainWindow?.setIcon(img);
      db.saveSettings({ ...db.getSettings(), app_icon_path: '' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Clipboard ────────────────────────────────────────────────────────────────
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(text); return { ok: true }; });
  ipcMain.handle('clipboard:read', () => clipboard.readText());

  // ── Devtools ─────────────────────────────────────────────────────────────────
  ipcMain.on('devtools:toggle', () => {
    mainWindow?.webContents.toggleDevTools();
  });
}

app.on('web-contents-created', (_event, contents) => {
  // Enforce User Agent on all web contents
  contents.on('will-navigate', (_e, url) => {
    try {
      const parsed = new URL(url);
      // Block non-http(s) navigations to prevent protocol abuse
      if (!['http:', 'https:', 'etherx:', 'about:'].includes(parsed.protocol)) {
        _e.preventDefault();
      }
    } catch {
      _e.preventDefault();
    }
  });
});

// Register custom 'etherx' scheme
app.on('will-finish-launching', () => {
  app.on('open-url', (_event, url) => {
    _event.preventDefault();
    if (mainWindow) {
      mainWindow.webContents.send('open-url', url);
    }
  });
});
