# PICC dashboard — multi-stage production image.
#   Stage 1 (build):   npm ci + tsc + vite build → dist/
#   Stage 2 (runtime): Node + prod deps only (stripe, @supabase/supabase-js),
#                      serves dist/ + the same-origin /api/* backend.
#
# Build context = repo root. Example:
#   docker build -f infra/dashboard/Dockerfile -t picc-dashboard .
#   docker run -p 3000:3000 --env-file apps/dashboard/.env \
#     -v picc-data:/app/apps/dashboard/server/data picc-dashboard

# ---------- Stage 1: build the SPA ----------
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN npm ci --workspace @picc/dashboard --include-workspace-root=false
COPY apps/dashboard apps/dashboard
RUN npm run build --workspace @picc/dashboard

# ---------- Stage 2: minimal runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
# Prod deps only — stripe + @supabase/supabase-js (both imported lazily).
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN npm ci --workspace @picc/dashboard --include-workspace-root=false --omit=dev
# Built SPA + backend, no tests/sources.
COPY --from=build /repo/apps/dashboard/dist apps/dashboard/dist
COPY --from=build /repo/apps/dashboard/server apps/dashboard/server
# Runtime data (automator credentials, agent logs, presence) lives here.
VOLUME ["/repo/apps/dashboard/server/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "apps/dashboard/server/index.mjs"]
