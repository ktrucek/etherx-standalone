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
const fs = require('fs');
const { execFile } = require('child_process');

// ─── Command-line switches ─────────────────────────────────────────────────────
// disable-gpu kills rendering on macOS (blank window on Apple Silicon + Intel Rosetta)
// Only apply on Linux headless/CI environments — on desktop keep GPU enabled for performance
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const isHeadless = process.env.DISPLAY === undefined && process.platform === 'linux';

if (process.platform !== 'darwin') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');

  // Disable GPU only in CI/headless environments — on desktop keep GPU enabled for performance
  if (isCI || isHeadless) {
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  } else {
    // Enable hardware acceleration on desktop
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
  }
}
// TLS 1.3 enforcement
app.commandLine.appendSwitch('ssl-version-min', 'tls1.3');
app.commandLine.appendSwitch(
  'cipher-suite-blacklist',
  'TLS_RSA_WITH_RC4_128_MD5,TLS_RSA_WITH_RC4_128_SHA,TLS_RSA_WITH_3DES_EDE_CBC_SHA'
);

app.setName('EtherX Browser');

// ─── New modules (wrapped in try/catch — native modules can crash on wrong arch) ─
let DatabaseManager, AdBlocker, SecurityManager, PasswordManager;
let QRSyncManager, DefaultBrowser, UserAgentManager, I18nManager, AIManager;
try { DatabaseManager = require('./src/main/database'); } catch (e) { console.error('❌ database module failed:', e.message); }
try { AdBlocker = require('./src/main/adBlocker'); } catch (e) { console.error('❌ adBlocker module failed:', e.message); }
try { SecurityManager = require('./src/main/security'); } catch (e) { console.error('❌ security module failed:', e.message); }
try { PasswordManager = require('./src/main/passwordManager'); } catch (e) { console.error('❌ passwordManager module failed:', e.message); }
try { QRSyncManager = require('./src/main/qrSync'); } catch (e) { console.error('❌ qrSync module failed:', e.message); }
try { DefaultBrowser = require('./src/main/defaultBrowser'); } catch (e) { console.error('❌ defaultBrowser module failed:', e.message); }
try { UserAgentManager = require('./src/main/userAgent'); } catch (e) { console.error('❌ userAgent module failed:', e.message); }
try { I18nManager = require('./src/main/i18n'); } catch (e) { console.error('❌ i18n module failed:', e.message); }
try { AIManager = require('./src/main/ai'); } catch (e) { console.error('❌ ai module failed:', e.message); }

// ─── DoH startup config ───────────────────────────────────────────────────────
// Read DoH preference from a small JSON config file (written by renderer at runtime)
// and apply before app.ready (commandLine changes require this)
(function applyStartupDoH() {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'etherx_doh.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.enabled) {
        const provider = cfg.provider || 'cloudflare';
        const templates = {
          cloudflare: 'https://cloudflare-dns.com/dns-query{?dns}',
          google: 'https://dns.google/dns-query{?dns}',
          quad9: 'https://dns.quad9.net/dns-query{?dns}',
        };
        const tmpl = templates[provider] || templates.cloudflare;
        app.commandLine.appendSwitch('enable-features', 'DnsOverHttps');
        app.commandLine.appendSwitch('dns-over-https-mode', 'secure');
        app.commandLine.appendSwitch('dns-over-https-server-uri-template', tmpl);
      }
    }
  } catch (_) { /* ignore */ }
})();

// ─── Global state ─────────────────────────────────────────────────────────────
let mainWindow = null;
let db = null;
let adBlocker = null;
let ai = null;
const INCOGNITO_TABS = new Map(); // RAM-only, never persisted
let _ipcSetupDone = false; // guard: prevents duplicate IPC handler registration
const _downloadTrackedSessions = new Set();

function broadcastToAllWindows(channel, payload) {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    } catch (_) { }
  });
}

