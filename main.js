"use strict";

const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  protocol,
  clipboard,
  Menu,
} = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const { execFile } = require("child_process");
let AdmZip;
try {
  AdmZip = require("adm-zip");
} catch (_) {
  /* optional — needed only for CWS extension downloads */
}

// 🔥 PERFORMANCE: V8 Memory & Performance Tuning
const os = require("os");
const totalMem = os.totalmem() / 1024 / 1024 / 1024; // GB

// Allocate 25% of system RAM for Electron (max 4GB)
const maxMem = Math.min(Math.floor(totalMem * 0.25) * 1024, 4096);

app.commandLine.appendSwitch(
  "js-flags",
  `--max-old-space-size=${maxMem} ` + // Heap limit
  "--optimize-for-size " + // Memory over speed
  "--gc-interval=100 " + // More frequent GC
  "--expose-gc", // Allow manual GC
);

// ─── Command-line switches ─────────────────────────────────────────────────────
// disable-gpu kills rendering on macOS (blank window on Apple Silicon + Intel Rosetta)
// Only apply on Linux headless/CI environments — on desktop keep GPU enabled for performance
const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const isHeadless =
  process.env.DISPLAY === undefined && process.platform === "linux";
// Linux-safe default: many driver stacks render a black window with HW acceleration.
// Set ETHERX_ENABLE_GPU=1 to opt back into GPU acceleration.
const forceDisableGpu =
  process.env.ETHERX_DISABLE_GPU === "1" ||
  (process.platform === "linux" && process.env.ETHERX_ENABLE_GPU !== "1");
const forceDisableGpuSandbox = process.env.ETHERX_DISABLE_GPU_SANDBOX === "1";
const aggressiveGpuFlags = process.env.ETHERX_GPU_AGGRESSIVE === "1";
const enableLinuxVaapi = process.env.ETHERX_ENABLE_VAAPI === "1";

if (forceDisableGpu) {
  app.disableHardwareAcceleration();
}

if (process.platform !== "darwin") {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-dev-shm-usage");

  // Disable GPU only in CI/headless environments — on desktop keep GPU enabled for performance
  if (isCI || isHeadless || forceDisableGpu) {
    app.commandLine.appendSwitch("disable-gpu");
    if (isCI || isHeadless) {
      app.commandLine.appendSwitch("disable-software-rasterizer");
    }
  } else {
    // Stable desktop profile: keep HW accel, but avoid aggressive flags by default.
    // Some Windows GPUs show corrupted frames with zero-copy / blocklist overrides.
    app.commandLine.appendSwitch("enable-gpu-rasterization");
    if (process.platform === "win32" && aggressiveGpuFlags) {
      app.commandLine.appendSwitch("enable-zero-copy");
    }
    if (aggressiveGpuFlags) {
      app.commandLine.appendSwitch("ignore-gpu-blocklist");
    }
    app.commandLine.appendSwitch("enable-accelerated-2d-canvas");
    // Linux can show audio-without-video on some GPU/driver stacks when decode is forced.
    if (process.platform !== "linux" || enableLinuxVaapi) {
      app.commandLine.appendSwitch("enable-accelerated-video-decode");
    }
  }
}
// Keep GPU sandbox enabled by default for stability. Allow explicit override only.
if (isCI || isHeadless || forceDisableGpuSandbox) {
  app.commandLine.appendSwitch("disable-gpu-sandbox");
}

// Allow video autoplay without user gesture (required for YouTube, TikTok, Twitch, etc.)
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// IMPORTANT: DO NOT set enable-features here — it will be set later in DoH config
// to avoid OVERWRITING by second call (Chromium bug: last appendSwitch wins)
// Force enable H.264/AAC codec support for media playback in webviews
// app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder,PlatformHEVCVideoDecoder');

// TLS 1.3 enforcement
app.commandLine.appendSwitch("ssl-version-min", "tls1.3");
app.commandLine.appendSwitch(
  "cipher-suite-blacklist",
  "TLS_RSA_WITH_RC4_128_MD5,TLS_RSA_WITH_RC4_128_SHA,TLS_RSA_WITH_3DES_EDE_CBC_SHA",
);

app.setName("EtherX Browser");

// ─── Global UA fallback — must be set before app.ready ───────────────────────
// Prevents Electron from ever sending "Electron/x.x" in any session that hasn't
// had setUserAgent() called on it (e.g. extension background pages, new sessions).
const CHROME_CLEAN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
app.userAgentFallback = CHROME_CLEAN_UA;

// ─── New modules (wrapped in try/catch — native modules can crash on wrong arch) ─
let DatabaseManager, AdBlocker, SecurityManager, PasswordManager, SecretStore;
let QRSyncManager, DefaultBrowser, UserAgentManager, I18nManager, AIManager;
try {
  DatabaseManager = require("./src/main/database");
} catch (e) {
  console.error("❌ database module failed:", e.message);
}
try {
  AdBlocker = require("./src/main/adBlocker");
} catch (e) {
  console.error("❌ adBlocker module failed:", e.message);
}
try {
  SecurityManager = require("./src/main/security");
} catch (e) {
  console.error("❌ security module failed:", e.message);
}
try {
  PasswordManager = require("./src/main/passwordManager");
} catch (e) {
  console.error("❌ passwordManager module failed:", e.message);
}
try {
  SecretStore = require("./src/main/secretStore");
} catch (e) {
  console.error("❌ secretStore module failed:", e.message);
}
try {
  QRSyncManager = require("./src/main/qrSync");
} catch (e) {
  console.error("❌ qrSync module failed:", e.message);
}
try {
  DefaultBrowser = require("./src/main/defaultBrowser");
} catch (e) {
  console.error("❌ defaultBrowser module failed:", e.message);
}
try {
  UserAgentManager = require("./src/main/userAgent");
} catch (e) {
  console.error("❌ userAgent module failed:", e.message);
}
try {
  I18nManager = require("./src/main/i18n");
} catch (e) {
  console.error("❌ i18n module failed:", e.message);
}
try {
  AIManager = require("./src/main/ai");
} catch (e) {
  console.error("❌ ai module failed:", e.message);
}

// ─── DoH startup config ───────────────────────────────────────────────────────
// Read DoH preference from a small JSON config file (written by renderer at runtime)
// and apply before app.ready (commandLine changes require this)
(function applyStartupDoH() {
  try {
    const cfgPath = path.join(app.getPath("userData"), "etherx_doh.json");
    const features = [];

    if (process.platform !== "linux" || enableLinuxVaapi) {
      features.push(
        "VaapiVideoDecoder",
        "VaapiVideoEncoder",
        "PlatformHEVCVideoDecoder",
      );
    }

    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (cfg.enabled) {
        const provider = cfg.provider || "cloudflare";
        const templates = {
          cloudflare: "https://cloudflare-dns.com/dns-query{?dns}",
          google: "https://dns.google/dns-query{?dns}",
          quad9: "https://dns.quad9.net/dns-query{?dns}",
        };
        const tmpl = templates[provider] || templates.cloudflare;
        // Add DnsOverHttps to features. Use automatic mode to allow
        // fallback to system DNS if DoH endpoint is unavailable.
        features.push("DnsOverHttps");
        app.commandLine.appendSwitch("dns-over-https-mode", "automatic");
        app.commandLine.appendSwitch(
          "dns-over-https-server-uri-template",
          tmpl,
        );
      }
    }

    // Set enable-features ONLY ONCE here (avoid overwrite bug)
    if (features.length) {
      app.commandLine.appendSwitch("enable-features", features.join(","));
    }
  } catch (_) {
    /* ignore */
  }
})();

// ─── Global state ─────────────────────────────────────────────────────────────
let mainWindow = null;
let db = null;
let adBlocker = null;
let ai = null;
let secretStore = null;
let _rendererRecoveryAttempted = false;
const INCOGNITO_TABS = new Map(); // RAM-only, never persisted
let _ipcSetupDone = false; // guard: prevents duplicate IPC handler registration
const _downloadTrackedSessions = new Set();
let _envBootstrapDone = false;
const RENDERER_STORAGE_FILE = "renderer-storage.json";
let rendererStorageCache = null;

const SECRET_SETTING_KEYS = new Set([
  "geminiApiKey",
  "gemini_api_key",
  "openaiApiKey",
  "openai_api_key",
  "anthropicApiKey",
  "anthropic_api_key",
  "hfApiKey",
  "hf_api_key",
  "openrouterApiKey",
  "openrouter_api_key",
  "groqApiKey",
  "groq_api_key",
  "localAiApiKey",
  "local_ai_api_key",
  "giteaUpdateToken",
  "githubUpdateToken",
]);

function getSecretStore() {
  if (!SecretStore) return null;
  if (!secretStore) secretStore = new SecretStore(app.getPath("userData"));
  return secretStore;
}

function splitSensitiveSettings(settings = {}) {
  const publicSettings = {};
  const secretSettings = {};
  Object.entries(settings || {}).forEach(([key, value]) => {
    if (SECRET_SETTING_KEYS.has(key)) secretSettings[key] = value;
    else publicSettings[key] = value;
  });
  return { publicSettings, secretSettings };
}

function getMergedSettings() {
  const base = db ? db.getSettings() : {};
  const store = getSecretStore();
  return store ? { ...base, ...store.getNamespace("settings") } : { ...base };
}

function saveSettingsSecurely(settings = {}) {
  if (!db) return { ok: false, error: "Database not available" };
  const { publicSettings, secretSettings } = splitSensitiveSettings(settings);
  const store = getSecretStore();
  if (store) {
    const currentSecrets = store.getNamespace("settings");
    const keysToDelete = Object.keys(currentSecrets).filter((key) => !(key in secretSettings));
    if (keysToDelete.length) store.deleteKeys("settings", keysToDelete);
    if (Object.keys(secretSettings).length) store.mergeNamespace("settings", secretSettings);
  }
  return db.saveSettings(publicSettings);
}

function migrateSensitiveSettingsToSecretStore() {
  if (!db) return;
  const store = getSecretStore();
  if (!store) return;
  const current = db.getSettings();
  const { publicSettings, secretSettings } = splitSensitiveSettings(current);
  if (!Object.keys(secretSettings).length) return;
  store.mergeNamespace("settings", secretSettings);
  db.saveSettings(publicSettings);
}

function _getRendererStorageFilePath() {
  return path.join(app.getPath("userData"), RENDERER_STORAGE_FILE);
}

function _loadRendererStorage() {
  if (rendererStorageCache) return rendererStorageCache;

  try {
    const storagePath = _getRendererStorageFilePath();
    if (!fs.existsSync(storagePath)) {
      rendererStorageCache = {};
      return rendererStorageCache;
    }

    const parsed = JSON.parse(fs.readFileSync(storagePath, "utf8"));
    rendererStorageCache =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [
            String(key),
            String(value ?? ""),
          ]),
        )
        : {};
  } catch (error) {
    console.error("Renderer storage load failed:", error.message);
    rendererStorageCache = {};
  }

  return rendererStorageCache;
}

function _persistRendererStorage() {
  try {
    const storagePath = _getRendererStorageFilePath();
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    fs.writeFileSync(
      storagePath,
      JSON.stringify(rendererStorageCache || {}, null, 2),
      "utf8",
    );
    return { ok: true };
  } catch (error) {
    console.error("Renderer storage save failed:", error.message);
    return { ok: false, error: error.message };
  }
}

function _getRendererStorageSnapshot() {
  return { ..._loadRendererStorage() };
}

function _setRendererStorageItem(key, value) {
  const store = _loadRendererStorage();
  store[String(key)] = String(value ?? "");
  return _persistRendererStorage();
}

function _removeRendererStorageItem(key) {
  const store = _loadRendererStorage();
  delete store[String(key)];
  return _persistRendererStorage();
}

function _clearRendererStorage() {
  rendererStorageCache = {};
  return _persistRendererStorage();
}

function _parseEnvLocalText(raw) {
  const out = {};
  String(raw || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const t = String(line || "").trim();
      if (!t || t.startsWith("#")) return;
      const noExport = t.startsWith("export ") ? t.slice(7).trim() : t;
      const eq = noExport.indexOf("=");
      if (eq <= 0) return;
      const k = noExport.slice(0, eq).trim();
      let v = noExport.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    });
  return out;
}

function _readEnvLocalFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    return _parseEnvLocalText(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return {};
  }
}

function _writeEnvLocalFile(filePath, map) {
  const preferred = [
    "ETHERX_TKAI_LICENSE_API_URL",
    "ETHERX_TKAI_LICENSE_API_KEY",
    "ETHERX_TKAI_VALID_HASHES",
    "ETHERX_ADMIN_DEVICE_IDS",
  ];
  const keys = Object.keys(map || {});
  const ordered = [
    ...preferred.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !preferred.includes(k)).sort(),
  ];

  const lines = [
    "# Auto-generated by EtherX Browser (safe defaults).",
    "# This file is local-only and should not be committed.",
    ...ordered.map((k) => `${k}=${map[k] ?? ""}`),
    "",
  ];

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function _ensureRuntimeEnvLocals() {
  if (_envBootstrapDone) return;
  _envBootstrapDone = true;

  const defaults = {
    ETHERX_TKAI_LICENSE_API_URL: "https://kriptoentuzijasti.io/wp-json/ken-webshop/v1/license/validate",
    ETHERX_TKAI_LICENSE_API_KEY: "",
    ETHERX_TKAI_VALID_HASHES: "",
    ETHERX_ADMIN_DEVICE_IDS: "",
  };

  const seedCandidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(__dirname, ".env.local"),
    path.join(path.dirname(process.execPath), ".env.local"),
    path.join(os.homedir(), ".env.local"),
  ];
  const seed = {};
  seedCandidates.forEach((fp) => {
    Object.assign(seed, _readEnvLocalFile(fp));
  });

  const targets = [
    path.join(os.homedir(), ".etherx", ".env.local"),
    path.join(os.homedir(), ".config", "EtherX Browser", ".env.local"),
  ];
  try {
    targets.push(path.join(app.getPath("userData"), ".env.local"));
  } catch (_) {
    // app path may be unavailable very early; static targets still cover runtime.
  }

  targets.forEach((target) => {
    try {
      const cur = _readEnvLocalFile(target);
      const next = { ...defaults, ...cur };

      if (seed.ETHERX_TKAI_LICENSE_API_URL && !next.ETHERX_TKAI_LICENSE_API_URL) {
        next.ETHERX_TKAI_LICENSE_API_URL = seed.ETHERX_TKAI_LICENSE_API_URL;
      }
      if (seed.ETHERX_TKAI_LICENSE_API_KEY && !next.ETHERX_TKAI_LICENSE_API_KEY) {
        next.ETHERX_TKAI_LICENSE_API_KEY = seed.ETHERX_TKAI_LICENSE_API_KEY;
      }
      if (seed.ETHERX_TKAI_VALID_HASHES && !next.ETHERX_TKAI_VALID_HASHES) {
        next.ETHERX_TKAI_VALID_HASHES = seed.ETHERX_TKAI_VALID_HASHES;
      }
      if (seed.ETHERX_ADMIN_DEVICE_IDS && !next.ETHERX_ADMIN_DEVICE_IDS) {
        next.ETHERX_ADMIN_DEVICE_IDS = seed.ETHERX_ADMIN_DEVICE_IDS;
      }

      _writeEnvLocalFile(target, next);
    } catch (_) {
      // Never crash startup due to bootstrap helper.
    }
  });
}

function _getRuntimeEnvTargetPaths() {
  const targets = [
    path.join(os.homedir(), ".etherx", ".env.local"),
    path.join(os.homedir(), ".config", "EtherX Browser", ".env.local"),
  ];
  try {
    targets.push(path.join(app.getPath("userData"), ".env.local"));
  } catch (_) {
    // ignore
  }
  return [...new Set(targets)];
}

function _saveRuntimeLicenseConfig({ apiKey = "", apiUrl = "", validHashes = "" } = {}) {
  _ensureRuntimeEnvLocals();
  const targets = _getRuntimeEnvTargetPaths();
  const patch = {
    ETHERX_TKAI_LICENSE_API_KEY: String(apiKey || "").trim(),
    ETHERX_TKAI_LICENSE_API_URL:
      String(apiUrl || "").trim() ||
      "https://kriptoentuzijasti.io/wp-json/ken-webshop/v1/license/validate",
  };
  if (String(validHashes || "").trim()) {
    patch.ETHERX_TKAI_VALID_HASHES = String(validHashes || "").trim();
  }

  targets.forEach((target) => {
    try {
      const cur = _readEnvLocalFile(target);
      const next = { ...cur, ...patch };
      _writeEnvLocalFile(target, next);
    } catch (_) {
      // ignore
    }
  });

  return _getRuntimeEnvStatus();
}

