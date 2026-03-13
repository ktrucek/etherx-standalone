# EtherX Standalone Browser - Changelog & Technical Documentation

## Version 2.4.28 (March 8, 2026)

### 🎯 Major Features Implemented

---

## 1. Native CORS Bypass (Electron webRequest API)

**Problem Solved:**

- Cross-Origin Resource Sharing (CORS) restrictions were blocking API calls and iframe embedding
- Previous solution (proxy.php) required external server and was slow

**Implementation:**

- Location: `main.js` lines 244-345
- Uses Electron's native `session.defaultSession.webRequest` API
- Operates at OS network level (before browser security kicks in)

**How it works:**

### Step 1: Remove problematic headers from outgoing requests

```javascript
session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
  delete details.requestHeaders["Origin"];
  delete details.requestHeaders["Referer"];
  // Logs request to networkLog array
});
```

### Step 2: Add CORS headers to incoming responses

```javascript
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  details.responseHeaders["Access-Control-Allow-Origin"] = ["*"];
  details.responseHeaders["Access-Control-Allow-Methods"] = [
    "GET, POST, PUT, DELETE, OPTIONS",
  ];
  details.responseHeaders["Access-Control-Allow-Headers"] = ["*"];
  delete details.responseHeaders["Content-Security-Policy"];
  delete details.responseHeaders["X-Frame-Options"];
});
```

**Benefits:**

- ✅ No external proxy needed
- ✅ Faster (native implementation)
- ✅ More powerful (bypasses CSP, X-Frame-Options)
- ✅ Works for all requests (fetch, XHR, iframe)

---

## 2. Network Monitoring System

**Problem Solved:**

- No visibility into HTTP requests without opening DevTools
- Debugging API issues was difficult

**Implementation:**

- Location: `main.js` lines 244-345, 527-537
- In-memory request log (max 500 entries, FIFO)
- Real-time updates to renderer process

**Data Structure:**

```javascript
networkLog = [
  {
    id: 1234567890,          // Timestamp
    url: "https://api.example.com/data",
    method: "GET",
    resourceType: "xhr",
    headers: {...},
    statusCode: 200,
    duration: 145,           // milliseconds
    error: null,
    fromCache: false
  },
  // ... up to 500 entries
]
```

**IPC API (exposed via preload.js):**

```javascript
// Get network log (last 100 entries)
const log = await window.etherx.network.getLog();

// Clear network log
await window.etherx.network.clearLog();

// Listen for real-time updates
window.etherx.network.onUpdate((entry) => {
  console.log("New request:", entry);
});
```

**Usage in renderer:**

```javascript
// src/index.html lines 15521+
if (window.etherx?.network) {
  const log = await window.etherx.network.getLog();
  console.table(log);
}
```

---

## 3. Service Worker (Offline Support)

**Problem Solved:**

- Web version (non-Electron) had no offline capability
- No caching for frequently used assets

**Implementation:**

- Location: `sw.js` (223 lines, root directory)
- Cache version: `etherx-v2.4.26`
- Only active in web mode (disabled in Electron)

**Features:**

### A. Offline Mode

```javascript
// Install event - cache core assets
self.addEventListener("install", (event) => {
  caches.open("etherx-v2.4.26").then((cache) => {
    return cache.addAll(["/src/index.html", "/assets/filters/filters.txt"]);
  });
});
```

### B. Network-First Caching Strategy

```javascript
// Fetch event - try network first, fallback to cache
fetch(request)
  .then((response) => {
    cache.put(request, response.clone());
    return response;
  })
  .catch(() => caches.match(request));
```

### C. Background Sync

```javascript
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-settings") {
    // Sync settings when back online
  }
});
```

### D. Push Notifications

```javascript
self.addEventListener("push", (event) => {
  const options = {
    body: event.data.text(),
    icon: "/src/logo_novi.png",
  };
  self.registration.showNotification("EtherX", options);
});
```

**Conditional Registration:**

```javascript
// src/index.html lines 15523-15559
if (!window.electronAPI && location.protocol !== "file:") {
  navigator.serviceWorker.register("/sw.js");
} else {
  console.log("Service Worker disabled (Electron mode)");
}
```

**Why disabled in Electron?**

- Electron has native CORS bypass (more powerful)
- Service Worker can't override Electron's webRequest API
- Conflicts with network monitoring
- Electron handles offline mode differently

---

## 4. Service Worker Status Panel

**Location:** Settings > Advanced > Service Worker Status

**Implementation:**

- Settings panel: `src/index.html` lines 6633-6661
- Status update function: `src/index.html` lines 15383-15437

**Displays:**

- ✅ Registration status (Active / Not Registered)
- 📍 Service Worker scope
- 🏷️ Cache version
- 🗑️ Clear cache button

**Screenshot-like structure:**

```
┌─────────────────────────────────────┐
│ Service Worker Status               │
├─────────────────────────────────────┤
│ Status:        ● Active             │
│ Scope:         /                    │
│ Cache Version: etherx-v2.4.26       │
│                                     │
│ [Clear Service Worker Cache]        │
└─────────────────────────────────────┘
```

