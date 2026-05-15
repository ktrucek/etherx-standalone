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
    this.blockedDomains = new Set();
  }

  _normalizeHost(rawUrl) {
    try {
      return new URL(rawUrl).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }

  _registrableDomain(host) {
    if (!host) return '';
    const parts = host.split('.').filter(Boolean);
    if (parts.length <= 2) return host;
    return parts.slice(-2).join('.');
  }

  _isDomainBlocked(host) {
    if (!host) return false;
    for (const d of this.blockedDomains) {
      if (host === d || host.endsWith(`.${d}`)) return true;
    }
    return false;
  }

  _isSameSite(requestUrl, firstPartyUrl) {
    const reqHost = this._normalizeHost(requestUrl);
    const fpHost = this._normalizeHost(firstPartyUrl);
    if (!reqHost || !fpHost) return false;
    return this._registrableDomain(reqHost) === this._registrableDomain(fpHost);
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
    this.blockedDomains.clear();

    // Use the bundled filter list in assets/filters/
    const filterPath = path.join(__dirname, '../../assets/filters/filters.txt');
    if (fs.existsSync(filterPath)) {
      const raw = fs.readFileSync(filterPath, 'utf8');
      const lines = raw.split('\n');
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('||') && t.endsWith('^')) {
          const domain = t.slice(2, -1);
          if (/^[a-z0-9.-]+$/i.test(domain)) {
            this.blockedDomains.add(domain.toLowerCase());
            patterns.push(`*://${domain}/*`);
            patterns.push(`*://*.${domain}/*`);
          }
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
      AD_DOMAINS.forEach((d) => this.blockedDomains.add(d.toLowerCase()));
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

        const reqHost = this._normalizeHost(details.url);
        if (!this._isDomainBlocked(reqHost)) {
          this.stats.allowed++;
          callback({});
          return;
        }

        // Safe image mode: keep same-site images alive to avoid accidental
        // "all images missing" regressions when filter lists are aggressive.
        const rt = String(details.resourceType || '').toLowerCase();
        if (rt === 'image') {
          const firstParty = details.firstPartyURL || details.referrer || details.initiator || '';
          if (firstParty && this._isSameSite(details.url, firstParty)) {
            this.stats.allowed++;
            callback({});
            return;
          }
        }

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

  /**
   * Static: apply malware/phishing/mining domain blocker to any Electron session.
   * Loads assets/filters/malware.txt — safe to call on persist:etherx session.
   * Returns a live stats object { blocked: number, domains: number }.
   */
  static applyMalwareFilter(sess) {
    const malwarePath = path.join(__dirname, '../../assets/filters/malware.txt');
    const patterns = [];

    if (fs.existsSync(malwarePath)) {
      const raw = fs.readFileSync(malwarePath, 'utf8');
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        if (t.startsWith('||') && t.endsWith('^')) {
          const domain = t.slice(2, -1);
          patterns.push(`*://${domain}/*`);
          patterns.push(`*://*.${domain}/*`);
        }
      }
    }

    if (patterns.length === 0) {
      console.warn('[MalwareBlocker] malware.txt not found or empty');
      return { blocked: 0, domains: 0 };
    }

    const stats = { blocked: 0, domains: patterns.length / 2, enabled: true };

    try {
      sess.webRequest.onBeforeRequest({ urls: patterns }, (details, callback) => {
        if (!stats.enabled) { callback({}); return; }
        stats.blocked++;
        console.log(`[MalwareBlocker] Blocked: ${details.url}`);
        callback({ cancel: true });
      });
      console.log(`[MalwareBlocker] Active — ${stats.domains} domene blokirane`);
    } catch (e) {
      console.error('[MalwareBlocker] Failed to register handler:', e.message);
    }

    return stats;
  }
}

module.exports = AdBlocker;
