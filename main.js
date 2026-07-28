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
  webContents,
} = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");
const ETHERX_DEBUG_LOGS = process.env.ETHERX_DEBUG === "1" || process.env.ETHERX_DEBUG_LOGS === "1";
let AdmZip;
try {
  AdmZip = require("adm-zip");
} catch (_) {
  /* optional — needed only for CWS extension downloads */
}

// Let Chromium manage V8 memory on desktop.  Forced size optimisation and a
// 100 ms GC interval caused visible pauses under multiple webviews/video tabs.
// Electron's normal memory pressure handling is faster and safer across macOS,
// Windows and Linux than a global heap cap derived from total system RAM.

// ─── Command-line switches ─────────────────────────────────────────────────────
// disable-gpu kills rendering on macOS (blank window on Apple Silicon + Intel Rosetta)
// Only apply on Linux headless/CI environments — on desktop keep GPU enabled for performance
const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const isHeadless =
  process.env.DISPLAY === undefined && process.platform === "linux";
// Linux desktop default: keep GPU enabled. Electron webviews can render as a
// permanent white/blank surface on some Mint/Ubuntu stacks when GPU is disabled.
// Use ETHERX_DISABLE_GPU=1 for explicit safe mode; CI/headless still disables it.
const forceDisableGpu =
  process.env.ETHERX_DISABLE_GPU === "1" ||
  isCI ||
  isHeadless;
const forceDisableGpuSandbox = process.env.ETHERX_DISABLE_GPU_SANDBOX === "1";
const aggressiveGpuFlags = process.env.ETHERX_GPU_AGGRESSIVE === "1";
const enableLinuxVaapi = process.env.ETHERX_ENABLE_VAAPI === "1";

if (forceDisableGpu) {
  app.disableHardwareAcceleration();
}

if (process.platform !== "darwin") {
  app.commandLine.appendSwitch("no-sandbox");
  // Desktop Chromium is faster when it can use shared memory. Keep this
  // workaround only for CI/headless containers where /dev/shm is tiny.
  if (isCI || isHeadless) app.commandLine.appendSwitch("disable-dev-shm-usage");

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
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
app.userAgentFallback = CHROME_CLEAN_UA;

function isAuthDeepLinkProtocol(protocol) {
  return [
    "intent:",
    "itms-apps:",
    "itms:",
    "x-apple.systempreferences:",
    "comgoogleaccounts:",
    "com.googleusercontent.apps:",
    "googlechrome:",
    "googlechromes:",
    "signinwithapple:",
    "appleauth:",
    "msauth:",
    "ms-appx-web:",
  ].includes(String(protocol || "").toLowerCase());
}

// Google OAuth is configurable locally so packaged Windows builds can use the
// application's own Desktop OAuth client instead of a web-client fallback.
const GOOGLE_OAUTH_DEFAULT_CLIENT_ID = "1040916328983-qkm8qiqao1sia5m965lh1re2076ab6af.apps.googleusercontent.com";
let activeGoogleOAuthLogin = null;

function getGoogleOAuthConfig() {
  const local = typeof _readEnvLocalMap === "function" ? _readEnvLocalMap() : {};
  return {
    clientId: String(process.env.ETHERX_GOOGLE_OAUTH_CLIENT_ID || local.ETHERX_GOOGLE_OAUTH_CLIENT_ID || GOOGLE_OAUTH_DEFAULT_CLIENT_ID).trim(),
    clientSecret: String(process.env.ETHERX_GOOGLE_OAUTH_CLIENT_SECRET || local.ETHERX_GOOGLE_OAUTH_CLIENT_SECRET || "").trim(),
  };
}

function makeGoogleOAuthVerifier() {
  return crypto.randomBytes(48).toString("base64url");
}

function googleOAuthChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

async function startGoogleOAuthLogin() {
  if (activeGoogleOAuthLogin) return activeGoogleOAuthLogin;
  const googleOAuth = getGoogleOAuthConfig();
  if (!googleOAuth.clientId) {
    return { ok: false, error: "Google OAuth client ID nije konfiguriran." };
  }

  activeGoogleOAuthLogin = new Promise((resolve) => {
    const state = crypto.randomBytes(24).toString("base64url");
    const verifier = makeGoogleOAuthVerifier();
    let settled = false;
    let timeout = null;
    let server = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try { server?.close(); } catch (_) { }
      activeGoogleOAuthLogin = null;
      resolve(result);
    };
    const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui;background:#101827;color:#e5e7eb;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:440px;padding:28px;text-align:center;border:1px solid #334155;border-radius:14px;background:#111827}p{color:#cbd5e1}</style><main><h2>${title}</h2><p>${text}</p><p>Možeš zatvoriti ovaj prozor i vratiti se u EtherX Browser.</p></main>`;

    server = http.createServer(async (req, res) => {
      let callbackUrl;
      try { callbackUrl = new URL(req.url || "/", "http://127.0.0.1"); } catch (_) { callbackUrl = null; }
      if (!callbackUrl || callbackUrl.pathname !== "/oauth2callback") {
        res.writeHead(404); res.end("Not found"); return;
      }
      const code = String(callbackUrl.searchParams.get("code") || "");
      const returnedState = String(callbackUrl.searchParams.get("state") || "");
      const error = String(callbackUrl.searchParams.get("error") || "");
      if (error || !code || returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Google prijava nije dovršena", error === "access_denied" ? "Prijava je otkazana." : "Povratni sigurnosni kod nije valjan."));
        finish({ ok: false, cancelled: error === "access_denied", error: error || "Google OAuth sigurnosna provjera nije prošla." });
        return;
      }
      try {
        const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
        const body = new URLSearchParams({
          code,
          client_id: googleOAuth.clientId,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: verifier,
        });
        if (googleOAuth.clientSecret) body.set("client_secret", googleOAuth.clientSecret);
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        const token = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !token.access_token) {
          const tokenError = String(token?.error_description || token?.error || "Google token nije vraćen.");
          if (/client_secret is missing/i.test(tokenError)) {
            throw new Error("Google OAuth client je postavljen kao Web application. U .env.local postavi ETHERX_GOOGLE_OAUTH_CLIENT_ID za Desktop client (preporučeno), ili dodaj ETHERX_GOOGLE_OAUTH_CLIENT_SECRET za svoj Web client.");
          }
          throw new Error(tokenError);
        }
        const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        const profile = await profileResponse.json().catch(() => ({}));
        if (!profileResponse.ok || !profile.sub || !profile.email) throw new Error("Google profil nije dostupan.");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Google račun povezan", `Prijavljen je račun ${String(profile.email).replace(/[<>&]/g, "")}.`));
        // Access token is intentionally discarded. EtherX stores only profile
        // metadata in its local profile and never stores the Google password.
        finish({
          ok: true, profile: {
            id: String(profile.sub), email: String(profile.email), name: String(profile.name || profile.email),
            picture: String(profile.picture || ""), verified: profile.email_verified === true,
          }
        });
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Google prijava nije uspjela", String(error?.message || error).replace(/[<>&]/g, "")));
        finish({ ok: false, error: String(error?.message || error) });
      }
    });
    server.once("error", (error) => finish({ ok: false, error: String(error?.message || error) }));
    server.listen(0, "127.0.0.1", async () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
      const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorizationUrl.search = new URLSearchParams({
        client_id: googleOAuth.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: googleOAuthChallenge(verifier),
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      try {
        await shell.openExternal(authorizationUrl.toString());
        timeout = setTimeout(() => finish({ ok: false, error: "Isteklo je vrijeme za Google prijavu." }), 5 * 60 * 1000);
      } catch (error) {
        finish({ ok: false, error: String(error?.message || error) });
      }
    });
  });
  return activeGoogleOAuthLogin;
}

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
let liveOsSnapshot = null;
const liveOsSubscribers = new Set();
let tkaiBotControlServer = null;
let tkaiTelegramBotChild = null;
let tkaiTelegramBotStartedAt = 0;
let tkaiTelegramBotLastExit = null;
let tkaiTelegramBotLastError = "";
let tkaiTelegramBotLogs = [];

// TikTok Chat AI capture source. The Python process streams structured
// TikTokLive events to the renderer without reading the embedded page DOM.
let tkaiTikTokLiveChild = null;
let tkaiTikTokLiveOwner = "";
let tkaiTikTokLiveConnected = false;

function resolveTikTokLiveRuntimeRoot() {
  const root = app.isPackaged
    ? path.join(app.getPath("userData"), "tiktoklive-runtime")
    : path.join(app.getAppPath(), "live-chat-server", ".tiktoklive-runtime");
  try { fs.mkdirSync(root, { recursive: true }); } catch (_) { }
  return root;
}

function resolveTikTokLivePython(runtimeRoot) {
  // Keep this separate from the legacy .venv, which may have been created
  // with Python 3.9. TikTokLive 7 uses PEP 604 annotations (`int | None`)
  // and therefore requires Python 3.10 or newer.
  const venv = path.join(runtimeRoot, ".venv-py310");
  return process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
}

