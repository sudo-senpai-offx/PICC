# PICC dashboard — production deployment

Three equivalent ways to run the dashboard + backend in production. Pick one.

Prerequisite (all options): `apps/dashboard/.env` filled in (Supabase, LLM, Serper,
payment keys, optionally `SP_AMAZON_*`). Then build the SPA once with `npm run build`
(or the Docker build does it for you).

## Option 1 — Docker (recommended)

```bash
docker compose --env-file apps/dashboard/.env -f infra/dashboard/docker-compose.yml up -d --build
```

- Serves on port `3000` (override with `PICC_PORT=8080` in the compose env).
- Secrets come from `apps/dashboard/.env` (mounted via `env_file` — never baked into the image).
- Runtime data (automator credentials, agent logs, presence, sessions) is persisted in the
  named volume `picc-data` at `/repo/apps/dashboard/server/data`.
- Built-in `HEALTHCHECK` hits `/api/health` every 30s.

Stop / update:

```bash
docker compose -f infra/dashboard/docker-compose.yml down
git pull && docker compose --env-file apps/dashboard/.env -f infra/dashboard/docker-compose.yml up -d --build
```

## Option 2 — PM2 (bare Node, no Docker)

Requires Node ≥ 22 and a build of `dist/`:

```bash
npm run build
npm i -g pm2
pm2 start infra/dashboard/ecosystem.config.cjs
pm2 save && pm2 startup    # restart on reboot
```

Logs go to `/var/log/picc-dashboard.{out,err}.log`. The process is named `picc-dashboard`
(`pm2 status`, `pm2 logs picc-dashboard`, `pm2 restart picc-dashboard`).

## Option 3 — systemd (bare Node, no Docker)

Build `dist/` (`npm run build`), then install the unit:

```bash
sudo cp infra/dashboard/picc-dashboard.service /etc/systemd/system/
sudo nano /etc/systemd/system/picc-dashboard.service   # set the real WorkingDirectory
sudo systemctl daemon-reload
sudo systemctl enable --now picc-dashboard
```

## Reverse proxy (any option)

Put the dashboard behind nginx/Caddy for TLS and forward `:3000`. The backend is
same-origin only (`/api/*`), so no CORS configuration is required. Example nginx:

```nginx
server {
  listen 443 ssl;
  server_name picc.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## Files

| File | Purpose |
| :-- | :-- |
| `Dockerfile` | Multi-stage image: build SPA, run prod deps only |
| `docker-compose.yml` | Docker stack with `.env` + `picc-data` volume |
| `ecosystem.config.cjs` | PM2 process config |
| `picc-dashboard.service` | systemd unit |