---

## 5. Bug Fixes

### A. Browser Crash on Page Load Failure

**Problem:**

```
⊗ Unexpected error while loading URL {}
```

Browser crashed when loading failed pages (DNS errors, timeout, etc.)

**Root Cause:**

```javascript
// src/index.html line 9067 (OLD CODE)
mainWindow.webContents.on("did-fail-load", (e, errorCode, errorDescription) => {
  showPageError(errorDescription); // ❌ Function doesn't exist!
});
```

**Fix:**

```javascript
// src/index.html line 9067 (NEW CODE)
mainWindow.webContents.on("did-fail-load", (e, errorCode, errorDescription) => {
  const errMsg = errorDescription || "Unknown error";
  consoleLog(
    "error",
    `Page load failed: ${errMsg} (code: ${errorCode})`,
    tab.url,
  );
});
```

**Result:**

```
✅ Clear error messages:
⊗ Page load failed: ERR_NAME_NOT_RESOLVED (code: -105)
⊗ Page load failed: ERR_CONNECTION_TIMED_OUT (code: -118)
```

---

## 6. Deployment Script (`deploy.sh`)

**Location:** `standalone-browser/deploy.sh` (executable)

**Purpose:**

- Automate version bumping
- Commit changes to git
- Push to GitHub (triggers Actions build)

**Usage:**

```bash
# Auto-increment patch version (2.4.28 → 2.4.29)
./deploy.sh

# Set specific version
./deploy.sh 3.0.0

# Local commit only (no GitHub push)
./deploy.sh --no-push
```

**What it does:**

1. ✅ Check for uncommitted changes
2. ✅ Bump version in `package.json`
3. ✅ Update version in `src/index.html` (`<span id="helpVersionNum">`)
4. ✅ Create git commit
5. ✅ Create git tag `vX.Y.Z`
6. ✅ Push to GitHub (triggers build workflow)

**Output:**

```
[deploy] Pre-flight checks...
[deploy] Current version: 2.4.28
[deploy] New version:     2.4.29
Deploy v2.4.29? [Y/n] y
[✓] package.json updated (buildTime: 2026-03-08T23:15:00Z)
  ✓ src/index.html version updated
[✓] Committed v2.4.29
[✓] Tagged: v2.4.29
[✓] Pushed to origin/main
[✓] Pushed tag: v2.4.29

════════════════════════════════════════
  ✅ Deploy Complete: v2.4.29
════════════════════════════════════════

  📦 Version:   v2.4.29
  🔖 Git tag:   v2.4.29
  🌐 GitHub:    https://github.com/ktrucek/etherx-standalone

  🚀 GitHub Actions should trigger build now...
  🔗 Check: https://github.com/ktrucek/etherx-standalone/actions
```

---

## 7. Fixed `deploy-etherx-standalone.sh`

**Problem:**

- Old script copied files to `/tmp` (deleted after server restart)
- Used temporary directories instead of real project folder
- Force-pushed old versions without new features

**Fix:**

- Now works directly in `standalone-browser/` folder
- No `/tmp` usage
- Commits real changes, not copies

**Changes:**

- Line 117: Removed `TEMP_DIR=$(mktemp -d)`
- Line 124: Changed from `cp -r "$STANDALONE_DIR/"* "$TEMP_DIR/"` to `cd "$STANDALONE_DIR"`
- Line 132: Works in `$STANDALONE_DIR` instead of `$TEMP_DIR`

---

## Technical Architecture

### File Structure

```
standalone-browser/
├── main.js                    # Electron main process (CORS + network monitoring)
├── preload.js                 # IPC bridge (exposes APIs to renderer)
├── sw.js                      # Service Worker (web mode only)
├── package.json               # v2.4.28, buildTime metadata
├── deploy.sh                  # Deployment script
├── README.md                  # GitHub Pages documentation
├── CHANGELOG.md               # This file
├── assets/
│   └── filters/
│       └── filters.txt        # Ad blocker rules
└── src/
    ├── index.html             # Main browser UI (15,566 lines)
    ├── logo_novi.png
    ├── main/                  # Electron main modules
    │   ├── main.js            # Same as root main.js
    │   ├── ai.js
    │   ├── database.js
    │   ├── passwordManager.js
    │   └── ...
    ├── preload/
    │   └── preload.js         # Same as root preload.js
    └── renderer/
        ├── browser.html
        ├── newtab.html
        ├── settings.html
        └── css/, js/
```

### Dual Mode Architecture

**Electron Mode (Desktop):**

```
main.js (Electron) → preload.js (IPC) → index.html (Renderer)
                ↓
         webRequest API
         (CORS bypass)
                ↓
         networkLog
```

**Web Mode (Browser):**

```
index.html (Standalone) → sw.js (Service Worker)
                              ↓
                         Cache API
                              ↓
                      Offline support
```

### IPC Communication Flow

