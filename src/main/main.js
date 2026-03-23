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
const https = require('https');
const AdmZip = require('adm-zip');
const { execFile } = require('child_process');

// ─── Command-line switches ─────────────────────────────────────────────────────
// disable-gpu kills rendering on macOS (blank window on Apple Silicon + Intel Rosetta)
// Only apply on Linux headless/CI environments (not on regular desktop)
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const isHeadless = process.env.DISPLAY === undefined && process.platform === 'linux';

if (process.platform !== 'darwin') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');

  // Disable GPU only in CI/headless environments — on desktop keep GPU enabled for WebGL2
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
// Prevent GPU sandbox from crashing the renderer (fixes launch-failed / exit 1003)
app.commandLine.appendSwitch('disable-gpu-sandbox');

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

// Ekstenzije datoteka koje mogu biti nosič zlonamjernog koda
const DANGEROUS_EXTS = new Set([
  '.exe', '.msi', '.msp', '.msix', '.msixbundle',
  '.bat', '.cmd', '.ps1', '.psm1', '.psd1',
  '.vbs', '.vbe', '.jse', '.hta', '.wsf', '.wsh',
  '.scr', '.pif', '.reg', '.cpl',
  '.jar', '.jnlp',
]);

// EtherX Shield — runtime flags (changed via IPC from renderer)
let _shieldBlockScripts = false;

