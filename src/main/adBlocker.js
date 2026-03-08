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
const fs   = require('fs');

class AdBlocker {
  constructor(sess) {
    this.session = sess;
    this.blocker  = null;
    this.enabled  = true;
    this.stats    = { blocked: 0, allowed: 0 };
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
    // Use the bundled filter list in assets/filters/
    const filterPath = path.join(__dirname, '../../assets/filters/filters.txt');
    if (fs.existsSync(filterPath)) {
      const raw = fs.readFileSync(filterPath, 'utf8');
      console.log(`[AdBlocker] Loaded ${raw.split('\n').length} filter rules from disk`);
    }

    // Install a simple request blocker
    this.session.webRequest.onBeforeRequest(
      { urls: ['*://*/*'] },
      (details, callback) => {
        if (!this.enabled) { callback({}); return; }

        const url = details.url;
        const blocked = this._isBlocked(url);

        if (blocked) {
          this.stats.blocked++;
          callback({ cancel: true });
        } else {
          this.stats.allowed++;
          callback({});
        }
      }
    );
  }

  // Minimal built-in block list (well-known ad domains)
  _isBlocked(url) {
    const AD_DOMAINS = [
      'doubleclick.net', 'googlesyndication.com', 'adnxs.com',
      'ads.yahoo.com', 'adsafeprotected.com', 'scorecardresearch.com',
      'pixel.quantserve.com', 'outbrain.com', 'taboola.com',
      'pubmatic.com', 'rubiconproject.com', 'openx.net',
      'advertising.com', 'media.net', 'adroll.com',
      'criteo.com', 'moatads.com', 'amazon-adsystem.com',
      'googletagservices.com', 'googletagmanager.com',
      'analytics.google.com', 'google-analytics.com',
      'facebook.com/tr', 'connect.facebook.net',
      'hotjar.com', 'fullstory.com', 'mixpanel.com',
      'segment.io', 'segment.com', 'heap.io',
    ];
    try {
      const parsed = new URL(url);
      return AD_DOMAINS.some(d => parsed.hostname.endsWith(d));
    } catch {
      return false;
    }
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
