module.exports = {
    apps: [
        {
            name: "etherx-browser",
            script: "./node_modules/.bin/electron",
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