function setupDownloadTracking(ses) {
  if (!ses || _downloadTrackedSessions.has(ses)) return;
  _downloadTrackedSessions.add(ses);
  ses.on('will-download', (_event, item, webContents) => {
    // ── Upozorenje za potencijalno opasne datoteke ──────────────────────────
    const s = db ? db.getSettings() : {};
    if (s.warnDangerousDownloads !== false) {
      const ext = path.extname(item.getFilename()).toLowerCase();
      if (DANGEROUS_EXTS.has(ext)) {
        const parentWin = BrowserWindow.fromWebContents(webContents) || mainWindow;
        const choice = dialog.showMessageBoxSync(parentWin, {
          type: 'warning',
          title: 'EtherX — Opasna datoteka',
          message: `⚠️  Potencijalno opasna datoteka`,
          detail: `"${item.getFilename()}" (${ext.toUpperCase()}) može sadržavati zlonamjerni kôd ili virus.\n\nIzvor: ${item.getURL().slice(0, 100)}\n\nNastavi samo ako vjeruješ ovom izvoru.`,
          buttons: ['Otkaži preuzimanje', 'Preuzmi svejedno'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (choice === 0) {
          item.cancel();
          return;
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────
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

  // Enable third-party cookies for better web compatibility
  try {
    session.defaultSession.cookies.on('changed', () => { });
    // Allow third-party cookies by setting webSecurity: false in webPreferences
    // This is already set in createWindow but ensures session-wide compatibility
  } catch (e) { console.error('❌ Cookie setup failed:', e.message); }

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

  // ── Apply same UA cleaning and header fixes to webview (persist:etherx) session ──
  // Webviews use a separate Electron session (persist:etherx) that doesn't inherit
  // the interceptors above. Without this, webviews send the raw Electron UA which
  // causes some sites (e.g. WordPress with security plugins) to serve blank pages.
  const etherxSession = session.fromPartition('persist:etherx');

  etherxSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      const key = Object.keys(headers).find(k => k.toLowerCase() === 'user-agent');
      if (key) {
        let ua = headers[key]
          .replace(/\s*Electron\/[\d.]+/gi, '')
          .replace(/\s*EtherX\/[\d.]+/gi, '')
          .trim();
        const url = details.url || '';
        if (/google\.com|googleapis\.com|accounts\.google/i.test(url)) {
          ua = GOOGLE_UA;
          delete headers['X-Requested-With'];
        }
        headers[key] = ua || CLEAN_UA;
      }
      delete headers['Origin'];
      delete headers['Referer'];
      callback({ requestHeaders: headers });
    }
  );

  etherxSession.webRequest.onHeadersReceived(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      delete headers['access-control-allow-origin'];
      delete headers['Access-Control-Allow-Origin'];
      headers['Access-Control-Allow-Origin'] = ['*'];
      headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
      headers['Access-Control-Allow-Headers'] = ['*'];
      headers['Access-Control-Allow-Credentials'] = ['true'];
      delete headers['x-frame-options'];
      delete headers['X-Frame-Options'];
      delete headers['content-security-policy'];
      delete headers['Content-Security-Policy'];
      delete headers['content-security-policy-report-only'];
      // EtherX Shield: Block Scripts mode — prevent all JS execution
      if (_shieldBlockScripts) {
        headers['Content-Security-Policy'] = ["script-src 'none'"];
      }
      callback({ responseHeaders: headers });
    }
  );

  // ── Malware domain blocker za webview session (persist:etherx) ─────────────
  try {
    if (AdBlocker) {
      AdBlocker._malwareStats = AdBlocker.applyMalwareFilter(etherxSession);
      // Apply stored setting: if user disabled the filter, honour that on startup
      if (AdBlocker._malwareStats && db) {
        const _ms = db.getSettings();
        if (_ms.malwareBlockEnabled === false) AdBlocker._malwareStats.enabled = false;
        // Shield: apply stored shieldMode — disable adblock if mode is 'disable'
        if (_ms.shieldMode === 'disable') {
          AdBlocker._malwareStats.enabled = false;
          if (adBlocker) adBlocker.toggle(false);
        }
        // Shield: Block Scripts setting
        if (_ms.blockScriptsEnabled === true) _shieldBlockScripts = true;
      }
    }
  } catch (e) { console.error('[MalwareBlocker] Setup failed:', e.message); }

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
  let _rendererRestarts = 0;
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    console.error('❌ render-process-gone:', details.reason, details.exitCode);
    // Auto-recover from launch-failed / crashed — retry up to 3 times
    if (_rendererRestarts < 3 && (details.reason === 'launch-failed' || details.reason === 'crashed')) {
      _rendererRestarts++;
      console.log(`🔄 Attempting renderer restart ${_rendererRestarts}/3...`);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload();
        }
      }, 1000 * _rendererRestarts);
    } else {
      dialog.showErrorBox('EtherX: Renderer Crashed', `Reason: ${details.reason}\nExit: ${details.exitCode}`);
    }
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
        const win = new BrowserWindow({
          width: 1280, height: 800, backgroundColor: '#1a1a2e', titleBarStyle: 'hidden',
          webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, sandbox: false },
        });
        setupDownloadTracking(win.webContents.session);
        win.loadFile(path.join(__dirname, 'src', 'index.html'), { hash: 'fresh-window' });
      }
    },
    {
      label: 'New Private Window', click: () => {
        const win = new BrowserWindow({
          width: 1280, height: 800, backgroundColor: '#0d0d1a', titleBarStyle: 'hidden',
          webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, sandbox: false, partition: 'incognito-' + Date.now() },
        });
        setupDownloadTracking(win.webContents.session);
        win.loadFile(path.join(__dirname, 'src', 'index.html'), { hash: 'fresh-window' });
        win.webContents.on('did-finish-load', () => {
          win.webContents.executeJavaScript(`
            STATE.isPrivate = true;
            document.getElementById('privateIndicator').style.display = '';
            document.body.style.filter = 'hue-rotate(240deg) saturate(0.8)';
            document.title = 'EtherX (Private)';
          `).catch(() => { });
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
    // Support both camelCase (geminiApiKey) and snake_case (gemini_api_key) storage
    const geminiKey = settings.geminiApiKey || settings.gemini_api_key || process.env.GEMINI_API_KEY || '';
    return ai.summarizePage(url, htmlContent, geminiKey, db);
  });

  // ── AI: Cache Data for Developer Tools ────────────────────────────────────
  ipcMain.handle('ai:getCachedSummaries', (_e, limit = 100) => db ? db.getAiCache(limit) : []);
  ipcMain.handle('ai:clearAiCache', () => db ? db.clearAiCache() : { ok: true });

  // ── AI: Bot/UA detection ───────────────────────────────────────────────────
  ipcMain.handle('ai:detectBotUA', (_e, ua) => ai ? ai.detectBotUA(ua) : { isBot: false, isIAB: false, reasons: [] });

  // ── AI: IP Geolocation lookup ──────────────────────────────────────────────
  ipcMain.handle('ai:lookupIpGeo', (_e, hostname) => ai ? ai.lookupIpGeo(hostname) : { ok: false, error: 'AI not available' });

  // ── Ad Blocker ─────────────────────────────────────────────────────────────
  ipcMain.handle('adblock:isEnabled', () => adBlocker ? adBlocker.isEnabled() : false);
  ipcMain.handle('adblock:toggle', (_e, enabled) => adBlocker ? adBlocker.toggle(enabled) : noDb());
  ipcMain.handle('adblock:stats', () => adBlocker ? adBlocker.getStats() : { blocked: 0 });

  // ── Security ───────────────────────────────────────────────────────────────
  ipcMain.handle('security:getCertInfo', (_e, url) => SecurityManager ? SecurityManager.getCertInfo(url) : null);
  ipcMain.handle('security:getMalwareStats', () => AdBlocker ? AdBlocker._malwareStats || { blocked: 0, domains: 0 } : { blocked: 0, domains: 0 });
  ipcMain.handle('security:setMalwareBlock', (_e, enabled) => {
    if (AdBlocker?._malwareStats) AdBlocker._malwareStats.enabled = !!enabled;
    return { ok: true };
  });

  // ── EtherX Shield ──────────────────────────────────────────────────────────
  ipcMain.handle('shield:setBlockScripts', (_e, enabled) => {
    _shieldBlockScripts = !!enabled;
    return { ok: true };
  });

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
  ipcMain.handle('nav:openExternal', (_e, url) => shell.openExternal(url));
  ipcMain.handle('shell:showItemInFolder', (_e, fullPath) => { shell.showItemInFolder(fullPath); return { ok: true }; });
  ipcMain.handle('shell:openPath', (_e, fullPath) => shell.openPath(fullPath).then(err => ({ ok: !err, error: err })));
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

  ipcMain.handle('extensions:downloadFromCWS', async (_e, extId) => {
    try {
      const userDataDir = app.getPath('userData');
      const extDir = path.join(userDataDir, 'extensions');
      if (!fs.existsSync(extDir)) fs.mkdirSync(extDir, { recursive: true });

      const crxFile = path.join(extDir, `${extId}.crx`);
      const extractDir = path.join(extDir, extId);
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });

      const downloadUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=114.0.5735.90&acceptformat=crx2,crx3&x=id%3D${extId}%26uc`;

      await new Promise((resolve, reject) => {
        function doDownload(url, dest) {
          https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
              return doDownload(res.headers.location, dest);
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`CWS responded with HTTP ${res.statusCode}`));
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error', (err) => {
              fs.unlink(dest, () => { });
              reject(err);
            });
          }).on('error', reject);
        }
        doDownload(downloadUrl, crxFile);
      });

      // A CRX file is just a ZIP with a custom header.
      // We need to find the start of the ZIP archive (PK\x03\x04).
      const buffer = fs.readFileSync(crxFile);
      let zipStart = -1;
      for (let i = 0; i < buffer.length - 4; i++) {
        if (buffer[i] === 0x50 && buffer[i + 1] === 0x4B && buffer[i + 2] === 0x03 && buffer[i + 3] === 0x04) {
          zipStart = i;
          break;
        }
      }

      if (zipStart === -1) {
        throw new Error('Could not find ZIP header in CRX file. It might be corrupt or an unsupported format.');
      }

      const zipBuffer = buffer.slice(zipStart);
      const zipPath = path.join(extDir, `${extId}.zip`);
      fs.writeFileSync(zipPath, zipBuffer);

      // Extract ZIP
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);

      // Cleanup temp files
      fs.unlinkSync(crxFile);
      fs.unlinkSync(zipPath);

      // Load it into Electron
      const ext = await session.defaultSession.loadExtension(extractDir, { allowFileAccess: true });
      return { ok: true, id: ext.id, name: ext.name, version: ext.version, path: extractDir };

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

    // Load with fresh-window flag to start empty
    win.loadFile(path.join(__dirname, 'src', 'index.html'), {
      hash: url ? 'new-window=' + encodeURIComponent(url) : 'fresh-window'
    });

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
    // Load with a hash flag so restoreSession() in the renderer skips
    // restoring the previous session and opens only this single moved tab.
    win.loadFile(path.join(__dirname, 'src', 'index.html'), {
      hash: 'move-tab=' + encodeURIComponent(url || ''),
    });
    return { ok: true };
  });

  // ── Split Screen ───────────────────────────────────────────────────────────
  ipcMain.handle('app:splitScreen', (_e, currentTabUrl) => {
    const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const halfW = Math.floor(width / 2);
    const makeWin = (x, url, isLeft = false) => {
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

      // Left window gets current tab, right window starts empty
      if (isLeft && url) {
        w.loadFile(path.join(__dirname, 'src', 'index.html'), {
          hash: 'split-left=' + encodeURIComponent(url)
        });
      } else {
        w.loadFile(path.join(__dirname, 'src', 'index.html'));
      }
      return w;
    };

    // Create left window with current tab, right window empty
    makeWin(0, currentTabUrl, true);
    makeWin(halfW, null, false);
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

  // ── Auto-update (GitHub Releases) ─────────────────────────────────────────
  // Token is stored ONLY in SQLite — never returned to the renderer.
  ipcMain.handle('update:saveToken', (_e, token) => {
    if (!db) return { ok: false, error: 'DB not ready' };
    db.saveSettings({ ...db.getSettings(), githubUpdateToken: token.trim() });
    return { ok: true };
  });
  ipcMain.handle('update:hasToken', () => {
    if (!db) return false;
    const s = db.getSettings();
    return !!(s.githubUpdateToken && s.githubUpdateToken.length > 0);
  });
  ipcMain.handle('update:check', async () => {
    try {
      const s = db ? db.getSettings() : {};
      const giteaToken = s.giteaUpdateToken || '';
      const githubToken = s.githubUpdateToken || '';
      const { net } = require('electron');

      // ── Pomoćna funkcija za dohvat najnovijeg izdanja ──────────────────────
      function fetchRelease(apiUrl, token, authScheme) {
        return new Promise((resolve) => {
          const headers = { 'User-Agent': 'EtherX-Browser', 'Accept': 'application/json' };
          if (token) headers['Authorization'] = authScheme + ' ' + token;
          const req = net.request({ method: 'GET', url: apiUrl, headers });
          let body = '';
          req.on('response', (res) => {
            res.on('data', (chunk) => { body += chunk.toString(); });
            res.on('end', () => {
              if (res.statusCode === 404 || res.statusCode === 410) {
                resolve({ ok: false, error: 'Nema objavljenih verzija' }); return;
              }
              if (res.statusCode !== 200) {
                resolve({ ok: false, error: 'API greška: HTTP ' + res.statusCode }); return;
              }
              try {
                const data = JSON.parse(body);
                const latest = (data.tag_name || '').replace(/^v/, '');
                const current = app.getVersion();
                const assets = (data.assets || []).map(a => ({ name: a.name, url: a.browser_download_url || '', size: a.size }));
                resolve({
                  ok: true, current, latest,
                  isNew: latest !== current && latest > current,
                  name: data.name || data.tag_name,
                  body: data.body || '',
                  assets,
                  publishedAt: data.published_at || '',
                });
              } catch (e) { resolve({ ok: false, error: 'Parse error: ' + e.message }); }
            });
          });
          req.on('error', (e) => resolve({ ok: false, error: e.message }));
          req.end();
        });
      }

      // ── Provjeri Gitea (primarna), pa GitHub (fallback) ────────────────────
      const GITEA_API = 'https://git.kasp.top/api/v1/repos/ktrucek/etherx-standalone/releases/latest';
      const GITHUB_API = 'https://api.github.com/repos/ktrucek/etherx-standalone/releases/latest';

      let result = await fetchRelease(GITEA_API, giteaToken, 'token');
      if (!result.ok) {
        result = await fetchRelease(GITHUB_API, githubToken, 'Bearer');
      }
      return result;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Download an update asset to temp, sending progress to renderer
  ipcMain.handle('update:download', async (_e, url, filename) => {
    try {
      const os = require('os');
      const tmpDir = path.join(os.tmpdir(), 'etherx-update');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const dest = path.join(tmpDir, filename);
      if (fs.existsSync(dest)) fs.unlinkSync(dest);

      const { net } = require('electron');
      const s = db ? db.getSettings() : {};
      const token = s.giteaUpdateToken || s.githubUpdateToken || '';

      await new Promise((resolve, reject) => {
        const headers = { 'User-Agent': 'EtherX-Browser', 'Accept': 'application/octet-stream' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const req = net.request({ method: 'GET', url, headers, redirect: 'follow' });
        req.on('response', (res) => {
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            const rUrl = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
            const req2 = net.request({ method: 'GET', url: rUrl });
            req2.on('response', (res2) => handleResponse(res2));
            req2.on('error', reject);
            req2.end();
            return;
          }
          handleResponse(res);
        });
        req.on('error', reject);
        req.end();

        function handleResponse(res) {
          if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
          const total = parseInt(res.headers['content-length'] || '0', 10);
          let received = 0;
          const ws = fs.createWriteStream(dest);
          let lastProgress = 0;
          res.on('data', (chunk) => {
            ws.write(chunk);
            received += chunk.length;
            const pct = total > 0 ? Math.round((received / total) * 100) : -1;
            if (pct !== lastProgress) {
              lastProgress = pct;
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update:progress', { percent: pct, received, total, filename });
              }
            }
          });
          res.on('end', () => { ws.end(() => resolve()); });
          res.on('error', (err) => { ws.destroy(); reject(err); });
        }
      });

      return { ok: true, filePath: dest, filename };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('update:install', async (_e, filePath) => {
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: 'Datoteka ne postoji' };
      const ext = path.extname(filePath).toLowerCase();

      if (process.platform === 'darwin') {
        await shell.openPath(filePath);
        setTimeout(() => app.quit(), 1500);
      } else if (process.platform === 'linux') {
        if (ext === '.appimage') {
          fs.chmodSync(filePath, 0o755);
          const { spawn } = require('child_process');
          spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref();
          setTimeout(() => app.quit(), 1000);
        } else if (ext === '.deb') {
          shell.showItemInFolder(filePath);
          dialog.showMessageBox(mainWindow, {
            type: 'info', title: 'EtherX Update',
            message: 'DEB paket je preuzet.',
            detail: `Instaliraj s:\nsudo dpkg -i "${path.basename(filePath)}"`,
            buttons: ['OK'],
          });
        } else {
          await shell.openPath(filePath);
        }
      } else {
        await shell.openPath(filePath);
        setTimeout(() => app.quit(), 1500);
      }

      return { ok: true };
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
      transparent: true,
      backgroundColor: '#00000000', // transparent
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
  // Gracefully handle load failures in webviews (guest views) to prevent
  // uncaught "Error invoking remote method 'GUEST_VIEW_MANAGER_CALL'" errors
  contents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) return; // ERR_ABORTED — normal during navigation
    if (!isMainFrame) return; // Only handle main frame failures
    console.warn(`[webContents] did-fail-load: ${errorCode} ${errorDescription} — ${validatedURL}`);
  });

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

  // Handle new windows opening (popups, mailto, etc)
  contents.setWindowOpenHandler((details) => {
    try {
      const parsedUrl = new URL(details.url);

      // Block specific external app protocols that normally open outside the browser
      if (['mailto:', 'tel:', 'sms:', 'facetime:', 'skype:', 'zoom:', 'magnet:', 'sip:'].includes(parsedUrl.protocol)) {
        return { action: 'deny' };
      }

      // Open valid http/https URLs within the app (as a new tab, handled by the renderer)
      // We deny window creation here so it doesn't spawn a new unmanaged Electron BrowserWindow
      // The renderer handles opening new tabs via target="_blank"
      if (['http:', 'https:', 'about:', 'chrome-extension:'].includes(parsedUrl.protocol)) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // Tell renderer to open this URL in a new tab instead
          mainWindow.webContents.send('app:createTab', details.url);
        }
        return { action: 'deny' };
      }
    } catch (_) { }

    // Deny anything else
    return { action: 'deny' };
  });

  // Also prevent 'will-navigate' from opening external apps like mailto
  contents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      if (['mailto:', 'tel:', 'sms:', 'facetime:', 'skype:', 'zoom:', 'magnet:', 'sip:'].includes(parsed.protocol)) {
        event.preventDefault();
      } else if (!['http:', 'https:', 'file:', 'about:', 'chrome-extension:'].includes(parsed.protocol)) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
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

