#!/usr/bin/env bash
#
# PICC - post-mainnet-sync tuner.
#
# While bitcoind runs its one-time initial block download, we give it a big
# dbcache (4096 MB) so it finishes fast. Once the chain is fully synced that
# cache is wasted memory, so this script drops it to 512 MB and restarts
# bitcoind - freeing ~3.5 GB of RAM for the rest of the box.
#
# Run on the VPS as root, only after IBD is done:
#   sudo bash tune-after-sync.sh
#
set -euo pipefail

OLD_DBCACHE="${1:-4096}"
NEW_DBCACHE="${2:-512}"
BTCPAY_DIR="/root/btcpayserver-docker"
COMPOSE="$BTCPAY_DIR/Generated/docker-compose.generated.yml"

[[ $EUID -eq 0 ]] || { echo "[ERROR] Run as root: sudo bash $0" >&2; exit 1; }

echo "Checking sync progress ..."
PROG=$(docker exec btcpayserver_bitcoind bitcoin-cli getblockchaininfo 2>/dev/null \
       | grep -o '"verificationprogress": *[0-9.]*' | grep -o '[0-9.]*$' || echo 0)
echo "verificationprogress: $PROG"
if ! awk -v p="$PROG" 'BEGIN{exit !(p>=0.999)}'; then
  echo "[SKIP] Node not fully synced yet ($PROG). Wait until it reaches 1.0 and re-run." >&2
  exit 1
fi

grep -q "dbcache=$OLD_DBCACHE" "$COMPOSE" || { echo "[SKIP] dbcache=$OLD_DBCACHE not found - maybe already tuned."; exit 0; }
sed -i "s/dbcache=$OLD_DBCACHE/dbcache=$NEW_DBCACHE/" "$COMPOSE"
echo "Lowered dbcache $OLD_DBCACHE -> $NEW_DBCACHE in $COMPOSE"

cd "$BTCPAY_DIR"
./btcpay-up.sh
echo
echo "Done. bitcoind now uses a small cache; ~3.5 GB RAM freed."
echo "Note: re-running btcpay-setup.sh regenerates the compose and re-applies dbcache=$OLD_DBCACHE."
