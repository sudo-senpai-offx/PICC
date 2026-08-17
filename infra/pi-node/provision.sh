#!/usr/bin/env bash
# PICC Pi Node provisioner — installs Docker and boots all Tier 0 bandwidth
# providers from docker-compose.yml on a Raspberry Pi (or any Linux box).
#
#   sudo bash provision.sh
#
# Idempotent: safe to re-run to pull updates and restart the stack.

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash provision.sh" >&2
  exit 1
fi

echo "==> PICC Pi Node provisioner"
ARCH="$(uname -m)"
echo "    arch: ${ARCH}"
echo "    distro: $(. /etc/os-release && echo "${NAME} ${VERSION_ID}")"

# --- 1. Docker --------------------------------------------------------------
if command -v docker >/dev/null 2>&1; then
  echo "==> Docker already installed ($(docker --version))"
else
  echo "==> Installing Docker via official script…"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker || true
fi

# Compose plugin (modern docker-ce ships it; install if missing)
if ! docker compose version >/dev/null 2>&1; then
  echo "==> Installing docker compose plugin…"
  apt-get update -y
  apt-get install -y docker-compose-plugin || docker-compose version || {
    echo "Compose plugin unavailable — install manually, then re-run." >&2
    exit 1
  }
fi

cd "$(dirname "$0")"

# --- 2. .env ----------------------------------------------------------------
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "==> Created .env from .env.example"
  echo "    >>> Fill in every credential in $(pwd)/.env, then re-run this script."
  exit 0
fi
echo "==> .env present"

# --- 3. Boot the stack ------------------------------------------------------
echo "==> Pulling images…"
docker compose pull

echo "==> Starting containers…"
docker compose up -d

# --- 4. Status --------------------------------------------------------------
echo
echo "==> Status"
docker compose ps
echo
echo "Device approvals to do in each dashboard:"
echo "  - Honeygain: confirm the device appears in Devices."
echo "  - Repocket: confirm the API key is valid on the bandwidth-earnings page."
