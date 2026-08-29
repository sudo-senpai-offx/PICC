# T11 — E2E Verification Log (extension feed, Part-B runbook style)

**Spec:** `docs/specs/EXTENSION_CONNECTIVITY_ENGINE.md` → T11.
**Acceptance per spec:** *checked-off manual log lands in the PR.*
**Date of machine legs:** 2026-08-29.

Every row below is one of:

- **VERIFIED-MACHINE** — proven headlessly against the real HTTP chain
  (ingest endpoint → liveEO buffers → real ExpertOption broker adapter →
  candles endpoint). The numbers to cross-check in the UI are the exact
  values produced by `apps/dashboard/server/__tests__/e2eExtensionFeedChain.test.mjs`.
- **UNVERIFIED-HUMAN** — requires a real browser + a real ExpertOption demo
  session, which the agent cannot perform. Steps and expected outcomes are
  written so a human can check them off in one pass. T11 stays open until
  these rows are checked.

---

## A. Chart correctness at 1m / 5m / 15m / 1h from the extension feed

Status: **VERIFIED-MACHINE** (all four resolutions, one run).

Procedure performed: 360 `tf:5` push bars (300 s cadence, epoch-aligned first
bar) were POSTed to `/api/extension/ingest` in two 180-frame batches (the
endpoint caps batches at 200 — the extension's real batching contract),
then `/api/trading/candles` was queried for each timeframe.

Observed (asserted by `e2eExtensionFeedChain.test.mjs`, 2026-08-29, 2/2 green):

| Requested | Served | `resolved` | Source | stale | Bars served | Bucket alignment |
|-----------|--------|-----------|--------|-------|-------------|------------------|
| 60 (1m)   | 60     | false     | expertoption | false | 360 | every bar at `floor(t/60)*60` |
| 300 (5m)  | 300    | false     | expertoption | false | 360 | every bar at `floor(t/300)*300` |
| 900 (15m) | 900    | false     | expertoption | false | 120 | every bar at `floor(t/900)*900` |
| 3600 (1h) | 3600   | false     | expertoption | false | 30  | every bar at `floor(t/3600)*3600` |

Chart-value correctness: every served candle equals the aggregation of its
bucket's 5 s bars — `open` = first bar's open, `high` = max of highs,
`low` = min of lows, `close` = last bar's close; 1m/5m buckets hold a single
bar so all four collapse to that bar verbatim. Times are strictly ascending.

**Human cross-check (UI):** on `/suites` with the extension feed live, open
EURUSD and step 1m → 5m → 15m → 1h. Expected: bars at every resolution match
the numbers above (raw Data Sources / EPSQL values for the current bucket),
the chart never shows a resolution-mismatch warning (each requested resolution
is served exactly), and the source badge reads ExpertOption/LIVE.

```
[ ] EURUSD 1m bars render with correct o/h/l/c and no mismatch warning
[ ] EURUSD 5m bars render correctly
[ ] EURUSD 15m bars render correctly
[ ] EURUSD 1h bars render correctly
```

## B. Feed-mode flip (UI ↔ chain)

Status: **VERIFIED-MACHINE** for the chain with both legs feeding; the UI
touch is the only human part.

Procedure performed (through `POST /api/trading/feed-mode` + the ingest
endpoint + `ingestStudioFrame`): preference `extension` → extension frame
consumed (candles close = its close); preference `studio` → studio frame
consumed, a NEW extension frame was **seen but dropped** (`accepted` stayed
flat, candles unchanged); preference back to `extension` → extension frame
consumed again and a new studio frame dropped. Same buffer, both legs alive,
preference honored in both directions. Dropped frames still count as the
leg's liveness signal (fallback semantics — a live feed is never blanked).

**Human check (UI):** with the extension feed live, flip StreamPage /
settings feed mode extension → studio → auto and watch the chart between
flips. Expected: candles never stop updating (no blank chart), and the
Data Sources feed provenance reflects the consumed leg.

```
[ ] Flip extension → studio in the UI: chart keeps updating, provenance flips
[ ] Flip studio → extension: chart keeps updating, provenance flips back
[ ] Flip to auto: chart keeps updating
```

## C. Extension lifecycle in a real Chrome (the original defect)

Status: **UNVERIFIED-HUMAN** — cannot be reproduced in this environment.
The defect being verified is the T1 report: `Uncaught (in promise) Error:
Extension context invalidated.` on `localhost:5173/suites`.

Steps (fresh profile or after reinstall of `apps/dashboard/extensions/picc-overlay`):

1. Load unpacked extension; open `http://localhost:5173/suites` with the
   broker tab in the same window; open DevTools → Console (dashboard tab).
2. Leave the dashboard open and let the extension update / reload the tab
   once (or hit the extension icon close/reopen). Then keep the dashboard
   live for 5 minutes, switching chart resolutions a few times.
3. Toggle the extension off in `chrome://extensions`, then back on; click
   around the dashboard; reload the dashboard tab once.

Expected per row below: the console shows zero `Extension context invalidated`
errors; the queue-depth in the popup reads a number during an active session
and `n/a` (NEVER a fabricated `0`) while the sensor is unobservable; after
re-enable, the next tab navigation re-injects the sensor and frames resume.

```
[ ] Zero "Extension context invalidated" errors over a 5 min live session
[ ] Zero such errors across the disable → enable → reload cycle
[ ] Popup queue depth: number while streaming, "n/a" when unobservable
[ ] After re-enable, frames resume on next navigation (no reload needed)
```

## D. Broker-tab drag (live ExpertOption demo window)

Status: **UNVERIFIED-HUMAN** — requires a real ExpertOption demo session.

1. Log into ExpertOption (demo) in a tab of its own.
2. Drag the broker tab so the dashboard and the broker are side by side.
3. Open a binary chart in the broker tab, move the cursor, change assets.

Expected: the dashboard chart for the same asset tracks the broker within the
sensor batch cadence; Data Sources shows the extension leg serving with the
LIVE badge; no gaps longer than one batch interval while the tab is visible.

```
[ ] Dashboard chart tracks the broker tab's asset in near-real-time
[ ] Data Sources: extension leg serving, LIVE badge, no fabricated 0s
[ ] Dragging / asset switch in the broker does not kill the dashboard feed
```

## E. Live-check findings 2026-08-29 — sensor discovery defect found and fixed

Verification of the live stack (user report: extension feed empty — MTF blank,
confluence idle, chart on Yahoo while Yahoo/paper trading work) surfaced a
code defect in the sensor's server discovery, not an environment quirk:

- Health probes against the RUNNING dev server (2026-08-29, PowerShell):

  ```
  http://127.0.0.1:5173/api/health  ->  REFUSED: Unable to connect
  http://localhost:5173/api/health  ->  HTTP 200
  http://127.0.0.1:3000/api/health  ->  REFUSED: Unable to connect
  ```

- Root cause: the vite dev server bound IPv6 loopback (`[::1]:5173`) only, and
  the sensor probed IPv4 literals (`127.0.0.1:5173` then `127.0.0.1:3000`).
  Both probes were refused; `online` stayed `false` and the relay never fired,
  so the extension feed delivered zero frames — even though the dashboard UI
  worked (it talks same-origin `/api` through `localhost`, which resolves to
  the reachable `::1`).
- Fix (this change): `content.js` now probes BOTH loopback families
  (`127.0.0.1` and `localhost`) across dev (5173) and prod (3000), remembers
  the reachable ORIGIN, and POSTs ingested frames to that same origin.
  `sidepanel.js` server fetch probes `localhost` first, then the IPv4 literal.
  `background.js` already probed via `localhost` and needed no change.
- Machine verification: 47/47 extension tests, full suite 91 files / 900 tests
  green, typecheck 0. The lifecycle harness drains every candidate fetch in one
  sweep, so teardown/dedup/queue semantics are unchanged.
- NOT agent-verified: the browser-side re-check after loading the fixed
  extension (needs a real browser + EO session). Human steps: reload the
  extension from `chrome://extensions`, reopen the broker tab, then the popup
  should read `online :5173` and queue depth a number while streaming; the C/D
  checkboxes above remain the T11 gate.

---

## How the machine rows were produced

Commands run 2026-08-29:

```
npx vitest run apps/dashboard/server/__tests__/e2eExtensionFeedChain.test.mjs
```

Result: `Test Files 1 passed (1) | Tests 2 passed (2)`.

Related suites covering the surrounding legs (all green in the full run):
`extensionIngestEndpoint.test.mjs` (endpoint contract, rate limiting, batch
cap), `feedMode.test.mjs` (gate semantics incl. leg-death fallback),
`resolutionChain.test.mjs` (resolution tags), `sensorContentLifecycle.test.mjs`
(teardown/guard), `extensionIntegrity.test.mjs` (DOM-free sensor lock).

**To close T11:** a human runs sections C and D and the two UI cross-checks,
marks the checkboxes, and this file ships with the PR. Until then T11 remains
open by design.