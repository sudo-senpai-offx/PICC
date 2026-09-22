# PICC Trading Suite — WS-1 · Live Order Lifecycle (Hyperliquid perps, testnet-first) — spec v1

# Status: APPROVED

**Date:** 2026-09-21 · **Workstream:** WS-1 of `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md` (APPROVED) · **Kind:** implementation-ready plan · **Approved by:** owner (2026-09-21), subagent-driven implementation.

**Binding canon (all read and verified in this session, file:line grounded):**
- Master design: `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md` (WS-1 block `:41-47`, locked decisions `:25-37`, current limitations `:76-84`)
- Runbook: `docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md` (credential seam `:15-23`, wallet-key mode `:314-332`, envelope collision `:132-146`, scaling ladder `:336-359`)
- Seams: `apps/dashboard/server/services/ccxtOrdering.mjs`, `ccxtConnector.mjs`, `commandCentre/ccxtExecution.mjs`, `commandCentre/safetySidecar.mjs`, `commandCentre/policyGraphCatalog.mjs`, `commandCentre/policyGraphValidator.mjs`, `commandCentre/commandCentreExecution.mjs`, `commandCentre/auditTrail.mjs`, `positionManager.mjs`, `services/u4faRisk.mjs`
- v3.2 semantics: `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` + `docs/adr/0003` (no position/execution conflict — position lifecycle is a venue-layer concern the v3.2 decision surface does not assert on)
- ADR-0005 additive-only; ADR-0003 granularity; ADR-0004 decision core

---

## 1. Purpose

Make the live order lifecycle real on the first sanctioned venue — **Hyperliquid perps, testnet first** — without weakening any existing gate, seam, or honesty rule. The live execute path has never touched a real venue, even in sandbox (master spec limitation 1, `:78`). WS-1 closes exactly that gap: a venue-adapter contract, an HL perps adapter, a live position manager with restart-persistent state, the existing 10-gate sidecar **extended additively** with perps-specific gates, and a real-HL-testnet sandbox E2E. Everything stays additive per ADR-0005; OFF/absent = null + explicit reason per ADR-0005/`executionAbsence` doctrine.

## 2. Requirements

Each requirement is testable in isolation; the section it maps to in the master spec is cited. Existing behavior is never altered — only extended (ADR-0005).

### R1 — Venue-adapter contract (venue-agnostic, providers pluggable)
- R1.1 A single contract module defines the interface a live-execution venue must implement, with the exact method surface from the master spec: `{ id, markets(), submitOrder, verifyFill, observeEquity, positionView, riskModel }` (master spec `:42`).
- R1.2 A registry dispatches by venue id; unknown venue ids resolve to an honest null (never a fabricated adapter).
- R1.3 A shape validator asserts a registered adapter implements the full contract; a non-conforming adapter is rejected at registration with the missing members named.
- R1.4 The contract is satisfied by Hyperliquid (WS-1, first implementation); iqoption and ExpertOption are second/third and are NOT implemented in WS-1 (master spec `:29`, `:30`). Nothing in the contract is HL-specific; HL-specific behavior lives inside the HL adapter.
- R1.5 `riskModel` (the cap envelope the seam itself enforces — master spec `:47` "leverage/liquidation geometry not reachable via config alone") exposes: `leverageBandMin/Max`, `marginPerPositionCapUsd`, `isolatedOnly` (bool), `maxOpenPositions`, `fundingStaleMs`, `testnetOnly` (bool, true until the WS-3 unlock ceremony).

### R2 — Hyperliquid perps adapter (testnet-first, isolated, capped, LIMIT-only)
- R2.1 Testnet is the default: every adapter method refuses live endpoints unless explicit mainnet enablement is present (env `PICC_CCXT_PERPS_MAINNET_ENABLED=1`) AND sandbox mode is not requested; sandbox wins over mainnet (per-exchange-over-global precedent, `ccxtOrdering.mjs:122-124`). Absent both → `{ok:false, reason:"perps-rail-off: …"}` naming exactly which env flag is missing. (Master spec `:78` — precondition for any real-money recommendation; WS-1 keeps the rail testnet-only.)
- R2.2 Adapter instances run in ccxt **swap** default type for HL (verified: ccxt 4.5.75 hyperliquid `defaultType: "swap"`, `has.swap === true`, `has.sandbox === true`, `setLeverage`/`setMarginMode` functions, `requiredCredentials` = walletAddress+privateKey). Credentials come from the existing wallet-key env pair (`PICC_CCXT_WALLETADDRESS_HYPERLIQUID` + `PICC_CCXT_PRIVATEKEY_HYPERLIQUID`, `ccxtOrdering.mjs:109-126`, `.env.example:148-149`).
- R2.3 **Isolated margin only**: `setMarginMode("isolated", symbol)` is applied idempotently before any order; an adapter call that would operate a cross position is refused. (Master spec `:30`.)
- R2.4 **Leverage band 3–5× enforced**: the adapter refuses (does not silently clamp — same doctrine as `ccxtOrdering.mjs:14-15`) any requested leverage outside `[PICC_CCXT_LEVERAGE_MIN=3, PICC_CCXT_LEVERAGE_MAX=5]`. `setLeverage(x, symbol)` is applied idempotently. (Master spec `:30`.)
- R2.5 **Margin-per-position cap** replaces the spot-era flat $10 notional cap for the perps rail: `PICC_CCXT_MARGIN_PER_POSITION_CAP_USD`, default **10** (the pocket-money scale of the runbook account ~US$18 observed equity, `HYPERLIQUID_CONNECT_RUNBOOK.md:326`); env-configurable. Notional allowed = leverage × margin; the adapter refuses any order whose implied margin exceeds the cap. The spot seam's `CCXT_HARD_NOTIONAL_CAP_USD = 10` (`ccxtOrdering.mjs:47`) is untouched (no regression). (Master spec `:30`, `:43`.)
- R2.6 **Orders remain LIMIT-only** (never market) per existing doctrine (`ccxtOrdering.mjs:11-12`); the adapter accepts only explicit limit orders with GTC default, and refuses market/IOC/trigger order types. (Master spec WS-1; `ccxtConnector.mjs` `READ_ONLY_BLOCKED` stays the guard for every other module — `:33-66`.)
- R2.7 Order identity: HL `clientOrderId` is a 128-bit hex string; the adapter maps PICC's `clientOrderId` (non-hex, `ccxtExecution.mjs:37-39`) through a deterministic hex derivation and documents the mapping in the returned order record. (ccxt hyperliquid source: `params.clientOrderId` hex, verified in installed ccxt 4.5.75.)
- R2.8 `submitOrder` validates the symbol against the venue's **swap** markets (refuses spot symbols and unknown symbols, using `markets()` output — no hardcoded symbol table).
- R2.9 `verifyFill` returns the honest normalized fill from the venue (`fetchOrder`); an unobservable venue resolves to null → callers report "verify unobserved", never a fabricated fill (mirrors `verifyCcxtFill` `ccxtOrdering.mjs:251-265`).
- R2.10 `observeEquity` reads the swap-wallet equity; `positionView` reads open perps positions from the venue; `observeFunding` reads the current funding rate (ccxt `fetchFundingRate`, present in installed build). All three return honest null/`{ok:false, reason}` shapes on failure — never invented numbers (ADR-0005).
- R2.11 Close path = **reduce-only LIMIT** (verified: ccxt hyperliquid `has.closePosition === false` and `createReduceOnlyOrder === true`); the adapter marks close orders `reduceOnly: true` and refuses a close that would exceed the open position size.

