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
  screen,
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
const activeDownloads = new Map(); // track in-progress downloads

// ─── Google / YouTube popup whitelist ─────────────────────────────────────────
const POPUP_WHITELIST = [
  'accounts.google.com',
  'mail.google.com',
  'youtube.com',
  'www.youtube.com',
  'music.youtube.com',
  'google.com',
  'www.google.com',
  'docs.google.com',
  'drive.google.com',
  'meet.google.com',
  'calendar.google.com',
];

function isWhitelistedPopup(url) {
  try {
    const { hostname } = new URL(url);
    return POPUP_WHITELIST.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

// ─── Helper: create a new BrowserWindow ───────────────────────────────────────
function createNewBrowserWindow(url, opts = {}) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      allowRunningInsecureContent: false,
      webSecurity: false,
      ...(opts.partition ? { partition: opts.partition } : {}),
    },
    icon: path.join(__dirname, 'src', 'icon.png'),
    show: false,
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    if (url && url !== 'about:blank') {
      win.webContents.send('open-url', url);
    }
  });
  return win;
}

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

  // ── Session restore ──────────────────────────────────────────────────────
  try {
    const settings = db.getSettings();
    if (settings.session_restore === 'true' || settings.session_restore === undefined) {
      const savedTabs = db.getTabs();
      if (savedTabs && savedTabs.length > 0) {
        mainWindow.webContents.once('did-finish-load', () => {
          mainWindow.webContents.send('restore-tabs', savedTabs);
        });
      }
    }
  } catch (e) {
    console.error('Session restore failed:', e.message);
  }

  // ── Taskbar / Dock context menu ─────────────────────────────────────────
  if (process.platform === 'win32') {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: '--new-window',
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'New Window',
        description: 'Open a new EtherX window',
      },
      {
        program: process.execPath,
        arguments: '--incognito',
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'New Incognito Window',
        description: 'Open a new private window',
      },
    ]);
  }

  if (process.platform === 'darwin' && app.dock) {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: 'New Window',
        click: () => createNewBrowserWindow(null),
      },
      {
        label: 'New Incognito Window',
        click: () => createNewBrowserWindow(null, { partition: 'incognito' }),
      },
    ]);
    app.dock.setMenu(dockMenu);
  }

  // ── Application Menu (File menu with New Window / New Private Window) ───
  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createNewBrowserWindow(null),
        },
        {
          label: 'New Private Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createNewBrowserWindow(null, { partition: 'incognito' }),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
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
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];
  const appMenu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(appMenu);

  // ── Downloads tracking ──────────────────────────────────────────────────
  session.defaultSession.on('will-download', (_event, item, webContents) => {
    const downloadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const downloadInfo = {
      id: downloadId,
      filename: item.getFilename(),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      startTime: Date.now(),
      savePath: item.getSavePath(),
    };
    activeDownloads.set(downloadId, downloadInfo);

    // Notify renderer of new download
    mainWindow?.webContents.send('download-started', downloadInfo);

    item.on('updated', (_event, state) => {
      downloadInfo.receivedBytes = item.getReceivedBytes();
      downloadInfo.totalBytes = item.getTotalBytes();
      downloadInfo.state = state; // 'progressing' or 'interrupted'
      downloadInfo.savePath = item.getSavePath();
      mainWindow?.webContents.send('download-progress', { ...downloadInfo });
    });

    item.once('done', (_event, state) => {
      downloadInfo.state = state; // 'completed', 'cancelled', or 'interrupted'
      downloadInfo.receivedBytes = item.getReceivedBytes();
      downloadInfo.endTime = Date.now();
      downloadInfo.savePath = item.getSavePath();
      mainWindow?.webContents.send('download-complete', { ...downloadInfo });
      activeDownloads.delete(downloadId);

      // Persist to database
      try {
        db.saveSettings({
          [`download_${downloadId}`]: JSON.stringify({
            filename: downloadInfo.filename,
            url: downloadInfo.url,
            savePath: downloadInfo.savePath,
            totalBytes: downloadInfo.totalBytes,
            state: downloadInfo.state,
            startTime: downloadInfo.startTime,
            endTime: downloadInfo.endTime,
          }),
        });
      } catch (e) {
        console.error('Failed to save download record:', e.message);
      }
    });
  });

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

