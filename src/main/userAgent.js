/**
 * EtherX Browser — User Agent Manager
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 *
 * Standard masking: Chrome UA + EtherX identifier.
 * Ensures maximum compatibility with web services.
 */

'use strict';

// Primary UA: Masquerades as Chrome 122 on Windows 10 + EtherX identifier
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 EtherX/1.0';

let _current = DEFAULT_UA;

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

  PRESETS: {
    'EtherX Default (Chrome 122)': DEFAULT_UA,
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