### R3 — Live position manager (restart-persistent, honest P&L, WS-3 state persisted)
- R3.1 Tracks open perps positions (ids, symbol, side, entry, size, leverage, margin, openedAt, openOrderId) with **restart-persistent** storage; a server restart reloads the store and reconciles against the venue `positionView` (ADR-0005: reconciliation outcomes are labeled `venue-observed` / `persisted` / `reconciled`, never merged silently).
- R3.2 Realized P&L on close: long `(exit−entry)×size`, short `(entry−exit)×size`; fees are taken from the verified fill payload when the venue reports them, else reported `fees:"unobserved"` (never a made-up fee). Funding accrual is included only from funding observations actually captured during the hold; a hold that crossed a funding boundary without an observation reports `fundingAccrual:"unobserved-portion"` and the P&L is stated without a funding adjustment plus that explicit reason (ADR-0005).
- R3.3 A position that vanishes from the venue without a verified close records `closed-unobserved` with `pnl: null` + reason — closing P&L is only ever claimed from a verified fill (mirrors `ccxt-verify:unobserved` semantics, `ccxtExecution.mjs:287-300`).
- R3.4 Persists the **peak-anchored wallet state WS-3's breaker consumes** (master spec `:32`, `:51`): equity snapshot, running-peak equity (one-way ratchet — never decreases), drawdown-from-peak %, peak timestamp, and a reserved `halted: null` field. WS-1 computes and persists this state only; the −10%/−15% trip enforcement is WS-3's job and is NOT implemented here.
- R3.5 **No competing day-loss semantic**: WS-1 introduces no new barrier. The perps leg observes its own per-venue equity + UTC day baseline (same `dayKeyOf` algorithm, `u4faRisk.mjs:29-31`) purely as the input to the existing 5D envelope gate (`maxDailyLossPct: 5`). The single UTC-aggregated barrier and the retirement of per-site −5% as authoritative stay WS-3 (master spec `:31`). (See Honesty Notes §8.1.)
- R3.6 Hyperliquid perps are one-way netted (ccxt `has.setPositionMode === false`); opposite-side fills REDUCE an open position rather than opening a second. The manager treats reductions as size changes and never counts a netted symbol twice in the open-position cap (R5.4). The cap gate always evaluates the **post-fill** net position.

### R4 — Integration: the 10-gate sidecar extended, never bypassed
- R4.1 The perps rail runs the **existing 10 gates unchanged** (`GATE_ORDER`, `safetySidecar.mjs:32-43`, `evaluateGate` `:126-286`) with `power: "proposals"` + fresh per-action `consentBy` — same consent semantics as the ccxt leg (propose + execute + close are each per-action human-approved; never an automation opt-in, `safetySidecar.mjs:194-200`).
- R4.2 **Additive perps gate list** (enumerated, numbered 11–15, appended AFTER the existing 10; the existing 10 keep their fixed order and are byte-identical):
  - **11 perps-leverage-band** — proposal `leverage` ∈ [3,5] (env-configurable); absent/NaN → deny.
  - **12 perps-margin-cap** — implied margin (`notionalUsd / leverage`) ≤ `PICC_CCXT_MARGIN_PER_POSITION_CAP_USD` (default 10); evaluated on the post-close state for reduce-only closes (a close never adds exposure).
  - **13 perps-isolated-only** — proposal `marginMode === "isolated"`; `cross` denied with reason.
  - **14 perps-position-cap** — net open perps positions (R3.6) < `PICC_CCXT_PERPS_MAX_OPEN_POSITIONS` (default 1) after this action.
  - **15 perps-funding-fresh** — a funding observation for the symbol exists within `PICC_CCXT_FUNDING_STALE_MS` (default 2h; HL funding settles hourly); absent/stale → deny with the observed age (funding-aware per master spec `:43`).