function _getRuntimeEnvStatus() {
  _ensureRuntimeEnvLocals();
  const targets = _getRuntimeEnvTargetPaths();
  const files = targets.map((target) => {
    const map = _readEnvLocalFile(target);
    const hasKey = !!String(map.ETHERX_TKAI_LICENSE_API_KEY || "").trim();
    const hasUrl = !!String(map.ETHERX_TKAI_LICENSE_API_URL || "").trim();
    const keyLen = String(map.ETHERX_TKAI_LICENSE_API_KEY || "").trim().length;
    return {
      path: target,
      exists: fs.existsSync(target),
      hasKey,
      hasUrl,
      keyLen,
      url: String(map.ETHERX_TKAI_LICENSE_API_URL || "").trim(),
    };
  });

  return {
    ok: true,
    deviceId: _computeDeviceId(),
    files,
  };
}

function _readEnvLocalMap() {
  _ensureRuntimeEnvLocals();
  // Read optional local env overrides (dev/admin use) from common locations.
  // This supports both dev runs and packaged runs started from different folders.
  const envPaths = [];
  const addEnvPath = (basePath) => {
    if (!basePath) return;
    const fp = path.join(basePath, ".env.local");
    if (!envPaths.includes(fp)) envPaths.push(fp);
  };
  const addEnvPathUpward = (startPath, maxDepth = 8) => {
    if (!startPath) return;
    let cur = path.resolve(startPath);
    for (let i = 0; i < maxDepth; i += 1) {
      addEnvPath(cur);
      const parent = path.dirname(cur);
      if (!parent || parent === cur) break;
      cur = parent;
    }
  };

  // Static/runtime-safe locations first.
  addEnvPath(__dirname);
  addEnvPath(process.cwd());
  addEnvPath(path.dirname(process.execPath));
  addEnvPath(os.homedir());
  addEnvPath(path.join(os.homedir(), ".etherx"));
  addEnvPath(path.join(os.homedir(), ".config", "EtherX Browser"));
  if (process.resourcesPath) addEnvPath(process.resourcesPath);

  // Electron-dependent locations can throw when app state is not fully ready.
  try {
    addEnvPath(app.getAppPath());
  } catch (_) { }
  try {
    addEnvPath(path.dirname(app.getAppPath()));
  } catch (_) { }
  try {
    addEnvPath(app.getPath("userData"));
  } catch (_) { }

  // Walk upward from likely runtime anchors to catch repo-root .env.local.
  addEnvPathUpward(process.cwd());
  addEnvPathUpward(__dirname);
  addEnvPathUpward(path.dirname(process.execPath));
  try {
    addEnvPathUpward(app.getAppPath());
  } catch (_) { }

  const out = {};
  envPaths.forEach((envPath) => {
    try {
      if (!envPath || !fs.existsSync(envPath)) return;
      const raw = fs.readFileSync(envPath, "utf8");
      Object.assign(out, _parseEnvLocalText(raw));
    } catch (_) { }
  });
  return out;
}

function _getAdminEnvDebugInfo() {
  const envLocal = _readEnvLocalMap();
  const processRaw =
    process.env.ETHERX_ADMIN_DEVICE_IDS || process.env.ETHERX_ADMIN_DEVICE_ID || "";
  const fileRaw =
    envLocal.ETHERX_ADMIN_DEVICE_IDS || envLocal.ETHERX_ADMIN_DEVICE_ID || "";
  const effectiveRaw = processRaw || fileRaw || "";

  const parseIds = (raw) =>
    String(raw || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);

  return {
    cwd: process.cwd(),
    dirname: __dirname,
    execDir: path.dirname(process.execPath),
    appPath: (() => {
      try {
        return app.getAppPath();
      } catch (_) {
        return null;
      }
    })(),
    userData: (() => {
      try {
        return app.getPath("userData");
      } catch (_) {
        return null;
      }
    })(),
    hasProcessEnv: !!processRaw,
    hasFileEnv: !!fileRaw,
    allowedIdsCount: parseIds(effectiveRaw).length,
    allowedIdsSample: parseIds(effectiveRaw).slice(0, 3),
    deviceId: _computeDeviceId().toLowerCase(),
  };
}

function _getOrCreateInstallId() {
  const fp = path.join(app.getPath("userData"), "etherx_install_id");
  try {
    if (fs.existsSync(fp)) {
      const cur = String(fs.readFileSync(fp, "utf8") || "").trim();
      if (cur) return cur;
    }
    const id = crypto.randomUUID();
    fs.writeFileSync(fp, id, "utf8");
    return id;
  } catch (_) {
    // Worst-case fallback keeps app functional without crashing.
    return `${os.hostname()}|${process.platform}|${process.arch}`;
  }
}

function _computeDeviceId() {
  const seed = [
    _getOrCreateInstallId(),
    os.hostname(),
    process.platform,
    process.arch,
    app.getPath("userData"),
  ].join("|");
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function _getAllowedAdminDeviceIds() {
  const envLocal = _readEnvLocalMap();
  const raw =
    process.env.ETHERX_ADMIN_DEVICE_IDS ||
    process.env.ETHERX_ADMIN_DEVICE_ID ||
    envLocal.ETHERX_ADMIN_DEVICE_IDS ||
    envLocal.ETHERX_ADMIN_DEVICE_ID ||
    "";
  return String(raw || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function _getTkaiRuntimeHashes() {
  const envLocal = _readEnvLocalMap();
  const raw =
    process.env.ETHERX_TKAI_VALID_HASHES ||
    process.env.ETHERX_TKAI_HASHES ||
    envLocal.ETHERX_TKAI_VALID_HASHES ||
    envLocal.ETHERX_TKAI_HASHES ||
    "";

  return String(raw || "")
    .split(/[\n,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[a-f0-9]{64}$/.test(x));
}

async function _validateTkaiLicenseRemote(code, hashrate) {
  const envLocal = _readEnvLocalMap();
  const endpoint =
    process.env.ETHERX_TKAI_LICENSE_API_URL ||
    envLocal.ETHERX_TKAI_LICENSE_API_URL ||
    "https://kriptoentuzijasti.io/wp-json/ken-webshop/v1/license/validate";
  const apiKey =
    process.env.ETHERX_TKAI_LICENSE_API_KEY ||
    envLocal.ETHERX_TKAI_LICENSE_API_KEY ||
    "";

  const body = {
    code: String(code || "").trim(),
    hashrate: String(hashrate || "").trim().toLowerCase(),
  };

  try {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (apiKey) headers["X-ETHERX-KEY"] = apiKey;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }

    return {
      ok: res.ok,
      valid: !!(data && data.valid),
      status: res.status,
      data,
    };
  } catch (err) {
    return {
      ok: false,
      valid: false,
      status: 0,
      error: err?.message || String(err || "Remote validation failed"),
    };
  }
}

function _isAdminDeviceAllowed() {
  const allowed = _getAllowedAdminDeviceIds();
  if (!allowed.length) return { enabled: false, allowed: true, deviceId: _computeDeviceId() };
  const deviceId = _computeDeviceId().toLowerCase();
  return { enabled: true, allowed: allowed.includes(deviceId), deviceId };
}

function broadcastToAllWindows(channel, payload) {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    } catch (_) { }
  });
}

function setupDownloadTracking(ses) {
  if (!ses || _downloadTrackedSessions.has(ses)) return;
  _downloadTrackedSessions.add(ses);
  ses.on("will-download", (_event, item, webContents) => {
    const downloadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id: downloadId,
      url: item.getURL(),
      filename: item.getFilename(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      status: "started",
      ts: Date.now(),
      windowId: BrowserWindow.fromWebContents(webContents)?.id || null,
    };
    broadcastToAllWindows("download-update", payload);
    item.on("updated", () => {
      broadcastToAllWindows("download-update", {
        ...payload,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        status: item.isPaused() ? "paused" : "progressing",
        savePath: item.getSavePath?.() || "",
      });
    });
    item.on("done", (_e2, state) => {
      const finalPayload = {
        ...payload,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        savePath: item.getSavePath?.() || "",
        status: state === "completed" ? "completed" : "failed",
        state,
        ts: Date.now(),
      };
      try {
        if (db) db.addDownload(finalPayload);
      } catch (_) { }
      broadcastToAllWindows("download-update", finalPayload);
    });
  });
}

function resolveProjectRoots() {
  const roots = [];
  const pushIf = (value) => {
    if (!value || roots.includes(value)) return;
    if (!fs.existsSync(value)) return;
    try {
      if (!fs.statSync(value).isDirectory()) return;
    } catch (_) {
      return;
    }
    roots.push(value);
  };

  pushIf(process.cwd());
  pushIf(app.getAppPath());
  pushIf(__dirname);
  pushIf(path.resolve(__dirname, ".."));
  pushIf(path.resolve(__dirname, "..", ".."));

  if (process.resourcesPath) {
    pushIf(process.resourcesPath);
    pushIf(path.join(process.resourcesPath, "app"));
    pushIf(path.join(process.resourcesPath, "app.asar.unpacked"));
  }

  // Nested mirror layout support (repo + etherx-standalone subfolder)
  const extras = roots.slice();
  extras.forEach((root) => {
    pushIf(path.join(root, "etherx-standalone"));
    pushIf(path.join(root, "standalone-browser"));
  });

  return roots;
}

function resolveRequirementsPath() {
  const roots = resolveProjectRoots();
  const candidates = [];
  const pushIf = (value) => {
    if (!value || candidates.includes(value)) return;
    candidates.push(value);
  };

  roots.forEach((root) => {
    pushIf(path.join(root, "requirements.txt"));
    pushIf(path.join(root, "src", "main", "requirements.txt"));
  });

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { path: candidate, tried: candidates };
  }
  return { path: "", tried: candidates };
}

function resolvePythonCandidates(preferredRoot = "") {
  const candidates = [];
  const pushIf = (value) => {
    if (!value || candidates.includes(value)) return;
    candidates.push(value);
  };

  const roots = resolveProjectRoots();
  if (preferredRoot && fs.existsSync(preferredRoot)) {
    roots.unshift(preferredRoot);
  }

  if (process.platform === "win32") {
    roots.forEach((root) => {
      pushIf(path.join(root, ".venv", "Scripts", "python.exe"));
    });
    pushIf("python");
    pushIf("py");
  } else {
    roots.forEach((root) => {
      pushIf(path.join(root, ".venv", "bin", "python"));
    });
    pushIf("python3");
    pushIf("python");
  }
  return candidates;
}

