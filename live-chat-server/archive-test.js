"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const LiveSessionStore = require("./session-store");

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "etherx-live-archive-"));
const dbPath = path.join(testDir, "archive.sqlite");
const now = Date.now();
const event = {
  id: "event-1",
  type: "gift",
  sourceType: "tiktoklive",
  user: "Test User",
  userHandle: "testuser",
  text: "Rose",
  giftName: "Rose",
  quantity: 3,
  unitCoins: 1,
  coins: 3,
  ts: now,
};
const session = {
  id: "session-test-1",
  owner: "creator",
  liveUrl: "https://www.tiktok.com/@creator/live",
  startedAt: now - 1000,
  endedAt: 0,
  createdAt: now - 1000,
  updatedAt: now,
  currentViewers: 12,
  peakViewers: 18,
  counts: {
    total: 1,
    chat: 0,
    gifts: 1,
    subscribers: 0,
    joins: 0,
    shares: 0,
    likes: 0,
    coins: 3,
  },
  users: new Map([["testuser", {
    user: "Test User",
    userHandle: "testuser",
    messages: 0,
    gifts: 3,
    giftEvents: 1,
    subscribers: 0,
    joins: 0,
    shares: 0,
    likes: 0,
    coins: 3,
    appearances: 1,
    level: 10,
    badge: "",
    firstSeenAt: now,
    lastSeenAt: now,
    lastMessage: "",
    giftTypes: { Rose: 3 },
  }]]),
  alerts: [],
};

let store = new LiveSessionStore({ dataDir: testDir, dbPath });
store.init();
store.persistSession(session, {
  events: [event],
  metadata: { currentViewers: 12, peakViewers: 18, source: "test" },
});
store.persistSession(session, { events: [event] });
assert.equal(store.getStatus().events, 1, "event mora biti dedupliciran");
assert.equal(store.getOverview().coins, 3);
assert.equal(store.getSession(session.id).owner, "creator");
assert.equal(store.listEvents(session.id).rows[0].giftName, "Rose");
assert.equal(store.listUsers(session.id).rows[0].giftTypes.Rose, 3);
assert.equal(store.listViewerSamples(session.id).rows[0].viewers, 12);
assert.equal(store.listCreators().rows[0].owner, "creator");
assert.equal(store.listCreators().rows[0].viewers, 1);
assert.equal(store.listCreatorViewers("creator").rows[0].userHandle, "testuser");
assert.equal(store.listCreatorViewers("creator").rows[0].coins, 3);
assert.equal(store.getUserArchive("@testuser").summary.events, 1);
assert.equal(store.getUserArchive("testuser", { creator: "@creator" }).summary.coins, 3);
assert.equal(store.getUserArchive("testuser", { sessionId: session.id }).streams[0].sessionId, session.id);
assert.equal(store.getUserArchive("testuser", { fromTs: now - 1, toTs: now + 1 }).days.length, 1);
assert.equal(store.getUserArchive("testuser", { creator: "missing" }), null);
assert.equal(store.getArchiveReport({ creator: "creator" }).summary.events, 1);
assert.equal(store.searchArchiveEvents({ query: "Rose" }).total, 1);
assert.equal(store.getCreatorAudience("creator").total, 1);
assert.equal(store.compareCreatorAudiences("creator", "creator").sharedUsers, 1);
store.endSession(session);
assert.ok(store.getSession(session.id).endedAt >= now);
store.close();

store = new LiveSessionStore({ dataDir: testDir, dbPath });
store.init();
assert.equal(store.getStatus().sessions, 1, "sesija mora ostati nakon ponovnog otvaranja baze");
assert.equal(store.getStatus().events, 1, "događaj mora ostati nakon ponovnog otvaranja baze");
store.setTelegramSetting("alerts", { giftCoins: 500 });
assert.equal(store.getTelegramSetting("alerts").giftCoins, 500);
store.addTelegramAudit({ chatId: "1", command: "/db", status: "ok" });
assert.equal(store.listTelegramAudit(1)[0].command, "/db");
store.setWatchUser("@testuser", true);
assert.equal(store.listWatchUsers()[0].userKey, "testuser");
assert.equal(store.createBackup().bytes > 0, true);
assert.equal(store.getBackupStatus().count, 1);
assert.equal(store.deleteUserArchive("@testuser").deletedEvents, 1);
assert.equal(store.getStatus().events, 0);
store.close();

fs.rmSync(testDir, { recursive: true, force: true });
console.log("LIVE archive test OK");
