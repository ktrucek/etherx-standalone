"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const HOST = String(process.env.LIVE_HOST || "127.0.0.1").trim();
const PORT = Math.max(1, Math.min(65535, Number(process.env.LIVE_PORT || 8791) || 8791));
const AUTH_TOKEN = String(process.env.LIVE_AUTH_TOKEN || "");
const MAX_EVENTS_PER_SESSION = Math.max(
  200,
  Math.min(100000, Number(process.env.LIVE_MAX_EVENTS_PER_SESSION || 10000) || 10000),
);
const SESSION_TTL_MS = Math.max(
  10,
  Number(process.env.LIVE_SESSION_TTL_MINUTES || 360) || 360,
) * 60 * 1000;
const MAX_CLIENTS = Math.max(1, Number(process.env.LIVE_MAX_CLIENTS || 50) || 50);
const MAX_SESSIONS = Math.max(
  1,
  Math.min(10000, Number(process.env.LIVE_MAX_SESSIONS || 200) || 200),
);
const MAX_CONNECTIONS_PER_IP = Math.max(
  1,
  Math.min(50, Number(process.env.LIVE_MAX_CONNECTIONS_PER_IP || 5) || 5),
);
const AUTH_WINDOW_MS = Math.max(
  10,
  Number(process.env.LIVE_AUTH_WINDOW_SECONDS || 60) || 60,
) * 1000;
const AUTH_MAX_FAILURES = Math.max(
  2,
  Math.min(100, Number(process.env.LIVE_AUTH_MAX_FAILURES || 8) || 8),
);
const AUTH_BLOCK_MS = Math.max(
  1,
  Number(process.env.LIVE_AUTH_BLOCK_MINUTES || 15) || 15,
) * 60 * 1000;
const MESSAGE_WINDOW_MS = Math.max(
  1,
  Number(process.env.LIVE_MESSAGE_WINDOW_SECONDS || 10) || 10,
) * 1000;
const MAX_MESSAGES_PER_WINDOW = Math.max(
  10,
  Math.min(5000, Number(process.env.LIVE_MAX_MESSAGES_PER_WINDOW || 120) || 120),
);
const MAX_TIMELINE_BUCKETS = Math.max(
  20,
  Math.min(1440, Number(process.env.LIVE_MAX_TIMELINE_BUCKETS || 360) || 360),
);
const HEALTH_DETAILS = String(process.env.LIVE_HEALTH_DETAILS || "").toLowerCase() === "true";
const SNAPSHOT_INTERVAL_MS = Math.max(
  10,
  Number(process.env.LIVE_SNAPSHOT_SECONDS || 30) || 30,
) * 1000;
const DATA_DIR = String(process.env.LIVE_DATA_DIR || "").trim()
  || path.join(__dirname, "data");
