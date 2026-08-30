# PICC Trading Suite — Runbook

Single source of truth for setup, verification, and operation of the trading
suite. Every claim here reflects the code as of commit `0b3aea0+`. If this
document and reality disagree, fix reality or fix this file — never neither.

---

## 1. What PICC is (and is not)

- **Is:** a local decision-support + DEMO-trading system. ExpertOption demo
  autopilot, live candle feeds (your own browser via the extension sensor,
  and/or the embedded studio browser), honest calibration/accuracy reporting.
- **Is not:** a live-money trading bot. There is **no code path that places
  an order on a real account**, on any platform. `connectTradingSession()`
  hard-throws unless `isDemo: true`, independent of any config/env/param.

## 2. Honest risk statement (read once per quarter)

ExpertOption's terms reserve broad discretion to suspend access; they do not
operate an official first-party bot API. The "ExpertBot" products
(expertoptionbot.com / expertbot.co) are third-party companies with their own
service agreements connecting to your profile — their existence does not
sanction third-party automation generally, and expertbot.co's own terms
prohibit automated access to *their* service. PICC drives a real logged-in
browser session and reads its reverse-engineered socket: this sits outside
the sanctioned zone. **No engineering reduces that risk to zero.** What PICC
does deliberately:

- Bounded request pacing (token bucket, default 120 RPM — `PICC_EO_GATEWAY_RPM`)
- No behavioral camouflage anywhere (humanized typing exists but defaults OFF;
  see §6)
- Session-liveness gating: it refuses to act when no live browser session
  stands behind the token
- Frequency you control: cooldowns, daily caps, concurrent limits

Binary options math is unforgiving: at 82% payout you need ~54.9% win rate
just to break even. EU/UK regulator disclosures report 68–89% of retail
accounts losing money. The readiness panel (`/api/trading/readiness`) exists
so you argue with evidence, not vibes.

## 3. Setup checklist (fresh machine)

1. `npm install` (root) → `cd apps/dashboard && npm install`
2. Copy `apps/dashboard/.env.example` → `.env`; fill what you use.
   Trading-critical env vars are all optional with sane defaults:
   - `PICC_EO_GATEWAY_RPM` (120)
   - `PICC_BROWSER_PATH` (auto-detect Edge/Chrome)
   - `PICC_TRADING_DATA_DIR` etc. (default `server/data/…`)
3. `npm run build` (dashboard SPA) then `npm start` (Vite dev) **and**
   `npm run serve` (API server on 127.0.0.1:3000).
4. Load the extension: Edge → `edge://extensions` → Developer mode → Load
   unpacked → `apps/dashboard/extensions/picc-overlay`. Only re-open/reload it
   after the extension's own files change — reloading mid-session invalidates
   live content-script contexts, which the background worker now resurrects
   automatically (and next navigation re-attaches the sensor anyway).
5. Capture your ExpertOption **demo** token:
   - Easiest: open app.expertoption.finance in YOUR browser logged into the
     demo wallet; keep the tab open. The extension bridge feeds candles and
     captures session context automatically.
   - Or: `node scripts/capture-eo-session.mjs` (uses the embedded studio
     browser), or paste a token via Trading Suite settings.
6. Verify: the dashboard chart shows the **LIVE** feed badge (`EXTENSION` /
   `STUDIO` source, or `Yahoo daily · delayed` for a labeled fallback) with
   candles LIVE within ~5s of opening a chart; the Data Sources dockable lists
   each feed's honesty status (live/local/stale/unconfigured). The extension
   popup shows the sensor's connection and observed queue depth ("n/a" when
   unreachable — never a fabricated 0).

## 4. Verification ladder (run top→bottom after every pull)