function _withAsarUnpacked(p) {
  if (!p) return p;
  return String(p).replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

function resolvePythonScriptPath(fileName) {
  const relParts = ["src", "main", fileName];
  const candidates = [];
  const pushIf = (value) => {
    if (!value || candidates.includes(value)) return;
    candidates.push(value);
  };

  const fromDirname = path.join(__dirname, ...relParts);
  const fromAppPath = path.join(app.getAppPath(), ...relParts);
  pushIf(_withAsarUnpacked(fromDirname));
  pushIf(fromDirname);
  pushIf(_withAsarUnpacked(fromAppPath));
  pushIf(fromAppPath);

  if (process.resourcesPath) {
    pushIf(path.join(process.resourcesPath, "app.asar.unpacked", ...relParts));
    pushIf(path.join(process.resourcesPath, "app", ...relParts));
    pushIf(path.join(process.resourcesPath, ...relParts));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

function materializePythonScriptForExec(scriptPath, fileName) {
  const script = String(scriptPath || "");
  if (!script) return "";
  const asarSegmentRe = new RegExp(`\\${path.sep}app\\.asar(?:\\${path.sep}|$)`);
  if (!asarSegmentRe.test(script)) return script;
  try {
    const cacheDir = path.join(app.getPath("temp"), "etherx-python-scripts");
    fs.mkdirSync(cacheDir, { recursive: true });
    const outPath = path.join(cacheDir, String(fileName || path.basename(script)));
    const source = fs.readFileSync(script);
    let shouldWrite = true;
    if (fs.existsSync(outPath)) {
      try {
        const existing = fs.readFileSync(outPath);
        shouldWrite = !existing.equals(source);
      } catch (_) { }
    }
    if (shouldWrite) fs.writeFileSync(outPath, source, { mode: 0o600 });
    return outPath;
  } catch (_) {
    const unpacked = _withAsarUnpacked(script);
    if (unpacked && unpacked !== script && fs.existsSync(unpacked)) return unpacked;
    return script;
  }
}

function trimPythonInstallOutput(value, maxLen = 12000) {
  const text = String(value || "").trim();
  if (text.length <= maxLen) return text;
  return text.slice(-maxLen);
}

function isWritableDir(dirPath) {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return false;
    if (!fs.statSync(dirPath).isDirectory()) return false;
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function resolvePythonProjectRoot(reqLookup = undefined) {
  if (app.isPackaged) {
    const fallbackRoot = path.join(app.getPath("userData"), "python_env");
    try {
      fs.mkdirSync(fallbackRoot, { recursive: true });
    } catch (_) { }
    return fallbackRoot;
  }

  const lookup = reqLookup || resolveRequirementsPath();
  if (lookup.path) return path.dirname(lookup.path);

  const tried = Array.isArray(lookup.tried) ? lookup.tried : [];
  for (const reqCandidate of tried) {
    const candidateDir = path.dirname(String(reqCandidate || ""));
    const parsed = path.parse(candidateDir);
    if (candidateDir && candidateDir !== parsed.root && isWritableDir(candidateDir)) {
      return candidateDir;
    }
  }

  const roots = resolveProjectRoots();
  const writableRoots = roots.filter((root) => {
    const parsed = path.parse(root);
    return root && root !== parsed.root && isWritableDir(root);
  });

  const projectLike = writableRoots.find((root) => {
    return fs.existsSync(path.join(root, "package.json")) || fs.existsSync(path.join(root, "src", "main"));
  });
  if (projectLike) return projectLike;
  if (writableRoots.length) return writableRoots[0];

  const fallbackRoot = path.join(app.getPath("userData"), "python-bridge");
  try {
    fs.mkdirSync(fallbackRoot, { recursive: true });
  } catch (_) { }
  return fallbackRoot;
}

async function installPythonBridgeDeps() {
  try {
    const reqLookup = resolveRequirementsPath();
    const fallbackPackages = ["torch", "transformers", "gliclass"];
    const projectRoot = resolvePythonProjectRoot(reqLookup);

    // If packaged, materialize requirements.txt to the writable directory
    if (app.isPackaged) {
      const srcReq = path.join(app.getAppPath(), "requirements.txt");
      const destReq = path.join(projectRoot, "requirements.txt");
      try {
        if (fs.existsSync(srcReq)) {
          fs.writeFileSync(destReq, fs.readFileSync(srcReq));
        } else {
          // If not found, write a minimal default requirements.txt
          fs.writeFileSync(destReq, "torch\ntransformers\ngliclass\n");
        }
      } catch (_) { }
    }

    const requirementsPath = app.isPackaged
      ? path.join(projectRoot, "requirements.txt")
      : reqLookup.path;

    const venvDir = path.join(projectRoot, ".venv");
    const venvPython =
      process.platform === "win32"
        ? path.join(venvDir, "Scripts", "python.exe")
        : path.join(venvDir, "bin", "python");

    let createdVenv = false;
    let venvCreateError = "";
    if (!fs.existsSync(venvPython)) {
      const bootCandidates = resolvePythonCandidates(projectRoot);
      for (const py of bootCandidates) {
        if (path.isAbsolute(py) && !fs.existsSync(py)) continue;
        const mk = await execFileText(py, ["-m", "venv", venvDir], 300000, { cwd: projectRoot });
        if (mk.ok) {
          createdVenv = true;
          venvCreateError = "";
          break;
        }
        if (mk.error?.code === "ENOENT") continue;
        venvCreateError = trimPythonInstallOutput(mk.stderr || mk.stdout || mk.error?.message || "Neuspješno kreiranje .venv");
      }
    }

    if (!fs.existsSync(venvPython)) {
      return {
        ok: false,
        error: venvCreateError || "Ne mogu pronaći ili kreirati Python virtual environment (.venv).",
        requirementsPath,
        projectRoot,
        venvDir,
        tried: reqLookup.tried,
      };
    }

    const pipUpgrade = await execFileText(
      venvPython,
      ["-m", "pip", "install", "--upgrade", "pip"],
      420000,
      { cwd: projectRoot },
    );

    const install = await execFileText(
      venvPython,
      requirementsPath
        ? ["-m", "pip", "install", "-r", requirementsPath]
        : ["-m", "pip", "install", ...fallbackPackages],
      900000,
      { cwd: projectRoot },
    );

    if (!install.ok) {
      return {
        ok: false,
        error: trimPythonInstallOutput(install.stderr || install.stdout || install.error?.message || "pip install nije uspio"),
        createdVenv,
        requirementsPath: requirementsPath || "",
        requirementsFallback: !requirementsPath,
        projectRoot,
        python: venvPython,
        pipUpgrade: pipUpgrade.ok,
        stdout: trimPythonInstallOutput(install.stdout),
        stderr: trimPythonInstallOutput(install.stderr),
        tried: reqLookup.tried,
      };
    }

    return {
      ok: true,
      createdVenv,
      requirementsPath: requirementsPath || "",
      requirementsFallback: !requirementsPath,
      projectRoot,
      python: venvPython,
      pipUpgrade: pipUpgrade.ok,
      stdout: trimPythonInstallOutput(install.stdout),
      stderr: trimPythonInstallOutput(install.stderr),
      tried: reqLookup.tried,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

async function runOneClickLocalSetup() {
  try {
    const reqLookup = resolveRequirementsPath();
    const projectRoot = resolvePythonProjectRoot(reqLookup);
    const ecosystemPath = path.join(projectRoot, "ecosystem.config.cjs");

    // Dynamically generate ecosystem.config.cjs for packaged production application
    if (app.isPackaged) {
      let scriptField = "";
      let argsField = "";
      if (process.platform !== "win32") {
        scriptField = `"sh"`;
        argsField = `["-c", "exec \\"${process.execPath}\\" --no-sandbox"]`;
      } else {
        scriptField = JSON.stringify(process.execPath.replace(/\\/g, "/"));
        argsField = `"--no-sandbox"`;
      }
      const configContent = `module.exports = {
  apps: [
    {
      name: "etherx-browser",
      script: ${scriptField},
      args: ${argsField},
      cwd: "${projectRoot.replace(/\\/g, "/")}",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};`;
      try {
        fs.writeFileSync(ecosystemPath, configContent, "utf8");
      } catch (_) { }
    }

    const python = await installPythonBridgeDeps();
    const result = {
      ok: false,
      projectRoot,
      requirementsPath: app.isPackaged ? path.join(projectRoot, "requirements.txt") : (reqLookup.path || ""),
      python,
      pm2: {
        ok: false,
        step: "",
        saveOk: false,
        status: "",
        stdout: "",
        stderr: "",
        error: "",
      },
    };

    if (!python?.ok) {
      result.pm2.error = "Preskočeno jer Python install nije prošao.";
      return result;
    }

    if (!fs.existsSync(ecosystemPath)) {
      result.pm2.error = "Nedostaje ecosystem.config.cjs";
      return result;
    }

    // Force delete any old registered process to clear PM2 internal cache/metadata for script paths
    await execFileText("npx", ["pm2", "delete", "etherx-browser"], 60000, { cwd: projectRoot });

    const pm2Run = await execFileText(
      "npx",
      ["pm2", "start", ecosystemPath, "--update-env"],
      300000,
      { cwd: projectRoot },
    );
    const pm2Step = "start";

    const pm2Save = await execFileText("npx", ["pm2", "save"], 120000, { cwd: projectRoot });
    const pm2Status = await execFileText("npx", ["pm2", "status", "etherx-browser"], 120000, {
      cwd: projectRoot,
    });

    result.pm2 = {
      ok: !!pm2Run.ok && !!pm2Save.ok,
      step: pm2Step,
      saveOk: !!pm2Save.ok,
      status: trimPythonInstallOutput(pm2Status.stdout || pm2Status.stderr || ""),
      stdout: trimPythonInstallOutput(pm2Run.stdout || ""),
      stderr: trimPythonInstallOutput(pm2Run.stderr || ""),
      error: pm2Run.ok
        ? (pm2Save.ok ? "" : (trimPythonInstallOutput(pm2Save.stderr || pm2Save.stdout || "PM2 save failed")))
        : trimPythonInstallOutput(pm2Run.stderr || pm2Run.stdout || pm2Run.error?.message || "PM2 start failed"),
    };

    result.ok = !!result.python?.ok && !!result.pm2?.ok;
    return result;
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function logPythonBridgeDebug(scope, message, extra = undefined) {
  try {
    if (extra === undefined) {
      console.log(`[AI Python Bridge][${scope}] ${message}`);
    } else {
      console.log(`[AI Python Bridge][${scope}] ${message}`, extra);
    }
  } catch (_) { }
}

function getAugmentedEnv() {
  const env = { ...process.env };
  const os = require("os");
  let pathSeparator = ":";
  let paths = [];

  if (process.platform === "win32") {
    pathSeparator = ";";
    paths = (env.PATH || env.Path || "").split(pathSeparator);
    paths.push(path.join(process.env.APPDATA || "", "npm"));
  } else {
    pathSeparator = ":";
    paths = (env.PATH || "").split(pathSeparator);

    const home = os.homedir();
    const commonPaths = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      path.join(home, ".npm-global", "bin"),
      path.join(home, ".local", "bin"),
      path.join(home, "bin"),
    ];

    try {
      const nvmDir = path.join(home, ".nvm", "versions", "node");
      if (fs.existsSync(nvmDir)) {
        const versions = fs.readdirSync(nvmDir);
        versions.forEach((v) => {
          commonPaths.push(path.join(nvmDir, v, "bin"));
        });
      }
    } catch (_) { }

    commonPaths.forEach((p) => {
      if (p && !paths.includes(p)) {
        paths.push(p);
      }
    });
  }

  env.PATH = paths.filter(Boolean).join(pathSeparator);
  if (process.platform === "win32") {
    env.Path = env.PATH;
  }
  return env;
}

function execFileJson(command, args, timeoutMs = 240000) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: Math.max(5000, Number(timeoutMs || 240000) || 240000),
        maxBuffer: 16 * 1024 * 1024,
        env: getAugmentedEnv(),
        shell: process.platform === "win32",
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, error, stdout: String(stdout || ""), stderr: String(stderr || "") });
          return;
        }
        const raw = String(stdout || "").trim();
        try {
          resolve({ ok: true, data: JSON.parse(raw || "{}") });
        } catch (parseErr) {
          resolve({
            ok: false,
            error: new Error("Invalid JSON from scanner: " + parseErr.message),
            stdout: raw,
            stderr: String(stderr || ""),
          });
        }
      },
    );
  });
}

function execFileText(command, args, timeoutMs = 240000, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: Math.max(5000, Number(timeoutMs || 240000) || 240000),
        maxBuffer: 32 * 1024 * 1024,
        env: getAugmentedEnv(),
        shell: process.platform === "win32",
        ...options,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          error,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
        });
      },
    );
  });
}

// ─── Single instance lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const url = argv.find(
        (a) => a.startsWith("http") || a.startsWith("etherx"),
      );
      if (url) mainWindow.webContents.send("open-url", url);
    }
  });
}

// ─── Native application menu ──────────────────────────────────────────────────
function configureNativeMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "pasteAndMatchStyle" },
          { role: "delete" },
          { role: "selectAll" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}

configureNativeMenu();

// ─── App ready ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Init database (wrapped — better-sqlite3 may fail on wrong arch)
  try {
    if (DatabaseManager) {
      db = new DatabaseManager(app.getPath("userData"));
      await db.init();
      migrateSensitiveSettingsToSecretStore();
      // Prune history on startup if setting exists
      const settings = getMergedSettings();
      if (settings.history_retention_days) {
        const days = parseInt(settings.history_retention_days);
        if (days > 0) db.pruneHistory(days);
      }
    }
  } catch (e) {
    console.error("❌ DB init failed:", e.message);
    db = null;
  }

  // Init ad blocker
  try {
    if (AdBlocker) {
      adBlocker = new AdBlocker(session.defaultSession);
      await adBlocker.init();
    }
  } catch (e) {
    console.error("❌ AdBlocker init failed:", e.message);
    adBlocker = null;
  }

  // Init security
  try {
    if (SecurityManager) SecurityManager.enforce(session.defaultSession);
  } catch (e) {
    console.error("❌ Security init failed:", e.message);
  }

  // Set clean Chrome UA on both sessions so Google OAuth never sees "Electron/x.x".
  // onBeforeSendHeaders patches per-request, but setUserAgent() is what Electron
  // uses for the initial handshake and any request before the handler fires.
  try {
    session.defaultSession.setUserAgent(CHROME_CLEAN_UA);
    session.fromPartition("persist:etherx").setUserAgent(CHROME_CLEAN_UA);
  } catch (e) {
    console.error("❌ UA session init failed:", e.message);
  }

  // Init AI
  try {
    if (AIManager) ai = new AIManager();
  } catch (e) {
    console.error("❌ AI init failed:", e.message);
    ai = null;
  }

  setupDownloadTracking(session.defaultSession);
  try {
    setupDownloadTracking(session.fromPartition("persist:etherx"));
  } catch (_) { }

  // Apply ad blocker to the webview session (persist:etherx) as well
  try {
    if (AdBlocker && adBlocker) {
      const etherxSess = session.fromPartition("persist:etherx");
      adBlocker.blocker?.enableBlockingInSession(etherxSess);
    }
  } catch (e) {
    console.warn("[AdBlocker] persist:etherx enable failed:", e.message);
  }

  // Allow media / fullscreen / clipboard permissions in webviews (required for YouTube, TikTok, etc.)
  try {
    const etherxSess = session.fromPartition("persist:etherx");
    etherxSess.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        // Allow all permissions needed for modern sites:
        // - media: microphone + camera (required for calls, QR scanning, video chat)
        // - videoCapture / audioCapture: explicit camera/mic grants (Electron-specific)
        // - camera: used by some sites (TikTok QR login, video calls)
        const allowed = [
          "media",
          "videoCapture",
          "audioCapture",
          "camera",
          "fullscreen",
          "pointerLock",
          "openExternal",
          "clipboard-read",
          "clipboard-sanitized-write",
          "notifications",
          "geolocation",
          "midi",
          "midiSysex",
          "screen",
        ].includes(permission);
        callback(allowed);
      },
    );
    etherxSess.setPermissionCheckHandler((_webContents, permission) => {
      return [
        "media",
        "videoCapture",
        "audioCapture",
        "camera",
        "fullscreen",
        "pointerLock",
        "clipboard-read",
        "clipboard-sanitized-write",
        "notifications",
        "geolocation",
      ].includes(permission);
    });
    // Inject anti-bot-detection preload into every webview (persist:etherx session)
    // BEFORE any page JS runs. Spoofs navigator.webdriver, window.chrome, plugins,
    // etc. — required for TikTok, Instagram, Twitter/X and similar sites.
    const wvPreloadPath = path.join(__dirname, "src", "webview-preload.js");
    if (fs.existsSync(wvPreloadPath)) {
      etherxSess.setPreloads([wvPreloadPath]);
      console.log("[Webview] Anti-bot preload registered:", wvPreloadPath);
    }
  } catch (e) {
    console.warn("[Permissions] persist:etherx setup failed:", e.message);
  }

  // ── Permissions for the main renderer window (defaultSession) ────────────
  // Required for BPM auto-detection (getUserMedia microphone) and any other
  // feature in the main UI that needs media access.
  try {
    const ALLOWED_MAIN = ["media", "audioCapture", "videoCapture", "camera",
      "fullscreen", "clipboard-read", "clipboard-sanitized-write", "notifications"];
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_MAIN.includes(permission));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return ALLOWED_MAIN.includes(permission);
    });
  } catch (e) {
    console.warn("[Permissions] defaultSession setup failed:", e.message);
  }

  // ── Permissions + preload for persist:tiktok-watcher (TikTok Isolated Mode) ──
  try {
    const tikWatcherSess = session.fromPartition("persist:tiktok-watcher");
    const ALLOWED_TW = ["media", "audioCapture", "videoCapture", "camera",
      "fullscreen", "pointerLock", "openExternal", "clipboard-read",
      "clipboard-sanitized-write", "notifications", "geolocation"];
    tikWatcherSess.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_TW.includes(permission));
    });
    tikWatcherSess.setPermissionCheckHandler((_wc, permission) => {
      return ALLOWED_TW.includes(permission);
    });
    const wvPreloadPath = path.join(__dirname, "src", "webview-preload.js");
    if (fs.existsSync(wvPreloadPath)) {
      tikWatcherSess.setPreloads([wvPreloadPath]);
    }
  } catch (e) {
    console.warn("[Permissions] persist:tiktok-watcher setup failed:", e.message);
  }

  // Auto-load bundled Reveye Reverse Image Search extension
  try {
    const reveyePath = path.join(__dirname, "reveye", "src");
    if (fs.existsSync(path.join(reveyePath, "manifest.json"))) {
      session.defaultSession
        .loadExtension(reveyePath, { allowFileAccess: true })
        .then((ext) => console.log("[Ext] Reveye loaded:", ext.name, ext.id))
        .catch((e) => console.warn("[Ext] Reveye load skipped:", e.message));
    }
  } catch (e) {
    console.warn("[Ext] Reveye setup error:", e.message);
  }

  // Setup IPC handlers ONCE before creating any window
  if (!_ipcSetupDone) {
    setupIPC();
    _ipcSetupDone = true;
  }

  // 🔥 PERFORMANCE: Session warming - preconnect to popular domains
  // This loads DNS/TLS handshakes in background → instant navigation
  try {
    const etherxSess = session.fromPartition("persist:etherx");
    const popularDomains = [
      "https://www.google.com",
      "https://www.youtube.com",
      "https://github.com",
      "https://stackoverflow.com",
      "https://twitter.com",
      "https://wallet.kriptoentuzijasti.io",
      "https://bobiai.kriptoentuzijasti.io",
    ];

    // Preconnect to popular domains (DNS + TLS handshake)
    popularDomains.forEach((domain) => {
      etherxSess.preconnect({ url: domain, numSockets: 2 });
    });

    console.log(
      `[Perf] Session warmed with ${popularDomains.length} preconnects`,
    );
  } catch (e) {
    console.warn("[Perf] Session warming failed:", e.message);
  }

  createWindow();

  // Register etherx:// protocol for settings
  protocol.registerHttpProtocol("etherx", (request, callback) => {
    const { URL: NURL } = require("url");
    const parsed = new NURL(request.url);
    if (parsed.hostname === "settings") {
      callback({ path: path.join(__dirname, "src", "settings.html") });
    } else {
      callback({ error: -6 });
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  INCOGNITO_TABS.clear();
  if (process.platform !== "darwin") app.quit();
});

// ─── Auto-save session before window closes ───────────────────────────────────
app.on("before-quit", () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents
        .executeJavaScript("saveSessionTabs(true)")
        .catch(() => { });
    }
  } catch (e) {
    /* window already destroyed */
  }
});