- R4.3 These gates live in a NEW module (`perpsGates.mjs`) composed after `evaluateGate` allow; `safetySidecar.mjs` is not modified (byte-identity of existing gate behavior; `commandCentre.sidecar.test.mjs` stays green untouched). Every allow/deny — from the 10 AND from the 5 — is audited (the sidecar's always-on audit contract, `safetySidecar.mjs:23-26`).
- R4.4 Gate 5D envelope for the perps site: `maxExposureUsd` for the perps site means **margin deployed**, not notional (definition stated for the perps template only; the `trading:ccxt` template keeps its $10 notional meaning and value — no regression).
- R4.5 The seam independently refuses over-cap orders even if the gates were bypassed (defense-in-depth mirrors `ccxtOrdering.mjs:13-15` + the envelope test `ccxtExecution.test.mjs:82-89`): `submitOrder` re-checks margin cap, leverage band, isolated mode, and symbol class before any network call.

### R5 — Sandbox E2E on real HL testnet
- R5.1 A dedicated E2E test file exercises the HL adapter against the REAL Hyperliquid testnet API (`api.hyperliquid-testnet.xyz` — verified in installed ccxt 4.5.75) for: `markets()` non-empty, `observeEquity` (value or explicit `{ok:false, reason}`), `observeFunding` (value or honest null), and a **place→cancel round trip** (a GTC limit resting far from the market, then cancelled) — no stubbed responses, no mocked ccxt.
- R5.2 **Deposit-free**: the E2E contains no deposit/funding step. If the testnet wallet balance is 0, the fill-dependent steps (fill verification, open→close) report step-level `skipped: "… testnet balance 0 — deposit-free doctrine"` with the observed balance, never a fabricated fill or P&L.
- R5.3 Without HL testnet credentials the whole file skips with one explicit reason naming the missing env pair (ADR-0005) — CI stays green without creds; the run command with creds is documented.
- R5.4 Assertions check non-emptiness and shape of sent/received payloads per step (order id present, cancel observed, equity numeric when ok) — the point is provenance, not profitability.

### R6 — Additive-only and OFF/absent honesty (ADR-0005)
- R6.1 No existing module's exported signature or behavior changes; the only touched existing file is `ccxtOrdering.mjs` (one additive optional parameter, R2.2/§T2) plus `policyGraphCatalog.mjs` (one new template row) and `handlers.mjs` (new additive routes + overview additions). Everything else is new files.
- R6.2 Mainnet perps = OFF in WS-1 regardless of env: even with `PICC_CCXT_PERPS_MAINNET_ENABLED=1`, the adapter still refuses when sandbox mode is unavailable/not requested, and the WS-3 unlock ceremony is the only path that removes the refusal (this spec does not remove it).
- R6.3 Every "OFF"/missing state carries an explicit reason string; null ≠ 0.

## 3. Design

### 3.1 File map (create / modify)

**CREATE (all `.mjs`, ESM, server-side — the adapter/position-manager core stays `.mjs` per convention; no TS needed here):**

| # | File | Role | Depends on |
|---|---|---|---|
| F1 | `apps/dashboard/server/services/venues/venueAdapterContract.mjs` | Contract types, registry (`registerVenueAdapter`, `venueAdapterFor`, `venueAdapterIds`), `validateVenueAdapter` shape assertion | — |
| F2 | `apps/dashboard/server/services/venues/hyperliquidPerps.mjs` | HL perps adapter implementing the contract; enforces R2.1–R2.11 at the seam | F1; T2 extension of `ccxtOrdering.mjs` |
| F3 | `apps/dashboard/server/services/livePositionManager.mjs` | Live perps position tracking, realized P&L, restart persistence, peak-anchored equity state (R3) | F2 (`positionView`/`observeEquity`/`observeFunding`/`verifyFill`) |
| F4 | `apps/dashboard/server/services/commandCentre/perpsGates.mjs` | The 5 additive gates (R4.2) + `evaluatePerpsGate` compose + denial cascade | `safetySidecar.mjs` (read-only) |
| F5 | `apps/dashboard/server/services/commandCentre/perpsExecution.mjs` | Proposal/execute/close/verify rail mirroring `ccxtExecution.mjs` | F4, `commandCentreExecution.mjs`, `auditTrail.mjs`, F3 |

**MODIFY (additive only):**

| # | File | Change |
|---|---|---|
| M1 | `apps/dashboard/server/services/ccxtOrdering.mjs` | `ccxtInstanceFor(id, { requireKeys, sandbox, defaultType = "spot" })` — one optional param; instance cache key becomes `${id}:${defaultType}` (spot callers unaffected); header comment gains the perps note. No other function changes. |
| M2 | `apps/dashboard/server/services/commandCentre/policyGraphCatalog.mjs` | New template row `trading:perps` (schema below); `trading:ccxt` row byte-identical. |
| M3 | `apps/dashboard/server/handlers.mjs` | New additive routes under `/api/command-centre/perps/*` + `trading:perps` feed/execution rows in the overview composer input (`:1505-1526` area). |
| M4 | `apps/dashboard/.env.example` | Document the new env vars (additive block). |
| M5 | `apps/dashboard/server/__tests__/*` (new test files listed in §T tasks) | Test floor grows; no existing test file is edited except where a test asserts the *absence* of swap support must be relaxed — none found; all existing suites stay untouched and green. |

**CREATE tests:** `__tests__/venueAdapter.test.mjs`, `__tests__/hyperliquidPerps.test.mjs` (fixture ccxt via `_setCcxtLibForTests`), `__tests__/livePositionManager.test.mjs`, `__tests__/perpsGates.test.mjs`, `__tests__/perpsExecution.test.mjs`, `__tests__/commandCentre.perpsApi.test.mjs`, `__tests__/hyperliquidPerps.sandboxE2E.test.mjs` (real testnet).

### 3.2 Venue-adapter contract (F1) — exact interface

```js
// venueAdapterContract.mjs exports:
registerVenueAdapter(adapter)        // throws on validateVenueAdapter failure; id must be unique
venueAdapterFor(id)                  // adapter | null (null = honest "no adapter for venue")
venueAdapterIds()                    // sorted string[]
validateVenueAdapter(adapter)        // { ok, errors: [{code, message}] } — P-SPECIFICITY-style collect-all

// An adapter must export these members (validateVenueAdapter asserts them):
{
  id: "hyperliquid",                 // registry key
  label: "Hyperliquid perps (testnet)",
  markets: async () =>               // Promise<Array<{ symbol, base, quote, type: "swap",
                                     //   minAmount, minNotional, isActive, fundingTickMs } | {ok:false, reason}>>
  submitOrder: async ({ symbol, side, amount, price, leverage, marginMode,
                       reduceOnly, clientOrderId }) =>
    // Promise<{ ok:true, order:{ id, clientOrderId, symbol, side, type:"limit",
    //   amount, price, status, at, marginUsd, leverage, reduceOnly } }
    //       | { ok:false, reason }>
    // REFUSES (never clamps): non-limit type; leverage outside band; marginUsd > cap;
    // marginMode !== "isolated"; symbol not in swap markets; mainnet without enable; reduceOnly > position size
  verifyFill: async ({ symbol, orderId }) =>
    // Promise<{ ok:true, fill:{ id, symbol, side, filled, average, fee, status, at } } | null>
    // null = unobserved, never a fabricated fill
  observeEquity: async () =>
    // Promise<{ ok:true, equityUsd, currency, at } | { ok:false, reason }>
  positionView: async () =>
    // Promise<Array<{ symbol, side, size, entryPrice, notional,
    //   leverage, marginMode, liquidationPrice, at }>>  — empty array = no positions (observed)
  observeFunding: async ({ symbol }) =>
    // Promise<{ ok:true, rate, fundingIntervalHrs, at } | { ok:false, reason }>
  riskModel: {
    leverageBandMin: 3,            // PICC_CCXT_LEVERAGE_MIN
    leverageBandMax: 5,            // PICC_CCXT_LEVERAGE_MAX
    marginPerPositionCapUsd: 10,   // PICC_CCXT_MARGIN_PER_POSITION_CAP_USD
    isolatedOnly: true,
    maxOpenPositions: 1,           // PICC_CCXT_PERPS_MAX_OPEN_POSITIONS
    fundingStaleMs: 7_200_000,     // PICC_CCXT_FUNDING_STALE_MS (2h default)
    testnetOnly: true              // flips false only by WS-3 ceremony (out of WS-1)
  }
}
```

`submitOrder`'s cap math (the seam's independent ceiling, R4.5): `marginUsd = amount * price / leverage`; refuse if `marginUsd > riskModel.marginPerPositionCapUsd`. The proposal-side clamp (R4.2 gate 12) mirrors `clampAmountToCap` (`ccxtExecution.mjs:57-64`): shrink `amount` so `marginUsd ≤ cap`, surfaced as `clamped: true` in the durable proposal — same visible-clamp doctrine as the spot leg.