| Step | Command | Pass looks like |
|---|---|---|
| Unit + integration | `cd apps/dashboard && npm test` | All tests pass |
| Typecheck | `npm run typecheck` | Clean |
| Audit gate | `npm audit --audit-level=high` | 0 vulnerabilities |
| One-shot CI parity | `npm run test:ci` | All three green |
| Server boots | `npm run serve` | `server started … host 127.0.0.1` |
| Decision engine alive | `npm run smoke:trading` | Prints a decision event before timeout |
| Status truth | `curl -s localhost:3000/api/trading/status \| jq .expertOption` | `sessionLive`, `gatewayRpm` present |
| Readiness | `curl -s localhost:3000/api/trading/readiness` | blockers/warnings lists |

Machine-only items CI cannot prove (Part-B): real token capture against the
live site, ≥60s of live ticks on a real chart, one full demo trade cycle,
network-drop recovery while watching the dashboard chart live.

**Part-B · U4FA live venue-session (T13, `docs/specs/PICC_UNIVERSAL_4FA_ENGINE.md` T13 — the
blocking edge for any real-data claim):** on ONE real, logged-in EO demo tab —
1. Extension popup shows the venue row with `sourceLeg` and the ok status (`popup.js:45,105-109`).
2. The popup row appears and the server ACKs the saved session (`POST /api/trading/capture-session`).
3. Live venue data flows — `getBrokerData` shows the real asset, `periods[300]` advances, and
   `getSessionLive()` reports the extension leg.
4. U4FA verdicts over that real data carry honest `candleSource:"liveEO-extension"`; repeat across
   ≥15 min of live bars. Log in the `docs/T11_E2E_MANUAL_LOG.md` format (VERIFIED-MACHINE /
   UNVERIFIED-HUMAN split); any failure blocks T14 and every real-data-consumption UI claim.

**Honesty while watching U4FA (T5/T6):** an unmeasurable spread reports `"spread":"unmeasurable"` with
`spreadSource:null` and never a numeric estimate — the F1 spread gate aborts by design. A news-blackout
verdict may come from the static fallback schedule and is then labelled
`calendarSource:"fallback-schedule"` — never presented as a live feed. Both are intended honesty
signals, not engine faults.

## 5. Operating posture (demo)

- Autopilot ON only while you watch, initially. The dashboard now answers
  "why didn't it trade?" directly (Last decision row + Why? dry-run +
  decision log with skip-reason tally).
- Watch `uptime24h.livePct` for a few days before trusting anything.
- Kill switch: the dashboard's autopilot stop POSTs immediately;
  in-flight ticks are reentrancy-guarded.
- Manual close of an open position: ✕ button in the Positions table.

## 6. Behavioral-camouflage boundary (project policy)

PICC does not implement synthetic mouse movement, randomized clicks, timing
jitter, or anything whose purpose is to defeat platform fraud/bot detection.
The legacy `humanizeInput` typing feature (login autofill convenience) now
defaults **OFF** everywhere; enabling it (`PICC_HUMANIZE=1`) is an explicit,
documented choice — plain `insertText` fill remains the default path. Rate
limiting and liveness checks are the sanctioned tools; they make the client
well-behaved, not disguised.

## 7. Where things live

| Concern | File |
|---|---|
| Autopilot gates/breakers/decision log/readiness | `apps/dashboard/server/services/autopilot.mjs` |
| EO transport + pacing | `apps/dashboard/server/services/expertoption.mjs` |
| Live buffers (studio + extension legs) | `apps/dashboard/server/services/liveEO.mjs` |
| Liveness check | `apps/dashboard/server/services/browserStudio.mjs` (`checkExpertOptionSessionLive`) |
| Scheduler jobs (staleness, liveness, uptime ring) | `apps/dashboard/server/services/scheduler.mjs` |
| Extension sensor relay | `apps/dashboard/extensions/picc-overlay/content.js` (+ `inject.js` upstream sniffer) |
| Read-only CCXT market data | `apps/dashboard/server/services/ccxtConnector.mjs` (mutating methods replaced by throwing stubs) |
