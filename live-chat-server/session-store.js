"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function normalizeLimit(value, fallback = 100, max = 1000) {
  return Math.max(1, Math.min(max, Math.floor(safeNumber(value, fallback))));
}

function normalizeOffset(value) {
  return Math.max(0, Math.floor(safeNumber(value, 0)));
}

class LiveSessionStore {
  constructor(options = {}) {
    this.dataDir = String(options.dataDir || path.join(__dirname, "data"));
    this.dbPath = String(options.dbPath || path.join(this.dataDir, "live-archive.sqlite"));
    this.db = null;
    this.statements = {};
  }

  init() {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS archive_schema (
        version INTEGER NOT NULL,
        migrated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS live_sessions (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL DEFAULT '',
        live_url TEXT NOT NULL DEFAULT '',
        started_at INTEGER NOT NULL DEFAULT 0,
        ended_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        current_viewers INTEGER NOT NULL DEFAULT 0,
        peak_viewers INTEGER NOT NULL DEFAULT 0,
        total_events INTEGER NOT NULL DEFAULT 0,
        chat_events INTEGER NOT NULL DEFAULT 0,
        gift_events INTEGER NOT NULL DEFAULT 0,
        subscriber_events INTEGER NOT NULL DEFAULT 0,
        join_events INTEGER NOT NULL DEFAULT 0,
        share_events INTEGER NOT NULL DEFAULT 0,
        likes_total INTEGER NOT NULL DEFAULT 0,
        coins_total INTEGER NOT NULL DEFAULT 0,
        unique_users INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_live_sessions_updated ON live_sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_live_sessions_owner ON live_sessions(owner, updated_at DESC);

      CREATE TABLE IF NOT EXISTS live_events (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'chat',
        source_type TEXT NOT NULL DEFAULT '',
        user_name TEXT NOT NULL DEFAULT '',
        user_handle TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        translated_text TEXT NOT NULL DEFAULT '',
        translated_lang TEXT NOT NULL DEFAULT '',
        event_at INTEGER NOT NULL DEFAULT 0,
        gift_name TEXT NOT NULL DEFAULT '',
        room_id TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 0,
        unit_coins INTEGER NOT NULL DEFAULT 0,
        coins INTEGER NOT NULL DEFAULT 0,
        user_level INTEGER NOT NULL DEFAULT 0,
        user_badge_name TEXT NOT NULL DEFAULT '',
        gifter_rank INTEGER NOT NULL DEFAULT 0,
        first_seen_private INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (session_id, id),
        FOREIGN KEY (session_id) REFERENCES live_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_live_events_session_time ON live_events(session_id, event_at DESC);
      CREATE INDEX IF NOT EXISTS idx_live_events_type_time ON live_events(event_type, event_at DESC);
      CREATE INDEX IF NOT EXISTS idx_live_events_user_time ON live_events(user_handle, user_name, event_at DESC);
      CREATE INDEX IF NOT EXISTS idx_live_events_gifts ON live_events(session_id, coins DESC, event_at DESC)
        WHERE event_type IN ('gift', 'subscriber');

      CREATE TABLE IF NOT EXISTS live_session_users (
        session_id TEXT NOT NULL,
        user_key TEXT NOT NULL,
        user_name TEXT NOT NULL DEFAULT '',
        user_handle TEXT NOT NULL DEFAULT '',
        messages INTEGER NOT NULL DEFAULT 0,
        gifts INTEGER NOT NULL DEFAULT 0,
        gift_events INTEGER NOT NULL DEFAULT 0,
        subscribers INTEGER NOT NULL DEFAULT 0,
        joins INTEGER NOT NULL DEFAULT 0,
        shares INTEGER NOT NULL DEFAULT 0,
        likes INTEGER NOT NULL DEFAULT 0,
        coins INTEGER NOT NULL DEFAULT 0,
        appearances INTEGER NOT NULL DEFAULT 0,
        user_level INTEGER NOT NULL DEFAULT 0,
        badge TEXT NOT NULL DEFAULT '',
        first_seen_at INTEGER NOT NULL DEFAULT 0,
        last_seen_at INTEGER NOT NULL DEFAULT 0,
        last_message TEXT NOT NULL DEFAULT '',
        gift_types_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (session_id, user_key),
        FOREIGN KEY (session_id) REFERENCES live_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_live_users_coins ON live_session_users(session_id, coins DESC);
      CREATE INDEX IF NOT EXISTS idx_live_users_activity ON live_session_users(session_id, appearances DESC);

      CREATE TABLE IF NOT EXISTS live_alerts (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        alert_type TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'info',
        status TEXT NOT NULL DEFAULT '',
        account_id TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL DEFAULT '',
        user_name TEXT NOT NULL DEFAULT '',
        user_handle TEXT NOT NULL DEFAULT '',
        gift_name TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 0,
        coins INTEGER NOT NULL DEFAULT 0,
        risk_score INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        alert_at INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (session_id, id),
        FOREIGN KEY (session_id) REFERENCES live_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_live_alerts_time ON live_alerts(alert_at DESC);
      CREATE INDEX IF NOT EXISTS idx_live_alerts_risk ON live_alerts(risk_score DESC, alert_at DESC);

      CREATE TABLE IF NOT EXISTS live_viewer_samples (
        session_id TEXT NOT NULL,
        sampled_at INTEGER NOT NULL,
        current_viewers INTEGER NOT NULL DEFAULT 0,
        peak_viewers INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, sampled_at),
        FOREIGN KEY (session_id) REFERENCES live_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_live_viewers_session_time ON live_viewer_samples(session_id, sampled_at ASC);

      CREATE TABLE IF NOT EXISTS telegram_settings (
        setting_key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS telegram_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL DEFAULT '',
        telegram_user TEXT NOT NULL DEFAULT '',
        command TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_telegram_audit_time ON telegram_audit(created_at DESC);

      CREATE TABLE IF NOT EXISTS telegram_watch_users (
        user_key TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT 0
      );

      DELETE FROM archive_schema;
      INSERT INTO archive_schema(version, migrated_at) VALUES (2, unixepoch('now') * 1000);
    `);
    try { fs.chmodSync(this.dbPath, 0o600); } catch (_) { }
    this._prepare();
    return this.getStatus();
  }

  _prepare() {
    this.statements.upsertSession = this.db.prepare(`
      INSERT INTO live_sessions (
        id, owner, live_url, started_at, ended_at, created_at, updated_at,
        current_viewers, peak_viewers, total_events, chat_events, gift_events,
        subscriber_events, join_events, share_events, likes_total, coins_total,
        unique_users, metadata_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        owner = CASE WHEN excluded.owner <> '' THEN excluded.owner ELSE live_sessions.owner END,
        live_url = CASE WHEN excluded.live_url <> '' THEN excluded.live_url ELSE live_sessions.live_url END,
        started_at = CASE WHEN live_sessions.started_at = 0 THEN excluded.started_at ELSE MIN(live_sessions.started_at, excluded.started_at) END,
        ended_at = MAX(live_sessions.ended_at, excluded.ended_at),
        updated_at = MAX(live_sessions.updated_at, excluded.updated_at),
        current_viewers = excluded.current_viewers,
        peak_viewers = MAX(live_sessions.peak_viewers, excluded.peak_viewers),
        total_events = MAX(live_sessions.total_events, excluded.total_events),
        chat_events = MAX(live_sessions.chat_events, excluded.chat_events),
        gift_events = MAX(live_sessions.gift_events, excluded.gift_events),
        subscriber_events = MAX(live_sessions.subscriber_events, excluded.subscriber_events),
        join_events = MAX(live_sessions.join_events, excluded.join_events),
        share_events = MAX(live_sessions.share_events, excluded.share_events),
        likes_total = MAX(live_sessions.likes_total, excluded.likes_total),
        coins_total = MAX(live_sessions.coins_total, excluded.coins_total),
        unique_users = MAX(live_sessions.unique_users, excluded.unique_users),
        metadata_json = CASE
          WHEN excluded.metadata_json <> '{}' THEN excluded.metadata_json
          ELSE live_sessions.metadata_json
        END
    `);
    this.statements.insertEvent = this.db.prepare(`
      INSERT OR IGNORE INTO live_events (
        session_id, id, event_type, source_type, user_name, user_handle, text,
        translated_text, translated_lang, event_at, gift_name, room_id, quantity,
        unit_coins, coins, user_level, user_badge_name, gifter_rank,
        first_seen_private, payload_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    this.statements.upsertUser = this.db.prepare(`
      INSERT INTO live_session_users (
        session_id, user_key, user_name, user_handle, messages, gifts, gift_events,
        subscribers, joins, shares, likes, coins, appearances, user_level, badge,
        first_seen_at, last_seen_at, last_message, gift_types_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id, user_key) DO UPDATE SET
        user_name = excluded.user_name,
        user_handle = excluded.user_handle,
        messages = MAX(live_session_users.messages, excluded.messages),
        gifts = MAX(live_session_users.gifts, excluded.gifts),
        gift_events = MAX(live_session_users.gift_events, excluded.gift_events),
        subscribers = MAX(live_session_users.subscribers, excluded.subscribers),
        joins = MAX(live_session_users.joins, excluded.joins),
        shares = MAX(live_session_users.shares, excluded.shares),
        likes = MAX(live_session_users.likes, excluded.likes),
        coins = MAX(live_session_users.coins, excluded.coins),
        appearances = MAX(live_session_users.appearances, excluded.appearances),
        user_level = MAX(live_session_users.user_level, excluded.user_level),
        badge = CASE WHEN excluded.badge <> '' THEN excluded.badge ELSE live_session_users.badge END,
        first_seen_at = CASE WHEN live_session_users.first_seen_at = 0 THEN excluded.first_seen_at ELSE MIN(live_session_users.first_seen_at, excluded.first_seen_at) END,
        last_seen_at = MAX(live_session_users.last_seen_at, excluded.last_seen_at),
        last_message = CASE WHEN excluded.last_seen_at >= live_session_users.last_seen_at THEN excluded.last_message ELSE live_session_users.last_message END,
        gift_types_json = excluded.gift_types_json
    `);
    this.statements.upsertAlert = this.db.prepare(`
      INSERT INTO live_alerts (
        session_id, id, alert_type, severity, status, account_id, creator_id,
        user_name, user_handle, gift_name, quantity, coins, risk_score, title,
        text, alert_at, payload_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id, id) DO UPDATE SET
        severity = excluded.severity,
        status = excluded.status,
        risk_score = MAX(live_alerts.risk_score, excluded.risk_score),
        payload_json = excluded.payload_json
    `);
    this.statements.upsertViewer = this.db.prepare(`
      INSERT INTO live_viewer_samples (session_id, sampled_at, current_viewers, peak_viewers)
      VALUES (?,?,?,?)
      ON CONFLICT(session_id, sampled_at) DO UPDATE SET
        current_viewers = excluded.current_viewers,
        peak_viewers = MAX(live_viewer_samples.peak_viewers, excluded.peak_viewers)
    `);
  }

  persistSession(session, options = {}) {
    if (!this.db || !session?.id) return { events: 0, users: 0, alerts: 0 };
    const metadata = options.metadata && typeof options.metadata === "object" ? options.metadata : {};
    const events = Array.isArray(options.events) ? options.events : [];
    const skipSessionUpsert = options.skipSessionUpsert === true;
    const counts = session.counts || {};
    const currentViewers = Math.max(0, safeNumber(metadata.currentViewers, session.currentViewers || 0));
    const peakViewers = Math.max(currentViewers, safeNumber(metadata.peakViewers, session.peakViewers || 0));
    session.currentViewers = currentViewers;
    session.peakViewers = peakViewers;
    const touchedUsers = new Set(
      events
        .map((event) => String(event?.userHandle || event?.user || "").trim().toLowerCase())
        .filter(Boolean),
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!skipSessionUpsert) {
        this.statements.upsertSession.run(
          session.id,
          session.owner || "",
          session.liveUrl || "",
          safeNumber(session.startedAt, 0),
          safeNumber(session.endedAt, 0),
          safeNumber(session.createdAt, Date.now()),
          safeNumber(session.updatedAt, Date.now()),
          currentViewers,
          peakViewers,
          safeNumber(counts.total, 0),
          safeNumber(counts.chat, 0),
          safeNumber(counts.gifts, 0),
          safeNumber(counts.subscribers, 0),
          safeNumber(counts.joins, 0),
          safeNumber(counts.shares, 0),
          safeNumber(counts.likes, 0),
          safeNumber(counts.coins, 0),
          session.users instanceof Map ? session.users.size : 0,
          JSON.stringify(metadata),
        );
      }
      events.forEach((event) => {
        this.statements.insertEvent.run(
          session.id,
          event.id,
          event.type || "chat",
          event.sourceType || "",
          event.user || "",
          event.userHandle || "",
          event.text || "",
          event.translatedText || "",
          event.translatedLang || "",
          safeNumber(event.ts, Date.now()),
          event.giftName || "",
          event.roomId || "",
          safeNumber(event.quantity, 0),
          safeNumber(event.unitCoins, 0),
          safeNumber(event.coins, 0),
          safeNumber(event.userLevel, 0),
          event.userBadgeName || "",
          safeNumber(event.gifterRank, 0),
          event.firstSeenPrivate ? 1 : 0,
          JSON.stringify(event),
        );
      });
      if (session.users instanceof Map) {
        session.users.forEach((user, key) => {
          if (events.length && !touchedUsers.has(String(key).toLowerCase())) return;
          this.statements.upsertUser.run(
            session.id,
            String(key).toLowerCase(),
            user.user || "",
            user.userHandle || "",
            safeNumber(user.messages, 0),
            safeNumber(user.gifts, 0),
            safeNumber(user.giftEvents, 0),
            safeNumber(user.subscribers, 0),
            safeNumber(user.joins, 0),
            safeNumber(user.shares, 0),
            safeNumber(user.likes, 0),
            safeNumber(user.coins, 0),
            safeNumber(user.appearances, 0),
            safeNumber(user.level, 0),
            user.badge || "",
            safeNumber(user.firstSeenAt, 0),
            safeNumber(user.lastSeenAt, 0),
            user.lastMessage || "",
            JSON.stringify(user.giftTypes || {}),
          );
        });
      }
      (Array.isArray(session.alerts) ? session.alerts : []).forEach((alert) => {
        this.statements.upsertAlert.run(
          session.id,
          alert.id,
          alert.type || "",
          alert.severity || "info",
          alert.status || "",
          alert.accountId || "",
          alert.creatorId || "",
          alert.user || "",
          alert.userHandle || "",
          alert.giftName || "",
          safeNumber(alert.quantity, 0),
          safeNumber(alert.coins, 0),
          safeNumber(alert.riskScore, 0),
          alert.title || "",
          alert.text || "",
          safeNumber(alert.ts, Date.now()),
          JSON.stringify(alert),
        );
      });
      if (!skipSessionUpsert && Object.prototype.hasOwnProperty.call(metadata, "currentViewers")) {
        const sampledAt = Math.floor(Date.now() / 5000) * 5000;
        this.statements.upsertViewer.run(session.id, sampledAt, currentViewers, peakViewers);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch (_) { }
      throw error;
    }
    return { events: events.length, users: touchedUsers.size, alerts: session.alerts?.length || 0 };
  }

  importSessions(sessions) {
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      this.persistSession(session, { events: Array.isArray(session.events) ? session.events : [] });
      this.persistSession(session);
    });
  }

  endSession(session, metadata = {}) {
    if (!session) return;
    session.endedAt = Math.max(safeNumber(session.endedAt, 0), Date.now());
    session.updatedAt = Math.max(safeNumber(session.updatedAt, 0), session.endedAt);
    this.persistSession(session, { metadata });
  }

  getStatus() {
    const sessions = this.db.prepare("SELECT COUNT(*) AS count FROM live_sessions").get().count;
    const events = this.db.prepare("SELECT COUNT(*) AS count FROM live_events").get().count;
    const users = this.db.prepare("SELECT COUNT(*) AS count FROM live_session_users").get().count;
    const alerts = this.db.prepare("SELECT COUNT(*) AS count FROM live_alerts").get().count;
    const viewerSamples = this.db.prepare("SELECT COUNT(*) AS count FROM live_viewer_samples").get().count;
    return { ok: true, dbPath: this.dbPath, sessions, events, users, alerts, viewerSamples };
  }

  getOverview() {
    const totals = this.db.prepare(`
      SELECT
        COUNT(*) AS sessions,
        COALESCE(SUM(total_events), 0) AS events,
        COALESCE(SUM(chat_events), 0) AS chats,
        COALESCE(SUM(gift_events), 0) AS gifts,
        COALESCE(SUM(subscriber_events), 0) AS subscribers,
        COALESCE(SUM(join_events), 0) AS joins,
        COALESCE(SUM(share_events), 0) AS shares,
        COALESCE(SUM(likes_total), 0) AS likes,
        COALESCE(SUM(coins_total), 0) AS coins,
        COALESCE(MAX(peak_viewers), 0) AS peakViewers,
        COALESCE(MAX(updated_at), 0) AS lastActivityAt
      FROM live_sessions
    `).get();
    const uniqueAccounts = this.db.prepare(`
      SELECT COUNT(DISTINCT CASE WHEN user_handle <> '' THEN lower(user_handle) ELSE lower(user_name) END) AS count
      FROM live_session_users
    `).get().count;
    const topCreators = this.db.prepare(`
      SELECT owner, COUNT(*) AS sessions, SUM(total_events) AS events, SUM(coins_total) AS coins,
        MAX(peak_viewers) AS peakViewers, MAX(updated_at) AS lastActivityAt
      FROM live_sessions
      WHERE owner <> ''
      GROUP BY lower(owner)
      ORDER BY coins DESC, events DESC, lastActivityAt DESC
      LIMIT 20
    `).all();
    return { ...totals, uniqueAccounts, topCreators };
  }

  listSessions(options = {}) {
    const limit = normalizeLimit(options.limit, 100, 500);
    const offset = normalizeOffset(options.offset);
    const search = String(options.search || "").trim().toLowerCase();
    const where = search ? "WHERE lower(owner) LIKE ? OR lower(id) LIKE ?" : "";
    const args = search ? [`%${search}%`, `%${search}%`, limit, offset] : [limit, offset];
    const rows = this.db.prepare(`
      SELECT * FROM live_sessions
      ${where}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...args).map((row) => this._sessionRow(row));
    const countArgs = search ? [`%${search}%`, `%${search}%`] : [];
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM live_sessions ${where}`).get(...countArgs).count;
    return { rows, total, limit, offset, hasMore: total > offset + rows.length };
  }

  listCreators(options = {}) {
    const limit = normalizeLimit(options.limit, 100, 500);
    const offset = normalizeOffset(options.offset);
    const search = String(options.search || "").trim().toLowerCase();
    const searchWhere = search ? "AND lower(s.owner) LIKE ?" : "";
    const searchArgs = search ? [`%${search}%`] : [];
    const rows = this.db.prepare(`
      WITH creator_sessions AS (
        SELECT lower(owner) AS owner_key, MAX(owner) AS owner,
          COUNT(*) AS sessions,
          SUM(total_events) AS events,
          SUM(chat_events) AS chats,
          SUM(gift_events) AS gifts,
          SUM(coins_total) AS coins,
          MAX(peak_viewers) AS peak_viewers,
          MAX(updated_at) AS last_activity_at
        FROM live_sessions s
        WHERE owner <> '' ${searchWhere}
        GROUP BY lower(owner)
      ),
      creator_viewers AS (
        SELECT lower(s.owner) AS owner_key,
          COUNT(DISTINCT CASE
            WHEN u.user_handle <> '' THEN lower(u.user_handle)
            ELSE lower(u.user_name)
          END) AS viewers
        FROM live_sessions s
        JOIN live_session_users u ON u.session_id = s.id
        WHERE s.owner <> '' ${searchWhere}
        GROUP BY lower(s.owner)
      )
      SELECT cs.owner, cs.sessions, cs.events, cs.chats, cs.gifts, cs.coins,
        cs.peak_viewers AS peakViewers, cs.last_activity_at AS lastActivityAt,
        COALESCE(cv.viewers, 0) AS viewers
      FROM creator_sessions cs
      LEFT JOIN creator_viewers cv ON cv.owner_key = cs.owner_key
      ORDER BY cs.last_activity_at DESC, cs.events DESC
      LIMIT ? OFFSET ?
    `).all(...searchArgs, ...searchArgs, limit, offset);
    const total = this.db.prepare(`
      SELECT COUNT(DISTINCT lower(owner)) AS count
      FROM live_sessions
      WHERE owner <> '' ${search ? "AND lower(owner) LIKE ?" : ""}
    `).get(...searchArgs).count;
    return { rows, total, limit, offset, hasMore: total > offset + rows.length };
  }

  listCreatorViewers(owner, options = {}) {
    const limit = normalizeLimit(options.limit, 100, 1000);
    const offset = normalizeOffset(options.offset);
    const search = String(options.search || "").trim().toLowerCase();
    const clauses = ["lower(s.owner) = lower(?)"];
    const args = [String(owner || "")];
    if (search) {
      clauses.push("(lower(u.user_name) LIKE ? OR lower(u.user_handle) LIKE ?)");
      args.push(`%${search}%`, `%${search}%`);
    }
    const where = clauses.join(" AND ");
    const rows = this.db.prepare(`
      SELECT
        CASE WHEN u.user_handle <> '' THEN lower(u.user_handle) ELSE lower(u.user_name) END AS userKey,
        MAX(u.user_name) AS user,
        MAX(u.user_handle) AS userHandle,
        COUNT(DISTINCT u.session_id) AS sessions,
        SUM(u.messages) AS messages,
        SUM(u.gifts) AS gifts,
        SUM(u.gift_events) AS giftEvents,
        SUM(u.subscribers) AS subscribers,
        SUM(u.joins) AS joins,
        SUM(u.shares) AS shares,
        SUM(u.likes) AS likes,
        SUM(u.coins) AS coins,
        SUM(u.appearances) AS appearances,
        MAX(u.user_level) AS userLevel,
        MAX(u.badge) AS badge,
        MIN(CASE WHEN u.first_seen_at > 0 THEN u.first_seen_at END) AS firstSeenAt,
        MAX(u.last_seen_at) AS lastSeenAt,
        MAX(CASE WHEN u.last_seen_at = latest.latest_at THEN u.last_message ELSE '' END) AS lastMessage
      FROM live_session_users u
      JOIN live_sessions s ON s.id = u.session_id
      JOIN (
        SELECT
          CASE WHEN ux.user_handle <> '' THEN lower(ux.user_handle) ELSE lower(ux.user_name) END AS user_key,
          MAX(ux.last_seen_at) AS latest_at
        FROM live_session_users ux
        JOIN live_sessions sx ON sx.id = ux.session_id
        WHERE lower(sx.owner) = lower(?)
        GROUP BY user_key
      ) latest ON latest.user_key = CASE
        WHEN u.user_handle <> '' THEN lower(u.user_handle) ELSE lower(u.user_name)
      END
      WHERE ${where}
      GROUP BY userKey
      ORDER BY coins DESC, appearances DESC, lastSeenAt DESC
      LIMIT ? OFFSET ?
    `).all(String(owner || ""), ...args, limit, offset);
    const total = this.db.prepare(`
      SELECT COUNT(DISTINCT CASE
        WHEN u.user_handle <> '' THEN lower(u.user_handle)
        ELSE lower(u.user_name)
      END) AS count
      FROM live_session_users u
      JOIN live_sessions s ON s.id = u.session_id
      WHERE ${where}
    `).get(...args).count;
    const creator = this.db.prepare(`
      SELECT MAX(owner) AS owner, COUNT(*) AS sessions, MAX(updated_at) AS lastActivityAt
      FROM live_sessions WHERE lower(owner) = lower(?)
    `).get(String(owner || ""));
    return {
      creator: creator?.owner || String(owner || ""),
      creatorSessions: creator?.sessions || 0,
      lastActivityAt: creator?.lastActivityAt || 0,
      rows,
      total,
      limit,
      offset,
      hasMore: total > offset + rows.length,
    };
  }

  getUserArchive(userQuery, options = {}) {
    const normalizedUser = String(userQuery || "").trim().replace(/^@+/, "").toLowerCase();
    if (!normalizedUser) return null;
    const clauses = [
      "(lower(replace(e.user_handle, '@', '')) = ? OR lower(replace(e.user_name, '@', '')) = ?)",
    ];
    const args = [normalizedUser, normalizedUser];
    const creator = String(options.creator || "").trim().replace(/^@+/, "");
    const sessionId = String(options.sessionId || "").trim();
    const fromTs = Math.max(0, safeNumber(options.fromTs, 0));
    const toTs = Math.max(0, safeNumber(options.toTs, 0));
    if (creator) {
      clauses.push("lower(s.owner) = lower(?)");
      args.push(creator);
    }
    if (sessionId) {
      clauses.push("s.id = ?");
      args.push(sessionId);
    }
    if (fromTs) {
      clauses.push("e.event_at >= ?");
      args.push(fromTs);
    }
    if (toTs) {
      clauses.push("e.event_at < ?");
      args.push(toTs);
    }
    const where = clauses.join(" AND ");
    const summary = this.db.prepare(`
      SELECT
        MAX(e.user_name) AS user,
        MAX(e.user_handle) AS userHandle,
        COUNT(*) AS events,
        COUNT(DISTINCT e.session_id) AS sessions,
        COUNT(DISTINCT lower(s.owner)) AS creators,
        SUM(CASE WHEN e.event_type IN ('chat', 'caption') THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN e.event_type = 'gift' THEN 1 ELSE 0 END) AS giftEvents,
        SUM(CASE WHEN e.event_type IN ('gift', 'subscriber') THEN e.quantity ELSE 0 END) AS gifts,
        SUM(CASE WHEN e.event_type = 'subscriber' THEN 1 ELSE 0 END) AS subscribers,
        SUM(CASE WHEN e.event_type = 'join' THEN 1 ELSE 0 END) AS joins,
        SUM(CASE WHEN e.event_type = 'share' THEN 1 ELSE 0 END) AS shares,
        SUM(CASE WHEN e.event_type = 'like' THEN e.quantity ELSE 0 END) AS likes,
        SUM(e.coins) AS coins,
        MAX(e.user_level) AS userLevel,
        MIN(e.event_at) AS firstSeenAt,
        MAX(e.event_at) AS lastSeenAt
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
    `).get(...args);
    if (!summary?.events) return null;
    const streams = this.db.prepare(`
      SELECT
        s.id AS sessionId,
        MAX(s.owner) AS creator,
        MAX(s.live_url) AS liveUrl,
        MAX(s.started_at) AS startedAt,
        MAX(s.ended_at) AS endedAt,
        MAX(s.peak_viewers) AS peakViewers,
        COUNT(*) AS events,
        SUM(CASE WHEN e.event_type IN ('chat', 'caption') THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN e.event_type = 'gift' THEN 1 ELSE 0 END) AS giftEvents,
        SUM(CASE WHEN e.event_type IN ('gift', 'subscriber') THEN e.quantity ELSE 0 END) AS gifts,
        SUM(CASE WHEN e.event_type = 'subscriber' THEN 1 ELSE 0 END) AS subscribers,
        SUM(CASE WHEN e.event_type = 'join' THEN 1 ELSE 0 END) AS joins,
        SUM(CASE WHEN e.event_type = 'share' THEN 1 ELSE 0 END) AS shares,
        SUM(CASE WHEN e.event_type = 'like' THEN e.quantity ELSE 0 END) AS likes,
        SUM(e.coins) AS coins,
        MIN(e.event_at) AS firstSeenAt,
        MAX(e.event_at) AS lastSeenAt,
        MAX(CASE WHEN e.text <> '' THEN e.text ELSE '' END) AS lastMessage
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
      GROUP BY e.session_id
      ORDER BY lastSeenAt DESC
      LIMIT 100
    `).all(...args);
    const days = this.db.prepare(`
      SELECT strftime('%Y-%m-%d', e.event_at / 1000, 'unixepoch', 'localtime') AS day,
        COUNT(*) AS events,
        COUNT(DISTINCT e.session_id) AS sessions,
        SUM(CASE WHEN e.event_type IN ('chat', 'caption') THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN e.event_type IN ('gift', 'subscriber') THEN e.quantity ELSE 0 END) AS gifts,
        SUM(e.coins) AS coins,
        MIN(e.event_at) AS firstSeenAt,
        MAX(e.event_at) AS lastSeenAt
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
      GROUP BY day
      ORDER BY day DESC
      LIMIT 366
    `).all(...args);
    const creators = this.db.prepare(`
      SELECT MAX(s.owner) AS creator,
        COUNT(DISTINCT e.session_id) AS sessions,
        COUNT(*) AS events,
        SUM(CASE WHEN e.event_type IN ('chat', 'caption') THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN e.event_type IN ('gift', 'subscriber') THEN e.quantity ELSE 0 END) AS gifts,
        SUM(e.coins) AS coins,
        MIN(e.event_at) AS firstSeenAt,
        MAX(e.event_at) AS lastSeenAt
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
      GROUP BY lower(s.owner)
      ORDER BY lastSeenAt DESC
      LIMIT 100
    `).all(...args);
    const latestEvents = this.db.prepare(`
      SELECT e.id, e.event_type AS type, e.source_type AS sourceType,
        e.user_name AS user, e.user_handle AS userHandle, e.text,
        e.event_at AS ts, e.gift_name AS giftName, e.quantity, e.coins,
        e.user_level AS userLevel, s.id AS sessionId, s.owner AS creator
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
      ORDER BY e.event_at DESC, e.rowid DESC
      LIMIT 100
    `).all(...args);
    return {
      query: {
        user: normalizedUser,
        creator,
        sessionId,
        fromTs,
        toTs,
      },
      summary,
      streams,
      days,
      creators,
      latestEvents,
    };
  }

  getArchiveReport(options = {}) {
    const creator = String(options.creator || "").trim().replace(/^@+/, "");
    const fromTs = Math.max(0, safeNumber(options.fromTs, 0));
    const toTs = Math.max(0, safeNumber(options.toTs, 0));
    const clauses = ["1 = 1"];
    const args = [];
    if (creator) {
      clauses.push("lower(s.owner) = lower(?)");
      args.push(creator);
    }
    if (fromTs) {
      clauses.push("e.event_at >= ?");
      args.push(fromTs);
    }
    if (toTs) {
      clauses.push("e.event_at < ?");
      args.push(toTs);
    }
    const where = clauses.join(" AND ");
    const summary = this.db.prepare(`
      SELECT COUNT(*) AS events,
        COUNT(DISTINCT e.session_id) AS sessions,
        COUNT(DISTINCT lower(s.owner)) AS creators,
        COUNT(DISTINCT CASE
          WHEN e.user_handle <> '' THEN lower(e.user_handle)
          ELSE lower(e.user_name)
        END) AS users,
        SUM(CASE WHEN e.event_type IN ('chat', 'caption') THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN e.event_type = 'gift' THEN 1 ELSE 0 END) AS giftEvents,
        SUM(CASE WHEN e.event_type IN ('gift', 'subscriber') THEN e.quantity ELSE 0 END) AS gifts,
        SUM(CASE WHEN e.event_type = 'subscriber' THEN 1 ELSE 0 END) AS subscribers,
        SUM(CASE WHEN e.event_type = 'join' THEN 1 ELSE 0 END) AS joins,
        SUM(CASE WHEN e.event_type = 'share' THEN 1 ELSE 0 END) AS shares,
        SUM(CASE WHEN e.event_type = 'like' THEN e.quantity ELSE 0 END) AS likes,
        SUM(e.coins) AS coins,
        MAX(s.peak_viewers) AS peakViewers,
        MIN(e.event_at) AS firstActivityAt,
        MAX(e.event_at) AS lastActivityAt
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
    `).get(...args);
    const topUsers = this.db.prepare(`
      SELECT MAX(e.user_name) AS user, MAX(e.user_handle) AS userHandle,
        COUNT(DISTINCT e.session_id) AS sessions, COUNT(*) AS events,
        SUM(CASE WHEN e.event_type IN ('chat', 'caption') THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN e.event_type IN ('gift', 'subscriber') THEN e.quantity ELSE 0 END) AS gifts,
        SUM(e.coins) AS coins, MAX(e.event_at) AS lastSeenAt
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
      GROUP BY CASE WHEN e.user_handle <> '' THEN lower(e.user_handle) ELSE lower(e.user_name) END
      ORDER BY coins DESC, events DESC, lastSeenAt DESC
      LIMIT 50
    `).all(...args);
    const topGifts = this.db.prepare(`
      SELECT e.gift_name AS giftName, COUNT(*) AS events, SUM(e.quantity) AS quantity,
        SUM(e.coins) AS coins,
        COUNT(DISTINCT CASE
          WHEN e.user_handle <> '' THEN lower(e.user_handle)
          ELSE lower(e.user_name)
        END) AS users
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where} AND e.event_type IN ('gift', 'subscriber')
      GROUP BY e.gift_name
      ORDER BY coins DESC, quantity DESC
      LIMIT 50
    `).all(...args);
    const streams = this.db.prepare(`
      SELECT s.id AS sessionId, MAX(s.owner) AS creator, MAX(s.started_at) AS startedAt,
        MAX(s.ended_at) AS endedAt, MAX(s.peak_viewers) AS peakViewers,
        COUNT(*) AS events,
        COUNT(DISTINCT CASE
          WHEN e.user_handle <> '' THEN lower(e.user_handle)
          ELSE lower(e.user_name)
        END) AS users,
        SUM(CASE WHEN e.event_type IN ('chat', 'caption') THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN e.event_type IN ('gift', 'subscriber') THEN e.quantity ELSE 0 END) AS gifts,
        SUM(e.coins) AS coins
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
      GROUP BY e.session_id
      ORDER BY events DESC, coins DESC
      LIMIT 100
    `).all(...args);
    const daily = this.db.prepare(`
      SELECT strftime('%Y-%m-%d', e.event_at / 1000, 'unixepoch', 'localtime') AS day,
        COUNT(*) AS events,
        COUNT(DISTINCT e.session_id) AS sessions,
        COUNT(DISTINCT CASE
          WHEN e.user_handle <> '' THEN lower(e.user_handle)
          ELSE lower(e.user_name)
        END) AS users,
        SUM(CASE WHEN e.event_type IN ('chat', 'caption') THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN e.event_type IN ('gift', 'subscriber') THEN e.quantity ELSE 0 END) AS gifts,
        SUM(e.coins) AS coins
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
      GROUP BY day ORDER BY day ASC
    `).all(...args);
    const hourly = this.db.prepare(`
      SELECT CAST(strftime('%H', e.event_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
        COUNT(*) AS events,
        COUNT(DISTINCT e.session_id) AS sessions,
        COUNT(DISTINCT CASE
          WHEN e.user_handle <> '' THEN lower(e.user_handle)
          ELSE lower(e.user_name)
        END) AS users,
        SUM(e.coins) AS coins
      FROM live_events e
      JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
      GROUP BY hour ORDER BY events DESC, users DESC
    `).all(...args);
    return {
      query: { creator, fromTs, toTs },
      summary,
      topUsers,
      topGifts,
      streams,
      daily,
      hourly,
    };
  }

  searchArchiveEvents(options = {}) {
    const query = String(options.query || "").trim().toLowerCase();
    const creator = String(options.creator || "").trim().replace(/^@+/, "");
    const type = String(options.type || "").trim().toLowerCase();
    const fromTs = Math.max(0, safeNumber(options.fromTs, 0));
    const toTs = Math.max(0, safeNumber(options.toTs, 0));
    const limit = normalizeLimit(options.limit, 50, 500);
    const offset = normalizeOffset(options.offset);
    const clauses = ["1 = 1"];
    const args = [];
    if (query) {
      clauses.push(`(
        lower(e.user_name) LIKE ? OR lower(e.user_handle) LIKE ?
        OR lower(e.text) LIKE ? OR lower(e.gift_name) LIKE ?
      )`);
      args.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (creator) {
      clauses.push("lower(s.owner) = lower(?)");
      args.push(creator);
    }
    if (type) {
      clauses.push("e.event_type = ?");
      args.push(type);
    }
    if (fromTs) {
      clauses.push("e.event_at >= ?");
      args.push(fromTs);
    }
    if (toTs) {
      clauses.push("e.event_at < ?");
      args.push(toTs);
    }
    const where = clauses.join(" AND ");
    const rows = this.db.prepare(`
      SELECT e.id, e.event_type AS type, e.user_name AS user, e.user_handle AS userHandle,
        e.text, e.event_at AS ts, e.gift_name AS giftName, e.quantity, e.coins,
        e.session_id AS sessionId, s.owner AS creator
      FROM live_events e JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
      ORDER BY e.event_at DESC, e.rowid DESC LIMIT ? OFFSET ?
    `).all(...args, limit, offset);
    const total = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM live_events e JOIN live_sessions s ON s.id = e.session_id
      WHERE ${where}
    `).get(...args).count;
    return { rows, total, limit, offset, hasMore: total > offset + rows.length };
  }

  getCreatorAudience(owner, options = {}) {
    const creator = String(owner || "").trim().replace(/^@+/, "");
    const inactiveDays = Math.max(1, Math.min(3650, safeNumber(options.inactiveDays, 30)));
    const inactiveCutoff = Date.now() - inactiveDays * 86400000;
    const users = this.db.prepare(`
      SELECT
        CASE WHEN u.user_handle <> '' THEN lower(u.user_handle) ELSE lower(u.user_name) END AS userKey,
        MAX(u.user_name) AS user, MAX(u.user_handle) AS userHandle,
        COUNT(DISTINCT u.session_id) AS sessions,
        SUM(u.appearances) AS appearances, SUM(u.messages) AS messages,
        SUM(u.gifts) AS gifts, SUM(u.coins) AS coins, SUM(u.likes) AS likes,
        MIN(CASE WHEN u.first_seen_at > 0 THEN u.first_seen_at END) AS firstSeenAt,
        MAX(u.last_seen_at) AS lastSeenAt
      FROM live_session_users u
      JOIN live_sessions s ON s.id = u.session_id
      WHERE lower(s.owner) = lower(?)
      GROUP BY userKey
      ORDER BY coins DESC, appearances DESC, lastSeenAt DESC
    `).all(creator);
    const newUsers = users.filter((row) => row.sessions === 1);
    const returning = users.filter((row) => row.sessions >= 2);
    const loyal = users.filter((row) => row.sessions >= 3);
    const inactive = users.filter((row) => row.lastSeenAt > 0 && row.lastSeenAt < inactiveCutoff);
    const whales = users.filter((row) => row.coins >= Math.max(1, safeNumber(options.whaleCoins, 10000)));
    return {
      creator,
      total: users.length,
      counts: {
        new: newUsers.length,
        returning: returning.length,
        loyal: loyal.length,
        inactive: inactive.length,
        whales: whales.length,
      },
      newUsers: newUsers.slice(0, 100),
      returning: returning.slice(0, 100),
      loyal: loyal.slice(0, 100),
      inactive: inactive.slice(0, 100),
      whales: whales.slice(0, 100),
    };
  }

  compareCreatorAudiences(firstOwner, secondOwner) {
    const first = String(firstOwner || "").trim().replace(/^@+/, "");
    const second = String(secondOwner || "").trim().replace(/^@+/, "");
    const rows = this.db.prepare(`
      WITH first_users AS (
        SELECT DISTINCT CASE
          WHEN u.user_handle <> '' THEN lower(u.user_handle)
          ELSE lower(u.user_name)
        END AS user_key
        FROM live_session_users u JOIN live_sessions s ON s.id = u.session_id
        WHERE lower(s.owner) = lower(?)
      ),
      second_users AS (
        SELECT DISTINCT CASE
          WHEN u.user_handle <> '' THEN lower(u.user_handle)
          ELSE lower(u.user_name)
        END AS user_key
        FROM live_session_users u JOIN live_sessions s ON s.id = u.session_id
        WHERE lower(s.owner) = lower(?)
      )
      SELECT
        (SELECT COUNT(*) FROM first_users) AS firstUsers,
        (SELECT COUNT(*) FROM second_users) AS secondUsers,
        (SELECT COUNT(*) FROM first_users f JOIN second_users s ON s.user_key = f.user_key) AS sharedUsers
    `).get(first, second);
    return {
      first,
      second,
      ...rows,
      firstOnly: Math.max(0, rows.firstUsers - rows.sharedUsers),
      secondOnly: Math.max(0, rows.secondUsers - rows.sharedUsers),
    };
  }

  getTelegramSetting(key, fallback = {}) {
    const row = this.db.prepare(
      "SELECT value_json AS valueJson FROM telegram_settings WHERE setting_key = ?",
    ).get(String(key || ""));
    return row ? parseJson(row.valueJson, fallback) : fallback;
  }

  setTelegramSetting(key, value) {
    this.db.prepare(`
      INSERT INTO telegram_settings(setting_key, value_json, updated_at)
      VALUES(?,?,?)
      ON CONFLICT(setting_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(String(key || ""), JSON.stringify(value ?? {}), Date.now());
    return this.getTelegramSetting(key, {});
  }

  addTelegramAudit(entry = {}) {
    this.db.prepare(`
      INSERT INTO telegram_audit(chat_id, telegram_user, command, status, detail, created_at)
      VALUES(?,?,?,?,?,?)
    `).run(
      String(entry.chatId || ""),
      String(entry.telegramUser || ""),
      String(entry.command || "").slice(0, 500),
      String(entry.status || "").slice(0, 40),
      String(entry.detail || "").slice(0, 1000),
      Date.now(),
    );
  }

  listTelegramAudit(limit = 50) {
    return this.db.prepare(`
      SELECT id, chat_id AS chatId, telegram_user AS telegramUser, command,
        status, detail, created_at AS createdAt
      FROM telegram_audit ORDER BY created_at DESC LIMIT ?
    `).all(normalizeLimit(limit, 50, 500));
  }

  setWatchUser(user, enabled = true) {
    const key = String(user || "").trim().replace(/^@+/, "").toLowerCase();
    if (!key) return false;
    if (!enabled) {
      this.db.prepare("DELETE FROM telegram_watch_users WHERE user_key = ?").run(key);
      return false;
    }
    this.db.prepare(`
      INSERT INTO telegram_watch_users(user_key, label, created_at) VALUES(?,?,?)
      ON CONFLICT(user_key) DO UPDATE SET label = excluded.label
    `).run(key, String(user || "").trim(), Date.now());
    return true;
  }

  listWatchUsers() {
    return this.db.prepare(`
      SELECT user_key AS userKey, label, created_at AS createdAt
      FROM telegram_watch_users ORDER BY created_at DESC
    `).all();
  }

  createBackup() {
    const backupDir = path.join(this.dataDir, "backups");
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `live-archive-${stamp}.sqlite`);
    const escapedPath = backupPath.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escapedPath}'`);
    try { fs.chmodSync(backupPath, 0o600); } catch (_) { }
    const files = fs.readdirSync(backupDir)
      .filter((name) => /^live-archive-.*\.sqlite$/.test(name))
      .sort()
      .reverse();
    files.slice(14).forEach((name) => {
      try { fs.unlinkSync(path.join(backupDir, name)); } catch (_) { }
    });
    const stat = fs.statSync(backupPath);
    return { filename: path.basename(backupPath), bytes: stat.size, createdAt: stat.mtimeMs };
  }

  getBackupStatus() {
    const backupDir = path.join(this.dataDir, "backups");
    if (!fs.existsSync(backupDir)) return { count: 0, latest: null };
    const rows = fs.readdirSync(backupDir)
      .filter((name) => /^live-archive-.*\.sqlite$/.test(name))
      .map((name) => {
        const stat = fs.statSync(path.join(backupDir, name));
        return { filename: name, bytes: stat.size, createdAt: stat.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return { count: rows.length, latest: rows[0] || null };
  }

  deleteUserArchive(userQuery) {
    const normalized = String(userQuery || "").trim().replace(/^@+/, "").toLowerCase();
    if (!normalized) return { deletedEvents: 0, deletedUsers: 0, deletedAlerts: 0 };
    const matchSql = "(lower(replace(user_handle, '@', '')) = ? OR lower(replace(user_name, '@', '')) = ?)";
    const affected = this.db.prepare(`
      SELECT DISTINCT session_id AS sessionId FROM live_events WHERE ${matchSql}
    `).all(normalized, normalized).map((row) => row.sessionId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const deletedEvents = this.db.prepare(`DELETE FROM live_events WHERE ${matchSql}`)
        .run(normalized, normalized).changes;
      const deletedUsers = this.db.prepare(`
        DELETE FROM live_session_users
        WHERE lower(replace(user_handle, '@', '')) = ? OR lower(replace(user_name, '@', '')) = ?
      `).run(normalized, normalized).changes;
      const deletedAlerts = this.db.prepare(`
        DELETE FROM live_alerts
        WHERE lower(replace(user_handle, '@', '')) = ? OR lower(replace(user_name, '@', '')) = ?
      `).run(normalized, normalized).changes;
      const refresh = this.db.prepare(`
        UPDATE live_sessions SET
          total_events = (SELECT COUNT(*) FROM live_events e WHERE e.session_id = live_sessions.id),
          chat_events = (SELECT COUNT(*) FROM live_events e WHERE e.session_id = live_sessions.id AND e.event_type IN ('chat','caption')),
          gift_events = (SELECT COUNT(*) FROM live_events e WHERE e.session_id = live_sessions.id AND e.event_type = 'gift'),
          subscriber_events = (SELECT COUNT(*) FROM live_events e WHERE e.session_id = live_sessions.id AND e.event_type = 'subscriber'),
          join_events = (SELECT COUNT(*) FROM live_events e WHERE e.session_id = live_sessions.id AND e.event_type = 'join'),
          share_events = (SELECT COUNT(*) FROM live_events e WHERE e.session_id = live_sessions.id AND e.event_type = 'share'),
          likes_total = (SELECT COALESCE(SUM(quantity),0) FROM live_events e WHERE e.session_id = live_sessions.id AND e.event_type = 'like'),
          coins_total = (SELECT COALESCE(SUM(coins),0) FROM live_events e WHERE e.session_id = live_sessions.id),
          unique_users = (SELECT COUNT(*) FROM live_session_users u WHERE u.session_id = live_sessions.id)
        WHERE id = ?
      `);
      affected.forEach((sessionId) => refresh.run(sessionId));
      this.db.exec("COMMIT");
      return { deletedEvents, deletedUsers, deletedAlerts, affectedSessions: affected.length };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch (_) { }
      throw error;
    }
  }

  getSession(sessionId) {
    const row = this.db.prepare("SELECT * FROM live_sessions WHERE id = ?").get(String(sessionId || ""));
    if (!row) return null;
    const typeCounts = this.db.prepare(`
      SELECT event_type AS type, COUNT(*) AS events, SUM(quantity) AS quantity, SUM(coins) AS coins
      FROM live_events WHERE session_id = ? GROUP BY event_type ORDER BY events DESC
    `).all(sessionId);
    const topGifts = this.db.prepare(`
      SELECT gift_name AS giftName, COUNT(*) AS events, SUM(quantity) AS quantity, SUM(coins) AS coins,
        COUNT(DISTINCT CASE WHEN user_handle <> '' THEN lower(user_handle) ELSE lower(user_name) END) AS users
      FROM live_events
      WHERE session_id = ? AND event_type IN ('gift','subscriber')
      GROUP BY gift_name
      ORDER BY coins DESC, quantity DESC, events DESC
      LIMIT 100
    `).all(sessionId);
    return { ...this._sessionRow(row), typeCounts, topGifts };
  }

  getDashboardAggregate(sessionId, options = {}) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const points = normalizeLimit(options.points, 120, 240);
    const eventStats = this.db.prepare(`
      SELECT
        MIN(event_at) AS firstEventAt,
        MAX(event_at) AS lastEventAt,
        COUNT(*) AS events,
        SUM(CASE WHEN event_type IN ('chat','caption') THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN event_type IN ('gift','subscriber') THEN quantity ELSE 0 END) AS gifts,
        SUM(CASE WHEN event_type = 'gift' THEN 1 ELSE 0 END) AS giftEvents,
        SUM(coins) AS coins,
        COUNT(DISTINCT CASE WHEN user_handle <> '' THEN lower(user_handle) ELSE lower(user_name) END) AS users
      FROM live_events WHERE session_id = ?
    `).get(sessionId);
    const viewerStats = this.db.prepare(`
      SELECT COUNT(*) AS samples, ROUND(AVG(current_viewers), 2) AS average,
        MIN(current_viewers) AS minimum, MAX(current_viewers) AS maximum,
        MAX(peak_viewers) AS peak
      FROM live_viewer_samples WHERE session_id = ?
    `).get(sessionId);
    const viewerSeries = this.db.prepare(`
      WITH ordered AS (
        SELECT sampled_at AS ts, current_viewers AS viewers, peak_viewers AS peakViewers,
          ROW_NUMBER() OVER (ORDER BY sampled_at ASC) AS rn,
          COUNT(*) OVER () AS total
        FROM live_viewer_samples WHERE session_id = ?
      ),
      bucketed AS (
        SELECT CAST(((rn - 1) * ?) / MAX(total, 1) AS INTEGER) AS bucket,
          MIN(ts) AS ts, ROUND(AVG(viewers), 2) AS viewers, MAX(peakViewers) AS peakViewers
        FROM ordered GROUP BY bucket
      )
      SELECT ts, viewers, peakViewers FROM bucketed ORDER BY bucket ASC
    `).all(sessionId, points);
    const activityTrend = this.db.prepare(`
      WITH bounds AS (
        SELECT MIN(event_at) AS minTs, MAX(event_at) AS maxTs
        FROM live_events WHERE session_id = ?
      ),
      bucketed AS (
        SELECT
          CAST(((e.event_at - b.minTs) * ?) / MAX((b.maxTs - b.minTs) + 1, 1) AS INTEGER) AS bucket,
          b.minTs AS minTs, b.maxTs AS maxTs, e.*
        FROM live_events e CROSS JOIN bounds b
        WHERE e.session_id = ?
      )
      SELECT MIN(event_at) AS ts, COUNT(*) AS events,
        SUM(CASE WHEN event_type IN ('chat','caption') THEN 1 ELSE 0 END) AS messages,
        SUM(CASE WHEN event_type IN ('gift','subscriber') THEN quantity ELSE 0 END) AS gifts,
        SUM(coins) AS coins,
        COUNT(DISTINCT CASE WHEN user_handle <> '' THEN lower(user_handle) ELSE lower(user_name) END) AS users
      FROM bucketed GROUP BY bucket ORDER BY bucket ASC
    `).all(sessionId, points, sessionId);
    const topUsers = this.db.prepare(`
      SELECT user_name AS user, user_handle AS userHandle, messages, gifts,
        gift_events AS giftEvents, likes, coins, appearances,
        user_level AS userLevel, last_seen_at AS lastSeenAt
      FROM live_session_users WHERE session_id = ?
      ORDER BY coins DESC, appearances DESC, last_seen_at DESC
      LIMIT 25
    `).all(sessionId);
    const alertSummary = this.db.prepare(`
      SELECT COUNT(*) AS total, MAX(risk_score) AS maxRisk,
        SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high,
        SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) AS medium,
        MAX(alert_at) AS lastAlertAt
      FROM live_alerts WHERE session_id = ?
    `).get(sessionId);
    const firstTs = safeNumber(eventStats.firstEventAt, session.startedAt);
    const lastTs = safeNumber(eventStats.lastEventAt, session.endedAt || session.updatedAt);
    const durationMinutes = Math.max(0, (lastTs - firstTs) / 60000);
    const gifts = safeNumber(eventStats.gifts, 0);
    const giftEvents = safeNumber(eventStats.giftEvents, 0);
    const coins = safeNumber(eventStats.coins, 0);
    const perMinute = (value) => durationMinutes > 0
      ? Math.round((safeNumber(value, 0) / durationMinutes) * 100) / 100
      : 0;
    return {
      session,
      kpis: {
        durationMinutes: Math.round(durationMinutes * 100) / 100,
        messagesPerMinute: perMinute(eventStats.messages),
        eventsPerMinute: perMinute(eventStats.events),
        coinsPerMinute: perMinute(coins),
        averageCoinsPerGift: giftEvents > 0 ? Math.round((coins / giftEvents) * 100) / 100 : 0,
        averageGiftQuantity: giftEvents > 0 ? Math.round((gifts / giftEvents) * 100) / 100 : 0,
      },
      viewerStats: {
        samples: safeNumber(viewerStats.samples, 0),
        average: safeNumber(viewerStats.average, session.currentViewers),
        minimum: safeNumber(viewerStats.minimum, session.currentViewers),
        maximum: safeNumber(viewerStats.maximum, session.peakViewers),
        peak: safeNumber(viewerStats.peak, session.peakViewers),
      },
      viewerSeries,
      activityTrend,
      activityScale: {
        maxEvents: Math.max(0, ...activityTrend.map((row) => safeNumber(row.events, 0))),
        maxCoins: Math.max(0, ...activityTrend.map((row) => safeNumber(row.coins, 0))),
      },
      topUsers,
      alertSummary,
      meta: {
        points,
        rawEvents: safeNumber(eventStats.events, 0),
        rawViewerSamples: safeNumber(viewerStats.samples, 0),
        payloadRows: viewerSeries.length + activityTrend.length + topUsers.length,
      },
    };
  }

  listEvents(sessionId, options = {}) {
    const limit = normalizeLimit(options.limit, 200, 1000);
    const offset = normalizeOffset(options.offset);
    const type = String(options.type || "").trim().toLowerCase();
    const search = String(options.search || "").trim().toLowerCase();
    const clauses = ["session_id = ?"];
    const args = [sessionId];
    if (type) {
      clauses.push("event_type = ?");
      args.push(type);
    }
    if (search) {
      clauses.push("(lower(user_name) LIKE ? OR lower(user_handle) LIKE ? OR lower(text) LIKE ? OR lower(gift_name) LIKE ?)");
      args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = clauses.join(" AND ");
    const rows = this.db.prepare(`
      SELECT session_id AS sessionId, id, event_type AS type, source_type AS sourceType,
        user_name AS user, user_handle AS userHandle, text, translated_text AS translatedText,
        translated_lang AS translatedLang, event_at AS ts, gift_name AS giftName, room_id AS roomId,
        quantity, unit_coins AS unitCoins, coins, user_level AS userLevel,
        user_badge_name AS userBadgeName, gifter_rank AS gifterRank,
        first_seen_private AS firstSeenPrivate
      FROM live_events WHERE ${where}
      ORDER BY event_at DESC, rowid DESC LIMIT ? OFFSET ?
    `).all(...args, limit, offset);
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM live_events WHERE ${where}`).get(...args).count;
    return { rows, total, limit, offset, hasMore: total > offset + rows.length };
  }

  listUsers(sessionId, options = {}) {
    const limit = normalizeLimit(options.limit, 200, 1000);
    const offset = normalizeOffset(options.offset);
    const rows = this.db.prepare(`
      SELECT user_key AS userKey, user_name AS user, user_handle AS userHandle,
        messages, gifts, gift_events AS giftEvents, subscribers, joins, shares,
        likes, coins, appearances, user_level AS userLevel, badge,
        first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, last_message AS lastMessage,
        gift_types_json AS giftTypesJson
      FROM live_session_users WHERE session_id = ?
      ORDER BY coins DESC, appearances DESC, last_seen_at DESC
      LIMIT ? OFFSET ?
    `).all(sessionId, limit, offset).map((row) => ({
      ...row,
      giftTypes: parseJson(row.giftTypesJson, {}),
      giftTypesJson: undefined,
    }));
    const total = this.db.prepare("SELECT COUNT(*) AS count FROM live_session_users WHERE session_id = ?").get(sessionId).count;
    return { rows, total, limit, offset, hasMore: total > offset + rows.length };
  }

  listAlerts(sessionId, options = {}) {
    const limit = normalizeLimit(options.limit, 100, 500);
    const offset = normalizeOffset(options.offset);
    const rows = this.db.prepare(`
      SELECT payload_json AS payloadJson FROM live_alerts
      WHERE session_id = ? ORDER BY alert_at DESC LIMIT ? OFFSET ?
    `).all(sessionId, limit, offset).map((row) => parseJson(row.payloadJson, {}));
    const total = this.db.prepare("SELECT COUNT(*) AS count FROM live_alerts WHERE session_id = ?").get(sessionId).count;
    return { rows, total, limit, offset, hasMore: total > offset + rows.length };
  }

  listViewerSamples(sessionId, options = {}) {
    const limit = normalizeLimit(options.limit, 1000, 10000);
    const rows = this.db.prepare(`
      SELECT sampled_at AS ts, current_viewers AS viewers, peak_viewers AS peakViewers
      FROM live_viewer_samples WHERE session_id = ?
      ORDER BY sampled_at DESC LIMIT ?
    `).all(sessionId, limit).reverse();
    return { rows, total: rows.length, limit };
  }

  deleteTestSession(sessionId) {
    const id = String(sessionId || "");
    if (!id.startsWith("test-")) return { deleted: false };
    const result = this.db.prepare("DELETE FROM live_sessions WHERE id = ?").run(id);
    return { deleted: Number(result.changes || 0) > 0 };
  }

  _sessionRow(row) {
    return {
      id: row.id,
      owner: row.owner,
      liveUrl: row.live_url,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      currentViewers: row.current_viewers,
      peakViewers: row.peak_viewers,
      uniqueUsers: row.unique_users,
      counts: {
        total: row.total_events,
        chat: row.chat_events,
        gifts: row.gift_events,
        subscribers: row.subscriber_events,
        joins: row.join_events,
        shares: row.share_events,
        likes: row.likes_total,
        coins: row.coins_total,
      },
      metadata: parseJson(row.metadata_json, {}),
    };
  }

  close() {
    this.db?.close();
    this.db = null;
  }
}

module.exports = LiveSessionStore;