const SNAPSHOT_FILE = path.join(DATA_DIR, "live-sessions.json");
const ALLOWED_ORIGINS = new Set(
  String(process.env.LIVE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const MAX_PAYLOAD_BYTES = 512 * 1024;

if (AUTH_TOKEN.length < 32) {
  console.error("[live] LIVE_AUTH_TOKEN mora imati najmanje 32 znaka.");
  process.exit(1);
}

const sessions = new Map();
const authAttempts = new Map();
let snapshotDirty = false;

function safeText(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function safeId(value, fallbackPrefix = "id") {
  const cleaned = safeText(value, 160).replace(/[^a-zA-Z0-9._:@/-]/g, "_");
  return cleaned || `${fallbackPrefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function tokenMatches(candidate) {
  const actual = Buffer.from(AUTH_TOKEN);
  const supplied = Buffer.from(String(candidate || ""));
  return actual.length === supplied.length && crypto.timingSafeEqual(actual, supplied);
}

function getRemoteAddress(request) {
  const realIp = safeText(request?.headers?.["x-real-ip"], 80).trim();
  const forwardedParts = safeText(request?.headers?.["x-forwarded-for"], 300)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const forwarded = forwardedParts[forwardedParts.length - 1];
  return safeText(realIp || forwarded || request?.socket?.remoteAddress || "unknown", 80);
}

function getAuthState(remoteAddress, now = Date.now()) {
  const key = safeText(remoteAddress || "unknown", 80);
  let state = authAttempts.get(key);
  if (!state || now - state.windowStartedAt >= AUTH_WINDOW_MS) {
    state = { windowStartedAt: now, failures: 0, blockedUntil: 0 };
    authAttempts.set(key, state);
  }
  return state;
}

function isAuthBlocked(remoteAddress, now = Date.now()) {
  const state = authAttempts.get(safeText(remoteAddress || "unknown", 80));
  return Boolean(state && state.blockedUntil > now);
}

function recordAuthFailure(remoteAddress, reason) {
  const now = Date.now();
  const address = safeText(remoteAddress || "unknown", 80);
  const state = getAuthState(address, now);
  state.failures += 1;
  if (state.failures >= AUTH_MAX_FAILURES) {
    state.blockedUntil = now + AUTH_BLOCK_MS;
  }
  console.warn(
    `[live-security] auth_rejected ip=${address} reason=${safeText(reason, 40)} failures=${state.failures} blocked=${state.blockedUntil > now}`,
  );
}

function clearAuthFailures(remoteAddress) {
  authAttempts.delete(safeText(remoteAddress || "unknown", 80));
}

function countConnectionsForIp(remoteAddress) {
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.remoteAddress === remoteAddress) count += 1;
  });
  return count;
}

function sanitizeEvent(source) {
  const event = source && typeof source === "object" ? source : {};
  const type = safeText(event.type || "chat", 24).toLowerCase();
  return {
    id: safeId(event.id || event.mid, "event"),
    type,
    sourceType: safeText(event.sourceType, 24),
    user: safeText(event.user || "unknown", 80),
    userHandle: safeText(event.userHandle, 80),
    text: safeText(event.text, 1200),
    translatedText: safeText(event.translatedText, 1200),
    translatedLang: safeText(event.translatedLang, 16),
    ts: Math.max(0, safeNumber(event.ts, Date.now())),
    giftName: safeText(event.giftName, 120),
    quantity: Math.max(1, safeNumber(event.quantity, 1)),
    unitCoins: Math.max(0, safeNumber(event.unitCoins, 0)),
    coins: Math.max(0, safeNumber(event.coins, 0)),
    userLevel: Math.max(0, safeNumber(event.userLevel || event.level, 0)),
    userBadgeName: safeText(event.userBadgeName, 40),
    gifterRank: Math.max(0, safeNumber(event.gifterRank, 0)),
  };
}

function createSession(id, metadata = {}) {
  const now = Date.now();
  return {
    id,
    owner: safeText(metadata.owner, 80),
    liveUrl: safeText(metadata.liveUrl, 1000),
    startedAt: Math.max(0, safeNumber(metadata.startedAt, now)),
    createdAt: now,
    updatedAt: now,
    events: [],
    eventIds: new Set(),
    users: new Map(),
    counts: {
      total: 0,
      chat: 0,
      gifts: 0,
      subscribers: 0,
      joins: 0,
      shares: 0,
      likes: 0,
      coins: 0,
    },
  };
}

function restoreSessionsFromSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
    const rows = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    rows.forEach((row) => {
      const id = safeId(row?.id, "session");
      const session = createSession(id, row || {});
      session.createdAt = Math.max(0, safeNumber(row?.createdAt, Date.now()));
      session.updatedAt = Math.max(0, safeNumber(row?.updatedAt, session.createdAt));
      session.events = Array.isArray(row?.events)
        ? row.events.slice(-MAX_EVENTS_PER_SESSION).map(sanitizeEvent)
        : [];
      session.eventIds = new Set(session.events.map((event) => event.id));
      session.users = new Map(
        (Array.isArray(row?.users) ? row.users : [])
          .filter((entry) => Array.isArray(entry) && entry.length === 2)
          .map(([key, user]) => [safeText(key, 100).toLowerCase(), {
            user: safeText(user?.user, 80),
            userHandle: safeText(user?.userHandle, 80),
            messages: Math.max(0, safeNumber(user?.messages, 0)),
            gifts: Math.max(0, safeNumber(user?.gifts, 0)),
            giftEvents: Math.max(0, safeNumber(user?.giftEvents, user?.gifts || 0)),
            subscribers: Math.max(0, safeNumber(user?.subscribers, 0)),
            joins: Math.max(0, safeNumber(user?.joins, 0)),
            shares: Math.max(0, safeNumber(user?.shares, 0)),
            coins: Math.max(0, safeNumber(user?.coins, 0)),
            likes: Math.max(0, safeNumber(user?.likes, 0)),
            appearances: Math.max(0, safeNumber(user?.appearances, user?.messages || 0)),
            level: Math.max(0, safeNumber(user?.level, 0)),
            badge: safeText(user?.badge, 40),
            firstSeenAt: Math.max(0, safeNumber(user?.firstSeenAt, 0)),
            lastSeenAt: Math.max(0, safeNumber(user?.lastSeenAt, 0)),
            lastMessage: safeText(user?.lastMessage, 160),
            giftTypes: Object.fromEntries(
              Object.entries(user?.giftTypes || {})
                .slice(0, 200)
                .map(([name, quantity]) => [safeText(name, 120), Math.max(0, safeNumber(quantity, 0))]),
            ),
          }]),
      );
      session.counts = {
        ...session.counts,
        ...Object.fromEntries(
          Object.entries(row?.counts || {}).map(([key, value]) => [key, Math.max(0, safeNumber(value, 0))]),
        ),
      };
      sessions.set(id, session);
    });
    console.log(`[live] Vraćeno RAM sesija iz snapshota: ${sessions.size}`);
  } catch (error) {
    console.warn("[live] Snapshot restore nije uspio:", error.message);
  }
}

function persistSessionsSnapshot(force = false) {
  if (!force && !snapshotDirty) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      sessions: Array.from(sessions.values()).map((session) => ({
        id: session.id,
        owner: session.owner,
        liveUrl: session.liveUrl,
        startedAt: session.startedAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        counts: session.counts,
        users: Array.from(session.users.entries()),
        events: session.events,
      })),
    };
    const temporaryFile = `${SNAPSHOT_FILE}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(payload), "utf8");
    fs.renameSync(temporaryFile, SNAPSHOT_FILE);
    snapshotDirty = false;
  } catch (error) {
    console.warn("[live] Snapshot save nije uspio:", error.message);
  }
}

function getSession(sessionId, metadata = {}) {
  const id = safeId(sessionId, "session");
  let session = sessions.get(id);
  if (!session) {
    session = createSession(id, metadata);
    sessions.set(id, session);
    snapshotDirty = true;
  } else {
    if (metadata.owner) session.owner = safeText(metadata.owner, 80);
    if (metadata.liveUrl) session.liveUrl = safeText(metadata.liveUrl, 1000);
  }
  session.updatedAt = Date.now();
  return session;
}

function applyEvent(session, rawEvent) {
  const event = sanitizeEvent(rawEvent);
  if (session.eventIds.has(event.id)) return false;

  session.events.push(event);
  session.eventIds.add(event.id);
  session.counts.total += 1;
  if (event.type === "chat" || event.type === "caption") session.counts.chat += 1;
  if (event.type === "gift") session.counts.gifts += 1;
  if (event.type === "subscriber") session.counts.subscribers += 1;
  if (event.type === "join") session.counts.joins += 1;
  if (event.type === "share") session.counts.shares += 1;
  if (event.type === "like") session.counts.likes += Math.max(1, event.quantity);
  session.counts.coins += event.coins;

  const isListeningEvent = event.type === "caption"
    || /(?:whisper|listen|caption)/i.test(String(event.sourceType || ""));
  const userKey = (event.userHandle || event.user || "unknown").toLowerCase();
  const isRealUser = !isListeningEvent
    && !["", "unknown", "system", "slušanje", "live audience", "chat user"].includes(userKey);
  if (!isRealUser) {
    if (session.events.length > MAX_EVENTS_PER_SESSION) {
      const removed = session.events.splice(0, session.events.length - MAX_EVENTS_PER_SESSION);
      removed.forEach((item) => session.eventIds.delete(item.id));
    }
    session.updatedAt = Date.now();
    snapshotDirty = true;
    return true;
  }
  const user = session.users.get(userKey) || {
    user: event.user,
    userHandle: event.userHandle,
    messages: 0,
    gifts: 0,
    giftEvents: 0,
    subscribers: 0,
    joins: 0,
    shares: 0,
    coins: 0,
    likes: 0,
    appearances: 0,
    level: 0,
    badge: "",
    lastMessage: "",
    giftTypes: {},
    firstSeenAt: event.ts,
    lastSeenAt: event.ts,
  };
  user.user = event.user || user.user;
  user.userHandle = event.userHandle || user.userHandle;
  user.appearances += 1;
  user.messages += event.type === "chat" ? 1 : 0;
  if (event.type === "gift" || event.type === "subscriber") {
    user.giftEvents += 1;
    user.gifts += Math.max(1, event.quantity);
    const giftName = event.giftName || (event.type === "subscriber" ? "Subscriber" : "Unknown gift");
    user.giftTypes[giftName] = Math.max(0, safeNumber(user.giftTypes[giftName], 0))
      + Math.max(1, event.quantity);
  }
  if (event.type === "subscriber") user.subscribers += 1;
  if (event.type === "join") user.joins += 1;
  if (event.type === "share") user.shares += 1;
  user.coins += event.coins;
  user.likes += event.type === "like" ? Math.max(1, event.quantity) : 0;
  user.level = Math.max(user.level, event.userLevel);
  user.badge = event.userBadgeName || user.badge;
  if (event.text) user.lastMessage = safeText(event.text, 160);
  user.lastSeenAt = Math.max(user.lastSeenAt, event.ts);
  session.users.set(userKey, user);

  if (session.events.length > MAX_EVENTS_PER_SESSION) {
    const removed = session.events.splice(0, session.events.length - MAX_EVENTS_PER_SESSION);
    removed.forEach((item) => session.eventIds.delete(item.id));
  }
  session.updatedAt = Date.now();
  snapshotDirty = true;
  return true;
}

function classifySentiment(text) {
  const normalized = safeText(text, 1200).toLocaleLowerCase("hr-HR");
  if (!normalized) return "neutral";
  const positive = [
    "bravo", "super", "odlično", "odlicno", "hvala", "volim", "lijepo", "lepo",
    "top", "legenda", "keren", "mantap", "bagus", "suka", "love", "great", "good",
    "❤️", "❤", "😍", "🥰", "👏", "🔥", "😊", "😂",
  ];
  const negative = [
    "loše", "lose", "užas", "uzas", "mrzim", "glupo", "prevara", "dosadno",
    "jelek", "buruk", "benci", "hate", "bad", "scam", "boring",
    "😡", "🤬", "👎", "💩", "😢",
  ];
  const positiveHits = positive.reduce((sum, word) => sum + (normalized.includes(word) ? 1 : 0), 0);
  const negativeHits = negative.reduce((sum, word) => sum + (normalized.includes(word) ? 1 : 0), 0);
  if (positiveHits > negativeHits) return "positive";
  if (negativeHits > positiveHits) return "negative";
  return "neutral";
}

function buildTimeline(session) {
  const buckets = new Map();
  session.events.forEach((event) => {
    if (
      event.type === "caption"
      || /(?:whisper|listen|caption)/i.test(String(event.sourceType || ""))
    ) return;
    const minuteStart = Math.floor(Math.max(0, event.ts) / 60000) * 60000;
    let bucket = buckets.get(minuteStart);
    if (!bucket) {
      bucket = {
        minuteStart,
        total: 0,
        chat: 0,
        gifts: 0,
        giftQuantity: 0,
        coins: 0,
        joins: 0,
        shares: 0,
        likes: 0,
        sentiment: { positive: 0, neutral: 0, negative: 0 },
        giftTypes: new Map(),
        gifters: new Map(),
      };
      buckets.set(minuteStart, bucket);
    }
    bucket.total += 1;
    if (event.type === "chat") {
      bucket.chat += 1;
      bucket.sentiment[classifySentiment(event.text)] += 1;
    }
    if (event.type === "gift" || event.type === "subscriber") {
      bucket.gifts += 1;
      bucket.giftQuantity += Math.max(1, event.quantity);
      bucket.coins += event.coins;
      const giftName = event.giftName || (event.type === "subscriber" ? "Subscriber" : "Unknown gift");
      const gift = bucket.giftTypes.get(giftName) || { name: giftName, events: 0, quantity: 0, coins: 0 };
      gift.events += 1;
      gift.quantity += Math.max(1, event.quantity);
      gift.coins += event.coins;
      bucket.giftTypes.set(giftName, gift);
      const gifterName = event.user || event.userHandle || "unknown";
      const gifter = bucket.gifters.get(gifterName) || { user: gifterName, gifts: 0, coins: 0 };
      gifter.gifts += 1;
      gifter.coins += event.coins;
      bucket.gifters.set(gifterName, gifter);
    }
    if (event.type === "join") bucket.joins += 1;
    if (event.type === "share") bucket.shares += 1;
    if (event.type === "like") bucket.likes += Math.max(1, event.quantity);
  });
  return Array.from(buckets.values())
    .sort((a, b) => a.minuteStart - b.minuteStart)
    .slice(-MAX_TIMELINE_BUCKETS)
    .map((bucket) => ({
      minuteStart: bucket.minuteStart,
      total: bucket.total,
      chat: bucket.chat,
      gifts: bucket.gifts,
      giftQuantity: bucket.giftQuantity,
      coins: bucket.coins,
      joins: bucket.joins,
      shares: bucket.shares,
      likes: bucket.likes,
      sentiment: bucket.sentiment,
      giftTypes: Array.from(bucket.giftTypes.values())
        .sort((a, b) => b.coins - a.coins || b.quantity - a.quantity)
        .slice(0, 8),
      gifters: Array.from(bucket.gifters.values())
        .sort((a, b) => b.coins - a.coins || b.gifts - a.gifts)
        .slice(0, 8),
    }));
}

function buildSummary(session, options = {}) {
  if (typeof options === "boolean") options = { includeLatestEvents: options };
  const users = Array.from(session.users.values());
  const topGifters = users
    .filter((user) => user.coins > 0 || user.gifts > 0)
    .sort((a, b) => b.coins - a.coins || b.gifts - a.gifts)
    .slice(0, 20)
    .map((user, index) => ({ ...user, rank: index + 1 }));
  const topChatters = users
    .filter((user) => user.messages > 0)
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 20);
  const summary = {
    sessionId: session.id,
    owner: session.owner,
    liveUrl: session.liveUrl,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    retainedEvents: session.events.length,
    uniqueUsers: users.length,
    counts: { ...session.counts },
    topGifters,
    topChatters,
  };
  if (options.includeLatestEvents) summary.latestEvents = session.events.slice(-50);
  if (options.includeTimeline) summary.timeline = buildTimeline(session);
  return summary;
}

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && requestUrl.pathname === "/health") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    const health = {
      ok: true,
      service: "etherx-live-chat",
    };
    if (HEALTH_DETAILS) {
      health.uptimeSeconds = Math.floor(process.uptime());
      health.sessions = sessions.size;
      health.clients = wss.clients.size;
      health.now = new Date().toISOString();
    }
    response.end(JSON.stringify(health));
    return;
  }
  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ ok: false, error: "Not found" }));
});

