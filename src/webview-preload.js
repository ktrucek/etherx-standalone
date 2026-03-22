/**
 * EtherX Browser — Webview Preload
 * Injected into every webview (persist:etherx session) before any page JS runs.
 * Purpose: spoof bot-detection properties so sites like TikTok, Instagram,
 * Twitter/X, etc. treat the webview as a normal browser window.
 */
'use strict';

// ── Spoof navigator.webdriver ────────────────────────────────────────────────
// Electron sets navigator.webdriver = true (inherited from Chromium automation
// detection). TikTok, TikTok LIVE, Instagram and many other sites check this
// and show "Download the app" / block playback / serve degraded content.
try {
    Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
    });
} catch (_) { }

// ── Stub window.chrome so Chrome-only feature detection passes ───────────────
// Some sites (TikTok included) check window.chrome to confirm they are running
// inside a real Chrome browser. Electron does not populate this by default.
try {
    if (!window.chrome) {
        Object.defineProperty(window, 'chrome', {
            value: { runtime: {}, loadTimes: () => { }, csi: () => { }, app: {} },
            configurable: true,
            writable: true,
        });
    }
} catch (_) { }

// ── Spoof plugins list (TikTok checks plugins.length === 0 → bot) ────────────
try {
    if (navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
            get: () => [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' }],
            configurable: true,
        });
    }
} catch (_) { }

// ── Spoof languages to avoid empty-array detection ──────────────────────────
try {
    if (!navigator.languages || navigator.languages.length === 0) {
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
            configurable: true,
        });
    }
} catch (_) { }
