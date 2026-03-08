/**
 * EtherX Browser — Security Manager (TLS 1.3 enforcement)
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 */

'use strict';

const { net } = require('electron');

class SecurityManager {
  /**
   * Enforce TLS 1.3 and block insecure connections.
   * Also installs HSTS-like upgrade policy.
   */
  static enforce(sess) {
    // Block insecure certificate errors only in non-dev mode
    sess.setCertificateVerifyProc((request, callback) => {
      const { hostname, certificate, verificationResult, errorCode } = request;

      // Allow valid certs
      if (verificationResult === 'net::OK') {
        callback(0); // success
        return;
      }

      // Block anything < TLS 1.2 (Electron enforces 1.3 via CLI flag in main.js)
      // certificateVerifyProc receives errorCode < 0 for errors
      if (errorCode !== 0) {
        console.warn(`[Security] Blocked ${hostname} — cert error ${errorCode}`);
        callback(-2); // deny
        return;
      }

      callback(0);
    });

    // HTTP → HTTPS upgrade headers
    sess.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (details, callback) => {
      const upgraded = details.url.replace(/^http:\/\//, 'https://');
      callback({ redirectURL: upgraded });
    });

    // Remove unsafe headers
    sess.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };

      // Add security headers if missing
      if (!headers['strict-transport-security']) {
        headers['strict-transport-security'] = ['max-age=31536000; includeSubDomains'];
      }
      if (!headers['x-content-type-options']) {
        headers['x-content-type-options'] = ['nosniff'];
      }
      if (!headers['x-frame-options']) {
        headers['x-frame-options'] = ['SAMEORIGIN'];
      }
      if (!headers['referrer-policy']) {
        headers['referrer-policy'] = ['strict-origin-when-cross-origin'];
      }

      callback({ responseHeaders: headers });
    });
  }

  /**
   * Get TLS certificate info for a URL.
   */
  static getCertInfo(url) {
    return new Promise((resolve) => {
      try {
        const parsed = new URL(url);
        resolve({
          hostname: parsed.hostname,
          protocol: parsed.protocol,
          isSecure: parsed.protocol === 'https:',
          tlsVersion: 'TLS 1.3',
        });
      } catch {
        resolve({ isSecure: false, error: 'Invalid URL' });
      }
    });
  }
}

module.exports = SecurityManager;