```
┌─────────────┐                  ┌──────────────┐                ┌──────────────┐
│  main.js    │                  │  preload.js  │                │ index.html   │
│  (Node.js)  │                  │  (Bridge)    │                │ (Renderer)   │
└─────────────┘                  └──────────────┘                └──────────────┘
      │                                 │                                │
      │ ipcMain.handle                  │                                │
      │ ('network:getLog')              │                                │
      │◄────────────────────────────────┼────────────────────────────────│
      │                                 │                                │
      │ return networkLog.slice(-100)   │                                │
      ├────────────────────────────────►│                                │
      │                                 │ ipcRenderer.invoke             │
      │                                 ├───────────────────────────────►│
      │                                 │                                │
      │ mainWindow.webContents.send     │                                │
      │ ('network-log', entry)          │                                │
      ├────────────────────────────────►│                                │
      │                                 │ ipcRenderer.on                 │
      │                                 ├───────────────────────────────►│
```

---

## API Reference

### Network Monitoring API

**Exposed via:** `window.etherx.network`

#### `getLog()`

Returns array of last 100 network requests.

```javascript
const log = await window.etherx.network.getLog();
console.table(log);
```

**Returns:**

```typescript
Array<{
  id: number; // Timestamp
  url: string;
  method: string; // GET, POST, etc.
  resourceType: string; // xhr, script, image, etc.
  headers: object;
  statusCode?: number;
  duration?: number; // milliseconds
  error?: string;
  fromCache?: boolean;
}>;
```

#### `clearLog()`

Clears the network log.

```javascript
await window.etherx.network.clearLog();
```

#### `onUpdate(callback)`

Listen for real-time network events.

```javascript
window.etherx.network.onUpdate((entry) => {
  console.log(`${entry.method} ${entry.url} - ${entry.statusCode}`);
});
```

---

## GitHub Actions Build

**Trigger:** Push tag `v*` (e.g., `v2.4.29`)

**Workflow:** `.github/workflows/build.yml`

**Builds:**

- 🐧 Linux: AppImage, .deb
- 🪟 Windows: Portable .exe, ZIP
- 🍎 macOS: .dmg (x64 + arm64)

**Artifacts:** Uploaded to GitHub Release `vX.Y.Z`

**Build time:** ~20-30 minutes

---

## Known Limitations

1. **Service Worker only in web mode**
   - Electron mode uses native CORS bypass instead
   - Service Worker would conflict with webRequest API

2. **Network log limited to 500 entries**
   - FIFO (oldest removed first)
   - Can be increased by changing `MAX_LOG_SIZE` in main.js

3. **CORS bypass only in Electron mode**
   - Web mode uses Service Worker (less powerful)
   - Web mode still subject to browser CORS policy

4. **No HAR export yet**
   - Network log stored in memory only
   - TODO: Add HAR (HTTP Archive) export functionality

---

## Migration Notes

### From Old Structure (main repo)

If migrating from `etherx-browser-2` main repo:

1. ✅ Copy `standalone-browser/` folder
2. ✅ Ensure root `main.js`, `preload.js` exist
3. ✅ Check `package.json` has `buildTime` field
4. ✅ Verify `.github/workflows/build.yml` exists
5. ✅ Run `./deploy.sh` to push first version

### GitHub Setup

```bash
# Add remote
git remote add origin https://github.com/ktrucek/etherx-standalone.git

# First push
git push -u origin main
git push origin v2.4.28
```

---

## Troubleshooting

### Build doesn't trigger on GitHub

**Check:**

1. Tag pushed? `git ls-remote --tags origin`
2. Workflow file exists? `.github/workflows/build.yml`
3. GitHub Actions enabled? Settings → Actions → Allow all actions

**Fix:**

```bash
# Re-push tag
git tag -d v2.4.28
git tag v2.4.28
git push -f origin v2.4.28
```

### Service Worker not registering

**Check:**

1. Running in Electron? (Should be disabled)
2. Using HTTPS or localhost? (Required for SW)
3. Browser console errors?

**Debug:**

```javascript
navigator.serviceWorker.register("/sw.js").then(
  (reg) => console.log("SW registered:", reg),
  (err) => console.error("SW failed:", err),
);
```

### Network monitoring not working

**Check:**

1. Running in Electron mode? (Web mode doesn't have this)
2. `window.etherx.network` exists?

**Debug:**

```javascript
if (window.etherx?.network) {
  console.log("Network API available ✓");
} else {
  console.log("Network API not available (web mode?)");
}
```

---

## Future Improvements (TODO)

- [ ] Network panel UI in DevTools
- [ ] HAR export functionality
- [ ] Network request filtering (by URL, method, status)
- [ ] Request/response body inspection
- [ ] Network waterfall chart
- [ ] Request replay functionality
- [ ] Service Worker update notifications
- [ ] Background sync UI

---

## Credits

**Developer:** kriptoentuzijasti.io Team  
**Version:** 2.4.28  
**Date:** March 8, 2026  
**Repository:** https://github.com/ktrucek/etherx-standalone  
**Live Demo:** https://ktrucek.github.io/etherx-standalone

---

## License

© 2024-2026 kriptoentuzijasti.io. All Rights Reserved.  
Proprietary and Confidential.
