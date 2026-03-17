/**
 * EtherX Browser — Ad Blocker
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 *
 * Uses @cliqz/adblocker-electron with bundled EasyList + EasyPrivacy.
 */

'use strict';

const { ElectronBlocker } = require('@remusao/smaz'); // fallback
let ElectronBlockerLib;
try {
  ElectronBlockerLib = require('@cliqz/adblocker-electron');
} catch {
  // will use built-in filter fallback
}

const path = require('path');
const fs = require('fs');

class AdBlocker {
  constructor(sess) {
    this.session = sess;
    this.blocker = null;
    this.enabled = true;
    this.stats = { blocked: 0, allowed: 0 };
  }

  async init() {
    try {
      if (ElectronBlockerLib) {
        const { ElectronBlocker } = ElectronBlockerLib;
        this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      } else {
        // Fallback: load our bundled EasyList filter
        await this._loadFallbackFilters();
      }

      if (this.enabled && this.blocker) {
        this.blocker.enableBlockingInSession(this.session);
        console.log('[AdBlocker] Initialized and active');
      }
    } catch (err) {
      console.warn('[AdBlocker] Init warning (non-fatal):', err.message);
      await this._loadFallbackFilters();
    }
  }

  async _loadFallbackFilters() {
    let patterns = [];

    // Use the bundled filter list in assets/filters/
    const filterPath = path.join(__dirname, '../../assets/filters/filters.txt');
    if (fs.existsSync(filterPath)) {
      const raw = fs.readFileSync(filterPath, 'utf8');
      const lines = raw.split('\n');
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('||') && t.endsWith('^')) {
          const domain = t.slice(2, -1);
          patterns.push(`*://${domain}/*`);
          patterns.push(`*://*.${domain}/*`);
        }
      }
      console.log(`[AdBlocker] Loaded ${patterns.length / 2} filter rules from disk`);
    }

    if (patterns.length === 0) {
      const AD_DOMAINS = [
        'doubleclick.net', 'googlesyndication.com', 'adnxs.com',
        'ads.yahoo.com', 'adsafeprotected.com', 'scorecardresearch.com',
        'pixel.quantserve.com', 'outbrain.com', 'taboola.com',
        'pubmatic.com', 'rubiconproject.com', 'openx.net',
        'advertising.com', 'media.net', 'adroll.com',
        'criteo.com', 'moatads.com', 'amazon-adsystem.com',
        'googletagservices.com', 'googletagmanager.com',
        'analytics.google.com', 'google-analytics.com',
        'connect.facebook.net',
        'hotjar.com', 'fullstory.com', 'mixpanel.com',
        'segment.io', 'segment.com', 'heap.io',
      ];
      patterns = AD_DOMAINS.flatMap(d => [`*://${d}/*`, `*://*.${d}/*`]);
    }

    // Dodajemo i facebook.com/tr jer je bio specifican url
    patterns.push('*://*.facebook.com/tr*');
    patterns.push('*://facebook.com/tr*');

    // Install a high-performance native request blocker
    this.session.webRequest.onBeforeRequest(
      { urls: patterns },
      (details, callback) => {
        if (!this.enabled) { callback({}); return; }
        this.stats.blocked++;
        callback({ cancel: true });
      }
    );
  }

  // Obsolete but kept for signature compatibility
  _isBlocked(url) {
    return false;
  }

  isEnabled() { return this.enabled; }

  toggle(enabled) {
    this.enabled = !!enabled;
    console.log(`[AdBlocker] ${this.enabled ? 'Enabled' : 'Disabled'}`);
    return { ok: true, enabled: this.enabled };
  }

  getStats() { return { ...this.stats }; }
}

module.exports = AdBlocker;
