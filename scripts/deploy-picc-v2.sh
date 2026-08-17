#!/usr/bin/env bash
# PICC v2.0 — one-shot deployment of the passive-income stack described in the
# v2.0 blueprint. Clones the four repos into $PICC_DEV_DIR (~/dev by default),
# installs each, and prints the next steps. Safe to re-run: existing folders are
# pulled instead of re-cloned, and any repo that fails to clone is skipped with
# a warning (the URLs are community projects — pin your own forks if they drift).
#
# Usage:
#   bash scripts/deploy-picc-v2.sh            # everything
#   PICC_DEV_DIR=/opt/picc bash scripts/deploy-picc-v2.sh
set -euo pipefail

DEV_DIR="${PICC_DEV_DIR:-$HOME/dev}"
mkdir -p "$DEV_DIR"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
skip() { printf '\033[1;33m  !>\033[0m %s\n' "$*"; }

clone_or_pull() {
  local name="$1" repo="$2" dir="$3"
  if [ -d "$dir/.git" ]; then
    log "Updating $name ($dir)"
    ( cd "$dir" && git pull --ff-only || true )
  else
    log "Cloning $name"
    git clone --depth 1 "$repo" "$dir" || { skip "could not clone $repo — skipped (verify the URL / your own fork)"; return 1; }
  fi
}

# --- 1. PICC (this repo) -----------------------------------------------------
clone_or_pull "PICC" "${PICC_REPO:-https://github.com/your-org/PICC.git}" "$DEV_DIR/PICC"
if [ -d "$DEV_DIR/PICC" ]; then
  log "Installing PICC dashboard deps"
  ( cd "$DEV_DIR/PICC/apps/dashboard" && ( npm install || true ) )
  cp -n "$DEV_DIR/PICC/apps/dashboard/.env.example" "$DEV_DIR/PICC/apps/dashboard/.env" 2>/dev/null || true
  skip "edit apps/dashboard/.env, then: npm run start:all"
fi

# --- 2. MoneyPrinterV2 (faceless video pipeline) ------------------------------
clone_or_pull "MoneyPrinterV2" "${MP2_REPO:-https://github.com/harry0703/MoneyPrinterV2.git}" "$DEV_DIR/moneyprinterv2"
if [ -d "$DEV_DIR/moneyprinterv2" ]; then
  log "Installing MoneyPrinterV2 deps"
  ( cd "$DEV_DIR/moneyprinterv2" && ( pip install -r requirements.txt || true ) )
  skip "set your TTS keys in config.toml, then import infra/n8n/workflows/picc-moneymaker-pipeline.json"
fi

# --- 3. CashClaw (crypto cashback / airdrop audit) ----------------------------
clone_or_pull "CashClaw" "${CASHCLAW_REPO:-https://github.com/ertugrulakben/cashclaw.git}" "$DEV_DIR/cashclaw"
if [ -d "$DEV_DIR/cashclaw" ]; then
  skip "cashclaw: see its README for setup; wired to PICC via the CrewAI cashclaw_hunter agent"
fi

# --- 4. GridLink (grid nodes) --------------------------------------------------
clone_or_pull "GridLink" "${GRIDLINK_REPO:-https://github.com/danyalzaki000/GridLink.git}" "$DEV_DIR/gridlink"
if [ -d "$DEV_DIR/gridlink" ]; then
  skip "gridlink: register your grid node on the site, then track it with the depin_optimizer agent"
fi

# --- 5. n8n workflows -----------------------------------------------------------
if command -v docker >/dev/null 2>&1; then
  log "Starting n8n (optional — skip with: n8n off)"
  if [ -f "$DEV_DIR/PICC/infra/n8n/docker-compose.yml" ]; then
    ( cd "$DEV_DIR/PICC/infra/n8n" && docker compose up -d )
  fi
fi

cat <<EOF

\033[1;32mPICC v2.0 deployment summary\033[0m
  $DEV_DIR/PICC             dashboard + server (npm run start:all)
  $DEV_DIR/moneyprinterv2   faceless video pipeline (MoneyPrinterV2)
  $DEV_DIR/cashclaw         cashback / airdrop clawback audit
  $DEV_DIR/gridlink         grid node app
  n8n                       http://localhost:5678 (import infra/n8n/workflows/*.json)

Next steps:
  1. Configure apps/dashboard/.env (keys are optional; everything works without them)
  2. Import the n8n workflow templates
  3. Open the dashboard → Streams → Connectors and click "Collect" per source
EOF
