/**
 * EtherX Browser — User Agent Manager
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 *
 * Standard masking: Chrome UA + EtherX identifier.
 * Ensures maximum compatibility with web services.
 */

'use strict';

// Primary UA: Clean Chrome 122 — no Electron/EtherX tokens so Google OAuth works
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Chrome 131 V8 for Google login compatibility
const CHROME_131_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let _current = DEFAULT_UA;

/**
 * Check if URL is a Google login/account page that requires clean Chrome UA
 */
function isGoogleLoginDomain(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // Google login/account domains that require Chrome UA
    return host === 'accounts.google.com' 
      || host === 'myaccount.google.com'
      || host.endsWith('.accounts.google.com')
      || (host.endsWith('google.com') && (u.pathname.includes('/signin') || u.pathname.includes('/login') || u.pathname.includes('/ServiceLogin')));
  } catch (e) {
    return false;
  }
}

const UserAgentManager = {
  get() {
    return _current;
  },

  set(session, ua) {
    const resolved = ua || DEFAULT_UA;
    _current = resolved;
    session.setUserAgent(resolved);
    return { ok: true, ua: resolved };
  },

  getDefault() {
    return DEFAULT_UA;
  },

  /**
   * Get appropriate User Agent for a given URL
   * Automatically uses Chrome 131 for Google login pages
   */
  getUAForURL(url) {
    if (isGoogleLoginDomain(url)) {
      return CHROME_131_UA;
    }
    return _current;
  },

  /**
   * Check if URL requires special UA handling (Google login)
   */
  isGoogleLoginDomain,

  PRESETS: {
    'EtherX Default (Chrome 122)': DEFAULT_UA,
    'Chrome 131 V8': CHROME_131_UA,
    'Chrome 122 Windows':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Chrome 122 macOS':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Firefox 124 Windows':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Safari 17 macOS':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
    'Mobile Chrome (Android)':
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36',
  },
};

module.exports = UserAgentManager;
