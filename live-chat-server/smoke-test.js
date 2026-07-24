"use strict";

const path = require("path");
const { WebSocket } = require("ws");

require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const url = String(process.env.LIVE_SMOKE_URL || "ws://127.0.0.1:8791/v1/live");
const resolveIp = String(process.env.LIVE_SMOKE_RESOLVE_IP || "").trim();
const authToken = String(process.env.LIVE_AUTH_TOKEN || "");

if (authToken.length < 32) {
  console.error("SMOKE FAIL: LIVE_AUTH_TOKEN nije učitan.");
  process.exit(1);
}

function connectAndAuthenticate(token, expected) {
  return new Promise((resolve, reject) => {
    const options = resolveIp
      ? {
          lookup: (_hostname, lookupOptions, callback) => {
            if (lookupOptions?.all) {
              callback(null, [{ address: resolveIp, family: 4 }]);
              return;
            }
            callback(null, resolveIp, 4);
          },
        }
      : {};
    const socket = new WebSocket(url, options);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`${expected}: timeout`));
    }, 8000);

    socket.once("open", () => {
      socket.send(JSON.stringify({
        type: "auth",
        token,
        clientId: "server-smoke-test",
        sessionId: "server-smoke-validation",
        metadata: { owner: "smoke-test", startedAt: Date.now() },
      }));
    });
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch (_) {
        return;
      }
      if (expected === "ready" && message.type === "ready") {
        clearTimeout(timer);
        socket.close(1000, "Smoke test complete");
        resolve();
      }
    });
    socket.once("close", (code) => {
      if (expected === "rejected" && code === 4401) {
        clearTimeout(timer);
        resolve();
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

(async () => {
  await connectAndAuthenticate("definitely-invalid-token", "rejected");
  console.log("SMOKE PASS: pogrešan token je odbijen.");
  await connectAndAuthenticate(authToken, "ready");
  console.log("SMOKE PASS: privatni token je prihvaćen.");
  console.log(`SMOKE PASS: ${url}`);
})().catch((error) => {
  console.error("SMOKE FAIL:", error.message);
  process.exit(1);
});
