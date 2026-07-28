"use strict";

const DEFAULT_PREFIX = "etherx:live";

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function snapshotSession(session, metadata = {}) {
  const counts = session?.counts || {};
  return {
    id: String(session?.id || ""),
    owner: String(session?.owner || ""),
    liveUrl: String(session?.liveUrl || ""),
    startedAt: Math.max(0, safeNumber(session?.startedAt, Date.now())),
    endedAt: Math.max(0, safeNumber(session?.endedAt, 0)),
    updatedAt: Math.max(0, safeNumber(session?.updatedAt, Date.now())),
    currentViewers: Math.max(0, safeNumber(metadata.currentViewers, session?.currentViewers || 0)),
    peakViewers: Math.max(
      0,
      safeNumber(metadata.peakViewers, session?.peakViewers || metadata.currentViewers || 0),
    ),
    uniqueUsers: session?.users instanceof Map ? session.users.size : 0,
    counts: {
      total: Math.max(0, safeNumber(counts.total, 0)),
      chat: Math.max(0, safeNumber(counts.chat, 0)),
      gifts: Math.max(0, safeNumber(counts.gifts, 0)),
      subscribers: Math.max(0, safeNumber(counts.subscribers, 0)),
      joins: Math.max(0, safeNumber(counts.joins, 0)),
      shares: Math.max(0, safeNumber(counts.shares, 0)),
      likes: Math.max(0, safeNumber(counts.likes, 0)),
      coins: Math.max(0, safeNumber(counts.coins, 0)),
    },
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
}

class LiveStateBuffer {
  constructor(options = {}) {
    this.redisUrl = String(options.redisUrl || "").trim();
    this.prefix = String(options.prefix || DEFAULT_PREFIX).replace(/:+$/, "") || DEFAULT_PREFIX;
    this.ttlSeconds = Math.max(60, safeNumber(options.ttlSeconds, 24 * 60 * 60));
    this.writeThrottleMs = Math.max(50, safeNumber(options.writeThrottleMs, 250));
    this.states = new Map();
    this.dirtySessionIds = new Set();
    this.client = null;
    this.redisReady = false;
    this.redisError = "";
    this.writeTimer = null;
    this.writePromise = Promise.resolve();
    this.writeCount = 0;
  }

  async init() {
    if (!this.redisUrl) return this.getStatus();
    try {
      const { createClient } = require("redis");
      this.client = createClient({
        url: this.redisUrl,
        socket: {
          connectTimeout: 1500,
          reconnectStrategy: (retries) => (retries > 5 ? false : Math.min(1000, 100 + retries * 150)),
        },
      });
      this.client.on("error", (error) => {
        this.redisError = String(error?.message || error).slice(0, 240);
        this.redisReady = false;
      });
      this.client.on("ready", () => {
        this.redisReady = true;
        this.redisError = "";
        this.scheduleRedisWrite();
      });
      this.client.on("end", () => {
        this.redisReady = false;
      });
      await this.client.connect();
      this.redisReady = true;
      await this.restore();
    } catch (error) {
      this.redisError = String(error?.message || error).slice(0, 240);
      this.redisReady = false;
      try { await this.client?.disconnect(); } catch (_) { }
      this.client = null;
    }
    return this.getStatus();
  }

  stateKey(sessionId) {
    return `${this.prefix}:state:${encodeURIComponent(String(sessionId || ""))}`;
  }

  indexKey() {
    return `${this.prefix}:sessions`;
  }

  update(session, metadata = {}) {
    if (!session?.id) return null;
    const next = snapshotSession(session, metadata);
    this.states.set(next.id, next);
    this.dirtySessionIds.add(next.id);
    this.scheduleRedisWrite();
    return next;
  }

  get(sessionId) {
    return this.states.get(String(sessionId || "")) || null;
  }

  list(options = {}) {
    const limit = Math.max(1, Math.min(1000, safeNumber(options.limit, 200)));
    return Array.from(this.states.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((state) => ({ ...state, metadata: { ...state.metadata } }));
  }

  scheduleRedisWrite() {
    if (!this.redisReady || this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writePromise = this.writePromise
        .then(() => this.flushRedisWrites())
        .catch((error) => {
          this.redisError = String(error?.message || error).slice(0, 240);
        });
    }, this.writeThrottleMs);
    this.writeTimer.unref?.();
  }

  async flushRedisWrites() {
    if (!this.redisReady || !this.client || !this.dirtySessionIds.size) return 0;
    const sessionIds = Array.from(this.dirtySessionIds);
    sessionIds.forEach((sessionId) => this.dirtySessionIds.delete(sessionId));
    const multi = this.client.multi();
    sessionIds.forEach((sessionId) => {
      const state = this.states.get(sessionId);
      if (!state) return;
      multi.set(this.stateKey(sessionId), JSON.stringify(state), { EX: this.ttlSeconds });
      multi.sAdd(this.indexKey(), sessionId);
    });
    multi.expire(this.indexKey(), this.ttlSeconds);
    await multi.exec();
    this.writeCount += sessionIds.length;
    if (this.dirtySessionIds.size) this.scheduleRedisWrite();
    return sessionIds.length;
  }

  async restore() {
    if (!this.redisReady || !this.client) return [];
    const sessionIds = await this.client.sMembers(this.indexKey());
    if (!sessionIds.length) return [];
    const values = await this.client.mGet(sessionIds.map((sessionId) => this.stateKey(sessionId)));
    const restored = [];
    values.forEach((value, index) => {
      if (!value) return;
      try {
        const state = JSON.parse(value);
        if (!state?.id) return;
        this.states.set(String(state.id), state);
        restored.push(state);
      } catch (_) {
        this.dirtySessionIds.delete(sessionIds[index]);
      }
    });
    return restored;
  }

  async remove(sessionId) {
    const id = String(sessionId || "");
    this.states.delete(id);
    this.dirtySessionIds.delete(id);
    if (!this.redisReady || !this.client || !id) return;
    await this.client.del(this.stateKey(id));
    await this.client.sRem(this.indexKey(), id);
  }

  getStatus() {
    return {
      mode: this.redisUrl ? (this.redisReady ? "redis" : "memory-fallback") : "memory",
      redisConfigured: Boolean(this.redisUrl),
      redisReady: this.redisReady,
      bufferedSessions: this.states.size,
      pendingRedisWrites: this.dirtySessionIds.size,
      redisWrites: this.writeCount,
      error: this.redisError || undefined,
    };
  }

  async close() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    try {
      await this.flushRedisWrites();
      await this.writePromise;
    } catch (_) { }
    try {
      if (this.client?.isOpen) await this.client.quit();
    } catch (_) {
      try { await this.client?.disconnect(); } catch (_) { }
    }
    this.redisReady = false;
  }
}

module.exports = LiveStateBuffer;
module.exports.snapshotSession = snapshotSession;
