"use strict";

module.exports = {
  apps: [
    {
      name: "etherx-live-chat",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "750M",
      kill_timeout: 10000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production"
      },
      time: true,
      merge_logs: true
    }
  ]
};
