// PICC dashboard — PM2 process manager config.
//   npm i -g pm2
//   pm2 start infra/dashboard/ecosystem.config.cjs
//   pm2 save && pm2 startup
//
// The dashboard reads apps/dashboard/.env relative to its server directory, so
// the app cwd is apps/dashboard. Runtime data is written under server/data/.

module.exports = {
  apps: [
    {
      name: "picc-dashboard",
      cwd: "../../apps/dashboard",
      script: "server/index.mjs",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      out_file: "/var/log/picc-dashboard.out.log",
      error_file: "/var/log/picc-dashboard.err.log",
      time: true
    }
  ]
}
