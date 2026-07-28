"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const NOTIFY_STORE_PATH = String(process.env.TKAI_NOTIFY_STORE_PATH || "").trim()
  || path.join(process.cwd(), "live-chat-server", "data", "tkai-bot-notify.json");

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const source = fs.readFileSync(filePath, "utf8");
    source.split(/\r?\n/).forEach((line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) return;
      const key = match[1];
      if (process.env[key] != null && String(process.env[key]).trim() !== "") return;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    });
  } catch (error) {
    console.warn(`[tkai-telegram-bot] env load warning for ${filePath}: ${String(error?.message || error)}`);
  }
}

[
  path.join(process.cwd(), ".env.local"),
  path.join(process.cwd(), "live-chat-server", ".env"),
  path.join(process.cwd(), "live-chat-server", ".env.local"),
].forEach(loadEnvFile);

const DEFAULT_API_URL = String(process.env.TKAI_BOT_CONTROL_URL || "http://127.0.0.1:8793").replace(/\/+$/, "");
const CONTROL_TOKEN = String(process.env.TKAI_BOT_CONTROL_TOKEN || "").trim();
const TELEGRAM_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const ALLOWED_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const POLL_TIMEOUT_SECONDS = Math.max(10, Math.min(60, Number(process.env.TELEGRAM_POLL_TIMEOUT || 25) || 25));
const ARCHIVE_API_URL = String(
  process.env.TKAI_ARCHIVE_API_URL || "https://live.kriptoentuzijasti.io",
).replace(/\/+$/, "");
const ARCHIVE_TOKEN = String(
  process.env.TKAI_ARCHIVE_TOKEN
  || process.env.LIVE_ARCHIVE_API_TOKEN
  || process.env.LIVE_AUTH_TOKEN
  || "",
).trim();
const ARCHIVE_ADMIN_TOKEN = String(process.env.TKAI_ARCHIVE_ADMIN_TOKEN || "").trim();

if (require.main === module && !TELEGRAM_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required.");
  process.exit(1);
}

const tgApi = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
let updateOffset = 0;
let notifyState = loadNotifyState();
let notifyMonitorStarted = false;
const pendingForgetActions = new Map();

function controlApiReady() {
  return !!CONTROL_TOKEN && CONTROL_TOKEN.length >= 24;
}

function archiveApiReady() {
  return ARCHIVE_TOKEN.length >= 32;
}

function loadNotifyState() {
  try {
    if (!fs.existsSync(NOTIFY_STORE_PATH)) {
      return {
        enabled: false,
        startupEnabled: true,
        alertEnabled: true,
        chatId: ALLOWED_CHAT_ID || "",
        viewerThreshold: 0,
        giftEnabled: false,
        giftCoinsMin: 500,
        whaleCoins: 10000,
        spikeThreshold: 150,
        watchUsers: [],
        last: {
          sessionId: "",
          alertKey: "",
          viewerThresholdHitAt: 0,
          giftKey: "",
          whaleKey: "",
          watchUserKey: "",
          spikeKey: "",
        },
      };
    }
    const parsed = JSON.parse(fs.readFileSync(NOTIFY_STORE_PATH, "utf8"));
    return {
      enabled: parsed?.enabled === true,
      startupEnabled: parsed?.startupEnabled !== false,
      alertEnabled: parsed?.alertEnabled !== false,
      chatId: String(parsed?.chatId || ALLOWED_CHAT_ID || ""),
      viewerThreshold: Math.max(0, Number(parsed?.viewerThreshold || 0) || 0),
      giftEnabled: parsed?.giftEnabled === true,
      giftCoinsMin: Math.max(1, Number(parsed?.giftCoinsMin || 500) || 500),
      whaleCoins: Math.max(0, Number(parsed?.whaleCoins || 10000) || 10000),
      spikeThreshold: Math.max(1, Number(parsed?.spikeThreshold || 150) || 150),
      watchUsers: Array.isArray(parsed?.watchUsers)
        ? parsed.watchUsers.map((value) => normalizeUserArg(value)).filter(Boolean).slice(0, 50)
        : [],
      last: {
        sessionId: String(parsed?.last?.sessionId || ""),
        alertKey: String(parsed?.last?.alertKey || ""),
        viewerThresholdHitAt: Number(parsed?.last?.viewerThresholdHitAt || 0) || 0,
        giftKey: String(parsed?.last?.giftKey || ""),
        whaleKey: String(parsed?.last?.whaleKey || ""),
        watchUserKey: String(parsed?.last?.watchUserKey || ""),
        spikeKey: String(parsed?.last?.spikeKey || ""),
      },
    };
  } catch (error) {
    console.error("[tkai-telegram-bot] notify load failed:", String(error?.message || error));
    return {
      enabled: false,
      startupEnabled: true,
      alertEnabled: true,
      chatId: ALLOWED_CHAT_ID || "",
      viewerThreshold: 0,
      giftEnabled: false,
      giftCoinsMin: 500,
      whaleCoins: 10000,
      spikeThreshold: 150,
      watchUsers: [],
      last: { sessionId: "", alertKey: "", viewerThresholdHitAt: 0, giftKey: "", whaleKey: "", watchUserKey: "", spikeKey: "" },
    };
  }
}

function saveNotifyState() {
  try {
    fs.mkdirSync(path.dirname(NOTIFY_STORE_PATH), { recursive: true });
    fs.writeFileSync(NOTIFY_STORE_PATH, JSON.stringify(notifyState, null, 2), "utf8");
  } catch (error) {
    console.error("[tkai-telegram-bot] notify save failed:", String(error?.message || error));
  }
}

