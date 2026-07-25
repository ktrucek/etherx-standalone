"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const DetectorStore = require("../live-chat-server/detector-store");
const { inspectGiftRisk } = require("../live-chat-server/gift-detector");

const repoRoot = path.join(__dirname, "..");
const liveDataFile = path.join(repoRoot, "live-chat-server", "data", "live-sessions.json");
const sqlitePath = String(process.env.ETHERX_SQLITE_DB_PATH || "").trim();

function safeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

async function importSnapshot(store) {
    if (!fs.existsSync(liveDataFile)) return { sessions: 0, events: 0 };
    const parsed = JSON.parse(fs.readFileSync(liveDataFile, "utf8"));
    const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    let eventCount = 0;
    for (const session of sessions) {
        const sessionInfo = { id: session?.id || "snapshot", owner: session?.owner || "", liveUrl: session?.liveUrl || "" };
        const users = new Map(Array.isArray(session?.users) ? session.users : []);
        for (const rawEvent of Array.isArray(session?.events) ? session.events : []) {
            const type = String(rawEvent?.type || "chat").toLowerCase();
            const userState = users.get(String((rawEvent?.userHandle || rawEvent?.user || "")).toLowerCase()) || {
                user: rawEvent?.user || "",
                userHandle: rawEvent?.userHandle || "",
                messages: 0,
                giftEvents: type === "gift" || type === "subscriber" ? 1 : 0,
                appearances: 1,
            };
            const detection = (type === "gift" || type === "subscriber")
                ? inspectGiftRisk({ session: sessionInfo, event: rawEvent, userState, watchEntry: store.getWatchlistEntry(rawEvent?.userHandle || rawEvent?.user) })
                : null;
            const alert = detection?.shouldAlert ? {
                id: `import:${rawEvent?.id || `${rawEvent?.ts || Date.now()}:${rawEvent?.userHandle || rawEvent?.user || "unknown"}`}`,
                sessionId: sessionInfo.id,
                accountId: detection.accountId,
                creatorId: detection.creatorId,
                severity: detection.severity,
                status: detection.suggestedStatus,
                riskScore: detection.riskScore,
                coins: detection.coins,
                giftName: rawEvent?.giftName || rawEvent?.text || "Gift",
                quantity: rawEvent?.quantity || 1,
                reasons: detection.reasons,
                title: detection.title,
                text: detection.text,
                ts: safeNumber(rawEvent?.ts, Date.now()),
            } : null;
            await store.recordObservation({ session: sessionInfo, event: rawEvent, userState, detection: detection ? { ...detection, alert } : null });
            eventCount += 1;
        }
    }
    return { sessions: sessions.length, events: eventCount };
}

async function importSQLite(store) {
    if (!sqlitePath || !fs.existsSync(sqlitePath)) return { imported: 0, dbPath: sqlitePath || "" };
    const db = new Database(sqlitePath, { readonly: true });
    const rows = db.prepare(`
    SELECT session_key, username, event_type, event_at, text, gift_name, quantity, coins, payload_json
    FROM tiktok_live_events
    ORDER BY event_at ASC
  `).all();
    let imported = 0;
    for (const row of rows) {
        let payload = {};
        try { payload = JSON.parse(String(row.payload_json || "{}")); } catch (_) { payload = {}; }
        const event = {
            id: payload.id || `${row.event_at}:${row.username}:${row.event_type}:${row.gift_name || row.text || ""}`,
            type: row.event_type || "chat",
            user: payload.user || row.username || "",
            userHandle: payload.userHandle || row.username || "",
            text: payload.text || row.text || "",
            giftName: payload.giftName || row.gift_name || "",
            quantity: row.quantity || payload.quantity || 1,
            coins: row.coins || payload.coins || 0,
            ts: safeNumber(row.event_at, Date.now()),
        };
        const userState = {
            user: event.user,
            userHandle: event.userHandle,
            messages: event.type === "chat" ? 1 : 0,
            giftEvents: event.type === "gift" || event.type === "subscriber" ? 1 : 0,
            appearances: 1,
        };
        const session = { id: row.session_key || "sqlite-import", owner: payload.owner || "", liveUrl: payload.liveUrl || "" };
        const detection = (event.type === "gift" || event.type === "subscriber")
            ? inspectGiftRisk({ session, event, userState, watchEntry: store.getWatchlistEntry(event.userHandle || event.user) })
            : null;
        const alert = detection?.shouldAlert ? {
            id: `sqlite:${event.id}`,
            sessionId: session.id,
            accountId: detection.accountId,
            creatorId: detection.creatorId,
            severity: detection.severity,
            status: detection.suggestedStatus,
            riskScore: detection.riskScore,
            coins: detection.coins,
            giftName: event.giftName || event.text || "Gift",
            quantity: event.quantity || 1,
            reasons: detection.reasons,
            title: detection.title,
            text: detection.text,
            ts: event.ts,
        } : null;
        await store.recordObservation({ session, event, userState, detection: detection ? { ...detection, alert } : null });
        imported += 1;
    }
    return { imported, dbPath: sqlitePath };
}

async function main() {
    const store = new DetectorStore({ dataDir: path.join(repoRoot, "live-chat-server", "data") });
    await store.init();
    const snapshotResult = await importSnapshot(store);
    const sqliteResult = await importSQLite(store);
    console.log(JSON.stringify({ ok: true, snapshot: snapshotResult, sqlite: sqliteResult, watchlist: store.size() }, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});