async function inspectTikTokLivePython(command, prefixArgs = [], cwd = undefined) {
  const probe = await execFileText(
    command,
    [...prefixArgs, "-c", "import json,sys; print(json.dumps({'major':sys.version_info[0],'minor':sys.version_info[1],'version':sys.version.split()[0]}))"],
    30000,
    cwd ? { cwd } : {},
  );
  if (!probe.ok) return { ok: false, command, prefixArgs, error: trimPythonInstallOutput(probe.stderr || probe.stdout || probe.error?.message || "") };
  try {
    const parsed = JSON.parse(String(probe.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}");
    const major = Number(parsed.major || 0);
    const minor = Number(parsed.minor || 0);
    return {
      ok: major > 3 || (major === 3 && minor >= 10),
      command,
      prefixArgs,
      version: String(parsed.version || `${major}.${minor}`),
      error: major > 3 || (major === 3 && minor >= 10) ? "" : `Python ${major}.${minor} je prestar; potreban je Python 3.10+.`,
    };
  } catch (error) {
    return { ok: false, command, prefixArgs, error: "Ne mogu očitati Python verziju: " + String(error?.message || error) };
  }
}

function getTikTokLivePythonCandidateSpecs(runtimeRoot) {
  const specs = [];
  const seen = new Set();
  const push = (command, prefixArgs = []) => {
    const key = `${command}\u0000${prefixArgs.join("\u0000")}`;
    if (!command || seen.has(key)) return;
    seen.add(key);
    specs.push({ command, prefixArgs });
  };
  if (process.platform === "win32") {
    ["-3.13", "-3.12", "-3.11", "-3.10"].forEach((selector) => push("py", [selector]));
    ["python3.13", "python3.12", "python3.11", "python3.10", "python"].forEach((command) => push(command));
  } else {
    ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"].forEach((command) => push(command));
  }
  resolvePythonCandidates(runtimeRoot).forEach((command) => push(command));
  return specs;
}

async function installTikTokLive() {
  const runtimeRoot = resolveTikTokLiveRuntimeRoot();
  const venvDir = path.join(runtimeRoot, ".venv-py310");
  const python = resolveTikTokLivePython(runtimeRoot);
  let runtimeProbe = fs.existsSync(python)
    ? await inspectTikTokLivePython(python, [], runtimeRoot)
    : { ok: false, error: "Python runtime još nije izrađen." };
  if (!runtimeProbe.ok && fs.existsSync(venvDir)) {
    const backupDir = path.join(runtimeRoot, `.venv-incompatible-${Date.now()}`);
    try {
      fs.renameSync(venvDir, backupDir);
    } catch (error) {
      return {
        ok: false,
        runtimeRoot,
        python,
        error: `Postojeći TikTokLive runtime nije kompatibilan i ne mogu ga premjestiti: ${String(error?.message || error)}`,
      };
    }
  }
  if (!runtimeProbe.ok) {
    let lastError = runtimeProbe.error || "";
    let selectedVersion = "";
    for (const spec of getTikTokLivePythonCandidateSpecs(runtimeRoot)) {
      if (path.isAbsolute(spec.command) && !fs.existsSync(spec.command)) continue;
      const probe = await inspectTikTokLivePython(spec.command, spec.prefixArgs, runtimeRoot);
      if (!probe.ok) {
        lastError = probe.error || lastError;
        continue;
      }
      const created = await execFileText(spec.command, [...spec.prefixArgs, "-m", "venv", venvDir], 300000, { cwd: runtimeRoot });
      if (created.ok && fs.existsSync(python)) {
        selectedVersion = probe.version || "";
        lastError = "";
        break;
      }
      lastError = trimPythonInstallOutput(created.stderr || created.stdout || created.error?.message || "");
    }
    if (!fs.existsSync(python)) {
      return {
        ok: false,
        runtimeRoot,
        python,
        error: `Python 3.10+ nije pronađen. Instaliraj Python 3.10, 3.11 ili 3.12 pa ponovi. ${lastError}`.trim(),
      };
    }
    runtimeProbe = await inspectTikTokLivePython(python, [], runtimeRoot);
    if (!runtimeProbe.ok) {
      return { ok: false, runtimeRoot, python, error: runtimeProbe.error || "Novi TikTokLive runtime nije Python 3.10+." };
    }
    runtimeProbe.selectedVersion = selectedVersion;
  }
  const sourceRequirements = path.join(app.getAppPath(), "live-chat-server", "requirements-tiktoklive.txt");
  const requirements = path.join(runtimeRoot, "requirements-tiktoklive.txt");
  try { fs.copyFileSync(sourceRequirements, requirements); } catch (error) {
    return { ok: false, runtimeRoot, python, error: "TikTokLive requirements datoteka nije dostupna: " + String(error?.message || error) };
  }
  const pip = await execFileText(python, ["-m", "pip", "install", "--upgrade", "pip"], 420000, { cwd: runtimeRoot });
  const install = await execFileText(python, ["-m", "pip", "install", "-r", requirements], 900000, { cwd: runtimeRoot });
  if (install.ok) {
    return { ok: true, runtimeRoot, python, pythonVersion: runtimeProbe.version || runtimeProbe.selectedVersion || "", pipUpgrade: pip.ok, source: "github", output: trimPythonInstallOutput(install.stdout || "") };
  }
  // GitHub installs use `git clone` and can fail on macOS when Git is missing,
  // the temporary directory is restricted, or GitHub is temporarily blocked.
  // The PyPI release has the same TikTokLive API and is a safe fallback.
  const fallback = await execFileText(python, ["-m", "pip", "install", "--upgrade", "TikTokLive"], 900000, { cwd: runtimeRoot });
  if (!fallback.ok) {
    return {
      ok: false,
      runtimeRoot,
      python,
      pipUpgrade: pip.ok,
      error: trimPythonInstallOutput(fallback.stderr || fallback.stdout || install.stderr || install.stdout || fallback.error?.message || "TikTokLive instalacija nije uspjela"),
      githubError: trimPythonInstallOutput(install.stderr || install.stdout || ""),
    };
  }
  return {
    ok: true,
    runtimeRoot,
    python,
    pythonVersion: runtimeProbe.version || runtimeProbe.selectedVersion || "",
    pipUpgrade: pip.ok,
    source: "pypi-fallback",
    githubError: trimPythonInstallOutput(install.stderr || install.stdout || ""),
    output: trimPythonInstallOutput(fallback.stdout || ""),
  };
}

async function getTikTokLiveRuntimeStatus() {
  const runtimeRoot = resolveTikTokLiveRuntimeRoot();
  const python = resolveTikTokLivePython(runtimeRoot);
  const running = !!(tkaiTikTokLiveChild && !tkaiTikTokLiveChild.killed);
  if (!fs.existsSync(python)) {
    return {
      ok: true,
      installed: false,
      ready: false,
      running,
      connected: false,
      owner: "",
      errorType: "runtime_missing",
      error: "TikTokLive runtime nije instaliran.",
    };
  }
  const pythonProbe = await inspectTikTokLivePython(python, [], runtimeRoot);
  if (!pythonProbe.ok) {
    return {
      ok: true,
      installed: true,
      ready: false,
      running,
      connected: false,
      owner: tkaiTikTokLiveOwner,
      pythonVersion: pythonProbe.version || "",
      errorType: "python_incompatible",
      error: pythonProbe.error || "TikTokLive Python runtime nije kompatibilan.",
    };
  }
  const importProbe = await execFileText(
    python,
    [
      "-c",
      "import json,importlib.metadata; import TikTokLive; print(json.dumps({'version':importlib.metadata.version('TikTokLive')}))",
    ],
    30000,
    { cwd: runtimeRoot },
  );
  if (!importProbe.ok) {
    return {
      ok: true,
      installed: true,
      ready: false,
      running,
      connected: false,
      owner: tkaiTikTokLiveOwner,
      pythonVersion: pythonProbe.version || "",
      errorType: "runtime_import",
      error: trimPythonInstallOutput(importProbe.stderr || importProbe.stdout || importProbe.error?.message || "TikTokLive import nije uspio"),
    };
  }
  let version = "";
  try {
    const parsed = JSON.parse(String(importProbe.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}");
    version = String(parsed.version || "");
  } catch (_) { }
  return {
    ok: true,
    installed: true,
    ready: true,
    running,
    connected: running && tkaiTikTokLiveConnected,
    owner: tkaiTikTokLiveOwner,
    pythonVersion: pythonProbe.version || "",
    version,
    errorType: "",
    error: "",
  };
}

function stopTikTokLiveBridge() {
  const child = tkaiTikTokLiveChild;
  tkaiTikTokLiveChild = null;
  tkaiTikTokLiveOwner = "";
  tkaiTikTokLiveConnected = false;
  if (!child) return { ok: true, stopped: false };
  try { child.kill("SIGTERM"); } catch (_) { }
  return { ok: true, stopped: true };
}

async function startTikTokLiveBridge(owner, sender) {
  const uniqueId = String(owner || "").trim().replace(/^@+/, "").split(/[/?#]/)[0];
  if (!/^[a-zA-Z0-9._-]{2,80}$/.test(uniqueId)) return { ok: false, error: "TikTok LIVE username nije pronađen u otvorenim tabovima." };
  if (tkaiTikTokLiveChild && !tkaiTikTokLiveChild.killed && tkaiTikTokLiveConnected && tkaiTikTokLiveOwner.toLowerCase() === uniqueId.toLowerCase()) return { ok: true, alreadyRunning: true, owner: uniqueId };
  stopTikTokLiveBridge();
  const runtimeRoot = resolveTikTokLiveRuntimeRoot();
  const python = resolveTikTokLivePython(runtimeRoot);
  const sourceScript = path.join(app.getAppPath(), "live-chat-server", "tiktoklive_bridge.py");
  const script = path.join(runtimeRoot, "tiktoklive_bridge.py");
  if (!fs.existsSync(python)) return { ok: false, errorType: "runtime_missing", error: "TikTokLive nije instaliran. Klikni Instaliraj TikTokLive u AI Live Chat postavkama." };
  try { fs.copyFileSync(sourceScript, script); } catch (error) { return { ok: false, error: "TikTokLive bridge skripta nije dostupna: " + String(error?.message || error) }; }
  const child = spawn(python, [script, uniqueId], { cwd: runtimeRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  tkaiTikTokLiveChild = child;
  tkaiTikTokLiveOwner = uniqueId;
  tkaiTikTokLiveConnected = false;
  let lineBuffer = "";
  let lastStderr = "";
  let startSettled = false;
  let settleStart = null;
  const startReady = new Promise((resolve) => { settleStart = resolve; });
  const startTimeout = setTimeout(() => {
    if (startSettled) return;
    startSettled = true;
    if (tkaiTikTokLiveChild === child) stopTikTokLiveBridge();
    settleStart({ ok: false, error: "TikTokLive spajanje nije potvrđeno unutar 20 sekundi." });
  }, 20000);
  const finishStart = (result) => {
    if (startSettled) return;
    startSettled = true;
    clearTimeout(startTimeout);
    settleStart(result);
  };
  child.stdout.on("data", (chunk) => {
    lineBuffer += String(chunk || "");
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || "";
    lines.forEach((line) => {
      if (!line.trim()) return;
      try {
        const payload = JSON.parse(line);
        if (tkaiTikTokLiveChild !== child) return;
        sender?.send?.("tiktoklive:event", payload);
        if (payload?.kind === "status" && payload?.status === "connected") {
          if (tkaiTikTokLiveChild === child) tkaiTikTokLiveConnected = true;
          finishStart({ ok: true, owner: uniqueId, pid: child.pid, runtimeRoot, python });
        } else if (payload?.kind === "status" && (payload?.status === "disconnected" || payload?.status === "stopped")) {
          if (tkaiTikTokLiveChild === child) tkaiTikTokLiveConnected = false;
        } else if (payload?.kind === "error") {
          if (tkaiTikTokLiveChild === child) tkaiTikTokLiveConnected = false;
          finishStart({
            ok: false,
            error: String(payload.error || "TikTokLive spajanje nije uspjelo").slice(0, 1000),
            errorType: String(payload.errorType || "").slice(0, 120),
            phase: String(payload.phase || "").slice(0, 120),
            trace: String(payload.trace || "").slice(-2000),
          });
        }
      } catch (_) { }
    });
  });
  child.stderr.on("data", (chunk) => {
    const message = String(chunk || "").trim().slice(-500);
    if (message) {
      lastStderr = message;
      sender?.send?.("tiktoklive:log", { level: "warn", message });
    }
  });
  child.once("error", (error) => {
    if (tkaiTikTokLiveChild === child) tkaiTikTokLiveConnected = false;
    finishStart({ ok: false, error: String(error?.message || error || "TikTokLive proces se ne može pokrenuti").slice(0, 500) });
  });
  child.once("exit", (code, signal) => {
    if (tkaiTikTokLiveChild === child) tkaiTikTokLiveConnected = false;
    finishStart({
      ok: false,
      error: lastStderr || `TikTokLive proces je zaustavljen prije spajanja (code ${code ?? "?"}${signal ? `, ${signal}` : ""}).`,
    });
    if (tkaiTikTokLiveChild === child) {
      tkaiTikTokLiveChild = null;
      tkaiTikTokLiveOwner = "";
      sender?.send?.("tiktoklive:event", { kind: "status", status: "stopped", code, signal });
    }
  });
  return startReady;
}

function sanitizeLiveOsSnapshot(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const safeText = (value, max = 500) => String(value || "").slice(0, max);
  const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const events = Array.isArray(source.events) ? source.events.slice(-1000) : [];
  const settings = source.settings && typeof source.settings === "object" ? source.settings : {};
  const safeSettings = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!/^tkai[A-Z0-9_]/.test(key)) continue;
    if (/(key|token|secret|password|license|hash)/i.test(key)) {
      safeSettings[key] = { configured: !!String(value || "").trim() };
      continue;
    }
    if (["boolean", "number", "string"].includes(typeof value)) {
      safeSettings[key] = typeof value === "string" ? value.slice(0, 1000) : value;
    }
  }
  const safeEvents = events.map((event) => ({
    id: safeText(event?.id, 180),
    type: safeText(event?.type || "chat", 24),
    sourceType: safeText(event?.sourceType, 24),
    user: safeText(event?.user, 80),
    userHandle: safeText(event?.userHandle, 80),
    text: safeText(event?.text, 600),
    translatedText: safeText(event?.translatedText, 600),
    translatedLang: safeText(event?.translatedLang, 16),
    ts: safeNumber(event?.ts),
    giftName: safeText(event?.giftName, 120),
    quantity: safeNumber(event?.quantity),
    unitCoins: safeNumber(event?.unitCoins),
    coins: safeNumber(event?.coins),
  }));
  const safeUsers = Array.isArray(source.users)
    ? source.users.slice(0, 500).map((user) => ({
      user: safeText(user?.user, 120),
      total: safeNumber(user?.total),
      chat: safeNumber(user?.chat),
      gifts: safeNumber(user?.gifts),
      joins: safeNumber(user?.joins),
      likes: safeNumber(user?.likes),
      shares: safeNumber(user?.shares),
      lastTs: safeNumber(user?.lastTs),
      firstSeen: safeNumber(user?.firstSeen),
      appearances: safeNumber(user?.appearances),
      coins: safeNumber(user?.coins),
      repeatMax: safeNumber(user?.repeatMax),
      giftTypes: Array.isArray(user?.giftTypes)
        ? user.giftTypes.slice(0, 8).map((entry) => (Array.isArray(entry)
          ? [safeText(entry[0], 120), safeNumber(entry[1])]
          : null)).filter(Boolean)
        : [],
      lastMessage: safeText(user?.lastMessage, 240),
    }))
    : [];
  const safeGifts = Array.isArray(source.gifts)
    ? source.gifts.slice(0, 500).map((gift) => ({
      giftName: safeText(gift?.giftName || gift?.name, 120),
      name: safeText(gift?.name || gift?.giftName, 120),
      events: safeNumber(gift?.events),
      quantity: safeNumber(gift?.quantity),
      coins: safeNumber(gift?.coins),
      users: safeNumber(gift?.users),
    }))
    : [];
  const safeSupporters = Array.isArray(source.supporters)
    ? source.supporters.slice(0, 200).map((row) => ({
      user: safeText(row?.user, 120),
      coins: safeNumber(row?.coins),
      events: safeNumber(row?.events),
    }))
    : [];
  const safeGiftLedger = Array.isArray(source.giftLedger)
    ? source.giftLedger.slice(0, 1000).map((row) => ({
      id: safeText(row?.id, 180),
      ts: safeNumber(row?.ts),
      user: safeText(row?.user, 120),
      giftName: safeText(row?.giftName || row?.name, 120),
      quantity: safeNumber(row?.quantity),
      coins: safeNumber(row?.coins),
      text: safeText(row?.text, 240),
    }))
    : [];
  const safeAlerts = Array.isArray(source.alerts)
    ? source.alerts.slice(0, 200).map((row) => ({
      id: safeText(row?.id, 180),
      type: safeText(row?.type, 60),
      severity: safeText(row?.severity, 20),
      text: safeText(row?.text || row?.title, 300),
      score: safeNumber(row?.score || row?.riskScore),
      riskScore: safeNumber(row?.riskScore || row?.score),
      ts: safeNumber(row?.ts),
      accountId: safeText(row?.accountId, 120),
      user: safeText(row?.user, 120),
      userHandle: safeText(row?.userHandle, 120),
      status: safeText(row?.status, 40),
      coins: safeNumber(row?.coins),
    }))
    : [];
  const analytics = source.analytics && typeof source.analytics === "object" ? source.analytics : {};
  return {
    version: 1,
    publishedAt: Date.now(),
    connection: {
      state: safeText(source.connection?.state || "idle", 24),
      tabId: safeNumber(source.connection?.tabId) || null,
      liveUrl: safeText(source.connection?.liveUrl, 1000),
      owner: safeText(source.connection?.owner, 80),
      startedAt: safeNumber(source.connection?.startedAt) || null,
      lastEventAt: safeNumber(source.connection?.lastEventAt) || null,
      error: safeText(source.connection?.error, 300),
    },
    session: {
      id: safeText(source.session?.id, 120),
      title: safeText(source.session?.title, 180),
      startedAt: safeNumber(source.session?.startedAt) || null,
      endedAt: safeNumber(source.session?.endedAt) || null,
      messageCount: safeNumber(source.session?.messageCount),
      peakViewers: safeNumber(source.session?.peakViewers),
      currentViewers: safeNumber(source.session?.currentViewers),
      totalCoins: safeNumber(source.session?.totalCoins),
      uniqueUsers: safeNumber(source.session?.uniqueUsers),
    },
    events: safeEvents,
    users: safeUsers,
    gifts: safeGifts,
    giftLedger: safeGiftLedger,
    supporters: safeSupporters,
    alerts: safeAlerts,
    analytics: {
      totalCoins: safeNumber(analytics.totalCoins),
      peakViewers: safeNumber(analytics.peakViewers),
      currentViewers: safeNumber(analytics.currentViewers),
      uniqueUsers: safeNumber(analytics.uniqueUsers),
      messageRatePerMinute: safeNumber(analytics.messageRatePerMinute),
      topGifters: Array.isArray(analytics.topGifters) ? analytics.topGifters.slice(0, 20) : [],
      spikes: Array.isArray(analytics.spikes) ? analytics.spikes.slice(0, 20) : [],
      recommendations: Array.isArray(analytics.recommendations) ? analytics.recommendations.slice(0, 20) : [],
    },
    insights: Array.isArray(source.insights) ? source.insights.slice(0, 100) : [],
    scans: Array.isArray(source.scans) ? source.scans.slice(0, 100) : [],
    music: source.music && typeof source.music === "object" ? source.music : {},
    sentiment: source.sentiment && typeof source.sentiment === "object" ? source.sentiment : {},
    settings: safeSettings,
  };
}

function publishLiveOsSnapshot(snapshot) {
  liveOsSnapshot = sanitizeLiveOsSnapshot(snapshot);
  for (const id of Array.from(liveOsSubscribers)) {
    const contents = require("electron").webContents.fromId(id);
    if (!contents || contents.isDestroyed()) {
      liveOsSubscribers.delete(id);
      continue;
    }
    contents.send("liveos:snapshot", liveOsSnapshot);
  }
  return liveOsSnapshot;
}

function safeTkaiNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function safeTkaiText(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001F]/g, "").trim().slice(0, max);
}

function getTkaiBotControlConfig() {
  const envLocal = typeof _readEnvLocalMap === "function" ? _readEnvLocalMap() : {};
  const secretSettings = getSecretStore()?.getNamespace("settings") || {};
  const token = safeTkaiText(
    process.env.TKAI_BOT_CONTROL_TOKEN
    || envLocal.TKAI_BOT_CONTROL_TOKEN
    || secretSettings.tkaiBotControlToken
    || "",
    500,
  );
  const host = safeTkaiText(
    process.env.TKAI_BOT_CONTROL_HOST
    || envLocal.TKAI_BOT_CONTROL_HOST
    || "127.0.0.1",
    120,
  ) || "127.0.0.1";
  const port = Math.max(
    1,
    Math.min(
      65535,
      safeTkaiNumber(
        process.env.TKAI_BOT_CONTROL_PORT
        || envLocal.TKAI_BOT_CONTROL_PORT
        || 8793,
        8793,
      ) || 8793,
    ),
  );
  const enabledRaw = safeTkaiText(
    process.env.TKAI_BOT_CONTROL_ENABLED
    || envLocal.TKAI_BOT_CONTROL_ENABLED
    || (token ? "true" : "false"),
    20,
  ).toLowerCase();
  return {
    enabled: enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "yes" || enabledRaw === "on",
    host,
    port,
    token,
  };
}

function parseTkaiBotAuthToken(request) {
  const authHeader = safeTkaiText(request?.headers?.authorization, 600);
  if (/^Bearer /i.test(authHeader)) return authHeader.replace(/^Bearer\s+/i, "").trim();
  return safeTkaiText(request?.headers?.["x-auth-token"], 600);
}

function isTkaiBotAuthorized(request, config) {
  if (!config?.token || config.token.length < 24) return false;
  const supplied = parseTkaiBotAuthToken(request);
  if (!supplied) return false;
  const actual = Buffer.from(config.token);
  const candidate = Buffer.from(supplied);
  return actual.length === candidate.length && crypto.timingSafeEqual(actual, candidate);
}

function sendTkaiJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function normalizeTkaiTopGifters(sourceRows, limit = 10) {
  const rows = Array.isArray(sourceRows) ? sourceRows : [];
  return rows
    .map((row, index) => {
      const coins = Math.max(
        safeTkaiNumber(row?.coins, 0),
        safeTkaiNumber(row?.totalCoins, 0),
        safeTkaiNumber(row?.giftCoins, 0),
      );
      const gifts = Math.max(
        safeTkaiNumber(row?.gifts, 0),
        safeTkaiNumber(row?.giftCount, 0),
        safeTkaiNumber(row?.totalGiftEvents, 0),
      );
      const messages = Math.max(
        safeTkaiNumber(row?.messages, 0),
        safeTkaiNumber(row?.chatCount, 0),
      );
      const user = safeTkaiText(
        row?.user
        || row?.username
        || row?.userHandle
        || row?.profileHandle
        || row?.displayName
        || `user-${index + 1}`,
        120,
      );
      return {
        rank: index + 1,
        user,
        userHandle: safeTkaiText(row?.userHandle || row?.profileHandle || row?.username || user, 120),
        displayName: safeTkaiText(row?.displayName || row?.user || row?.username || user, 120),
        coins,
        gifts,
        messages,
        status: safeTkaiText(row?.status || row?.watchStatus || "", 40),
        riskScore: safeTkaiNumber(row?.riskScore, 0),
      };
    })
    .filter((row) => row.coins > 0 || row.gifts > 0 || row.messages > 0)
    .sort((a, b) => b.coins - a.coins || b.gifts - a.gifts || b.messages - a.messages || a.user.localeCompare(b.user))
    .slice(0, Math.max(1, Math.min(50, safeTkaiNumber(limit, 10))));
}

function buildTkaiControlSummary(limit = 10) {
  const snapshot = liveOsSnapshot && typeof liveOsSnapshot === "object" ? liveOsSnapshot : null;
  const connection = snapshot?.connection && typeof snapshot.connection === "object"
    ? { ...snapshot.connection }
    : { state: "idle", liveUrl: "", owner: "", startedAt: null, lastEventAt: null, error: "" };
  const sessionInfo = snapshot?.session && typeof snapshot.session === "object"
    ? { ...snapshot.session }
    : { id: "", title: "", startedAt: null, endedAt: null, messageCount: 0, peakViewers: 0, currentViewers: 0, totalCoins: 0, uniqueUsers: 0 };
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const latestEvent = events.length ? events[events.length - 1] : null;
  const users = Array.isArray(snapshot?.users) ? snapshot.users : [];
  const topGifters = normalizeTkaiTopGifters(
    Array.isArray(snapshot?.supporters) && snapshot.supporters.length ? snapshot.supporters : users,
    limit,
  );
  const dbStatus = db?.getTikTokLiveStorageStatus ? db.getTikTokLiveStorageStatus() : { ok: false, error: "Database not available" };
  return {
    ok: true,
    snapshotAvailable: !!snapshot,
    connection: {
      state: safeTkaiText(connection.state || "idle", 24) || "idle",
      liveUrl: safeTkaiText(connection.liveUrl, 1000),
      owner: safeTkaiText(connection.owner, 120),
      startedAt: safeTkaiNumber(connection.startedAt, 0) || null,
      lastEventAt: safeTkaiNumber(connection.lastEventAt, 0) || null,
      error: safeTkaiText(connection.error, 200),
    },
    session: {
      id: safeTkaiText(sessionInfo.id, 120),
      title: safeTkaiText(sessionInfo.title, 180),
      startedAt: safeTkaiNumber(sessionInfo.startedAt, 0) || null,
      endedAt: safeTkaiNumber(sessionInfo.endedAt, 0) || null,
      messageCount: safeTkaiNumber(sessionInfo.messageCount, 0),
      peakViewers: safeTkaiNumber(sessionInfo.peakViewers, 0),
      currentViewers: safeTkaiNumber(sessionInfo.currentViewers, 0),
      totalCoins: safeTkaiNumber(sessionInfo.totalCoins, 0),
      uniqueUsers: safeTkaiNumber(sessionInfo.uniqueUsers, 0),
    },
    latestEvent: latestEvent ? {
      type: safeTkaiText(latestEvent.type, 24),
      user: safeTkaiText(latestEvent.user || latestEvent.userHandle, 120),
      text: safeTkaiText(latestEvent.text || latestEvent.giftName, 200),
      coins: safeTkaiNumber(latestEvent.coins, 0),
      ts: safeTkaiNumber(latestEvent.ts, 0),
    } : null,
    topGifters,
    database: dbStatus,
  };
}

function getTkaiDatabaseSummary(limit = 10) {
  const storage = db?.getTikTokLiveStorageStatus ? db.getTikTokLiveStorageStatus() : { ok: false, error: "Database not available" };
  const archive = db?.getTikTokLiveData ? db.getTikTokLiveData() : { ok: false, error: "Database not available" };
  const users = archive?.users && typeof archive.users === "object" ? Object.values(archive.users) : [];
  const topStoredGifters = normalizeTkaiTopGifters(users, limit);
  const sessions = Array.isArray(archive?.sessions) ? archive.sessions.slice(-Math.max(1, Math.min(10, limit))) : [];
  const stats = Array.isArray(archive?.stats) ? archive.stats.slice(-Math.max(1, Math.min(10, limit))) : [];
  return {
    ok: true,
    storage,
    topStoredGifters,
    latestSessions: sessions.map((row) => ({
      id: safeTkaiText(row?.id, 120),
      label: safeTkaiText(row?.label || row?.name || row?.session?.title || "", 160),
      savedAt: safeTkaiNumber(row?.savedAt || row?.updatedAt || row?.session?.endedAt || row?.session?.startedAt, 0),
      messageCount: safeTkaiNumber(row?.messageCount || row?.session?.messageCount, 0),
      peakViewers: safeTkaiNumber(row?.peakViewers || row?.session?.peakViewers, 0),
      totalCoins: safeTkaiNumber(row?.totalCoins || row?.session?.totalCoins, 0),
    })),
    latestStats: stats.map((row) => ({
      id: safeTkaiText(row?.id, 120),
      label: safeTkaiText(row?.label || "", 160),
      savedAt: safeTkaiNumber(new Date(row?.savedAt || 0).getTime() || row?.savedAt, 0),
      totalCoins: safeTkaiNumber(row?.totalCoins || row?.coins, 0),
      peakViewers: safeTkaiNumber(row?.peakViewers, 0),
      uniqueUsers: safeTkaiNumber(row?.uniqueUsers, 0),
    })),
  };
}

function dispatchTkaiBotCommand(action) {
  const allowed = new Set(["start-scan", "stop-scan", "open-ai-live-chat", "songrec-now"]);
  const normalized = safeTkaiText(action, 60).toLowerCase();
  if (!allowed.has(normalized)) return { ok: false, error: "Unsupported action." };
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: "Main window is unavailable." };
  }
  mainWindow.webContents.send("liveos:command", { action: normalized });
  return { ok: true, action: normalized, dispatchedAt: Date.now() };
}

function readTkaiRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > 256 * 1024) {
        reject(new Error("Payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function handleTkaiBotControlRequest(request, response) {
  const config = getTkaiBotControlConfig();
  let requestUrl;
  try {
    requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  } catch (_) {
    sendTkaiJson(response, 400, { ok: false, error: "Invalid URL" });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendTkaiJson(response, 200, {
      ok: true,
      service: "etherx-tkai-bot-control",
      enabled: config.enabled,
      snapshotAvailable: !!liveOsSnapshot,
      now: new Date().toISOString(),
    });
    return;
  }

  if (!config.enabled) {
    sendTkaiJson(response, 503, { ok: false, error: "TKAI bot control is disabled." });
    return;
  }

  if (!isTkaiBotAuthorized(request, config)) {
    sendTkaiJson(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/tkai/status") {
    const limit = Math.max(1, Math.min(50, safeTkaiNumber(requestUrl.searchParams.get("limit"), 10)));
    sendTkaiJson(response, 200, buildTkaiControlSummary(limit));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/tkai/session") {
    sendTkaiJson(response, 200, { ok: true, snapshot: liveOsSnapshot, summary: buildTkaiControlSummary(10) });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/tkai/gifters") {
    const limit = Math.max(1, Math.min(50, safeTkaiNumber(requestUrl.searchParams.get("limit"), 10)));
    sendTkaiJson(response, 200, {
      ok: true,
      gifters: buildTkaiControlSummary(limit).topGifters,
      snapshotAvailable: !!liveOsSnapshot,
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/tkai/database") {
    const limit = Math.max(1, Math.min(50, safeTkaiNumber(requestUrl.searchParams.get("limit"), 10)));
    sendTkaiJson(response, 200, getTkaiDatabaseSummary(limit));
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/tkai/command") {
    readTkaiRequestBody(request).then((rawBody) => {
      let payload = {};
      try {
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch (_) {
        sendTkaiJson(response, 400, { ok: false, error: "Invalid JSON body" });
        return;
      }
      const result = dispatchTkaiBotCommand(payload?.action);
      sendTkaiJson(response, result.ok ? 200 : 400, result);
    }).catch((error) => {
      sendTkaiJson(response, 400, { ok: false, error: String(error?.message || error || "Request failed") });
    });
    return;
  }

  sendTkaiJson(response, 404, { ok: false, error: "Not found" });
}

function startTkaiBotControlServer() {
  const config = getTkaiBotControlConfig();
  if (!config.enabled) return { ok: false, skipped: true, reason: "disabled" };
  if (!config.token || config.token.length < 24) {
    return { ok: false, skipped: true, reason: "missing_token" };
  }
  if (tkaiBotControlServer) return { ok: true, alreadyRunning: true, host: config.host, port: config.port };
  tkaiBotControlServer = http.createServer(handleTkaiBotControlRequest);
  tkaiBotControlServer.on("error", (error) => {
    console.warn("[TKAI Bot] control server error:", error.message);
  });
  tkaiBotControlServer.listen(config.port, config.host, () => {
    console.log(`[TKAI Bot] control server listening on http://${config.host}:${config.port}`);
  });
  return { ok: true, host: config.host, port: config.port };
}

function stopTkaiBotControlServer() {
  if (!tkaiBotControlServer) return;
  try {
    tkaiBotControlServer.close();
  } catch (_) { }
  tkaiBotControlServer = null;
}

function resolveTkaiTelegramNotifyPath() {
  return path.join(app.getPath("userData"), "tkai-telegram", "tkai-bot-notify.json");
}

function getTkaiTelegramConfig() {
  const secrets = getSecretStore()?.getNamespace("settings") || {};
  return {
    token: safeTkaiText(process.env.TELEGRAM_BOT_TOKEN || secrets.tkaiTelegramBotToken || "", 1000),
    chatId: safeTkaiText(process.env.TELEGRAM_CHAT_ID || secrets.tkaiTelegramChatId || "", 120),
    archiveToken: safeTkaiText(
      process.env.TKAI_ARCHIVE_TOKEN
      || process.env.LIVE_ARCHIVE_API_TOKEN
      || process.env.LIVE_AUTH_TOKEN
      || secrets.tkaiLiveServerToken
      || "",
      1000,
    ),
    archiveUrl: safeTkaiText(
      process.env.TKAI_ARCHIVE_API_URL || "https://live.kriptoentuzijasti.io",
      1000,
    ).replace(/\/+$/, ""),
    autoStart: secrets.tkaiTelegramAutoStart === true,
  };
}

function defaultTkaiTelegramNotifyState(chatId = "") {
  return {
    enabled: false,
    startupEnabled: true,
    alertEnabled: true,
    chatId: safeTkaiText(chatId, 120),
    viewerThreshold: 0,
    giftEnabled: true,
    giftCoinsMin: 500,
    whaleCoins: 10000,
    spikeThreshold: 150,
    watchUsers: [],
    last: {
      sessionId: "",
      scanStartKey: "",
      alertKey: "",
      viewerThresholdHitAt: 0,
      giftKey: "",
      whaleKey: "",
      watchUserKey: "",
      spikeKey: "",
    },
  };
}

function readTkaiTelegramNotifyState() {
  const config = getTkaiTelegramConfig();
  const fallback = defaultTkaiTelegramNotifyState(config.chatId);
  try {
    const filePath = resolveTkaiTelegramNotifyPath();
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8") || "{}");
    return {
      ...fallback,
      ...parsed,
      enabled: parsed?.enabled === true,
      startupEnabled: parsed?.startupEnabled !== false,
      alertEnabled: parsed?.alertEnabled !== false,
      giftEnabled: parsed?.giftEnabled === true,
      chatId: safeTkaiText(parsed?.chatId || config.chatId, 120),
      viewerThreshold: Math.max(0, safeTkaiNumber(parsed?.viewerThreshold, 0)),
      giftCoinsMin: Math.max(1, safeTkaiNumber(parsed?.giftCoinsMin, 500) || 500),
      whaleCoins: Math.max(0, safeTkaiNumber(parsed?.whaleCoins, 10000)),
      spikeThreshold: Math.max(0, safeTkaiNumber(parsed?.spikeThreshold, 150)),
      watchUsers: Array.isArray(parsed?.watchUsers)
        ? parsed.watchUsers.map((value) => safeTkaiText(value, 80).replace(/^@+/, "").toLowerCase()).filter(Boolean).slice(0, 50)
        : [],
      last: { ...fallback.last, ...(parsed?.last || {}) },
    };
  } catch (error) {
    tkaiTelegramBotLastError = "Notify config: " + safeTkaiText(error?.message || error, 300);
    return fallback;
  }
}

function writeTkaiTelegramNotifyState(values = {}) {
  const current = readTkaiTelegramNotifyState();
  const next = {
    ...current,
    enabled: values.enabled === true,
    startupEnabled: values.startupEnabled !== false,
    alertEnabled: values.alertEnabled !== false,
    chatId: safeTkaiText(values.chatId || current.chatId || getTkaiTelegramConfig().chatId, 120),
    viewerThreshold: Math.max(0, safeTkaiNumber(values.viewerThreshold, 0)),
    giftEnabled: values.giftEnabled === true,
    giftCoinsMin: Math.max(1, safeTkaiNumber(values.giftCoinsMin, 500) || 500),
    whaleCoins: Math.max(0, safeTkaiNumber(values.whaleCoins, 0)),
    spikeThreshold: Math.max(0, safeTkaiNumber(values.spikeThreshold, 0)),
    watchUsers: String(Array.isArray(values.watchUsers) ? values.watchUsers.join(",") : values.watchUsers || "")
      .split(/[\s,;]+/)
      .map((value) => safeTkaiText(value, 80).replace(/^@+/, "").toLowerCase())
      .filter(Boolean)
      .slice(0, 50),
    last: {
      ...(current.last || defaultTkaiTelegramNotifyState().last),
      ...((values.last && typeof values.last === "object") ? values.last : {}),
    },
  };
  const filePath = resolveTkaiTelegramNotifyPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return next;
}

function appendTkaiTelegramBotLog(value) {
  const line = safeTkaiText(value, 600);
  if (!line) return;
  tkaiTelegramBotLogs.push({ ts: Date.now(), text: line });
  tkaiTelegramBotLogs = tkaiTelegramBotLogs.slice(-30);
}

function getTkaiTelegramBotStatus() {
  const config = getTkaiTelegramConfig();
  return {
    running: !!(tkaiTelegramBotChild && !tkaiTelegramBotChild.killed),
    pid: tkaiTelegramBotChild?.pid || null,
    startedAt: tkaiTelegramBotStartedAt || null,
    lastExit: tkaiTelegramBotLastExit,
    lastError: safeTkaiText(tkaiTelegramBotLastError, 400),
    tokenConfigured: config.token.length >= 20,
    chatIdConfigured: !!config.chatId,
    chatIdMasked: config.chatId ? `${config.chatId.slice(0, 4)}…${config.chatId.slice(-3)}` : "",
    archiveConfigured: config.archiveToken.length >= 32,
    autoStart: config.autoStart,
    logs: tkaiTelegramBotLogs.slice(-8),
  };
}

function ensureTkaiBotControlToken() {
  const existing = getTkaiBotControlConfig().token;
  if (existing.length >= 24) return existing;
  const token = crypto.randomBytes(32).toString("hex");
  getSecretStore()?.mergeNamespace("settings", { tkaiBotControlToken: token });
  return token;
}

function stopTkaiTelegramBot() {
  const child = tkaiTelegramBotChild;
  tkaiTelegramBotChild = null;
  if (!child) return { ok: true, stopped: false, status: getTkaiTelegramBotStatus() };
  try { child.kill("SIGTERM"); } catch (_) { }
  return { ok: true, stopped: true, status: getTkaiTelegramBotStatus() };
}

function startTkaiTelegramBot(options = {}) {
  if (tkaiTelegramBotChild && !tkaiTelegramBotChild.killed) {
    return { ok: true, alreadyRunning: true, status: getTkaiTelegramBotStatus() };
  }
  const config = getTkaiTelegramConfig();
  if (config.token.length < 20) return { ok: false, error: "Telegram Bot Token nije postavljen." };
  if (!config.chatId) return { ok: false, error: "Telegram Chat ID nije postavljen." };
  const controlToken = ensureTkaiBotControlToken();
  if (!tkaiBotControlServer) startTkaiBotControlServer();
  const sourceScript = path.join(app.getAppPath(), "scripts", "tkai-telegram-bot.js");
  if (!fs.existsSync(sourceScript)) return { ok: false, error: "Telegram bot skripta nije pronađena." };
  const runtimeRoot = path.join(app.getPath("userData"), "tkai-telegram");
  const runtimeScript = path.join(runtimeRoot, "tkai-telegram-bot.js");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.copyFileSync(sourceScript, runtimeScript);
  writeTkaiTelegramNotifyState({ ...readTkaiTelegramNotifyState(), chatId: config.chatId });
  tkaiTelegramBotLastError = "";
  tkaiTelegramBotLastExit = null;
  const control = getTkaiBotControlConfig();
  const child = spawn(process.execPath, [runtimeScript], {
    cwd: runtimeRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      TELEGRAM_BOT_TOKEN: config.token,
      TELEGRAM_CHAT_ID: config.chatId,
      TKAI_BOT_CONTROL_URL: `http://${control.host}:${control.port}`,
      TKAI_BOT_CONTROL_TOKEN: controlToken,
      TKAI_ARCHIVE_API_URL: config.archiveUrl,
      TKAI_ARCHIVE_TOKEN: config.archiveToken,
      TKAI_NOTIFY_STORE_PATH: resolveTkaiTelegramNotifyPath(),
      TKAI_SKIP_STARTUP_MESSAGE: options.skipStartupMessage === true ? "1" : "",
    },
  });
  tkaiTelegramBotChild = child;
  tkaiTelegramBotStartedAt = Date.now();
  child.stdout.on("data", (chunk) => String(chunk || "").split(/\r?\n/).forEach(appendTkaiTelegramBotLog));
  child.stderr.on("data", (chunk) => {
    const text = String(chunk || "");
    text.split(/\r?\n/).forEach(appendTkaiTelegramBotLog);
    if (text.trim()) tkaiTelegramBotLastError = safeTkaiText(text.trim(), 400);
  });
  child.once("error", (error) => {
    tkaiTelegramBotLastError = safeTkaiText(error?.message || error, 400);
  });
  child.once("exit", (code, signal) => {
    if (tkaiTelegramBotChild === child) tkaiTelegramBotChild = null;
    tkaiTelegramBotLastExit = { code, signal: signal || "", at: Date.now() };
  });
  return { ok: true, status: getTkaiTelegramBotStatus() };
}

async function testTkaiTelegramBot() {
  const config = getTkaiTelegramConfig();
  if (config.token.length < 20 || !config.chatId) return { ok: false, error: "Spremi Bot Token i Chat ID prije testa." };
  const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: config.chatId, text: "EtherX TikTok Chat AI: Telegram test je uspješan ✅" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) return { ok: false, error: safeTkaiText(data?.description || `Telegram HTTP ${response.status}`, 400) };
  return { ok: true, chatIdMasked: getTkaiTelegramBotStatus().chatIdMasked };
}

async function notifyTkaiScanStarted(payload = {}) {
  const config = getTkaiTelegramConfig();
  if (config.token.length < 20 || !config.chatId) {
    return { ok: false, skipped: true, error: "Telegram Bot Token ili Chat ID nije postavljen." };
  }
  const owner = safeTkaiText(payload.owner, 80).replace(/^@+/, "");
  const sessionId = safeTkaiText(payload.sessionId, 160) || `live-${Date.now()}`;
  const liveUrl = safeTkaiText(payload.liveUrl, 1000);
  const startedAt = Math.max(0, safeTkaiNumber(payload.startedAt, Date.now())) || Date.now();
  const scanStartKey = `${sessionId}:${owner.toLowerCase()}`;
  const notify = readTkaiTelegramNotifyState();
  if (safeTkaiText(notify?.last?.scanStartKey, 300) === scanStartKey) {
    writeTkaiTelegramNotifyState({ ...notify, enabled: true, chatId: config.chatId });
    if (!tkaiTelegramBotChild || tkaiTelegramBotChild.killed) {
      startTkaiTelegramBot({ skipStartupMessage: true });
    }
    return { ok: true, duplicate: true, sessionId };
  }

  const lines = [
    "🔴 TikTok LIVE skeniranje je pokrenuto",
    `Kreator: ${owner ? `@${owner}` : "-"}`,
    `Vrijeme: ${new Date(startedAt).toLocaleString("hr-HR")}`,
    `Session ID: ${sessionId}`,
    "Telegram praćenje je aktivno; šalju se alarmi uključeni u postavkama.",
  ];
  if (/^https:\/\/(?:www\.|m\.)?tiktok\.com\//i.test(liveUrl)) lines.push(`LIVE: ${liveUrl}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: lines.join("\n").slice(0, 3900),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      return { ok: false, error: safeTkaiText(data?.description || `Telegram HTTP ${response.status}`, 400) };
    }
    writeTkaiTelegramNotifyState({
      ...notify,
      enabled: true,
      chatId: config.chatId,
      last: {
        ...(notify.last || {}),
        sessionId,
        scanStartKey,
        alertKey: "",
        viewerThresholdHitAt: 0,
        giftKey: "",
        whaleKey: "",
        watchUserKey: "",
        spikeKey: "",
      },
    });
    if (!tkaiTelegramBotChild || tkaiTelegramBotChild.killed) {
      startTkaiTelegramBot({ skipStartupMessage: true });
    }
    return { ok: true, sessionId, tracking: true };
  } catch (error) {
    return { ok: false, error: safeTkaiText(error?.name === "AbortError" ? "Telegram timeout" : (error?.message || error), 400) };
  } finally {
    clearTimeout(timer);
  }
}

async function getTkaiOperationsStatus() {
  let publicHealth = { ok: false, status: 0, error: "" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch("https://live.kriptoentuzijasti.io/health", { signal: controller.signal });
    clearTimeout(timer);
    const data = await response.json().catch(() => ({}));
    publicHealth = { ok: response.ok && data?.ok !== false, status: response.status, service: safeTkaiText(data?.service || "", 100) };
  } catch (error) {
    publicHealth = { ok: false, status: 0, error: safeTkaiText(error?.message || error, 200) };
  }
  const appRoot = app.getAppPath();
  const scriptDefinitions = [
    ["Telegram bot", "scripts/tkai-telegram-bot.js", "Upravljivo iz ovog panela"],
    ["TikTokLive bridge", "live-chat-server/tiktoklive_bridge.py", "Pokreće Skeniranje ON"],
    ["LIVE server", "live-chat-server/server.js", "Produkcijski PM2 servis"],
    ["Server smoke test", "live-chat-server/smoke-test.js", "Provjera WSS protokola"],
    ["Gift detector", "live-chat-server/gift-detector.js", "Whale i gift detekcija"],
    ["Detector import", "scripts/tiktok-detect-import.js", "Uvoz detektiranih događaja"],
    ["PM2 bootstrap", "scripts/pm2-bootstrap.sh", "Lokalni EtherX servis"],
  ];
  return {
    ok: true,
    publicHealth,
    browserSnapshot: buildTkaiControlSummary(10),
    controlServer: { running: !!tkaiBotControlServer, ...getTkaiBotControlConfig(), token: undefined },
    telegram: getTkaiTelegramBotStatus(),
    notify: readTkaiTelegramNotifyState(),
    scripts: scriptDefinitions.map(([name, relativePath, purpose]) => ({
      name,
      relativePath,
      purpose,
      available: fs.existsSync(path.join(appRoot, relativePath)),
    })),
    notifyPath: resolveTkaiTelegramNotifyPath(),
  };
}

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
  "translateAiApiKey",
  "tkaiGuardianApiKey",
  "tkaiLiveServerToken",
  "tkaiTelegramBotToken",
  "tkaiTelegramChatId",
  "tkaiBotControlToken",
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
    // Settings can be saved by the renderer before its async SQLite/secret
    // hydration completes. Never treat omitted keys as a user request to erase
    // credentials: merge only the keys explicitly supplied by this save.
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

function _parseRendererStorageJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? parsed : fallback;
    }
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch (_) {
    return fallback;
  }
}

function _normalizeHistoryTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return Date.now();
  // SQLite stores Unix seconds while the renderer stores JavaScript milliseconds.
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

function _getRendererStorageSnapshot() {
  const store = _loadRendererStorage();
  let repaired = false;

  // renderer-storage.json is the renderer's fast, synchronous cache. SQLite is
  // the durable fallback. Restore both settings and history before the renderer
  // starts so the UI never initializes from empty/default values after restart.
  if (db) {
    try {
      const sqliteSettings = splitSensitiveSettings(db.getSettings() || {}).publicSettings;
      const localSettings = _parseRendererStorageJson(store.ex_cfg, {});
      const mergedSettings = { ...sqliteSettings, ...localSettings };
      const serializedSettings = JSON.stringify(mergedSettings);
      if (store.ex_cfg !== serializedSettings) {
        store.ex_cfg = serializedSettings;
        repaired = true;
      }
    } catch (error) {
      console.warn("Renderer settings recovery failed:", error.message);
    }

    try {
      const sqliteHistory = db.getHistory({ limit: 500 }) || [];
      const localHistory = _parseRendererStorageJson(store.ex_hist, []);
      const historyByUrl = new Map();

      sqliteHistory.forEach((entry) => {
        const url = String(entry?.url || "").trim();
        if (!url) return;
        historyByUrl.set(url, {
          url,
          title: String(entry?.title || url),
          favicon: String(entry?.favicon || ""),
          ts: _normalizeHistoryTimestamp(entry?.last_visited ?? entry?.created_at),
          visit_count: Math.max(1, Number(entry?.visit_count) || 1),
        });
      });

      // The synchronous renderer cache may contain a newer entry than SQLite
      // when the app was closed immediately after navigation.
      localHistory.forEach((entry) => {
        const url = String(entry?.url || "").trim();
        if (!url) return;
        const sqliteEntry = historyByUrl.get(url);
        historyByUrl.set(url, {
          ...(sqliteEntry || {}),
          ...entry,
          url,
          title: String(entry?.title || sqliteEntry?.title || url),
          favicon: String(entry?.favicon || sqliteEntry?.favicon || ""),
          ts: _normalizeHistoryTimestamp(
            entry?.ts ?? entry?.last_visited ?? sqliteEntry?.ts,
          ),
          visit_count: Math.max(
            1,
            Number(entry?.visit_count ?? sqliteEntry?.visit_count) || 1,
          ),
        });
      });

      const mergedHistory = Array.from(historyByUrl.values())
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 500);
      const serializedHistory = JSON.stringify(mergedHistory);
      if (store.ex_hist !== serializedHistory) {
        store.ex_hist = serializedHistory;
        repaired = true;
      }
    } catch (error) {
      console.warn("Renderer history recovery failed:", error.message);
    }
  }

  if (repaired) _persistRendererStorage();
  return { ...store };
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

function _ensureRuntimeEnvLocals(force = false) {
  if (_envBootstrapDone && !force) return { skipped: true, written: 0, errors: [] };
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

  const errors = [];
  let written = 0;
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
      written += 1;
    } catch (error) {
      // Do not crash startup, but return the path/error when this was an
      // explicit Help wizard repair action.
      errors.push(`${target}: ${String(error?.message || error)}`);
    }
  });
  return { skipped: false, written, errors };
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

  const writeErrors = [];
  let written = 0;
  targets.forEach((target) => {
    try {
      const cur = _readEnvLocalFile(target);
      const next = { ...cur, ...patch };
      _writeEnvLocalFile(target, next);
      written += 1;
    } catch (error) {
      writeErrors.push(`${target}: ${String(error?.message || error)}`);
    }
  });

  return {
    ..._getRuntimeEnvStatus(),
    ok: written > 0,
    written,
    error: writeErrors.length ? writeErrors.join("; ") : "",
  };
}

