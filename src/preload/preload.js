'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Backward-compatible window controls (keep existing browser.js working) ────
contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  platform: process.platform,
  // Generic invoke wrapper for backward compatibility
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

// ── Full EtherX API (new features) ────────────────────────────────────────────
contextBridge.exposeInMainWorld('etherx', {

  openExternal: (url) => ipcRenderer.invoke('nav:openExternal', url),

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
  },

  // ── Network Monitoring ───────────────────────────────────────────────────────
  network: {
    getLog: () => ipcRenderer.invoke('network:getLog'),
    clearLog: () => ipcRenderer.invoke('network:clearLog'),
    onUpdate: (callback) => {
      ipcRenderer.on('network-log', (_event, data) => callback(data));
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
    summarizePage: (url, html) => ipcRenderer.invoke('ai:summarizePage', url, html),
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
  },

  // ── Shell ─────────────────────────────────────────────────────────────────────
  shell: {
    showItemInFolder: (path) => ipcRenderer.invoke('shell:showItemInFolder', path),
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  },

  extensions: {
    chooseFolder: () => ipcRenderer.invoke('extensions:chooseFolder'),
    loadUnpacked: (extensionPath) => ipcRenderer.invoke('extensions:loadUnpacked', extensionPath),
  },

  // ── App ───────────────────────────────────────────────────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
    openApplePasswords: () => ipcRenderer.invoke('app:openApplePasswords'),
    openSettings: () => ipcRenderer.send('app:openSettings'),
    chooseIcon: () => ipcRenderer.invoke('app:chooseIcon'),
    setIcon: (filePath) => ipcRenderer.invoke('app:setIcon', filePath),
    resetIcon: () => ipcRenderer.invoke('app:resetIcon'),
    chooseScreenshotFolder: () => ipcRenderer.invoke('app:chooseScreenshotFolder'),
    chooseProfilePicture: () => ipcRenderer.invoke('app:chooseProfilePicture'),
  },

  // ── DevTools ──────────────────────────────────────────────────────────────────
  devtools: {
    toggle: () => ipcRenderer.send('devtools:toggle'),
  },

  // ── Event listeners ───────────────────────────────────────────────────────────
  on: (channel, fn) => {
    const allowed = ['open-url', 'phishing-warning', 'adblock-update', 'webview-context-menu', 'download-update'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, ...a) => fn(...a));
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn),
});
