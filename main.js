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
  Menu,
} = require('electron');
const path = require('path');

// ─── Command-line switches ─────────────────────────────────────────────────────
// Only apply headless/server flags when NOT running on a desktop with a display
const isHeadless = !process.env.DISPLAY && process.platform === 'linux';
if (isHeadless) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}
// TLS 1.3 enforcement
app.commandLine.appendSwitch('ssl-version-min', 'tls1.3');
app.commandLine.appendSwitch(
  'cipher-suite-blacklist',
  'TLS_RSA_WITH_RC4_128_MD5,TLS_RSA_WITH_RC4_128_SHA,TLS_RSA_WITH_3DES_EDE_CBC_SHA'
);

app.setName('EtherX Browser');

// ─── New modules ──────────────────────────────────────────────────────────────
const DatabaseManager = require('./src/main/database');
const AdBlocker = require('./src/main/adBlocker');
const SecurityManager = require('./src/main/security');
const PasswordManager = require('./src/main/passwordManager');
const QRSyncManager = require('./src/main/qrSync');
const DefaultBrowser = require('./src/main/defaultBrowser');
const UserAgentManager = require('./src/main/userAgent');
const I18nManager = require('./src/main/i18n');
const AIManager = require('./src/main/ai');

// ─── Global state ─────────────────────────────────────────────────────────────
let mainWindow = null;
let db = null;
let adBlocker = null;
let ai = null;
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