function _getRuntimeEnvStatus() {
  _ensureRuntimeEnvLocals();
  const targets = _getRuntimeEnvTargetPaths();
  const files = targets.map((target) => {
    const map = _readEnvLocalFile(target);
    const apiKey = String(map.ETHERX_TKAI_LICENSE_API_KEY || "").trim();
    const hasKey = !!apiKey;
    const hasUrl = !!String(map.ETHERX_TKAI_LICENSE_API_URL || "").trim();
    const keyLen = String(map.ETHERX_TKAI_LICENSE_API_KEY || "").trim().length;
    return {
      path: target,
      exists: fs.existsSync(target),
      hasKey,
      hasUrl,
      keyLen,
      // The setup screen only needs confirmation that the stored key survived.
      // Never send the full API secret back to the renderer.
      keyPreview: hasKey ? `${"•".repeat(Math.min(12, Math.max(4, keyLen - 4)))}${apiKey.slice(-4)}` : "",
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
  const persistentRuntimeRoot = resolvePersistentPythonRuntimeRoot();
  if (!roots.includes(persistentRuntimeRoot)) roots.unshift(persistentRuntimeRoot);
  if (preferredRoot && fs.existsSync(preferredRoot)) {
    if (!roots.includes(preferredRoot)) roots.push(preferredRoot);
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

function preferExistingVenvPythonCandidates(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  const marker = `${path.sep}.venv${path.sep}`;
  const venvExisting = list.filter((candidate) => {
    if (!candidate || !path.isAbsolute(candidate)) return false;
    if (!String(candidate).includes(marker)) return false;
    return fs.existsSync(candidate);
  });
  return venvExisting.length ? venvExisting : list;
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

function readTextFileTail(filePath, maxLen = 6000) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return "";
    const text = fs.readFileSync(filePath, "utf8");
    return trimPythonInstallOutput(text, maxLen);
  } catch (_) {
    return "";
  }
}

function parsePm2ProcessSnapshot(rawJson, processName) {
  try {
    const list = JSON.parse(String(rawJson || "[]"));
    if (!Array.isArray(list)) return null;
    const name = String(processName || "").trim();
    if (!name) return null;
    const normalizedName = name.toLowerCase();
    const item = list.find((entry) => {
      const entryName = String(entry?.name || "").trim();
      const entryNameLower = entryName.toLowerCase();
      const pm2Env = entry?.pm2_env || {};
      const execPath = String(pm2Env.pm_exec_path || entry?.pm_exec_path || "").toLowerCase();
      const cwd = String(pm2Env.pm_cwd || entry?.pm_cwd || "").toLowerCase();
      return entryName === name || entryNameLower === normalizedName || entryNameLower.includes(normalizedName) || execPath.includes(normalizedName) || cwd.includes(normalizedName);
    });
    if (!item) return null;

    const pm2Env = item.pm2_env || {};
    const execMode = String(pm2Env.exec_mode || "");
    const state = String(pm2Env.status || item.status || "");
    const nodeArgs = Array.isArray(pm2Env.node_args) ? pm2Env.node_args : [];
    const args = Array.isArray(pm2Env.args)
      ? pm2Env.args
      : (pm2Env.args ? [String(pm2Env.args)] : []);

    return {
      name: String(item.name || name),
      pid: Number(item.pid || 0) || 0,
      state,
      online: state === "online",
      restarts: Number(pm2Env.restart_time || 0) || 0,
      unstableRestarts: Number(pm2Env.unstable_restarts || 0) || 0,
      execPath: String(pm2Env.pm_exec_path || ""),
      cwd: String(pm2Env.pm_cwd || ""),
      interpreter: String(pm2Env.exec_interpreter || ""),
      execMode,
      nodeArgs,
      args,
      outLogPath: String(pm2Env.pm_out_log_path || ""),
      errLogPath: String(pm2Env.pm_err_log_path || ""),
      createdAt: Number(pm2Env.created_at || 0) || 0,
      pmId: Number(item.pm_id || -1),
    };
  } catch (_) {
    return null;
  }
}

function findMacAppBundleUpward(startPath) {
  try {
    let current = path.resolve(startPath || "");
    if (fs.existsSync(current) && fs.statSync(current).isFile()) {
      current = path.dirname(current);
    }
    while (current && current !== path.dirname(current)) {
      if (current.toLowerCase().endsWith(".app")) return current;
      current = path.dirname(current);
    }
  } catch (_) { }
  return "";
}

function findFirstNestedMacAppBundle(rootDir) {
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory() && entry.name.endsWith(".app")) return fullPath;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = findFirstNestedMacAppBundle(path.join(rootDir, entry.name));
      if (nested) return nested;
    }
  } catch (_) { }
  return "";
}

function findFirstMacOsExecutable(appBundle) {
  try {
    const macOsDir = path.join(appBundle, "Contents", "MacOS");
    const entries = fs.readdirSync(macOsDir, { withFileTypes: true });
    const executable = entries.find((entry) => entry.isFile() || entry.isSymbolicLink());
    return executable ? path.join(macOsDir, executable.name) : "";
  } catch (_) {
    return "";
  }
}

function resolvePm2ElectronLaunchPath() {
  const candidates = [];
  const pushIf = (value) => {
    if (!value || candidates.includes(value)) return;
    candidates.push(value);
  };

  pushIf(process.execPath);
  if (process.platform === "darwin") {
    const currentBundle = findMacAppBundleUpward(process.execPath);
    if (currentBundle) {
      pushIf(findFirstMacOsExecutable(currentBundle));
    }
  }

  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return candidate;
      if (process.platform === "darwin" && stat.isDirectory()) {
        const appBundle = candidate.toLowerCase().endsWith(".app")
          ? candidate
          : findFirstNestedMacAppBundle(candidate);
        if (appBundle) {
          const executable = findFirstMacOsExecutable(appBundle);
          if (executable) return executable;
        }
      }
    } catch (_) { }
  }

  return process.execPath || "";
}

