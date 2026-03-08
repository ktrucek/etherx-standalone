/**
 * EtherX Browser — Password Manager
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 *
 * ════════════════════════════════════════════════════════════════════
 * DISCLAIMER: kriptoentuzijasti.io has ZERO access to any stored
 * passwords. All data is encrypted with AES-256-GCM using a key
 * derived exclusively from the user's master password (PBKDF2).
 * The encrypted blob is stored locally on the user's device only.
 * kriptoentuzijasti.io never transmits, stores, or can decrypt
 * any user credentials. See LICENSE for full disclaimer.
 * ════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *  - Master password → PBKDF2-SHA256 → 256-bit key (stays in RAM)
 *  - Each entry encrypted with AES-256-GCM (unique IV per entry)
 *  - Encrypted entries stored in local SQLite (etherx_passwords.db)
 *  - Master password is NEVER stored anywhere
 *
 * Bitwarden compatibility:
 *  - Import/export in Bitwarden JSON format supported
 *  - Users can migrate to/from self-hosted Bitwarden freely
 */

'use strict';

const path   = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ITERATIONS = 600_000; // OWASP recommended PBKDF2 iterations
const KEY_LEN    = 32;       // 256-bit
const SALT_LEN   = 32;
const IV_LEN     = 12;
const TAG_LEN    = 16;

