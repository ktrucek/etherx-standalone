const path = require('path');

module.exports = {
    apps: [
        {
            name: "etherx-browser",
            script: path.resolve(__dirname, 'node_modules', '.bin', 'electron'),
            args: [".", "--no-sandbox"],
            interpreter: "none",
            cwd: __dirname,
            autorestart: true,
            watch: false,
            max_restarts: 10,
            min_uptime: "10s",
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};