### 3.3 HL adapter specifics (F2)

- Instance: `ccxtInstanceFor("hyperliquid", { requireKeys: true, defaultType: "swap" })` (M1 extension). Credential/sandbox selection reuses `ccxtKeysForExchange` unchanged (`ccxtOrdering.mjs:109-126`).
- Testnet-first (R2.1): before ANY method, resolve mode:
  - `sandbox = PICC_CCXT_SANDBOX_HYPERLIQUID === "1" || PICC_CCXT_SANDBOX === "1"` (existing semantics, `ccxtOrdering.mjs:122-124`);
  - `mainnetAllowed = PICC_CCXT_PERPS_MAINNET_ENABLED === "1"`;
  - if `!sandbox && !mainnetAllowed` → every method `{ok:false, reason:"perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)"}`;
  - sandbox wins when both set. `setSandboxMode(true)` is applied before any order (echoing `ccxtOrdering.mjs:164-174` safeguard, incl. the never-silent warning when the venue lacks sandbox).
- Setup sequence before first order per symbol (idempotent, cached per symbol): `loadMarkets()` → assert swap market → `setMarginMode("isolated", symbol)` → `setLeverage(x, symbol)`. Failure of any step returns `{ok:false, reason}` with the step named.
- `clientOrderId` mapping (R2.7): `hexCloid = "0x" + sha256(clientOrderId).slice(0, 32)`; the human-readable PICC id stays in the audit/proposal; the hex cloid is recorded in the order record and returned from `submitOrder`.
- Close (R2.11): `submitOrder({..., reduceOnly: true})`; the position manager never allows a close whose `amount > position.size` — the adapter refuses (checked before the network call).
- Everything else (fetchOrder/fetchBalance/fetchFundingRate/fetchPositions) goes through ccxt's unified methods on the swap instance, normalized to the contract shapes; parse failures ⇒ `{ok:false, reason:"…-unobservable"}`.

### 3.4 Live position manager (F3)

Data dir = `PICC_COMMAND_CENTRE_DATA_DIR` (fallback `../data` from `commandCentre/` — same convention as `auditTrail.mjs:25-27` and `ccxtOrdering.mjs:61-63`).

- `ccxt-perps-positions.json` (overwrite, object store — same shape discipline as `ccxt-equity.json`, `ccxtOrdering.mjs:307-312`): `{ version: 1, positions: [ { id, symbol, side, size, entryPrice, leverage, marginUsd, marginMode, openedAt, openOrderId, source } ] }`.
- `ccxt-perps-risk.json` (the WS-3-consumed state, R3.4): `{ version: 1, equityUsd, equityAt, runningPeakUsd, peakAt, drawdownFromPeakPct, dayKey, dayStartEquityUsd, dayLossPct, halted: null }` — `runningPeakUsd` ratchets up only; `drawdownFromPeakPct = peak > 0 ? (peak − equity)/peak : null`; `halted` reserved, always null in WS-1 (enforcement is WS-3).
- Functions (all pure-ish, `now` injectable like `observeCcxtEquity`, `ccxtOrdering.mjs:352`):
  - `trackOpen({ position })` / `recordReduction({ positionId, filledSize, avgPrice })` (R3.6) / `recordClose({ positionId, fill, fundingObservations })` → returns `{ positionId, realizedPnlUsd, fees: "observed"|"unobserved", fundingAccrual: "observed"|"unobserved-portion", reason }`.
  - `openPositions()` — persisted view with `source` labels; `reconcileWithVenue(positionView)` — labels `venue-observed` / `persisted` / `reconciled`; vanished-without-verify ⇒ `closed-unobserved` (R3.3).
  - `observePerpsWallet(adapter)` — equity snapshot + day-baseline maintenance (R3.5) + peak ratchet + `updateRiskFile()`.