// ─── Save session before window closes ────────────────────────────────────────
app.on('before-quit', async () => {
  if (mainWindow && db) {
    try {
      mainWindow.webContents.send('save-session-request');
      // Give renderer a moment to respond, but also save what we have
      const tabs = db.getTabs();
      if (tabs) {
        db.saveSettings({ session_restore: 'true', last_session_tabs: JSON.stringify(tabs.map(t => t.url)) });
      }
    } catch (e) {
      console.error('Failed to save session:', e.message);
    }
  }
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

  // ── Popup / new-window handling (#1, #17-18, #19) ──────────────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow whitelisted Google/YouTube popups as new windows
    if (isWhitelistedPopup(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1200,
          height: 800,
          titleBarStyle: 'hidden',
          backgroundColor: '#1a1a2e',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
          },
        },
      };
    }

    // For all other popups: convert to a new tab in the renderer (#19)
    if (url && url !== 'about:blank') {
      mainWindow?.webContents.send('open-url', url);
    }
    return { action: 'deny' };
  });

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

  // ── AI Page Summary ──────────────────────────────────────────────────────
  ipcMain.handle('ai-summarize-page', async (e, { url, content, provider, model, apiKey, maxWords }) => {
    try {
      const crypto = require('crypto');
      const urlHash = crypto.createHash('md5').update(url).digest('hex');

      // Check cache first
      const cached = db.getCachedSummary(urlHash);
      if (cached) return { ok: true, summary: cached, cached: true };

      let summary = '';
      const prompt = `Summarize this web page content in ${maxWords || 250} words or less. Include key points as bullet points:\n\n${(content || '').slice(0, 10000)}`;

      if (provider === 'openai') {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
          body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 })
        });
        const data = await resp.json();
        summary = data.choices?.[0]?.message?.content || 'No summary generated';
      } else if (provider === 'anthropic') {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: model || 'claude-3-haiku-20240307', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
        });
        const data = await resp.json();
        summary = data.content?.[0]?.text || 'No summary generated';
      } else if (provider === 'gemini') {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await resp.json();
        summary = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No summary generated';
      } else if (provider === 'ollama') {
        const endpoint = apiKey || 'http://localhost:11434';
        const resp = await fetch(endpoint + '/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model || 'llama3', prompt, stream: false })
        });
        const data = await resp.json();
        summary = data.response || 'No summary generated';
      } else {
        summary = 'Unknown AI provider: ' + provider;
      }

      // Cache the result
      db.setCachedSummary(urlHash, url, summary, model || provider);

      // Also save to page_summaries
      db.savePageSummary({ url, title: '', summary, model: model || provider, wordCount: summary.split(/\s+/).length });

      return { ok: true, summary, cached: false };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('get-page-summaries', async () => {
    return db.getPageSummaries();
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

  // ── DevTools (#29) ────────────────────────────────────────────────────
  ipcMain.on('devtools:toggle', () => mainWindow?.webContents.toggleDevTools());
  ipcMain.handle('toggle-devtools', () => {
    mainWindow?.webContents.toggleDevTools();
    return { ok: true };
  });

  // ── New Window / New Private Window from renderer ─────────────────────
  ipcMain.handle('new-window', (_e, url) => {
    createNewBrowserWindow(url || null);
    return { ok: true };
  });

  ipcMain.handle('new-private-window', (_e, url) => {
    createNewBrowserWindow(url || null, { partition: 'incognito' });
    return { ok: true };
  });

  // ── Screenshot (#9) ───────────────────────────────────────────────────
  ipcMain.handle('take-screenshot', async (_e, opts = {}) => {
    try {
      const image = await mainWindow.webContents.capturePage();
      if (opts.save) {
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
          defaultPath: `screenshot-${Date.now()}.png`,
          filters: [{ name: 'PNG Images', extensions: ['png'] }],
        });
        if (filePath) {
          require('fs').writeFileSync(filePath, image.toPNG());
          return { ok: true, filePath };
        }
        return { ok: false, cancelled: true };
      }
      return { ok: true, dataUrl: image.toDataURL() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Move tab to new window (#13) ──────────────────────────────────────
  ipcMain.handle('move-tab-to-window', (_e, url) => {
    if (!url) return { ok: false, error: 'No URL provided' };
    createNewBrowserWindow(url);
    return { ok: true };
  });

  // ── Split screen (#14) ────────────────────────────────────────────────
  ipcMain.handle('split-screen', (_e, side) => {
    if (!mainWindow) return { ok: false, error: 'No main window' };
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    const { x, y, width, height } = display.workArea;

    if (side === 'right') {
      mainWindow.setBounds({ x: x + Math.floor(width / 2), y, width: Math.floor(width / 2), height });
    } else {
      // Default: left half
      mainWindow.setBounds({ x, y, width: Math.floor(width / 2), height });
    }
    return { ok: true };
  });

  // ── Zoom via Shift+Scroll (#5) ────────────────────────────────────────
  ipcMain.handle('zoom-shift-scroll', (_e, deltaY) => {
    if (!mainWindow) return { ok: false };
    const wc = mainWindow.webContents;
    const currentZoom = wc.getZoomFactor();
    const step = 0.1;
    if (deltaY < 0) {
      wc.setZoomFactor(Math.min(currentZoom + step, 5.0));
    } else {
      wc.setZoomFactor(Math.max(currentZoom - step, 0.3));
    }
    return { ok: true, zoomFactor: wc.getZoomFactor() };
  });

  // ── Session save from renderer (#8) ───────────────────────────────────
  ipcMain.handle('session:saveTabs', (_e, tabs) => {
    if (!db) return { ok: false, error: 'Database not ready' };
    try {
      const saveTx = db.db.transaction((items) => {
        for (const tab of items) {
          if (!tab.incognito) db.saveTab(tab);
        }
      });
      saveTx(tabs);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Downloads list (#15-16) ───────────────────────────────────────────
  ipcMain.handle('downloads:getActive', () => {
    return Array.from(activeDownloads.values());
  });

  ipcMain.handle('downloads:getHistory', () => {
    const settings = db.getSettings();
    const downloads = [];
    for (const [key, value] of Object.entries(settings)) {
      if (key.startsWith('download_')) {
        try { downloads.push(JSON.parse(value)); } catch { }
      }
    }
    return downloads.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
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

  // Apply popup handling to all webContents (including webviews)
  contents.setWindowOpenHandler(({ url }) => {
    if (isWhitelistedPopup(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1200,
          height: 800,
          titleBarStyle: 'hidden',
          backgroundColor: '#1a1a2e',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    // Convert popup to tab
    if (url && url !== 'about:blank') {
      mainWindow?.webContents.send('open-url', url);
    }
    return { action: 'deny' };
  });
});
