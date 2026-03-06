/**
 * EtherX Browser — Database Manager (SQLite)
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 *
 * Stores: Bookmarks, History, Tabs (URL, Title, Order, IsActive, ScrollPosition),
 * Settings. Incognito data is NEVER written here — it lives in RAM only.
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

class DatabaseManager {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, 'etherx.db');
    this.db = null;
  }

  init() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');    // faster writes
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('cache_size = 4096');
    this._migrate();
    return Promise.resolve();
  }

  // ─── Schema Migrations ─────────────────────────────────────────────────────

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      );
    `);

    const row = this.db.prepare('SELECT version FROM schema_version').get();
    const currentVersion = row ? row.version : 0;

    if (currentVersion < 1) {
      this.db.exec(`
        -- ── Tabs ──────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS tabs (
          id            TEXT    PRIMARY KEY,
          url           TEXT    NOT NULL DEFAULT 'etherx://newtab',
          title         TEXT    NOT NULL DEFAULT 'New Tab',
          favicon        TEXT    DEFAULT '',
          tab_order     INTEGER NOT NULL DEFAULT 0,
          is_active     INTEGER NOT NULL DEFAULT 0,  -- boolean: 1 = active
          scroll_x      INTEGER NOT NULL DEFAULT 0,  -- horizontal scroll
          scroll_y      INTEGER NOT NULL DEFAULT 0,  -- vertical scroll
          is_pinned     INTEGER NOT NULL DEFAULT 0,
          group_name    TEXT    DEFAULT NULL,         -- AI tab group label
          created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- ── History ───────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS history (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          url           TEXT    NOT NULL,
          title         TEXT    NOT NULL DEFAULT '',
          favicon        TEXT    DEFAULT '',
          visit_count   INTEGER NOT NULL DEFAULT 1,
          last_visited  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_history_url        ON history(url);
        CREATE INDEX IF NOT EXISTS idx_history_last_visit ON history(last_visited DESC);

        -- ── Bookmarks ─────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS bookmarks (
          id            TEXT    PRIMARY KEY,
          url           TEXT    NOT NULL,
          title         TEXT    NOT NULL DEFAULT '',
          favicon        TEXT    DEFAULT '',
          folder        TEXT    DEFAULT 'Bookmarks Bar',
          description   TEXT    DEFAULT '',
          created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder);

        -- ── Settings ──────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        -- ── Default settings ──────────────────────────────────────────────────
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('language',        'hr'),
          ('theme',           'dark'),
          ('adblock_enabled', 'true'),
          ('tls_enforce',     'true'),
          ('user_agent',      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 EtherX/1.0'),
          ('ai_enabled',      'true'),
          ('gemini_api_key',  'AIzaSyB5-ti6N33oOzMlt6BnGoh2u3Fr-UEkG2A'),
          ('homepage',        'etherx://newtab'),
          ('zoom',            '100'),
          ('downloads_path',  '');

        INSERT OR REPLACE INTO schema_version (version) VALUES (1);
      `);
    }

    // ── Migration v2: AI Cache ─────────────────────────────────────────────
    if (currentVersion < 2) {
      this.db.exec(`
        -- ── AI Page Summary Cache ────────────────────────────────────────────
        -- Key: MD5 hex of the original URL (so same URL never hits the API twice)
        CREATE TABLE IF NOT EXISTS ai_cache (
          url_hash     TEXT    PRIMARY KEY,
          url          TEXT    NOT NULL,
          summary      TEXT    NOT NULL,
          model        TEXT    NOT NULL DEFAULT 'gemini-2.5-flash',
          created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          last_used    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- ── Passwords (metadata only — blobs live in etherx_passwords.db) ───
        -- This table is intentionally empty; PasswordManager uses its own DB.
        -- Kept here as a reference schema matching the original design spec.
        CREATE TABLE IF NOT EXISTS passwords_meta (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          site         TEXT    NOT NULL,
          username     TEXT    NOT NULL DEFAULT '',
          vault_ref    TEXT    NOT NULL,               -- ID in etherx_passwords.db
          created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_passwords_site ON passwords_meta(site);

        INSERT OR REPLACE INTO schema_version (version) VALUES (2);
      `);
    }

    // ── Migration v3: Downloads, Tab Sessions, User Profile, Notes, Lighthouse, Summaries
    if (currentVersion < 3) {
      this.db.exec(`
        -- Downloads tracking
        CREATE TABLE IF NOT EXISTS downloads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          filename TEXT NOT NULL DEFAULT '',
          filepath TEXT DEFAULT '',
          filesize INTEGER DEFAULT 0,
          received_bytes INTEGER DEFAULT 0,
          mime_type TEXT DEFAULT '',
          state TEXT DEFAULT 'progressing',
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          completed_at INTEGER DEFAULT NULL
        );

        -- Tab sessions for restore
        CREATE TABLE IF NOT EXISTS tab_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          tabs_json TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- User profile
        CREATE TABLE IF NOT EXISTS user_profile (
          id INTEGER PRIMARY KEY DEFAULT 1,
          full_name TEXT DEFAULT '',
          email TEXT DEFAULT '',
          avatar_data TEXT DEFAULT '',
          bio TEXT DEFAULT '',
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- Notes
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL DEFAULT 'Untitled',
          content TEXT NOT NULL DEFAULT '',
          color TEXT DEFAULT '#667eea',
          is_pinned INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- Lighthouse audit history
        CREATE TABLE IF NOT EXISTS lighthouse_audits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          performance_score INTEGER,
          accessibility_score INTEGER,
          best_practices_score INTEGER,
          seo_score INTEGER,
          pwa_score INTEGER,
          audit_json TEXT,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- Page summaries (AI)
        CREATE TABLE IF NOT EXISTS page_summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          title TEXT DEFAULT '',
          summary TEXT NOT NULL,
          model TEXT DEFAULT '',
          word_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_summaries_url ON page_summaries(url);

        INSERT OR REPLACE INTO schema_version (version) VALUES (3);
      `);
    }
  }

  // ─── Tabs ─────────────────────────────────────────────────────────────────

  /**
   * Save or update a tab. NEVER call this for incognito tabs.
   */
  saveTab(tab) {
    const stmt = this.db.prepare(`
      INSERT INTO tabs (id, url, title, favicon, tab_order, is_active, scroll_x, scroll_y, is_pinned, group_name, updated_at)
      VALUES (@id, @url, @title, @favicon, @tab_order, @is_active, @scroll_x, @scroll_y, @is_pinned, @group_name, strftime('%s','now'))
      ON CONFLICT(id) DO UPDATE SET
        url        = excluded.url,
        title      = excluded.title,
        favicon     = excluded.favicon,
        tab_order  = excluded.tab_order,
        is_active  = excluded.is_active,
        scroll_x   = excluded.scroll_x,
        scroll_y   = excluded.scroll_y,
        is_pinned  = excluded.is_pinned,
        group_name = excluded.group_name,
        updated_at = strftime('%s','now')
    `);

    stmt.run({
      id: tab.id,
      url: tab.url || 'etherx://newtab',
      title: tab.title || 'New Tab',
      favicon: tab.favicon || '',
      tab_order: tab.tabOrder ?? 0,
      is_active: tab.isActive ? 1 : 0,
      scroll_x: tab.scrollX ?? 0,
      scroll_y: tab.scrollY ?? 0,
      is_pinned: tab.isPinned ? 1 : 0,
      group_name: tab.groupName || null,
    });

    return { ok: true };
  }

  getTabs() {
    return this.db.prepare(
      'SELECT * FROM tabs ORDER BY tab_order ASC'
    ).all().map(this._deserializeTab);
  }

  deleteTab(tabId) {
    this.db.prepare('DELETE FROM tabs WHERE id = ?').run(tabId);
    return { ok: true };
  }

  updateTabOrder(tabs) {
    const update = this.db.prepare(
      'UPDATE tabs SET tab_order = @order, is_active = @isActive WHERE id = @id'
    );
    const transaction = this.db.transaction((items) => {
      for (const t of items) {
        update.run({ id: t.id, order: t.tabOrder, isActive: t.isActive ? 1 : 0 });
      }
    });
    transaction(tabs);
    return { ok: true };
  }

  updateTabScroll(tabId, scrollX, scrollY) {
    this.db.prepare(
      'UPDATE tabs SET scroll_x = ?, scroll_y = ? WHERE id = ?'
    ).run(scrollX, scrollY, tabId);
    return { ok: true };
  }

  _deserializeTab(row) {
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      favicon: row.favicon,
      tabOrder: row.tab_order,
      isActive: row.is_active === 1,
      scrollX: row.scroll_x,
      scrollY: row.scroll_y,
      isPinned: row.is_pinned === 1,
      groupName: row.group_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ─── History ──────────────────────────────────────────────────────────────

  /**
   * Add or increment a history entry.
   * NEVER call this for incognito pages.
   */
  addHistory({ url, title = '', favicon = '' }) {
    const existing = this.db.prepare('SELECT id, visit_count FROM history WHERE url = ?').get(url);
    if (existing) {
      this.db.prepare(
        'UPDATE history SET visit_count = visit_count + 1, last_visited = strftime(\'%s\',\'now\'), title = ?, favicon = ? WHERE id = ?'
      ).run(title, favicon, existing.id);
    } else {
      this.db.prepare(
        'INSERT INTO history (url, title, favicon) VALUES (?, ?, ?)'
      ).run(url, title, favicon);
    }
    return { ok: true };
  }

  getHistory({ limit = 200, search = '' } = {}) {
    if (search) {
      return this.db.prepare(
        'SELECT * FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY last_visited DESC LIMIT ?'
      ).all(`%${search}%`, `%${search}%`, limit);
    }
    return this.db.prepare(
      'SELECT * FROM history ORDER BY last_visited DESC LIMIT ?'
    ).all(limit);
  }

  clearHistory() {
    this.db.prepare('DELETE FROM history').run();
    return { ok: true };
  }

  clearHistoryRange(from, to) {
    this.db.prepare(
      'DELETE FROM history WHERE last_visited BETWEEN ? AND ?'
    ).run(from, to);
    return { ok: true };
  }

  // ─── Bookmarks ───────────────────────────────────────────────────────────

  addBookmark({ id, url, title, favicon, folder = 'Bookmarks Bar', description = '' }) {
    this.db.prepare(
      'INSERT OR REPLACE INTO bookmarks (id, url, title, favicon, folder, description) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id || require('crypto').randomUUID(), url, title, favicon || '', folder, description);
    return { ok: true };
  }

  getBookmarks() {
    return this.db.prepare('SELECT * FROM bookmarks ORDER BY folder, created_at ASC').all();
  }

  deleteBookmark(id) {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
    return { ok: true };
  }

  updateBookmark({ id, url, title, favicon, folder, description }) {
    this.db.prepare(
      'UPDATE bookmarks SET url = ?, title = ?, favicon = ?, folder = ?, description = ? WHERE id = ?'
    ).run(url, title, favicon || '', folder || 'Bookmarks Bar', description || '', id);
    return { ok: true };
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  getSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    return rows.reduce((acc, r) => {
      acc[r.key] = r.value;
      return acc;
    }, {});
  }

  saveSettings(obj) {
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const tx = this.db.transaction((pairs) => {
      for (const [k, v] of pairs) upsert.run(k, String(v));
    });
    tx(Object.entries(obj));
    return { ok: true };
  }

  // ─── AI Cache ─────────────────────────────────────────────────────────────

  /**
   * Look up a cached AI summary for the given URL.
   * @param {string} urlHash  MD5 hex of the URL
   * @returns {string|null}   Cached summary text, or null if not found
   */
  getCachedSummary(urlHash) {
    const row = this.db.prepare(
      'SELECT summary FROM ai_cache WHERE url_hash = ?'
    ).get(urlHash);
    if (row) {
      // Bump last_used timestamp so we know it's still active
      this.db.prepare(
        "UPDATE ai_cache SET last_used = strftime('%s','now') WHERE url_hash = ?"
      ).run(urlHash);
      return row.summary;
    }
    return null;
  }

  /**
   * Store an AI summary in the cache.
   * @param {string} urlHash  MD5 hex of the URL
   * @param {string} url      The original URL (for display / debugging)
   * @param {string} summary  The generated summary text
   * @param {string} [model]  Model used (default 'gpt-4o-mini')
   */
  setCachedSummary(urlHash, url, summary, model = 'gpt-4o-mini') {
    this.db.prepare(`
      INSERT INTO ai_cache (url_hash, url, summary, model)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(url_hash) DO UPDATE SET
        summary    = excluded.summary,
        model      = excluded.model,
        created_at = strftime('%s','now'),
        last_used  = strftime('%s','now')
    `).run(urlHash, url, summary, model);
    return { ok: true };
  }

  /**
   * Return all cached summaries, newest first.
   * @param {number} [limit=100]
   */
  getAiCache(limit = 100) {
    return this.db.prepare(
      'SELECT url_hash, url, summary, model, created_at, last_used FROM ai_cache ORDER BY last_used DESC LIMIT ?'
    ).all(limit);
  }

  /**
   * Remove stale cache entries older than `olderThanDays` days.
   */
  pruneAiCache(olderThanDays = 30) {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
    const result = this.db.prepare(
      'DELETE FROM ai_cache WHERE last_used < ?'
    ).run(cutoff);
    return { ok: true, deleted: result.changes };
  }

  clearAiCache() {
    this.db.prepare('DELETE FROM ai_cache').run();
    return { ok: true };
  }

  // ─── Downloads ────────────────────────────────────────────────────────────
  addDownload({ url, filename, filepath, filesize, mimeType }) {
    const result = this.db.prepare(
      'INSERT INTO downloads (url, filename, filepath, filesize, mime_type) VALUES (?, ?, ?, ?, ?)'
    ).run(url, filename || '', filepath || '', filesize || 0, mimeType || '');
    return { ok: true, id: result.lastInsertRowid };
  }

  updateDownload(id, { receivedBytes, state, filepath, completedAt }) {
    const sets = [];
    const vals = [];
    if (receivedBytes !== undefined) { sets.push('received_bytes = ?'); vals.push(receivedBytes); }
    if (state) { sets.push('state = ?'); vals.push(state); }
    if (filepath) { sets.push('filepath = ?'); vals.push(filepath); }
    if (completedAt) { sets.push('completed_at = ?'); vals.push(completedAt); }
    if (sets.length === 0) return { ok: true };
    vals.push(id);
    this.db.prepare('UPDATE downloads SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    return { ok: true };
  }

  getDownloads(limit = 100) {
    return this.db.prepare('SELECT * FROM downloads ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  deleteDownload(id) {
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
    return { ok: true };
  }

  clearDownloads() {
    this.db.prepare('DELETE FROM downloads').run();
    return { ok: true };
  }

  // ─── Tab Sessions ─────────────────────────────────────────────────────────
  saveTabSession(sessionId, tabsArray) {
    this.db.prepare(
      'INSERT INTO tab_sessions (session_id, tabs_json) VALUES (?, ?)'
    ).run(sessionId, JSON.stringify(tabsArray));
    return { ok: true };
  }

  getLatestTabSession() {
    return this.db.prepare(
      'SELECT * FROM tab_sessions ORDER BY created_at DESC LIMIT 1'
    ).get();
  }

  clearTabSessions() {
    this.db.prepare('DELETE FROM tab_sessions').run();
    return { ok: true };
  }

  // ─── User Profile ────────────────────────────────────────────────────────
  getUserProfile() {
    return this.db.prepare('SELECT * FROM user_profile WHERE id = 1').get() || { full_name: '', email: '', avatar_data: '', bio: '' };
  }

  saveUserProfile({ fullName, email, avatarData, bio }) {
    this.db.prepare(`
      INSERT INTO user_profile (id, full_name, email, avatar_data, bio, updated_at)
      VALUES (1, ?, ?, ?, ?, strftime('%s','now'))
      ON CONFLICT(id) DO UPDATE SET
        full_name = excluded.full_name,
        email = excluded.email,
        avatar_data = excluded.avatar_data,
        bio = excluded.bio,
        updated_at = strftime('%s','now')
    `).run(fullName || '', email || '', avatarData || '', bio || '');
    return { ok: true };
  }

  // ─── Notes ────────────────────────────────────────────────────────────────
  addNote({ title, content, color }) {
    const result = this.db.prepare(
      'INSERT INTO notes (title, content, color) VALUES (?, ?, ?)'
    ).run(title || 'Untitled', content || '', color || '#667eea');
    return { ok: true, id: result.lastInsertRowid };
  }

  getNotes() {
    return this.db.prepare('SELECT * FROM notes ORDER BY is_pinned DESC, updated_at DESC').all();
  }

  updateNote(id, { title, content, color, isPinned }) {
    const sets = ["updated_at = strftime('%s','now')"];
    const vals = [];
    if (title !== undefined) { sets.push('title = ?'); vals.push(title); }
    if (content !== undefined) { sets.push('content = ?'); vals.push(content); }
    if (color !== undefined) { sets.push('color = ?'); vals.push(color); }
    if (isPinned !== undefined) { sets.push('is_pinned = ?'); vals.push(isPinned ? 1 : 0); }
    vals.push(id);
    this.db.prepare('UPDATE notes SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    return { ok: true };
  }

  deleteNote(id) {
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return { ok: true };
  }

  // ─── Lighthouse Audits ────────────────────────────────────────────────────
  saveLighthouseAudit({ url, performanceScore, accessibilityScore, bestPracticesScore, seoScore, pwaScore, auditJson }) {
    this.db.prepare(
      'INSERT INTO lighthouse_audits (url, performance_score, accessibility_score, best_practices_score, seo_score, pwa_score, audit_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(url, performanceScore, accessibilityScore, bestPracticesScore, seoScore, pwaScore, auditJson || '');
    return { ok: true };
  }

  getLighthouseAudits(url, limit = 20) {
    if (url) {
      return this.db.prepare('SELECT * FROM lighthouse_audits WHERE url = ? ORDER BY created_at DESC LIMIT ?').all(url, limit);
    }
    return this.db.prepare('SELECT * FROM lighthouse_audits ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  // ─── Page Summaries ───────────────────────────────────────────────────────
  savePageSummary({ url, title, summary, model, wordCount }) {
    this.db.prepare(
      'INSERT INTO page_summaries (url, title, summary, model, word_count) VALUES (?, ?, ?, ?, ?)'
    ).run(url, title || '', summary, model || '', wordCount || 0);
    return { ok: true };
  }

  getPageSummary(url) {
    return this.db.prepare('SELECT * FROM page_summaries WHERE url = ? ORDER BY created_at DESC LIMIT 1').get(url);
  }

  getPageSummaries(limit = 50) {
    return this.db.prepare('SELECT * FROM page_summaries ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  close() {
    this.db?.close();
  }
}

module.exports = DatabaseManager;