- P&L math (R3.2): realized = direction-signed `(exit − entry) × size`; fees from fill payload or `"unobserved"`; funding only from captured observations.
- Boot: `reconcileWithVenue` runs on first `openPositions()`/`observePerpsWallet` after restart.

### 3.5 Perps gates (F4)

`evaluatePerpsGate({ template, proposal, observation, audit = appendAudit })` where `observation` carries `{ leverage, notionalUsd, marginMode, openNetPositions, funding: { rate, at } | null }`. Deny-cascade in the enumerated order 11→15, each deny audited as `safety-gate:deny` with a `blockedBy` name from the list in R4.2. For reduce-only closes (R4.2 note): gate 12/14 evaluate the post-close state (zero exposure → pass); gate 11 uses the position record's declared leverage; gate 15 still requires funding freshness (a close without a fresh funding read is refused — the human re-proposes when the venue answers).

### 3.6 Execution rail (F5)

Mirrors `ccxtExecution.mjs` structure exactly, with perps namespaces:

- `PERPS_OPEN_ACTION = "perps:open-order"`, `PERPS_CLOSE_ACTION = "perps:close-order"`, `PERPS_SITE = "trading:perps"`.
- Idempotency keys: `perps:order:<exchange>:<clientOrderId>`, `:exec` suffix; closes: `perps:close:<exchange>:<positionId>:<clientOrderId>` + `:exec`. Deterministic pairs, never counters (`ccxtExecution.mjs:42-49` precedent).
- `proposePerpsOpen(...)` → clamp margin to cap (visible `clamped:true`), auto-rendered rationale citing leverage, margin, funding observation and day-loss (`orderRationale` pattern `ccxtExecution.mjs:104-111`), run `evaluateGate` (10) then `evaluatePerpsGate` (5) — both audited — record `proposal:created`.
- `executePerpsOpen(...)` — carrier A: re-run FULL 10+5 at click with fresh observations (equity, funding, positions, kill, day-loss); only a pass reaches `adapter.submitOrder` (via `executeProposal`, `commandCentreExecution.mjs:47-95`). Limit sanity vs fresh reference reuses `limitPriceSanity` (`ccxtExecution.mjs:72-101`).
- `verifyPerpsOpen(...)` — carrier B: read-only `adapter.verifyFill`, audited `perps-verify:filled|unobserved` (never fabricated).
- `executePerpsClose({ positionId, price, consentBy, ... })` — same 10+5 chain, reduce-only executor, replay from the durable position record; on verified fill, `livePositionManager.recordClose`.
- `perpsProposalsFromAudit(audits)` — list surface mirroring `proposalOrdersFromAudit` (`ccxtExecution.mjs:284-319`), extended with `kind: "open"|"close"` and `positionId`.

### 3.7 Catalog row (M2)

```js
{
  site: "trading:perps",
  stream: "trading",
  venue: "hyperliquid perps (swap, testnet-first)",
  automationPermission: "sanctioned",
  demoOnly: false,
  roster: TRADING_ROSTER,                       // same roster as trading:ccxt
  edges: [ /* same 9 edges as trading:ccxt — copy is deliberate and validated by validateCatalog */ ],
  loops: [ /* same loops as trading:ccxt */ ],
  envelope: {
    mode: "copilot",                             // proposals-powered rail: per-action human consent
    maxExposureUsd: 10,                          // = MARGIN per position in this site (R4.4); default cap
    maxConcurrent: 1,                            // one execution in flight
    maxDailyLossPct: 5                           // same 5D ceiling as trading:ccxt (WS-3 unifies)
  },
  protocols: PROTOCOLS
}
```

Must pass `validateCatalog` (`policyGraphValidator.mjs:227-233`); the validator's 5C/5D checks accept this shape (sanctioned + non-demoOnly + mode copilot — verified against `:169-208`).

### 3.8 Routes (M3)

Additive, same auth/validation conventions as the ccxt rail (`handlers.mjs:1618-1757`): `GET /api/command-centre/perps/positions`, `POST /api/command-centre/perps/propose`, `POST /api/command-centre/perps/execute`, `POST /api/command-centre/perps/close`, `POST /api/command-centre/perps/verify`. Replay-from-durable-proposal discipline is the same: execute/close/verify parameters come from the recorded proposal/position, never re-trusted from the body (`handlers.mjs:1575-1576`, `:1679`). Overview: `feeds["trading:perps"]` from the perps equity store + `execution["trading:perps"]` from `executionStatus()` + its idempotency/action fields — additive keys only (composer contract "every cell OBSERVED or not-wired" must be honored for the new site; exact per-cell render of a new site row is verified at implementation — see §8.2).

### 3.9 Env vars (new; documented in `.env.example`, read via `process.env` at call time like the existing seam — no `config.mjs` change)

| Var | Default | Meaning |
|---|---|---|
| `PICC_CCXT_MARGIN_PER_POSITION_CAP_USD` | `10` | margin-per-position cap (R2.5); replaces the flat $10 notional cap for the perps rail |
| `PICC_CCXT_LEVERAGE_MIN` / `PICC_CCXT_LEVERAGE_MAX` | `3` / `5` | leverage band (R2.4) |
| `PICC_CCXT_PERPS_MAX_OPEN_POSITIONS` | `1` | net-position cap (R3.6/R4.2 gate 14) |
| `PICC_CCXT_FUNDING_STALE_MS` | `7200000` (2h) | funding-freshness window (R4.2 gate 15) |
| `PICC_CCXT_PERPS_MAINNET_ENABLED` | absent (OFF) | mainnet enablement — WS-1 refuses live endpoints regardless (R2.1/R6.2) |
| (reused) `PICC_CCXT_SANDBOX_HYPERLIQUID` / `PICC_CCXT_SANDBOX` | — | existing sandbox selectors (`ccxtOrdering.mjs:122-124`) |

