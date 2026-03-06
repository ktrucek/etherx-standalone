/**
 * EtherX Browser — Preload Script
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 *
 * Exposes a safe, typed API to the renderer via contextBridge.
 * Node.js APIs are NEVER directly exposed. All calls go through
 * typed IPC handlers.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─── Safe IPC bridge ─────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('etherx', {
  // ── Window ───────────────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    devTools: () => ipcRenderer.send('devtools:toggle'),
  },

  // ── Tabs (SQLite-backed, never incognito) ─────────────────────────────────
  tabs: {
    save: (tab) => ipcRenderer.invoke('db:saveTab', tab),
    getAll: () => ipcRenderer.invoke('db:getTabs'),
    delete: (id) => ipcRenderer.invoke('db:deleteTab', id),
    clearInc: (id) => ipcRenderer.invoke('db:clearIncognitoTab', id),
    updateOrder: (tabs) => ipcRenderer.invoke('db:updateTabOrder', tabs),
  },

  // ── History ───────────────────────────────────────────────────────────────
  history: {
    add: (entry) => ipcRenderer.invoke('db:addHistory', entry),
    get: (opts) => ipcRenderer.invoke('db:getHistory', opts),
    getAll: () => ipcRenderer.invoke('db:getHistory', { limit: 100 }),
    clear: () => ipcRenderer.invoke('db:clearHistory'),
    clearRange: (from, to) => ipcRenderer.invoke('db:clearHistoryRange', from, to),
  },

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  bookmarks: {
    add: (bm) => ipcRenderer.invoke('db:addBookmark', bm),
    getAll: () => ipcRenderer.invoke('db:getBookmarks'),
    delete: (id) => ipcRenderer.invoke('db:deleteBookmark', id),
    update: (bm) => ipcRenderer.invoke('db:updateBookmark', bm),
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get: () => ipcRenderer.invoke('db:getSettings'),
    save: (s) => ipcRenderer.invoke('db:saveSettings', s),
  },

  // ── Passwords ─────────────────────────────────────────────────────────────
  passwords: {
    save: (site, username, enc) => ipcRenderer.invoke('passwords:save', site, username, enc),
    get: (site) => ipcRenderer.invoke('passwords:get', site),
    list: () => ipcRenderer.invoke('passwords:list'),
    delete: (id) => ipcRenderer.invoke('passwords:delete', id),
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  ai: {
    smartSearch: (q) => ipcRenderer.invoke('ai:smartSearch', q),
    checkPhishing: (url, html) => ipcRenderer.invoke('ai:checkPhishing', url, html),
    readingMode: (html) => ipcRenderer.invoke('ai:readingMode', html),
    groupTabs: (tabs) => ipcRenderer.invoke('ai:groupTabs', tabs),
    translate: (text, lang) => ipcRenderer.invoke('ai:translate', text, lang),
    // ── Page summarization (GPT-4o-mini + SQLite cache) ─────────────────────
    summarizePage: (url, html) => ipcRenderer.invoke('ai:summarizePage', url, html),
    getCachedSummaries: (limit) => ipcRenderer.invoke('ai:getCachedSummaries', limit),
    clearAiCache: () => ipcRenderer.invoke('ai:clearAiCache'),
    pruneAiCache: (days) => ipcRenderer.invoke('ai:pruneAiCache', days),
  },

  // ── Ad Blocker ────────────────────────────────────────────────────────────
  adblock: {
    isEnabled: () => ipcRenderer.invoke('adblock:isEnabled'),
    toggle: (enabled) => ipcRenderer.invoke('adblock:toggle', enabled),
    stats: () => ipcRenderer.invoke('adblock:stats'),
  },

  // ── Security ─────────────────────────────────────────────────────────────
  security: {
    getCertInfo: (url) => ipcRenderer.invoke('security:getCertInfo', url),
  },

  // ── User Agent ────────────────────────────────────────────────────────────
  ua: {
    get: () => ipcRenderer.invoke('ua:get'),
    set: (ua) => ipcRenderer.invoke('ua:set', ua),
  },

  // ── QR Sync ──────────────────────────────────────────────────────────────
  qrsync: {
    generate: (data) => ipcRenderer.invoke('qrsync:generate', data),
    exportProfile: () => ipcRenderer.invoke('qrsync:exportProfile'),
    importProfile: (data) => ipcRenderer.invoke('qrsync:importProfile', data),
  },

  // ── Default Browser ───────────────────────────────────────────────────────
  defaultBrowser: {
    check: () => ipcRenderer.invoke('defaultBrowser:check'),
    set: () => ipcRenderer.invoke('defaultBrowser:set'),
  },

  // ── i18n ─────────────────────────────────────────────────────────────────
  i18n: {
    getStrings: (lang) => ipcRenderer.invoke('i18n:getStrings', lang),
    setLanguage: (lang) => ipcRenderer.invoke('i18n:setLanguage', lang),
    getAvailableLanguages: () => ipcRenderer.invoke('i18n:getAvailableLanguages'),
  },

  // ── Cast / Share ──────────────────────────────────────────────────────────
  cast: {
    getDevices: () => ipcRenderer.invoke('cast:getDevices'),
  },
  share: {
    url: (url, title) => ipcRenderer.invoke('share:shareUrl', url, title),
    saveAs: (url, title) => ipcRenderer.invoke('share:savePageAs', url, title),
  },

  // ── Clipboard ────────────────────────────────────────────────────────────
  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    read: () => ipcRenderer.invoke('clipboard:read'),
  },

  // ── App ──────────────────────────────────────────────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
    openExternal: (url) => ipcRenderer.invoke('nav:openExternal', url),
    chooseIcon: () => ipcRenderer.invoke('app:chooseIcon'),
    setIcon: (filePath) => ipcRenderer.invoke('app:setIcon', filePath),
    resetIcon: () => ipcRenderer.invoke('app:resetIcon'),
  },

  // ── Event listeners from main ─────────────────────────────────────────────
  on: (channel, fn) => {
    const ALLOWED = ['open-url', 'tab-navigate', 'phishing-alert'];
    if (ALLOWED.includes(channel)) {
      ipcRenderer.on(channel, (_e, ...args) => fn(...args));
    }
  },
  off: (channel, fn) => {
    ipcRenderer.removeListener(channel, fn);
  },
});
