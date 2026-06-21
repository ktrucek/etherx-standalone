module.exports = {
    apps: [
        {
            name: "etherx-browser",
            script: "npm",
            args: "start",
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