An invalid numeric env (non-finite, ≤0, min>max) at first use ⇒ the adapter reports `{ok:false, reason:"invalid-environment: <var>=<value>"}` — never a silent fallback (honest OFF).

## 4. Non-goals (explicitly out of WS-1)

1. **Mainnet live trading** — any real-money order placement; live credentials beyond the existing HL testnet-ready pair; real funds (runbook §4/§9 funding is untouched).
2. **The MDD breaker itself** (−10%/−15% trip, size step, one-way latch enforcement) — WS-3. WS-1 only persists the state (R3.4).
3. **The single UTC-aggregated day-loss barrier** and the retirement of per-site −5% as authoritative — WS-3 (R3.5).
4. **iqoption and ExpertOrder adapters** — second/third venues deferred (R1.4); EO stays `forbidden`/demo-only per its catalog row.
5. **The T6 spread gate wiring** and non-crypto instrument classes — master spec WS-2; crypto/HL-only in WS-1 (`PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md:79`).
6. **UI changes** except the minimal command-centre additions required by the consent flow (new routes/panels data); no TradingSuite redesign.
7. **Dependency bumps, npm audit fixes, flaky-parallel-test bisection** — separate tickets (recent audit verdict; do NOT fold into WS-1).
8. **Funding-accrual reconciliation** beyond observed observations (R3.2 keeps it honest by labeling; full accrual accounting is a later refinement).
9. **Autopilot/automation power for the perps site** — proposals power only, forever in WS-1 (no `live`/`liveDemo` path on `trading:perps`).

## 5. Checklist tasks (ordered; each acceptance criterion is a command or a test)

### T1 — Venue-adapter contract + registry (`F1`)
Acceptance: `validateVenueAdapter` rejects an adapter missing any of the 8 contract members with each missing name in `errors`; `registerVenueAdapter` accepts a conforming fixture adapter and throws on a duplicate id; `venueAdapterFor("unknown") === null`; `venueAdapterIds()` sorted. Tests: `__tests__/venueAdapter.test.mjs` (≥6 tests). Command: `npx vitest run __tests__/venueAdapter.test.mjs`.

### T2 — `ccxtOrdering.mjs` additive instance extension (`M1`)
Acceptance:
- `ccxtInstanceFor(id)` (no args beyond today's) still returns a spot-default, single-cache instance — all existing `ccxtOrdering.test.mjs` tests pass **unchanged**.
- `ccxtInstanceFor("hyperliquid", { defaultType: "swap" })` builds an instance whose `options.defaultType === "swap"` and does NOT return the spot-mode cached instance (cache keyed `id:type`) — fixture library proves both exist simultaneously with different `defaultType`.
- `defaultType:"spot"` explicit == omitted.
Tests: extend `__tests__/ccxtOrdering.test.mjs` additively (new describe block, existing tests untouched) or new `__tests__/ccxtOrdering.defaultType.test.mjs`. Command: `npx vitest run __tests__/ccxtOrdering.test.mjs __tests__/ccxtOrdering.defaultType.test.mjs`.

### T3 — HL perps adapter (`F2`) — unit/refusal surface with fixture ccxt
Acceptance (fixture ccxt via `_setCcxtLibForTests`; no live calls):
- `submitOrder` refuses: market type; leverage 2 and 6 (band); marginUsd 10.01 > cap 10; `marginMode:"cross"`; a spot symbol; reduceOnly amount > position size; live mode with sandbox off and mainnet env absent — each `{ok:false, reason}` names the violated rule (R2.1, R2.3–R2.8, R4.5).
- Under `PICC_CCXT_SANDBOX=1`: `setSandboxMode(true)` called before the order; order params reach the fixture `createOrder` with `type:"limit"`, swap symbol, `clientOrderId` = deterministic 0x-hex (same input ⇒ same cloid, length ≤ 66 chars), `reduceOnly` passed for closes.
- `observeEquity`/`positionView`/`observeFunding` map fixture payloads to the contract shapes; a throwing fixture yields `{ok:false, reason}` (≤3 real reasons tested, the rest covered by contract tests).
- `riskModel` reads the env defaults (3/5/10/1/2h) and reports `invalid-environment` for garbage env values.
Tests: `__tests__/hyperliquidPerps.test.mjs` (≥14 tests). Command: `npx vitest run __tests__/hyperliquidPerps.test.mjs`.

### T4 — Live position manager (`F3`)
Acceptance (tmp-dir data dir pattern from `positionManager.test.mjs:9-20`):
- open + reduction (opposite-side fill nets size, R3.6) + close produce correct realized P&L for long and short (entry 100, exit 110, size 2 ⇒ +20 long; entry 100, exit 90 ⇒ +20 short).
- Fee present in the fill ⇒ `fees:"observed"` and P&L net of it; fee absent ⇒ `fees:"unobserved"` and P&L stated gross with the label.
- Funding observations captured during hold ⇒ included; hold crossing a boundary without observation ⇒ `fundingAccrual:"unobserved-portion"` + reason (R3.2).
- Restart persistence: write positions, `vi.resetModules()` + re-import with the same dir ⇒ positions reload; `reconcileWithVenue` labels venue-only / persisted / reconciled; vanished-without-verify ⇒ `closed-unobserved` with `pnl: null` and a reason (R3.1/R3.3).
- Peak state: equity 100 ⇒ peak 100; equity 95 ⇒ drawdown 5%, peak STILL 100; equity 110 ⇒ peak 110 (one-way ratchet); `halted === null` always; `dayKey`/`dayStartEquityUsd` re-baseline on UTC day change (R3.4/R3.5).
Tests: `__tests__/livePositionManager.test.mjs` (≥9 tests). Command: `npx vitest run __tests__/livePositionManager.test.mjs`.

### T5 — Perps gates (`F4`)
Acceptance: each of gates 11–15 denies its named violation and allows its clean case; the cascade stops at the first deny (11 > 12 > 13 > 14 > 15) and names it; reduce-only close proposals pass gates 12/14 on post-close state (R4.2 semantics); every deny/allow is audited when an `audit` fn is injected; `evaluateGate` from the sidecar is NOT called by `perpsGates.mjs` (no duplicate gate path — enforced by a module-import assertion in the test). Tests: `__tests__/perpsGates.test.mjs` (≥10 tests). Command: `npx vitest run __tests__/perpsGates.test.mjs`.

### T6 — Perps execution rail (`F5`)
Acceptance (model the assertions in `ccxtExecution.test.mjs`):
- A green open proposal records `proposal:created` with `power:"proposals"`, `consentBy`, `clamped` flag when over-cap (margin clamp visible), rationale ≥ 12 chars citing leverage/margin/funding/day-loss.
- Absent consentBy denies at `per-site-opt-in` (`ccxtExecution.test.mjs:161-166` semantics) and audits only the deny.
- Execute re-runs the FULL 10+5; a stale perps-equity feed denies at gate 6 `fresh-data`; dayLossPct > 5 denies at gate 8 `envelope-within-ceiling`; over-band leverage denies at gate 11; venue throw ⇒ `execution:failed`; re-click deny ⇒ idempotent (venue reached exactly once) (`ccxtExecution.test.mjs:181-262` mirror).
- Verify: filled ⇒ `perps-verify:filled` with honest fill fields; null read ⇒ `perps-verify:unobserved` (`ccxtExecution.test.mjs:266-313` mirror).
- Close: `executePerpsClose` runs the chain with the reduce-only proposal, deny on position-cap when another position is open, executed only once per idempotency key.
- List surface maps open/executed/failed/verified-filled/verify-unobserved for both kinds (mirror `ccxtExecution.test.mjs:316-387`).
Tests: `__tests__/perpsExecution.test.mjs` (≥12 tests). Command: `npx vitest run __tests__/perpsExecution.test.mjs`.

### T7 — Catalog row + overview + routes + env docs (`M2`, `M3`, `M4`)
Acceptance:
- `validateCatalog()` green with the new `trading:perps` row (`policyGraphValidator.mjs:227`); `policyGraphSites()` includes it; the existing 2 rows' bytes unchanged (test asserts the prior rows' JSON equals the fixture).
- Routes: `POST /api/command-centre/perps/propose` green path + each 400/404 convention mirroring the orders API (`commandCentre.ordersApi.test.mjs` pattern, `handlers.mjs:1618-1757`); execute replays from the durable proposal (body mutation of price is ignored); `/positions` returns the honest list incl. `closed-unobserved` labels.
- Overview: with the perps store seeded (test seeds `ccxt-perps-risk.json` like `commandCentre.overviewApi.test.mjs:139-145` seeds the equity store), the `trading:perps` site row shows the perps-equity feed + execution cell; unseeded ⇒ honest not-wired/absent cells (never a silent OK).
- `.env.example` gains the 5 new vars with defaults commented.
Tests: `__tests__/commandCentre.perpsApi.test.mjs` (≥8 tests) + an overview assertion added additively in `commandCentre.overviewApi.test.mjs` (new describe block). Commands: the two `vitest run` targets.

