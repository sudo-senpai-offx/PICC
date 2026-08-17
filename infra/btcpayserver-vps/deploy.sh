#!/usr/bin/env bash
#
# PICC - BTCPay Server MAINNET deployment for Oracle Cloud Always Free (Ampere A1).
#
# Note on the current A1 Always Free limits: 2 OCPU / 12 GB RAM (Oracle reduced
# the older 4/24 allowance). This kit is tuned for 12 GB (dbcache=4096).
#
# What this does, on a fresh Ubuntu VM:
#   1. Installs Docker (+ compose plugin)
#   2. (NETWORK_MODE=duckdns only) Installs a DuckDNS auto-updater
#      (free dynamic DNS -> your VPS IP, forever)
#   3. Clones the official btcpayserver-docker repo and runs btcpay-setup.sh
#      with: mainnet, nginx reverse proxy + Let's Encrypt HTTPS, PRUNED node,
#            a dbcache tuning fragment, optional Core Lightning,
#            (NETWORK_MODE=cloudflare only) a Cloudflare Tunnel front end
#   4. Prints next steps (browser login, API key, rewiring the dashboard)
#
# NETWORK_MODE explains the two ways to expose BTCPay for $0:
#   duckdns   - VM has a public IP; yourname.duckdns.org points at it;
#               Let's Encrypt issues the cert. Simplest. (default)
#   cloudflare- no public IP at all (avoids Oracle's public-IP charges);
#               cloudflared connects OUT to Cloudflare's tunnel edge and
#               serves https://your.host. Requires a domain hosted on
#               Cloudflare (their free plan) with a CNAME to the tunnel.
#               Free if you already have such a domain.
#
# Run on the VPS as root:
#   sudo bash deploy.sh
#
# Set -euo pipefail: fail fast, no silent surprises.
set -euo pipefail

# ============================================================================
# >>> EDIT THESE BEFORE RUNNING <<<
# ============================================================================
# Full DuckDNS subdomain, e.g. "sharvin.duckdns.org" (must exist in your DuckDNS account)
BTCPAY_HOST="yourname.duckdns.org"

# Email used by Let's Encrypt for certificate expiry notices
LETSENCRYPT_EMAIL="you@example.com"

# DuckDNS credentials (duckdns.org -> your account page)
DUCKDNS_DOMAIN="yourname"                     # the part before .duckdns.org
DUCKDNS_TOKEN="00000000-0000-0000-0000-000000000000"  # token from duckdns.org

# Pruning: opt-save-storage   -> prune BTC to ~100 GB (needs >= 120 GB disk)
#          opt-save-storage-s -> prune BTC to ~50  GB
#          opt-save-storage-xs-> prune BTC to ~25  GB
PRUNE_FRAGMENT="${PRUNE_FRAGMENT:-opt-save-storage}"

# Bitcoin Core memory cache in MB. On the 12 GB A1 VM, 4096 speeds up the
# initial sync a lot (the rest of the stack needs ~3-4 GB). Lower it if the
# box is tight on RAM. After IBD finishes, run tune-after-sync.sh to drop it.
DBCACHE_MB="${DBCACHE_MB:-4096}"

# Optional Lightning: set to "clightning" to also install Core Lightning.
# On-chain payments work fully without it. Leave empty to skip.
LIGHTNING="${LIGHTNING:-}"

# How the public internet reaches BTCPay. See header for the two options.
NETWORK_MODE="${NETWORK_MODE:-duckdns}"    # "duckdns" or "cloudflare"

# NETWORK_MODE=cloudflare only: Cloudflare Zero Trust tunnel token
# (Zero Trust dashboard -> Networks -> Tunnels -> create a tunnel, copy token).
# Your BTCPAY_HOST must be a domain on your Cloudflare account, with a CNAME
# to the tunnel in Cloudflare DNS. cloudflared runs on the VM and makes an
# outbound connection, so the VM needs NO public IP (Oracle IPv4 fee = $0).
CLOUDFLARE_TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
# ============================================================================

BTCPAY_BASE="/root"
BTCPAY_DIR="$BTCPAY_BASE/btcpayserver-docker"