// ─── Auto-save session before window closes ───────────────────────────────────
app.on('before-quit', () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('saveSessionTabs()').catch(() => { });
    }
  } catch (e) { /* window already destroyed */ }
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

  // ── Dock / Taskbar context menu ──────────────────────────────────────────
  const dockMenu = Menu.buildFromTemplate([
    {
      label: 'New Window', click: () => {
        ipcMain.emit('app:newWindow');
        const win = new BrowserWindow({
          width: 1280, height: 800, backgroundColor: '#1a1a2e', titleBarStyle: 'hidden',
          webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, sandbox: false },
        });
        win.loadFile(path.join(__dirname, 'src', 'index.html'));
      }
    },
    {
      label: 'New Private Window', click: () => {
        const win = new BrowserWindow({
          width: 1280, height: 800, backgroundColor: '#0d0d1a', titleBarStyle: 'hidden',
          webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, sandbox: false, partition: 'incognito-' + Date.now() },
        });
        win.loadFile(path.join(__dirname, 'src', 'index.html'));
        win.webContents.on('did-finish-load', () => {
          win.webContents.executeJavaScript(`STATE.isPrivate=true;document.getElementById('privateIndicator').style.display='';document.title='EtherX (Private)';`).catch(() => { });
        });
      }
    },
    { type: 'separator' },
    { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => { mainWindow?.webContents.executeJavaScript('createTab()').catch(() => { }); } },
    { type: 'separator' },
    { label: 'Settings', click: () => { mainWindow?.webContents.executeJavaScript(`document.getElementById('btnSettings').click()`).catch(() => { }); } },
  ]);
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setMenu(dockMenu);
  }
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

  // ── AI: Page Summarizer (proxied through main to keep API key secure) ─────
  ipcMain.handle('ai:summarizePage', async (_e, url, htmlContent) => {
    const settings = db.getSettings();
    const geminiKey = settings.gemini_api_key || process.env.GEMINI_API_KEY || '';
    return ai.summarizePage(url, htmlContent, geminiKey, db);
  });

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

  // ── New Window / Private Window ────────────────────────────────────────────
  ipcMain.handle('app:newWindow', (_e, url) => {
    const win = new BrowserWindow({
      width: 1280, height: 800,
      backgroundColor: '#1a1a2e',
      titleBarStyle: 'hidden',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        sandbox: false,
      },
    });
    win.loadFile(path.join(__dirname, 'src', 'index.html'));
    if (url) {
      win.webContents.on('did-finish-load', () => {
        win.webContents.executeJavaScript(`navigateTo(${JSON.stringify(url)})`).catch(() => { });
      });
    }
    return { ok: true };
  });

  ipcMain.handle('app:newPrivateWindow', () => {
    const win = new BrowserWindow({
      width: 1280, height: 800,
      backgroundColor: '#0d0d1a',
      titleBarStyle: 'hidden',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        sandbox: false,
        partition: 'incognito-' + Date.now(),
      },
    });
    win.loadFile(path.join(__dirname, 'src', 'index.html'));
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript(`
        STATE.isPrivate = true;
        document.getElementById('privateIndicator').style.display = '';
        document.title = 'EtherX (Private)';
      `).catch(() => { });
    });
    return { ok: true };
  });

  // ── Move Tab to New Window ─────────────────────────────────────────────────
  ipcMain.handle('app:moveTabToWindow', (_e, url, title) => {
    const win = new BrowserWindow({
      width: 1280, height: 800,
      backgroundColor: '#1a1a2e',
      titleBarStyle: 'hidden',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        sandbox: false,
      },
    });
    win.loadFile(path.join(__dirname, 'src', 'index.html'));
    if (url) {
      win.webContents.on('did-finish-load', () => {
        win.webContents.executeJavaScript(`navigateTo(${JSON.stringify(url)})`).catch(() => { });
      });
    }
    return { ok: true };
  });

  // ── Split Screen ───────────────────────────────────────────────────────────
  ipcMain.handle('app:splitScreen', (_e, urlLeft, urlRight) => {
    const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const halfW = Math.floor(width / 2);
    const makeWin = (x, url) => {
      const w = new BrowserWindow({
        x, y: 0, width: halfW, height,
        backgroundColor: '#1a1a2e',
        titleBarStyle: 'hidden',
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true, nodeIntegration: false,
          webviewTag: true, sandbox: false,
        },
      });
      w.loadFile(path.join(__dirname, 'src', 'index.html'));
      if (url) {
        w.webContents.on('did-finish-load', () => {
          w.webContents.executeJavaScript(`navigateTo(${JSON.stringify(url)})`).catch(() => { });
        });
      }
      return w;
    };
    makeWin(0, urlLeft);
    makeWin(halfW, urlRight);
    return { ok: true };
  });

  // ── Screenshot Region (returns base64) ─────────────────────────────────────
  ipcMain.handle('app:captureRegion', async (_e, rect) => {
    try {
      const img = await mainWindow.webContents.capturePage(rect ? {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
      } : undefined);
      return { ok: true, dataUrl: img.toDataURL() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Downloads (SQLite) ─────────────────────────────────────────────────────
  ipcMain.handle('db:addDownload', (_e, data) => db.addDownload(data));
  ipcMain.handle('db:getDownloads', (_e, limit) => db.getDownloads(limit));
  ipcMain.handle('db:deleteDownload', (_e, id) => db.deleteDownload(id));
  ipcMain.handle('db:clearDownloads', () => db.clearDownloads());

  // ── Sessions (SQLite) ──────────────────────────────────────────────────────
  ipcMain.handle('db:saveSession', (_e, data) => db.saveSession(data));
  ipcMain.handle('db:getSessions', (_e, limit) => db.getSessions(limit));
  ipcMain.handle('db:deleteSession', (_e, id) => db.deleteSession(id));

  // ── Notes (SQLite) ─────────────────────────────────────────────────────────
  ipcMain.handle('db:addNote', (_e, data) => db.addNote(data));
  ipcMain.handle('db:getNotes', () => db.getNotes());
  ipcMain.handle('db:updateNote', (_e, id, data) => db.updateNote(id, data));
  ipcMain.handle('db:deleteNote', (_e, id) => db.deleteNote(id));

  // ── User Profile (SQLite) ──────────────────────────────────────────────────
  ipcMain.handle('db:getUserProfile', () => db.getUserProfile());
  ipcMain.handle('db:saveUserProfile', (_e, data) => db.saveUserProfile(data));

  // ── Lighthouse Audits (SQLite) ─────────────────────────────────────────────
  ipcMain.handle('db:saveLighthouseAudit', (_e, data) => db.saveLighthouseAudit(data));
  ipcMain.handle('db:getLighthouseAudits', (_e, url, limit) => db.getLighthouseAudits(url, limit));

  // ── History Top Visited ────────────────────────────────────────────────────
  ipcMain.handle('db:getTopVisited', (_e, limit) => db.getTopVisited(limit));

  // ── Profile Picture Upload ─────────────────────────────────────────────────
  ipcMain.handle('app:chooseProfilePicture', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Odaberi profilnu sliku',
      filters: [
        { name: 'Slike', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    try {
      const fs = require('fs');
      const data = fs.readFileSync(result.filePaths[0]);
      const ext = path.extname(result.filePaths[0]).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
      return { ok: true, dataUrl };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

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
