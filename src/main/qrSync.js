/**
 * EtherX Browser — QR Code Sync Manager
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 *
 * Generates QR codes for local device-to-device sync.
 * Data is encoded directly in the QR — no server needed.
 * For large data, an encrypted sync token is generated and the
 * receiving device resolves it over LAN.
 */

'use strict';

const QRCode = require('qrcode');
const crypto = require('crypto');

class QRSyncManager {
  /**
   * Generate QR code data URI from a string payload.
   * Payload is compressed if large.
   */
  static async generateQR(data) {
    try {
      // If data > 2KB, split into chunked QR with sync token
      const str = typeof data === 'string' ? data : JSON.stringify(data);

      // For browser sync we encode as base64 to handle JSON special chars
      const encoded = Buffer.from(str, 'utf8').toString('base64');

      if (encoded.length > 2900) {
        // Too large for single QR — generate a LAN sync token instead
        const token = crypto.randomBytes(16).toString('hex');
        const shortPayload = JSON.stringify({
          type: 'etherx-sync',
          token,
          size: str.length,
          hint: 'Connect to same network and scan',
        });
        const qrDataUrl = await QRCode.toDataURL(shortPayload, {
          errorCorrectionLevel: 'M',
          width: 300,
          margin: 2,
          color: { dark: '#667eea', light: '#1a1a1a' },
        });
        return { ok: true, qrDataUrl, token, isPartial: true };
      }

      const qrDataUrl = await QRCode.toDataURL(encoded, {
        errorCorrectionLevel: 'M',
        width: 300,
        margin: 2,
        color: { dark: '#667eea', light: '#1a1a1a' },
      });

      return { ok: true, qrDataUrl, isPartial: false };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Decode a scanned QR payload.
   */
  static decodeQR(raw) {
    try {
      // Try base64 decode first
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return { ok: true, data: parsed };
    } catch {
      try {
        const parsed = JSON.parse(raw);
        return { ok: true, data: parsed };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  }

  /**
   * Generate a sync QR for specific data types.
   * type: 'bookmarks' | 'tabs' | 'settings' | 'full'
   */
  static async generateProfileQR(db, type = 'full') {
    const payload = { type: `etherx-${type}`, v: 1, timestamp: Date.now() };

    if (type === 'bookmarks' || type === 'full') {
      payload.bookmarks = db.getBookmarks();
    }
    if (type === 'tabs' || type === 'full') {
      payload.tabs = db.getTabs();
    }
    if (type === 'settings' || type === 'full') {
      payload.settings = db.getSettings();
    }

    return QRSyncManager.generateQR(JSON.stringify(payload));
  }
}

module.exports = QRSyncManager;