### T8 — Sandbox E2E, real HL testnet (`__tests__/hyperliquidPerps.sandboxE2E.test.mjs` + runbook appendix)
Acceptance:
- With creds absent: the whole file skips with reason naming `PICC_CCXT_WALLETADDRESS_HYPERLIQUID`/`PICC_CCXT_PRIVATEKEY_HYPERLIQUID`; `npx vitest run __tests__/hyperliquidPerps.sandboxE2E.test.mjs` exits green (ADR-0005 skip, no fabricated pass).
- With creds + `PICC_CCXT_SANDBOX=1`: real calls to `api.hyperliquid-testnet.xyz` (no mocks — the file imports the adapter directly and asserts network payloads): `markets()` non-empty with swap rows; `observeEquity()` returns a numeric `equityUsd` or an explicit `{ok:false, reason}`; `observeFunding(BTC)` returns a rate or explicit null; a GTC limit far below the market is submitted (order id non-empty, cloid present) then cancelled via `cancelOrder` and the cancel observed; with testnet balance 0 the fill/close steps report step-level `skipped: "...balance 0...deposit-free"` — no assertion invents a fill.
- Runbook `HYPERLIQUID_CONNECT_RUNBOOK.md` gains a WS-1 appendix: creds, `PICC_CCXT_SANDBOX=1`, command, skip semantics, and the note that mainnet requires the WS-3 ceremony.
Command: the vitest target with and without creds (documented).

### T9 — Full-floor verification + no-regression audit
Acceptance:
- Full serial floor green: `npx vitest run --maxWorkers=1` (the canonical floor measurement per the owner; see Honesty Notes §8.3 for the `package.json` discrepancy) — existing suites pass untouched.
- `npm run typecheck` green (dashboard).
- A guard test asserts `placeCcxtOrder` remains the **only** spot `createOrder` caller on the guarded path and that `hyperliquidPerps.mjs` reaches `createOrder` solely through the ordering seam's swap instance (source-level assertion on `READ_ONLY_BLOCKED` untouched, `ccxtConnector.mjs:33-66`).
- Audit trail: `verifyAudit()` green after a full rail run in tests (`auditTrail.mjs:99-107`).
Command: `npx vitest run --maxWorkers=1` then `npm run typecheck`.

## 6. Risks

