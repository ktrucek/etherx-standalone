/**
 * EtherX Browser — Webview Preload
 * Injected into every webview (persist:etherx session) before any page JS runs.
 * Purpose: spoof bot-detection properties so sites like TikTok, Instagram,
 * Twitter/X, etc. treat the webview as a normal browser window.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'chrome-extension:') {
    contextBridge.exposeInMainWorld('liveos', {
        getSnapshot: () => ipcRenderer.invoke('liveos:getSnapshot'),
        subscribe: () => ipcRenderer.invoke('liveos:subscribe'),
        unsubscribe: () => ipcRenderer.invoke('liveos:unsubscribe'),
        command: (action) => ipcRenderer.invoke('liveos:command', action),
        onSnapshot: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const listener = (_event, snapshot) => callback(snapshot);
            ipcRenderer.on('liveos:snapshot', listener);
            return () => ipcRenderer.removeListener('liveos:snapshot', listener);
        },
    });
}

// The page-world wrapper installed by the host dispatches these events around
// getDisplayMedia(). Relay them safely to the owning BrowserWindow so private
// TikTok Chat AI UI can be hidden while the user shares their screen.
window.addEventListener('etherx-screen-share', (event) => {
    try {
        const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
        ipcRenderer.sendToHost('etherx-screen-share', { active: detail.active === true });
    } catch (_) { }
});

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

// ── 🔥 PERFORMANCE: Auto-inject resource hints for common CDNs ───────────────
// Preconnect to popular CDNs/APIs as soon as page loads → faster asset loading
try {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectResourceHints);
    } else {
        injectResourceHints();
    }

    function injectResourceHints() {
        const commonCDNs = [
            'https://fonts.googleapis.com',
            'https://fonts.gstatic.com',
            'https://cdnjs.cloudflare.com',
            'https://cdn.jsdelivr.net',
            'https://unpkg.com',
            'https://ajax.googleapis.com',
            'https://code.jquery.com',
            'https://stackpath.bootstrapcdn.com',
            'https://maxcdn.bootstrapcdn.com',
            'https://use.fontawesome.com'
        ];

        const head = document.head || document.getElementsByTagName('head')[0];

        if (!head) return;

        const referencedHosts = new Set();
        document.querySelectorAll('link[href], script[src], img[src], source[src]').forEach((el) => {
            const raw = el.getAttribute('href') || el.getAttribute('src');
            if (!raw) return;
            try {
                referencedHosts.add(new URL(raw, location.href).hostname);
            } catch (_) { }
        });

        commonCDNs.forEach(cdn => {
            const domain = new URL(cdn).hostname;

            // Check if page references this CDN without materializing the entire DOM as HTML
            if (referencedHosts.has(domain)) {
                // Check if preconnect already exists
                const existing = head.querySelector(`link[rel="preconnect"][href="${cdn}"]`);
                if (!existing) {
                    const link = document.createElement('link');
                    link.rel = 'preconnect';
                    link.href = cdn;
                    link.crossOrigin = 'anonymous';
                    head.appendChild(link);
                }
            }
        });
    }
} catch (_) { }
