"use strict";

function safeText(value, max = 160) {
    return String(value || "").replace(/[\u0000-\u001F]/g, "").trim().slice(0, max);
}

function safeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

function chooseStatus(a, b) {
    return statusRank(a) >= statusRank(b) ? a : b;
}

function getSecondsToMatchEnd(event) {
    const candidates = [
        event?.pkSecondsLeft,
        event?.matchSecondsLeft,
        event?.secondsToMatchEnd,
        event?.secondsLeft,
    ];
    for (const value of candidates) {
        const numeric = safeNumber(value, NaN);
        if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 3600) {
            return Math.round(numeric);
        }
    }
    return null;
}

function inspectGiftRisk({ session, event, userState, watchEntry, config = {} }) {
    const highGiftCoins = Math.max(1, safeNumber(config.highGiftCoins, 5000));
    const whaleGiftCoins = Math.max(highGiftCoins, safeNumber(config.whaleGiftCoins, 20000));
    const alertScoreThreshold = clamp(safeNumber(config.alertScoreThreshold, 55), 1, 100);

    const scoreParts = [];
    const behaviorFlags = [];
    const accountId = normalizeAccountId(event?.userHandle || event?.user || userState?.userHandle || userState?.user);
    const creatorId = safeText(session?.owner || session?.liveUrl || session?.id || "unknown", 120);
    const coins = Math.max(0, safeNumber(event?.coins, 0));
    const eventQuantity = Math.max(1, safeNumber(event?.quantity, 1));
    const userMessages = Math.max(0, safeNumber(userState?.messages, 0));
    const userGiftEvents = Math.max(0, safeNumber(userState?.giftEvents, 0));
    const appearances = Math.max(0, safeNumber(userState?.appearances, 0));
    const watchStatus = safeText(watchEntry?.status, 40).toUpperCase();
    const isKnownAccount = Boolean(watchEntry && normalizeAccountId(watchEntry.account_id || watchEntry.userHandle || watchEntry.user));
    const firstSeenPrivate = Boolean(watchEntry?.first_seen_private || event?.firstSeenPrivate || event?.isPrivateProfile);
    const creatorStats = watchEntry?.metadata?.creatorStats || {};
    const creatorKeys = Object.keys(creatorStats).filter(Boolean);
    const concentratedCreatorTraffic = creatorKeys.length > 0
        && creatorKeys.length <= 2
        && creatorKeys.some((key) => safeNumber(creatorStats[key]?.coins, 0) >= Math.max(highGiftCoins, safeNumber(watchEntry?.total_coins_sent, 0) * 0.9));
    const secondsToMatchEnd = getSecondsToMatchEnd(event);

    if (watchStatus === "CONFIRMED_AGENCY") {
        scoreParts.push({ weight: 100, reason: "Račun je već potvrđen kao agencijski." });
        behaviorFlags.push("watchlist_confirmed_agency");
    } else if (watchStatus === "SUSPECTED") {
        scoreParts.push({ weight: 45, reason: "Račun je već na watchlisti kao sumnjiv." });
        behaviorFlags.push("watchlist_suspected");
    }

    if (!isKnownAccount && coins >= highGiftCoins) {
        scoreParts.push({ weight: 30, reason: "Novi ili nepoznati račun odmah šalje veliki gift." });
        behaviorFlags.push("new_account_large_gift");
    }
    if (coins >= whaleGiftCoins) {
        scoreParts.push({ weight: 22, reason: "Vrlo velik gift iznad whale praga." });
        behaviorFlags.push("whale_gift_value");
    } else if (coins >= highGiftCoins) {
        scoreParts.push({ weight: 14, reason: "Gift je iznad definiranog detekcijskog praga." });
        behaviorFlags.push("high_gift_value");
    }
    if (userMessages === 0 && userGiftEvents <= 1) {
        scoreParts.push({ weight: 18, reason: "Nema chat interakcije, ali postoji veliki gift." });
        behaviorFlags.push("one_way_gifter");
    }
    if (appearances <= 1) {
        scoreParts.push({ weight: 12, reason: "Račun se pojavljuje prvi put u ovoj sesiji." });
        behaviorFlags.push("first_seen_in_session");
    }
    if (firstSeenPrivate) {
        scoreParts.push({ weight: 18, reason: "Profil je označen kao private u trenutku detekcije." });
        behaviorFlags.push("private_profile_signal");
    }
    if (Number.isFinite(secondsToMatchEnd) && secondsToMatchEnd !== null && secondsToMatchEnd <= 15) {
        scoreParts.push({ weight: 24, reason: `Gift je stigao u zadnjih ${secondsToMatchEnd}s PK/Match prozora.` });
        behaviorFlags.push(`sniper_window_${secondsToMatchEnd}s`);
    }
    if (concentratedCreatorTraffic) {
        scoreParts.push({ weight: 12, reason: "Povijest pokazuje izrazitu koncentraciju giftinga na 1-2 kreatora." });
        behaviorFlags.push("creator_concentration");
    }

    const rawScore = scoreParts.reduce((sum, part) => sum + part.weight, 0);
    const riskScore = clamp(rawScore, 0, 100);
    let suggestedStatus = watchStatus || "CLEAR";
    if (watchStatus !== "CONFIRMED_AGENCY") {
        if (riskScore >= alertScoreThreshold) suggestedStatus = chooseStatus(suggestedStatus, "SUSPECTED");
        else if (coins >= whaleGiftCoins) suggestedStatus = chooseStatus(suggestedStatus, "WHALE");
    }

    let severity = "info";
    if (watchStatus === "CONFIRMED_AGENCY" || riskScore >= 85) severity = "critical";
    else if (riskScore >= 70) severity = "high";
    else if (riskScore >= alertScoreThreshold || coins >= highGiftCoins) severity = "warning";

    const shouldAlert = severityRank(severity) >= severityRank("warning") || watchStatus === "CONFIRMED_AGENCY";
    const reasons = scoreParts.map((part) => part.reason);
    const title = watchStatus === "CONFIRMED_AGENCY"
        ? `Potvrđeni agencijski račun: @${accountId || "unknown"}`
        : `Sniper detekcija: @${accountId || "unknown"}`;
    const text = `${title} • ${coins.toLocaleString("hr-HR")} 🪙 • ${safeText(event?.giftName || "Gift", 80)} ×${eventQuantity}`;

    return {
        accountId,
        creatorId,
        coins,
        quantity: eventQuantity,
        riskScore,
        reasons,
        behaviorFlags,
        severity,
        suggestedStatus,
        shouldAlert,
        title,
        text,
        secondsToMatchEnd,
    };
}

module.exports = {
    inspectGiftRisk,
    normalizeAccountId,
};