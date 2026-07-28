"use strict";

const assert = require("assert");
const { WebSocket } = require("ws");

const wsUrl = String(process.env.LIVE_SMOKE_URL || "ws://127.0.0.1:8791/v1/live");
const apiBase = String(process.env.LIVE_SMOKE_API_URL || "http://127.0.0.1:8791");
const authToken = String(process.env.LIVE_AUTH_TOKEN || "");
const archiveToken = String(process.env.LIVE_ARCHIVE_API_TOKEN || authToken);
const wsHost = new URL(wsUrl).hostname;
const apiHost = new URL(apiBase).hostname;

if (!["127.0.0.1", "localhost", "::1"].includes(wsHost) || !["127.0.0.1", "localhost", "::1"].includes(apiHost)) {
  throw new Error("Ovaj test namjerno radi samo protiv lokalne izolirane instance.");
}
if (authToken.length < 32 || archiveToken.length < 32) {
  throw new Error("Testni LIVE i archive token moraju imati najmanje 32 znaka.");
}

const sessionId = "archive-http-validation";
const now = Date.now();

function sendTestEvent() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("WSS archive test timeout"));
    }, 8000);
    socket.once("open", () => socket.send(JSON.stringify({
      type: "auth",
      token: authToken,
      clientId: "archive-http-smoke",
      sessionId,
      metadata: {
        owner: "archive-smoke",
        liveUrl: "https://www.tiktok.com/@archive-smoke/live",
        startedAt: now,
        currentViewers: 17,
        peakViewers: 23,
      },
    })));
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString("utf8"));
      if (message.type === "ready") {
        socket.send(JSON.stringify({
          type: "events",
          sessionId,
          seq: 1,
          metadata: { currentViewers: 18, peakViewers: 23 },
          events: [{
            id: `archive-event-${now}`,
            type: "gift",
            sourceType: "smoke",
            user: "Archive Tester",
            userHandle: "archive_tester",
            giftName: "Rose",
            text: "Rose",
            quantity: 2,
            unitCoins: 1,
            coins: 2,
            ts: now,
          }],
        }));
      }
      if (message.type === "ack") {
        assert.equal(message.accepted, 1);
        socket.send(JSON.stringify({
          type: "heartbeat",
          sessionId,
          metadata: { currentViewers: 24, peakViewers: 24 },
        }));
      }
      if (message.type === "heartbeat_ack") {
        socket.send(JSON.stringify({
          type: "end_session",
          sessionId,
          metadata: { currentViewers: 24, peakViewers: 24 },
        }));
      }
      if (message.type === "session_ended") {
        clearTimeout(timer);
        socket.close(1000, "Archive smoke complete");
        resolve();
      }
    });
    socket.once("error", reject);
  });
}

async function api(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: { Authorization: `Bearer ${archiveToken}` },
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForSseUpdate() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${apiBase}/v1/archive/stream`, {
      headers: {
        Authorization: `Bearer ${archiveToken}`,
        Accept: "text/event-stream",
      },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(String(response.headers.get("content-type") || ""), /^text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("SSE stream ended before archive_update");
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!frame.includes("event: archive_update")) continue;
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        const payload = JSON.parse(String(dataLine || "").slice(5).trim());
        assert.ok(payload.sessionIds.includes(sessionId));
        assert.ok(payload.overview.events >= 1);
        controller.abort();
        return payload;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const unauthorized = await fetch(`${apiBase}/v1/archive/status`);
  assert.equal(unauthorized.status, 401);
  const sseUpdate = waitForSseUpdate();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await sendTestEvent();
  await sseUpdate;
  const liveState = await api(`/v1/archive/live-state?sessionId=${sessionId}`);
  assert.equal(liveState.state.currentViewers, 24);
  assert.equal(liveState.state.counts.gifts, 1);
  const detail = await api(`/v1/archive/sessions/${sessionId}`);
  assert.equal(detail.session.owner, "archive-smoke");
  assert.equal(detail.session.peakViewers, 24);
  const dashboard = await api(`/v1/archive/sessions/${sessionId}/dashboard?points=60`);
  assert.equal(dashboard.dashboard.session.id, sessionId);
  assert.ok(dashboard.dashboard.meta.payloadRows <= 145);
  assert.ok(dashboard.dashboard.meta.rawEvents >= 1);
  const events = await api(`/v1/archive/sessions/${sessionId}/events`);
  assert.equal(events.rows[0].giftName, "Rose");
  const users = await api(`/v1/archive/sessions/${sessionId}/users`);
  assert.equal(users.rows[0].userHandle, "archive_tester");
  const viewers = await api(`/v1/archive/sessions/${sessionId}/viewers`);
  assert.ok(viewers.rows.length >= 1);
  assert.equal(viewers.rows.at(-1).viewers, 24);
  console.log("LIVE WSS -> SQLite -> protected SSE + HTTP API smoke OK");
})().catch((error) => {
  console.error("ARCHIVE HTTP SMOKE FAIL:", error.message);
  process.exit(1);
});