log() { printf '\n\033[1;32m[+] %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m[ERROR] %s\033[0m\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "Run as root:  sudo bash deploy.sh"
command -v apt-get >/dev/null 2>&1 || die "This script targets Ubuntu/Debian (apt)."
[[ "$NETWORK_MODE" == "duckdns" || "$NETWORK_MODE" == "cloudflare" ]] || die "NETWORK_MODE must be 'duckdns' or 'cloudflare' (got: $NETWORK_MODE)"
[[ "$BTCPAY_HOST" != "yourname.duckdns.org" ]] || die "Set BTCPAY_HOST to your public hostname at the top of deploy.sh"
if [[ "$NETWORK_MODE" == "duckdns" ]]; then
  [[ -n "$DUCKDNS_TOKEN" && "$DUCKDNS_TOKEN" != "00000000"* ]] || die "Set DUCKDNS_TOKEN (from duckdns.org) at the top of deploy.sh"
else
  [[ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]] || die "Set CLOUDFLARE_TUNNEL_TOKEN (Cloudflare Zero Trust tunnel token) at the top of deploy.sh"
fi
[[ -n "$LETSENCRYPT_EMAIL" && "$LETSENCRYPT_EMAIL" != *"example.com" ]] || die "Set LETSENCRYPT_EMAIL at the top of deploy.sh"

FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
log "Free disk: ${FREE_GB}GB (a 100GB-pruned mainnet node needs >= 120GB)"
if (( FREE_GB < 120 )); then
  die "Not enough disk. In the Oracle console resize the boot volume to >= 160GB (Always Free includes 200GB total block storage)."
fi

export DEBIAN_FRONTEND=noninteractive

# --- Docker -------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker via get.docker.com ..."
  curl -fsSL https://get.docker.com | sh
fi
apt-get install -y docker-compose-plugin >/dev/null 2>&1 || true
log "Enabling docker ..."
systemctl enable --now docker
docker version >/dev/null 2>&1 || die "Docker did not come up. Check: systemctl status docker"

# --- swap + kernel tuning (OOM safety on the 12 GB box) ----------------------
log "Adding 4G swap and tuning swappiness ..."
if [[ ! -f /swapfile ]]; then
  fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-picc.conf
sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true

# --- public exposure ----------------------------------------------------------
if [[ "$NETWORK_MODE" == "duckdns" ]]; then
  # DuckDNS auto-updater (before setup, so the A record resolves for LE)
  log "Installing DuckDNS updater (keeps <sub>.duckdns.org -> this VPS forever) ..."
  cat > /usr/local/bin/duckdns-update.sh <<EOF
#!/bin/bash
curl -fsSL "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" >> /var/log/duckdns.log 2>&1
EOF
  chmod +x /usr/local/bin/duckdns-update.sh

  cat > /etc/systemd/system/duckdns-update.service <<'EOF'
[Unit]
Description=DuckDNS dynamic DNS updater
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/duckdns-update.sh
EOF

  cat > /etc/systemd/system/duckdns-update.timer <<'EOF'
[Unit]
Description=Update DuckDNS A record every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now duckdns-update.timer
  /usr/local/bin/duckdns-update.sh
  log "First DuckDNS update result:"
  tail -n 2 /var/log/duckdns.log || true

  log "DNS check for $BTCPAY_HOST:"
  getent hosts "$BTCPAY_HOST" || log "DNS not resolving yet - the updater runs every 5 min, Let's Encrypt will retry."
else
  log "Cloudflare mode: no public IP needed. cloudflared will connect out to the tunnel edge."
  log "Make sure in Cloudflare DNS you have:  CNAME $BTCPAY_HOST -> <tunnel-id>.cfargotunnel.com"
  log "And Cloudflare SSL/TLS mode set to Flexible or Full (BTCPay still gets its own Let's Encrypt cert)."
fi

# --- BTCPay mainnet -----------------------------------------------------------
if [[ ! -d "$BTCPAY_DIR" ]]; then
  log "Cloning official btcpayserver-docker ..."
  git clone https://github.com/btcpayserver/btcpayserver-docker "$BTCPAY_DIR"
fi
cd "$BTCPAY_DIR"

export BTCPAY_HOST
export NBITCOIN_NETWORK="mainnet"
export BTCPAYGEN_CRYPTO1="btc"
export BTCPAYGEN_REVERSEPROXY="nginx"
export BTCPAYGEN_LIGHTNING="$LIGHTNING"
export BTCPAY_ENABLE_SSH=true
FRAGMENTS="$PRUNE_FRAGMENT;picc-optimize"
if [[ "$NETWORK_MODE" == "cloudflare" ]]; then
  export CLOUDFLARE_TUNNEL_TOKEN
  FRAGMENTS="$FRAGMENTS;opt-add-cloudflared"
fi
export BTCPAYGEN_ADDITIONAL_FRAGMENTS="$FRAGMENTS"
export LETSENCRYPT_EMAIL

# Custom generator fragment: aggressive tuning for the 2-OCPU / 12 GB A1 VM.
#  - dbcache=4096 (big cache, fast mainnet IBD) + small mempool
#  - hard memory/CPU caps per container so no service can starve the box
#    (guarantees a responsive machine even while bitcoind syncs)
# Lives in the repo's fragments dir so it survives regeneration.
log "Installing PICC tuning fragment (dbcache=${DBCACHE_MB}MB + resource caps) ..."
FRAG_DIR="$BTCPAY_DIR/docker-compose-generator/docker-fragments"
cat > "$FRAG_DIR/picc-optimize.yml" <<EOF
# PICC tuning: fast IBD + strict per-container resource caps for the 12 GB A1 VM.
exclusive:
  - memory
services:
  bitcoind:
    mem_limit: 6g
    cpus: 1.5
    environment:
      BITCOIN_EXTRA_ARGS: |
        dbcache=${DBCACHE_MB}
        maxmempool=100
  btcpayserver:
    mem_limit: 1g
    cpus: "1.0"
  nbxplorer:
    mem_limit: 768m
    cpus: "0.5"
  postgres:
    mem_limit: 512m
    cpus: "0.5"
  nginx:
    mem_limit: 256m
    cpus: "0.25"
EOF

log "Running btcpay-setup.sh (pulls images, generates compose, starts stack) ..."
. ./btcpay-setup.sh -i

# --- Status -------------------------------------------------------------------
log "Waiting for containers ..."
sleep 30
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E "btcpayserver|bitcoind|nginx|cloudflared|nbxplorer|postgres|NAME" || true

if [[ "$NETWORK_MODE" == "cloudflare" ]]; then
  cat <<EOF

============================================================
 DONE.  Now do these once, by hand:
============================================================
 1. Open:  https://$BTCPAY_HOST   (cert issue can take ~1 min)
 2. First login: create your admin password + enable 2FA (public internet!).
 3. Create a store -> copy the Store ID.
 4. Server Settings -> Access Tokens -> "Create API Key",
    grant store rights -> copy the key.
 5. On your PC, in apps/dashboard/.env set:
      BTCPAY_URL=https://$BTCPAY_HOST
      BTCPAY_API_KEY=<key from step 4>
      BTCPAY_STORE_ID=<store id from step 3>
 6. Watch the sync:
      sudo docker exec btcpayserver_bitcoind bitcoin-cli getblockchaininfo
    (look at verificationprogress; expect 2-5 days for mainnet IBD on the free VM)
 7. Once verificationprogress reaches 1.0, free ~3.5GB of RAM:
      sudo bash tune-after-sync.sh
 8. Update later:  sudo btcpay-update.sh
NOTE: this VM has no public IP - the Cloudflare tunnel is the only way in.
============================================================
EOF
else
  cat <<EOF

============================================================
 DONE.  Now do these once, by hand:
============================================================
 1. Open:  https://$BTCPAY_HOST   (cert issue can take ~1 min after DNS resolves)
 2. First login: create your admin password + enable 2FA (public internet!).
 3. Create a store -> copy the Store ID.
 4. Server Settings -> Access Tokens -> "Create API Key",
    grant store rights -> copy the key.
 5. On your PC, in apps/dashboard/.env set:
      BTCPAY_URL=https://$BTCPAY_HOST
      BTCPAY_API_KEY=<key from step 4>
      BTCPAY_STORE_ID=<store id from step 3>
 6. Watch the sync:
      sudo docker exec btcpayserver_bitcoind bitcoin-cli getblockchaininfo
    (look at verificationprogress; expect 2-5 days for mainnet IBD on the free VM)
 7. Once verificationprogress reaches 1.0, free ~3.5GB of RAM:
      sudo bash tune-after-sync.sh
 8. Update later:  sudo btcpay-update.sh
============================================================
EOF
fi