// ─── Create main window ───────────────────────────────────────────────────────
function createWindow() {
  const isMac = process.platform === "darwin";

  // Load saved bounds
  let bounds = { width: 1440, height: 900 };
  try {
    if (db) {
      const saved = db.getWindowBounds();
      if (saved) bounds = saved;
    }
  } catch (_) { }

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: isMac ? "hiddenInset" : "hidden", // hiddenInset on macOS keeps traffic lights visible + content below
    trafficLightPosition: { x: 16, y: 16 }, // macOS: traffic lights on LEFT (like Safari)
    backgroundColor: "#1a1a2e", // deep navy/purple — matches UI theme
    show: false, // 🔥 PERFORMANCE: Don't show until ready (prevents white flash)
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // required for preload to work correctly
      webviewTag: true, // keep WebView tabs
      allowRunningInsecureContent: false,
      webSecurity: false, // allow cross-origin webviews / iframes
      backgroundThrottling: true, // 🔥 PERFORMANCE: Throttle background tabs
      disableBlinkFeatures: "", // enable all Blink features for performance
      enableBlinkFeatures: "CSSInsetProperty", // 🔥 PERFORMANCE: Modern CSS features
      v8CacheOptions: "code", // 🔥 PERFORMANCE: Cache compiled JS
      enableWebSQL: false, // 🔥 PERFORMANCE: Disable deprecated WebSQL
    },
    icon: path.join(__dirname, "src", "logo_novi.png"),
  });

  // 🔥 PERFORMANCE: Show window only when ready (smooth fade-in)
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    // Optional: smooth fade-in effect
    if (mainWindow.setOpacity) {
      mainWindow.setOpacity(0);
      let opacity = 0;
      const fadeIn = setInterval(() => {
        opacity += 0.1;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setOpacity(opacity);
        }
        if (opacity >= 1) {
          clearInterval(fadeIn);
        }
      }, 16); // 60fps
    }
  });

  // Fallback: avoid permanent black/hidden window if ready-to-show never fires.
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        console.warn("⚠️ ready-to-show timeout — forcing window show");
        mainWindow.show();
      }
    } catch (_) { }
  }, 3500);

  // Save bounds on change
  const saveBounds = () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && db) {
        db.saveWindowBounds(mainWindow.getBounds());
      }
    } catch (_) { }
  };
  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));

  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url, isMainFrame) => {
    console.error("❌ did-fail-load:", code, desc, url);
    if (!isMainFrame) return;
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    } catch (_) { }
  });

  mainWindow.webContents.on("console-message", (_event, level, msg, line, sourceId) => {
    if (level >= 2) {
      console.error("[renderer]", msg, "@", sourceId + ":" + line);
    }
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("❌ render-process-gone:", details.reason, details.exitCode);
    // One-time Linux safe-mode recovery: relaunch with GPU disabled.
    if (
      process.platform === "linux" &&
      !_rendererRecoveryAttempted &&
      process.env.ETHERX_DISABLE_GPU !== "1" &&
      ["launch-failed", "crashed", "oom"].includes(details.reason)
    ) {
      _rendererRecoveryAttempted = true;
      const env = { ...process.env, ETHERX_DISABLE_GPU: "1" };
      console.warn("⚠️ Relaunching in GPU-safe mode (ETHERX_DISABLE_GPU=1)");
      app.relaunch({ env });
      app.quit();
    }
  });

  // Set dark background on all webviews before content loads (prevents white flash)
  mainWindow.webContents.on("did-attach-webview", (_event, wvContents) => {
    try {
      wvContents.setBackgroundColor("#0d0d1a");
    } catch (_) { }
  });

  // Strip Electron/x.x and EtherX/x.x tokens from every outgoing request.
  // Google accounts.google.com detects these tokens as "embedded webview" and
  // blocks login with "This browser may not be secure". Cleaning the UA fixes it.
  const CLEAN_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  // Google also checks Sec-Fetch-Site / Origin headers — force override for google domains
  const GOOGLE_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  // ── Network monitoring & CORS bypass ────────────────────────────────────────
  // Keep request tracking O(1) and batch IPC to avoid flooding the renderer on
  // media-heavy pages such as YouTube or TikTok.
  const networkLog = new Map();
  const MAX_NETWORK_LOG = 500;
  let _netLogBatch = [];
  let _netLogFlushTimer = null;

  function flushNetworkLogBatch() {
    _netLogFlushTimer = null;
    if (!_netLogBatch.length || !mainWindow || mainWindow.isDestroyed()) {
      _netLogBatch = [];
      return;
    }
    mainWindow.webContents.send("network-log-batch", _netLogBatch.splice(0));
  }

  function queueNetworkLogEntry(entry) {
    _netLogBatch.push(entry);
    if (!_netLogFlushTimer) {
      _netLogFlushTimer = setTimeout(flushNetworkLogBatch, 250);
    }
  }

  const SKIP_LOG_TYPES = new Set([
    "media",
    "image",
    "font",
    "ping",
    "cspreport",
  ]);

  function isVideoOrMediaRequest(details) {
    const url = String(details?.url || "");
    const acceptHeader =
      Object.entries(details?.requestHeaders || {}).find(
        ([k]) => k.toLowerCase() === "accept",
      )?.[1] || "";
    const accept = Array.isArray(acceptHeader)
      ? acceptHeader.join(",")
      : String(acceptHeader || "");
    const mediaExt = /\.(m3u8|mpd|mp4|webm|m4s|ts|aac|mp3|mkv)(\?|$)/i.test(
      url,
    );
    const mediaAccept =
      /(video\/|audio\/|application\/dash\+xml|application\/vnd\.apple\.mpegurl)/i.test(
        accept,
      );
    return mediaExt || mediaAccept;
  }

  function isKnownVideoHost(rawUrl) {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      return [
        "tiktok.com",
        "tiktokcdn.com",
        "tiktokv.com",
        "byteoversea.com",
        "ibytedtos.com",
        "muscdn.com",
        "googlevideo.com",
        "youtube.com",
        "youtubei.googleapis.com",
        "ytimg.com",
        "twimg.com",
        "ttlivecdn.com",
        "akamaized.net",
        "cloudfront.net",
      ].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    } catch (_) {
      return false;
    }
  }

  function isGoogleAuthRequest(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      const full = String(rawUrl || "").toLowerCase();
      return (
        host === "accounts.google.com" ||
        host === "consent.google.com" ||
        host === "myaccount.google.com" ||
        (host.endsWith(".google.com") &&
          (full.includes("/signin/") ||
            full.includes("flowname=glifwebsignin") ||
            full.includes("flowentry=servicelogin")))
      );
    } catch (_) {
      return false;
    }
  }

  function isTrustedFirstPartyHost(rawUrl) {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      return ["kriptoentuzijasti.io", "etherx.io"].some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`),
      );
    } catch (_) {
      return false;
    }
  }

  function isSecurityHeaderRelaxationTarget(rawUrl) {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      return [
        "openrouter.ai",
        "clerk.openrouter.ai",
        "accounts.openrouter.ai",
        "clerk.accounts.dev",
        "clerk.com",
        "auth0.com",
        "okta.com",
        "huggingface.co",
        "openai.com",
        "anthropic.com",
        "github.com",
      ].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    } catch (_) {
      return false;
    }
  }

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      if (isTrustedFirstPartyHost(details.url)) {
        callback({ requestHeaders: headers });
        return;
      }
      const key = Object.keys(headers).find(
        (k) => k.toLowerCase() === "user-agent",
      );
      if (key) {
        // Always strip Electron/EtherX identifiers
        let ua = headers[key]
          .replace(/\s*Electron\/[\d.]+/gi, "")
          .replace(/\s*EtherX\/[\d.]+/gi, "")
          .trim();
        // For Google domains force clean modern Chrome UA
        const url = details.url || "";
        if (
          /google\.com|googleapis\.com|accounts\.google|openrouter\.ai|clerk\.openrouter\.ai|accounts\.openrouter\.ai|\.clerk\.accounts\.dev|\.clerk\.com|auth0\.com|okta\.com|huggingface\.co|openai\.com|anthropic\.com|github\.com\/login/i.test(
            url,
          )
        ) {
          ua = GOOGLE_UA;
          // Remove X-Frame-Options bypass headers that trigger security checks
          delete headers["X-Requested-With"];
          if (isGoogleAuthRequest(url)) {
            headers["Sec-CH-UA"] =
              '"Google Chrome";v="135", "Chromium";v="135", "Not?A_Brand";v="99"';
            headers["Sec-CH-UA-Mobile"] = "?0";
            headers["Sec-CH-UA-Platform"] = '"Windows"';
            headers["Sec-Fetch-Site"] = "none";
            headers["Sec-Fetch-Mode"] = "navigate";
            headers["Sec-Fetch-Dest"] = "document";
            headers["Sec-Fetch-User"] = "?1";
          }
        }
        headers[key] = ua || CLEAN_UA;
      }

      // Log network request, but skip high-frequency resource types that can
      // overwhelm the main/renderer processes during streaming playback.
      const resourceType = String(details.resourceType || "").toLowerCase();
      if (!SKIP_LOG_TYPES.has(resourceType)) {
        if (networkLog.size >= MAX_NETWORK_LOG) {
          networkLog.delete(networkLog.keys().next().value);
        }
        networkLog.set(details.id, {
          id: details.id,
          url: details.url,
          method: details.method,
          resourceType: details.resourceType,
          timestamp: Date.now(),
          requestHeaders: headers,
        });
      }

      callback({ requestHeaders: headers });
    },
  );

  // ── Response headers: Disable CORS, X-Frame-Options, CSP ────────────────────
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };

      // Keep first-party domains untouched to avoid framework/runtime regressions.
      if (isTrustedFirstPartyHost(details.url)) {
        callback({ responseHeaders: headers });
        return;
      }

      // Keep video/CDN responses untouched. Rewriting CORS/CSP headers globally
      // can break MSE/segment playback on TikTok/YouTube and similar platforms.
      if (isKnownVideoHost(details.url) || isVideoOrMediaRequest(details)) {
        callback({ responseHeaders: headers });
        return;
      }

      // Apply header relaxation only on known auth/API targets.
      if (!isSecurityHeaderRelaxationTarget(details.url)) {
        callback({ responseHeaders: headers });
        return;
      }

      // Remove CORS restrictions — only inject ACAO:* when absent (same fix as
      // the webview session: preserve video CDN CORS headers, never combine
      // ACAO:* with Access-Control-Allow-Credentials which violates CORS spec).
      if (
        !headers["access-control-allow-origin"] &&
        !headers["Access-Control-Allow-Origin"]
      ) {
        headers["Access-Control-Allow-Origin"] = ["*"];
        headers["Access-Control-Allow-Methods"] = [
          "GET, POST, PUT, DELETE, OPTIONS",
        ];
        headers["Access-Control-Allow-Headers"] = ["*"];
      }
      delete headers["access-control-allow-credentials"];
      delete headers["Access-Control-Allow-Credentials"];

      // Remove frame restrictions (allows embedding)
      delete headers["x-frame-options"];
      delete headers["X-Frame-Options"];

      // Remove CSP restrictions
      delete headers["content-security-policy"];
      delete headers["Content-Security-Policy"];
      delete headers["content-security-policy-report-only"];

      // Update network log with response
      const logEntry = networkLog.get(details.id);
      if (logEntry) {
        logEntry.statusCode = details.statusCode;
        logEntry.responseHeaders = headers;
        logEntry.fromCache = details.fromCache;
      }

      callback({ responseHeaders: headers });
    },
  );

  // ── Network completed/error tracking ─────────────────────────────────────────
  mainWindow.webContents.session.webRequest.onCompleted(
    { urls: ["*://*/*"] },
    (details) => {
      const logEntry = networkLog.get(details.id);
      if (logEntry) {
        logEntry.completed = true;
        logEntry.duration = Date.now() - logEntry.timestamp;
        networkLog.delete(details.id);
        queueNetworkLogEntry(logEntry);
      }
    },
  );

  mainWindow.webContents.session.webRequest.onErrorOccurred(
    { urls: ["*://*/*"] },
    (details) => {
      const logEntry = networkLog.get(details.id);
      if (logEntry) {
        logEntry.error = details.error;
        logEntry.completed = false;
        networkLog.delete(details.id);
        queueNetworkLogEntry(logEntry);
      }
    },
  );

  // ── Apply same UA cleaning and header fixes to webview (persist:etherx) session ──
  // Webviews use a separate Electron session (persist:etherx) that doesn't inherit
  // the interceptors above. Without this, webviews send the raw Electron UA which
  // causes some sites (e.g. WordPress with security plugins) to serve blank pages.
  const etherxSession = session.fromPartition("persist:etherx");

  etherxSession.webRequest.onBeforeSendHeaders(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      if (isTrustedFirstPartyHost(details.url)) {
        callback({ requestHeaders: headers });
        return;
      }
      const key = Object.keys(headers).find(
        (k) => k.toLowerCase() === "user-agent",
      );
      if (key) {
        // Always strip Electron/EtherX identifiers
        let ua = headers[key]
          .replace(/\s*Electron\/[\d.]+/gi, "")
          .replace(/\s*EtherX\/[\d.]+/gi, "")
          .trim();
        // For Google domains force clean modern Chrome UA
        const url = details.url || "";
        if (
          /google\.com|googleapis\.com|accounts\.google|openrouter\.ai|clerk\.openrouter\.ai|accounts\.openrouter\.ai|\.clerk\.accounts\.dev|\.clerk\.com|auth0\.com|okta\.com|huggingface\.co|openai\.com|anthropic\.com|github\.com\/login/i.test(
            url,
          )
        ) {
          ua = GOOGLE_UA;
          delete headers["X-Requested-With"];
          if (isGoogleAuthRequest(url)) {
            headers["Sec-CH-UA"] =
              '"Google Chrome";v="135", "Chromium";v="135", "Not?A_Brand";v="99"';
            headers["Sec-CH-UA-Mobile"] = "?0";
            headers["Sec-CH-UA-Platform"] = '"Windows"';
            headers["Sec-Fetch-Site"] = "none";
            headers["Sec-Fetch-Mode"] = "navigate";
            headers["Sec-Fetch-Dest"] = "document";
            headers["Sec-Fetch-User"] = "?1";
          }
        }
        headers[key] = ua || CLEAN_UA;
      }
      // Do NOT delete Origin/Referer in webview session — video CDNs (YouTube,
      // TikTok, Twitch…) use Referer for hotlink protection; stripping it causes
      // CDNs to reject media segment requests → infinite buffering spinner.
      callback({ requestHeaders: headers });
    },
  );

  etherxSession.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };

      // Keep first-party domains untouched to avoid framework/runtime regressions.
      if (isTrustedFirstPartyHost(details.url)) {
        callback({ responseHeaders: headers });
        return;
      }

      // Keep video/CDN responses untouched for webviews as well.
      if (isKnownVideoHost(details.url) || isVideoOrMediaRequest(details)) {
        callback({ responseHeaders: headers });
        return;
      }

      // Apply header relaxation only on known auth/API targets.
      if (!isSecurityHeaderRelaxationTarget(details.url)) {
        callback({ responseHeaders: headers });
        return;
      }

      // Only inject ACAO:* when the server sent none — preserves video CDN CORS
      // headers (e.g. googlevideo.com, tiktok CDN) so credentialed media requests
      // are not broken by the wildcard+credentials CORS spec violation.
      if (
        !headers["access-control-allow-origin"] &&
        !headers["Access-Control-Allow-Origin"]
      ) {
        headers["Access-Control-Allow-Origin"] = ["*"];
        headers["Access-Control-Allow-Methods"] = [
          "GET, POST, PUT, DELETE, OPTIONS",
        ];
        headers["Access-Control-Allow-Headers"] = ["*"];
      }
      // Never combine ACAO:* with AACE:true — CORS spec violation that causes
      // credentialed fetch() calls (used by video players) to be rejected.
      delete headers["access-control-allow-credentials"];
      delete headers["Access-Control-Allow-Credentials"];
      delete headers["x-frame-options"];
      delete headers["X-Frame-Options"];
      delete headers["content-security-policy"];
      delete headers["Content-Security-Policy"];
      delete headers["content-security-policy-report-only"];
      callback({ responseHeaders: headers });
    },
  );

  // Show immediately — don't wait for ready-to-show which may never fire on macOS
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });
  // Fallback: force show after 3s in case ready-to-show never fires
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn("⚠️ ready-to-show never fired, force showing window");
      mainWindow.show();
      mainWindow.focus();
    }
  }, 3000);

  // Log any load failures and show alert to user
  mainWindow.webContents.on("did-fail-load", (e, code, desc, url) => {
    console.error("❌ did-fail-load:", code, desc, url);
    // Only show dialog for main frame failures (not subresource/CDN fails)
    if (url && url.startsWith("file://")) {
      dialog.showErrorBox(
        "EtherX: Load Failed",
        `Code: ${code}\n${desc}\nURL: ${url}`,
      );
    }
  });
  // Capture renderer console errors
  mainWindow.webContents.on(
    "console-message",
    (e, level, msg, line, sourceId) => {
      if (level >= 2)
        console.error(`🖥️ Renderer [${level}] ${sourceId}:${line} → ${msg}`);
    },
  );
  let _rendererRestarts = 0;
  mainWindow.webContents.on("render-process-gone", (e, details) => {
    console.error("❌ render-process-gone:", details.reason, details.exitCode);
    // Auto-recover from launch-failed / crashed — retry up to 3 times
    if (
      _rendererRestarts < 3 &&
      (details.reason === "launch-failed" || details.reason === "crashed")
    ) {
      _rendererRestarts++;
      console.log(`🔄 Attempting renderer restart ${_rendererRestarts}/3...`);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload();
        }
      }, 1000 * _rendererRestarts);
    } else {
      dialog.showErrorBox(
        "EtherX: Renderer Crashed",
        `Reason: ${details.reason}\nExit: ${details.exitCode}`,
      );
    }
  });
  mainWindow.webContents.on("unresponsive", () => {
    console.error("⚠️ webContents unresponsive");
  });

  // Verify content actually loaded after 5 seconds
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("✅ did-finish-load fired");
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents
        .executeJavaScript(
          `
        (function() {
          var el = document.getElementById('contentArea');
          var tb = document.querySelector('.title-bar');
          return JSON.stringify({
            bodyH: document.body.offsetHeight,
            bodyW: document.body.offsetWidth,
            contentArea: el ? { h: el.offsetHeight, w: el.offsetWidth, display: getComputedStyle(el).display } : null,
            titleBar: tb ? { h: tb.offsetHeight } : null,
            ntpVisible: !!document.getElementById('ntpPage'),
            tabCount: typeof STATE !== 'undefined' ? STATE.tabs.length : -1,
          });
        })()
      `,
        )
        .then((json) => {
          const info = JSON.parse(json);
          console.log("🔍 Layout check:", info);
          if (info.contentArea && info.contentArea.h < 10) {
            console.error(
              "⚠️ Content area has 0 height! Layout may be broken.",
            );
          }
        })
        .catch((err) => {
          console.error("⚠️ Layout check failed:", err.message);
        });
    }, 3000);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // macOS: inject CSS so traffic lights don't overlap left-side content
  if (process.platform === "darwin") {
    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow?.webContents.insertCSS(
        ".title-bar { padding-left: 78px !important; }" +
        ".win-btns { display: none !important; }", // hide custom buttons on macOS (OS provides them)
      );
    });
  }

  // Window controls — use removeAllListeners to prevent duplicates on re-create
  ipcMain.removeAllListeners("window-minimize");
  ipcMain.removeAllListeners("window-maximize");
  ipcMain.removeAllListeners("window-close");
  ipcMain.on("window-minimize", () => mainWindow?.minimize());
  ipcMain.on("window-maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on("window-close", () => mainWindow?.close());

  // setupIPC is called once from app.whenReady — never call it from createWindow

  // ── Dock / Taskbar context menu ──────────────────────────────────────────
  const dockMenu = Menu.buildFromTemplate([
    {
      label: "New Window",
      click: () => {
        ipcMain.emit("app:newWindow");
        const win = new BrowserWindow({
          width: 1280,
          height: 800,
          backgroundColor: "#1a1a2e",
          titleBarStyle: "hidden",
          webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
            sandbox: false,
          },
        });
        win.loadFile(path.join(__dirname, "src", "index.html"));
      },
    },
    {
      label: "New Private Window",
      click: () => {
        const win = new BrowserWindow({
          width: 1280,
          height: 800,
          backgroundColor: "#0d0d1a",
          titleBarStyle: "hidden",
          webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
            sandbox: false,
            partition: "incognito-" + Date.now(),
          },
        });
        win.loadFile(path.join(__dirname, "src", "index.html"));
        win.webContents.on("did-finish-load", () => {
          win.webContents
            .executeJavaScript(
              `STATE.isPrivate=true;document.getElementById('privateIndicator').style.display='';document.title='EtherX (Private)';`,
            )
            .catch(() => { });
        });
      },
    },
    { type: "separator" },
    {
      label: "New Tab",
      accelerator: "CmdOrCtrl+T",
      click: () => {
        mainWindow?.webContents
          .executeJavaScript("createTab()")
          .catch(() => { });
      },
    },
    { type: "separator" },
    {
      label: "Settings",
      click: () => {
        mainWindow?.webContents
          .executeJavaScript(`document.getElementById('btnSettings').click()`)
          .catch(() => { });
      },
    },
  ]);
  if (process.platform === "darwin" && app.dock) {
    app.dock.setMenu(dockMenu);
  }
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.on("get-window-id", (event) => {
    event.returnValue =
      BrowserWindow.fromWebContents(event.sender)?.id || "main";
  });
  ipcMain.on("storage:getSnapshot", (event) => {
    event.returnValue = _getRendererStorageSnapshot();
  });
  ipcMain.on("storage:setItem", (event, key, value) => {
    event.returnValue = _setRendererStorageItem(key, value);
  });
  ipcMain.on("storage:removeItem", (event, key) => {
    event.returnValue = _removeRendererStorageItem(key);
  });
  ipcMain.on("storage:clear", (event) => {
    event.returnValue = _clearRendererStorage();
  });
  ipcMain.on("secretStorage:getItem", (event, key) => {
    const store = getSecretStore();
    const value = store ? store.getValue("renderer", String(key), null) : null;
    event.returnValue = value == null ? null : JSON.stringify(value);
  });
  ipcMain.on("secretStorage:setItem", (event, key, value) => {
    const store = getSecretStore();
    if (!store) {
      event.returnValue = { ok: false, error: "Secret store not available" };
      return;
    }
    let parsed = value;
    try { parsed = JSON.parse(String(value)); } catch (_) { }
    event.returnValue = store.setValue("renderer", String(key), parsed);
  });
  ipcMain.on("secretStorage:removeItem", (event, key) => {
    const store = getSecretStore();
    event.returnValue = store ? store.removeValue("renderer", String(key)) : { ok: false, error: "Secret store not available" };
  });
  ipcMain.handle("secrets:getSettings", () => {
    const store = getSecretStore();
    return store ? store.getNamespace("settings") : {};
  });
  ipcMain.handle("secrets:saveSettings", (_e, values) => {
    const store = getSecretStore();
    return store ? store.mergeNamespace("settings", values || {}) : noDb();
  });
  ipcMain.handle("secrets:deleteSettings", (_e, keys) => {
    const store = getSecretStore();
    return store ? store.deleteKeys("settings", Array.isArray(keys) ? keys : []) : noDb();
  });

  const noDb = () => ({ ok: false, error: "Database not available" });
  const noAi = () => ({ ok: false, error: "AI not available" });

  // ── License / admin lock helpers ─────────────────────────────────────────
  ipcMain.handle("license:getDeviceId", () => _computeDeviceId());
  ipcMain.handle("license:isAdminDevice", () => _isAdminDeviceAllowed());
  ipcMain.handle("license:debugAdminEnv", () => _getAdminEnvDebugInfo());
  ipcMain.handle("license:getTkaiValidHashes", () => _getTkaiRuntimeHashes());
  ipcMain.handle("license:getRuntimeEnvStatus", () => _getRuntimeEnvStatus());
  ipcMain.handle("license:bootstrapRuntimeEnv", () => {
    _ensureRuntimeEnvLocals();
    return _getRuntimeEnvStatus();
  });
  ipcMain.handle("license:saveTkaiApiConfig", (_e, payload = {}) =>
    _saveRuntimeLicenseConfig({
      apiKey: payload.apiKey,
      apiUrl: payload.apiUrl,
      validHashes: payload.validHashes,
    })
  );
  ipcMain.handle("license:validateTkaiCode", (_e, payload = {}) =>
    _validateTkaiLicenseRemote(payload.code, payload.hashrate)
  );

  // ── Tabs ───────────────────────────────────────────────────────────────────
  ipcMain.handle("db:saveTab", (_e, tab) => {
    if (tab.incognito) {
      INCOGNITO_TABS.set(tab.id, tab);
      return { ok: true, incognito: true };
    }
    return db ? db.saveTab(tab) : noDb();
  });
  ipcMain.handle("db:getTabs", () => (db ? db.getTabs() : []));
  ipcMain.handle("db:deleteTab", (_e, tabId) => {
    INCOGNITO_TABS.delete(tabId);
    return db ? db.deleteTab(tabId) : noDb();
  });
  ipcMain.handle("db:clearIncognitoTab", (_e, tabId) => {
    INCOGNITO_TABS.delete(tabId);
    return { ok: true };
  });
  ipcMain.handle("db:updateTabOrder", (_e, tabs) =>
    db ? db.updateTabOrder(tabs) : noDb(),
  );

  // ── History ────────────────────────────────────────────────────────────────
  ipcMain.handle("db:addHistory", (_e, entry) => {
    if (entry.incognito) return { ok: true, skipped: true };
    return db ? db.addHistory(entry) : noDb();
  });
  ipcMain.handle("db:getHistory", (_e, opts) =>
    db ? db.getHistory(opts) : [],
  );
  ipcMain.handle("db:clearHistory", () => (db ? db.clearHistory() : noDb()));
  ipcMain.handle("db:clearHistoryRange", (_e, from, to) =>
    db ? db.clearHistoryRange(from, to) : noDb(),
  );

  // ── Bookmarks ──────────────────────────────────────────────────────────────
  ipcMain.handle("db:addBookmark", (_e, bm) =>
    db ? db.addBookmark(bm) : noDb(),
  );
  ipcMain.handle("db:getBookmarks", () => (db ? db.getBookmarks() : []));
  ipcMain.handle("db:deleteBookmark", (_e, id) =>
    db ? db.deleteBookmark(id) : noDb(),
  );
  ipcMain.handle("db:updateBookmark", (_e, bm) =>
    db ? db.updateBookmark(bm) : noDb(),
  );

  // ── Settings ───────────────────────────────────────────────────────────────
  ipcMain.handle("db:getSettings", () => (db ? getMergedSettings() : {}));
  ipcMain.handle("db:saveSettings", (_e, s) =>
    db ? saveSettingsSecurely(s) : noDb(),
  );

  // ── DoH runtime toggle ─────────────────────────────────────────────────────
  ipcMain.handle("settings:applyDoH", (_e, enabled) => {
    try {
      const cfgPath = path.join(app.getPath("userData"), "etherx_doh.json");
      const provider = db
        ? db.getSettings()["doh_provider"] || "cloudflare"
        : "cloudflare";
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({ enabled: !!enabled, provider }, null, 2),
      );
    } catch (_) {
      /* ignore */
    }
    return { ok: true, requiresRestart: true };
  });

  // ── Tor SOCKS5 proxy runtime toggle ────────────────────────────────────────
  ipcMain.handle("settings:applyTorProxy", async (_e, enabled, host, port) => {
    try {
      const ses = session.defaultSession;
      if (enabled) {
        const h = String(host || '127.0.0.1').trim() || '127.0.0.1';
        const p = parseInt(port, 10) || 9050;
        await ses.setProxy({ proxyRules: `socks5://${h}:${p}` });
      } else {
        await ses.setProxy({ proxyRules: '' });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Passwords ─────────────────────────────────────────────────────────────
  ipcMain.handle("passwords:save", (_e, site, username, encryptedPayload) =>
    PasswordManager
      ? PasswordManager.save(
        app.getPath("userData"),
        site,
        username,
        encryptedPayload,
      )
      : noDb(),
  );
  ipcMain.handle("passwords:get", (_e, site) =>
    PasswordManager ? PasswordManager.get(app.getPath("userData"), site) : null,
  );
  ipcMain.handle("passwords:list", () =>
    PasswordManager ? PasswordManager.list(app.getPath("userData")) : [],
  );
  ipcMain.handle("passwords:delete", (_e, id) =>
    PasswordManager
      ? PasswordManager.remove(app.getPath("userData"), id)
      : noDb(),
  );
  ipcMain.handle("passwords:setupVault", async (_e, masterPassword) =>
    PasswordManager
      ? PasswordManager.setupVault(app.getPath("userData"), masterPassword)
      : noDb(),
  );
  ipcMain.handle("passwords:unlockVault", async (_e, masterPassword) =>
    PasswordManager
      ? PasswordManager.unlockVault(app.getPath("userData"), masterPassword)
      : noDb(),
  );
  ipcMain.handle("passwords:lockVault", () =>
    PasswordManager
      ? PasswordManager.lockVault(app.getPath("userData"))
      : noDb(),
  );
  ipcMain.handle("passwords:exportBitwarden", () =>
    PasswordManager
      ? PasswordManager.exportBitwardenFormat(app.getPath("userData"))
      : noDb(),
  );

  // ── Network Monitoring ─────────────────────────────────────────────────────
  ipcMain.handle("network:getLog", () => {
    return Array.from(networkLog.values()).slice(-100);
  });
  ipcMain.handle("network:clearLog", () => {
    networkLog.clear();
    _netLogBatch = [];
    if (_netLogFlushTimer) {
      clearTimeout(_netLogFlushTimer);
      _netLogFlushTimer = null;
    }
    return { ok: true };
  });

  // ── AI ─────────────────────────────────────────────────────────────────────
  ipcMain.handle("ai:smartSearch", (_e, query) =>
    ai ? ai.smartSearch(query) : noAi(),
  );
  ipcMain.handle("ai:checkPhishing", (_e, url, content) =>
    ai ? ai.checkPhishing(url, content) : noAi(),
  );
  ipcMain.handle("ai:readingMode", (_e, html) =>
    ai ? ai.extractReadingContent(html) : noAi(),
  );
  ipcMain.handle("ai:groupTabs", (_e, tabs) =>
    ai ? ai.groupTabs(tabs) : noAi(),
  );
  ipcMain.handle("ai:translate", async (_e, text, targetLang) => {
    if (!ai) return noAi();
    const settings = db ? getMergedSettings() : {};
    const geminiKey =
      settings.geminiApiKey || settings.gemini_api_key || process.env.GEMINI_API_KEY || "";
    return ai.translate(text, targetLang, geminiKey);
  });
  ipcMain.handle("ai:detectBotUA", (_e, ua) =>
    ai ? ai.detectBotUA(ua) : { isBot: false, isIAB: false, reasons: [] },
  );
  ipcMain.handle("ai:lookupIpGeo", (_e, hostname) =>
    ai ? ai.lookupIpGeo(hostname) : { ok: false, error: "AI not available" },
  );

  // ── AI: Page Summarizer (proxied through main to keep API key secure) ─────
  ipcMain.handle("ai:summarizePage", async (_e, url, htmlContent) => {
    if (!ai) return noAi();
    const settings = db ? getMergedSettings() : {};
    const geminiKey =
      settings.geminiApiKey || settings.gemini_api_key || process.env.GEMINI_API_KEY || "";
    return ai.summarizePage(url, htmlContent, geminiKey, db);
  });

  ipcMain.handle("ai:installPythonDeps", async () => {
    return installPythonBridgeDeps();
  });

  ipcMain.handle("app:runOneClickSetup", async () => {
    return runOneClickLocalSetup();
  });

  ipcMain.handle("app:getPM2Status", async () => {
    try {
      const projectRoot = resolvePythonProjectRoot();
      const run = await execFileText("npx", ["pm2", "status", "etherx-browser"], 30000, { cwd: projectRoot });
      return { ok: run.ok, output: run.stdout || run.stderr || "Nema PM2 statusa" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("app:getPM2Logs", async () => {
    try {
      const projectRoot = resolvePythonProjectRoot();
      const run = await execFileText("npx", ["pm2", "logs", "etherx-browser", "--lines", "100", "--nostream"], 30000, { cwd: projectRoot });
      return { ok: run.ok, output: run.stdout || run.stderr || "Nema PM2 logova" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Ad Blocker ─────────────────────────────────────────────────────────────
  ipcMain.handle("adblock:isEnabled", () =>
    adBlocker ? adBlocker.isEnabled() : false,
  );
  ipcMain.handle("adblock:toggle", (_e, enabled) =>
    adBlocker ? adBlocker.toggle(enabled) : noDb(),
  );
  ipcMain.handle("adblock:stats", () =>
    adBlocker ? adBlocker.getStats() : { blocked: 0 },
  );

  // ── Security ───────────────────────────────────────────────────────────────
  ipcMain.handle("security:getCertInfo", (_e, url) =>
    SecurityManager ? SecurityManager.getCertInfo(url) : null,
  );
  ipcMain.handle("security:getMalwareStats", () => {
    const stats = AdBlocker?._malwareStats;
    if (stats) return { ...stats };
    return { blocked: 0, domains: 0, enabled: true };
  });
  ipcMain.handle("security:setMalwareBlock", (_e, enabled) => {
    if (AdBlocker?._malwareStats) AdBlocker._malwareStats.enabled = !!enabled;
    return { ok: true, enabled: !!enabled };
  });

  // ── User Agent ─────────────────────────────────────────────────────────────
  ipcMain.handle("ua:get", () =>
    UserAgentManager ? UserAgentManager.get() : null,
  );
  ipcMain.handle("ua:set", (_e, ua) =>
    UserAgentManager
      ? UserAgentManager.set(session.defaultSession, ua)
      : noDb(),
  );

  // ── QR Sync ────────────────────────────────────────────────────────────────
  ipcMain.handle("qrsync:generate", (_e, data) =>
    QRSyncManager ? QRSyncManager.generateQR(data) : noDb(),
  );
  ipcMain.handle("qrsync:exportProfile", () => {
    if (!QRSyncManager) return noDb();
    const tabs = db ? db.getTabs() : [];
    const bookmarks = db ? db.getBookmarks() : [];
    const settings = db ? getMergedSettings() : {};
    return QRSyncManager.generateQR(
      JSON.stringify({ tabs, bookmarks, settings }),
    );
  });
  ipcMain.handle("qrsync:importProfile", (_e, data) => {
    try {
      const parsed = JSON.parse(data);
      if (db) {
        if (parsed.bookmarks)
          parsed.bookmarks.forEach((b) => db.addBookmark(b));
        if (parsed.settings) db.saveSettings(parsed.settings);
        if (parsed.tabs) parsed.tabs.forEach((t) => db.saveTab(t));
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Default Browser ────────────────────────────────────────────────────────
  ipcMain.handle("defaultBrowser:check", () =>
    DefaultBrowser ? DefaultBrowser.isDefault() : false,
  );
  ipcMain.handle("defaultBrowser:set", () =>
    DefaultBrowser ? DefaultBrowser.setAsDefault() : noDb(),
  );

  // ── I18n ───────────────────────────────────────────────────────────────────
  ipcMain.handle("i18n:getStrings", (_e, lang) =>
    I18nManager ? I18nManager.getInstance().getStrings(lang) : {},
  );
  ipcMain.handle("i18n:setLanguage", (_e, lang) => {
    if (I18nManager) I18nManager.getInstance().setLanguage(lang);
    if (db) db.saveSettings({ ...db.getSettings(), language: lang });
    return { ok: true };
  });
  ipcMain.handle("i18n:getAvailableLanguages", () =>
    I18nManager ? I18nManager.getInstance().getAvailableLanguages() : [],
  );

  // ── Cast / Share ───────────────────────────────────────────────────────────
  ipcMain.handle("cast:getDevices", () => [
    { id: "local", name: "This Screen", type: "local" },
  ]);
  ipcMain.handle("share:shareUrl", (_e, url) => {
    clipboard.writeText(url);
    return { ok: true };
  });
  ipcMain.handle("share:savePageAs", async (_e, url, title) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${(title || "page").replace(/[/\\?%*:|"<>]/g, "-")}.html`,
      filters: [
        { name: "HTML Files", extensions: ["html"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    return { ok: !!filePath, filePath };
  });

  // ── Navigation helpers ─────────────────────────────────────────────────────
  ipcMain.handle("nav:openExternal", (_e, url) => {
    // Security: only allow http/https/mailto URLs via openExternal
    if (/^https?:\/\/|^mailto:/i.test(url)) return shell.openExternal(url);
    return Promise.resolve({ ok: false, error: "URL scheme not allowed" });
  });
  ipcMain.handle("app:openApplePasswords", async () => {
    if (process.platform !== "darwin")
      return { ok: false, error: "Apple Passwords available only on macOS." };
    const tryExec = (file, args = []) =>
      new Promise((resolve) => {
        execFile(file, args, (err) => resolve(!err));
      });
    if (await tryExec("open", ["-a", "Passwords"])) return { ok: true };
    if (
      await tryExec("open", [
        "x-apple.systempreferences:com.apple.Passwords-Settings.extension",
      ])
    )
      return { ok: true };
    try {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.Passwords-Settings.extension",
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("extensions:chooseFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose unpacked extension folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  });
  ipcMain.handle("extensions:loadUnpacked", async (_e, extensionPath) => {
    try {
      if (!extensionPath || !fs.existsSync(extensionPath))
        return { ok: false, error: "Extension folder not found." };
      const manifestPath = path.join(extensionPath, "manifest.json");
      if (!fs.existsSync(manifestPath))
        return {
          ok: false,
          error: "manifest.json not found in selected folder.",
        };
      const ext = await session.defaultSession.loadExtension(extensionPath, {
        allowFileAccess: true,
      });
      return {
        ok: true,
        id: ext.id,
        name: ext.name,
        version: ext.version,
        path: extensionPath,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("extensions:downloadFromCWS", async (_e, extId) => {
    if (!AdmZip)
      return {
        ok: false,
        error: "adm-zip module not available — run: npm install adm-zip",
      };
    try {
      const extDir = path.join(app.getPath("userData"), "extensions");
      if (!fs.existsSync(extDir)) fs.mkdirSync(extDir, { recursive: true });
      const crxFile = path.join(extDir, `${extId}.crx`);
      const extractDir = path.join(extDir, extId);
      if (fs.existsSync(extractDir))
        fs.rmSync(extractDir, { recursive: true, force: true });
      const downloadUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=114.0.5735.90&acceptformat=crx2,crx3&x=id%3D${extId}%26uc`;
      await new Promise((resolve, reject) => {
        function doDownload(url, dest) {
          https
            .get(url, (res) => {
              if (res.statusCode === 301 || res.statusCode === 302)
                return doDownload(res.headers.location, dest);
              if (res.statusCode !== 200)
                return reject(
                  new Error(`CWS responded with HTTP ${res.statusCode}`),
                );
              const file = fs.createWriteStream(dest);
              res.pipe(file);
              file.on("finish", () => file.close(resolve));
              file.on("error", (err) => {
                fs.unlink(dest, () => { });
                reject(err);
              });
            })
            .on("error", reject);
        }
        doDownload(downloadUrl, crxFile);
      });
      const buffer = fs.readFileSync(crxFile);
      let zipStart = -1;
      for (let i = 0; i < buffer.length - 4; i++) {
        if (
          buffer[i] === 0x50 &&
          buffer[i + 1] === 0x4b &&
          buffer[i + 2] === 0x03 &&
          buffer[i + 3] === 0x04
        ) {
          zipStart = i;
          break;
        }
      }
      if (zipStart === -1)
        throw new Error("Could not find ZIP header in CRX file.");
      const zipPath = path.join(extDir, `${extId}.zip`);
      fs.writeFileSync(zipPath, buffer.slice(zipStart));
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);
      fs.unlinkSync(crxFile);
      fs.unlinkSync(zipPath);
      const ext = await session.defaultSession.loadExtension(extractDir, {
        allowFileAccess: true,
      });
      return {
        ok: true,
        id: ext.id,
        name: ext.name,
        version: ext.version,
        path: extractDir,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── App info ────────────────────────────────────────────────
  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:isPackaged", () => app.isPackaged);
  ipcMain.handle("app:getPlatform", () => process.platform);
  ipcMain.handle("app:getUserDataPath", () => app.getPath("userData"));
  ipcMain.handle("app:getAppPath", () => app.getAppPath());
  ipcMain.handle("app:listWindows", (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    const windows = BrowserWindow.getAllWindows().map((win, index) => ({
      id: win.id,
      title:
        win.getTitle() || win.webContents.getTitle() || `Window ${index + 1}`,
      focused: win.isFocused(),
      minimized: win.isMinimized(),
    }));
    return { currentWindowId: currentWindow?.id || null, windows };
  });
  ipcMain.handle("app:focusWindow", (_event, windowId) => {
    const win = BrowserWindow.fromId(Number(windowId));
    if (!win) return { ok: false, error: "Window not found" };
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { ok: true };
  });
  ipcMain.handle("app:getBuildInfo", () => {
    try {
      const pkg = require("./package.json");
      return { version: pkg.version, buildTime: pkg.buildTime || null };
    } catch (e) {
      return { version: app.getVersion(), buildTime: null };
    }
  });

  ipcMain.handle("app:getProcessMetrics", async () => {
    const metrics = app.getAppMetrics();
    const mem = process.memoryUsage();
    const processes = metrics.map((m) => ({
      pid: m.pid,
      type: m.type,
      cpuPercent: (m.cpu?.percentCPUUsage ?? 0).toFixed(1),
      ramMB: m.memory ? (m.memory.workingSetSize / 1024).toFixed(1) : "?",
      sharedMB: m.memory
        ? (m.memory.sharedMemory / 1024 / 1024).toFixed(1)
        : "?",
    }));
    const totalRamMB = metrics.reduce(
      (sum, m) => sum + (m.memory?.workingSetSize ?? 0) / 1024,
      0,
    );
    const totalCpu = metrics.reduce(
      (sum, m) => sum + (m.cpu?.percentCPUUsage ?? 0),
      0,
    );

    return {
      processes,
      totalRamMB: totalRamMB.toFixed(1),
      totalCpuPercent: totalCpu.toFixed(1),
      mainHeapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
      mainHeapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(1),
      mainRssMB: (mem.rss / 1024 / 1024).toFixed(1),
      uptime: Math.round(process.uptime()),
      windowCount: BrowserWindow.getAllWindows().length,
    };
  });

  // ── Icon management ───────────────────────────────────────────────────────
  ipcMain.handle("app:chooseIcon", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Odaberi ikonu preglednika",
      buttonLabel: "Odaberi",
      filters: [
        { name: "Slike", extensions: ["png", "jpg", "jpeg", "ico"] },
        { name: "Sve datoteke", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    return { ok: true, filePath: result.filePaths[0] };
  });

  ipcMain.handle("app:setIcon", (_e, filePath) => {
    try {
      const img = nativeImage.createFromPath(filePath);
      if (img.isEmpty()) return { ok: false, error: "Slika nije ispravna." };
      mainWindow?.setIcon(img);
      if (db) db.saveSettings({ ...db.getSettings(), app_icon_path: filePath });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("app:resetIcon", () => {
    try {
      const iconPath = path.join(__dirname, "src", "logo_novi.png");
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) mainWindow?.setIcon(img);
      if (db) db.saveSettings({ ...db.getSettings(), app_icon_path: "" });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Clipboard ─────────────────────────────────────────────────────────────
  ipcMain.handle("clipboard:write", (_e, text) => {
    clipboard.writeText(text);
    return { ok: true };
  });
  ipcMain.handle("clipboard:read", () => clipboard.readText());

  // ── Cookies ───────────────────────────────────────────────────────────────
  ipcMain.handle("cookies:getAll", async (_e, url) => {
    try {
      const filter = url ? { url } : {};
      const cookies = await session.defaultSession.cookies.get(filter);
      return { ok: true, cookies };
    } catch (e) {
      return { ok: false, error: e.message, cookies: [] };
    }
  });
  ipcMain.handle("cookies:remove", async (_e, url, name) => {
    try {
      await session.defaultSession.cookies.remove(url, name);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("cookies:clearAll", async () => {
    try {
      await session.defaultSession.clearStorageData({ storages: ["cookies"] });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── DevTools ──────────────────────────────────────────────────────────────
  ipcMain.on("devtools:toggle", () => mainWindow?.webContents.toggleDevTools());

  // ── New Window / Private Window ────────────────────────────────────────────
  ipcMain.handle("app:newWindow", (_e, url) => {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      backgroundColor: "#1a1a2e",
      titleBarStyle: "hidden",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        sandbox: false,
      },
    });
    setupDownloadTracking(win.webContents.session);
    win.loadFile(path.join(__dirname, "src", "index.html"));
    if (url) {
      win.webContents.on("did-finish-load", () => {
        win.webContents
          .executeJavaScript(`navigateTo(${JSON.stringify(url)})`)
          .catch(() => { });
      });
    }
    return { ok: true };
  });

  ipcMain.handle("app:newPrivateWindow", () => {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      backgroundColor: "#0d0d1a",
      titleBarStyle: "hidden",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        sandbox: false,
        partition: "incognito-" + Date.now(),
      },
    });
    setupDownloadTracking(win.webContents.session);
    win.loadFile(path.join(__dirname, "src", "index.html"));
    win.webContents.on("did-finish-load", () => {
      win.webContents
        .executeJavaScript(
          `
        STATE.isPrivate = true;
        document.getElementById('privateIndicator').style.display = '';
        document.title = 'EtherX (Private)';
      `,
        )
        .catch(() => { });
    });
    return { ok: true };
  });

  // ── Move Tab to New Window ─────────────────────────────────────────────────
  ipcMain.handle("app:moveTabToWindow", (_e, url, title) => {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      backgroundColor: "#1a1a2e",
      titleBarStyle: "hidden",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        sandbox: false,
      },
    });
    setupDownloadTracking(win.webContents.session);
    win.loadFile(path.join(__dirname, "src", "index.html"));
    if (url) {
      win.webContents.on("did-finish-load", () => {
        win.webContents
          .executeJavaScript(`navigateTo(${JSON.stringify(url)})`)
          .catch(() => { });
      });
    }
    return { ok: true };
  });

  // ── Split Screen ───────────────────────────────────────────────────────────
  ipcMain.handle("app:splitScreen", (_e, urlLeft) => {
    const { width, height } =
      require("electron").screen.getPrimaryDisplay().workAreaSize;
    const halfW = Math.floor(width / 2);
    const makeWin = (x, hash) => {
      const w = new BrowserWindow({
        x,
        y: 0,
        width: halfW,
        height,
        backgroundColor: "#1a1a2e",
        titleBarStyle: "hidden",
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: true,
          sandbox: false,
        },
      });
      setupDownloadTracking(w.webContents.session);
      w.loadFile(path.join(__dirname, "src", "index.html"), { hash });
      return w;
    };
    // Left window: load the current tab URL via hash; right window: start fresh
    makeWin(
      0,
      urlLeft ? "split-left=" + encodeURIComponent(urlLeft) : "fresh-window",
    );
    makeWin(halfW, "fresh-window");
    return { ok: true };
  });

  // ── Shell helpers (open folder / file) ────────────────────────────────────
  ipcMain.handle("shell:showItemInFolder", (_e, fullPath) => {
    shell.showItemInFolder(fullPath);
    return { ok: true };
  });
  ipcMain.handle("shell:openPath", (_e, fullPath) =>
    shell.openPath(fullPath).then((err) => ({ ok: !err, error: err })),
  );
  ipcMain.handle("app:getDownloadsPath", () =>
    require("electron").app.getPath("downloads"),
  );

  // ── SongRec helpers (local song recognition CLI) ──────────────────────────
  ipcMain.handle("songrec:listOutputs", async () => {
    const run = (bin, args = []) =>
      new Promise((resolve) => {
        execFile(
          bin,
          args,
          { windowsHide: true, timeout: 3500, maxBuffer: 1024 * 1024 },
          (error, stdout) => {
            if (error) {
              resolve({ ok: false, rows: [] });
              return;
            }
            const lines = String(stdout || "")
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            resolve({ ok: true, rows: lines });
          },
        );
      });

    const parsed = [];
    const out = await run("pactl", ["list", "short", "sinks"]);
    if (out.ok) {
      out.rows.forEach((line) => {
        const parts = line.split(/\t+/);
        const id = String(parts[1] || "").trim();
        if (!id) return;
        const desc = String(parts[1] || id).trim();
        parsed.push({ id, label: desc });
      });
    }

    if (!parsed.length) {
      return { ok: true, outputs: [] };
    }

    const uniq = [];
    const seen = new Set();
    parsed.forEach((row) => {
      const key = String(row.id || "").trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      uniq.push(row);
    });
    return { ok: true, outputs: uniq };
  });

  ipcMain.handle("songrec:recognize", async (_e, options) => {
    const cfg = options || {};
    const command = String(cfg.command || "songrec").trim() || "songrec";
    const outputDevice = String(cfg.outputDevice || "").trim();
    const timeoutMs = Math.max(
      2000,
      Math.min(25000, Number(cfg.timeoutMs || 12000) || 12000),
    );

    const parseCommandLine = (value) => {
      const parts = [];
      String(value || "")
        .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
        ?.forEach((part) => {
          const unquoted = part.replace(/^['"]|['"]$/g, "").trim();
          if (unquoted) parts.push(unquoted);
        });
      return parts;
    };

    const createAttempt = (cmdText, presetArgs = []) => {
      const tokens = parseCommandLine(cmdText);
      if (!tokens.length) return null;
      const bin = tokens[0];
      const args = [...tokens.slice(1), ...presetArgs];
      if (!args.includes("recognize")) args.push("recognize");
      return { bin, args };
    };

    const attempts = [];
    const primary = createAttempt(command);
    if (primary) attempts.push(primary);

    if (command === "songrec") {
      attempts.push({ bin: "/usr/bin/songrec", args: ["recognize"] });
      attempts.push({ bin: "/usr/local/bin/songrec", args: ["recognize"] });
      attempts.push({ bin: "/bin/songrec", args: ["recognize"] });
      attempts.push({ bin: "/snap/bin/songrec", args: ["recognize"] });
      attempts.push({
        bin: "flatpak",
        args: ["run", "com.github.marinm.songrec", "recognize"],
      });
    }

    const seen = new Set();
    const uniqueAttempts = attempts.filter((a) => {
      const key = `${a.bin} ${a.args.join(" ")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const runAttempt = (bin, args) =>
      new Promise((resolve) => {
        execFile(
          bin,
          args,
          {
            windowsHide: true,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            env: outputDevice
              ? { ...process.env, PULSE_SINK: outputDevice }
              : process.env,
          },
          (error, stdout, stderr) => {
            if (error) {
              resolve({
                ok: false,
                code: error.code,
                timedOut: error.killed || error.signal === "SIGTERM",
                errorText:
                  String(stderr || stdout || error.message || "SongRec failed").trim() ||
                  "SongRec failed",
              });
              return;
            }

            const raw = String(stdout || "").trim();
            const lines = raw
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            const title = lines.length ? lines[lines.length - 1] : "";
            resolve({ ok: true, title, raw });
          },
        );
      });

    for (const attempt of uniqueAttempts) {
      const result = await runAttempt(attempt.bin, attempt.args);
      if (result.ok) return result;

      if (result.timedOut) {
        return {
          ok: false,
          error:
            "SongRec timeout. Povećaj timeout u Postavke → AI Live Chat ili pusti čistiji audio.",
        };
      }

      if (result.code === "ENOENT") {
        continue;
      }

      return {
        ok: false,
        error: result.errorText,
      };
    }

    return {
      ok: false,
      error:
        "SongRec nije pronađen. Instaliraj SongRec ili upiši komandu/putanju u Postavke → AI Live Chat (npr. songrec ili flatpak run com.github.marinm.songrec).",
    };
  });

  // ── Qwen3Guard-Stream moderation (local Python runtime) ───────────────────
  ipcMain.handle("ai:qwen3GuardScan", async (_e, payload) => {
    try {
      const resolvedScriptPath = resolvePythonScriptPath("qwen3guard_scan.py");
      const scriptPath = materializePythonScriptForExec(resolvedScriptPath, "qwen3guard_scan.py");
      logPythonBridgeDebug("qwen3guard", "Resolved script path", scriptPath || "(not found)");
      if (!fs.existsSync(scriptPath)) {
        return { ok: false, error: "Qwen3Guard scanner script missing (checked app.asar/app.asar.unpacked): qwen3guard_scan.py" };
      }

      const input = {
        model: String(payload?.model || "Qwen/Qwen3Guard-Stream-0.6B"),
        items: Array.isArray(payload?.items) ? payload.items : [],
      };
      if (!input.items.length) return { ok: true, results: [] };

      const encoded = Buffer.from(JSON.stringify(input), "utf8").toString("base64");
      const resolvedProjectRoot = resolvePythonProjectRoot();
      const missingDepRe = /No module named ['\"]?(torch|transformers|gliclass)['\"]?/i;
      const tryRunScan = async () => {
        const candidates = resolvePythonCandidates(resolvedProjectRoot);
        logPythonBridgeDebug("qwen3guard", "Python candidates", candidates);
        let lastErr = "Python runtime not found";
        let hadRuntimeError = false;

        for (const py of candidates) {
          if (path.isAbsolute(py) && !fs.existsSync(py)) continue;
          logPythonBridgeDebug("qwen3guard", "Trying python runtime", py);
          const run = await execFileJson(py, [scriptPath, encoded], 300000);
          if (!run.ok) {
            if (run.error?.code === "ENOENT") {
              if (!hadRuntimeError) lastErr = "Python runtime not found: " + py;
              continue;
            }
            hadRuntimeError = true;
            lastErr = String(run.stderr || run.stdout || run.error?.message || "Qwen3Guard failed").trim();
            continue;
          }
          const out = run.data || {};
          if (out.ok) {
            logPythonBridgeDebug("qwen3guard", "Scan finished successfully via", py);
            return { ok: true, out, lastErr: "" };
          }
          lastErr = String(out.error || "Qwen3Guard scanner returned error").trim();
        }
        return { ok: false, out: null, lastErr };
      };

      let scan = await tryRunScan();
      if (scan.ok && scan.out) return scan.out;
      let lastErr = String(scan.lastErr || "Qwen3Guard execution failed").trim();

      if (missingDepRe.test(lastErr)) {
        logPythonBridgeDebug("qwen3guard", "Missing python module detected, attempting dependency install");
        const installRes = await installPythonBridgeDeps();
        if (installRes?.ok) {
          scan = await tryRunScan();
          if (scan.ok && scan.out) return scan.out;
          lastErr = String(scan.lastErr || lastErr).trim();
        } else {
          lastErr = `${lastErr} | Python deps install failed: ${String(installRes?.error || "unknown")}`;
        }
      }

      logPythonBridgeDebug("qwen3guard", "Scan failed", lastErr);

      return { ok: false, error: lastErr || "Qwen3Guard execution failed" };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // ── Opir moderation (local Python runtime) ───────────────────────────────
  ipcMain.handle("ai:opirGuardScan", async (_e, payload) => {
    try {
      const resolvedScriptPath = resolvePythonScriptPath("opir_scan.py");
      const scriptPath = materializePythonScriptForExec(resolvedScriptPath, "opir_scan.py");
      logPythonBridgeDebug("opir", "Resolved script path", scriptPath || "(not found)");
      if (!fs.existsSync(scriptPath)) {
        return { ok: false, error: "Opir scanner script missing (checked app.asar/app.asar.unpacked): opir_scan.py" };
      }

      const input = {
        model: String(payload?.model || "knowledgator/opir-multitask-large-v1.0"),
        items: Array.isArray(payload?.items) ? payload.items : [],
      };
      if (!input.items.length) return { ok: true, results: [] };

      const encoded = Buffer.from(JSON.stringify(input), "utf8").toString("base64");
      const resolvedProjectRoot = resolvePythonProjectRoot();
      const candidates = resolvePythonCandidates(resolvedProjectRoot);
      logPythonBridgeDebug("opir", "Python candidates", candidates);
      let lastErr = "Python runtime not found";
      let hadRuntimeError = false;

      for (const py of candidates) {
        if (path.isAbsolute(py) && !fs.existsSync(py)) continue;
        logPythonBridgeDebug("opir", "Trying python runtime", py);
        const run = await execFileJson(py, [scriptPath, encoded], 300000);
        if (!run.ok) {
          if (run.error?.code === "ENOENT") {
            if (!hadRuntimeError) lastErr = "Python runtime not found: " + py;
            continue;
          }
          hadRuntimeError = true;
          lastErr = String(run.stderr || run.stdout || run.error?.message || "Opir failed").trim();
          continue;
        }
        const out = run.data || {};
        if (out.ok) {
          logPythonBridgeDebug("opir", "Scan finished successfully via", py);
          return out;
        }
        lastErr = String(out.error || "Opir scanner returned error").trim();
      }

      logPythonBridgeDebug("opir", "Scan failed", lastErr);

      return { ok: false, error: lastErr || "Opir execution failed" };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // ── NLLB-200 translation (Indonesian -> Croatian) ─────────────────────────
  ipcMain.handle("ai:nllbTranslate", async (_e, payload) => {
    try {
      const resolvedScriptPath = resolvePythonScriptPath("nllb_translate.py");
      const scriptPath = materializePythonScriptForExec(resolvedScriptPath, "nllb_translate.py");
      logPythonBridgeDebug("nllb", "Resolved script path", scriptPath || "(not found)");
      if (!fs.existsSync(scriptPath)) {
        return { ok: false, error: "NLLB translator script missing (checked app.asar/app.asar.unpacked): nllb_translate.py" };
      }

      const input = {
        model: String(payload?.model || "facebook/nllb-200-distilled-600M"),
        src_lang: String(payload?.src_lang || "ind_Latn"),
        tgt_lang: String(payload?.tgt_lang || "hrv_Latn"),
        items: Array.isArray(payload?.items) ? payload.items : [],
      };
      if (!input.items.length) return { ok: true, results: [] };

      const encoded = Buffer.from(JSON.stringify(input), "utf8").toString("base64");
      const resolvedProjectRoot = resolvePythonProjectRoot();
      const candidates = resolvePythonCandidates(resolvedProjectRoot);
      logPythonBridgeDebug("nllb", "Python candidates", candidates);
      let lastErr = "Python runtime not found";
      let hadRuntimeError = false;

      for (const py of candidates) {
        if (path.isAbsolute(py) && !fs.existsSync(py)) continue;
        logPythonBridgeDebug("nllb", "Trying python runtime", py);
        const run = await execFileJson(py, [scriptPath, encoded], 300000);
        if (!run.ok) {
          if (run.error?.code === "ENOENT") {
            if (!hadRuntimeError) lastErr = "Python runtime not found: " + py;
            continue;
          }
          hadRuntimeError = true;
          lastErr = String(run.stderr || run.stdout || run.error?.message || "NLLB translation failed").trim();
          continue;
        }
        const out = run.data || {};
        if (out.ok) {
          logPythonBridgeDebug("nllb", "Translate finished successfully via", py);
          return out;
        }
        lastErr = String(out.error || "NLLB translator returned error").trim();
      }

      logPythonBridgeDebug("nllb", "Translate failed", lastErr);

      return { ok: false, error: lastErr || "NLLB execution failed" };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // ── Screenshot Region (returns base64) ─────────────────────────────────────
  ipcMain.handle("app:captureRegion", async (_e, rect) => {
    try {
      const img = await mainWindow.webContents.capturePage(
        rect
          ? {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
          : undefined,
      );
      return { ok: true, dataUrl: img.toDataURL() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Downloads (SQLite) ─────────────────────────────────────────────────────
  ipcMain.handle("db:addDownload", (_e, data) =>
    db ? db.addDownload(data) : noDb(),
  );
  ipcMain.handle("db:getDownloads", (_e, limit) =>
    db ? db.getDownloads(limit) : [],
  );
  ipcMain.handle("db:deleteDownload", (_e, id) =>
    db ? db.deleteDownload(id) : noDb(),
  );
  ipcMain.handle("db:clearDownloads", () =>
    db ? db.clearDownloads() : noDb(),
  );

  // ── Sessions (SQLite) ──────────────────────────────────────────────────────
  ipcMain.handle("db:saveSession", (_e, data) =>
    db ? db.saveSession(data) : noDb(),
  );
  ipcMain.handle("db:getSessions", (_e, limit) =>
    db ? db.getSessions(limit) : [],
  );
  ipcMain.handle("db:deleteSession", (_e, id) =>
    db ? db.deleteSession(id) : noDb(),
  );

  // ── Notes (SQLite) ─────────────────────────────────────────────────────────
  ipcMain.handle("db:addNote", (_e, data) => (db ? db.addNote(data) : noDb()));
  ipcMain.handle("db:getNotes", () => (db ? db.getNotes() : []));
  ipcMain.handle("db:updateNote", (_e, id, data) =>
    db ? db.updateNote(id, data) : noDb(),
  );
  ipcMain.handle("db:deleteNote", (_e, id) =>
    db ? db.deleteNote(id) : noDb(),
  );

  // ── User Profile (SQLite) ──────────────────────────────────────────────────
  ipcMain.handle("db:getUserProfile", () => (db ? db.getUserProfile() : null));
  ipcMain.handle("db:saveUserProfile", (_e, data) =>
    db ? db.saveUserProfile(data) : noDb(),
  );

  // ── Lighthouse Audits (SQLite) ─────────────────────────────────────────────
  ipcMain.handle("db:saveLighthouseAudit", (_e, data) =>
    db ? db.saveLighthouseAudit(data) : noDb(),
  );
  ipcMain.handle("db:getLighthouseAudits", (_e, url, limit) =>
    db ? db.getLighthouseAudits(url, limit) : [],
  );

  ipcMain.handle("db:getAiCache", (_e, limit) =>
    db ? db.getAiCache(limit) : [],
  );
  ipcMain.handle("db:clearAiCache", () => (db ? db.clearAiCache() : noDb()));

  // ── History Top Visited ────────────────────────────────────────────────────
  ipcMain.handle("db:getTopVisited", (_e, limit) =>
    db ? db.getTopVisited(limit) : [],
  );

  // ── Screenshot Folder Chooser ─────────────────────────────────────────────
  ipcMain.handle("app:chooseScreenshotFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Screenshot Folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  });

  // ── Profile Picture Upload ─────────────────────────────────────────────────
  ipcMain.handle("app:chooseProfilePicture", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Odaberi profilnu sliku",
      filters: [
        { name: "Slike", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    try {
      const fs = require("fs");
      const data = fs.readFileSync(result.filePaths[0]);
      const ext = path.extname(result.filePaths[0]).slice(1).toLowerCase();
      const mime =
        ext === "png"
          ? "image/png"
          : ext === "gif"
            ? "image/gif"
            : ext === "webp"
              ? "image/webp"
              : "image/jpeg";
      const dataUrl = `data:${mime};base64,${data.toString("base64")}`;
      return { ok: true, dataUrl };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Update: check / token / download / install ───────────────────────────
  ipcMain.handle("update:saveToken", (_e, token) => {
    if (!db) return { ok: false, error: "DB not ready" };
    saveSettingsSecurely({ ...getMergedSettings(), githubUpdateToken: token.trim() });
    return { ok: true };
  });
  ipcMain.handle("update:hasToken", () => {
    if (!db) return false;
    const s = getMergedSettings();
    return !!(s.githubUpdateToken && s.githubUpdateToken.length > 0);
  });
  ipcMain.handle("update:check", async () => {
    try {
      const isSemverNewer = (nextVersion, currentVersion) => {
        const nextParts = String(nextVersion || "")
          .split(".")
          .map((part) => Number.parseInt(part, 10) || 0);
        const currentParts = String(currentVersion || "")
          .split(".")
          .map((part) => Number.parseInt(part, 10) || 0);
        const len = Math.max(nextParts.length, currentParts.length);
        for (let i = 0; i < len; i += 1) {
          const next = nextParts[i] || 0;
          const current = currentParts[i] || 0;
          if (next > current) return true;
          if (next < current) return false;
        }
        return false;
      };

      const s = db ? getMergedSettings() : {};
      const token = s.giteaUpdateToken || s.githubUpdateToken || "";
      const headers = {
        "User-Agent": "EtherX-Browser",
        Accept: "application/vnd.github+json",
      };
      if (token) headers["Authorization"] = "Bearer " + token;
      const { net } = require("electron");
      const GITHUB_API =
        "https://api.github.com/repos/ktrucek/etherx-standalone/releases/latest";
      const result = await new Promise((resolve, reject) => {
        const req = net.request({ method: "GET", url: GITHUB_API, headers });
        let body = "";
        req.on("response", (res) => {
          res.on("data", (chunk) => {
            body += chunk.toString();
          });
          res.on("end", () => {
            if (res.statusCode === 404) {
              resolve({
                ok: false,
                error: "Nema objavljenih verzija na GitHub-u",
              });
              return;
            }
            if (res.statusCode !== 200) {
              resolve({
                ok: false,
                error: "GitHub API greška: HTTP " + res.statusCode,
              });
              return;
            }
            try {
              const data = JSON.parse(body);
              const latest = (data.tag_name || "").replace(/^v/, "");
              const current = app.getVersion();
              const assets = (data.assets || []).map((a) => ({
                name: a.name,
                url: a.browser_download_url || "",
                size: a.size,
              }));
              resolve({
                ok: true,
                current,
                latest,
                isNew: isSemverNewer(latest, current),
                name: data.name || data.tag_name,
                body: data.body || "",
                assets,
                publishedAt: data.published_at || "",
              });
            } catch (e) {
              resolve({ ok: false, error: "Parse error: " + e.message });
            }
          });
        });
        req.on("error", (e) => reject(e));
        req.end();
      });
      return result;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Download an update asset to temp, sending progress to renderer
  ipcMain.handle("update:download", async (_e, url, filename) => {
    try {
      const os = require("os");
      const tmpDir = path.join(os.tmpdir(), "etherx-update");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const dest = path.join(tmpDir, filename);
      // Clean previous download if any
      if (fs.existsSync(dest)) fs.unlinkSync(dest);

      const { net } = require("electron");
      const s = db ? getMergedSettings() : {};
      const token = s.giteaUpdateToken || s.githubUpdateToken || "";
      const allowedUpdateHosts = new Set([
        "github.com",
        "api.github.com",
        "objects.githubusercontent.com",
        "objects-origin.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "github-releases.githubusercontent.com",
      ]);
      const allowedUpdateHostSuffixes = [
        ".githubusercontent.com",
        ".github-releases.githubusercontent.com",
      ];
      const isAllowedUpdateHost = (host) => {
        const h = String(host || "").toLowerCase();
        if (!h) return false;
        if (allowedUpdateHosts.has(h)) return true;
        for (const suffix of allowedUpdateHostSuffixes) {
          if (h.endsWith(suffix)) return true;
        }
        // Legacy GitHub release redirects can point to signed S3 asset hosts.
        if (/^github-production-release-asset-[a-z0-9-]+\.s3\.amazonaws\.com$/.test(h)) return true;
        return false;
      };
      const normalizeUpdateUrl = (candidate, baseUrl = null) => {
        try {
          const parsed = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
          const host = String(parsed.hostname || "").toLowerCase();
          if (parsed.protocol !== "https:") return null;
          if (!isAllowedUpdateHost(host)) return null;
          return parsed.toString();
        } catch (_) {
          return null;
        }
      };
      const safeUrl = normalizeUpdateUrl(url);
      if (!safeUrl) return { ok: false, error: "Invalid update URL" };

      // Use net.fetch with redirect:'follow' — Electron handles GitHub's multi-hop
      // CDN redirects transparently, eliminating ERR_ABORTED (-3) race conditions
      // that occur when using net.request with redirect:'manual'.
      const fetchHeaders = {
        "User-Agent": "EtherX-Browser",
        "Accept": "application/octet-stream",
      };
      if (token) fetchHeaders["Authorization"] = "Bearer " + token;

      const response = await net.fetch(safeUrl, {
        method: "GET",
        headers: fetchHeaders,
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const total = parseInt(response.headers.get("content-length") || "0", 10);
      let received = 0;
      let lastProgress = -1;
      const ws = fs.createWriteStream(dest);
      const reader = response.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          await new Promise((res, rej) => ws.write(chunk, (err) => err ? rej(err) : res()));
          received += chunk.length;
          const pct = total > 0 ? Math.round((received / total) * 100) : -1;
          if (pct !== lastProgress) {
            lastProgress = pct;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("update:progress", {
                percent: pct,
                received,
                total,
                filename,
              });
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      await new Promise((res, rej) => ws.end((err) => err ? rej(err) : res()));

      return { ok: true, filePath: dest, filename };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Source-based update path: pull latest from GitHub and run local deploy.sh
  ipcMain.handle("update:deployFromGithub", async () => {
    if (app.isPackaged) {
      return {
        ok: false,
        error: "Source deploy nije dostupan u pakiranoj aplikaciji. Koristi Ažuriranja → Preuzmi za standardni update.",
      };
    }
    try {
      const candidates = [
        process.cwd(),
        __dirname,
        path.resolve(__dirname, ".."),
      ];

      const root = candidates.find((p) => {
        try {
          return (
            fs.existsSync(path.join(p, ".git")) &&
            fs.existsSync(path.join(p, "deploy.sh"))
          );
        } catch (_) {
          return false;
        }
      });

      if (!root) {
        return {
          ok: false,
          error: "Nisam pronašao Git repozitorij s deploy.sh za source deploy.",
        };
      }

      const branchRun = await execFileAsync("git", [
        "-C",
        root,
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      const branch = String(branchRun.stdout || "main").trim() || "main";

      await execFileAsync("git", ["-C", root, "fetch", "--tags", "origin"]);
      await execFileAsync("git", [
        "-C",
        root,
        "pull",
        "--ff-only",
        "origin",
        branch,
      ]);

      await execFileAsync("bash", [path.join(root, "deploy.sh")], { cwd: root });

      return {
        ok: true,
        root,
        branch,
      };
    } catch (e) {
      return {
        ok: false,
        error: String(e?.message || e),
      };
    }
  });

  function execFileAsync(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(command, args, options, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  function findFirstAppBundle(rootDir) {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory() && entry.name.endsWith(".app")) return fullPath;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = findFirstAppBundle(path.join(rootDir, entry.name));
      if (nested) return nested;
    }
    return null;
  }

  function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  }

  function resolveCurrentMacAppBundlePath() {
    try {
      let current = path.resolve(process.execPath || "");
      while (current && current !== path.dirname(current)) {
        if (current.toLowerCase().endsWith(".app")) return current;
        current = path.dirname(current);
      }
    } catch (_) {
      // ignore
    }
    return "";
  }

  function resolveMacUpdateDestination(appName) {
    const currentBundle = resolveCurrentMacAppBundlePath();
    if (currentBundle && path.basename(currentBundle) === appName) {
      return currentBundle;
    }
    return path.join("/Applications", appName);
  }

  async function installMacAppBundleToDestination(appBundle, destApp) {
    // Disable Electron's ASAR interceptor so rmSync can unlink app.asar as a file
    const _noAsar = process.noAsar;
    process.noAsar = true;
    try {
      fs.rmSync(destApp, { recursive: true, force: true });
    } finally {
      process.noAsar = _noAsar;
    }

    try {
      await execFileAsync("/usr/bin/ditto", [appBundle, destApp]);
      await execFileAsync("/usr/bin/xattr", ["-dr", "com.apple.quarantine", destApp]).catch(() => ({ stdout: "", stderr: "" }));
    } catch (error) {
      if (!["EACCES", "EPERM"].includes(error.code)) throw error;
      const copyScript = [
        `/bin/rm -rf ${shellQuote(destApp)}`,
        `/usr/bin/ditto ${shellQuote(appBundle)} ${shellQuote(destApp)}`,
        `/usr/bin/xattr -dr com.apple.quarantine ${shellQuote(destApp)} || true`,
      ].join(" && ");
      await execFileAsync("/usr/bin/osascript", [
        "-e",
        `do shell script ${JSON.stringify(copyScript)} with administrator privileges`,
      ]);
    }

    await execFileAsync("/usr/bin/open", ["-n", destApp]);
    return { appPath: destApp };
  }

  async function installMacZipUpdate(zipPath) {
    const os = require("os");
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "etherx-update-install-"),
    );
    const extractDir = path.join(tempRoot, "expanded");
    fs.mkdirSync(extractDir, { recursive: true });

    try {
      await execFileAsync("/usr/bin/ditto", ["-x", "-k", zipPath, extractDir]);
      const appBundle = findFirstAppBundle(extractDir);
      if (!appBundle) {
        throw new Error("ZIP ne sadrži .app bundle za instalaciju");
      }

      const appName = path.basename(appBundle);
      const destApp = resolveMacUpdateDestination(appName);
      return await installMacAppBundleToDestination(appBundle, destApp);
    } finally {
      const _noAsar2 = process.noAsar;
      process.noAsar = true;
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } finally { process.noAsar = _noAsar2; }
    }
  }

  async function installMacDmgUpdate(dmgPath) {
    const os = require("os");
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "etherx-update-dmg-"),
    );
    const mountPoint = path.join(tempRoot, "mount");
    fs.mkdirSync(mountPoint, { recursive: true });

    let mounted = false;
    try {
      await execFileAsync("/usr/bin/hdiutil", [
        "attach",
        dmgPath,
        "-nobrowse",
        "-readonly",
        "-mountpoint",
        mountPoint,
      ]);
      mounted = true;

      const appBundle = findFirstAppBundle(mountPoint);
      if (!appBundle) {
        throw new Error("DMG ne sadrži .app bundle za instalaciju");
      }

      const appName = path.basename(appBundle);
      const destApp = resolveMacUpdateDestination(appName);
      return await installMacAppBundleToDestination(appBundle, destApp);
    } finally {
      if (mounted) {
        try {
          await execFileAsync("/usr/bin/hdiutil", ["detach", mountPoint, "-force"]);
        } catch (_) {
          // ignore
        }
      }

      const _noAsar2 = process.noAsar;
      process.noAsar = true;
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } finally { process.noAsar = _noAsar2; }
    }
  }

  async function tryCleanupUpdateFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    const _noAsar = process.noAsar;
    process.noAsar = true;
    try {
      fs.rmSync(filePath, { force: true });
    } finally {
      process.noAsar = _noAsar;
    }
  }

  // Install: open the downloaded file and quit
  ipcMain.handle("update:install", async (_e, filePath) => {
    try {
      if (!fs.existsSync(filePath))
        return { ok: false, error: "Datoteka ne postoji" };
      const ext = path.extname(filePath).toLowerCase();

      if (process.platform === "darwin") {
        let shouldCleanupArchive = false;
        if (ext === ".zip") {
          await installMacZipUpdate(filePath);
          shouldCleanupArchive = true;
        } else if (ext === ".dmg") {
          await installMacDmgUpdate(filePath);
          shouldCleanupArchive = true;
        } else {
          await shell.openPath(filePath);
        }
        if (shouldCleanupArchive) {
          await tryCleanupUpdateFile(filePath).catch((err) => {
            console.warn("[update] archive cleanup failed:", err?.message || err);
          });
        }
        setTimeout(() => app.quit(), 1500);
      } else if (process.platform === "linux") {
        if (ext === ".appimage") {
          fs.chmodSync(filePath, 0o755);
          const { spawn } = require("child_process");
          spawn(filePath, [], { detached: true, stdio: "ignore" }).unref();
          setTimeout(() => app.quit(), 1000);
        } else if (ext === ".deb") {
          // Show in folder — user may need sudo
          shell.showItemInFolder(filePath);
          dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "EtherX Update",
            message: "DEB paket je preuzet.",
            detail: `Instaliraj s:\nsudo dpkg -i "${path.basename(filePath)}"`,
            buttons: ["OK"],
          });
        } else {
          await shell.openPath(filePath);
        }
      } else {
        // Windows: open exe/zip
        await shell.openPath(filePath);
        setTimeout(() => app.quit(), 1500);
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Open settings page ────────────────────────────────────────────────────
  ipcMain.on("app:openSettings", () => {
    const settingsPath = path.join(__dirname, "src", "settings.html");
    const settingsWin = new BrowserWindow({
      width: 960,
      height: 700,
      parent: mainWindow,
      modal: false,
      backgroundColor: "#1e1e1e",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    settingsWin.loadFile(settingsPath);
    settingsWin.setMenuBarVisibility(false);
  });
}

// ─── Navigation safety + context-menu passthrough ────────────────────────────
app.on("web-contents-created", (_event, contents) => {
  // Gracefully handle load failures in webviews (guest views) to prevent
  // uncaught "Error invoking remote method 'GUEST_VIEW_MANAGER_CALL'" errors
  contents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (errorCode === -3) return; // ERR_ABORTED — normal during navigation
      if (!isMainFrame) return; // Only handle main frame failures
      console.warn(
        `[webContents] did-fail-load: ${errorCode} ${errorDescription} — ${validatedURL}`,
      );
    },
  );

  contents.on("before-input-event", (event, input) => {
    if (
      process.platform !== "darwin" ||
      !input.meta ||
      input.control ||
      input.alt
    )
      return;
    const key = (input.key || "").toLowerCase();
    try {
      if (key === "c") {
        contents.copy();
        event.preventDefault();
      } else if (key === "v") {
        contents.paste();
        event.preventDefault();
      } else if (key === "x") {
        contents.cut();
        event.preventDefault();
      } else if (key === "a") {
        contents.selectAll();
        event.preventDefault();
      } else if (key === "z" && input.shift) {
        contents.redo();
        event.preventDefault();
      } else if (key === "z") {
        contents.undo();
        event.preventDefault();
      }
    } catch (_) { }
  });

  // Handle new windows (popups, target="_blank", window.open) — route them as new tabs inside EtherX
  // Without this handler Electron's default is to open new windows in the system default browser!
  contents.setWindowOpenHandler((details) => {
    try {
      const parsedUrl = new URL(details.url);

      // Block external app protocols
      if (
        [
          "mailto:",
          "tel:",
          "sms:",
          "facetime:",
          "skype:",
          "zoom:",
          "magnet:",
          "sip:",
        ].includes(parsedUrl.protocol)
      ) {
        return { action: "deny" };
      }

      if (
        ["http:", "https:", "about:", "chrome-extension:"].includes(
          parsedUrl.protocol,
        )
      ) {
        // OAuth / login popup detection:
        // These sites open small popup windows for authentication that communicate
        // back to the opener via window.opener.postMessage(). If we convert them
        // to a new tab the window.opener reference is lost and login breaks.
        const isOAuthPopup =
          details.disposition === "new-popup" ||
          /accounts\.google\.com|login\.live\.com|appleid\.apple\.com|facebook\.com\/dialog|twitter\.com\/oauth|x\.com\/oauth|tiktok\.com\/login|accounts\.tiktok\.com|github\.com\/login\/oauth|discord\.com\/oauth2|linkedin\.com\/oauth|reddit\.com\/api\/v1\/authorize|openrouter\.ai\/auth|accounts\.openrouter\.ai|clerk\.openrouter\.ai|auth\.openrouter\.ai|[^/]*\.clerk\.accounts\.dev|[^/]*\.clerk\.com|auth0\.com|okta\.com\/oauth2|login\.microsoftonline\.com|huggingface\.co\/login|openai\.com\/auth|anthropic\.com\/login/i.test(
            details.url,
          );

        const isGoogleOAuthPopup =
          /accounts\.google\.com|consent\.google\.com|\/o\/oauth2|flowname=glifwebsignin|flowentry=servicelogin/i.test(
            details.url,
          );

        if (isGoogleOAuthPopup) {
          // Google aggressively blocks embedded OAuth/login windows. Route only
          // Google auth popups to the system browser to guarantee sign-in.
          shell.openExternal(details.url).catch(() => { });
          return { action: "deny" };
        }

        if (isOAuthPopup) {
          // Allow as a real popup BrowserWindow so window.opener is preserved.
          // Include the webview-preload so navigator.webdriver = false and other
          // bot-detection spoofs are active inside the popup (needed for Clerk,
          // Google OAuth, GitHub OAuth, etc.).
          return {
            action: "allow",
            overrideBrowserWindowOptions: {
              width: details.features?.match(/width=(\d+)/)?.[1]
                ? parseInt(details.features.match(/width=(\d+)/)[1])
                : 520,
              height: details.features?.match(/height=(\d+)/)?.[1]
                ? parseInt(details.features.match(/height=(\d+)/)[1])
                : 620,
              webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                partition: "persist:etherx",
                webviewTag: false,
                preload: path.join(__dirname, "src", "webview-preload.js"),
              },
              parent: mainWindow || undefined,
            },
          };
        }

        // Regular target="_blank" / new tab link — route inside EtherX
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("app:createTab", details.url);
        }
        return { action: "deny" };
      }
    } catch (_) { }

    return { action: "deny" };
  });

  contents.on("will-navigate", (_e, url) => {
    try {
      const { URL: NURL } = require("url");
      const parsed = new NURL(url);
      if (["mailto:", "tel:", "sms:", "magnet:"].includes(parsed.protocol)) {
        _e.preventDefault();
      } else if (
        !["http:", "https:", "file:", "about:", "chrome-extension:"].includes(
          parsed.protocol,
        )
      ) {
        _e.preventDefault();
      }
    } catch {
      _e.preventDefault();
    }
  });

  // Forward webview context-menu event to the parent renderer so the custom
  // ctx-menu HTML overlay is shown instead of Electron's built-in popup.
  contents.on("context-menu", (_e, params) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("webview-context-menu", {
      x: params.x,
      y: params.y,
      linkURL: params.linkURL || "",
      linkText: params.linkText || "",
      srcURL: params.srcURL || "",
      mediaType: params.mediaType || "none",
      selectionText: params.selectionText || "",
      isEditable: params.isEditable || false,
      pageURL: params.pageURL || "",
    });
  });
});
