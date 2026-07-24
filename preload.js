'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Backward-compatible window controls for older renderer integrations ──────
contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  platform: process.platform,
  windowId: () => ipcRenderer.sendSync('get-window-id'),
  // Generic invoke wrapper for backward compatibility
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

// ── Full EtherX API (new features) ────────────────────────────────────────────
contextBridge.exposeInMainWorld('etherx', {

  openExternal: (url) => ipcRenderer.invoke('nav:openExternal', url),
  openAuthWindow: (url) => ipcRenderer.invoke('app:openAuthWindow', url),
  googleAuth: {
    login: () => ipcRenderer.invoke('googleAuth:login'),
  },

  // ── Window ──────────────────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
  },

  // ── Tabs (SQLite persistence) ────────────────────────────────────────────────
  tabs: {
    save: (tab) => ipcRenderer.invoke('db:saveTab', tab),
    getAll: () => ipcRenderer.invoke('db:getTabs'),
    delete: (tabId) => ipcRenderer.invoke('db:deleteTab', tabId),
    clearIncognito: (tabId) => ipcRenderer.invoke('db:clearIncognitoTab', tabId),
    updateOrder: (tabs) => ipcRenderer.invoke('db:updateTabOrder', tabs),
  },

  // ── Sessions ────────────────────────────────────────────────────────────────
  sessions: {
    save: (data) => ipcRenderer.invoke('db:saveSession', data),
    get: (limit) => ipcRenderer.invoke('db:getSessions', limit),
    delete: (id) => ipcRenderer.invoke('db:deleteSession', id),
  },

  // ── TikTok Live Chat AI local SQLite archive ───────────────────────────────
  tiktokLive: {
    install: () => ipcRenderer.invoke('db:installTikTokLiveStorage'),
    import: (data) => ipcRenderer.invoke('db:importTikTokLiveData', data),
    get: () => ipcRenderer.invoke('db:getTikTokLiveData'),
    getStatus: () => ipcRenderer.invoke('db:getTikTokLiveStorageStatus'),
  },

  // ── Downloads ───────────────────────────────────────────────────────────────
  downloads: {
    add: (data) => ipcRenderer.invoke('db:addDownload', data),
    get: (limit) => ipcRenderer.invoke('db:getDownloads', limit),
    delete: (id) => ipcRenderer.invoke('db:deleteDownload', id),
    clear: () => ipcRenderer.invoke('db:clearDownloads'),
  },

  // ── Notes ───────────────────────────────────────────────────────────────────
  notes: {
    add: (data) => ipcRenderer.invoke('db:addNote', data),
    get: () => ipcRenderer.invoke('db:getNotes'),
    update: (id, data) => ipcRenderer.invoke('db:updateNote', id, data),
    delete: (id) => ipcRenderer.invoke('db:deleteNote', id),
  },

  // ── User Profile ────────────────────────────────────────────────────────────
  userProfile: {
    get: () => ipcRenderer.invoke('db:getUserProfile'),
    save: (data) => ipcRenderer.invoke('db:saveUserProfile', data),
  },

  // ── History ─────────────────────────────────────────────────────────────────
  history: {
    add: (entry) => ipcRenderer.invoke('db:addHistory', entry),
    get: (opts) => ipcRenderer.invoke('db:getHistory', opts),
    getAll: () => ipcRenderer.invoke('db:getHistory', {}),
    clear: () => ipcRenderer.invoke('db:clearHistory'),
    clearRange: (from, to) => ipcRenderer.invoke('db:clearHistoryRange', from, to),
  },

  // ── Bookmarks ───────────────────────────────────────────────────────────────
  bookmarks: {
    add: (bm) => ipcRenderer.invoke('db:addBookmark', bm),
    getAll: () => ipcRenderer.invoke('db:getBookmarks'),
    delete: (id) => ipcRenderer.invoke('db:deleteBookmark', id),
    update: (bm) => ipcRenderer.invoke('db:updateBookmark', bm),
  },

  // ── Settings ─────────────────────────────────────────────────────────────────
  settings: {
    get: () => ipcRenderer.invoke('db:getSettings'),
    save: (s) => ipcRenderer.invoke('db:saveSettings', s),
    applyDoH: (enabled) => ipcRenderer.invoke('settings:applyDoH', enabled),
  },

  secrets: {
    getSettings: () => ipcRenderer.invoke('secrets:getSettings'),
    saveSettings: (values) => ipcRenderer.invoke('secrets:saveSettings', values),
    deleteSettings: (keys) => ipcRenderer.invoke('secrets:deleteSettings', keys),
  },

  secretStorage: {
    getItem: (key) => ipcRenderer.sendSync('secretStorage:getItem', key),
    setItem: (key, value) => ipcRenderer.sendSync('secretStorage:setItem', key, value),
    removeItem: (key) => ipcRenderer.sendSync('secretStorage:removeItem', key),
  },

  // ── Network Monitoring ───────────────────────────────────────────────────────
  network: {
    getLog: () => ipcRenderer.invoke('network:getLog'),
    clearLog: () => ipcRenderer.invoke('network:clearLog'),
    onUpdate: (callback) => {
      // Legacy single-entry listener (kept for compatibility)
      ipcRenderer.on('network-log', (_event, data) => callback(data));
      // Batched listener — main process now sends batches every 250ms
      ipcRenderer.on('network-log-batch', (_event, entries) => {
        if (Array.isArray(entries)) entries.forEach(e => callback(e));
      });
    },
  },

  // ── Passwords ────────────────────────────────────────────────────────────────
  passwords: {
    save: (site, user, encrypted) => ipcRenderer.invoke('passwords:save', site, user, encrypted),
    get: (site) => ipcRenderer.invoke('passwords:get', site),
    list: () => ipcRenderer.invoke('passwords:list'),
    delete: (id) => ipcRenderer.invoke('passwords:delete', id),
    setupVault: (masterPassword) => ipcRenderer.invoke('passwords:setupVault', masterPassword),
    unlockVault: (masterPassword) => ipcRenderer.invoke('passwords:unlockVault', masterPassword),
    lockVault: () => ipcRenderer.invoke('passwords:lockVault'),
    exportBitwarden: () => ipcRenderer.invoke('passwords:exportBitwarden'),
  },

  // ── AI ────────────────────────────────────────────────────────────────────────
  ai: {
    smartSearch: (query) => ipcRenderer.invoke('ai:smartSearch', query),
    checkPhishing: (url, content) => ipcRenderer.invoke('ai:checkPhishing', url, content),
    readingMode: (html) => ipcRenderer.invoke('ai:readingMode', html),
    groupTabs: (tabs) => ipcRenderer.invoke('ai:groupTabs', tabs),
    translate: (text, targetLang) => ipcRenderer.invoke('ai:translate', text, targetLang),
    guardianRequest: (payload) => ipcRenderer.invoke('ai:guardianRequest', payload),
    summarizePage: (url, html) => ipcRenderer.invoke('ai:summarizePage', url, html),
    installPythonDeps: () => ipcRenderer.invoke('ai:installPythonDeps'),
    getCachedSummaries: (limit) => ipcRenderer.invoke('db:getAiCache', limit),
    clearAiCache: () => ipcRenderer.invoke('db:clearAiCache'),
    detectBotUA: (ua) => ipcRenderer.invoke('ai:detectBotUA', ua),
    lookupIpGeo: (hostname) => ipcRenderer.invoke('ai:lookupIpGeo', hostname),
  },

  // ── Ad Blocker ────────────────────────────────────────────────────────────────
  adblock: {
    isEnabled: () => ipcRenderer.invoke('adblock:isEnabled'),
    toggle: (enabled) => ipcRenderer.invoke('adblock:toggle', enabled),
    stats: () => ipcRenderer.invoke('adblock:stats'),
  },

  // ── Security ──────────────────────────────────────────────────────────────────
  security: {
    getCertInfo: (url) => ipcRenderer.invoke('security:getCertInfo', url),
    getMalwareStats: () => ipcRenderer.invoke('security:getMalwareStats'),
    setMalwareBlock: (enabled) => ipcRenderer.invoke('security:setMalwareBlock', enabled),
  },

  // ── User Agent ────────────────────────────────────────────────────────────────
  userAgent: {
    get: () => ipcRenderer.invoke('ua:get'),
    set: (ua) => ipcRenderer.invoke('ua:set', ua),
  },

  // ── QR Sync ───────────────────────────────────────────────────────────────────
  qrSync: {
    generate: (data) => ipcRenderer.invoke('qrsync:generate', data),
    exportProfile: () => ipcRenderer.invoke('qrsync:exportProfile'),
    importProfile: (data) => ipcRenderer.invoke('qrsync:importProfile', data),
  },

  // ── Default Browser ───────────────────────────────────────────────────────────
  defaultBrowser: {
    check: () => ipcRenderer.invoke('defaultBrowser:check'),
    set: () => ipcRenderer.invoke('defaultBrowser:set'),
  },

  // ── i18n ──────────────────────────────────────────────────────────────────────
  i18n: {
    getStrings: (lang) => ipcRenderer.invoke('i18n:getStrings', lang),
    setLanguage: (lang) => ipcRenderer.invoke('i18n:setLanguage', lang),
    getAvailableLanguages: () => ipcRenderer.invoke('i18n:getAvailableLanguages'),
  },

  // ── License / Admin Lock ─────────────────────────────────────────────────────
  license: {
    getDeviceId: () => ipcRenderer.invoke('license:getDeviceId'),
    isAdminDevice: () => ipcRenderer.invoke('license:isAdminDevice'),
    debugAdminEnv: () => ipcRenderer.invoke('license:debugAdminEnv'),
    getTkaiValidHashes: () => ipcRenderer.invoke('license:getTkaiValidHashes'),
    getRuntimeEnvStatus: () => ipcRenderer.invoke('license:getRuntimeEnvStatus'),
    bootstrapRuntimeEnv: () => ipcRenderer.invoke('license:bootstrapRuntimeEnv'),
    saveTkaiApiConfig: (payload) => ipcRenderer.invoke('license:saveTkaiApiConfig', payload),
    validateTkaiCode: (code, hashrate) => ipcRenderer.invoke('license:validateTkaiCode', { code, hashrate }),
  },

  // ── Cast / Share ──────────────────────────────────────────────────────────────
  cast: { getDevices: () => ipcRenderer.invoke('cast:getDevices') },
  share: {
    shareUrl: (url, title) => ipcRenderer.invoke('share:shareUrl', url, title),
    savePageAs: (url, title) => ipcRenderer.invoke('share:savePageAs', url, title),
  },

  // ── Clipboard ─────────────────────────────────────────────────────────────────
  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read'),
  },

  // ── Cookies ───────────────────────────────────────────────────────────────────
  cookies: {
    getAll: (url) => ipcRenderer.invoke('cookies:getAll', url),
    remove: (url, name) => ipcRenderer.invoke('cookies:remove', url, name),
    clearAll: () => ipcRenderer.invoke('cookies:clearAll'),
  },

  // ── Navigation ────────────────────────────────────────────────────────────────
  nav: {
    openExternal: (url) => ipcRenderer.invoke('nav:openExternal', url),
  },

  // ── Update ────────────────────────────────────────────────────────────────────
  update: {
    saveToken: (token) => ipcRenderer.invoke('update:saveToken', token),
    hasToken: () => ipcRenderer.invoke('update:hasToken'),
    check: () => ipcRenderer.invoke('update:check'),
    download: (url, filename) => ipcRenderer.invoke('update:download', url, filename),
    install: (filePath) => ipcRenderer.invoke('update:install', filePath),
    deployFromGithub: () => ipcRenderer.invoke('update:deployFromGithub'),
    onProgress: (callback) => ipcRenderer.on('update:progress', (_e, data) => callback(data)),
    isPackaged: () => ipcRenderer.invoke('app:isPackaged'),
  },

  extensions: {
    chooseFolder: () => ipcRenderer.invoke('extensions:chooseFolder'),
    loadUnpacked: (extensionPath) => ipcRenderer.invoke('extensions:loadUnpacked', extensionPath),
    downloadFromCWS: (extId) => ipcRenderer.invoke('extensions:downloadFromCWS', extId),
    getBuiltinLiveOsPlugin: () => ipcRenderer.invoke('extensions:getBuiltinLiveOsPlugin'),
  },

  // ── Shell (file/folder operations) ───────────────────────────────────────────
  shell: {
    showItemInFolder: (fullPath) => ipcRenderer.invoke('shell:showItemInFolder', fullPath),
    openPath: (fullPath) => ipcRenderer.invoke('shell:openPath', fullPath),
  },

  // ── SongRec (local song recognition CLI) ───────────────────────────────────
  songrec: {
    recognize: (options) => ipcRenderer.invoke('songrec:recognize', options),
    listOutputs: () => ipcRenderer.invoke('songrec:listOutputs'),
  },

  // ── App ───────────────────────────────────────────────────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getAppPath: () => ipcRenderer.invoke('app:getAppPath'),
    getDownloadsPath: () => ipcRenderer.invoke('app:getDownloadsPath'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
    openApplePasswords: () => ipcRenderer.invoke('app:openApplePasswords'),
    openSettings: () => ipcRenderer.send('app:openSettings'),
    chooseIcon: () => ipcRenderer.invoke('app:chooseIcon'),
    setIcon: (filePath) => ipcRenderer.invoke('app:setIcon', filePath),
    getProcessMetrics: () => ipcRenderer.invoke('app:getProcessMetrics'),
    resetIcon: () => ipcRenderer.invoke('app:resetIcon'),
    chooseScreenshotFolder: () => ipcRenderer.invoke('app:chooseScreenshotFolder'),
    chooseProfilePicture: () => ipcRenderer.invoke('app:chooseProfilePicture'),
    runOneClickSetup: () => ipcRenderer.invoke('app:runOneClickSetup'),
    installWhisperLive: (mode) => ipcRenderer.invoke('app:installWhisperLive', mode),
    refreshWhisperLiveModelCache: () => ipcRenderer.invoke('app:refreshWhisperLiveModelCache'),
    getWhisperLiveModelCache: () => ipcRenderer.invoke('app:getWhisperLiveModelCache'),
    getPM2Status: () => ipcRenderer.invoke('app:getPM2Status'),
    getPM2Logs: () => ipcRenderer.invoke('app:getPM2Logs'),
    clearPM2Logs: () => ipcRenderer.invoke('app:clearPM2Logs'),
    stopPM2Process: () => ipcRenderer.invoke('app:stopPM2Process'),
    ensurePM2Process: () => ipcRenderer.invoke('app:ensurePM2Process'),
  },

  storage: {
    getSnapshot: () => ipcRenderer.sendSync('storage:getSnapshot'),
    setItem: (key, value) => ipcRenderer.sendSync('storage:setItem', key, value),
    removeItem: (key) => ipcRenderer.sendSync('storage:removeItem', key),
    clear: () => ipcRenderer.sendSync('storage:clear'),
  },

  liveos: {
    publishSnapshot: (snapshot) => ipcRenderer.invoke('liveos:publishSnapshot', snapshot),
    getSnapshot: () => ipcRenderer.invoke('liveos:getSnapshot'),
  },

  // ── DevTools ──────────────────────────────────────────────────────────────────
  devtools: {
    toggle: () => ipcRenderer.send('devtools:toggle'),
  },

  // ── Event listeners ───────────────────────────────────────────────────────────
  on: (channel, fn) => {
    const allowed = ['open-url', 'phishing-warning', 'adblock-update', 'webview-context-menu', 'download-update', 'app:createTab', 'update:progress', 'network-log-batch', 'liveos:command'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, ...a) => fn(...a));
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn),
});