const wss = new WebSocketServer({
  noServer: true,
  clientTracking: true,
  maxPayload: MAX_PAYLOAD_BYTES,
  perMessageDeflate: false,
});

restoreSessionsFromSnapshot();

server.on("upgrade", (request, socket, head) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const remoteAddress = getRemoteAddress(request);
  if (requestUrl.pathname !== "/v1/live") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const origin = String(request.headers.origin || "");
  if (ALLOWED_ORIGINS.size && !ALLOWED_ORIGINS.has(origin)) {
    console.warn(`[live-security] origin_rejected ip=${remoteAddress}`);
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (isAuthBlocked(remoteAddress)) {
    console.warn(`[live-security] blocked_ip_rejected ip=${remoteAddress}`);
    socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (wss.clients.size >= MAX_CLIENTS) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (countConnectionsForIp(remoteAddress) >= MAX_CONNECTIONS_PER_IP) {
    console.warn(`[live-security] connection_limit ip=${remoteAddress}`);
    socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  request.liveRemoteAddress = remoteAddress;
  wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
});

wss.on("connection", (socket, request) => {
  socket.isAlive = true;
  socket.isAuthenticated = false;
  socket.sessionId = "";
  socket.clientId = "";
  socket.remoteAddress = safeText(request.liveRemoteAddress || getRemoteAddress(request), 80);
  socket.messageWindowStartedAt = Date.now();
  socket.messageCountInWindow = 0;

  const authTimer = setTimeout(() => {
    if (!socket.isAuthenticated) {
      recordAuthFailure(socket.remoteAddress, "timeout");
      socket.close(4401, "Authentication timeout");
    }
  }, 5000);

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", (raw) => {
    const now = Date.now();
    if (now - socket.messageWindowStartedAt >= MESSAGE_WINDOW_MS) {
      socket.messageWindowStartedAt = now;
      socket.messageCountInWindow = 0;
    }
    socket.messageCountInWindow += 1;
    if (socket.messageCountInWindow > MAX_MESSAGES_PER_WINDOW) {
      console.warn(`[live-security] message_rate_limit ip=${socket.remoteAddress}`);
      socket.close(4429, "Rate limit");
      return;
    }
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch (_) {
      sendJson(socket, { type: "error", code: "invalid_json" });
      return;
    }

    if (!socket.isAuthenticated) {
      if (message?.type !== "auth" || !tokenMatches(message.token)) {
        recordAuthFailure(socket.remoteAddress, "invalid_token");
        socket.close(4401, "Unauthorized");
        return;
      }
      if (isAuthBlocked(socket.remoteAddress)) {
        socket.close(4429, "Temporarily blocked");
        return;
      }
      socket.clientId = safeId(message.clientId, "client");
      const requestedSessionId = safeId(message.sessionId, "session");
      if (!sessions.has(requestedSessionId) && sessions.size >= MAX_SESSIONS) {
        console.warn(`[live-security] session_limit ip=${socket.remoteAddress}`);
        socket.close(4429, "Session limit");
        return;
      }
      socket.isAuthenticated = true;
      clearAuthFailures(socket.remoteAddress);
      socket.sessionId = requestedSessionId;
      clearTimeout(authTimer);
      const session = getSession(socket.sessionId, message.metadata || {});
      sendJson(socket, {
        type: "ready",
        protocol: 1,
        clientId: socket.clientId,
        sessionId: session.id,
        summary: buildSummary(session),
      });
      return;
    }

    if (message?.type === "events") {
      const sessionId = safeId(message.sessionId || socket.sessionId, "session");
      if (sessionId !== socket.sessionId) {
        sendJson(socket, { type: "error", code: "session_mismatch" });
        return;
      }
      const session = getSession(sessionId, message.metadata || {});
      const incoming = Array.isArray(message.events) ? message.events.slice(0, 250) : [];
      let accepted = 0;
      incoming.forEach((event) => {
        if (applyEvent(session, event)) accepted += 1;
      });
      sendJson(socket, {
        type: "ack",
        seq: Math.max(0, safeNumber(message.seq, 0)),
        accepted,
        received: incoming.length,
        summary: buildSummary(session),
      });
      return;
    }

    if (message?.type === "get_summary") {
      const session = getSession(socket.sessionId);
      sendJson(socket, {
        type: "summary",
        summary: buildSummary(session, { includeLatestEvents: true, includeTimeline: true }),
      });
      return;
    }

    if (message?.type === "get_events") {
      const session = getSession(socket.sessionId);
      const limit = Math.max(1, Math.min(1000, safeNumber(message.limit, 500)));
      const beforeTs = Math.max(0, safeNumber(message.beforeTs, Number.MAX_SAFE_INTEGER));
      const offset = Math.max(0, safeNumber(message.offset, 0));
      const eligible = session.events.filter((event) => event.ts < beforeTs);
      const end = Math.max(0, eligible.length - offset);
      const events = eligible.slice(Math.max(0, end - limit), end);
      sendJson(socket, {
        type: "events_page",
        requestId: safeId(message.requestId, "request"),
        events,
        hasMore: eligible.length > offset + events.length,
        nextOffset: offset + events.length,
        nextBeforeTs: events.length ? events[0].ts : 0,
      });
      return;
    }

    if (message?.type === "get_users") {
      const session = getSession(socket.sessionId);
      const limit = Math.max(1, Math.min(1000, safeNumber(message.limit, 500)));
      const offset = Math.max(0, safeNumber(message.offset, 0));
      const allUsers = Array.from(session.users.values())
        .sort((a, b) => b.coins - a.coins || b.appearances - a.appearances || b.lastSeenAt - a.lastSeenAt);
      const users = allUsers.slice(offset, offset + limit);
      sendJson(socket, {
        type: "users_page",
        requestId: safeId(message.requestId, "request"),
        users,
        hasMore: allUsers.length > offset + users.length,
        nextOffset: offset + users.length,
      });
      return;
    }

    if (message?.type === "end_session") {
      const session = getSession(socket.sessionId);
      sendJson(socket, { type: "session_ended", summary: buildSummary(session) });
      socket.close(1000, "Session ended");
      return;
    }

    sendJson(socket, { type: "error", code: "unsupported_message" });
  });

  socket.on("close", () => clearTimeout(authTimer));
  socket.on("error", (error) => {
    console.warn("[live] WebSocket client error:", error.message);
  });
});

