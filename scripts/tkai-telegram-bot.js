"use strict";

const fs = require("fs");
const path = require("path");
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

if (!TELEGRAM_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required.");
  process.exit(1);
}

const tgApi = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
let updateOffset = 0;
let notifyState = loadNotifyState();
let notifyMonitorStarted = false;

function controlApiReady() {
  return !!CONTROL_TOKEN && CONTROL_TOKEN.length >= 24;
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

async function handleCommand(text) {
  const parts = String(text || "").trim().split(/\s+/);
  const command = String(parts[0] || "").toLowerCase();
  const maybeLimit = Math.max(1, Math.min(20, Number(parts[1] || 10) || 10));
  if (command === "/start" || command === "/help") {
    return [
      "Komande:",
      "/status",
      "/viewer",
      "/giftstats",
      "/gifters [broj]",
      "/user @ime",
      "/alerts",
      "/notify on|off|status|gift on|gift off|gift 500|viewer 500|whale 10000|spike 150|watch @ime|unwatch @ime",
      "/session",
      "/db",
      "/startscan",
      "/stopscan",
      "/openai",
      "",
      controlApiReady()
        ? `Control API token: OK | ${DEFAULT_API_URL}`
        : "Control API token: MISSING",
    ].join("\n");
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
    const data = await callControlApi("/api/tkai/status?limit=5");
    return buildStatusMessage(data);
  }
  if (command === "/db") {
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
  const message = update?.message;
  const chatId = String(message?.chat?.id || "");
  const text = String(message?.text || "").trim();
  if (!chatId || !text.startsWith("/")) return;
  if (ALLOWED_CHAT_ID && chatId !== ALLOWED_CHAT_ID) {
    await tg("sendMessage", { chat_id: chatId, text: "Ovaj chat nije autoriziran za TKAI bot." }).catch(() => {});
    return;
  }
  try {
    const reply = await handleCommand(text);
    await tg("sendMessage", { chat_id: chatId, text: reply.slice(0, 3900) || "OK" });
  } catch (error) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `Greška: ${String(error?.message || error || "Unknown error").slice(0, 3500)}`,
    }).catch(() => {});
  }
}

async function pollLoop() {
  for (;;) {
    try {
      const updates = await tg("getUpdates", {
        offset: updateOffset,
        timeout: POLL_TIMEOUT_SECONDS,
        allowed_updates: ["message"],
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

console.log(`[tkai-telegram-bot] polling Telegram and forwarding commands to ${DEFAULT_API_URL}`);
if (notifyState.enabled) startNotifyMonitor();
sendStartupMessage().finally(() => pollLoop().catch((error) => {
  console.error("[tkai-telegram-bot] fatal:", error);
  process.exit(1);
}));
