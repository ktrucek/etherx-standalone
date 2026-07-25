"use strict";

const fs = require("fs");
const path = require("path");

function loadOptional(moduleName) {
    try {
        return require(moduleName);
    } catch (_) {
        return null;
    }
}

function safeText(value, max = 500) {
    return String(value || "").replace(/[\u0000-\u001F]/g, "").trim().slice(0, max);
}

function safeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function safeBoolean(value) {
    return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeAccountId(value) {
    return safeText(value, 120).replace(/^@+/, "").toLowerCase();
}

function severityRank(value) {
    const normalized = String(value || "").toLowerCase();
    if (normalized === "critical") return 4;
    if (normalized === "high") return 3;
    if (normalized === "warning") return 2;
    if (normalized === "info") return 1;
    return 0;
}

function statusRank(value) {
    const normalized = String(value || "").toUpperCase();
    if (normalized === "CONFIRMED_AGENCY") return 4;
    if (normalized === "SUSPECTED") return 3;
    if (normalized === "WHALE") return 2;
    if (normalized === "CLEAR") return 1;
    return 0;
}

class DetectorStore {
    constructor(options = {}) {
        this.dataDir = options.dataDir || path.join(__dirname, "data");
        this.watchlistFile = options.watchlistFile || path.join(this.dataDir, "watchlist-accounts.json");
        this.alertsFile = options.alertsFile || path.join(this.dataDir, "watchlist-alerts.json");
        this.postgresUrl = safeText(options.postgresUrl || process.env.DETECTOR_POSTGRES_URL, 4000);
        this.redisUrl = safeText(options.redisUrl || process.env.DETECTOR_REDIS_URL, 4000);
        this.telegramBotToken = safeText(options.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN, 500);
        this.telegramChatId = safeText(options.telegramChatId || process.env.TELEGRAM_CHAT_ID, 120);
        this.maxRecentAlerts = Math.max(20, Math.min(1000, safeNumber(options.maxRecentAlerts, 200)));
        this.watchlist = new Map();
        this.recentAlerts = [];
        this.pg = null;
        this.redis = null;
        this.persistTimer = null;
    }

    async init() {
        this._loadFromDisk();
        await this._initPostgres();
        await this._initRedis();
    }

    size() {
        return this.watchlist.size;
    }

    getWatchlistEntry(accountId) {
        const key = normalizeAccountId(accountId);
        if (!key) return null;
        return this.watchlist.get(key) || null;
    }

    listWatchlist(limit = 200) {
        return Array.from(this.watchlist.values())
            .sort((a, b) => statusRank(b.status) - statusRank(a.status)
                || safeNumber(b.risk_score, 0) - safeNumber(a.risk_score, 0)
                || safeNumber(b.total_coins_sent, 0) - safeNumber(a.total_coins_sent, 0)
                || String(a.account_id || "").localeCompare(String(b.account_id || "")))
            .slice(0, Math.max(1, Math.min(5000, safeNumber(limit, 200))));
    }

    listRecentAlerts(limit = 100) {
        return this.recentAlerts.slice(0, Math.max(1, Math.min(1000, safeNumber(limit, 100))));
    }

    async upsertWatchlistEntry(input = {}) {
        const accountId = normalizeAccountId(input.account_id || input.userHandle || input.user);
        if (!accountId) throw new Error("account_id is required");
        const existing = this.watchlist.get(accountId) || this._defaultEntry(accountId);
        const merged = this._normalizeEntry({
            ...existing,
            ...input,
            account_id: accountId,
            status: this._chooseStatus(existing.status, safeText(input.status || existing.status || "CLEAR", 40).toUpperCase() || "CLEAR"),
            first_seen_private: safeBoolean(input.first_seen_private ?? existing.first_seen_private),
            target_creators: Array.isArray(input.target_creators) ? input.target_creators : existing.target_creators,
            total_coins_sent: safeNumber(input.total_coins_sent, existing.total_coins_sent),
            total_gift_events: safeNumber(input.total_gift_events, existing.total_gift_events),
            total_chat_messages: safeNumber(input.total_chat_messages, existing.total_chat_messages),
            risk_score: Math.max(safeNumber(existing.risk_score, 0), safeNumber(input.risk_score, existing.risk_score)),
            behavior_flags: Array.isArray(input.behavior_flags) ? input.behavior_flags : existing.behavior_flags,
            metadata: typeof input.metadata === "object" && input.metadata ? { ...existing.metadata, ...input.metadata } : existing.metadata,
            notes: safeText(input.notes || existing.notes || "", 1000),
            updated_at: Date.now(),
        });
        this.watchlist.set(accountId, merged);
        this._schedulePersist();
        await Promise.allSettled([this._syncEntryToPostgres(merged), this._syncEntryToRedis(merged)]);
        return merged;
    }

    async recordObservation({ session, event, userState, detection }) {
        const accountId = normalizeAccountId(event?.userHandle || event?.user || userState?.userHandle || userState?.user);
        if (!accountId) return null;
        const existing = this.watchlist.get(accountId) || this._defaultEntry(accountId);
        const creatorId = safeText(session?.owner || session?.liveUrl || session?.id || "unknown", 120);
        const metadata = existing.metadata && typeof existing.metadata === "object" ? { ...existing.metadata } : {};
        const creatorStats = metadata.creatorStats && typeof metadata.creatorStats === "object" ? { ...metadata.creatorStats } : {};
        const creatorRow = creatorStats[creatorId] && typeof creatorStats[creatorId] === "object"
            ? { ...creatorStats[creatorId] }
            : { coins: 0, gifts: 0, chats: 0, lastSeenAt: 0 };

        const type = safeText(event?.type, 40).toLowerCase();
        const coins = Math.max(0, safeNumber(event?.coins, 0));
        const quantity = Math.max(1, safeNumber(event?.quantity, 1));

        if (type === "chat") {
            creatorRow.chats += 1;
            existing.total_chat_messages = safeNumber(existing.total_chat_messages, 0) + 1;
        }
        if (type === "gift" || type === "subscriber") {
            creatorRow.coins += coins;
            creatorRow.gifts += quantity;
            existing.total_coins_sent = safeNumber(existing.total_coins_sent, 0) + coins;
            existing.total_gift_events = safeNumber(existing.total_gift_events, 0) + 1;
        }
        creatorRow.lastSeenAt = Math.max(safeNumber(creatorRow.lastSeenAt, 0), safeNumber(event?.ts, Date.now()));
        creatorStats[creatorId] = creatorRow;
        metadata.creatorStats = creatorStats;
        metadata.lastGiftName = safeText(event?.giftName || metadata.lastGiftName || "", 120);
        metadata.lastRoomId = safeText(event?.roomId || metadata.lastRoomId || "", 160);

        const nextFlags = new Set(Array.isArray(existing.behavior_flags) ? existing.behavior_flags : []);
        (Array.isArray(detection?.behaviorFlags) ? detection.behaviorFlags : []).forEach((flag) => {
            const normalized = safeText(flag, 120);
            if (normalized) nextFlags.add(normalized);
        });

        const nextCreators = new Set(Array.isArray(existing.target_creators) ? existing.target_creators : []);
        if (creatorId) nextCreators.add(creatorId);

        const merged = this._normalizeEntry({
            ...existing,
            account_id: accountId,
            status: this._chooseStatus(existing.status, detection?.suggestedStatus || existing.status || "CLEAR"),
            first_seen_private: safeBoolean(existing.first_seen_private || event?.firstSeenPrivate || event?.isPrivateProfile),
            target_creators: Array.from(nextCreators),
            behavior_flags: Array.from(nextFlags),
            last_creator: creatorId,
            last_seen_at: Math.max(safeNumber(existing.last_seen_at, 0), safeNumber(event?.ts, Date.now())),
            first_seen_at: safeNumber(existing.first_seen_at, 0) || safeNumber(event?.ts, Date.now()),
            risk_score: Math.max(safeNumber(existing.risk_score, 0), safeNumber(detection?.riskScore, 0)),
            metadata,
            updated_at: Date.now(),
        });

        this.watchlist.set(accountId, merged);
        this._schedulePersist();
        const pending = [this._syncEntryToPostgres(merged), this._syncEntryToRedis(merged)];
        if (detection?.shouldAlert && detection?.alert) {
            this.recentAlerts = [detection.alert, ...this.recentAlerts.filter((row) => row.id !== detection.alert.id)]
                .sort((a, b) => safeNumber(b.ts, 0) - safeNumber(a.ts, 0))
                .slice(0, this.maxRecentAlerts);
            this._schedulePersist();
            pending.push(this._syncAlertToPostgres(detection.alert), this._syncAlertToRedis(detection.alert), this._sendTelegramAlert(detection.alert));
        }
        await Promise.allSettled(pending);
        return merged;
    }

    _loadFromDisk() {
        fs.mkdirSync(this.dataDir, { recursive: true });
        try {
            if (fs.existsSync(this.watchlistFile)) {
                const parsed = JSON.parse(fs.readFileSync(this.watchlistFile, "utf8"));
                const rows = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
                rows.forEach((entry) => {
                    const normalized = this._normalizeEntry(entry);
                    if (normalized.account_id) this.watchlist.set(normalized.account_id, normalized);
                });
            }
        } catch (error) {
            console.warn("[detector] Ne mogu učitati watchlist JSON:", error.message);
        }
        try {
            if (fs.existsSync(this.alertsFile)) {
                const parsed = JSON.parse(fs.readFileSync(this.alertsFile, "utf8"));
                this.recentAlerts = Array.isArray(parsed?.alerts) ? parsed.alerts.slice(0, this.maxRecentAlerts) : [];
            }
        } catch (error) {
            console.warn("[detector] Ne mogu učitati alerts JSON:", error.message);
        }
    }

    _schedulePersist() {
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            this._persistToDisk();
        }, 250);
    }

    _persistToDisk() {
        try {
            fs.mkdirSync(this.dataDir, { recursive: true });
            fs.writeFileSync(`${this.watchlistFile}.tmp`, JSON.stringify({
                version: 1,
                savedAt: new Date().toISOString(),
                accounts: Array.from(this.watchlist.values()),
            }, null, 2), "utf8");
            fs.renameSync(`${this.watchlistFile}.tmp`, this.watchlistFile);
            fs.writeFileSync(`${this.alertsFile}.tmp`, JSON.stringify({
                version: 1,
                savedAt: new Date().toISOString(),
                alerts: this.recentAlerts,
            }, null, 2), "utf8");
            fs.renameSync(`${this.alertsFile}.tmp`, this.alertsFile);
        } catch (error) {
            console.warn("[detector] Persist JSON nije uspio:", error.message);
        }
    }

    _defaultEntry(accountId) {
        return this._normalizeEntry({
            account_id: accountId,
            status: "CLEAR",
            first_seen_private: false,
            target_creators: [],
            total_coins_sent: 0,
            total_gift_events: 0,
            total_chat_messages: 0,
            risk_score: 0,
            behavior_flags: [],
            notes: "",
            metadata: {},
            first_seen_at: 0,
            last_seen_at: 0,
            updated_at: Date.now(),
        });
    }

    _normalizeEntry(entry = {}) {
        const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
        return {
            account_id: normalizeAccountId(entry.account_id || entry.userHandle || entry.user),
            status: safeText(entry.status || "CLEAR", 40).toUpperCase() || "CLEAR",
            first_seen_private: safeBoolean(entry.first_seen_private),
            target_creators: Array.from(new Set((Array.isArray(entry.target_creators) ? entry.target_creators : [])
                .map((value) => safeText(value, 120))
                .filter(Boolean))),
            total_coins_sent: Math.max(0, safeNumber(entry.total_coins_sent, 0)),
            total_gift_events: Math.max(0, safeNumber(entry.total_gift_events, 0)),
            total_chat_messages: Math.max(0, safeNumber(entry.total_chat_messages, 0)),
            risk_score: Math.max(0, Math.min(100, safeNumber(entry.risk_score, 0))),
            behavior_flags: Array.from(new Set((Array.isArray(entry.behavior_flags) ? entry.behavior_flags : [])
                .map((value) => safeText(value, 120))
                .filter(Boolean))),
            notes: safeText(entry.notes, 1000),
            last_creator: safeText(entry.last_creator, 120),
            first_seen_at: Math.max(0, safeNumber(entry.first_seen_at, 0)),
            last_seen_at: Math.max(0, safeNumber(entry.last_seen_at, 0)),
            updated_at: Math.max(0, safeNumber(entry.updated_at, Date.now())),
            metadata,
        };
    }

    _chooseStatus(currentStatus, nextStatus) {
        return statusRank(currentStatus) >= statusRank(nextStatus) ? currentStatus : nextStatus;
    }

    async _initPostgres() {
        if (!this.postgresUrl) return;
        const pg = loadOptional("pg");
        if (!pg?.Pool) {
            console.warn("[detector] pg modul nije instaliran; PostgreSQL sync preskačem.");
            return;
        }
        this.pg = new pg.Pool({ connectionString: this.postgresUrl });
        await this.pg.query(`
      CREATE TABLE IF NOT EXISTS detector_watchlist_accounts (
        account_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'CLEAR',
        first_seen_private BOOLEAN NOT NULL DEFAULT FALSE,
        target_creators JSONB NOT NULL DEFAULT '[]'::jsonb,
        total_coins_sent BIGINT NOT NULL DEFAULT 0,
        total_gift_events BIGINT NOT NULL DEFAULT 0,
        total_chat_messages BIGINT NOT NULL DEFAULT 0,
        risk_score INTEGER NOT NULL DEFAULT 0,
        behavior_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
        notes TEXT NOT NULL DEFAULT '',
        last_creator TEXT NOT NULL DEFAULT '',
        first_seen_at BIGINT NOT NULL DEFAULT 0,
        last_seen_at BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT 0,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE IF NOT EXISTS detector_alerts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL DEFAULT '',
        account_id TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'info',
        status TEXT NOT NULL DEFAULT 'CLEAR',
        risk_score INTEGER NOT NULL DEFAULT 0,
        coins BIGINT NOT NULL DEFAULT 0,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at BIGINT NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_detector_alerts_created_at ON detector_alerts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_detector_alerts_account_id ON detector_alerts(account_id, created_at DESC);
    `);
    }

    async _initRedis() {
        if (!this.redisUrl) return;
        const redis = loadOptional("redis");
        if (!redis?.createClient) {
            console.warn("[detector] redis modul nije instaliran; Redis cache preskačem.");
            return;
        }
        const client = redis.createClient({ url: this.redisUrl });
        client.on("error", (error) => console.warn("[detector] Redis warning:", error.message));
        await client.connect();
        this.redis = client;
    }

    async _syncEntryToPostgres(entry) {
        if (!this.pg || !entry?.account_id) return;
        await this.pg.query(
            `INSERT INTO detector_watchlist_accounts (
        account_id, status, first_seen_private, target_creators, total_coins_sent,
        total_gift_events, total_chat_messages, risk_score, behavior_flags, notes,
        last_creator, first_seen_at, last_seen_at, updated_at, metadata
      ) VALUES (
        $1,$2,$3,$4::jsonb,$5,
        $6,$7,$8,$9::jsonb,$10,
        $11,$12,$13,$14,$15::jsonb
      )
      ON CONFLICT (account_id) DO UPDATE SET
        status = EXCLUDED.status,
        first_seen_private = EXCLUDED.first_seen_private,
        target_creators = EXCLUDED.target_creators,
        total_coins_sent = EXCLUDED.total_coins_sent,
        total_gift_events = EXCLUDED.total_gift_events,
        total_chat_messages = EXCLUDED.total_chat_messages,
        risk_score = EXCLUDED.risk_score,
        behavior_flags = EXCLUDED.behavior_flags,
        notes = EXCLUDED.notes,
        last_creator = EXCLUDED.last_creator,
        first_seen_at = LEAST(detector_watchlist_accounts.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(detector_watchlist_accounts.last_seen_at, EXCLUDED.last_seen_at),
        updated_at = EXCLUDED.updated_at,
        metadata = EXCLUDED.metadata`,
            [
                entry.account_id,
                entry.status,
                entry.first_seen_private,
                JSON.stringify(entry.target_creators || []),
                safeNumber(entry.total_coins_sent, 0),
                safeNumber(entry.total_gift_events, 0),
                safeNumber(entry.total_chat_messages, 0),
                safeNumber(entry.risk_score, 0),
                JSON.stringify(entry.behavior_flags || []),
                entry.notes || "",
                entry.last_creator || "",
                safeNumber(entry.first_seen_at, 0),
                safeNumber(entry.last_seen_at, 0),
                safeNumber(entry.updated_at, Date.now()),
                JSON.stringify(entry.metadata || {}),
            ],
        );
    }

    async _syncEntryToRedis(entry) {
        if (!this.redis || !entry?.account_id) return;
        await this.redis.set(`ttd:watchlist:${entry.account_id}`, JSON.stringify(entry));
    }

    async _syncAlertToPostgres(alert) {
        if (!this.pg || !alert?.id) return;
        await this.pg.query(
            `INSERT INTO detector_alerts (id, session_id, account_id, creator_id, severity, status, risk_score, coins, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       ON CONFLICT (id) DO NOTHING`,
            [
                alert.id,
                alert.sessionId || "",
                alert.accountId || "",
                alert.creatorId || "",
                alert.severity || "info",
                alert.status || "CLEAR",
                safeNumber(alert.riskScore, 0),
                safeNumber(alert.coins, 0),
                JSON.stringify(alert),
                safeNumber(alert.ts, Date.now()),
            ],
        );
    }

    async _syncAlertToRedis(alert) {
        if (!this.redis || !alert?.id) return;
        await this.redis.lPush("ttd:alerts", JSON.stringify(alert));
        await this.redis.lTrim("ttd:alerts", 0, this.maxRecentAlerts - 1);
    }

    async _sendTelegramAlert(alert) {
        if (!this.telegramBotToken || !this.telegramChatId || !alert?.id || severityRank(alert.severity) < severityRank("high")) return;
        const text = [
            `🚨 ${safeText(alert.title || "TikTok detector alert", 140)}`,
            alert.accountId ? `Račun: @${safeText(alert.accountId, 80)}` : "",
            alert.creatorId ? `Kreator: ${safeText(alert.creatorId, 80)}` : "",
            `Gift: ${safeText(alert.giftName || "Gift", 80)} ×${Math.max(1, safeNumber(alert.quantity, 1))}`,
            `Coins: ${safeNumber(alert.coins, 0).toLocaleString("hr-HR")}`,
            `Risk: ${safeNumber(alert.riskScore, 0)}% (${safeText(alert.status || "CLEAR", 40)})`,
            Array.isArray(alert.reasons) && alert.reasons.length ? `Razlozi: ${alert.reasons.slice(0, 3).join(" | ")}` : "",
        ].filter(Boolean).join("\n");
        try {
            await fetch(`https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    chat_id: this.telegramChatId,
                    text,
                    disable_web_page_preview: true,
                }),
            });
        } catch (error) {
            console.warn("[detector] Telegram alert nije uspio:", error.message);
        }
    }
}

module.exports = DetectorStore;