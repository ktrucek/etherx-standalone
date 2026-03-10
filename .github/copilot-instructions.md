# EtherX Browser — Copilot Instructions

## Project Overview

EtherX is a **dual-mode Electron + Web browser** built with Electron v33 and Node.js 20. It runs as a full desktop app (Electron) or as a web app loaded directly via `src/index.html`. The "standalone" designation means **no n8n proxy, no kriptoentuzijasti.io backend** — all features are self-contained.

## Architecture

### Process Boundary (Critical)

```
Main Process (main.js)         ←IPC→   Renderer (browser.html + browser.js)
  └─ src/main/*.js modules              └─ window.etherx.*  (via preload.js)
       database.js (SQLite)             └─ window.electronAPI (legacy compat)
       ai.js
       adBlocker.js
       passwordManager.js
       security.js, i18n.js, qrSync.js, userAgent.js, defaultBrowser.js
```

- **Never access Node.js APIs from renderer** — use `window.etherx.<namespace>.*` IPC calls defined in `preload.js`.
- **`preload.js`** is the sole bridge. Every new main-process feature must be exposed here via `contextBridge.exposeInMainWorld('etherx', {...})`.
- All main modules are loaded with `try/catch` in `main.js` (native `.node` addons can crash on arch mismatch): `try { DatabaseManager = require('./src/main/database'); } catch (e) {...}`.

### Dual-Mode Rendering

`browser.js` detects Electron at runtime:

```js
window.electronWebview = typeof window.electronAPI !== "undefined";
```

- **Electron mode**: uses `<webview>` tag with full navigation events.
- **Web mode**: falls back to `<iframe id="browseFrameWeb">`, renamed to `browseFrame` at runtime. Always code against `#browseFrame` — the swap is transparent.

### Data Persistence

| Data                               | Storage                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Tabs, history, bookmarks, settings | `better-sqlite3` → `etherx.db` in `app.getPath('userData')`                |
| Passwords                          | Separate `etherx_passwords.db`, AES-256-GCM encrypted, key never persisted |
| Incognito tabs                     | `Map` in RAM only (`INCOGNITO_TABS`) — **never written to SQLite**         |
| Web-mode fallback                  | `localStorage` keys: `ex_hist`, `ex_bm`, `ex_cfg`                          |

Database schema is versioned via `_migrate()` in `database.js` — add new tables in numbered `if (currentVersion < N)` blocks.

### IPC Channel Naming

Channels follow `namespace:action` convention: `db:saveTab`, `ai:smartSearch`, `passwords:unlockVault`, `adblock:toggle`. Match this pattern when adding new handlers.

## Developer Workflows

### Run / Debug

```bash
npm start                    # Electron app
npm run dev                  # Electron with Node inspector on :5858
```

### Build Distributables

```bash
npm run dist:linux           # AppImage + .deb → dist/
npm run dist:win             # Portable + ZIP
npm run dist:mac             # DMG + ZIP
```

> Requires `npm ci` first — native addons (`better-sqlite3`, `bcrypt`) are compiled via `electron-rebuild` on `postinstall`.

### Deploy (Version Bump + Git Tag + Push)

```bash
./deploy.sh                  # auto-increment patch (e.g. 2.4.28 → 2.4.29)
./deploy.sh 2.5.0            # set specific version
./deploy.sh --no-push        # local commit + tag only
```

`deploy.sh` bumps version in **both** `package.json` AND `src/index.html` (`#helpVersionNum`, `#helpVersionNum2` spans). Pushing a `v*` tag triggers GitHub Actions CI (`.github/workflows/build.yml`) to build Linux/Windows/macOS artifacts automatically.

### CI Requirements

Build matrix needs: Node 20 LTS, Python 3, `build-essential`, `libsecret-1-dev` (Linux), MSVC 2022 (Windows). Native addons compile with `CXXFLAGS=-std=c++20`.

## Key Conventions

### Security Defaults

- TLS 1.3 enforced via `app.commandLine.appendSwitch('ssl-version-min', 'tls1.3')` in `main.js`.
- `disable-gpu` / `no-sandbox` flags applied **only on non-macOS** (blank window on Apple Silicon otherwise).
- HTTP → HTTPS auto-upgrade in `security.js` via `webRequest.onBeforeRequest`.
- Password vault uses PBKDF2-SHA256 with 600,000 iterations; master password is **never stored**.

### Settings Cache Pattern

Renderer-side settings reads use a 5-second in-memory TTL cache (`_settingsCache`, `SETTINGS_CACHE_TTL = 5000`). Don't bypass this for frequent reads.

### IPC Guard

`_ipcSetupDone` boolean in `main.js` prevents duplicate IPC handler registration on `app.on('second-instance', ...)`. Wrap new IPC setup blocks under the same guard.

### AI Features

- **Main process** (`ai.js`): phishing detection, smart search classification, reading-mode extraction, tab grouping, page summarization via Gemini API (key stored in SQLite settings as `gemini_api_key`).
- **Renderer** (WebLLM): on-device LLM via Web Worker/WebGPU for omnibox AI answers. The main process module is a CPU-side fallback only.
- AI page summaries are cached in `ai_cache` table (keyed by MD5 of URL) to avoid redundant API calls.

### Ad Blocker

Primary: `@cliqz/adblocker-electron` with prebuilt EasyList. Fallback (if native addon fails): bundled `assets/filters/filters.txt` + hardcoded domain list in `adBlocker.js`.

### i18n

Croatian (`hr`) is the default language. All UI strings live in `src/main/i18n.js` as a flat `STRINGS` object per locale. Add new keys to **all** supported locales (13 total) simultaneously.

## Key Files

| File                          | Role                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `main.js`                     | Electron entry: window creation, IPC handlers, module wiring     |
| `preload.js`                  | Full IPC surface exposed to renderer as `window.etherx`          |
| `src/renderer/js/browser.js`  | ~5100-line renderer: tabs, navigation, UI, all user interactions |
| `src/main/database.js`        | SQLite schema + versioned migrations                             |
| `src/main/passwordManager.js` | AES-256-GCM vault, Bitwarden-compatible export                   |
| `src/main/ai.js`              | Phishing detection, smart search, Gemini summarization           |
| `deploy.sh`                   | Version bump + git tag + CI trigger                              |
| `.github/workflows/build.yml` | Multi-platform electron-builder CI                               |