const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (socket.isAlive === false) {
      socket.terminate();
      return;
    }
    socket.isAlive = false;
    socket.ping();
  });
}, 30000);

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, session] of sessions.entries()) {
    const inUse = Array.from(wss.clients).some(
      (socket) => socket.isAuthenticated && socket.sessionId === sessionId,
    );
    if (!inUse && session.updatedAt < cutoff) {
      sessions.delete(sessionId);
      snapshotDirty = true;
    }
  }
  for (const [remoteAddress, state] of authAttempts.entries()) {
    const authStateExpired = now - state.windowStartedAt >= AUTH_WINDOW_MS;
    const blockExpired = state.blockedUntil <= now;
    if (authStateExpired && blockExpired) authAttempts.delete(remoteAddress);
  }
}, 60000);

const snapshotTimer = setInterval(() => {
  persistSessionsSnapshot();
}, SNAPSHOT_INTERVAL_MS);

server.listen(PORT, HOST, () => {
  console.log(`[live] EtherX LIVE chat server sluša na http://${HOST}:${PORT}`);
});
server.on("error", (error) => {
  console.error("[live] HTTP server error:", error.message);
});

function shutdown(signal) {
  console.log(`[live] ${signal}: gasim servis.`);
  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  clearInterval(snapshotTimer);
  persistSessionsSnapshot(true);
  wss.clients.forEach((socket) => socket.close(1001, "Server shutdown"));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 9000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