function setupDownloadTracking(ses) {
  if (!ses || _downloadTrackedSessions.has(ses)) return;
  _downloadTrackedSessions.add(ses);
  ses.on('will-download', (_event, item, webContents) => {
    const downloadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id: downloadId,
      url: item.getURL(),
      filename: item.getFilename(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      status: 'started',
      ts: Date.now(),
      windowId: BrowserWindow.fromWebContents(webContents)?.id || null,
    };
    broadcastToAllWindows('download-update', payload);
    item.on('updated', () => {
      broadcastToAllWindows('download-update', {
        ...payload,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        status: item.isPaused() ? 'paused' : 'progressing',
        savePath: item.getSavePath?.() || '',
      });
    });
    item.on('done', (_e2, state) => {
      const finalPayload = {
        ...payload,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        savePath: item.getSavePath?.() || '',
        status: state === 'completed' ? 'completed' : 'failed',
        state,
        ts: Date.now(),
      };
      try {
        if (db) db.addDownload(finalPayload);
      } catch (_) { }
      broadcastToAllWindows('download-update', finalPayload);
    });
  });
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

// ─── Native application menu ──────────────────────────────────────────────────
function configureNativeMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

configureNativeMenu();

// ─── App ready ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Init database (wrapped — better-sqlite3 may fail on wrong arch)
  try {
    if (DatabaseManager) { db = new DatabaseManager(app.getPath('userData')); await db.init(); }
  } catch (e) { console.error('❌ DB init failed:', e.message); db = null; }

  // Init ad blocker
  try {
    if (AdBlocker) { adBlocker = new AdBlocker(session.defaultSession); await adBlocker.init(); }
  } catch (e) { console.error('❌ AdBlocker init failed:', e.message); adBlocker = null; }

  // Init security
  try { if (SecurityManager) SecurityManager.enforce(session.defaultSession); } catch (e) { console.error('❌ Security init failed:', e.message); }

  // Init AI
  try { if (AIManager) ai = new AIManager(); } catch (e) { console.error('❌ AI init failed:', e.message); ai = null; }

  setupDownloadTracking(session.defaultSession);
  try { setupDownloadTracking(session.fromPartition('persist:etherx')); } catch (_) { }

  // Setup IPC handlers ONCE before creating any window
  if (!_ipcSetupDone) {
    setupIPC();
    _ipcSetupDone = true;
  }

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
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden', // hiddenInset on macOS keeps traffic lights visible + content below
    trafficLightPosition: { x: 16, y: 16 },           // macOS: traffic lights on LEFT (like Safari)
    backgroundColor: '#1a1a2e',                       // deep navy/purple — matches UI theme
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,                               // required for preload to work correctly
      webviewTag: true,                             // keep WebView tabs
      allowRunningInsecureContent: false,
      webSecurity: false,                           // allow cross-origin webviews / iframes
    },
    icon: path.join(__dirname, 'src', 'logo_novi.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Strip Electron/x.x and EtherX/x.x tokens from every outgoing request.
  // Google accounts.google.com detects these tokens as "embedded webview" and
  // blocks login with "This browser may not be secure". Cleaning the UA fixes it.
  const CLEAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
  // Google also checks Sec-Fetch-Site / Origin headers — force override for google domains
  const GOOGLE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
  // ── Network monitoring & CORS bypass ────────────────────────────────────────
  const networkLog = [];
  const MAX_NETWORK_LOG = 500;

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      const key = Object.keys(headers).find(k => k.toLowerCase() === 'user-agent');
      if (key) {
        // Always strip Electron/EtherX identifiers
        let ua = headers[key]
          .replace(/\s*Electron\/[\d.]+/gi, '')
          .replace(/\s*EtherX\/[\d.]+/gi, '')
          .trim();
        // For Google domains force clean modern Chrome UA
        const url = details.url || '';
        if (/google\.com|googleapis\.com|accounts\.google/i.test(url)) {
          ua = GOOGLE_UA;
          // Remove X-Frame-Options bypass headers that trigger Google security
          delete headers['X-Requested-With'];
        }
        headers[key] = ua || CLEAN_UA;
      }

      // ── CORS Bypass: Remove Origin/Referer restrictions ──────────────────────
      // This allows cross-origin requests without proxy
      delete headers['Origin'];
      delete headers['Referer'];

      // Log network request
      networkLog.push({
        id: details.id,
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
        timestamp: Date.now(),
        requestHeaders: headers
      });
      if (networkLog.length > MAX_NETWORK_LOG) networkLog.shift();

      callback({ requestHeaders: headers });
    }
  );

  // ── Response headers: Disable CORS, X-Frame-Options, CSP ────────────────────
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };

      // Remove CORS restrictions
      delete headers['access-control-allow-origin'];
      delete headers['Access-Control-Allow-Origin'];
      headers['Access-Control-Allow-Origin'] = ['*'];
      headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
      headers['Access-Control-Allow-Headers'] = ['*'];
      headers['Access-Control-Allow-Credentials'] = ['true'];

      // Remove frame restrictions (allows embedding)
      delete headers['x-frame-options'];
      delete headers['X-Frame-Options'];

      // Remove CSP restrictions
      delete headers['content-security-policy'];
      delete headers['Content-Security-Policy'];
      delete headers['content-security-policy-report-only'];

      // Update network log with response
      const logEntry = networkLog.find(e => e.id === details.id);
      if (logEntry) {
        logEntry.statusCode = details.statusCode;
        logEntry.responseHeaders = headers;
        logEntry.fromCache = details.fromCache;
      }

      callback({ responseHeaders: headers });
    }
  );

  // ── Network completed/error tracking ─────────────────────────────────────────
  mainWindow.webContents.session.webRequest.onCompleted(
    { urls: ['*://*/*'] },
    (details) => {
      const logEntry = networkLog.find(e => e.id === details.id);
      if (logEntry) {
        logEntry.completed = true;
        logEntry.duration = Date.now() - logEntry.timestamp;
        // Send to renderer for DevTools Network panel
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('network-log', logEntry);
        }
      }
    }
  );

  mainWindow.webContents.session.webRequest.onErrorOccurred(
    { urls: ['*://*/*'] },
    (details) => {
      const logEntry = networkLog.find(e => e.id === details.id);
      if (logEntry) {
        logEntry.error = details.error;
        logEntry.completed = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('network-log', logEntry);
        }
      }
    }
  );

  // Show immediately — don't wait for ready-to-show which may never fire on macOS
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  // Fallback: force show after 3s in case ready-to-show never fires
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('⚠️ ready-to-show never fired, force showing window');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 3000);

  // Log any load failures and show alert to user
  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    console.error('❌ did-fail-load:', code, desc, url);
    // Only show dialog for main frame failures (not subresource/CDN fails)
    if (url && url.startsWith('file://')) {
      dialog.showErrorBox('EtherX: Load Failed', `Code: ${code}\n${desc}\nURL: ${url}`);
    }
  });
  // Capture renderer console errors
  mainWindow.webContents.on('console-message', (e, level, msg, line, sourceId) => {
    if (level >= 2) console.error(`🖥️ Renderer [${level}] ${sourceId}:${line} → ${msg}`);
  });
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    console.error('❌ render-process-gone:', details.reason, details.exitCode);
    dialog.showErrorBox('EtherX: Renderer Crashed', `Reason: ${details.reason}\nExit: ${details.exitCode}`);
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.error('⚠️ webContents unresponsive');
  });

  // Verify content actually loaded after 5 seconds
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('✅ did-finish-load fired');
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.executeJavaScript(`
        (function() {
          var el = document.getElementById('contentArea');
          var tb = document.querySelector('.title-bar');
          return JSON.stringify({
            bodyH: document.body.offsetHeight,
            bodyW: document.body.offsetWidth,
            contentArea: el ? { h: el.offsetHeight, w: el.offsetWidth, display: getComputedStyle(el).display } : null,
            titleBar: tb ? { h: tb.offsetHeight } : null,
            ntpVisible: !!document.getElementById('ntpPage'),
            tabCount: typeof STATE !== 'undefined' ? STATE.tabs.length : -1,
          });
        })()
      `).then(json => {
        const info = JSON.parse(json);
        console.log('🔍 Layout check:', info);
        if (info.contentArea && info.contentArea.h < 10) {
          console.error('⚠️ Content area has 0 height! Layout may be broken.');
        }
      }).catch(err => {
        console.error('⚠️ Layout check failed:', err.message);
      });
    }, 3000);
  });

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

  // Window controls — use removeAllListeners to prevent duplicates on re-create
  ipcMain.removeAllListeners('window-minimize');
  ipcMain.removeAllListeners('window-maximize');
  ipcMain.removeAllListeners('window-close');
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window-close', () => mainWindow?.close());

  // setupIPC is called once from app.whenReady — never call it from createWindow

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

  const noDb = () => ({ ok: false, error: 'Database not available' });
  const noAi = () => ({ ok: false, error: 'AI not available' });

  // ── Tabs ───────────────────────────────────────────────────────────────────
  ipcMain.handle('db:saveTab', (_e, tab) => {
    if (tab.incognito) { INCOGNITO_TABS.set(tab.id, tab); return { ok: true, incognito: true }; }
    return db ? db.saveTab(tab) : noDb();
  });
  ipcMain.handle('db:getTabs', () => db ? db.getTabs() : []);
  ipcMain.handle('db:deleteTab', (_e, tabId) => { INCOGNITO_TABS.delete(tabId); return db ? db.deleteTab(tabId) : noDb(); });
  ipcMain.handle('db:clearIncognitoTab', (_e, tabId) => { INCOGNITO_TABS.delete(tabId); return { ok: true }; });
  ipcMain.handle('db:updateTabOrder', (_e, tabs) => db ? db.updateTabOrder(tabs) : noDb());

  // ── History ────────────────────────────────────────────────────────────────
  ipcMain.handle('db:addHistory', (_e, entry) => {
    if (entry.incognito) return { ok: true, skipped: true };
    return db ? db.addHistory(entry) : noDb();
  });
  ipcMain.handle('db:getHistory', (_e, opts) => db ? db.getHistory(opts) : []);
  ipcMain.handle('db:clearHistory', () => db ? db.clearHistory() : noDb());
  ipcMain.handle('db:clearHistoryRange', (_e, from, to) => db ? db.clearHistoryRange(from, to) : noDb());

  // ── Bookmarks ──────────────────────────────────────────────────────────────
  ipcMain.handle('db:addBookmark', (_e, bm) => db ? db.addBookmark(bm) : noDb());
  ipcMain.handle('db:getBookmarks', () => db ? db.getBookmarks() : []);
  ipcMain.handle('db:deleteBookmark', (_e, id) => db ? db.deleteBookmark(id) : noDb());
  ipcMain.handle('db:updateBookmark', (_e, bm) => db ? db.updateBookmark(bm) : noDb());

  // ── Settings ───────────────────────────────────────────────────────────────
  ipcMain.handle('db:getSettings', () => db ? db.getSettings() : {});
  ipcMain.handle('db:saveSettings', (_e, s) => db ? db.saveSettings(s) : noDb());

  // ── DoH runtime toggle ─────────────────────────────────────────────────────
  ipcMain.handle('settings:applyDoH', (_e, enabled) => {
    try {
      const cfgPath = path.join(app.getPath('userData'), 'etherx_doh.json');
      const provider = db ? (db.getSettings()['doh_provider'] || 'cloudflare') : 'cloudflare';
      fs.writeFileSync(cfgPath, JSON.stringify({ enabled: !!enabled, provider }, null, 2));
    } catch (_) { /* ignore */ }
    return { ok: true, requiresRestart: true };
  });

  // ── Passwords ─────────────────────────────────────────────────────────────
  ipcMain.handle('passwords:save', (_e, site, username, encryptedPayload) =>
    PasswordManager ? PasswordManager.save(app.getPath('userData'), site, username, encryptedPayload) : noDb());
  ipcMain.handle('passwords:get', (_e, site) =>
    PasswordManager ? PasswordManager.get(app.getPath('userData'), site) : null);
  ipcMain.handle('passwords:list', () => PasswordManager ? PasswordManager.list(app.getPath('userData')) : []);
  ipcMain.handle('passwords:delete', (_e, id) => PasswordManager ? PasswordManager.remove(app.getPath('userData'), id) : noDb());
  ipcMain.handle('passwords:setupVault', async (_e, masterPassword) =>
    PasswordManager ? PasswordManager.setupVault(app.getPath('userData'), masterPassword) : noDb());
  ipcMain.handle('passwords:unlockVault', async (_e, masterPassword) =>
    PasswordManager ? PasswordManager.unlockVault(app.getPath('userData'), masterPassword) : noDb());
  ipcMain.handle('passwords:lockVault', () =>
    PasswordManager ? PasswordManager.lockVault(app.getPath('userData')) : noDb());
  ipcMain.handle('passwords:exportBitwarden', () =>
    PasswordManager ? PasswordManager.exportBitwardenFormat(app.getPath('userData')) : noDb());

  // ── Network Monitoring ─────────────────────────────────────────────────────
  ipcMain.handle('network:getLog', () => {
    return networkLog.slice(-100); // Return last 100 entries
  });
  ipcMain.handle('network:clearLog', () => {
    networkLog.length = 0;
    return { ok: true };
  });

  // ── AI ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('ai:smartSearch', (_e, query) => ai ? ai.smartSearch(query) : noAi());
  ipcMain.handle('ai:checkPhishing', (_e, url, content) => ai ? ai.checkPhishing(url, content) : noAi());
  ipcMain.handle('ai:readingMode', (_e, html) => ai ? ai.extractReadingContent(html) : noAi());
  ipcMain.handle('ai:groupTabs', (_e, tabs) => ai ? ai.groupTabs(tabs) : noAi());
  ipcMain.handle('ai:translate', (_e, text, targetLang) => ai ? ai.translate(text, targetLang) : noAi());

  // ── AI: Page Summarizer (proxied through main to keep API key secure) ─────
  ipcMain.handle('ai:summarizePage', async (_e, url, htmlContent) => {
    if (!ai) return noAi();
    const settings = db ? db.getSettings() : {};
    const geminiKey = (settings.gemini_api_key) || process.env.GEMINI_API_KEY || '';
    return ai.summarizePage(url, htmlContent, geminiKey, db);
  });

  // ── Ad Blocker ─────────────────────────────────────────────────────────────
  ipcMain.handle('adblock:isEnabled', () => adBlocker ? adBlocker.isEnabled() : false);
  ipcMain.handle('adblock:toggle', (_e, enabled) => adBlocker ? adBlocker.toggle(enabled) : noDb());
  ipcMain.handle('adblock:stats', () => adBlocker ? adBlocker.getStats() : { blocked: 0 });

  // ── Security ───────────────────────────────────────────────────────────────
  ipcMain.handle('security:getCertInfo', (_e, url) => SecurityManager ? SecurityManager.getCertInfo(url) : null);

  // ── User Agent ─────────────────────────────────────────────────────────────
  ipcMain.handle('ua:get', () => UserAgentManager ? UserAgentManager.get() : null);
  ipcMain.handle('ua:set', (_e, ua) => UserAgentManager ? UserAgentManager.set(session.defaultSession, ua) : noDb());

  // ── QR Sync ────────────────────────────────────────────────────────────────
  ipcMain.handle('qrsync:generate', (_e, data) => QRSyncManager ? QRSyncManager.generateQR(data) : noDb());
  ipcMain.handle('qrsync:exportProfile', () => {
    if (!QRSyncManager) return noDb();
    const tabs = db ? db.getTabs() : [];
    const bookmarks = db ? db.getBookmarks() : [];
    const settings = db ? db.getSettings() : {};
    return QRSyncManager.generateQR(JSON.stringify({ tabs, bookmarks, settings }));
  });
  ipcMain.handle('qrsync:importProfile', (_e, data) => {
    try {
      const parsed = JSON.parse(data);
      if (db) {
        if (parsed.bookmarks) parsed.bookmarks.forEach(b => db.addBookmark(b));
        if (parsed.settings) db.saveSettings(parsed.settings);
        if (parsed.tabs) parsed.tabs.forEach(t => db.saveTab(t));
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Default Browser ────────────────────────────────────────────────────────
  ipcMain.handle('defaultBrowser:check', () => DefaultBrowser ? DefaultBrowser.isDefault() : false);
  ipcMain.handle('defaultBrowser:set', () => DefaultBrowser ? DefaultBrowser.setAsDefault() : noDb());

  // ── I18n ───────────────────────────────────────────────────────────────────
  ipcMain.handle('i18n:getStrings', (_e, lang) => I18nManager ? I18nManager.getInstance().getStrings(lang) : {});
  ipcMain.handle('i18n:setLanguage', (_e, lang) => {
    if (I18nManager) I18nManager.getInstance().setLanguage(lang);
    if (db) db.saveSettings({ ...db.getSettings(), language: lang });
    return { ok: true };
  });
  ipcMain.handle('i18n:getAvailableLanguages', () => I18nManager ? I18nManager.getInstance().getAvailableLanguages() : []);

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
  ipcMain.handle('nav:openExternal', (_e, url) => {
    // Security: only allow http/https/mailto URLs via openExternal
    if (/^https?:\/\/|^mailto:/i.test(url)) return shell.openExternal(url);
    return Promise.resolve({ ok: false, error: 'URL scheme not allowed' });
  });
  ipcMain.handle('app:openApplePasswords', async () => {
    if (process.platform !== 'darwin') return { ok: false, error: 'Apple Passwords available only on macOS.' };
    const tryExec = (file, args = []) => new Promise(resolve => {
      execFile(file, args, err => resolve(!err));
    });
    if (await tryExec('open', ['-a', 'Passwords'])) return { ok: true };
    if (await tryExec('open', ['x-apple.systempreferences:com.apple.Passwords-Settings.extension'])) return { ok: true };
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.Passwords-Settings.extension');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('extensions:chooseFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose unpacked extension folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  });
  ipcMain.handle('extensions:loadUnpacked', async (_e, extensionPath) => {
    try {
      if (!extensionPath || !fs.existsSync(extensionPath)) return { ok: false, error: 'Extension folder not found.' };
      const manifestPath = path.join(extensionPath, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return { ok: false, error: 'manifest.json not found in selected folder.' };
      const ext = await session.defaultSession.loadExtension(extensionPath, { allowFileAccess: true });
      return { ok: true, id: ext.id, name: ext.name, version: ext.version, path: extensionPath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── App info ────────────────────────────────────────────────
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getPlatform', () => process.platform);
  ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'));
  ipcMain.handle('app:listWindows', (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    const windows = BrowserWindow.getAllWindows().map((win, index) => ({
      id: win.id,
      title: win.getTitle() || win.webContents.getTitle() || `Window ${index + 1}`,
      focused: win.isFocused(),
      minimized: win.isMinimized(),
    }));
    return { currentWindowId: currentWindow?.id || null, windows };
  });
  ipcMain.handle('app:focusWindow', (_event, windowId) => {
    const win = BrowserWindow.fromId(Number(windowId));
    if (!win) return { ok: false, error: 'Window not found' };
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { ok: true };
  });
  ipcMain.handle('app:getBuildInfo', () => {
    try {
      const pkg = require('./package.json');
      return { version: pkg.version, buildTime: pkg.buildTime || null };
    } catch (e) {
      return { version: app.getVersion(), buildTime: null };
    }
  });

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
      if (db) db.saveSettings({ ...db.getSettings(), app_icon_path: filePath });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app:resetIcon', () => {
    try {
      const iconPath = path.join(__dirname, 'src', 'logo_novi.png');
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) mainWindow?.setIcon(img);
      if (db) db.saveSettings({ ...db.getSettings(), app_icon_path: '' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Clipboard ─────────────────────────────────────────────────────────────
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(text); return { ok: true }; });
  ipcMain.handle('clipboard:read', () => clipboard.readText());

  // ── Cookies ───────────────────────────────────────────────────────────────
  ipcMain.handle('cookies:getAll', async (_e, url) => {
    try {
      const filter = url ? { url } : {};
      const cookies = await session.defaultSession.cookies.get(filter);
      return { ok: true, cookies };
    } catch (e) {
      return { ok: false, error: e.message, cookies: [] };
    }
  });
  ipcMain.handle('cookies:remove', async (_e, url, name) => {
    try {
      await session.defaultSession.cookies.remove(url, name);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('cookies:clearAll', async () => {
    try {
      await session.defaultSession.clearStorageData({ storages: ['cookies'] });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

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
    setupDownloadTracking(win.webContents.session);
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
    setupDownloadTracking(win.webContents.session);
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
    setupDownloadTracking(win.webContents.session);
    win.loadFile(path.join(__dirname, 'src', 'index.html'));
    if (url) {
      win.webContents.on('did-finish-load', () => {
        win.webContents.executeJavaScript(`navigateTo(${JSON.stringify(url)})`).catch(() => { });
      });
    }
    return { ok: true };
  });

  // ── Split Screen ───────────────────────────────────────────────────────────
  ipcMain.handle('app:splitScreen', (_e, urlLeft) => {
    const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const halfW = Math.floor(width / 2);
    const makeWin = (x, hash) => {
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
      setupDownloadTracking(w.webContents.session);
      w.loadFile(path.join(__dirname, 'src', 'index.html'), { hash });
      return w;
    };
    // Left window: load the current tab URL via hash; right window: start fresh
    makeWin(0, urlLeft ? 'split-left=' + encodeURIComponent(urlLeft) : 'fresh-window');
    makeWin(halfW, 'fresh-window');
    return { ok: true };
  });

  // ── Shell helpers (open folder / file) ────────────────────────────────────
  ipcMain.handle('shell:showItemInFolder', (_e, fullPath) => {
    shell.showItemInFolder(fullPath);
    return { ok: true };
  });
  ipcMain.handle('shell:openPath', (_e, fullPath) => shell.openPath(fullPath).then(err => ({ ok: !err, error: err })));
  ipcMain.handle('app:getDownloadsPath', () => require('electron').app.getPath('downloads'));

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
  ipcMain.handle('db:addDownload', (_e, data) => db ? db.addDownload(data) : noDb());
  ipcMain.handle('db:getDownloads', (_e, limit) => db ? db.getDownloads(limit) : []);
  ipcMain.handle('db:deleteDownload', (_e, id) => db ? db.deleteDownload(id) : noDb());
  ipcMain.handle('db:clearDownloads', () => db ? db.clearDownloads() : noDb());

  // ── Sessions (SQLite) ──────────────────────────────────────────────────────
  ipcMain.handle('db:saveSession', (_e, data) => db ? db.saveSession(data) : noDb());
  ipcMain.handle('db:getSessions', (_e, limit) => db ? db.getSessions(limit) : []);
  ipcMain.handle('db:deleteSession', (_e, id) => db ? db.deleteSession(id) : noDb());

  // ── Notes (SQLite) ─────────────────────────────────────────────────────────
  ipcMain.handle('db:addNote', (_e, data) => db ? db.addNote(data) : noDb());
  ipcMain.handle('db:getNotes', () => db ? db.getNotes() : []);
  ipcMain.handle('db:updateNote', (_e, id, data) => db ? db.updateNote(id, data) : noDb());
  ipcMain.handle('db:deleteNote', (_e, id) => db ? db.deleteNote(id) : noDb());

  // ── User Profile (SQLite) ──────────────────────────────────────────────────
  ipcMain.handle('db:getUserProfile', () => db ? db.getUserProfile() : null);
  ipcMain.handle('db:saveUserProfile', (_e, data) => db ? db.saveUserProfile(data) : noDb());

  // ── Lighthouse Audits (SQLite) ─────────────────────────────────────────────
  ipcMain.handle('db:saveLighthouseAudit', (_e, data) => db ? db.saveLighthouseAudit(data) : noDb());
  ipcMain.handle('db:getLighthouseAudits', (_e, url, limit) => db ? db.getLighthouseAudits(url, limit) : []);

  // ── History Top Visited ────────────────────────────────────────────────────
  ipcMain.handle('db:getTopVisited', (_e, limit) => db ? db.getTopVisited(limit) : []);

  // ── Screenshot Folder Chooser ─────────────────────────────────────────────
  ipcMain.handle('app:chooseScreenshotFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Screenshot Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  });

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

// ─── Navigation safety + context-menu passthrough ────────────────────────────
app.on('web-contents-created', (_event, contents) => {
  contents.on('before-input-event', (event, input) => {
    if (process.platform !== 'darwin' || !input.meta || input.control || input.alt) return;
    const key = (input.key || '').toLowerCase();
    try {
      if (key === 'c') { contents.copy(); event.preventDefault(); }
      else if (key === 'v') { contents.paste(); event.preventDefault(); }
      else if (key === 'x') { contents.cut(); event.preventDefault(); }
      else if (key === 'a') { contents.selectAll(); event.preventDefault(); }
      else if (key === 'z' && input.shift) { contents.redo(); event.preventDefault(); }
      else if (key === 'z') { contents.undo(); event.preventDefault(); }
    } catch (_) { }
  });

  // Handle new windows (popups, target="_blank", window.open) — route them as new tabs inside EtherX
  // Without this handler Electron's default is to open new windows in the system default browser!
  contents.setWindowOpenHandler((details) => {
    try {
      const parsedUrl = new URL(details.url);

      // Block external app protocols
      if (['mailto:', 'tel:', 'sms:', 'facetime:', 'skype:', 'zoom:', 'magnet:', 'sip:'].includes(parsedUrl.protocol)) {
        return { action: 'deny' };
      }

      // Route http/https URLs as new tab inside EtherX instead of spawning a system browser
      if (['http:', 'https:', 'about:', 'chrome-extension:'].includes(parsedUrl.protocol)) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app:createTab', details.url);
        }
        return { action: 'deny' };
      }
    } catch (_) { }

    return { action: 'deny' };
  });

  contents.on('will-navigate', (_e, url) => {
    try {
      const { URL: NURL } = require('url');
      const parsed = new NURL(url);
      if (['mailto:', 'tel:', 'sms:', 'magnet:'].includes(parsed.protocol)) {
        _e.preventDefault();
      } else if (!['http:', 'https:', 'file:', 'about:', 'chrome-extension:'].includes(parsed.protocol)) {
        _e.preventDefault();
      }
    } catch {
      _e.preventDefault();
    }
  });

  // Forward webview context-menu event to the parent renderer so the custom
  // ctx-menu HTML overlay is shown instead of Electron's built-in popup.
  contents.on('context-menu', (_e, params) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('webview-context-menu', {
      x: params.x,
      y: params.y,
      linkURL: params.linkURL || '',
      linkText: params.linkText || '',
      srcURL: params.srcURL || '',
      mediaType: params.mediaType || 'none',
      selectionText: params.selectionText || '',
      isEditable: params.isEditable || false,
      pageURL: params.pageURL || '',
    });
  });
});