async function getPm2ProcessSnapshot(projectRoot, processName = "etherx-browser") {
  const jlist = await execFileText("npx", ["pm2", "jlist"], 120000, { cwd: projectRoot });
  if (!jlist.ok) {
    return {
      ok: false,
      error: trimPythonInstallOutput(jlist.stderr || jlist.stdout || jlist.error?.message || "pm2 jlist failed"),
      snapshot: null,
    };
  }

  const snapshot = parsePm2ProcessSnapshot(jlist.stdout || "[]", processName);
  return { ok: !!snapshot, error: snapshot ? "" : "PM2 process nije pronađen u jlist output-u.", snapshot };
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
    const fallbackRoot = path.join(os.homedir(), ".etherx-browser-runtime");
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

// Python packages and downloaded models must never live beside a versioned app
// bundle or checkout. This directory is kept by Electron's stable userData
// location across application updates.
function resolvePersistentPythonRuntimeRoot() {
  const runtimeRoot = path.join(app.getPath("userData"), "python-runtime");
  try { fs.mkdirSync(runtimeRoot, { recursive: true }); } catch (_) { }
  return runtimeRoot;
}

function migrateLegacyPythonVenv(targetVenvDir) {
  if (fs.existsSync(targetVenvDir)) return false;
  for (const root of resolveProjectRoots()) {
    const legacyVenv = path.join(root, ".venv");
    if (!fs.existsSync(legacyVenv) || path.resolve(legacyVenv) === path.resolve(targetVenvDir)) continue;
    try {
      fs.cpSync(legacyVenv, targetVenvDir, { recursive: true, errorOnExist: false });
      return fs.existsSync(targetVenvDir);
    } catch (_) { }
  }
  return false;
}

async function installPythonBridgeDeps() {
  try {
    const reqLookup = resolveRequirementsPath();
    const fallbackPackages = ["torch", "transformers", "accelerate", "gliclass"];
    const projectRoot = resolvePersistentPythonRuntimeRoot();

    // Keep a durable copy so packaged and development updates share the same
    // environment instead of rebuilding it in a new app folder.
    const requirementsPath = path.join(projectRoot, "requirements.txt");
    try {
      const sourceRequirements = reqLookup.path || path.join(app.getAppPath(), "requirements.txt");
      if (sourceRequirements && fs.existsSync(sourceRequirements)) {
        fs.writeFileSync(requirementsPath, fs.readFileSync(sourceRequirements));
      } else if (!fs.existsSync(requirementsPath)) {
        fs.writeFileSync(requirementsPath, "torch\ntransformers\naccelerate\ngliclass\n");
      }
    } catch (_) { }

    const venvDir = path.join(projectRoot, ".venv");
    const venvPython =
      process.platform === "win32"
        ? path.join(venvDir, "Scripts", "python.exe")
        : path.join(venvDir, "bin", "python");
    const migratedLegacyVenv = migrateLegacyPythonVenv(venvDir);

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
        migratedLegacyVenv,
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
      migratedLegacyVenv,
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

async function getPythonBridgeStatus() {
  const projectRoot = resolvePersistentPythonRuntimeRoot();
  const venvDir = path.join(projectRoot, ".venv");
  const python = process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
  if (!fs.existsSync(python)) {
    return { ok: true, installed: false, working: false, projectRoot, python, missing: ["venv"] };
  }
  const probe = await execFileText(
    python,
    ["-c", "import importlib.util,json; mods=['torch','transformers','accelerate','gliclass']; missing=[m for m in mods if importlib.util.find_spec(m) is None]; print(json.dumps({'missing':missing}))"],
    30000,
    { cwd: projectRoot },
  );
  let missing = [];
  try {
    missing = JSON.parse(String(probe.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}").missing || [];
  } catch (_) {
    missing = probe.ok ? [] : ["probe"];
  }
  return {
    ok: true,
    installed: probe.ok && missing.length === 0,
    working: probe.ok && missing.length === 0,
    projectRoot,
    python,
    missing,
    error: probe.ok ? "" : trimPythonInstallOutput(probe.stderr || probe.stdout || probe.error?.message || "Python AI provjera nije uspjela"),
  };
}

function resolveWhisperLiveRuntimeRoot() {
  const runtimeRoot = path.join(app.getPath("userData"), "whisperlive-runtime");
  try {
    fs.mkdirSync(runtimeRoot, { recursive: true });
  } catch (_) { }
  return runtimeRoot;
}

function probeLocalTcpPort(port, host = "127.0.0.1", timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) { }
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function getWhisperLiveStatus() {
  const runtimeRoot = resolveWhisperLiveRuntimeRoot();
  const venvDir = path.join(runtimeRoot, ".venv-whisperlive");
  const python = process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
  const pipProbePromise = fs.existsSync(python)
    ? execFileText(python, ["-c", "import whisper_live"], 30000, { cwd: runtimeRoot })
    : Promise.resolve({ ok: false, stdout: "", stderr: "" });
  const dockerProbePromise = execFileText(
    "docker",
    ["inspect", "-f", "{{.State.Running}}", "etherx-whisperlive"],
    15000,
    { cwd: runtimeRoot },
  );
  const [running, pipProbe, dockerProbe] = await Promise.all([
    probeLocalTcpPort(9090),
    pipProbePromise,
    dockerProbePromise,
  ]);
  const pipInstalled = !!pipProbe.ok;
  const dockerInstalled = !!dockerProbe.ok;
  const dockerRunning = dockerInstalled && String(dockerProbe.stdout || "").trim().toLowerCase() === "true";
  const mode = dockerInstalled ? "docker-cpu" : (pipInstalled ? "pip" : "");
  return {
    ok: true,
    installed: pipInstalled || dockerInstalled || running,
    working: running,
    running,
    starting: !running && dockerRunning,
    mode,
    pipInstalled,
    dockerInstalled,
    dockerRunning,
    endpoint: "ws://localhost:9090",
    runtimeRoot,
    python,
  };
}

async function ensureWhisperLiveRunning() {
  const before = await getWhisperLiveStatus();
  if (before.working) return { ...before, started: false, alreadyRunning: true };
  if (!before.installed) return { ...before, ok: false, error: "WhisperLive nije instaliran." };

  let startResult = null;
  if (before.dockerInstalled) {
    startResult = await execFileText(
      "docker",
      ["start", "etherx-whisperlive"],
      60000,
      { cwd: before.runtimeRoot },
    );
  } else if (before.pipInstalled) {
    startResult = await startWhisperLivePipServer();
  }
  if (!startResult?.ok) {
    return {
      ...before,
      ok: false,
      error: trimPythonInstallOutput(startResult?.stderr || startResult?.stdout || startResult?.error?.message || startResult?.error || "WhisperLive se ne može pokrenuti"),
    };
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const after = await getWhisperLiveStatus();
  return { ...after, ok: true, started: true, starting: !after.working };
}

function resolveWhisperLiveModelCacheRoot() {
  const cacheRoot = path.join(resolveWhisperLiveRuntimeRoot(), "model-cache");
  try { fs.mkdirSync(cacheRoot, { recursive: true }); } catch (_) { }
  return cacheRoot;
}

function refreshWhisperLiveModelCacheIndex() {
  const cacheRoot = resolveWhisperLiveModelCacheRoot();
  const entries = [];
  // WhisperLive backends do not all honour cache_path consistently. Index the
  // managed cache and the known legacy Hugging Face/Whisper locations so an
  // already downloaded local model is never reported as "0 B".
  const home = require("os").homedir();
  const candidateRoots = [
    cacheRoot,
    path.join(cacheRoot, "huggingface"),
    path.join(home, ".cache", "whisper-live"),
    path.join(home, ".cache", "whisper"),
    path.join(home, ".cache", "huggingface", "hub"),
  ];
  if (process.env.HF_HOME) candidateRoots.push(process.env.HF_HOME);
  const existingRoots = [...new Set(candidateRoots.map(value => path.resolve(value)))].filter(dir => fs.existsSync(dir));
  const uniqueRoots = existingRoots
    .sort((a, b) => a.length - b.length)
    .filter((dir, index, all) => !all.slice(0, index).some(parent => dir.startsWith(parent + path.sep)));
  const isWhisperModelFile = (fullPath, root) => root === cacheRoot || /(?:whisper|faster-whisper|distil-whisper|systran)/i.test(fullPath);
  const walk = (dir, root) => {
    let rows = [];
    try { rows = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    rows.forEach((row) => {
      const fullPath = path.join(dir, row.name);
      if (row.isDirectory()) return walk(fullPath, root);
      if (!row.isFile()) return;
      if (!isWhisperModelFile(fullPath, root)) return;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size <= 0) return;
        const relativePath = path.relative(root, fullPath);
        entries.push({
          cacheKey: `whisperlive:${Buffer.from(root).toString("base64url")}:${relativePath.replace(/\\/g, '/')}`,
          modelName: path.basename(fullPath),
          filePath: fullPath,
          fileSize: stat.size,
          modifiedAt: Math.floor(stat.mtimeMs),
          status: 'ready'
        });
      } catch (_) { }
    });
  };
  uniqueRoots.forEach(root => walk(root, root));
  const result = db ? db.replaceLocalModelCache('whisperlive', entries) : { ok: false, error: 'Database not available' };
  return { ...result, cacheRoot, entries };
}

function getWhisperLiveInstallPlan(requestedMode = "auto") {
  const platform = process.platform;
  const mode = String(requestedMode || "auto").trim().toLowerCase();
  const resolvedMode = mode === "auto"
    ? (platform === "darwin" ? "docker-cpu" : "docker-cpu")
    : mode;
  const modelCacheRoot = resolveWhisperLiveModelCacheRoot();
  const modelCacheMount = `${modelCacheRoot}:/root/.cache/whisper-live`;
  const huggingFaceMount = `${modelCacheRoot}:/root/.cache/huggingface`;
  const dockerCacheArgs = ["-e", "HF_HOME=/root/.cache/huggingface", "-v", modelCacheMount, "-v", huggingFaceMount];
  const dockerCpuArgs = ["run", "-d", "--name", "etherx-whisperlive", ...dockerCacheArgs, "-p", "9090:9090", "ghcr.io/collabora/whisperlive-cpu:latest"];
  const dockerGpuArgs = ["run", "-d", "--name", "etherx-whisperlive", "--gpus", "all", ...dockerCacheArgs, "-p", "9090:9090", "ghcr.io/collabora/whisperlive-gpu:latest"];
  const pipCommand = platform === "win32"
    ? "py -m venv .venv-whisperlive && .venv-whisperlive\\Scripts\\python.exe -m pip install -U pip whisper-live && .venv-whisperlive\\Scripts\\python.exe etherx_whisperlive_server.py"
    : "python3 -m venv .venv-whisperlive && .venv-whisperlive/bin/python -m pip install -U pip whisper-live && .venv-whisperlive/bin/python etherx_whisperlive_server.py";

  return {
    platform,
    mode: resolvedMode,
    endpoint: "ws://localhost:9090",
    dockerCpuCommand: "docker " + dockerCpuArgs.join(" "),
    dockerGpuCommand: "docker " + dockerGpuArgs.join(" "),
    pipCommand,
    recommendation: platform === "darwin"
      ? "macOS: koristi Docker CPU ili pip. Docker GPU nije podrzan na Macu."
      : platform === "win32"
        ? "Windows: Docker CPU je najjednostavniji. Docker GPU koristi samo uz NVIDIA driver i Docker GPU runtime; pip koristi lokalni Python venv."
        : platform === "linux"
          ? "Linux: Docker CPU, Docker GPU ili pip su dostupni. GPU koristi samo uz NVIDIA runtime."
          : "Nepoznat OS: koristi Docker CPU ili pip ako su dostupni na sustavu.",
  };
}

function writeWhisperLiveServerScript(runtimeRoot) {
  const serverPath = path.join(runtimeRoot, "etherx_whisperlive_server.py");
  const content = [
    "import os",
    "os.environ.setdefault('KMP_DUPLICATE_LIB_OK', 'TRUE')",
    "os.environ.setdefault('OMP_NUM_THREADS', '1')",
    "os.environ.setdefault('HF_HOME', os.path.join(os.environ.get('ETHERX_WHISPER_MODEL_CACHE', os.path.expanduser('~/.cache/whisper-live/')), 'huggingface'))",
    "from whisper_live.server import TranscriptionServer",
    "server = TranscriptionServer()",
    "server.run(",
    "    '0.0.0.0',",
    "    port=9090,",
    "    backend='faster_whisper',",
    "    max_clients=4,",
    "    max_connection_time=600,",
    "    cache_path=os.environ.get('ETHERX_WHISPER_MODEL_CACHE', os.path.expanduser('~/.cache/whisper-live/')),",
    ")",
    "",
  ].join("\n");
  fs.writeFileSync(serverPath, content, "utf8");
  return serverPath;
}

async function startWhisperLivePipServer() {
  const runtimeRoot = resolveWhisperLiveRuntimeRoot();
  const serverPath = writeWhisperLiveServerScript(runtimeRoot);
  const venvDir = path.join(runtimeRoot, ".venv-whisperlive");
  const venvPython = process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");

  if (!fs.existsSync(venvPython)) {
    const candidates = resolvePythonCandidates(runtimeRoot);
    let lastError = "";
    for (const py of candidates) {
      if (path.isAbsolute(py) && !fs.existsSync(py)) continue;
      const mk = await execFileText(py, ["-m", "venv", venvDir], 300000, { cwd: runtimeRoot });
      if (mk.ok) {
        lastError = "";
        break;
      }
      lastError = trimPythonInstallOutput(mk.stderr || mk.stdout || mk.error?.message || "");
      if (mk.error?.code === "ENOENT") continue;
    }
    if (!fs.existsSync(venvPython)) {
      return { ok: false, error: lastError || "Ne mogu kreirati .venv-whisperlive.", runtimeRoot };
    }
  }

  const installedCheck = await execFileText(venvPython, ["-c", "import whisper_live"], 30000, { cwd: runtimeRoot });
  let pipUpgrade = { ok: true, stdout: "", stderr: "" };
  let pipInstall = { ok: true, stdout: "", stderr: "" };
  if (!installedCheck.ok) {
    pipUpgrade = await execFileText(venvPython, ["-m", "pip", "install", "-U", "pip"], 420000, { cwd: runtimeRoot });
    pipInstall = await execFileText(venvPython, ["-m", "pip", "install", "-U", "whisper-live"], 900000, { cwd: runtimeRoot });
  }
  if (!pipInstall.ok) {
    return {
      ok: false,
      error: trimPythonInstallOutput(pipInstall.stderr || pipInstall.stdout || pipInstall.error?.message || "pip install whisper-live nije uspio"),
      runtimeRoot,
      python: venvPython,
      pipUpgrade: !!pipUpgrade.ok,
    };
  }

  const out = fs.openSync(path.join(runtimeRoot, "whisperlive-out.log"), "a");
  const err = fs.openSync(path.join(runtimeRoot, "whisperlive-error.log"), "a");
  const child = spawn(venvPython, [serverPath], {
    cwd: runtimeRoot,
    detached: true,
    stdio: ["ignore", out, err],
    env: {
      ...getAugmentedEnv(),
      KMP_DUPLICATE_LIB_OK: "TRUE",
      OMP_NUM_THREADS: "1",
      ETHERX_WHISPER_MODEL_CACHE: resolveWhisperLiveModelCacheRoot(),
      HF_HOME: path.join(resolveWhisperLiveModelCacheRoot(), "huggingface"),
    },
    windowsHide: true,
  });
  child.unref();
  try { fs.closeSync(out); } catch (_) { }
  try { fs.closeSync(err); } catch (_) { }
  return {
    ok: true,
    mode: "pip",
    endpoint: "ws://localhost:9090",
    runtimeRoot,
    python: venvPython,
    pid: child.pid,
    alreadyInstalled: !!installedCheck.ok,
    pipUpgrade: !!pipUpgrade.ok,
    stdout: trimPythonInstallOutput(pipInstall.stdout),
    stderr: trimPythonInstallOutput(pipInstall.stderr),
  };
}

async function installWhisperLive(requestedMode = "auto") {
  const plan = getWhisperLiveInstallPlan(requestedMode);
  if (plan.mode === "detect") return { ok: true, ...plan };
  if (plan.mode === "docker-gpu" && process.platform === "darwin") {
    return {
      ok: false,
      platform: plan.platform,
      mode: plan.mode,
      endpoint: plan.endpoint,
      error: "macOS ne podrzava WhisperLive Docker GPU nacin. Koristi Docker CPU ili pip.",
      dockerCpuCommand: plan.dockerCpuCommand,
      pipCommand: plan.pipCommand,
    };
  }
  if (plan.mode === "pip") return startWhisperLivePipServer();

  if (plan.mode === "docker-cpu" || plan.mode === "docker-gpu") {
    const cacheRoot = resolveWhisperLiveModelCacheRoot();
    const modelCacheMount = `${cacheRoot}:/root/.cache/whisper-live`;
    const huggingFaceMount = `${cacheRoot}:/root/.cache/huggingface`;
    const dockerCacheArgs = ["-e", "HF_HOME=/root/.cache/huggingface", "-v", modelCacheMount, "-v", huggingFaceMount];
    const args = plan.mode === "docker-gpu"
      ? ["run", "-d", "--name", "etherx-whisperlive", "--gpus", "all", ...dockerCacheArgs, "-p", "9090:9090", "ghcr.io/collabora/whisperlive-gpu:latest"]
      : ["run", "-d", "--name", "etherx-whisperlive", ...dockerCacheArgs, "-p", "9090:9090", "ghcr.io/collabora/whisperlive-cpu:latest"];
    const runtimeRoot = resolveWhisperLiveRuntimeRoot();
    const existing = await execFileText("docker", ["start", "etherx-whisperlive"], 60000, { cwd: runtimeRoot });
    if (existing.ok) {
      const inspect = await execFileText("docker", ["inspect", "-f", "{{range .Mounts}}{{.Source}}:{{.Destination}}|{{end}}", "etherx-whisperlive"], 30000, { cwd: runtimeRoot });
      const mounts = String(inspect.stdout || '');
      if (mounts.includes(cacheRoot + ':/root/.cache/whisper-live') && mounts.includes(cacheRoot + ':/root/.cache/huggingface')) {
        return { ok: true, platform: plan.platform, mode: plan.mode, endpoint: plan.endpoint, container: "etherx-whisperlive", alreadyInstalled: true, stdout: trimPythonInstallOutput(existing.stdout) };
      }
    }
    // An invalid/partially-created old container must not block a clean install.
    await execFileText("docker", ["rm", "-f", "etherx-whisperlive"], 60000, { cwd: runtimeRoot });
    const run = await execFileText("docker", args, 600000, { cwd: runtimeRoot });
    return {
      ok: !!run.ok,
      platform: plan.platform,
      mode: plan.mode,
      endpoint: plan.endpoint,
      command: "docker " + args.join(" "),
      container: "etherx-whisperlive",
      stdout: trimPythonInstallOutput(run.stdout),
      stderr: trimPythonInstallOutput(run.stderr),
      error: run.ok ? "" : trimPythonInstallOutput(run.stderr || run.stdout || run.error?.message || "Docker pokretanje nije uspjelo"),
    };
  }

  return { ok: false, platform: plan.platform, mode: plan.mode, endpoint: plan.endpoint, error: "Nepoznat WhisperLive install mode: " + plan.mode };
}

async function runOneClickLocalSetup() {
  try {
    const reqLookup = resolveRequirementsPath();
    const projectRoot = resolvePythonProjectRoot(reqLookup);
    const ecosystemPath = path.join(projectRoot, "ecosystem.config.cjs");

    // Dynamically generate ecosystem.config.cjs for packaged production application
    if (app.isPackaged) {
      const outLogPath = path.join(projectRoot, "pm2-out.log").replace(/\\/g, "/");
      const errLogPath = path.join(projectRoot, "pm2-error.log").replace(/\\/g, "/");
      const resolvedExecPath = resolvePm2ElectronLaunchPath();
      if (!resolvedExecPath || !fs.existsSync(resolvedExecPath) || !fs.statSync(resolvedExecPath).isFile()) {
        throw new Error(`PM2 launch target nije izvršna datoteka: ${resolvedExecPath || "(empty)"}`);
      }
      const execPath = String(resolvedExecPath).replace(/\\/g, "/");
      let pm2Script = execPath;
      let pm2Args = ["--no-sandbox"];
      let pm2Interpreter = "none";

      if (process.platform === "darwin") {
        const launcherPath = path.join(projectRoot, "launch-etherx.sh");
        const appBundlePath = findMacAppBundleUpward(execPath);
        const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
        const launcherContent = [
          "#!/bin/bash",
          "set -e",
          `APP_BUNDLE=${shellQuote(appBundlePath || "")}`,
          `EXEC_PATH=${shellQuote(execPath)}`,
          `while kill -0 ${process.pid} 2>/dev/null; do`,
          "  sleep 2",
          "done",
          'if [[ -n "$APP_BUNDLE" && -d "$APP_BUNDLE" ]]; then',
          '  exec /usr/bin/open -W -n "$APP_BUNDLE" --args --no-sandbox',
          "fi",
          'if [[ ! -x "$EXEC_PATH" ]]; then',
          '  echo "EtherX PM2 launch target nije executable: $EXEC_PATH" >&2',
          "  exit 126",
          "fi",
          'exec "$EXEC_PATH" --no-sandbox',
          "",
        ].join("\n");
        fs.writeFileSync(launcherPath, launcherContent, { encoding: "utf8", mode: 0o700 });
        fs.chmodSync(launcherPath, 0o700);
        pm2Script = launcherPath.replace(/\\/g, "/");
        pm2Args = [];
        pm2Interpreter = "none";
      }

      const configContent = `module.exports = {
  apps: [
    {
      name: "etherx-browser",
      script: ${JSON.stringify(pm2Script)},
      args: ${JSON.stringify(pm2Args)},
      interpreter: ${JSON.stringify(pm2Interpreter)},
      cwd: ${JSON.stringify(projectRoot.replace(/\\/g, "/"))},
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      out_file: ${JSON.stringify(outLogPath)},
      error_file: ${JSON.stringify(errLogPath)},
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
    const pm2Update = await execFileText("npx", ["pm2", "update"], 180000, { cwd: projectRoot });

    const pm2Run = await execFileText(
      "npx",
      ["pm2", "start", ecosystemPath, "--update-env", "--force"],
      300000,
      { cwd: projectRoot },
    );
    const pm2Step = "start";

    const pm2Save = await execFileText("npx", ["pm2", "save"], 120000, { cwd: projectRoot });
    const pm2Status = await execFileText("npx", ["pm2", "status", "etherx-browser"], 120000, {
      cwd: projectRoot,
    });
    const pm2SnapshotResult = await getPm2ProcessSnapshot(projectRoot, "etherx-browser");
    const pm2Snapshot = pm2SnapshotResult.snapshot;
    const pm2IsOnline = !!pm2Snapshot?.online;
    const statusText = trimPythonInstallOutput(pm2Status.stdout || pm2Status.stderr || "");
    const pm2StatusLooksOnline = /etherx-browser/i.test(statusText) && /\bonline\b/i.test(statusText);
    const pm2ErrLogTail = readTextFileTail(pm2Snapshot?.errLogPath, 6000);

    let pm2Error = "";
    if (!pm2Run.ok) {
      pm2Error = trimPythonInstallOutput(pm2Run.stderr || pm2Run.stdout || pm2Run.error?.message || "PM2 start failed");
    } else if (!pm2Save.ok) {
      pm2Error = trimPythonInstallOutput(pm2Save.stderr || pm2Save.stdout || "PM2 save failed");
    } else if (!pm2SnapshotResult.ok && !pm2StatusLooksOnline) {
      pm2Error = trimPythonInstallOutput(pm2SnapshotResult.error || "PM2 snapshot nije dostupan.");
    } else if (!pm2IsOnline && !pm2StatusLooksOnline) {
      const stateLabel = String(pm2Snapshot?.state || "unknown");
      const execPathLabel = String(pm2Snapshot?.execPath || "");
      pm2Error = trimPythonInstallOutput(
        `PM2 proces nije online (state=${stateLabel}).${execPathLabel ? ` Exec path: ${execPathLabel}` : ""}`,
      );
    }
    if (pm2Error && pm2ErrLogTail) {
      pm2Error = trimPythonInstallOutput(`${pm2Error}\n\nPM2 error log:\n${pm2ErrLogTail}`);
    }

    result.pm2 = {
      ok: !!pm2Run.ok && !!pm2Save.ok && (pm2IsOnline || pm2StatusLooksOnline),
      step: pm2Step,
      saveOk: !!pm2Save.ok,
      status: statusText,
      state: String(pm2Snapshot?.state || ""),
      execPath: String(pm2Snapshot?.execPath || ""),
      cwd: String(pm2Snapshot?.cwd || ""),
      args: Array.isArray(pm2Snapshot?.args) ? pm2Snapshot.args : [],
      nodeArgs: Array.isArray(pm2Snapshot?.nodeArgs) ? pm2Snapshot.nodeArgs : [],
      restarts: Number(pm2Snapshot?.restarts || 0) || 0,
      unstableRestarts: Number(pm2Snapshot?.unstableRestarts || 0) || 0,
      stdout: trimPythonInstallOutput(pm2Run.stdout || ""),
      stderr: trimPythonInstallOutput(
        (pm2Run.stderr || "") +
        (pm2Update?.stderr ? "\n" + pm2Update.stderr : "") +
        (pm2ErrLogTail ? "\nPM2 error log:\n" + pm2ErrLogTail : ""),
      ),
      error: pm2Error,
    };

    result.ok = !!result.python?.ok && !!result.pm2?.ok;
    return result;
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function logPythonBridgeDebug(scope, message, extra = undefined) {
  try {
    if (!ETHERX_DEBUG_LOGS) return;
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
        const raw = String(stdout || "").trim();
        if (error) {
          try {
            resolve({
              ok: true,
              data: JSON.parse(raw || "{}"),
              processError: error,
              stderr: String(stderr || ""),
            });
          } catch (_) {
            resolve({ ok: false, error, stdout: raw, stderr: String(stderr || "") });
          }
          return;
        }
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

function formatPythonBridgeError(run, fallbackMessage) {
  const ignoredWarningRe =
    /(NotOpenSSLWarning|urllib3 v2 only supports OpenSSL|warnings\.warn\(|`?torch_dtype`?\s+is deprecated|Use `?dtype`?\s+instead)/i;
  const stderr = String(run?.stderr || "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !ignoredWarningRe.test(line))
    .join("\n")
    .trim();
  const stdout = String(run?.stdout || "").trim();
  return String(stderr || stdout || run?.error?.message || fallbackMessage).trim();
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
    session.fromPartition("persist:tiktok-watcher").setUserAgent(CHROME_CLEAN_UA);
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
      const blocker = adBlocker.blocker;
      if (blocker) {
        blocker.enableBlockingInSession(etherxSess);
        // Electron allows only one onBeforeRequest listener per session.
        // Replace the blocker's direct listener with an explicit TikTok
        // bypass, then delegate every other request back to the blocker.
        etherxSess.webRequest.onBeforeRequest(
          { urls: ["<all_urls>"] },
          (details, callback) => {
            let pageUrl =
              details.firstPartyURL ||
              details.referrer ||
              details.initiator ||
              "";
            if (!pageUrl && Number(details.webContentsId || 0)) {
              try {
                pageUrl = webContents.fromId(Number(details.webContentsId))?.getURL?.() || "";
              } catch (_) { }
            }
            if (adBlocker.shouldBypassRequest({ ...details, pageUrl })) {
              callback({});
              return;
            }
            blocker.onBeforeRequest(details, callback);
          },
        );
      }
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

  // The window and its IPC bridge must not wait for extension disk I/O or two
  // extension-session loads. Those can continue while the browser is visible.
  if (!_ipcSetupDone) {
    setupIPC();
    _ipcSetupDone = true;
  }
  startTkaiBotControlServer();
  if (getTkaiTelegramConfig().autoStart) {
    const started = startTkaiTelegramBot();
    if (!started?.ok) console.warn("[TKAI Telegram] auto-start skipped:", started?.error || "unknown error");
  }
  createWindow();

  // Yield once so Chromium can paint the shell before optional extension work
  // performs file copies or session initialisation on the main process.
  await new Promise((resolve) => setTimeout(resolve, 250));

  // Auto-load bundled LiveOS Plugin Dashboard extension
  try {
    const bundledLiveOsPluginPath = path.join(__dirname, "liveos-plugin-extension");
    let liveOsPluginPath = bundledLiveOsPluginPath;
    if (app.isPackaged || bundledLiveOsPluginPath.includes("app.asar")) {
      const unpackedRoot = path.join(app.getPath("userData"), "bundled-extensions");
      const unpackedLiveOsPluginPath = path.join(unpackedRoot, "liveos-plugin-extension");
      if (fs.existsSync(path.join(bundledLiveOsPluginPath, "manifest.json"))) {
        fs.mkdirSync(unpackedRoot, { recursive: true });
        fs.cpSync(bundledLiveOsPluginPath, unpackedLiveOsPluginPath, { recursive: true, force: true });
        liveOsPluginPath = unpackedLiveOsPluginPath;
      }
    }
    if (fs.existsSync(path.join(liveOsPluginPath, "manifest.json"))) {
      const extensionSessions = [
        ["main", session.defaultSession],
        ["webview", session.fromPartition("persist:etherx")],
      ];
      await Promise.all(extensionSessions.map(async ([scope, targetSession]) => {
        try {
          const ext = await targetSession.loadExtension(liveOsPluginPath, { allowFileAccess: true });
          console.log(`[Ext] LiveOS Plugin loaded (${scope}):`, ext.name, ext.id, liveOsPluginPath);
        } catch (error) {
          console.warn(`[Ext] LiveOS Plugin load skipped (${scope}):`, error.message);
        }
      }));
    }
  } catch (e) {
    if (process.env.ETHERX_DEBUG_LOGS === "1" || process.env.ETHERX_DEBUG === "1") {
      console.warn("[Ext] LiveOS Plugin setup error:", e.message);
    }
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
  stopTkaiTelegramBot();
  stopTkaiBotControlServer();
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
    // The background colour already prevents a white flash. Showing immediately
    // makes the browser feel responsive while the renderer completes startup.
    show: true,
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
    if (level >= 3 || ((process.env.ETHERX_DEBUG_LOGS === "1" || process.env.ETHERX_DEBUG === "1") && level >= 2)) {
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
  // Google also checks Sec-Fetch-Site / Origin headers — force override for google domains
  const GOOGLE_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
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
        "tiktokcdn-us.com",
        "tiktokcdn-eu.com",
        "tiktokv.com",
        "tiktokv.eu",
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

  function isTikTokFamilyHost(rawUrl) {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      return [
        "tiktok.com",
        "tiktokv.com",
        "tiktokv.eu",
        "tiktokcdn.com",
        "tiktokcdn-us.com",
        "tiktokcdn-eu.com",
        "tiktokvapp.eu",
        "tiktok-row.net",
        "byteoversea.com",
        "byteintlapi.com",
        "ttwstatic.com",
        "ttlstatic.com",
      ].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    } catch (_) {
      return false;
    }
  }

  function stripReportOnlyCsp(headers) {
    delete headers["content-security-policy-report-only"];
    delete headers["Content-Security-Policy-Report-Only"];
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
        // For Google domains and TikTok force clean modern Chrome UA
        const url = details.url || "";
        const isTikTok = /tiktok\.com/i.test(url);
        const isYouTube = /youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com/i.test(url);
        if (
          /google\.com|googleapis\.com|accounts\.google|openrouter\.ai|clerk\.openrouter\.ai|accounts\.openrouter\.ai|\.clerk\.accounts\.dev|\.clerk\.com|auth0\.com|okta\.com|huggingface\.co|openai\.com|anthropic\.com|github\.com\/login|tiktok\.com|youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com/i.test(
            url,
          )
        ) {
          ua = GOOGLE_UA;
          // Remove X-Frame-Options bypass headers that trigger security checks
          delete headers["X-Requested-With"];
          if (isGoogleAuthRequest(url) && String(details.resourceType || "").toLowerCase() === "mainframe") {
            headers["Sec-CH-UA"] =
              '"Google Chrome";v="142", "Chromium";v="142", "Not_A Brand";v="24"';
            headers["Sec-CH-UA-Mobile"] = "?0";
            headers["Sec-CH-UA-Platform"] = '"Windows"';
            headers["Sec-Fetch-Site"] = "none";
            headers["Sec-Fetch-Mode"] = "navigate";
            headers["Sec-Fetch-Dest"] = "document";
            headers["Sec-Fetch-User"] = "?1";
          }
          if (isTikTok || isYouTube) {
            headers["Sec-CH-UA"] =
              '"Google Chrome";v="142", "Chromium";v="142", "Not_A Brand";v="24"';
            headers["Sec-CH-UA-Mobile"] = "?0";
            headers["Sec-CH-UA-Platform"] = '"Windows"';
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

  // ── Response headers: relax CORS/X-Frame-Options for targeted auth/API flows ──
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };

      // TikTok emits very noisy report-only CSP warnings in Chromium devtools
      // (upgrade-insecure-requests/worker-src/connect-src). Removing only the
      // report-only header keeps effective CSP unchanged while preventing spam.
      if (isTikTokFamilyHost(details.url)) {
        stripReportOnlyCsp(headers);
      }

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

      // Keep effective CSP intact. We only strip noisy report-only CSP for
      // specific TikTok-family hosts above (via stripReportOnlyCsp).

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
        // For Google domains and TikTok force clean modern Chrome UA
        const url = details.url || "";
        const isTikTok = /tiktok\.com/i.test(url);
        const isYouTube = /youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com/i.test(url);
        if (
          /google\.com|googleapis\.com|accounts\.google|openrouter\.ai|clerk\.openrouter\.ai|accounts\.openrouter\.ai|\.clerk\.accounts\.dev|\.clerk\.com|auth0\.com|okta\.com|huggingface\.co|openai\.com|anthropic\.com|github\.com\/login|tiktok\.com|youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com/i.test(
            url,
          )
        ) {
          ua = GOOGLE_UA;
          delete headers["X-Requested-With"];
          if (isGoogleAuthRequest(url) && String(details.resourceType || "").toLowerCase() === "mainframe") {
            headers["Sec-CH-UA"] =
              '"Google Chrome";v="142", "Chromium";v="142", "Not_A Brand";v="24"';
            headers["Sec-CH-UA-Mobile"] = "?0";
            headers["Sec-CH-UA-Platform"] = '"Windows"';
            headers["Sec-Fetch-Site"] = "none";
            headers["Sec-Fetch-Mode"] = "navigate";
            headers["Sec-Fetch-Dest"] = "document";
            headers["Sec-Fetch-User"] = "?1";
          }
          if (isTikTok || isYouTube) {
            headers["Sec-CH-UA"] =
              '"Google Chrome";v="142", "Chromium";v="142", "Not_A Brand";v="24"';
            headers["Sec-CH-UA-Mobile"] = "?0";
            headers["Sec-CH-UA-Platform"] = '"Windows"';
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

      if (isTikTokFamilyHost(details.url)) {
        stripReportOnlyCsp(headers);
      }

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
      // Keep effective CSP intact. We only strip noisy report-only CSP for
      // specific TikTok-family hosts above (via stripReportOnlyCsp).
      callback({ responseHeaders: headers });
    },
  );

  // TikTok Isolated Mode uses its own persistent partition. Keep its request
  // surface aligned with the normal webview session; otherwise TikTok sees a
  // different UA/header profile and can refuse to open or stay on a blank page.
  const tikTokWatcherSession = session.fromPartition("persist:tiktok-watcher");

  tikTokWatcherSession.webRequest.onBeforeSendHeaders(
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
        let ua = headers[key]
          .replace(/\s*Electron\/[\d.]+/gi, "")
          .replace(/\s*EtherX\/[\d.]+/gi, "")
          .trim();
        const url = details.url || "";
        const isTikTok = /tiktok\.com/i.test(url);
        const isYouTube = /youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com/i.test(url);
        if (
          /google\.com|googleapis\.com|accounts\.google|openrouter\.ai|clerk\.openrouter\.ai|accounts\.openrouter\.ai|\.clerk\.accounts\.dev|\.clerk\.com|auth0\.com|okta\.com|huggingface\.co|openai\.com|anthropic\.com|github\.com\/login|tiktok\.com|youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com/i.test(
            url,
          )
        ) {
          ua = GOOGLE_UA;
          delete headers["X-Requested-With"];
          if (isGoogleAuthRequest(url) && String(details.resourceType || "").toLowerCase() === "mainframe") {
            headers["Sec-CH-UA"] =
              '"Google Chrome";v="142", "Chromium";v="142", "Not_A Brand";v="24"';
            headers["Sec-CH-UA-Mobile"] = "?0";
            headers["Sec-CH-UA-Platform"] = '"Windows"';
            headers["Sec-Fetch-Site"] = "none";
            headers["Sec-Fetch-Mode"] = "navigate";
            headers["Sec-Fetch-Dest"] = "document";
            headers["Sec-Fetch-User"] = "?1";
          }
          if (isTikTok || isYouTube) {
            headers["Sec-CH-UA"] =
              '"Google Chrome";v="142", "Chromium";v="142", "Not_A Brand";v="24"';
            headers["Sec-CH-UA-Mobile"] = "?0";
            headers["Sec-CH-UA-Platform"] = '"Windows"';
          }
        }
        headers[key] = ua || CLEAN_UA;
      }
      callback({ requestHeaders: headers });
    },
  );

  tikTokWatcherSession.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };

      if (isTikTokFamilyHost(details.url)) {
        stripReportOnlyCsp(headers);
      }

      if (isTrustedFirstPartyHost(details.url)) {
        callback({ responseHeaders: headers });
        return;
      }

      if (isKnownVideoHost(details.url) || isVideoOrMediaRequest(details)) {
        callback({ responseHeaders: headers });
        return;
      }

      if (!isSecurityHeaderRelaxationTarget(details.url)) {
        callback({ responseHeaders: headers });
        return;
      }

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
      delete headers["x-frame-options"];
      delete headers["X-Frame-Options"];
      // Keep effective CSP intact. We only strip noisy report-only CSP for
      // specific TikTok-family hosts above (via stripReportOnlyCsp).
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
      if (level >= 3 || ((process.env.ETHERX_DEBUG_LOGS === "1" || process.env.ETHERX_DEBUG === "1") && level >= 2))
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
    if (ETHERX_DEBUG_LOGS) console.log("✅ did-finish-load fired");
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
          if (ETHERX_DEBUG_LOGS) console.log("🔍 Layout check:", info);
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
  const isAuthorizedLiveOsReader = (sender) => {
    if (!sender) return false;
    if (mainWindow && sender.id === mainWindow.webContents.id) return true;
    return String(sender.getURL?.() || "").startsWith("chrome-extension://");
  };
  ipcMain.handle("liveos:publishSnapshot", (event, payload) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
      return { ok: false, error: "LiveOS publisher is not authorized." };
    }
    publishLiveOsSnapshot(payload);
    return { ok: true, publishedAt: liveOsSnapshot?.publishedAt || Date.now() };
  });
  ipcMain.handle("liveos:getSnapshot", (event) =>
    isAuthorizedLiveOsReader(event.sender) ? liveOsSnapshot : null);
  ipcMain.handle("liveos:subscribe", (event) => {
    const senderUrl = String(event.sender.getURL?.() || "");
    if (!senderUrl.startsWith("chrome-extension://") && event.sender.id !== mainWindow?.webContents.id) {
      return { ok: false, error: "LiveOS subscriber is not authorized." };
    }
    liveOsSubscribers.add(event.sender.id);
    event.sender.once("destroyed", () => liveOsSubscribers.delete(event.sender.id));
    return { ok: true, snapshot: liveOsSnapshot };
  });
  ipcMain.handle("liveos:unsubscribe", (event) => {
    liveOsSubscribers.delete(event.sender.id);
    return { ok: true };
  });
  ipcMain.handle("tkaiOps:getStatus", () => getTkaiOperationsStatus());
  ipcMain.handle("tkaiOps:saveTelegram", async (_event, payload = {}) => {
    const current = getTkaiTelegramConfig();
    const token = safeTkaiText(payload.token, 1000);
    const chatId = safeTkaiText(payload.chatId || current.chatId, 120);
    const values = {
      tkaiTelegramChatId: chatId,
      tkaiTelegramAutoStart: payload.autoStart === true,
    };
    if (token) values.tkaiTelegramBotToken = token;
    const store = getSecretStore();
    if (!store) return { ok: false, error: "Sigurna pohrana nije dostupna." };
    store.mergeNamespace("settings", values);
    ensureTkaiBotControlToken();
    writeTkaiTelegramNotifyState({ ...(payload.notify || {}), chatId });
    if (!tkaiBotControlServer) startTkaiBotControlServer();
    return getTkaiOperationsStatus();
  });
  ipcMain.handle("tkaiOps:startTelegram", () => startTkaiTelegramBot());
  ipcMain.handle("tkaiOps:stopTelegram", () => stopTkaiTelegramBot());
  ipcMain.handle("tkaiOps:testTelegram", () => testTkaiTelegramBot());
  ipcMain.handle("tkaiOps:notifyScanStarted", (_event, payload = {}) => notifyTkaiScanStarted(payload));
  ipcMain.handle("liveos:command", (event, action) => {
    const allowed = new Set(["start-scan", "stop-scan", "open-ai-live-chat", "songrec-now"]);
    const normalized = String(action || "");
    if (!isAuthorizedLiveOsReader(event.sender) || !allowed.has(normalized)) {
      return { ok: false, error: "LiveOS command is not authorized." };
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: "Main window is unavailable." };
    }
    mainWindow.webContents.send("liveos:command", { action: normalized });
    return { ok: true, action: normalized };
  });
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
    // The Help wizard is an explicit repair action: run it again even if the
    // startup bootstrap ran earlier or a user deleted an env file afterwards.
    const bootstrap = _ensureRuntimeEnvLocals(true);
    return {
      ..._getRuntimeEnvStatus(),
      ok: bootstrap.written > 0,
      written: bootstrap.written,
      error: bootstrap.errors.join("; "),
    };
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
  ipcMain.handle("ai:guardianRequest", async (_e, payload) => {
    try {
      const endpoint = String(payload?.endpoint || "").trim();
      const model = String(payload?.model || "grok-2").trim() || "grok-2";
      const apiKey = String(payload?.apiKey || "").trim();
      const prompt = String(payload?.prompt || "");
      const systemPrompt = String(payload?.systemPrompt || "");
      const parsed = new URL(endpoint);
      const host = parsed.hostname.toLowerCase();
      const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
      const isPrivateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return { ok: false, error: "Guardian endpoint mora koristiti HTTP ili HTTPS." };
      }
      if (parsed.protocol === "http:" && !isLocalHost && !isPrivateIpv4) {
        return { ok: false, error: "HTTP Guardian endpoint je dopušten samo za lokalnu/privatnu mrežu. Za remote koristi HTTPS." };
      }

      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = "Bearer " + apiKey;
      const { net } = require("electron");
      const response = await net.fetch(parsed.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: Number(payload?.maxTokens || 300) || 300,
        }),
      });
      const raw = await response.text();
      if (!response.ok) {
        return { ok: false, error: `Guardian AI HTTP ${response.status}: ${raw.slice(0, 500)}` };
      }
      let data = {};
      try { data = JSON.parse(raw); } catch (_) { data = { text: raw }; }
      const content = String(data.choices?.[0]?.message?.content || data.text || data.response || "").trim();
      return { ok: true, content, raw: data };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
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
  ipcMain.handle("ai:getPythonDepsStatus", async () => {
    return getPythonBridgeStatus();
  });

  ipcMain.handle("app:installTikTokLive", async () => installTikTokLive());
  ipcMain.handle("app:getTikTokLiveStatus", async () => getTikTokLiveRuntimeStatus());
  ipcMain.handle("app:startTikTokLive", async (event, owner) => startTikTokLiveBridge(owner, event.sender));
  ipcMain.handle("app:stopTikTokLive", async () => stopTikTokLiveBridge());

  ipcMain.handle("app:runOneClickSetup", async () => {
    return runOneClickLocalSetup();
  });

  ipcMain.handle("app:installWhisperLive", async (_e, mode) => {
    return installWhisperLive(mode);
  });
  ipcMain.handle("app:getWhisperLiveStatus", async () => {
    return getWhisperLiveStatus();
  });
  ipcMain.handle("app:ensureWhisperLiveRunning", async () => {
    return ensureWhisperLiveRunning();
  });

  ipcMain.handle("app:refreshWhisperLiveModelCache", async () => {
    return refreshWhisperLiveModelCacheIndex();
  });

  ipcMain.handle("app:getWhisperLiveModelCache", async () => {
    const indexed = refreshWhisperLiveModelCacheIndex();
    return db ? db.getLocalModelCache('whisperlive') : indexed;
  });

  ipcMain.handle("app:getPM2Status", async () => {
    try {
      const projectRoot = resolvePythonProjectRoot();
      const run = await execFileText("npx", ["pm2", "status", "etherx-browser"], 30000, { cwd: projectRoot });
      const snap = await getPm2ProcessSnapshot(projectRoot, "etherx-browser");
      return {
        ok: run.ok && !!snap.snapshot,
        output: run.stdout || run.stderr || "Nema PM2 statusa",
        state: String(snap.snapshot?.state || ""),
        execPath: String(snap.snapshot?.execPath || ""),
        cwd: String(snap.snapshot?.cwd || ""),
        args: Array.isArray(snap.snapshot?.args) ? snap.snapshot.args : [],
        nodeArgs: Array.isArray(snap.snapshot?.nodeArgs) ? snap.snapshot.nodeArgs : [],
      };
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

  ipcMain.handle("app:clearPM2Logs", async () => {
    try {
      const projectRoot = resolvePythonProjectRoot();
      const snap = await getPm2ProcessSnapshot(projectRoot, "etherx-browser");
      const flush = await execFileText("npx", ["pm2", "flush", "etherx-browser"], 30000, { cwd: projectRoot });
      const truncated = [];
      for (const filePath of [snap.snapshot?.outLogPath, snap.snapshot?.errLogPath]) {
        if (!filePath) continue;
        try {
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            fs.truncateSync(filePath, 0);
            truncated.push(filePath);
          }
        } catch (_) { }
      }
      return {
        ok: !!flush.ok,
        output: trimPythonInstallOutput(flush.stdout || flush.stderr || "PM2 logovi obrisani."),
        truncated,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("app:stopPM2Process", async () => {
    try {
      const projectRoot = resolvePythonProjectRoot();
      const stop = await execFileText("npx", ["pm2", "stop", "etherx-browser"], 30000, { cwd: projectRoot });
      const status = await execFileText("npx", ["pm2", "status", "etherx-browser"], 30000, { cwd: projectRoot });
      return {
        ok: !!stop.ok,
        output: trimPythonInstallOutput((stop.stdout || stop.stderr || "") + "\n" + (status.stdout || status.stderr || "")),
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("app:ensurePM2Process", async () => {
    try {
      const reqLookup = resolveRequirementsPath();
      const projectRoot = resolvePythonProjectRoot(reqLookup);
      const snap = await getPm2ProcessSnapshot(projectRoot, "etherx-browser");
      if (snap.snapshot?.online) {
        return { ok: true, alreadyOnline: true, state: snap.snapshot.state || "online" };
      }
      const setup = await runOneClickLocalSetup();
      return {
        ok: !!setup?.pm2?.ok,
        alreadyOnline: false,
        state: String(setup?.pm2?.state || ""),
        output: setup,
        error: setup?.pm2?.error || setup?.python?.error || "",
      };
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
  ipcMain.handle("googleAuth:login", async () => startGoogleOAuthLogin());
  ipcMain.handle("nav:openExternal", (_e, url) => {
    // Security: only allow http/https/mailto URLs via openExternal
    if (/^https?:\/\/|^mailto:/i.test(url)) return shell.openExternal(url);
    return Promise.resolve({ ok: false, error: "URL scheme not allowed" });
  });
  ipcMain.handle("app:openAuthWindow", async (_e, url) => {
    try {
      const parsed = new URL(String(url || ""));
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return { ok: false, error: "URL scheme not allowed" };
      }
      const authWin = new BrowserWindow({
        width: 560,
        height: 720,
        parent: mainWindow || undefined,
        modal: false,
        title: "Sign in",
        backgroundColor: "#10131f",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
          partition: "persist:etherx",
          webviewTag: false,
          preload: path.join(__dirname, "src", "webview-preload.js"),
        },
      });
      authWin.setMenuBarVisibility(false);
      authWin.webContents.setUserAgent(CHROME_CLEAN_UA);
      authWin.webContents.on("did-finish-load", () => {
        authWin.webContents.executeJavaScript(`
          (() => {
            if (window.__etherxAuthPasskeyFallback) return;
            window.__etherxAuthPasskeyFallback = true;
            const showFallback = (detail) => {
              if (document.getElementById('__etherxAuthFallback')) return;
              const box = document.createElement('div');
              box.id = '__etherxAuthFallback';
              box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;padding:12px 14px;border-radius:12px;background:rgba(12,18,32,.96);border:1px solid rgba(96,165,250,.45);color:#e5efff;font:13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.35)';
              box.innerHTML = '<b>Passkey/iPhone login ne odgovara u ovom prozoru.</b><div style="margin-top:4px;color:#b7c6e8">Pokušaj email/lozinku ili otvori ovaj auth tok u sistemskom browseru.</div><button id="__etherxAuthOpenExternal" style="margin-top:8px;padding:6px 10px;border:0;border-radius:8px;background:#3b82f6;color:white;cursor:pointer">Otvori vanjski browser</button>';
              document.body.appendChild(box);
              document.getElementById('__etherxAuthOpenExternal')?.addEventListener('click', () => {
                location.href = 'etherx-open-external:' + encodeURIComponent(location.href);
              });
              console.warn('[EtherX Auth] Passkey fallback:', detail || '');
            };
            const wrap = (obj, name) => {
              const original = obj && obj[name];
              if (typeof original !== 'function') return;
              obj[name] = function(...args) {
                const p = original.apply(this, args);
                if (p && typeof p.catch === 'function') p.catch((err) => showFallback(err && err.message ? err.message : String(err || '')));
                setTimeout(() => {
                  const text = String(document.body?.innerText || '').toLowerCase();
                  if (/iphone|passkey|security key|qr code|scan/i.test(text) && /sign in|continue|use your/i.test(text)) showFallback('passkey-screen-timeout');
                }, 15000);
                return p;
              };
            };
            try { wrap(navigator.credentials, 'get'); wrap(navigator.credentials, 'create'); } catch (_) {}
          })();
        `).catch(() => { });
      });
      authWin.webContents.on("will-navigate", (event, nextUrl) => {
        if (String(nextUrl || "").startsWith("etherx-open-external:")) {
          event.preventDefault();
          const target = decodeURIComponent(String(nextUrl).slice("etherx-open-external:".length));
          shell.openExternal(target).catch(() => { });
        }
      });
      await authWin.loadURL(parsed.toString());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
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

  ipcMain.handle("extensions:getBuiltinLiveOsPlugin", async () => {
    try {
      const all = session.fromPartition("persist:etherx").getAllExtensions();
      const list = Array.isArray(all) ? all : Object.values(all || {});
      const ext = list.find((item) => item && (item.name === "LiveOS Plugin Dashboard" || item.name === "LiveOS Plugin"));
      if (!ext) return { ok: false, error: "Builtin LiveOS Plugin is not loaded." };
      return { ok: true, id: ext.id, name: ext.name, url: "chrome-extension://" + ext.id + "/index.html" };
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
  function getBrowserCookieSessions() {
    return [
      ["default", session.defaultSession],
      ["persist:etherx", session.fromPartition("persist:etherx")],
      ["persist:tiktok-watcher", session.fromPartition("persist:tiktok-watcher")],
    ];
  }
  ipcMain.handle("cookies:getAll", async (_e, url) => {
    try {
      const filter = url ? { url } : {};
      const merged = [];
      const seen = new Set();
      for (const [partition, ses] of getBrowserCookieSessions()) {
        const rows = await ses.cookies.get(filter).catch(() => []);
        for (const cookie of rows) {
          const key = `${partition}|${cookie.domain}|${cookie.path}|${cookie.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({ ...cookie, partition });
        }
      }
      const cookies = merged.sort((a, b) =>
        String(a.partition || "").localeCompare(String(b.partition || "")) ||
        String(a.domain || "").localeCompare(String(b.domain || "")) ||
        String(a.name || "").localeCompare(String(b.name || ""))
      );
      return { ok: true, cookies };
    } catch (e) {
      return { ok: false, error: e.message, cookies: [] };
    }
  });
  ipcMain.handle("cookies:remove", async (_e, url, name) => {
    try {
      await Promise.all(getBrowserCookieSessions().map(([, ses]) => ses.cookies.remove(url, name).catch(() => null)));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("cookies:clearAll", async () => {
    try {
      await Promise.all(getBrowserCookieSessions().map(([, ses]) => ses.clearStorageData({ storages: ["cookies"] }).catch(() => null)));
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
      const missingDepRe = /No module named ['\"]?(torch|transformers|accelerate|gliclass)['\"]?|requires `?accelerate`?|pip install accelerate/i;
      const tryRunScan = async () => {
        const allCandidates = resolvePythonCandidates(resolvedProjectRoot);
        const candidates = preferExistingVenvPythonCandidates(allCandidates);
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
            lastErr = formatPythonBridgeError(run, "Qwen3Guard failed");
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
      const missingDepRe = /No module named ['\"]?(torch|transformers|accelerate|gliclass)['\"]?|requires `?accelerate`?|pip install accelerate/i;
      const tryRunScan = async () => {
        const allCandidates = resolvePythonCandidates(resolvedProjectRoot);
        const candidates = preferExistingVenvPythonCandidates(allCandidates);
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
            lastErr = formatPythonBridgeError(run, "Opir failed");
            continue;
          }
          const out = run.data || {};
          if (out.ok) {
            logPythonBridgeDebug("opir", "Scan finished successfully via", py);
            return { ok: true, out, lastErr: "" };
          }
          lastErr = String(out.error || "Opir scanner returned error").trim();
        }
        return { ok: false, out: null, lastErr };
      };

      let scan = await tryRunScan();
      if (scan.ok && scan.out) return scan.out;
      let lastErr = String(scan.lastErr || "Opir execution failed").trim();

      if (missingDepRe.test(lastErr)) {
        logPythonBridgeDebug("opir", "Missing python module detected, attempting dependency install");
        const installRes = await installPythonBridgeDeps();
        if (installRes?.ok) {
          scan = await tryRunScan();
          if (scan.ok && scan.out) return scan.out;
          lastErr = String(scan.lastErr || lastErr).trim();
        } else {
          lastErr = `${lastErr} | Python deps install failed: ${String(installRes?.error || "unknown")}`;
        }
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
      const missingDepRe = /No module named ['\"]?(torch|transformers|accelerate|gliclass)['\"]?|requires `?accelerate`?|pip install accelerate/i;
      const tryRunTranslate = async () => {
        const allCandidates = resolvePythonCandidates(resolvedProjectRoot);
        const candidates = preferExistingVenvPythonCandidates(allCandidates);
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
            lastErr = formatPythonBridgeError(run, "NLLB translation failed");
            continue;
          }
          const out = run.data || {};
          if (out.ok) {
            logPythonBridgeDebug("nllb", "Translate finished successfully via", py);
            return { ok: true, out, lastErr: "" };
          }
          lastErr = String(out.error || "NLLB translator returned error").trim();
        }
        return { ok: false, out: null, lastErr };
      };

      let runAttempt = await tryRunTranslate();
      if (runAttempt.ok && runAttempt.out) return runAttempt.out;
      let lastErr = String(runAttempt.lastErr || "NLLB execution failed").trim();

      if (missingDepRe.test(lastErr)) {
        logPythonBridgeDebug("nllb", "Missing python module detected, attempting dependency install");
        const installRes = await installPythonBridgeDeps();
        if (installRes?.ok) {
          runAttempt = await tryRunTranslate();
          if (runAttempt.ok && runAttempt.out) return runAttempt.out;
          lastErr = String(runAttempt.lastErr || lastErr).trim();
        } else {
          lastErr = `${lastErr} | Python deps install failed: ${String(installRes?.error || "unknown")}`;
        }
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

  // ── TikTok Live Chat AI local SQLite archive ─────────────────────────────
  ipcMain.handle("db:installTikTokLiveStorage", () =>
    db ? db.installTikTokLiveStorage() : noDb(),
  );
  ipcMain.handle("db:importTikTokLiveData", (_e, data) =>
    db ? db.importTikTokLiveData(data) : noDb(),
  );
  ipcMain.handle("db:getTikTokLiveData", () =>
    db ? db.getTikTokLiveData() : noDb(),
  );
  ipcMain.handle("db:clearTikTokLiveSessions", () =>
    db ? db.clearTikTokLiveSessionsAndStats() : noDb(),
  );
  ipcMain.handle("db:getTikTokLiveStorageStatus", () =>
    db ? db.getTikTokLiveStorageStatus() : noDb(),
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
      const requestJson = (url, reqHeaders = headers) => new Promise((resolve, reject) => {
        const req = net.request({ method: "GET", url, headers: reqHeaders });
        let body = "";
        req.on("response", (res) => {
          res.on("data", (chunk) => { body += chunk.toString(); });
          res.on("end", () => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              resolve({ ok: false, statusCode: res.statusCode, body });
              return;
            }
            try {
              resolve({ ok: true, statusCode: res.statusCode, data: JSON.parse(body) });
            } catch (e) {
              resolve({ ok: false, statusCode: res.statusCode, error: "Parse error: " + e.message, body });
            }
          });
        });
        req.on("error", (e) => reject(e));
        req.end();
      });

      const current = app.getVersion();
      let latestFromServer = "";
      const ownVersionRes = await requestJson("https://api.kriptoentuzijasti.io/version", {
        "User-Agent": "EtherX-Browser",
        Accept: "application/json",
      }).catch(() => null);
      if (ownVersionRes?.ok && ownVersionRes.data?.ok && ownVersionRes.data.version) {
        latestFromServer = String(ownVersionRes.data.version || "").replace(/^v/, "");
      }

      const GITHUB_API_BASE = "https://api.github.com/repos/ktrucek/etherx-standalone/releases";
      const githubUrl = latestFromServer
        ? `${GITHUB_API_BASE}/tags/v${encodeURIComponent(latestFromServer)}`
        : `${GITHUB_API_BASE}/latest`;
      const releaseRes = await requestJson(githubUrl);
      const result = (() => {
        if (releaseRes.statusCode === 404) {
          return { ok: false, error: "Nema objavljenih verzija na GitHub-u" };
        }
        if (!releaseRes.ok) {
          return { ok: false, error: releaseRes.error || ("GitHub API greška: HTTP " + releaseRes.statusCode) };
        }
        const data = releaseRes.data || {};
        const latest = latestFromServer || String(data.tag_name || "").replace(/^v/, "");
        const assets = (data.assets || []).map((a) => ({
          name: a.name,
          url: a.browser_download_url || "",
          browserUrl: a.browser_download_url || "",
          apiUrl: a.url || "",
          size: a.size,
        }));
        return {
          ok: true,
          current,
          latest,
          isNew: isSemverNewer(latest, current),
          name: data.name || data.tag_name,
          body: data.body || "",
          assets,
          publishedAt: data.published_at || "",
        };
      })();
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
      const safeFilename = path.basename(String(filename || ""));
      if (
        !safeFilename ||
        safeFilename !== filename ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(safeFilename)
      ) {
        return { ok: false, error: "Invalid update filename" };
      }
      const dest = path.join(tmpDir, safeFilename);
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
        "git.kasp.top",
      ]);
      const allowedUpdateHostSuffixes = [
        ".githubusercontent.com",
        ".github-releases.githubusercontent.com",
        ".kasp.top",
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

      const buildUpdateHeaders = (requestUrl) => {
        const headers = {
          "User-Agent": "EtherX-Browser",
          "Accept": "application/octet-stream",
        };
        const host = new URL(requestUrl).hostname.toLowerCase();
        if (token && (host === "github.com" || host === "api.github.com")) {
          headers["Authorization"] = "Bearer " + token;
        }
        return headers;
      };
      const redirectCodes = new Set([301, 302, 303, 307, 308]);
      const fetchUpdateAsset = async (initialUrl) => {
        const initialValidatedUrl = normalizeUpdateUrl(initialUrl);
        if (!initialValidatedUrl) {
          console.error("[Update] Blocked unsafe URL:", initialUrl);
          throw new Error("Blocked unsafe update URL");
        }
        try {
          const followedResponse = await net.fetch(initialValidatedUrl, {
            method: "GET",
            headers: buildUpdateHeaders(initialValidatedUrl),
            redirect: "follow",
          });
          const finalUrl = normalizeUpdateUrl(followedResponse.url || initialValidatedUrl);
          if (!finalUrl) {
            throw new Error("Blocked unsafe update redirect: " + (followedResponse.url || "(unknown final URL)"));
          }
          return followedResponse;
        } catch (followErr) {
          if (!/redirect|err_aborted|\(-3\)/i.test(String(followErr?.message || followErr))) {
            throw followErr;
          }
          if (ETHERX_DEBUG_LOGS) console.log("[Update] Automatic redirect follow failed, falling back to manual redirect handling:", followErr.message);
        }
        let requestUrl = initialUrl;
        const visitedUrls = new Set();
        const redirectTrace = [];
        for (let redirectCount = 0; redirectCount <= 12; redirectCount += 1) {
          const validatedUrl = normalizeUpdateUrl(requestUrl);
          if (!validatedUrl) {
            console.error("[Update] Blocked unsafe URL:", requestUrl);
            throw new Error("Blocked unsafe update URL");
          }
          if (visitedUrls.has(validatedUrl)) {
            const trace = redirectTrace.concat(validatedUrl).slice(-6).join(" -> ");
            console.error("[Update] Redirect cycle detected:", trace);
            throw new Error("Update redirect cycle detected: " + trace);
          }
          visitedUrls.add(validatedUrl);
          redirectTrace.push(validatedUrl);

          if (ETHERX_DEBUG_LOGS) console.log(`[Update] Fetch attempt ${redirectCount + 1}: ${validatedUrl.substring(0, 100)}...`);
          const response = await net.fetch(validatedUrl, {
            method: "GET",
            headers: buildUpdateHeaders(validatedUrl),
            redirect: "manual",
          });

          if (!redirectCodes.has(response.status)) {
            if (ETHERX_DEBUG_LOGS) console.log(`[Update] Got final response with status ${response.status}`);
            return response;
          }

          const location = response.headers.get("location");
          if (ETHERX_DEBUG_LOGS) console.log(`[Update] Redirect ${redirectCount + 1} → ${response.status} → ${location?.substring(0, 100) || '(no location)'}...`);

          if (!location) throw new Error("Update redirect is missing a location");
          if (redirectCount === 12) {
            const trace = redirectTrace.slice(-6).join(" -> ");
            throw new Error("Too many update redirects: " + trace);
          }

          // CodeQL SSRF mitigation: explicit validation of redirect target before use
          // Ensure location header points only to whitelisted GitHub/Gitea/S3 asset hosts
          let redirectUrl;
          try {
            redirectUrl = new URL(location, validatedUrl);
            const redirectHost = redirectUrl.hostname.toLowerCase();
            if (!isAllowedUpdateHost(redirectHost)) {
              console.error("[Update] Blocked redirect to non-whitelisted host:", redirectHost);
              throw new Error("Redirect target not in whitelist: " + redirectHost);
            }
            if (redirectUrl.protocol !== "https:") {
              console.error("[Update] Blocked non-HTTPS redirect:", redirectUrl.protocol);
              throw new Error("Redirect must use HTTPS");
            }
          } catch (err) {
            console.error("[Update] Redirect validation failed:", err.message);
            throw new Error("Blocked unsafe update redirect: " + err.message);
          }

          // Use the already validated and normalized URL object
          requestUrl = redirectUrl.href;
        }
        throw new Error("Too many update redirects");
      };

      const response = await fetchUpdateAsset(safeUrl);

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
                filename: safeFilename,
              });
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      await new Promise((res, rej) => ws.end((err) => err ? rej(err) : res()));

      return { ok: true, filePath: dest, filename: safeFilename };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Source-based update path: pull latest from GitHub for unpackaged/server installs.
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
          error: "Nisam pronašao Git repozitorij za GitHub source update.",
        };
      }

      const githubRemoteUrl = "https://github.com/ktrucek/etherx-standalone.git";
      const remoteRun = await execFileAsync("git", ["-C", root, "remote"]);
      const remotes = String(remoteRun.stdout || "").split(/\s+/).filter(Boolean);
      if (remotes.includes("github")) {
        await execFileAsync("git", ["-C", root, "remote", "set-url", "github", githubRemoteUrl]);
      } else {
        await execFileAsync("git", ["-C", root, "remote", "add", "github", githubRemoteUrl]);
      }

      const branchRun = await execFileAsync("git", [
        "-C",
        root,
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      let branch = String(branchRun.stdout || "main").trim() || "main";
      if (branch === "HEAD") branch = "main";

      const statusRun = await execFileAsync("git", ["-C", root, "status", "--porcelain"]);
      const wasDirty = String(statusRun.stdout || "").trim().length > 0;
      let stashCreated = false;
      let stashName = "";
      if (wasDirty) {
        stashName = "etherx-github-update-" + Date.now();
        await execFileAsync("git", ["-C", root, "stash", "push", "--include-untracked", "-m", stashName]);
        stashCreated = true;
      }

      let before = "";
      let after = "";
      try {
        before = String((await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"])).stdout || "").trim();
        await execFileAsync("git", ["-C", root, "fetch", "--tags", "github", branch]);
        await execFileAsync("git", [
          "-C",
          root,
          "merge",
          "--ff-only",
          "FETCH_HEAD",
        ]);
        after = String((await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"])).stdout || "").trim();
      } finally {
        if (stashCreated) {
          try {
            await execFileAsync("git", ["-C", root, "stash", "pop"]);
          } catch (stashError) {
            stashError.message = "GitHub update je povučen, ali lokalne izmjene se nisu mogle automatski vratiti iz stash-a. Ručno riješi stash konflikt. Detalj: " + (stashError.stderr || stashError.message || stashError);
            throw stashError;
          }
        }
      }

      return {
        ok: true,
        root,
        branch,
        remote: "github",
        before,
        after,
        changed: before && after ? before !== after : false,
        restoredLocalChanges: stashCreated,
      };
    } catch (e) {
      return {
        ok: false,
        error: String(e?.stderr || e?.message || e),
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
      if (isAuthDeepLinkProtocol(parsedUrl.protocol)) {
        shell.openExternal(details.url).catch(() => { });
        return { action: "deny" };
      }

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
          /accounts\.google\.com|login\.live\.com|appleid\.apple\.com|facebook\.com\/dialog|twitter\.com\/oauth|x\.com\/oauth|github\.com\/login\/oauth|discord\.com\/oauth2|linkedin\.com\/oauth|reddit\.com\/api\/v1\/authorize|openrouter\.ai\/auth|accounts\.openrouter\.ai|clerk\.openrouter\.ai|auth\.openrouter\.ai|[^/]*\.clerk\.accounts\.dev|[^/]*\.clerk\.com|auth0\.com|okta\.com\/oauth2|login\.microsoftonline\.com|huggingface\.co\/login|openai\.com\/auth|anthropic\.com\/login/i.test(
            details.url,
          );

        // Google and other OAuth popups must stay inside the persisted EtherX
        // session so cookies are saved for Gmail/Drive/etc.
        const isGoogleAuth = (url) => {
          try {
            const u = new URL(url);
            const host = u.hostname.toLowerCase();
            if (host === 'accounts.google.com' || host === 'consent.google.com' || host === 'myaccount.google.com') return true;
            if (host.endsWith('.google.com') && (u.pathname.includes('/o/oauth') || u.pathname.includes('/signin') || u.pathname.includes('/servicelogin'))) return true;
            const search = (u.search || '').toLowerCase();
            if (search.includes('flowname=glifwebsignin') || search.includes('flowentry=servicelogin')) return true;
            return false;
          } catch (_) { return false; }
        };

        if (isOAuthPopup || isGoogleAuth(details.url)) {
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
      if (parsed.protocol === "etherx-open-external:") {
        _e.preventDefault();
        const target = decodeURIComponent(String(url).slice("etherx-open-external:".length));
        if (/^https?:\/\//i.test(target)) shell.openExternal(target).catch(() => { });
      } else if (isAuthDeepLinkProtocol(parsed.protocol)) {
        _e.preventDefault();
        shell.openExternal(url).catch(() => { });
      } else if (["mailto:", "tel:", "sms:", "magnet:"].includes(parsed.protocol)) {
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
