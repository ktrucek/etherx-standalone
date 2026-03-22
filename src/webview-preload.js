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

// ── Keep JS fingerprint consistent with injected Windows Chrome UA ───────────
// The app sets a Windows Chrome UA for webviews. If platform/vendor/userAgentData
// still expose Linux/Electron defaults, anti-bot checks can flag the session.
try {
    Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32',
        configurable: true,
    });
} catch (_) { }

try {
    Object.defineProperty(navigator, 'vendor', {
        get: () => 'Google Inc.',
        configurable: true,
    });
} catch (_) { }

try {
    if (!navigator.userAgentData) {
        const uaData = {
            brands: [
                { brand: 'Chromium', version: '135' },
                { brand: 'Google Chrome', version: '135' },
                { brand: 'Not.A/Brand', version: '24' }
            ],
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: async (hints = []) => {
                const values = {
                    architecture: 'x86',
                    bitness: '64',
                    formFactors: ['Desktop'],
                    fullVersionList: [
                        { brand: 'Chromium', version: '135.0.0.0' },
                        { brand: 'Google Chrome', version: '135.0.0.0' },
                        { brand: 'Not.A/Brand', version: '24.0.0.0' }
                    ],
                    model: '',
                    platform: 'Windows',
                    platformVersion: '10.0.0',
                    uaFullVersion: '135.0.0.0',
                    wow64: false
                };
                const out = {};
                for (const key of hints) {
                    if (Object.prototype.hasOwnProperty.call(values, key)) {
                        out[key] = values[key];
                    }
                }
                return out;
            }
        };
        Object.defineProperty(navigator, 'userAgentData', {
            get: () => uaData,
            configurable: true,
        });
    }
} catch (_) { }