async function tg(method, payload) {
  const response = await fetch(`${tgApi}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.description || `Telegram ${method} failed with HTTP ${response.status}`));
  }
  return data.result;
}

async function configureTelegramCommands() {
  return tg("setMyCommands", {
    commands: [
      { command: "menu", description: "Glavni izbornik" },
      { command: "db", description: "Ukupna serverska LIVE baza" },
      { command: "creators", description: "Kreatori u arhivi" },
      { command: "creator", description: "Profil kreatora" },
      { command: "sessions", description: "Popis spremljenih LIVE sesija" },
      { command: "session", description: "Detalji spremljene sesije" },
      { command: "events", description: "Događaji spremljene sesije" },
      { command: "users", description: "Korisnici spremljene sesije" },
      { command: "viewers", description: "Publika grupirana po kreatorima" },
      { command: "userdata", description: "Podaci korisnika po kreatoru, danu ili streamu" },
      { command: "userstreams", description: "Streamovi određenog korisnika" },
      { command: "daily", description: "Dnevni izvještaj" },
      { command: "weekly", description: "Tjedni izvještaj" },
      { command: "monthly", description: "Mjesečni izvještaj" },
      { command: "gifts", description: "Giftovi iz arhive" },
      { command: "search", description: "Pretraga LIVE arhive" },
      { command: "watchlist", description: "Praćeni korisnici" },
      { command: "serverstatus", description: "Stanje servera i baze" },
      { command: "backupstatus", description: "Stanje backup kopija" },
      { command: "status", description: "Status aktivnog desktop LIVE-a" },
      { command: "viewer", description: "Gledatelji aktivnog LIVE-a" },
      { command: "giftstats", description: "Gift statistika aktivnog LIVE-a" },
      { command: "alerts", description: "Aktivni detektorski alarmi" },
      { command: "help", description: "Sve Telegram komande" },
    ],
  });
}

async function configureTelegramWebhook(url, secretToken) {
  const webhookUrl = String(url || "").trim();
  const secret = String(secretToken || "").trim();
  if (!/^https:\/\//i.test(webhookUrl)) throw new Error("Telegram webhook mora koristiti HTTPS.");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) throw new Error("Telegram webhook secret nije valjan.");
  const current = await getTelegramWebhookInfo().catch(() => null);
  if (current?.url === webhookUrl && current?.has_custom_certificate === true) {
    return true;
  }
  return tg("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
    max_connections: 20,
  });
}

async function getTelegramWebhookInfo() {
  return tg("getWebhookInfo", {});
}

async function sendTelegramMessage(chatId, text, options = {}) {
  return tg("sendMessage", {
    chat_id: String(chatId || ALLOWED_CHAT_ID),
    text: String(text || "").slice(0, 3900),
    disable_web_page_preview: true,
    ...options,
  });
}

async function tgDocument(chatId, filename, content, caption = "", mimeType = "text/csv;charset=utf-8") {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", String(caption || "").slice(0, 1000));
  form.append(
    "document",
    new Blob([Buffer.from(String(content || ""), "utf8")], { type: mimeType }),
    filename,
  );
  const response = await fetch(`${tgApi}/sendDocument`, { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.description || `Telegram sendDocument failed with HTTP ${response.status}`));
  }
  return data.result;
}

async function callControlApi(path, options = {}) {
  if (!controlApiReady()) {
    throw new Error("TKAI_BOT_CONTROL_TOKEN nije postavljen. Bot je spojen na Telegram, ali nema pristup lokalnom TKAI control API-ju.");
  }
  const response = await fetch(`${DEFAULT_API_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${CONTROL_TOKEN}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(String(data?.error || `Control API ${path} failed with HTTP ${response.status}`));
  }
  return data;
}

async function callArchiveApi(path) {
  if (!archiveApiReady()) {
    throw new Error(
      "Serverska LIVE baza nije spojena. Spremi LIVE server pristupni token u AI Live Chat postavkama.",
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${ARCHIVE_API_URL}${path}`, {
      headers: {
        authorization: `Bearer ${ARCHIVE_TOKEN}`,
        accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(String(data?.error || `Archive API ${path} failed with HTTP ${response.status}`));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function callArchiveAdminApi(path, options = {}) {
  if (ARCHIVE_ADMIN_TOKEN.length < 32) {
    throw new Error("Archive admin token nije dostupan.");
  }
  const response = await fetch(`${ARCHIVE_API_URL}${path}`, {
    method: options.method || "POST",
    headers: {
      authorization: `Bearer ${ARCHIVE_TOKEN}`,
      "x-archive-admin-token": ARCHIVE_ADMIN_TOKEN,
      "content-type": "application/json; charset=utf-8",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(String(data?.error || `Archive admin API ${path} failed with HTTP ${response.status}`));
  }
  return data;
}

function fmtDate(ts) {
  const num = Number(ts || 0);
  if (!num) return "-";
  return new Date(num).toLocaleString("hr-HR", { hour12: false });
}

function fmtNum(value) {
  return new Intl.NumberFormat("hr-HR").format(Number(value || 0));
}

function fmtDurationMinutes(startedAt) {
  const ts = Number(startedAt || 0);
  if (!ts) return "-";
  return `${Math.max(0, Math.floor((Date.now() - ts) / 60000))} min`;
}

function normalizeUserArg(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function tokenizeCommand(text) {
  const parts = [];
  String(text || "").replace(/"([^"]*)"|'([^']*)'|(\S+)/g, (_match, doubleQuoted, singleQuoted, bare) => {
    parts.push(doubleQuoted ?? singleQuoted ?? bare ?? "");
    return "";
  });
  return parts;
}

function mainMenuMarkup() {
  return {
    inline_keyboard: [
      [
        { text: "👤 Kreatori", callback_data: "cmd:/creators" },
        { text: "🎬 Sesije", callback_data: "cmd:/sessions 8" },
      ],
      [
        { text: "👥 Viewers", callback_data: "cmd:/viewers" },
        { text: "🎁 Giftovi", callback_data: "cmd:/gifts" },
      ],
      [
        { text: "📅 Dnevni", callback_data: "cmd:/daily" },
        { text: "📊 Tjedni", callback_data: "cmd:/weekly" },
      ],
      [
        { text: "🚨 Alarmi", callback_data: "cmd:/alerts" },
        { text: "🗄 Baza", callback_data: "cmd:/db" },
      ],
      [
        { text: "🩺 Server", callback_data: "cmd:/serverstatus" },
        { text: "❓ Pomoć", callback_data: "cmd:/help" },
      ],
    ],
  };
}

async function commandMarkup(commandText) {
  const parts = tokenizeCommand(commandText);
  const command = String(parts[0] || "").toLowerCase().split("@")[0];
  if (command === "/start" || command === "/menu") return mainMenuMarkup();
  if ((command === "/creators" || command === "/viewers") && !parts[1]) {
    try {
      const data = await callArchiveApi("/v1/archive/creators?limit=12");
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const buttons = rows.map((row, index) => {
        const owner = String(row.owner || "").replace(/^@+/, "");
        const callback = command === "/viewers"
          ? `cmd:/viewers ${index + 1}`
          : `cmd:/creator @${owner}`;
        return { text: `@${owner || index + 1}`, callback_data: callback.slice(0, 64) };
      });
      const keyboard = [];
      for (let index = 0; index < buttons.length; index += 2) keyboard.push(buttons.slice(index, index + 2));
      keyboard.push([{ text: "⬅️ Glavni izbornik", callback_data: "cmd:/menu" }]);
      return { inline_keyboard: keyboard };
    } catch (_) {
      return mainMenuMarkup();
    }
  }
  if (command === "/sessions") {
    const buttons = Array.from({ length: 8 }, (_unused, index) => ({
      text: `Sesija ${index + 1}`,
      callback_data: `cmd:/session ${index + 1}`,
    }));
    const keyboard = [];
    for (let index = 0; index < buttons.length; index += 2) keyboard.push(buttons.slice(index, index + 2));
    keyboard.push([{ text: "⬅️ Glavni izbornik", callback_data: "cmd:/menu" }]);
    return { inline_keyboard: keyboard };
  }
  return {
    inline_keyboard: [[{ text: "⬅️ Glavni izbornik", callback_data: "cmd:/menu" }]],
  };
}

function getSessionSnapshot(data) {
  return data?.snapshot && typeof data.snapshot === "object" ? data.snapshot : data;
}

function findUserInSnapshot(snapshot, userArg) {
  const key = normalizeUserArg(userArg);
  if (!key) return null;
  const users = Array.isArray(snapshot?.users) ? snapshot.users : [];
  return users.find((row) => normalizeUserArg(row?.user) === key) || null;
}

function getTopGiftRows(snapshot, limit = 5) {
  const gifts = Array.isArray(snapshot?.gifts) ? snapshot.gifts : [];
  return gifts
    .map((gift) => ({
      giftName: String(gift?.giftName || gift?.name || "-").trim() || "-",
      events: Number(gift?.events || 0) || 0,
      quantity: Number(gift?.quantity || 0) || 0,
      coins: Number(gift?.coins || 0) || 0,
      users: Number(gift?.users || 0) || 0,
    }))
    .sort((a, b) => b.coins - a.coins || b.quantity - a.quantity || b.events - a.events)
    .slice(0, Math.max(1, Math.min(20, Number(limit || 5) || 5)));
}

function getMessageRate(snapshot) {
  const startedAt = Number(snapshot?.session?.startedAt || snapshot?.connection?.startedAt || 0);
  const messageCount = Number(snapshot?.session?.messageCount || 0);
  if (!startedAt || !messageCount) return 0;
  const minutes = Math.max(1, (Date.now() - startedAt) / 60000);
  return Math.round((messageCount / minutes) * 10) / 10;
}

function buildStatusMessage(data) {
  const session = data?.session || {};
  const connection = data?.connection || {};
  const latest = data?.latestEvent || null;
  const lines = [
    "TikTok Chat AI status",
    `Stanje: ${connection.state || "-"}`,
    `Owner: ${connection.owner || "-"}`,
    `Live URL: ${connection.liveUrl || "-"}`,
    `Poruka: ${fmtNum(session.messageCount)}`,
    `Korisnika: ${fmtNum(session.uniqueUsers)}`,
    `Gifteri: ${fmtNum((data.topGifters || []).length)}`,
    `Coins: ${fmtNum(session.totalCoins)}`,
    `Pregledi sad: ${fmtNum(session.currentViewers)}`,
    `Peak pregledi: ${fmtNum(session.peakViewers)}`,
    `Početak sesije: ${fmtDate(session.startedAt)}`,
    `Zadnji event: ${latest ? `${latest.type || "-"} / ${latest.user || "-"} / ${latest.text || "-"}` : "-"}`,
  ];
  if (data?.database?.ok) {
    lines.push(`Baza: ${fmtNum(data.database.events)} events | ${fmtNum(data.database.sessions)} sessions | ${fmtNum(data.database.users)} users`);
  }
  return lines.join("\n");
}

function buildViewerMessage(data) {
  const snapshot = getSessionSnapshot(data);
  const session = snapshot?.session || {};
  const connection = snapshot?.connection || {};
  return [
    "Viewer status",
    `Owner: ${connection.owner || "-"}`,
    `Live URL: ${connection.liveUrl || "-"}`,
    `Current viewers: ${fmtNum(session.currentViewers)}`,
    `Peak viewers: ${fmtNum(session.peakViewers)}`,
    `Trajanje: ${fmtDurationMinutes(session.startedAt)}`,
    `Poruka/min: ${fmtNum(getMessageRate(snapshot))}`,
    `Poruka ukupno: ${fmtNum(session.messageCount)}`,
    `Zadnji event: ${fmtDate(connection.lastEventAt || 0)}`,
  ].join("\n");
}

function buildGiftersMessage(data) {
  const gifters = Array.isArray(data?.gifters) ? data.gifters : [];
  if (!gifters.length) return "Nema giftera u aktivnom snapshotu.";
  const lines = ["Top gifteri"];
  gifters.forEach((row, index) => {
    lines.push(`${index + 1}. ${row.displayName || row.user || "-"} | coins ${fmtNum(row.coins)} | giftova ${fmtNum(row.gifts)} | poruka ${fmtNum(row.messages)}`);
  });
  return lines.join("\n");
}

function buildGiftStatsMessage(data) {
  const snapshot = getSessionSnapshot(data);
  const session = snapshot?.session || {};
  const supporters = Array.isArray(snapshot?.supporters) ? snapshot.supporters : [];
  const topGifts = getTopGiftRows(snapshot, 5);
  const lines = [
    "Gift stats",
    `Ukupno coins: ${fmtNum(session.totalCoins)}`,
    `Ukupno gift tipova: ${fmtNum((Array.isArray(snapshot?.gifts) ? snapshot.gifts.length : 0))}`,
    `Top supportera: ${fmtNum(supporters.length)}`,
  ];
  if (topGifts.length) {
    lines.push("", "Top giftovi:");
    topGifts.forEach((gift, index) => {
      lines.push(`${index + 1}. ${gift.giftName} | ${fmtNum(gift.coins)} coins | qty ${fmtNum(gift.quantity)} | events ${fmtNum(gift.events)}`);
    });
  }
  return lines.join("\n");
}

function buildUserMessage(data, userArg) {
  const snapshot = getSessionSnapshot(data);
  const user = findUserInSnapshot(snapshot, userArg);
  if (!user) return `Korisnik @${normalizeUserArg(userArg) || userArg} nije nađen u aktivnom sessionu.`;
  const giftTypes = Array.isArray(user.giftTypes) ? user.giftTypes : [];
  const giftText = giftTypes.length
    ? giftTypes.slice(0, 4).map((entry) => `${entry[0]} x${fmtNum(entry[1])}`).join(", ")
    : "-";
  return [
    `User @${user.user}`,
    `Ukupno aktivnosti: ${fmtNum(user.total)}`,
    `Chat: ${fmtNum(user.chat)}`,
    `Giftovi: ${fmtNum(user.gifts)}`,
    `Coins: ${fmtNum(user.coins)}`,
    `Join: ${fmtNum(user.joins)} | Like: ${fmtNum(user.likes)} | Share: ${fmtNum(user.shares)}`,
    `Prvi put viđen: ${fmtDate(user.firstSeen)}`,
    `Zadnji put viđen: ${fmtDate(user.lastTs)}`,
    `Gift tipovi: ${giftText}`,
    `Zadnja poruka: ${user.lastMessage || "-"}`,
  ].join("\n");
}

function buildAlertsMessage(data) {
  const snapshot = getSessionSnapshot(data);
  const alerts = Array.isArray(snapshot?.alerts) ? snapshot.alerts : [];
  if (!alerts.length) return "Nema alertsa u aktivnom snapshotu.";
  const lines = ["Alerts"];
  alerts.slice(0, 8).forEach((alert, index) => {
    const actor = alert.user || alert.accountId || alert.userHandle || "-";
    lines.push(`${index + 1}. ${alert.type || "alert"} | ${actor} | score ${fmtNum(alert.riskScore || alert.score)} | ${alert.text || "-"}`);
  });
  return lines.join("\n");
}

function buildNotifyStatusMessage() {
  return [
    "Notify status",
    `Enabled: ${notifyState.enabled ? "ON" : "OFF"}`,
    `Startup poruka: ${notifyState.startupEnabled ? "ON" : "OFF"}`,
    `TKAI alerts: ${notifyState.alertEnabled ? "ON" : "OFF"}`,
    `Chat ID: ${notifyState.chatId || "-"}`,
    `Viewer threshold: ${fmtNum(notifyState.viewerThreshold)}`,
    `Gift alert: ${notifyState.giftEnabled ? `ON (min ${fmtNum(notifyState.giftCoinsMin)} coins)` : "OFF"}`,
    `Whale coins: ${fmtNum(notifyState.whaleCoins)}`,
    `Spike threshold: ${fmtNum(notifyState.spikeThreshold)}`,
    `Watch users: ${notifyState.watchUsers.length ? notifyState.watchUsers.map((user) => `@${user}`).join(", ") : "-"}`,
  ].join("\n");
}

function buildDatabaseMessage(data) {
  const storage = data?.storage || {};
  const sessions = Array.isArray(data?.latestSessions) ? data.latestSessions : [];
  const gifters = Array.isArray(data?.topStoredGifters) ? data.topStoredGifters : [];
  const lines = [
    "TKAI baza",
    `Users: ${fmtNum(storage.users)}`,
    `Events: ${fmtNum(storage.events)}`,
    `Sessions: ${fmtNum(storage.sessions)}`,
    `Stats: ${fmtNum(storage.stats)}`,
    `Zadnja aktivnost: ${fmtDate(storage.lastActivityAt)}`,
  ];
  if (sessions.length) {
    lines.push("", "Zadnje sesije:");
    sessions.slice(-3).forEach((row) => {
      lines.push(`- ${row.label || row.id || "-"} | msg ${fmtNum(row.messageCount)} | peak ${fmtNum(row.peakViewers)} | coins ${fmtNum(row.totalCoins)}`);
    });
  }
  if (gifters.length) {
    lines.push("", "Top stored gifteri:");
    gifters.slice(0, 3).forEach((row, index) => {
      lines.push(`${index + 1}. ${row.displayName || row.user || "-"} | ${fmtNum(row.coins)} coins`);
    });
  }
  return lines.join("\n");
}

function buildArchiveOverviewMessage(data) {
  const overview = data?.overview || {};
  const creators = Array.isArray(overview.topCreators) ? overview.topCreators : [];
  const lines = [
    "Serverska LIVE baza",
    `Sesije: ${fmtNum(overview.sessions)}`,
    `Događaji: ${fmtNum(overview.events)}`,
    `Poruke: ${fmtNum(overview.chats)}`,
    `Pokloni: ${fmtNum(overview.gifts)}`,
    `Pretplate: ${fmtNum(overview.subscribers)}`,
    `Korisnički računi: ${fmtNum(overview.uniqueAccounts)}`,
    `Coini: ${fmtNum(overview.coins)}`,
    `Najviše gledatelja: ${fmtNum(overview.peakViewers)}`,
    `Zadnja aktivnost: ${fmtDate(overview.lastActivityAt)}`,
  ];
  if (creators.length) {
    lines.push("", "Top kreatori:");
    creators.slice(0, 5).forEach((row, index) => {
      lines.push(
        `${index + 1}. @${row.owner || "-"} | ${fmtNum(row.sessions)} sesija | ${fmtNum(row.events)} događaja | ${fmtNum(row.coins)} coins`,
      );
    });
  }
  lines.push("", "Za spremljene sesije: /sessions");
  return lines.join("\n");
}

function buildArchiveSessionsMessage(data) {
  const sessions = Array.isArray(data?.rows) ? data.rows : [];
  if (!sessions.length) return "Serverska LIVE baza još nema spremljenih sesija.";
  const lines = [
    `Spremljene LIVE sesije (${fmtNum(data.total)})`,
    "Broj koristi u /session, /events i /users.",
    "",
  ];
  sessions.forEach((session, index) => {
    const counts = session?.counts || {};
    lines.push(
      `${index + 1}. @${session.owner || "nepoznat"} | ${fmtDate(session.startedAt)}`,
      `   događaji ${fmtNum(counts.total)} | users ${fmtNum(session.uniqueUsers)} | coins ${fmtNum(counts.coins)} | peak ${fmtNum(session.peakViewers)}`,
      `   ID: ${session.id}`,
    );
  });
  lines.push("", "Primjer: /session 1");
  return lines.join("\n");
}

async function resolveArchiveSession(reference) {
  const ref = String(reference || "").trim();
  const data = await callArchiveApi("/v1/archive/sessions?limit=50");
  const sessions = Array.isArray(data?.rows) ? data.rows : [];
  if (!sessions.length) return null;
  if (/^\d+$/.test(ref)) {
    const index = Number(ref) - 1;
    return sessions[index] || null;
  }
  if (!ref) return sessions[0];
  const normalized = ref.toLowerCase().replace(/^@+/, "");
  return sessions.find((session) => String(session?.id || "").toLowerCase() === normalized)
    || sessions.find((session) => String(session?.id || "").toLowerCase().startsWith(normalized))
    || sessions.find((session) => String(session?.owner || "").toLowerCase() === normalized)
    || null;
}

function buildArchiveSessionMessage(session) {
  const counts = session?.counts || {};
  const topGifts = Array.isArray(session?.topGifts) ? session.topGifts : [];
  const lines = [
    `LIVE sesija @${session?.owner || "nepoznat"}`,
    `ID: ${session?.id || "-"}`,
    `Početak: ${fmtDate(session?.startedAt)}`,
    `Završetak: ${session?.endedAt ? fmtDate(session.endedAt) : "aktivna / nije označena završenom"}`,
    `Događaji: ${fmtNum(counts.total)}`,
    `Poruke: ${fmtNum(counts.chat)}`,
    `Pokloni: ${fmtNum(counts.gifts)}`,
    `Pretplate: ${fmtNum(counts.subscribers)}`,
    `Korisnici: ${fmtNum(session?.uniqueUsers)}`,
    `Coini: ${fmtNum(counts.coins)}`,
    `Lajkovi: ${fmtNum(counts.likes)}`,
    `Gledatelji: ${fmtNum(session?.currentViewers)} | peak ${fmtNum(session?.peakViewers)}`,
  ];
  if (topGifts.length) {
    lines.push("", "Top giftovi:");
    topGifts.slice(0, 5).forEach((gift, index) => {
      lines.push(
        `${index + 1}. ${gift.giftName || "Poklon"} | qty ${fmtNum(gift.quantity)} | ${fmtNum(gift.coins)} coins`,
      );
    });
  }
  lines.push("", `Događaji: /events ${session?.id}`, `Korisnici: /users ${session?.id}`);
  return lines.join("\n");
}

function buildArchiveEventsMessage(session, data) {
  const events = Array.isArray(data?.rows) ? data.rows : [];
  if (!events.length) return `Sesija ${session.id} nema spremljenih događaja.`;
  const lines = [`Zadnji događaji @${session.owner || "nepoznat"}`, `Sesija: ${session.id}`, ""];
  events.forEach((event, index) => {
    const actor = event.userHandle ? `@${event.userHandle}` : (event.user || "-");
    const content = String(event.giftName || event.text || "-").replace(/\s+/g, " ").slice(0, 100);
    lines.push(
      `${index + 1}. ${fmtDate(event.ts)} | ${event.type || "event"} | ${actor}`,
      `   ${content}${Number(event.coins || 0) ? ` | ${fmtNum(event.coins)} coins` : ""}`,
    );
  });
  return lines.join("\n");
}

function buildArchiveUsersMessage(session, data) {
  const users = Array.isArray(data?.rows) ? data.rows : [];
  if (!users.length) return `Sesija ${session.id} nema spremljenih korisnika.`;
  const lines = [`Korisnici @${session.owner || "nepoznat"}`, `Sesija: ${session.id}`, ""];
  users.forEach((user, index) => {
    const actor = user.userHandle ? `@${user.userHandle}` : (user.user || "-");
    lines.push(
      `${index + 1}. ${actor} | coins ${fmtNum(user.coins)} | poruke ${fmtNum(user.messages)} | giftovi ${fmtNum(user.gifts)} | aktivnosti ${fmtNum(user.appearances)}`,
    );
  });
  return lines.join("\n");
}

function buildCreatorsMessage(data) {
  const creators = Array.isArray(data?.rows) ? data.rows : [];
  if (!creators.length) return "Nema kreatora sa spremljenom LIVE publikom.";
  const lines = [
    `Kreatori u LIVE bazi (${fmtNum(data.total)})`,
    "Odaberi broj ili @ime.",
    "",
  ];
  creators.forEach((creator, index) => {
    lines.push(
      `${index + 1}. @${creator.owner || "nepoznat"} | ${fmtNum(creator.viewers)} viewers`,
      `   sesije ${fmtNum(creator.sessions)} | događaji ${fmtNum(creator.events)} | coins ${fmtNum(creator.coins)} | peak ${fmtNum(creator.peakViewers)}`,
    );
  });
  lines.push(
    "",
    "Pregled: /viewers 1",
    "Svi u CSV: /viewers 1 all",
  );
  return lines.join("\n");
}

async function resolveArchiveCreator(reference) {
  const ref = String(reference || "").trim();
  const data = await callArchiveApi("/v1/archive/creators?limit=500");
  const creators = Array.isArray(data?.rows) ? data.rows : [];
  if (!creators.length) return null;
  if (/^\d+$/.test(ref)) return creators[Number(ref) - 1] || null;
  if (!ref) return null;
  const normalized = ref.toLowerCase().replace(/^@+/, "");
  return creators.find((creator) => String(creator?.owner || "").toLowerCase() === normalized)
    || creators.find((creator) => String(creator?.owner || "").toLowerCase().startsWith(normalized))
    || null;
}

function buildCreatorViewersMessage(creator, data, page) {
  const viewers = Array.isArray(data?.rows) ? data.rows : [];
  const totalPages = Math.max(1, Math.ceil(Number(data?.total || 0) / Math.max(1, Number(data?.limit || 20))));
  if (!viewers.length) return `Kreator @${creator.owner} nema viewers na stranici ${page}.`;
  const lines = [
    `Viewers kreatora @${creator.owner}`,
    `Ukupno: ${fmtNum(data.total)} | sesije kreatora: ${fmtNum(data.creatorSessions)}`,
    `Stranica ${fmtNum(page)} / ${fmtNum(totalPages)}`,
    "",
  ];
  viewers.forEach((viewer, index) => {
    const actor = viewer.userHandle ? `@${viewer.userHandle}` : (viewer.user || "-");
    lines.push(
      `${Number(data.offset || 0) + index + 1}. ${actor}`,
      `   sesije ${fmtNum(viewer.sessions)} | aktivnosti ${fmtNum(viewer.appearances)} | poruke ${fmtNum(viewer.messages)} | giftovi ${fmtNum(viewer.gifts)} | coins ${fmtNum(viewer.coins)} | likes ${fmtNum(viewer.likes)}`,
    );
  });
  if (data.hasMore) lines.push("", `Sljedeća: /viewers @${creator.owner} ${page + 1}`);
  lines.push(`Svi u CSV: /viewers @${creator.owner} all`);
  return lines.join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function buildCreatorViewersCsv(reference) {
  const creator = await resolveArchiveCreator(reference);
  if (!creator) throw new Error(`Kreator "${reference}" nije pronađen. Pošalji /viewers.`);
  const rows = await fetchCreatorViewerRows(creator.owner);
  return {
    ...createViewersCsv(rows.map((viewer) => ({ creator: creator.owner, ...viewer })), creator.owner),
    creator,
  };
}

async function fetchCreatorViewerRows(owner) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const data = await callArchiveApi(
      `/v1/archive/creators/${encodeURIComponent(owner)}/viewers?limit=1000&offset=${offset}`,
    );
    rows.push(...(Array.isArray(data.rows) ? data.rows : []));
    if (!data.hasMore || !data.rows?.length) break;
    offset += data.rows.length;
  }
  return rows;
}

function createViewersCsv(rows, label) {
  const headers = [
    "creator", "user", "userHandle", "sessions", "appearances", "messages", "gifts",
    "giftEvents", "coins", "likes", "joins", "shares", "subscribers", "userLevel",
    "badge", "firstSeenAt", "lastSeenAt", "lastMessage",
  ];
  const lines = [headers.join(",")];
  rows.forEach((viewer) => {
    lines.push(headers.map((key) => csvCell(viewer[key])).join(","));
  });
  const safeLabel = String(label || "all-creators").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
  return {
    label,
    count: rows.length,
    filename: `viewers-${safeLabel}.csv`,
    csv: `\uFEFF${lines.join("\r\n")}`,
  };
}

function rowsToCsv(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headers = Array.from(safeRows.reduce((keys, row) => {
    Object.keys(row || {}).forEach((key) => keys.add(key));
    return keys;
  }, new Set()));
  if (!headers.length) return "\uFEFF";
  return `\uFEFF${[headers.join(","), ...safeRows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\r\n")}`;
}

async function buildAllCreatorsViewersCsv() {
  const data = await callArchiveApi("/v1/archive/creators?limit=500");
  const creators = Array.isArray(data?.rows) ? data.rows : [];
  const rows = [];
  for (const creator of creators) {
    const viewers = await fetchCreatorViewerRows(creator.owner);
    viewers.forEach((viewer) => rows.push({ creator: creator.owner, ...viewer }));
  }
  return createViewersCsv(rows, "all-creators");
}

function parseUserArchiveArgs(parts) {
  const user = String(parts[1] || "").trim().replace(/^@+/, "");
  let creator = "";
  let date = "";
  let sessionId = "";
  parts.slice(2).forEach((raw) => {
    const value = String(raw || "").trim();
    if (!value) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      date = value;
      return;
    }
    if (/^stream:/i.test(value)) {
      sessionId = value.replace(/^stream:/i, "");
      return;
    }
    if (/^(?:live|session|test)-/i.test(value)) {
      sessionId = value;
      return;
    }
    if (!creator) creator = value.replace(/^@+/, "");
  });
  return { user, creator, date, sessionId };
}

async function requestUserArchive(filters) {
  const params = new URLSearchParams();
  if (filters.creator) params.set("creator", filters.creator);
  if (filters.date) params.set("date", filters.date);
  if (filters.sessionId) params.set("sessionId", filters.sessionId);
  const suffix = params.toString() ? `?${params}` : "";
  return callArchiveApi(`/v1/archive/users/${encodeURIComponent(filters.user)}${suffix}`);
}

function buildUserArchiveMessage(data) {
  const summary = data?.summary || {};
  const query = data?.query || {};
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const days = Array.isArray(data?.days) ? data.days : [];
  const creators = Array.isArray(data?.creators) ? data.creators : [];
  const latest = Array.isArray(data?.latestEvents) ? data.latestEvents : [];
  const actor = summary.userHandle ? `@${summary.userHandle}` : (summary.user || `@${query.user || "-"}`);
  const filters = [
    query.creator ? `kreator @${query.creator}` : "",
    data.date ? `datum ${data.date}` : "",
    query.sessionId ? `stream ${query.sessionId}` : "",
  ].filter(Boolean);
  const lines = [
    `Arhivski podaci korisnika ${actor}`,
    `Filter: ${filters.length ? filters.join(" | ") : "svi kreatori, dani i streamovi"}`,
    `Kreatori: ${fmtNum(summary.creators)} | streamovi: ${fmtNum(summary.sessions)}`,
    `Događaji: ${fmtNum(summary.events)} | poruke: ${fmtNum(summary.messages)}`,
    `Giftovi: ${fmtNum(summary.gifts)} | gift eventi: ${fmtNum(summary.giftEvents)} | coins: ${fmtNum(summary.coins)}`,
    `Join: ${fmtNum(summary.joins)} | share: ${fmtNum(summary.shares)} | likes: ${fmtNum(summary.likes)}`,
    `Level: ${fmtNum(summary.userLevel)}`,
    `Prvi put: ${fmtDate(summary.firstSeenAt)}`,
    `Zadnji put: ${fmtDate(summary.lastSeenAt)}`,
  ];
  if (creators.length && !query.creator) {
    lines.push("", "Po kreatorima:");
    creators.slice(0, 6).forEach((row) => {
      lines.push(`- @${row.creator || "-"} | ${fmtNum(row.sessions)} streamova | ${fmtNum(row.events)} događaja | ${fmtNum(row.coins)} coins`);
    });
  }
  if (days.length && !data.date) {
    lines.push("", "Po danima:");
    days.slice(0, 6).forEach((row) => {
      lines.push(`- ${row.day} | ${fmtNum(row.sessions)} streamova | ${fmtNum(row.events)} događaja | ${fmtNum(row.coins)} coins`);
    });
  }
  if (streams.length) {
    lines.push("", "Zadnji streamovi:");
    streams.slice(0, 5).forEach((row, index) => {
      lines.push(
        `${index + 1}. @${row.creator || "-"} | ${fmtDate(row.startedAt)} | events ${fmtNum(row.events)} | coins ${fmtNum(row.coins)}`,
        `   ${row.sessionId}`,
      );
    });
  }
  if (latest.length) {
    lines.push("", "Zadnja aktivnost:");
    latest.slice(0, 3).forEach((event) => {
      const content = String(event.giftName || event.text || event.type || "-").replace(/\s+/g, " ").slice(0, 90);
      lines.push(`- ${fmtDate(event.ts)} | @${event.creator || "-"} | ${event.type}: ${content}`);
    });
  }
  return lines.join("\n");
}

function buildUserStreamsMessage(data) {
  const summary = data?.summary || {};
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const actor = summary.userHandle ? `@${summary.userHandle}` : (summary.user || `@${data?.query?.user || "-"}`);
  if (!streams.length) return `${actor} nema streamova za zadani filter.`;
  const lines = [
    `Streamovi korisnika ${actor}`,
    `Ukupno pronađeno: ${fmtNum(summary.sessions)}`,
    "",
  ];
  streams.slice(0, 20).forEach((row, index) => {
    lines.push(
      `${index + 1}. @${row.creator || "-"} | ${fmtDate(row.startedAt)}`,
      `   events ${fmtNum(row.events)} | poruke ${fmtNum(row.messages)} | giftovi ${fmtNum(row.gifts)} | coins ${fmtNum(row.coins)}`,
      `   ID: ${row.sessionId}`,
    );
  });
  return lines.join("\n");
}

function localDay(date = new Date()) {
  const value = new Date(date);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function reportRange(period, explicitDay = "") {
  const base = explicitDay && /^\d{4}-\d{2}-\d{2}$/.test(explicitDay)
    ? new Date(`${explicitDay}T12:00:00`)
    : new Date();
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1);
  let start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (period === "weekly") start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 6);
  if (period === "monthly") start = new Date(base.getFullYear(), base.getMonth(), 1);
  return { from: localDay(start), to: localDay(new Date(end.getTime() - 86400000)) };
}

async function requestArchiveReport(options = {}) {
  const params = new URLSearchParams();
  if (options.creator) params.set("creator", String(options.creator).replace(/^@+/, ""));
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  return callArchiveApi(`/v1/archive/reports?${params}`);
}

function buildReportMessage(title, data) {
  const report = data?.report || data || {};
  const summary = report.summary || {};
  const topUsers = Array.isArray(report.topUsers) ? report.topUsers : [];
  const topGifts = Array.isArray(report.topGifts) ? report.topGifts : [];
  const best = Array.isArray(report.streams) ? report.streams[0] : null;
  const lines = [
    title,
    `Period: ${report.query?.fromTs ? fmtDate(report.query.fromTs) : "početak"} — ${report.query?.toTs ? fmtDate(report.query.toTs - 1) : "sada"}`,
    `Kreator: ${report.query?.creator ? `@${report.query.creator}` : "svi"}`,
    `Streamovi: ${fmtNum(summary.sessions)} | korisnici: ${fmtNum(summary.users)}`,
    `Događaji: ${fmtNum(summary.events)} | poruke: ${fmtNum(summary.messages)}`,
    `Giftovi: ${fmtNum(summary.gifts)} | coins: ${fmtNum(summary.coins)}`,
    `Join: ${fmtNum(summary.joins)} | share: ${fmtNum(summary.shares)} | likes: ${fmtNum(summary.likes)}`,
    `Peak viewers: ${fmtNum(summary.peakViewers)}`,
  ];
  if (best) {
    lines.push("", `Najaktivniji stream: @${best.creator || "-"} | ${fmtDate(best.startedAt)} | ${fmtNum(best.events)} događaja | ${fmtNum(best.coins)} coins`);
  }
  if (topUsers.length) {
    lines.push("", "Top korisnici:");
    topUsers.slice(0, 5).forEach((row, index) => {
      lines.push(`${index + 1}. ${row.userHandle ? `@${row.userHandle}` : row.user || "-"} | ${fmtNum(row.events)} aktivnosti | ${fmtNum(row.coins)} coins`);
    });
  }
  if (topGifts.length) {
    lines.push("", "Top giftovi:");
    topGifts.slice(0, 5).forEach((row, index) => {
      lines.push(`${index + 1}. ${row.giftName || "gift"} | qty ${fmtNum(row.quantity)} | ${fmtNum(row.coins)} coins`);
    });
  }
  return lines.join("\n");
}

async function buildCreatorProfile(reference) {
  const creator = await resolveArchiveCreator(reference);
  if (!creator) return `Kreator "${reference}" nije pronađen.`;
  const [reportData, audienceData] = await Promise.all([
    requestArchiveReport({ creator: creator.owner }),
    callArchiveApi(`/v1/archive/creators/${encodeURIComponent(creator.owner)}/audience`),
  ]);
  const summary = reportData.report?.summary || {};
  const audience = audienceData.audience || {};
  return [
    `Profil kreatora @${creator.owner}`,
    `Streamovi: ${fmtNum(creator.sessions)}`,
    `Viewers/aktivni računi: ${fmtNum(creator.viewers)}`,
    `Događaji: ${fmtNum(summary.events)} | poruke ${fmtNum(summary.messages)}`,
    `Giftovi: ${fmtNum(summary.gifts)} | coins ${fmtNum(summary.coins)}`,
    `Peak viewers: ${fmtNum(summary.peakViewers)}`,
    `Novi: ${fmtNum(audience.counts?.new)} | povratni: ${fmtNum(audience.counts?.returning)}`,
    `Lojalni: ${fmtNum(audience.counts?.loyal)} | whales: ${fmtNum(audience.counts?.whales)}`,
    `Zadnja aktivnost: ${fmtDate(creator.lastActivityAt)}`,
    "",
    `Streamovi: /creatorstreams @${creator.owner}`,
    `Publika: /viewers @${creator.owner}`,
    `Retention: /retention @${creator.owner}`,
  ].join("\n");
}

function buildAudienceSegmentMessage(title, audience, key) {
  const rows = Array.isArray(audience?.[key]) ? audience[key] : [];
  const lines = [
    `${title} @${audience.creator || "-"}`,
    `Ukupna publika: ${fmtNum(audience.total)} | rezultat: ${fmtNum(audience.counts?.[key === "newUsers" ? "new" : key])}`,
    "",
  ];
  rows.slice(0, 25).forEach((row, index) => {
    const actor = row.userHandle ? `@${row.userHandle}` : (row.user || "-");
    lines.push(`${index + 1}. ${actor} | sesije ${fmtNum(row.sessions)} | aktivnosti ${fmtNum(row.appearances)} | coins ${fmtNum(row.coins)} | zadnje ${fmtDate(row.lastSeenAt)}`);
  });
  if (!rows.length) lines.push("Nema korisnika u ovom segmentu.");
  return lines.join("\n");
}

function buildCreatorStreamsMessage(creator, report, mode = "all") {
  let streams = Array.isArray(report?.streams) ? [...report.streams] : [];
  if (mode === "worst") streams.sort((a, b) => a.events - b.events || a.coins - b.coins);
  if (mode === "best") streams = streams.slice(0, 1);
  if (mode === "worst") streams = streams.slice(0, 1);
  const lines = [`Streamovi @${creator.owner}`, ""];
  streams.slice(0, 20).forEach((row, index) => {
    lines.push(
      `${index + 1}. ${fmtDate(row.startedAt)} | events ${fmtNum(row.events)} | users ${fmtNum(row.users)} | coins ${fmtNum(row.coins)} | peak ${fmtNum(row.peakViewers)}`,
      `   ${row.sessionId}`,
    );
  });
  if (!streams.length) lines.push("Nema streamova.");
  return lines.join("\n");
}

function buildGrowthMessage(creator, report) {
  const daily = Array.isArray(report?.daily) ? report.daily : [];
  const lines = [`Rast @${creator.owner}`, ""];
  daily.slice(-31).forEach((row) => {
    lines.push(`${row.day} | users ${fmtNum(row.users)} | events ${fmtNum(row.events)} | coins ${fmtNum(row.coins)}`);
  });
  return lines.join("\n");
}

function buildBestTimeMessage(creator, report) {
  const hourly = Array.isArray(report?.hourly) ? report.hourly : [];
  const lines = [`Najbolje vrijeme za @${creator.owner}`, ""];
  hourly.slice(0, 8).forEach((row, index) => {
    lines.push(`${index + 1}. ${String(row.hour).padStart(2, "0")}:00 | users ${fmtNum(row.users)} | events ${fmtNum(row.events)} | coins ${fmtNum(row.coins)}`);
  });
  return lines.join("\n");
}

function buildGiftArchiveMessage(report, mode = "gifts") {
  const gifts = Array.isArray(report?.topGifts) ? report.topGifts : [];
  const users = Array.isArray(report?.topUsers) ? report.topUsers.filter((row) => row.gifts > 0 || row.coins > 0) : [];
  const lines = [mode === "gifters" ? "Top gifteri iz arhive" : "Giftovi iz arhive", ""];
  if (mode === "gifters") {
    users.slice(0, 25).forEach((row, index) => {
      lines.push(`${index + 1}. ${row.userHandle ? `@${row.userHandle}` : row.user || "-"} | giftovi ${fmtNum(row.gifts)} | coins ${fmtNum(row.coins)} | streamovi ${fmtNum(row.sessions)}`);
    });
  } else {
    gifts.slice(0, 25).forEach((row, index) => {
      lines.push(`${index + 1}. ${row.giftName || "gift"} | qty ${fmtNum(row.quantity)} | events ${fmtNum(row.events)} | coins ${fmtNum(row.coins)} | users ${fmtNum(row.users)}`);
    });
  }
  if ((mode === "gifters" ? users : gifts).length === 0) lines.push("Nema gift podataka.");
  return lines.join("\n");
}

function buildSearchMessage(title, data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const lines = [title, `Rezultati: ${fmtNum(data.total)}`, ""];
  rows.slice(0, 30).forEach((event, index) => {
    const actor = event.userHandle ? `@${event.userHandle}` : (event.user || "-");
    const content = String(event.giftName || event.text || "-").replace(/\s+/g, " ").slice(0, 120);
    lines.push(`${index + 1}. ${fmtDate(event.ts)} | @${event.creator || "-"} | ${actor} | ${event.type}: ${content}`);
  });
  if (!rows.length) lines.push("Nema rezultata.");
  return lines.join("\n");
}

const STOP_WORDS = new Set([
  "the", "and", "for", "this", "that", "you", "your", "with", "from", "have",
  "sam", "samo", "kako", "koji", "koja", "što", "sta", "ovo", "nije", "jesi",
  "onda", "biti", "ima", "hvala", "live", "chat", "user", "https",
]);

function extractKeywords(events, limit = 15) {
  const counts = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    String(event?.text || "").toLocaleLowerCase("hr-HR")
      .replace(/[^\p{L}\p{N}@#]+/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
      .forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  });
  return Array.from(counts, ([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

function simpleSentiment(text) {
  const normalized = String(text || "").toLocaleLowerCase("hr-HR");
  const positive = ["bravo", "super", "odlično", "odlicno", "hvala", "volim", "top", "love", "great", "❤️", "🔥", "👏"];
  const negative = ["loše", "lose", "užas", "uzas", "mrzim", "glupo", "prevara", "hate", "bad", "scam", "👎", "😡"];
  const pos = positive.reduce((sum, value) => sum + (normalized.includes(value) ? 1 : 0), 0);
  const neg = negative.reduce((sum, value) => sum + (normalized.includes(value) ? 1 : 0), 0);
  return pos > neg ? "positive" : (neg > pos ? "negative" : "neutral");
}

function analyzeSentiment(events) {
  const result = { positive: 0, neutral: 0, negative: 0 };
  (Array.isArray(events) ? events : []).forEach((event) => {
    result[simpleSentiment(event?.text)] += 1;
  });
  return result;
}

function buildDeterministicSummary(report, title = "LIVE sažetak") {
  const summary = report?.summary || {};
  const topUser = report?.topUsers?.[0];
  const topGift = report?.topGifts?.[0];
  const bestHour = report?.hourly?.[0];
  const messagesPerSession = Number(summary.sessions || 0)
    ? Math.round(Number(summary.messages || 0) / Number(summary.sessions || 1))
    : 0;
  return [
    title,
    `Analizirano je ${fmtNum(summary.sessions)} streamova i ${fmtNum(summary.events)} događaja.`,
    `Publika: ${fmtNum(summary.users)} aktivnih računa; prosječno ${fmtNum(messagesPerSession)} poruka po streamu.`,
    `Monetizacija: ${fmtNum(summary.gifts)} giftova i ${fmtNum(summary.coins)} coins.`,
    topUser ? `Najvrjedniji korisnik: ${topUser.userHandle ? `@${topUser.userHandle}` : topUser.user || "-"} (${fmtNum(topUser.coins)} coins).` : "",
    topGift ? `Najuspješniji gift: ${topGift.giftName || "gift"} (${fmtNum(topGift.coins)} coins).` : "",
    bestHour ? `Najaktivniji sat: ${String(bestHour.hour).padStart(2, "0")}:00.` : "",
    Number(summary.messages || 0) === 0 ? "Preporuka: provjeriti chat skeniranje jer nema poruka." : "",
    Number(summary.users || 0) > 0 && Number(summary.gifts || 0) === 0 ? "Preporuka: dodati jasniji gift/CTA trenutak tijekom LIVE-a." : "",
  ].filter(Boolean).join("\n");
}

function buildReportSvg(title, daily) {
  const rows = Array.isArray(daily) ? daily.slice(-31) : [];
  const width = 1000;
  const height = 520;
  const pad = 70;
  const max = Math.max(1, ...rows.map((row) => Number(row.events || 0)));
  const points = rows.map((row, index) => {
    const x = pad + (index / Math.max(1, rows.length - 1)) * (width - pad * 2);
    const y = height - pad - (Number(row.events || 0) / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const safeTitle = String(title || "EtherX LIVE").replace(/[&<>"]/g, (value) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[value]));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#07111f"/>
<text x="${pad}" y="45" fill="#eef6ff" font-family="sans-serif" font-size="26">${safeTitle}</text>
<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#35506c"/>
<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#35506c"/>
<polyline fill="none" stroke="#45e1d0" stroke-width="5" points="${points}"/>
<text x="${pad}" y="${height - 25}" fill="#91a7bd" font-family="sans-serif" font-size="18">Događaji po danu · ${rows.length} dana</text>
</svg>`;
}

async function handleCommand(text) {
  const parts = tokenizeCommand(text);
  const command = String(parts[0] || "").toLowerCase().split("@")[0];
  const maybeLimit = Math.max(1, Math.min(20, Number(parts[1] || 10) || 10));
  if (command === "/start" || command === "/menu") {
    return [
      "EtherX LIVE — Sesije i statistike",
      "Odaberi sekciju na gumbima ispod ili pošalji /help za sve naredbe.",
      archiveApiReady() ? "Serverska baza: spojena" : "Serverska baza: token nedostaje",
      controlApiReady() ? "Desktop skeniranje: dostupno" : "Desktop skeniranje: ovaj server nema lokalnu vezu",
    ].join("\n");
  }
  if (command === "/help") {
    return [
      "EtherX LIVE Telegram centar",
      "",
      "Kreatori: /creators · /creator @ime · /creatorstreams @ime · /creatorgrowth @ime · /besttime @ime",
      "Publika: /viewers [@ime] · /newviewers @ime · /returning @ime · /loyal @ime · /inactive @ime [dani] · /whales @ime [coins] · /crossviewers @a @b",
      "Sesije: /sessions · /session ID · /events ID · /users ID · /report ID · /compare ID1 ID2",
      "Korisnik: /userdata @user [@kreator] [datum|stream:ID] · /userstreams · /watchuser · /unwatchuser · /watchlist · /forgetuser",
      "Izvještaji: /daily [@kreator] [datum] · /weekly [@kreator] · /monthly [@kreator] · /summary [@kreator] · /recommend [@kreator]",
      "Analitika: /gifts [@kreator] · /gifters [@kreator] · /search [@kreator] pojam · /questions [@kreator] · /keywords [@kreator] · /sentiment [@kreator]",
      "Izvoz: /viewers @kreator all · /viewers all · /export creator @ime · /export user @ime · /export stream ID · /chart growth @ime",
      "Server: /serverstatus · /dbstatus · /backupstatus · /backup · /scanstatus · /startscan · /stopscan",
      "Alarmi: /notify ... (desktop) · /alert status|gift 500|viewer 500|whale 10000|keyword riječ|daily on",
      "",
      controlApiReady()
        ? `Desktop Control API: OK | ${DEFAULT_API_URL}`
        : "Control API token: MISSING",
      archiveApiReady()
        ? `Serverska LIVE baza: OK | ${ARCHIVE_API_URL}`
        : "Serverska LIVE baza: MISSING TOKEN",
    ].join("\n");
  }
  if (command === "/creators") {
    return buildCreatorsMessage(await callArchiveApi("/v1/archive/creators?limit=50"));
  }
  if (command === "/creator") {
    if (!parts[1]) return "Primjer: /creator @kreator";
    return buildCreatorProfile(parts[1]);
  }
  if (["/creatorstreams", "/creatorgrowth", "/beststream", "/worststream", "/besttime", "/retention"].includes(command)) {
    if (!parts[1]) return `Primjer: ${command} @kreator`;
    const creator = await resolveArchiveCreator(parts[1]);
    if (!creator) return `Kreator "${parts[1]}" nije pronađen.`;
    const report = (await requestArchiveReport({ creator: creator.owner })).report;
    if (command === "/creatorstreams") return buildCreatorStreamsMessage(creator, report);
    if (command === "/creatorgrowth") return buildGrowthMessage(creator, report);
    if (command === "/beststream") return buildCreatorStreamsMessage(creator, report, "best");
    if (command === "/worststream") return buildCreatorStreamsMessage(creator, report, "worst");
    if (command === "/besttime") return buildBestTimeMessage(creator, report);
    const audience = (await callArchiveApi(`/v1/archive/creators/${encodeURIComponent(creator.owner)}/audience`)).audience;
    return [
      `Retention @${creator.owner}`,
      `Ukupna publika: ${fmtNum(audience.total)}`,
      `Povratni: ${fmtNum(audience.counts?.returning)} | lojalni: ${fmtNum(audience.counts?.loyal)}`,
      `Stopa povratka: ${audience.total ? Math.round((Number(audience.counts?.returning || 0) / audience.total) * 100) : 0}%`,
    ].join("\n");
  }
  if (["/newviewers", "/returning", "/loyal", "/inactive", "/whales"].includes(command)) {
    if (!parts[1]) return `Primjer: ${command} @kreator`;
    const creator = await resolveArchiveCreator(parts[1]);
    if (!creator) return `Kreator "${parts[1]}" nije pronađen.`;
    const params = new URLSearchParams();
    if (command === "/inactive" && parts[2]) params.set("inactiveDays", parts[2]);
    if (command === "/whales" && parts[2]) params.set("whaleCoins", parts[2]);
    const suffix = params.toString() ? `?${params}` : "";
    const audience = (await callArchiveApi(`/v1/archive/creators/${encodeURIComponent(creator.owner)}/audience${suffix}`)).audience;
    const map = {
      "/newviewers": ["Novi/jednokratni viewers", "newUsers"],
      "/returning": ["Povratni viewers", "returning"],
      "/loyal": ["Lojalni viewers", "loyal"],
      "/inactive": ["Neaktivni viewers", "inactive"],
      "/whales": ["Whale viewers", "whales"],
    };
    return buildAudienceSegmentMessage(map[command][0], audience, map[command][1]);
  }
  if (command === "/crossviewers" || command === "/audiencecompare") {
    if (!parts[1] || !parts[2]) return `Primjer: ${command} @kreator1 @kreator2`;
    const data = await callArchiveApi(`/v1/archive/audience/compare?first=${encodeURIComponent(parts[1].replace(/^@+/, ""))}&second=${encodeURIComponent(parts[2].replace(/^@+/, ""))}`);
    const row = data.comparison || {};
    return [
      `Usporedba publike @${row.first || parts[1]} ↔ @${row.second || parts[2]}`,
      `Prvi: ${fmtNum(row.firstUsers)} | drugi: ${fmtNum(row.secondUsers)}`,
      `Zajednički viewers: ${fmtNum(row.sharedUsers)}`,
      `Preklapanje: ${Number(row.overlapPercent || 0).toFixed(1)}%`,
      ...(row.shared || []).slice(0, 15).map((user, index) => `${index + 1}. ${user.userHandle ? `@${user.userHandle}` : user.user || "-"}`),
    ].join("\n");
  }
  if (["/daily", "/weekly", "/monthly"].includes(command)) {
    const creatorArg = parts.find((part, index) => index > 0 && String(part).startsWith("@")) || "";
    const dayArg = parts.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) || "";
    const range = reportRange(command.slice(1), dayArg);
    const report = await requestArchiveReport({ creator: creatorArg, ...range });
    return buildReportMessage(`${command === "/daily" ? "Dnevni" : command === "/weekly" ? "Tjedni" : "Mjesečni"} LIVE izvještaj`, report);
  }
  if (["/gifts", "/giftstatsarchive"].includes(command)) {
    const report = (await requestArchiveReport({ creator: parts[1] || "" })).report;
    return buildGiftArchiveMessage(report, "gifts");
  }
  if (command === "/gifters" && parts[1] && !/^\d+$/.test(parts[1])) {
    const report = (await requestArchiveReport({ creator: parts[1] })).report;
    return buildGiftArchiveMessage(report, "gifters");
  }
  if (command === "/status") {
    return buildStatusMessage(await callControlApi(`/api/tkai/status?limit=${maybeLimit}`));
  }
  if (command === "/viewer") {
    return buildViewerMessage(await callControlApi("/api/tkai/session"));
  }
  if (command === "/giftstats") {
    return buildGiftStatsMessage(await callControlApi("/api/tkai/session"));
  }
  if (command === "/gifters") {
    return buildGiftersMessage(await callControlApi(`/api/tkai/gifters?limit=${maybeLimit}`));
  }
  if (command === "/user") {
    const userArg = parts[1] || "";
    if (!normalizeUserArg(userArg)) return "Pošalji npr. /user @korisnik";
    return buildUserMessage(await callControlApi("/api/tkai/session"), userArg);
  }
  if (command === "/alerts") {
    return buildAlertsMessage(await callControlApi("/api/tkai/session"));
  }
  if (command === "/notify") {
    const sub = String(parts[1] || "status").toLowerCase();
    if (sub === "status") return buildNotifyStatusMessage();
    if (sub === "on") {
      notifyState.enabled = true;
      if (!notifyState.chatId) notifyState.chatId = ALLOWED_CHAT_ID || "";
      saveNotifyState();
      startNotifyMonitor();
      return buildNotifyStatusMessage();
    }
    if (sub === "off") {
      notifyState.enabled = false;
      saveNotifyState();
      return buildNotifyStatusMessage();
    }
    if (sub === "viewer") {
      notifyState.viewerThreshold = Math.max(0, Number(parts[2] || 0) || 0);
      saveNotifyState();
      startNotifyMonitor();
      return buildNotifyStatusMessage();
    }
    if (sub === "gift") {
      const raw = String(parts[2] || "").toLowerCase();
      if (raw === "on") {
        notifyState.giftEnabled = true;
        if (!notifyState.giftCoinsMin || notifyState.giftCoinsMin < 1) notifyState.giftCoinsMin = 500;
      } else if (raw === "off") {
        notifyState.giftEnabled = false;
      } else {
        notifyState.giftEnabled = true;
        notifyState.giftCoinsMin = Math.max(1, Number(parts[2] || 500) || 500);
      }
      saveNotifyState();
      startNotifyMonitor();
      return buildNotifyStatusMessage();
    }
    if (sub === "whale") {
      notifyState.whaleCoins = Math.max(0, Number(parts[2] || 0) || 0);
      saveNotifyState();
      startNotifyMonitor();
      return buildNotifyStatusMessage();
    }
    if (sub === "spike") {
      notifyState.spikeThreshold = Math.max(1, Number(parts[2] || 1) || 1);
      saveNotifyState();
      startNotifyMonitor();
      return buildNotifyStatusMessage();
    }
    if (sub === "watch") {
      const user = normalizeUserArg(parts[2] || "");
      if (!user) return "Pošalji npr. /notify watch @ime";
      notifyState.watchUsers = Array.from(new Set([user, ...notifyState.watchUsers])).slice(0, 50);
      saveNotifyState();
      startNotifyMonitor();
      return buildNotifyStatusMessage();
    }
    if (sub === "unwatch") {
      const user = normalizeUserArg(parts[2] || "");
      if (!user) return "Pošalji npr. /notify unwatch @ime";
      notifyState.watchUsers = notifyState.watchUsers.filter((row) => row !== user);
      saveNotifyState();
      return buildNotifyStatusMessage();
    }
    return "Notify komande: /notify on|off|status|gift on|gift off|gift 500|viewer 500|whale 10000|spike 150|watch @ime|unwatch @ime";
  }
  if (command === "/session") {
    if (parts[1]) {
      const session = await resolveArchiveSession(parts[1]);
      if (!session) return `Spremljena sesija "${parts[1]}" nije pronađena. Pošalji /sessions.`;
      const data = await callArchiveApi(`/v1/archive/sessions/${encodeURIComponent(session.id)}`);
      return buildArchiveSessionMessage(data.session);
    }
    const data = await callControlApi("/api/tkai/status?limit=5");
    return buildStatusMessage(data);
  }
  if (command === "/sessions") {
    const limit = Math.max(1, Math.min(15, Number(parts[1] || 8) || 8));
    return buildArchiveSessionsMessage(
      await callArchiveApi(`/v1/archive/sessions?limit=${limit}`),
    );
  }
  if (command === "/events" || command === "/users") {
    const reference = parts[1] || "1";
    const limit = Math.max(1, Math.min(command === "/events" ? 20 : 25, Number(parts[2] || 10) || 10));
    const session = await resolveArchiveSession(reference);
    if (!session) return `Spremljena sesija "${reference}" nije pronađena. Pošalji /sessions.`;
    const resource = command.slice(1);
    const data = await callArchiveApi(
      `/v1/archive/sessions/${encodeURIComponent(session.id)}/${resource}?limit=${limit}`,
    );
    return command === "/events"
      ? buildArchiveEventsMessage(session, data)
      : buildArchiveUsersMessage(session, data);
  }
  if (command === "/viewers" || command === "/viweres") {
    if (!parts[1]) {
      return buildCreatorsMessage(await callArchiveApi("/v1/archive/creators?limit=30"));
    }
    if (
      String(parts[1] || "").toLowerCase() === "all"
      || String(parts[2] || "").toLowerCase() === "all"
    ) {
      return "CSV izvoz se šalje kao Telegram dokument…";
    }
    const creator = await resolveArchiveCreator(parts[1]);
    if (!creator) return `Kreator "${parts[1]}" nije pronađen. Pošalji /viewers.`;
    const page = Math.max(1, Number(parts[2] || 1) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const data = await callArchiveApi(
      `/v1/archive/creators/${encodeURIComponent(creator.owner)}/viewers?limit=${limit}&offset=${offset}`,
    );
    return buildCreatorViewersMessage(creator, data, page);
  }
  if (command === "/userdata" || command === "/userstreams") {
    const filters = parseUserArchiveArgs(parts);
    if (!filters.user) {
      return command === "/userdata"
        ? "Primjer: /userdata @user @kreator 2026-07-28 ili /userdata @user stream:live-123"
        : "Primjer: /userstreams @user @kreator";
    }
    const data = await requestUserArchive(filters);
    return command === "/userdata"
      ? buildUserArchiveMessage(data)
      : buildUserStreamsMessage(data);
  }
  if (command === "/watchuser" || command === "/unwatchuser") {
    const user = normalizeUserArg(parts[1]);
    if (!user) return `Primjer: ${command} @korisnik`;
    const data = await callArchiveAdminApi("/v1/archive/admin/watch-users", {
      body: { user, enabled: command === "/watchuser" },
    });
    return `${command === "/watchuser" ? "Praćenje uključeno" : "Praćenje isključeno"} za @${user}.\nWatchlista: ${fmtNum(data.users?.length)}`;
  }
  if (command === "/watchlist") {
    const data = await callArchiveApi("/v1/archive/watch-users");
    const rows = Array.isArray(data.rows) ? data.rows : [];
    return rows.length
      ? ["Praćeni korisnici:", ...rows.map((row, index) => `${index + 1}. @${row.userKey}`)].join("\n")
      : "Watchlista je prazna.";
  }
  if (command === "/forgetuser") {
    const user = normalizeUserArg(parts[1]);
    if (!user) return "Primjer: /forgetuser @korisnik";
    const token = crypto.randomBytes(12).toString("hex");
    pendingForgetActions.set(token, { user, expiresAt: Date.now() + 10 * 60 * 1000 });
    return `PAŽNJA: trajno brisanje svih arhivskih podataka za @${user}.\nPrije brisanja server automatski radi backup.\nPotvrda vrijedi 10 minuta.\n/confirmforget ${token}\n/cancelforget ${token}`;
  }
  if (command === "/confirmforget" || command === "/cancelforget") {
    const token = String(parts[1] || "");
    const pending = pendingForgetActions.get(token);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingForgetActions.delete(token);
      return "Potvrda nije pronađena ili je istekla.";
    }
    pendingForgetActions.delete(token);
    if (command === "/cancelforget") return `Brisanje @${pending.user} je otkazano.`;
    const data = await callArchiveAdminApi("/v1/archive/admin/delete-user", {
      body: { user: pending.user },
    });
    return `Podaci za @${pending.user} su obrisani.\nBackup: ${data.backup?.filename || "izrađen"}\nDogađaji: ${fmtNum(data.result?.events)} | zapisi korisnika: ${fmtNum(data.result?.users)}`;
  }
  if (command === "/report") {
    if (!parts[1]) return "Primjer: /report SESSION_ID";
    const session = await resolveArchiveSession(parts[1]);
    if (!session) return `Sesija "${parts[1]}" nije pronađena.`;
    return buildArchiveSessionMessage(
      (await callArchiveApi(`/v1/archive/sessions/${encodeURIComponent(session.id)}`)).session,
    );
  }
  if (command === "/compare") {
    if (!parts[1] || !parts[2]) return "Primjer: /compare SESSION1 SESSION2";
    const [first, second] = await Promise.all([
      resolveArchiveSession(parts[1]),
      resolveArchiveSession(parts[2]),
    ]);
    if (!first || !second) return "Jedna od zadanih sesija nije pronađena.";
    const metric = (key) => Number(second[key] || 0) - Number(first[key] || 0);
    const signed = (value) => `${value >= 0 ? "+" : ""}${fmtNum(value)}`;
    return [
      `Usporedba streamova`,
      `A: @${first.owner || "-"} · ${fmtDate(first.startedAt)} · ${first.id}`,
      `B: @${second.owner || "-"} · ${fmtDate(second.startedAt)} · ${second.id}`,
      `Događaji: ${fmtNum(first.eventCount)} → ${fmtNum(second.eventCount)} (${signed(metric("eventCount"))})`,
      `Korisnici: ${fmtNum(first.uniqueUsers)} → ${fmtNum(second.uniqueUsers)} (${signed(metric("uniqueUsers"))})`,
      `Coins: ${fmtNum(first.coins)} → ${fmtNum(second.coins)} (${signed(metric("coins"))})`,
      `Peak: ${fmtNum(first.peakViewers)} → ${fmtNum(second.peakViewers)} (${signed(metric("peakViewers"))})`,
    ].join("\n");
  }
  if (["/search", "/questions", "/keywords", "/sentiment"].includes(command)) {
    const creatorArg = parts.find((part, index) => index > 0 && String(part).startsWith("@")) || "";
    const queryParts = parts.slice(1).filter((part) => part !== creatorArg);
    const params = new URLSearchParams({ limit: command === "/search" ? "50" : "500" });
    if (creatorArg) params.set("creator", creatorArg.replace(/^@+/, ""));
    if (command === "/search") {
      if (!queryParts.length) return "Primjer: /search @kreator bitcoin";
      params.set("q", queryParts.join(" "));
    }
    if (command === "/questions") params.set("q", "?");
    const data = await callArchiveApi(`/v1/archive/search?${params}`);
    if (command === "/search") return buildSearchMessage(`Pretraga: ${queryParts.join(" ")}`, data);
    if (command === "/questions") return buildSearchMessage("Pitanja publike", data);
    if (command === "/keywords") {
      const keywords = extractKeywords(data.rows);
      return ["Ključne riječi", ...keywords.map((row, index) => `${index + 1}. ${row.word} — ${fmtNum(row.count)}`)].join("\n");
    }
    const sentiment = analyzeSentiment(data.rows);
    const total = sentiment.positive + sentiment.neutral + sentiment.negative;
    return [
      "Procjena sentimenta (pravila, nije AI model)",
      `Pozitivno: ${fmtNum(sentiment.positive)} (${total ? Math.round(sentiment.positive / total * 100) : 0}%)`,
      `Neutralno: ${fmtNum(sentiment.neutral)} (${total ? Math.round(sentiment.neutral / total * 100) : 0}%)`,
      `Negativno: ${fmtNum(sentiment.negative)} (${total ? Math.round(sentiment.negative / total * 100) : 0}%)`,
    ].join("\n");
  }
  if (["/summary", "/highlights", "/recommend", "/topics", "/ask"].includes(command)) {
    const creator = parts.find((part, index) => index > 0 && String(part).startsWith("@")) || "";
    const report = (await requestArchiveReport({ creator })).report;
    if (command === "/topics") {
      const params = new URLSearchParams({ limit: "500" });
      if (creator) params.set("creator", creator.replace(/^@+/, ""));
      const events = (await callArchiveApi(`/v1/archive/search?${params}`)).rows;
      return ["Najčešće teme", ...extractKeywords(events, 20).map((row, index) => `${index + 1}. ${row.word} — ${row.count}`)].join("\n");
    }
    return buildDeterministicSummary(
      report,
      command === "/recommend" ? "Preporuke za sljedeći LIVE" : command === "/highlights" ? "LIVE highlights" : "LIVE sažetak",
    );
  }
  if (command === "/serverstatus" || command === "/dbstatus" || command === "/lastsync") {
    const [status, overview] = await Promise.all([
      callArchiveApi("/v1/archive/status"),
      callArchiveApi("/v1/archive/overview"),
    ]);
    return [
      "EtherX LIVE server",
      `Arhiva: ${status.ok ? "OK" : "GREŠKA"} | schema v${status.schemaVersion || "-"}`,
      `Sesije: ${fmtNum(overview.overview?.sessions)} | događaji: ${fmtNum(overview.overview?.events)} | korisnici: ${fmtNum(overview.overview?.users)}`,
      `Zadnja aktivnost: ${fmtDate(overview.overview?.lastActivityAt)}`,
      `Webhook obrada: aktivna na serveru`,
    ].join("\n");
  }
  if (command === "/backupstatus") {
    const data = await callArchiveApi("/v1/archive/admin/backup-status");
    return [
      "Backup status",
      `Broj kopija: ${fmtNum(data.backup?.count)}`,
      `Zadnja kopija: ${fmtDate(data.backup?.latestAt)}`,
      `Veličina: ${fmtNum(data.backup?.latestSize)} B`,
    ].join("\n");
  }
  if (command === "/backup") {
    const data = await callArchiveAdminApi("/v1/archive/admin/backup", { body: {} });
    return `Backup baze je izrađen.\nDatoteka: ${data.backup?.filename || "-"}\nVeličina: ${fmtNum(data.backup?.size)} B`;
  }
  if (command === "/scanstatus") {
    if (controlApiReady()) return buildStatusMessage(await callControlApi("/api/tkai/status?limit=5"));
    const overview = await callArchiveApi("/v1/archive/overview");
    return `Serverska arhiva radi i prima podatke.\nZadnji zapis: ${fmtDate(overview.overview?.lastActivityAt)}\nDesktop skeniranje se pokreće iz lokalnog browsera; server nema pristup gumbu ako desktop Control API nije spojen.`;
  }
  if (command === "/alert") {
    const current = (await callArchiveApi("/v1/archive/settings/alerts")).value || {};
    const sub = String(parts[1] || "status").toLowerCase();
    if (sub === "status") return `Serverski alarmi\n${JSON.stringify(current, null, 2).slice(0, 3000)}`;
    const next = { ...current };
    if (["gift", "viewer", "whale", "noevents"].includes(sub)) next[sub] = Math.max(0, Number(parts[2] || 0) || 0);
    else if (sub === "keyword") next.keyword = parts.slice(2).join(" ").slice(0, 100);
    else if (sub === "daily" || sub === "weekly") next[sub] = String(parts[2] || "on").toLowerCase() !== "off";
    else return "Primjer: /alert gift 500 | viewer 500 | whale 10000 | keyword bitcoin | daily on";
    await callArchiveAdminApi("/v1/archive/admin/settings/alerts", { body: { value: next } });
    return `Alarm "${sub}" je spremljen.\n/alert status`;
  }
  if (command === "/db") {
    if (archiveApiReady()) {
      return buildArchiveOverviewMessage(await callArchiveApi("/v1/archive/overview"));
    }
    return buildDatabaseMessage(await callControlApi(`/api/tkai/database?limit=${maybeLimit}`));
  }
  if (command === "/startscan") {
    await callControlApi("/api/tkai/command", { method: "POST", body: { action: "start-scan" } });
    return "Poslana naredba: start-scan";
  }
  if (command === "/stopscan") {
    await callControlApi("/api/tkai/command", { method: "POST", body: { action: "stop-scan" } });
    return "Poslana naredba: stop-scan";
  }
  if (command === "/openai") {
    await callControlApi("/api/tkai/command", { method: "POST", body: { action: "open-ai-live-chat" } });
    return "Poslana naredba: open-ai-live-chat";
  }
  return "Nepoznata komanda. Pošalji /help";
}

async function runNotifyCheck() {
  notifyState = loadNotifyState();
  if (!notifyState.enabled || !notifyState.chatId || !controlApiReady()) return;
  try {
    const data = await callControlApi("/api/tkai/session");
    const snapshot = getSessionSnapshot(data);
    const session = snapshot?.session || {};
    const alerts = Array.isArray(snapshot?.alerts) ? snapshot.alerts : [];
    const spikes = Array.isArray(snapshot?.analytics?.spikes) ? snapshot.analytics.spikes : [];
    const gifts = Array.isArray(snapshot?.giftLedger) ? snapshot.giftLedger : [];
    const users = Array.isArray(snapshot?.users) ? snapshot.users : [];
    const sessionId = String(session.id || "");
    if (sessionId && notifyState.last.sessionId !== sessionId) {
      notifyState.last.sessionId = sessionId;
      notifyState.last.alertKey = "";
      notifyState.last.viewerThresholdHitAt = 0;
      notifyState.last.giftKey = "";
      notifyState.last.whaleKey = "";
      notifyState.last.watchUserKey = "";
      notifyState.last.spikeKey = "";
      saveNotifyState();
    }
    if (notifyState.viewerThreshold > 0 && Number(session.currentViewers || 0) >= notifyState.viewerThreshold) {
      const hitKey = `${sessionId}:${notifyState.viewerThreshold}:${Number(session.currentViewers || 0)}`;
      if (notifyState.last.viewerThresholdHitAt !== Number(session.currentViewers || 0)) {
        notifyState.last.viewerThresholdHitAt = Number(session.currentViewers || 0);
        saveNotifyState();
        await tg("sendMessage", {
          chat_id: notifyState.chatId,
          text: `Viewer alert\nCurrent viewers: ${fmtNum(session.currentViewers)}\nPeak viewers: ${fmtNum(session.peakViewers)}\nThreshold: ${fmtNum(notifyState.viewerThreshold)}\nSession: ${sessionId || "-"}`.slice(0, 3900),
        });
      }
    }
    const latestAlert = notifyState.alertEnabled ? alerts[0] : null;
    if (latestAlert) {
      const key = String(latestAlert.id || `${latestAlert.type}:${latestAlert.ts}:${latestAlert.accountId || latestAlert.user || ""}`);
      if (key && notifyState.last.alertKey !== key) {
        notifyState.last.alertKey = key;
        saveNotifyState();
        await tg("sendMessage", {
          chat_id: notifyState.chatId,
          text: `TKAI alert\n${latestAlert.type || "alert"} | ${latestAlert.user || latestAlert.accountId || "-"}\nScore: ${fmtNum(latestAlert.riskScore || latestAlert.score)}\n${String(latestAlert.text || "-").slice(0, 300)}`,
        });
      }
    }
    if (notifyState.giftEnabled) {
      const gift = gifts.find((row) => Number(row?.coins || 0) >= notifyState.giftCoinsMin);
      if (gift) {
        const giftKey = `${sessionId}:${gift.user}:${gift.giftName}:${gift.coins}:${gift.quantity}:${gift.ts}`;
        if (notifyState.last.giftKey !== giftKey) {
          notifyState.last.giftKey = giftKey;
          saveNotifyState();
          await tg("sendMessage", {
            chat_id: notifyState.chatId,
            text: `Gift alert\n@${gift.user || "-"} poslao ${gift.giftName || "gift"}\nCoins: ${fmtNum(gift.coins)} | Qty: ${fmtNum(gift.quantity)}\nVrijeme: ${fmtDate(gift.ts)}`,
          });
        }
      }
    }
    if (notifyState.whaleCoins > 0) {
      const whale = gifts.find((row) => Number(row?.coins || 0) >= notifyState.whaleCoins);
      if (whale) {
        const whaleKey = `${sessionId}:${whale.user}:${whale.giftName}:${whale.coins}:${whale.ts}`;
        if (notifyState.last.whaleKey !== whaleKey) {
          notifyState.last.whaleKey = whaleKey;
          saveNotifyState();
          await tg("sendMessage", {
            chat_id: notifyState.chatId,
            text: `Whale alert\n@${whale.user || "-"} poslao ${whale.giftName || "gift"}\nCoins: ${fmtNum(whale.coins)} | Qty: ${fmtNum(whale.quantity)}\nVrijeme: ${fmtDate(whale.ts)}`,
          });
        }
      }
    }
    if (notifyState.watchUsers.length) {
      const watched = users.find((row) => notifyState.watchUsers.includes(normalizeUserArg(row?.user)));
      if (watched) {
        const watchKey = `${sessionId}:${normalizeUserArg(watched.user)}:${Number(watched.lastTs || 0)}`;
        if (notifyState.last.watchUserKey !== watchKey) {
          notifyState.last.watchUserKey = watchKey;
          saveNotifyState();
          await tg("sendMessage", {
            chat_id: notifyState.chatId,
            text: `Watch user alert\n@${watched.user}\nCoins: ${fmtNum(watched.coins)} | Chat: ${fmtNum(watched.chat)} | Gifts: ${fmtNum(watched.gifts)}\nZadnja aktivnost: ${fmtDate(watched.lastTs)}`,
          });
        }
      }
    }
    if (notifyState.spikeThreshold > 0) {
      const spike = spikes.find((row) => Math.abs(Number(row?.delta || row?.score || 0)) >= notifyState.spikeThreshold);
      if (spike) {
        const spikeKey = `${sessionId}:${spike.type}:${Number(spike.delta || spike.score || 0)}:${Number(spike.ts || 0)}`;
        if (notifyState.last.spikeKey !== spikeKey) {
          notifyState.last.spikeKey = spikeKey;
          saveNotifyState();
          await tg("sendMessage", {
            chat_id: notifyState.chatId,
            text: `Spike alert\nType: ${spike.type || "activity"}\nDelta: ${fmtNum(spike.delta || spike.score || 0)}\nVrijeme: ${fmtDate(spike.ts)}`,
          });
        }
      }
    }
  } catch (error) {
    console.error("[tkai-telegram-bot] notify check failed:", String(error?.message || error));
  }
}

function startNotifyMonitor() {
  if (notifyMonitorStarted) return;
  notifyMonitorStarted = true;
  setInterval(() => {
    runNotifyCheck().catch(() => {});
  }, 15000);
}

async function sendStartupMessage() {
  notifyState = loadNotifyState();
  if (notifyState.startupEnabled === false) return;
  if (!ALLOWED_CHAT_ID) return;
  const lines = [
    "TKAI Telegram bot je pokrenut.",
    `Telegram chat: ${ALLOWED_CHAT_ID}`,
    `Control API URL: ${DEFAULT_API_URL}`,
    `Control token: ${controlApiReady() ? "OK" : "MISSING"}`,
    `Serverska LIVE baza: ${archiveApiReady() ? "OK" : "MISSING TOKEN"}`,
  ];
  try {
    if (controlApiReady()) {
      const health = await fetch(`${DEFAULT_API_URL}/health`).then((res) => res.json()).catch(() => null);
      lines.push(`Control health: ${health?.ok ? "OK" : "OFFLINE"}`);
    } else {
      lines.push("Control health: SKIPPED");
    }
    await tg("sendMessage", { chat_id: ALLOWED_CHAT_ID, text: lines.join("\n") });
  } catch (error) {
    console.error("[tkai-telegram-bot] startup message failed:", String(error?.message || error));
  }
}

async function processUpdate(update) {
  const callback = update?.callback_query;
  const message = callback?.message || update?.message;
  const chatId = String(message?.chat?.id || "");
  const text = callback
    ? String(callback?.data || "").replace(/^cmd:/, "").trim()
    : String(message?.text || "").trim();
  if (!chatId || !text.startsWith("/")) return;
  if (ALLOWED_CHAT_ID && chatId !== ALLOWED_CHAT_ID) {
    if (callback?.id) {
      await tg("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Ovaj chat nije autoriziran.",
        show_alert: true,
      }).catch(() => {});
    }
    await tg("sendMessage", { chat_id: chatId, text: "Ovaj chat nije autoriziran za TKAI bot." }).catch(() => {});
    return;
  }
  try {
    if (callback?.id) {
      await tg("answerCallbackQuery", { callback_query_id: callback.id }).catch(() => {});
    }
    const parts = tokenizeCommand(text);
    const command = String(parts[0] || "").toLowerCase().split("@")[0];
    if (
      (command === "/viewers" || command === "/viweres")
      && (
        String(parts[1] || "").toLowerCase() === "all"
        || (parts[1] && String(parts[2] || "").toLowerCase() === "all")
      )
    ) {
      await tg("sendChatAction", { chat_id: chatId, action: "upload_document" }).catch(() => {});
      const allCreators = String(parts[1] || "").toLowerCase() === "all";
      const exported = allCreators
        ? await buildAllCreatorsViewersCsv()
        : await buildCreatorViewersCsv(parts[1]);
      await tgDocument(
        chatId,
        exported.filename,
        exported.csv,
        allCreators
          ? `Svi spremljeni viewers po kreatorima: ${fmtNum(exported.count)}`
          : `Svi spremljeni viewers za @${exported.creator.owner}: ${fmtNum(exported.count)}`,
      );
      return;
    }
    if (command === "/export") {
      const kind = String(parts[1] || "").toLowerCase();
      const reference = parts[2] || "";
      if (!["creator", "user", "stream", "daily"].includes(kind) || !reference) {
        throw new Error("Primjer: /export creator @ime | /export user @ime | /export stream ID | /export daily @ime");
      }
      await tg("sendChatAction", { chat_id: chatId, action: "upload_document" }).catch(() => {});
      let filename = "";
      let csv = "";
      let caption = "";
      if (kind === "creator") {
        const exported = await buildCreatorViewersCsv(reference);
        ({ filename, csv } = exported);
        caption = `Publika kreatora @${exported.creator.owner}: ${fmtNum(exported.count)} redaka`;
      } else if (kind === "user") {
        const data = await requestUserArchive({ user: normalizeUserArg(reference) });
        filename = `user-${normalizeUserArg(reference)}.csv`;
        csv = rowsToCsv(data.streams);
        caption = `Streamovi korisnika @${normalizeUserArg(reference)}`;
      } else if (kind === "stream") {
        const session = await resolveArchiveSession(reference);
        if (!session) throw new Error("Sesija nije pronađena.");
        const data = await callArchiveApi(`/v1/archive/sessions/${encodeURIComponent(session.id)}/events?limit=500`);
        filename = `stream-${String(session.id).replace(/[^a-zA-Z0-9._-]/g, "_")}.csv`;
        csv = rowsToCsv(data.rows);
        caption = `Događaji streama ${session.id} (do 500 redaka)`;
      } else {
        const range = reportRange("daily");
        const data = await requestArchiveReport({ creator: reference, ...range });
        filename = `daily-${normalizeUserArg(reference)}-${range.from}.csv`;
        csv = rowsToCsv(data.report?.streams);
        caption = `Dnevni streamovi @${normalizeUserArg(reference)}`;
      }
      await tgDocument(chatId, filename, csv, caption);
      return;
    }
    if (command === "/chart") {
      const kind = String(parts[1] || "growth").toLowerCase();
      const creator = parts[2] || parts[1] || "";
      if (kind !== "growth" || !creator) throw new Error("Primjer: /chart growth @kreator");
      const resolved = await resolveArchiveCreator(creator);
      if (!resolved) throw new Error("Kreator nije pronađen.");
      const report = (await requestArchiveReport({ creator: resolved.owner })).report;
      const svg = buildReportSvg(`Rast @${resolved.owner}`, report.daily);
      await tgDocument(
        chatId,
        `growth-${resolved.owner.replace(/[^a-zA-Z0-9._-]/g, "_")}.svg`,
        svg,
        `Graf rasta @${resolved.owner}`,
        "image/svg+xml",
      );
      return;
    }
    const reply = await handleCommand(text);
    let replyMarkup = await commandMarkup(text);
    if (command === "/forgetuser") {
      const confirm = reply.match(/\/confirmforget\s+([a-f0-9]+)/i);
      if (confirm) {
        replyMarkup = {
          inline_keyboard: [[
            { text: "⚠️ Potvrdi trajno brisanje", callback_data: `cmd:/confirmforget ${confirm[1]}` },
            { text: "Odustani", callback_data: `cmd:/cancelforget ${confirm[1]}` },
          ]],
        };
      }
    }
    await tg("sendMessage", {
      chat_id: chatId,
      text: reply.slice(0, 3900) || "OK",
      reply_markup: replyMarkup,
      disable_web_page_preview: true,
    });
    callArchiveAdminApi("/v1/archive/admin/audit", {
      body: {
        chatId,
        telegramUser: String(callback?.from?.username || message?.from?.username || ""),
        command: text.slice(0, 500),
        status: "ok",
      },
    }).catch(() => {});
  } catch (error) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `Greška: ${String(error?.message || error || "Unknown error").slice(0, 3500)}`,
    }).catch(() => {});
    callArchiveAdminApi("/v1/archive/admin/audit", {
      body: {
        chatId,
        telegramUser: String(callback?.from?.username || message?.from?.username || ""),
        command: text.slice(0, 500),
        status: "error",
        detail: String(error?.message || error || "").slice(0, 500),
      },
    }).catch(() => {});
  }
}

async function pollLoop() {
  for (;;) {
    try {
      const updates = await tg("getUpdates", {
        offset: updateOffset,
        timeout: POLL_TIMEOUT_SECONDS,
        allowed_updates: ["message", "callback_query"],
      });
      for (const update of updates) {
        updateOffset = Math.max(updateOffset, Number(update?.update_id || 0) + 1);
        await processUpdate(update);
      }
    } catch (error) {
      console.error("[tkai-telegram-bot]", String(error?.message || error));
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

if (require.main === module) {
  (async () => {
    const webhookInfo = await getTelegramWebhookInfo().catch(() => null);
    if (webhookInfo?.url && process.env.TKAI_FORCE_POLLING !== "1") {
      console.log(`[tkai-telegram-bot] server webhook je aktivan; lokalni polling nije pokrenut.`);
      return;
    }
    console.log(
      `[tkai-telegram-bot] polling Telegram; desktop=${DEFAULT_API_URL}; archive=${ARCHIVE_API_URL}`,
    );
    if (notifyState.enabled) startNotifyMonitor();
    await Promise.allSettled([configureTelegramCommands(), sendStartupMessage()]);
    await pollLoop();
  })().catch((error) => {
    console.error("[tkai-telegram-bot] fatal:", error);
    process.exit(1);
  });
}

module.exports = {
  archiveApiReady,
  buildAllCreatorsViewersCsv,
  buildArchiveEventsMessage,
  buildArchiveOverviewMessage,
  buildArchiveSessionMessage,
  buildArchiveSessionsMessage,
  buildArchiveUsersMessage,
  buildCreatorViewersCsv,
  buildCreatorViewersMessage,
  buildCreatorsMessage,
  buildUserArchiveMessage,
  buildUserStreamsMessage,
  callArchiveApi,
  configureTelegramCommands,
  configureTelegramWebhook,
  getTelegramWebhookInfo,
  sendTelegramMessage,
  handleCommand,
  parseUserArchiveArgs,
  requestUserArchive,
  resolveArchiveCreator,
  resolveArchiveSession,
  tokenizeCommand,
  processUpdate,
};