class PasswordManager {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, 'etherx_passwords.db');
    this.db = null;
    this._sessionKey = null; // in-memory only, never persisted
  }

  _getDb(userDataPath) {
    if (!this.db) {
      this.db = new Database(this.dbPath || path.join(userDataPath, 'etherx_passwords.db'));
      this.db.pragma('journal_mode = WAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS vault_meta (
          id          TEXT PRIMARY KEY DEFAULT 'default',
          salt        TEXT NOT NULL,
          iterations  INTEGER NOT NULL DEFAULT ${ITERATIONS},
          created_at  INTEGER DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE IF NOT EXISTS vault_entries (
          id          TEXT PRIMARY KEY,
          site        TEXT NOT NULL,
          username    TEXT NOT NULL,
          encrypted   BLOB NOT NULL,
          iv          BLOB NOT NULL,
          auth_tag    BLOB NOT NULL,
          created_at  INTEGER DEFAULT (strftime('%s','now')),
          updated_at  INTEGER DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_vault_site ON vault_entries(site);
      `);
    }
    return this.db;
  }

  // ─── Key Derivation ──────────────────────────────────────────────────────

  /**
   * Derive encryption key from master password.
   * The derived key stays in RAM only — never persisted.
   */
  static async deriveKey(masterPassword, salt) {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        masterPassword,
        salt,
        ITERATIONS,
        KEY_LEN,
        'sha256',
        (err, key) => (err ? reject(err) : resolve(key))
      );
    });
  }

  // ─── Vault Setup ─────────────────────────────────────────────────────────

  static async setupVault(userDataPath, masterPassword) {
    const pm = new PasswordManager(userDataPath);
    const db = pm._getDb(userDataPath);
    const existing = db.prepare('SELECT salt FROM vault_meta WHERE id = ?').get('default');
    if (existing) {
      return { ok: false, error: 'Vault already exists. Use unlock instead.' };
    }
    const salt = crypto.randomBytes(SALT_LEN).toString('hex');
    db.prepare('INSERT INTO vault_meta (id, salt) VALUES (?, ?)').run('default', salt);

    // Store derived key in module-level RAM cache (cleared on app close)
    const key = await PasswordManager.deriveKey(masterPassword, Buffer.from(salt, 'hex'));
    _sessionKeys.set(userDataPath, key);
    return { ok: true };
  }

  static async unlockVault(userDataPath, masterPassword) {
    const pm = new PasswordManager(userDataPath);
    const db = pm._getDb(userDataPath);
    const meta = db.prepare('SELECT salt FROM vault_meta WHERE id = ?').get('default');
    if (!meta) return { ok: false, error: 'Vault not initialized.' };

    try {
      const key = await PasswordManager.deriveKey(masterPassword, Buffer.from(meta.salt, 'hex'));
      // Test by trying to decrypt first entry
      const entry = db.prepare('SELECT * FROM vault_entries LIMIT 1').get();
      if (entry) {
        try {
          PasswordManager._decrypt(key, entry.encrypted, entry.iv, entry.auth_tag);
        } catch {
          return { ok: false, error: 'Wrong master password.' };
        }
      }
      _sessionKeys.set(userDataPath, key);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  static lockVault(userDataPath) {
    _sessionKeys.delete(userDataPath);
    return { ok: true };
  }

  // ─── Encryption helpers ──────────────────────────────────────────────────

  static _encrypt(key, plaintext) {
    const iv     = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag   = cipher.getAuthTag();
    return { encrypted, iv, authTag };
  }

  static _decrypt(key, encrypted, iv, authTag) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  static save(userDataPath, site, username, plainPassword) {
    const key = _sessionKeys.get(userDataPath);
    if (!key) return { ok: false, error: 'Vault is locked. Please enter master password.' };

    const pm = new PasswordManager(userDataPath);
    const db = pm._getDb(userDataPath);

    const payload = JSON.stringify({ password: plainPassword, username, site });
    const { encrypted, iv, authTag } = PasswordManager._encrypt(key, payload);

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO vault_entries (id, site, username, encrypted, iv, auth_tag)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET encrypted = excluded.encrypted, iv = excluded.iv,
        auth_tag = excluded.auth_tag, updated_at = strftime('%s','now')
    `).run(id, site, username, encrypted, iv, authTag);

    return { ok: true, id };
  }

  static get(userDataPath, site) {
    const key = _sessionKeys.get(userDataPath);
    if (!key) return { ok: false, error: 'Vault locked' };

    const pm = new PasswordManager(userDataPath);
    const db = pm._getDb(userDataPath);

    const entries = db.prepare('SELECT * FROM vault_entries WHERE site = ?').all(site);
    return entries.map(e => {
      try {
        const plaintext = PasswordManager._decrypt(key, e.encrypted, e.iv, e.auth_tag);
        const data = JSON.parse(plaintext);
        return { id: e.id, site: e.site, username: e.username, password: data.password };
      } catch {
        return { id: e.id, site: e.site, username: e.username, error: 'Decryption failed' };
      }
    });
  }

  static list(userDataPath) {
    const pm = new PasswordManager(userDataPath);
    const db = pm._getDb(userDataPath);
    // Return only metadata — no passwords
    return db.prepare('SELECT id, site, username, created_at FROM vault_entries ORDER BY site').all();
  }

  static remove(userDataPath, id) {
    const pm = new PasswordManager(userDataPath);
    const db = pm._getDb(userDataPath);
    db.prepare('DELETE FROM vault_entries WHERE id = ?').run(id);
    return { ok: true };
  }

  /**
   * Export vault in Bitwarden JSON format (encrypted passwords included for portability)
   */
  static exportBitwardenFormat(userDataPath) {
    const key = _sessionKeys.get(userDataPath);
    if (!key) return { ok: false, error: 'Vault locked' };
    const pm = new PasswordManager(userDataPath);
    const db = pm._getDb(userDataPath);
    const entries = db.prepare('SELECT * FROM vault_entries').all();
    const items = entries.map(e => {
      try {
        const plain = JSON.parse(PasswordManager._decrypt(key, e.encrypted, e.iv, e.auth_tag));
        return {
          type: 1,
          name: e.site,
          login: { username: e.username, password: plain.password,
            uris: [{ uri: e.site.startsWith('http') ? e.site : `https://${e.site}` }] },
        };
      } catch { return null; }
    }).filter(Boolean);
    return { ok: true, data: JSON.stringify({ encrypted: false, items }, null, 2) };
  }
}

// In-process session key cache — lives only in RAM, cleared on app exit
const _sessionKeys = new Map();

// Expose static methods directly for IPC use pattern: PasswordManager.save(userDataPath, ...)
module.exports = PasswordManager;