1. **One-way netting vs position accounting** — HL is one-way; an opposite-side "close" order in the wrong direction can reduce instead of close, or over-close if the adapter's reduceOnly-size check misreads the venue. Guard: R2.11 seam refusal + R3.6 netting in the manager + fixture tests for reduction paths + the E2E's real reduceOnly close attempt on testnet.
2. **The spot instance cache collision** — `ccxtInstanceFor` today caches by exchange id only (`ccxtOrdering.mjs:137`); shipping the perps adapter without the `id:type` cache key would silently hand the spot instance to perps calls. Guard: T2's explicit two-instances test; the guard test in T9.
3. **Mainnet leak via env accident** — forgetting `PICC_CCXT_PERPS_MAINNET_ENABLED` is safe (OFF); setting it while a sandbox flag is also set is safe (sandbox wins); setting it alone is still refused by WS-1 (R2.1/R6.2 — adapter requires the flag AND refuses without the WS-3 ceremony in code). The risk is a future WS-3 hand-off forgetting to remove the refusal — noted for the WS-3 spec.
4. **Testnet drift** — `api.hyperliquid-testnet.xyz` behavior/funding/faucet can change; the E2E asserts provenance and skips honestly, never hardcodes a price. ccxt version drift (4.5.75 installed vs 4.5.74 in the runbook) is contained because unit tests use fixture libraries; the E2E re-verifies the real surface.
5. **The 5D `maxExposureUsd` meaning shift** — for `trading:perps` the field means margin, for `trading:ccxt` notional; the same gate 8 code path consumes both. Guard: template comment + T7's bytes-unchanged test for existing rows + the perps gate test asserting margin semantics explicitly.
6. **Funding "freshness" as a new failure mode** — gate 15 makes entries depend on a live funding read; a funding API outage blocks entries with an honest reason (5E-style deny) — that is intended behavior (security-positive), not a bug; the denial surface is tested.

## 7. Honesty notes

- §8.1 (below) records the day-loss boundary in real code — this is the single most important honesty seam in WS-1: the master spec says one UTC-aggregated barrier (WS-3); the code today already computes per-exchange day baselines that feed gate 5D (`observeCcxtEquity`, `ccxtOrdering.mjs:410-419`). WS-1 deliberately does not add a new barrier nor remove the existing one.
- The specs registry row for this document and the PICC.md §23 methodology updates are part of the land (T9 includes the doc update).
- No credentials, tokens, wallet addresses, or account numbers appear anywhere in this spec (ADR-0005 rule; runbook values referenced by line, not copied).

## 8. Verified facts and flagged findings from the real code (read this session)

### 8.1 What the master spec's WS-1 assumptions meet in the code
- The spot leg's day-loss input ALREADY exists per-exchange (`ccxtOrdering.mjs:410-419`, persisted `ccxt-equity.json`). WS-1 must feed the perps 5D gate from the perps wallet's own baseline (F3 store) and **not** reuse the spot store for the same exchange id — the `hyperliquid` key is owned by the spot leg's `observeCcxtEquity` and a second writer would double-account equity. Design consequence: F3 keeps its own `ccxt-perps-risk.json` day baseline (R3.5).
- `ccxtInstanceFor` hardcodes `options.defaultType: "spot"` (`ccxtOrdering.mjs:151-155`) — the swap leg cannot reuse the cached spot instance: the M1 cache-key change is mandatory, not optional.
- The sidecar's gate 8 checks `env.maxExposureUsd != null && exposure > env.maxExposureUsd` (`safetySidecar.mjs:258-259`) BUT the proposals-power leg also passes `exposureUsd` for non-live proposals (`:256`), so the perps margin-cap can ride the EXISTING gate 8 as defense-in-depth while gate 12 makes the margin semantics explicit. Both are specified.
- `policyGraphValidator` 5C/5D (`:169-208`) accepts the `trading:perps` template as designed (R4.4/R3.7) — verified against the actual checks.
- Hyperliquid verification (installed ccxt 4.5.75): swap default, `has.sandbox/setLeverage/setMarginMode/fetchFundingRate/fetchPositions` all true, `has.closePosition === false` (⇒ reduce-only closes), `requiredCredentials` = walletAddress+privateKey (credential seam matches runbook `:15-23`).

### 8.2 Flagged, verified-at-implementation (UNVERIFIED this session)
- `composeCommandCentreOverview` (the composer `commandCentreOverview.mjs`) was not fully read; how a brand-new site row renders before any observation is asserted only by the T7 overview test, not by prior art. The additive contract ("OBSERVED or not-wired") is the constraint the composer already enforces (runbook precedent, `handlers.mjs:1484-1486` comment).
- HL testnet per-market minimum amounts/fees are not hardcoded anywhere in this spec; the adapter reads `markets()` limits and the E2E reports observed values (no fabricated minimums).

### 8.3 Discrepancy reported (not papered over)
- `apps/dashboard/package.json:13` defines `"test": "vitest run --maxWorkers=3"` — the owner-audited floor description quotes **serial** `--maxWorkers=1` at 245 files / 2,581 tests. The T9 floor command uses the serial form per the owner's stated floor; the `package.json` discrepancy is a one-line candidate fix out of WS-1's scope (flagged, not folded in).
- The runbook documents ccxt 4.5.74; the installed build is 4.5.75 (probed this session). No behavioral delta observed on the hyperliquid surface used here; the E2E re-proves the real API.

### 8.4 Task count
9 implementation tasks (T1–T9), 91 individually asserted acceptance criteria across the new test files plus the full-floor gate.

## Resolution (2026-09-22)

- **T1–T9 all landed** — commit range `cd942aa..e13fd08`: F1 venue-adapter contract, M1 `ccxtInstanceFor` `id:type` cache seam, HL perps adapter (testnet-first), F3 perps live-position manager, F4 perps gates, F5 perps execution rail, catalog row + perps routes + overview feed, sandbox E2E (runbook appendix), and this no-regression guard.
- **Guard shipped** — `apps/dashboard/server/__tests__/perpsSeamGuard.test.mjs`, source-level: `READ_ONLY_BLOCKED` untouched (`ccxtConnector.mjs:33-66`), spot `createOrder` only inside `placeCcxtOrder` (`ccxtOrdering.mjs:246`), perps `createOrder` only on the seam's swap instance (`hyperliquidPerps.mjs:331`), audit wiring exports intact.
- **Serial floor green** — `npx vitest run --maxWorkers=1` from apps/dashboard: 254 files / 2,767 tests (2,766 passed, 1 honest skip); `npm run typecheck` green.
- **Sandbox E2E honest skip** — `hyperliquidPerps.sandboxE2E` exits green with 1 skipped (ADR-0005: creds absent; no fabricated pass).