# PICC Pi Node — one small device, many Tier 0 bandwidth providers

A Raspberry Pi 4/5 (or any always-on Linux box, ARM or x86) that runs every
containerizable bandwidth-sharing app at once. PICC's Automator panel then
monitors each platform's balance, payout progress and daily quests, and the
extension overlay shows them while you browse.

## Quick start

```bash
cd infra/pi-node
cp .env.example .env          # fill in every credential
sudo bash provision.sh        # installs Docker (if needed), pulls, boots, prints status
```

Re-run `sudo bash provision.sh` any time to pull image updates and restart the
stack. Or manage manually:

```bash
docker compose up -d
docker compose ps
docker compose logs -f --tail=100
docker compose down
```

## What runs here

| Service         | Image                          | Payout min | Notes                                              |
|-----------------|--------------------------------|------------|----------------------------------------------------|
| Honeygain       | `honeygain/honeygain`          | $20 (or 0.5 JMPT) | Official image; confirm the device in Devices. |
| IPRoyal Pawns   | `iproyal/pawns-cli`            | $5         | Requires `--accept-tos`; a login is mandatory.     |
| Traffmonetizer  | `traffmonetizer/cli_v2`        | $10        | `cli_v2` auto-updates its binary; keep the image fresh. |
| Repocket        | `repocket/repocket`            | $10        | API key from the bandwidth-earnings page; VPS ok at lower rates. |
| Mysterium (opt.)| `mysteriumnetwork/mystnode`    | node-based | DePIN VPN node; uncomment the service + register the node. |

Optional `watchtower` service (commented out) auto-updates all containers once
an hour — enable it if you want zero-maintenance image refreshes.

## Not containerizable (keep on the desktop/mobile)

- **EarnApp** — desktop/Android app only. Its ToS **prohibits Docker containers,
  VMs, hosting services and home servers** (penalty: account termination and
  cancelled payouts), so PICC's Pi provisioning does not include it. Track it as
  a desktop-only stream in the Automator panel instead.
- **PacketStream** — desktop app only; note the 3% cashout fee.
- **Grass / Nodepay / Gradient** — official clients are desktop/browser based.
- **Silencio / COIN (XYO)** — mobile-only, location-based. PICC tracks their
  daily quests and reminds you via the dashboard and extension overlay.

## Notes

- All traffic here is ordinary, legitimate bandwidth sharing — no proxies,
  no spoofing, no fake activity. Rate-limit and terms of each provider apply.
- The Pi should be on a stable connection with a public IP for best earnings.
- Logs are capped (`5m × 3` files) so they won't fill the SD card.
