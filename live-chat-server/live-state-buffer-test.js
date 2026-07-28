"use strict";

const assert = require("assert");
const LiveStateBuffer = require("./live-state-buffer");

(async () => {
  const redisUrl = String(process.env.LIVE_TEST_REDIS_URL || "").trim();
  const buffer = new LiveStateBuffer({
    redisUrl,
    prefix: `etherx:test:buffer:${process.pid}`,
    writeThrottleMs: 50,
  });
  const status = await buffer.init();
  assert.equal(status.mode, redisUrl ? "redis" : "memory");

  const session = {
    id: "buffer-session",
    owner: "creator",
    liveUrl: "https://www.tiktok.com/@creator/live",
    startedAt: Date.now() - 1000,
    updatedAt: Date.now(),
    currentViewers: 12,
    peakViewers: 18,
    users: new Map([["viewer", { user: "viewer" }]]),
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
  };

  buffer.update(session, { currentViewers: 14, peakViewers: 18 });
  session.currentViewers = 22;
  session.peakViewers = 22;
  session.counts.total = 2;
  session.counts.gifts = 2;
  session.counts.coins = 503;
  buffer.update(session, { currentViewers: 22, peakViewers: 22 });

  const state = buffer.get(session.id);
  assert.equal(state.currentViewers, 22);
  assert.equal(state.peakViewers, 22);
  assert.equal(state.counts.gifts, 2);
  assert.equal(state.counts.coins, 503);
  assert.equal(state.uniqueUsers, 1);
  assert.equal(buffer.list().length, 1);
  if (redisUrl) {
    await buffer.flushRedisWrites();
    assert.equal(buffer.getStatus().pendingRedisWrites, 0);
    assert.ok(buffer.getStatus().redisWrites >= 1);
  }

  await buffer.remove(session.id);
  assert.equal(buffer.list().length, 0);
  await buffer.close();
  console.log("LIVE state buffer test OK");
})().catch((error) => {
  console.error("LIVE state buffer test FAIL:", error.message);
  process.exit(1);
});
