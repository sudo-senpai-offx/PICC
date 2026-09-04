# Trading Suite — Known Issues (live observations + root cause)

Status: observed 2026-09-04 in the trading suite. **Documented for follow-up; not yet fully
resolved.** Two independent issues surfaced while the suite was in use. Both were investigated
as root-cause (not symptom) — the evidence and the fix candidates are recorded here so the next
slice starts where this one stops.

---

## Issue 1 — "rate limit exceeded — try again later" (429)

### Observed symptom
Users hit an HTTP `429` with body `{"error":"rate limit exceeded — try again later"}`
specifically when **switching between trading suites** during normal use.

### Root cause (surface)
A single in-memory, per-IP **general rate limiter** applied to **every** `POST`/`PUT`/`PATCH`
endpoint that is not on the extension poll-route allow-list:

- `apps/dashboard/server/handlers.mjs` — `rateLimited(key, limit, windowMs)` at line 311.
- General bucket applied at **handlers.mjs:1060-1077**: `general:{ip}` capped at **60 requests /
  60 s**, checked before the body is read, for all non-extension `POST/PUT/PATCH` routes.
- The extension's own high-frequency poll routes (`/api/extension/ingest`, `/heartbeat`,
  `/tab-changed`, `/api/browser/metrics`, `/api/extension/trading-data`) are already exempt
  from this general bucket — so the codebase already treats "high-frequency benign route" as a
  reason to bypass the general gate.

### What makes it false-positive
Switching trading suites mounts a fresh set of panels at once (TradingSuite mounts many cards and
sub-panels). Legitimate suite traffic — chart candle fetch (`/api/trading/candles`, a POST),
watchlist edits, autopilot toggles, data upserts, per-panel refresh POSTs and the suite's shared
admin POSTs — aggregates into one shared 60/min per-IP bucket, so a busy but normal session can
cross the ceiling. A single shared bucket counts *legitimate* multi-panel traffic the same as
circumstance, which is why it trips on a suite switch rather than on abuse.

### Not yet decided / fix candidates (choose in the next slice)
We deliberately have **not** changed the limiter yet — the honest move is to measure the real
per-minute POST count during a normal suite session (Playwright) before tuning, so we do not just
"raise the number to pass." Candidate directions, in preference order:

1. **Exempt semantically-read POST routes** (e.g. `/api/trading/candles` and other cheap read
   endpoints the suite polls) from the general mutation bucket — mirroring the existing
   `EXTENSION_POLL_ROUTES` exemption. Reads shouldn't count against a mutation-oriented
   anti-abuse gate; the real protection stays on state-changing / costly endpoints.
2. Raise the general ceiling to a level measured to fit a real multi-panel suite session (only
   after actually measuring it).
3. Split the general bucket by destructuring routes into "mutation" vs "read" cohorts.

**Do not** weaken demo/live gates, honesty badges, or the serper/EO rate limiters that keep PICC a
courteous client — those are separate and should stay.

---

## Issue 2 — live chart is not updating realtime / not showing the present

### Observed symptom
The chart updates once (a single present candle) but does not keep updating "in the present" —
no live growth of the current candle, and no new candles as time passes, in the trading suite.

### Root cause (evidence chain)
The realtime path is a **shared SSE stream**, not a client poll loop:

- Client: `useRealtimeSuite` (`src/hooks/useRealtimeSuite.ts`) → `subscribeTicks(...)` in
  `useCandleData.ts:320-370` bucketing live ticks into the current candle.
- Transport: a single GET stream `fetch(BASE/trading/realtime)` (`src/lib/liveTrading.ts:350`),
  refcounted so N charts share one connection.
- Server: `GET /api/trading/realtime` (handlers.mjs:1229) is fed entirely by **`subscribeLiveEO`**
  (handlers.mjs:1283) — i.e. live ticks come only from the **ExpertOption live WebSocket feed**.

The live candle movement is therefore **entirely downstream of the EO live feed**. When that feed
is absent, the chart cannot grow the present candle. Two code-level facts confirm this:

1. When EO cannot connect, the fallback serves **Yahoo daily bars**
   (`no liveEO candles — Yahoo fallback is DAILY resolution (timeframe 86400)` at
   handlers.mjs:2047 / 4064). Daily-resolution candles are static history, not live.
2. `useCandleData.ts:331-333` has a deliberate **coarse-series guard**: when the served
   resolution is much coarser than the requested timeframe, it refuses to append new present
   buckets and only nudges the last bar's close. That is a correct safety (you cannot put 5m
   buckets on daily bars), but it means "no new candles in the present" is the *designed*
   behavior while the live feed is down.

### Why EO was not delivering in this environment
The EO connect loop (`server/services/expertoption.mjs:801-811`) iterates **all 12 region URLs**
and breaks on the first success. Several entries are **dead DNS hosts** — verified on this
machine:
- `ws.expertoption.finance` → `ENOTFOUND`
- `ws.expertoption.com` → `ENOTFOUND`
- the `.finance` region variants → `ENOTFOUND`
- while `fr24g1eu.expertoption.com` → **resolves** (IPv4 `172.66.138.243`)

Log evidence: `[picc-live] ExpertOption session error: getaddrinfo ENOTFOUND ws.expertoption.finance`
repeated — the session never reaches a working live feed here, so the suite falls back to Yahoo
daily bars and the present candle never moves.

### Caveat (honest boundary)
This sandbox could not reach any EO WS endpoint, so we **cannot confirm whether the user's
environment has EO genuinely down** or whether this was local to the sandbox. If the user's UI shows
EO "connected" and the chart still does not update, the bug is elsewhere (likely the tick
transport / `subscribeLiveEO` relay) and must be traced there. The mechanism above is the evidence
available; the environment-specificity is the open question.

### Related fix already landed (history side)
A real bug was fixed in the **history** path and is part of the current push:

- `server/services/expertoption.mjs` → `historyCandlesFrom`: multiple candle rows that arrive under a
  single `assetHistoryCandles` batch timestamp used to be stamped with the **same `time`**, so the
  chart's `sanitizeSeries` (which de-duplicates by `time`) collapsed a full history into **one
  candle**. Now each row gets a distinct time (newest anchored at the batch time, older stepped
  back by the group `tf`). Verified with 4 new tests; full suite green.

That fixes "past candles not loading / only one candle." It is a *different* defect from the
realtime "not updating in the present" issue above (which is the live-feed/coarse-guard chain).

---

## Files touched in this investigation (reference)
- `apps/dashboard/server/handlers.mjs` — general per-IP POST limiter (lines 311, 1060-1077);
  realtime SSE fed by `subscribeLiveEO` (1229, 1283); Yahoo-daily fallback warns (2047, 4064).
- `apps/dashboard/server/services/expertoption.mjs` — EO region URL list (35-48), connect loop
  (801-811), `historyCandlesFrom` batch-time normalization (FIXED).
- `apps/dashboard/server/services/rateLimit.mjs` — the courtesy rate limiter (shared budget).
- `apps/dashboard/src/hooks/useCandleData.ts` — `subscribeTicks` realtime bucketing + the
  coarse-series guard (320-370).

## Open questions for the next slice
1. Measure the real per-minute POST count during a normal suite session, then pick fix candidate
   #1/#2/#3 above for the 429.
2. Confirm whether the user's EO feed is actually connected in their environment; if yes, trace
   the live-tick relay (`subscribeLiveEO` → SSE) for why the present candle does not animate.
