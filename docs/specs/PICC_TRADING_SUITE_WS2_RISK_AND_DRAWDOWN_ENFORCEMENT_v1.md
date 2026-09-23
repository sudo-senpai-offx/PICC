# PICC Trading Suite — WS-2 · Risk & Drawdown Enforcement — spec v1

# Status: LANDED (subagent-driven implementation complete; serial floor green; awaiting owner ship decision)

**Date:** 2026-09-22 · **Workstream:** WS-2 of `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md` (APPROVED) · **Kind:** implementation-ready plan · **Approved by:** pending owner, subagent-driven implementation.

**Binding canon (all read and verified in this session, file:line grounded):**
- Master design: `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md` — WS-2 scope block `:49-56`, locked decision 5 (UTC day-loss) `:31`, decision 6 (MDD) `:32`, decision 9 (5-of-7) `:35`, current limitation 3 (no MDD breaker/halt) `:80` and 5 (consent = bearer only) `:82`.
- WS-1 spec: `docs/specs/PICC_TRADING_SUITE_WS1_LIVE_ORDER_LIFECYCLE_v1.md` (resolution `:342-347` — the perps rail, perps gates, position manager landed and are WS-2's substrate; its R3.4 `:48` reserved `halted` for "WS-3" — WS-2 supersedes that note, see D2).
- Seams (live): `services/ccxtOrdering.mjs`, `services/commandCentre/ccxtExecution.mjs`, `services/commandCentre/perpsExecution.mjs`, `services/commandCentre/perpsGates.mjs`, `services/commandCentre/safetySidecar.mjs`, `services/commandCentre/commandCentreExecution.mjs`, `services/commandCentre/commandCentreRuntime.mjs`, `services/commandCentre/auditTrail.mjs`, `services/livePositionManager.mjs`, `services/autopilot.mjs`, `services/policyGraphCatalog.mjs` (sic — actual path `services/commandCentre/policyGraphCatalog.mjs`), `server/handlers.mjs`, `src/components/CommandCentrePanel.tsx`, `src/components/HumanReviewGate.tsx`.
- v3.2 seams for decision 9: `services/fourFactor.mjs`, `services/v32Context.mjs`, `services/v32Execution.mjs`, `services/v32Copilot.mjs`, `services/v32Engine.mjs`, `services/indicators.mjs`, `services/u4faConfig.mjs`, `services/adaptiveConfluence.mjs`.

---

## 0. Current state (all verified this session)

1. **UTC day-loss is already computed per venue, keyed by UTC day.** Spot: `observeCcxtEquity` builds a per-exchange `equityStore[id] = { exchange, dayKey, at, equityUsd, dayStartEquityUsd }` and returns `dayLossPct` (`ccxtOrdering.mjs:425-433`), persisted to `services/data/ccxt-equity.json` (verified live file: one `hyperliquid` key, `dayKey "2026-09-22"`, no peak fields). Perps: `livePositionManager.mjs` RISK_FILE `ccxt-perps-risk.json` (`:103`, shape `:14-20`) with `dayKey/dayStartEquityUsd/dayLossPct`, computed in `observePerpsWallet` (`:609`); read by the API at `handlers.mjs:1805-1821`. Both stores already share `dayKeyOf` from `u4faRisk.mjs` — one UTC boundary, never re-implemented.
2. **Gate 8 of the sidecar compares day-loss but null PASSES.** `evaluateGate` gate 8 (`safetySidecar.mjs:254-267`) runs `(state.dayLossPct ?? 0) > env.maxDailyLossPct` (`:265-267`) — an un-evaluable loss (null) silently reads as 0 and passes. This is the "null→deny" behavioral flip WS-2 makes.
3. **Inserter funnels.** Spot + perps both gate via `evaluateGate` (`safetySidecar.mjs:126`); the generic executor is `executeProposal` (`commandCentreExecution.mjs:55`, audits `execution:executed` at `:67`); perps adds `evaluatePerpsGate` (`perpsGates.mjs:91`, invoked at `perpsExecution.mjs:298` propose-open, `:418` execute-open, `:568` close).
4. **MDD exists ONLY on the perps wallet, un-enforced.** `observePerpsWallet` keeps the one-way peak ratchet + `drawdownFromPeakPct` (`livePositionManager.mjs:593-616`) and a dead `halted: null` field (`:620`). No drawdown gate exists anywhere: `perpsGates.mjs` enumerates 11–15 only; GATE_ORDER (`safetySidecar.mjs:32-43`) has no drawdown; the demand `breakers.siteCapped` is hardcoded false at `handlers.mjs:1641` (spot rail) and `:1875` (perps rail) — gate 5 `hard-breakers` reads it (`safetySidecar.mjs:209`). Spot `ccxt-equity.json` has no peak fields.
5. **No portfolio heat anywhere** — per-position caps only: perps gate 12 (`perpsGates.mjs:133-144`), `clampPerpsMargin` (`perpsExecution.mjs:149-197`), spot flat `CCXT_HARD_NOTIONAL_CAP_USD = 10` (`ccxtOrdering.mjs:52`).
6. **Kill switch is persisted; gates 2/3 are not.** `commandCentreRuntime.mjs` STATE_FILE `command-centre-runtime.json` (`:26`), conservative boot-fail→GLOBAL KILL (`:34-47`), `setKillSwitch` audits + persists (`:77-93`), wired into the sidecar at `handlers.mjs:174`. But `noteBreakerTrip` (`safetySidecar.mjs:81-84`), `humanTakeover`/`clearTakeover` (`:87-94`) mutate only in-memory `globalHalt`/`takeover` (`:48-49`); their only producers today are tests (`commandCentre.execution.test.mjs:159-170`, `commandCentre.sidecar.test.mjs:124-152,339-349`, `v32Copilot.test.mjs:198`). Restart loses both.
7. **No per-action payload reconfirmation.** All execute/close routes take only `{clientOrderId}` (`handlers.mjs:1711-1766` spot execute, `:1983-2028` perps execute, `:2035-2080` perps close); the server replays the durable `proposal:created` audit row (`proposalForClientOrderId` `handlers.mjs:1652-1656`). `consentBy = verifyUser(auth) ?? "default"` everywhere (`:1594,1673,1713,1774,1985,2037,2089`). UI: the spot execute button sends only the id (`CommandCentrePanel.tsx:437-445`); no perps UI exists anywhere in `src/`.
8. **Spread gate machinery exists; feed is null.** `spreadGateF1` (`fourFactor.mjs:101-118`); `f1GateRegister` (`v32Context.mjs:287-322`); copilot wire 4 (`v32Copilot.mjs:112-118`); feed hardcoded null (`adaptiveConfluence.mjs:972`) and `spreadSource: null` (`u4faConfig.mjs:117`); per-class `maxSpreadPips` configured (`u4faConfig.mjs:72-77`; commodities `eligibility:"avoid"`). Catalog ships 3 templates (`policyGraphCatalog.mjs:61-129`).
9. **5-of-7 is NOT codified.** Pillars exist scattered: HTF bias `biasRegister` (`v32Context.mjs:98-129`) + structure (`fourFactor.mjs:477-524`); VWAP `vwapPillar` (`v32Execution.mjs:46-97`); EMA9/21 `emaPair` (`:108-135`); volume delta / CVD `volumeDelta`/`cumulativeVolumeDelta` (`:146-194`, trades feed absent → honest null `:149,:176`); ADX `indicators.mjs:353` + copilot wire 2 (`v32Copilot.mjs:86-92`); external-clear = zero code. RSI/StochRSI/Stochastic/CCI (`indicators.mjs:396/433/456/532`) are ungrouped — the redundancy classifier must count them as one. Composition boundary: `v32DecisionForAsset` in `v32Engine.mjs:180-263`, `gates` field at `:253`.

### WS-1 residue available as cheap T0 housekeeping (flag each, do NOT silently absorb)
- `apps/dashboard/package.json:13`: `"test": "vitest run --maxWorkers=3"` vs the owner-canonical serial floor `--maxWorkers=1` (WS-1 §8.3) — one-line fix, file-disjoint, folds into T0.
- PICC.md §10 specs-registry count drift (WS-1 landed; registry row count stale) — docs-only, folds into T8.
- Duplicate close→verify 409 residual (WS-1 close/verify idempotency edge) — handler-shaped; folds as an optional item in T5 (shares handlers.mjs), NOT in T0.

## 1. Requirements (each testable; master-spec section cited)

### R1 — Single UTC-aggregated day-loss barrier (decision 5; propose-time AND execution-time, restart-persistent) — T1, T2, T3
- R1.1 A new aggregate store aggregates the two existing UTC-keyed stores: spot = SUM over per-exchange `equityUsd`/`dayStartEquityUsd` (`ccxt-equity.json`), perps = the wallet object (`ccxt-perps-risk.json`). Venues are labeled `hyperliquid:spot` / `hyperliquid:perps` — the hyperliquid double-key is explicit, both wallets counted, never merged awkwardly (D1).
- R1.2 Aggregate `dayLossPct = max(0, (ΣdayStart − Σequity)/ΣdayStart × 100)`, re-baselined when `dayKey` rolls (`dayKeyOf` — one UTC boundary).
- R1.3 The aggregate is **unmeasurable → deny**: if any covered venue's store is missing/corrupt/stale, aggregate = `null` + a reason naming the venue, and every risk gate denies (R1.5). No partial-venue day-loss is ever treated as the portfolio's day-loss.
- R1.4 Supersedes autopilot local-midnight −10% (`autopilot.mjs:52`, check at `:898-901`) and the per-site envelope −5% (`policyGraphCatalog.mjs:77,105,125`) **as the authoritative** loss stop. Those legacy paths are NOT deleted in WS-2; the new barrier outranks them at both rails' propose+execute (authority shift, not code deletion — see Non-goals).
- R1.5 New gate `16 risk-day-loss-aggregate` (T2) enforces at propose and execute on both rails (T3); a trip calls `noteBreakerTrip("trading","dailyLoss")` via the T4 persistence seam → the sidecar's existing gate 2 (`safetySidecar.mjs:174-180`) blocks all sites for the UTC day.
- R1.6 Numeral ceiling `PICC_RISK_AGGREGATE_DAILY_LOSS_PCT` default **5** (the first-slice authority scale), env-tunable; freshness `PICC_RISK_AGGREGATE_STALE_MS` default 300 000 (5 min, matches `CCXT_EQUITY_STALE_MS` `ccxtOrdering.mjs:55`).

### R2 — Peak-anchored MDD layer (decision 6): −10% → size −50%; −15% → hard stop; one-way until a new peak — T1, T2, T3
- R2.1 The MDD anchor is a NEW **wallet-level aggregate peak** (sum across venues), not the perps wallet's own peak and not an extension of the spot store (D2). The perps wallet's `halted: null` dead field (`livePositionManager.mjs:620`) stays untouched.
- R2.2 One-way ratchet: `runningPeakUsd` only updates on a FRESH aggregate observation (all covered venues observed within staleness); stale → no ratchet move, gates deny. Precedence: freshness beats the ratchet (a stale aggregate can never fake a new peak).
- R2.3 Gate `17 risk-mdd-size-step`: `drawdownFromPeakPct ≥ PICC_RISK_MDD_STEP_TRIP_PCT` (default 10) and `< PICC_RISK_MDD_HARD_STOP_PCT` (default 15) → new exposure limited to `PICC_RISK_MDD_SIZE_STEP_FACTOR` (default 0.5) of the per-position cap; over-ceiling proposals denied, in-cap proposals allowed with a visible `mddAdjusted: true` flag and rationale line (mirrors the visible-clamp doctrine of `clampPerpsMargin`, `perpsExecution.mjs:149-197`).
- R2.4 Gate `18 risk-mdd-hard-stop`: drawdown ≥ 15 OR the persisted aggregate `halted.trip === "drawdown"` → opens denied unconditionally; **closes (reduce-only) remain allowed** — the hard stop traps no human in a position (D2).
- R2.5 Hard-stop latch is cross-day (unlike gate 2's day-scoped halt) and lives in the aggregate store; it clears only when aggregate equity ≥ `runningPeakUsd` (a new peak forms), one-way per decision 6. Threshold defaults ARE the locked decision-6 values; env overrides are honored and audited at first use.
- R2.6 Env: `PICC_RISK_MDD_STEP_TRIP_PCT=10`, `PICC_RISK_MDD_HARD_STOP_PCT=15`, `PICC_RISK_MDD_SIZE_STEP_FACTOR=0.5`.

### R3 — Execution-time portfolio heat (sum of open margin vs cap) — T2, T3
- R3.1 Heat = perps open margin sum (`ccxt-perps-positions.json` `marginUsd` per record, `livePositionManager.mjs:15-17`) + spot open notional (open `proposal:created`/executed-but-un-verified rows from the audit via `proposalOrdersFromAudit`). Sources are named in every gate reason; never merged silently (D3).
- R3.2 Gate `19 risk-portfolio-heat`: `portfolioHeatUsd == null` → deny (un-evaluable); `> PICC_RISK_PORTFOLIO_HEAT_CAP_USD` (default **30** = spot envelope $10 × 2 concurrent + perps margin cap $10, the theoretical deployed maximum) → deny.
- R3.3 Evaluated at execute time on both rails (propose may pass on projected heat; the click re-measures actual open exposure — the day/heat gates are the "fresh at click" enforcement).

### R4 — Persist kill-switch/day-halt/takeover across restart, audit-backed; production auto-producer for the day halt — T4
- R4.1 New `command-centre-halt.json` beside `command-centre-runtime.json` (`commandCentreRuntime.mjs:26`), same DATA_DIR convention, same conservative boot: unreadable → halt ON (fail-safe deny) (D4).
- R4.2 `noteBreakerTrip` / `humanTakeover` / `clearTakeover` become write-through via an additive sidecar seam (`wireHaltPersistence`), and boot re-hydrates `globalHalt`/`takeover` (`safetySidecar.mjs:48-49,81-94`). Kill-switch persistence (`commandCentreRuntime.mjs`) is untouched; no new API route for halt (see Non-goals).
- R4.3 Auto-producer: gate 16's trip (R1.5) is the first production `noteBreakerTrip` caller — today's producers are test-only (verified, §0.6).

### R5 — Per-action consent re-confirming the exact order payload before execute — T5, T5b
- R5.1 Server computes `consentHash = sha256(canonicalSorted(payload))` (deterministic key-sort serialization — same discipline as `auditTrail.mjs:45-52`) over the EXACT venue-bound fields the durable proposal will replay (D5), stored on the `proposal:created` row.
- R5.2 Execute/close routes require the client to resubmit the FULL payload (`{ clientOrderId, payload }`); the server recomputes the hash AND field-compares against the replayed durable proposal. Any mismatch → **409 `consent-payload-mismatch`**, audit `consent:denied`, no venue call. Match → audit `consent:reconfirmed` BEFORE `execution:executed` (`commandCentreExecution.mjs:67` appends after the executor — the re-confirmation entry lands before it in audit order).
- R5.3 Never client-trusting: enforcement is the server replay + hash; the UI is only the human doorway (T5b).
- R5.4 Verify stays read-only and consent-free (unchanged).

### R6 — Spread gate wiring seam, fail-closed until a real bid/ask source — T6
- R6.1 A provider-registry seam (`spreadFeedFor(assetClass)`) returns a measured `{spreadPips, source, at}` or honest null; every consumer stays fail-closed: `spreadGateF1` null → `unmeasurable` abort (`fourFactor.mjs:101-118`), so FX/gold/indices/commodities remain honestly blocked until wired (decision: feed source DEFERRED to WS-5 breadth — D6).
- R6.2 A class passes F1 spread only when a measured reading ≤ its configured `maxSpreadPips` (`u4faConfig.mjs:72-77`) is present; the "never unlock a class without a measured spread" rule is a test.

### R7 — Codify 5-of-7 orthogonal gate with redundancy classifier + per-row explanation (decision 9) — T7
- R7.1 New pure evaluator over the 7 pillars (HTF bias, VWAP/key level, EMA 9/21, volume delta, CVD, ADX regime, external-clear) with default `N=5` (`PICC_V32_PILLAR_MIN`, config-tunable via `v32Config.pillarMin`).
- R7.2 Redundancy classifier groups RSI/StochRSI/Stochastic/CCI (`indicators.mjs:396/433/456/532`) into ONE oscillator vote so they can never double-count.
- R7.3 Honest-fail per pillar: unmeasurable → `available:false, agrees:false` with a reason. External-clear has zero code today → always fails honestly (a TRADE needs 5 of the remaining 6 until a source exists).
- R7.4 Composition at the verdict slot (`v32Engine.mjs` `gates` field `:253`): `TRADE` additionally requires the pillar gate; failures push per-row reasons (mirroring the existing `reasons` accumulation `:220-232`).

## 2. Design decisions (the hard questions, each with a recommended option)

**D1 — Where the UTC-aggregated barrier lives.** New aggregate store + new fan-in module (`riskState.mjs`, file `ccxt-risk-aggregate.json`) rather than extending either existing store. Rationale: the two stores are asymmetric (spot = per-exchange object; perps = single wallet object) and both are written by live modules with their own tests; a third store keeps them as source-of-truth and records provenance per venue (`venues`, `unobservable[]`). Rejected: fan-in at read time only (no restart-persistent latch/peak — decision 5 demands restart-persistence); extending `ccxt-equity.json` with peak fields (would entangle spot semantics with wallet-level risk). Aggregation across venues = spot SUM + perps wallet; the hyperliquid double-key is EXPLICITLY two wallets (spot balances vs swap wallet) and the guard test demands both appear as distinct labeled venues.

**D2 — MDD anchor.** Wallet-level aggregate peak in the new store (D1), −10/−15 as env with the locked decision-6 defaults, and enforcement as new gates 17/18 in a new `riskGates.mjs`. The perps wallet's `halted` dead field (`livePositionManager.mjs:620`) is deliberately NOT repurposed — WS-1's "WS-3" note is superseded here: WS-2 owns MDD enforcement per the master WS-2 block (`SEAL_ALL_GAPS_v1.md:51`); WS-3 owns only the unlock ceremony. Hard-stop latch is cross-day and aggregate-level because gate 2's `noteBreakerTrip` is dayKey-scoped (`safetySidecar.mjs:175`) and would wrongly expire a drawdown halt at UTC midnight. One-way-ratchet precedence: freshness gates the ratchet (R2.2) — an unobservable venue can neither lower nor raise the peak.

**D3 — What counts as heat.** Perps open `marginUsd` (the persisted positions store, which is the same data gate 14 counts) + spot open notional from audit rows (the only spot exposure record that exists). Both sources named in the deny reason; either source unreadable → null → deny (no silent partial heat).

**D4 — Halt persistence file.** New `command-centre-halt.json` beside the runtime STATE_FILE, owned by a new `riskHaltStore.mjs`, wired into the sidecar through an additive seam (`wireHaltPersistence` + boot `hydrateHaltState`). Rationale: `commandCentreRuntime.mjs` is kill-switch-specific with a byte-tested API; bolting halt state in would entangle two safety semantics in one store. Seam over direct store calls keeps the sidecar's existing test suite green and the persistence observable.

**D5 — Consent payload-lock format.** Exact-field hash over the venue-bound payload (D-open: `[action, exchange, symbol, side, amount, price, leverage, marginMode, clientOrderId]`; D-close: `[action, exchange, symbol, positionId, price, side, amount, leverage, clientOrderId]`), exclu-ding server-derived fields (`idempotencyKey`, `power`, `consentBy`) the human never types. Server recomputes from the client's resubmitted payload AND field-compares to the durable proposal; 409 on any mismatch; `consent:reconfirmed` audited before execution. Rationale for hash+fields both: the hash proves byte-identity cheaply, the field compare backstops hash collisions and gives a readable 409 body.

**D6 — Spread feed: honest seam, source deferred.** WS-2 ships the seam + fail-closed wiring; the real bid/ask source is DECLARED an open decision deferred to WS-5 (the go-live runbook already names "spread-feed wiring" there, `SEAL_ALL_GAPS_v1.md:73`). No fabricated feed, no default provider, no class ever unlocked without a measured spread. This keeps current limitation 2 (`:79`) honest and removes nothing.

**D7 — 5-of-7 evaluator.** New pure module (`v32PillarGate.mjs`) with a redundancy classifier, N config, per-row reasons; composed at the existing `gates` verdict slot (`v32Engine.mjs:253`) so the v3.2 decision surface stays untouched structurally. Rationale: the pillars already exist as independent honest modules; the seam is the composition boundary, exactly where the master decision 9 points.

**Non-goals (explicitly out of WS-2):** WS-3 unlock ceremony and any real-money gating change; deleting the autopilot local-midnight −10% path or per-site envelope −5% (authority shift only — removal is a separate cleanup); any spread feed implementation; new halt API routes (auto-expiry + peak-cleared latch only); iqoption/EO adapters; funding accrual; dependency bumps; UI beyond the perps panel + reconfirm modals; changing `safetySidecar.mjs` GATE_ORDER or any existing gate's behavior except the null→deny day-loss flip in the NEW gate family (the sidecar 10 stay byte-identical).

## 3. Module designs

### 3.1 File map

**CREATE**

| # | File | Role | Depends on |
|---|---|---|---|
| F1 | `server/services/commandCentre/riskState.mjs` | Aggregate store (fan-in + wallet peak + day rollover + halted latch), `refreshAggregateRisk({now})`, `aggregateRiskState()`, health guards mirroring `livePositionManager` `storeHealth` (`:119-126`); store `ccxt-risk-aggregate.json` | reads both stores; `dayKeyOf` |
| F2 | `server/services/commandCentre/riskGates.mjs` | Gates 16–19 + `evaluateRiskGate({template, proposal, observation, audit})` + trip side-effects (T4 seam) | F1, F4, sidecar |
| F3 | `server/services/commandCentre/riskHaltStore.mjs` | `command-centre-halt.json` boot/persist; `tripBreaker`, `humanTakeoverPersist`, `clearTakeoverPersist`, `hydrate`; wires the sidecar seam | sidecar |
| F4 | `server/services/spreadFeedSeam.mjs` | Provider registry `spreadFeedFor(assetClass)`; honest null | — |
| F5 | `server/services/v32PillarGate.mjs` | 5-of-7 evaluator + redundancy classifier + per-row reasons | indicators/pillars (read) |
| F6 | `src/components/PerpsCommandCentre.tsx` | Perps panel + execute reconfirm modal | API fns |

**MODIFY**

| # | File | Change |
|---|---|---|
| M1 | `server/services/commandCentre/safetySidecar.mjs` | Additive seam only: `wireHaltPersistence({onTrip,onTakeover,onClear})` called from the three mutations (`:81-94`) + `hydrateHaltState` boot hook. GATE_ORDER, gates 1–10 byte-identical. |
| M2 | `server/services/commandCentre/ccxtExecution.mjs` | Compose `evaluateRiskGate` after `evaluateGate` on propose + execute; `consentHash` on propose, verify on execute (T5). |
| M3 | `server/services/commandCentre/perpsExecution.mjs` | Same composition after `evaluatePerpsGate` (`:298,418,568` call sites); consent hash on propose + execute/close. |
| M4 | `server/handlers.mjs` | Both `observe*RailState` (`:1626-1650`, `:1851-1890`) gain aggregate + heat observation; execute/close routes require `payload` (T5); overview feed cell for aggregate risk (additive key). |
| M5 | `server/services/adaptiveConfluence.mjs` | `:972` `spread: null` → `spread: spreadFeedFor(...)` (T6). |
| M6 | `server/services/u4faConfig.mjs` | `:117` gains provider registry container (default empty). |
| M7 | `server/services/v32Engine.mjs` | Compose pillar gate into `gates` (`:253`) + verdict condition (`:216-218`). |
| M8 | `src/components/CommandCentrePanel.tsx` | Execute button opens a reconfirm modal that submits the payload (T5b); additive. |
| M9 | `src/pages/ministry/CommandCentreRoom.tsx` | Mount `PerpsCommandCentre` (T5b); additive. |
| M10 | `apps/dashboard/.env.example` | Document the WS-2 env vars (T3). |
| M11 | `apps/dashboard/package.json` | `:13` `--maxWorkers=3` → `1` (T0). |

### 3.2 Aggregate store shape (`ccxt-risk-aggregate.json`, F1)

```jsonc
{ "version": 1,
  "dayKey": "2026-09-22",
  "dayStartEquityUsd": 28.86, "equityUsd": 27.12, "dayLossPct": 6.03,
  "runningPeakUsd": 30.00, "peakAt": "…", "drawdownFromPeakPct": 9.6,
  "halted": null,                      // { trip: "drawdown", at, note } — cross-day latch
  "venues": { "hyperliquid:spot": { "source": "ccxt-equity.json", "equityUsd": 18.86, "dayStartEquityUsd": 18.86, "at": "…" },
              "hyperliquid:perps": { "source": "ccxt-perps-risk.json", "equityUsd": 8.26, "dayStartEquityUsd": 10.00, "at": "…" } },
  "unobservable": [] }                 // venue missing/corrupt/stale → aggregate null + reason
```

Unreadable/version-≠1 file → store marked UNHEALTHY, mutations refuse, file preserved (mirror `livePositionManager` non-negotiable #4, `:62-69`). `refreshAggregateRisk` returns `{ ok, aggregate, venues, unobservable, reason? }`; `ok:false` + named venue whenever a covered venue can't be read — nothing partially aggregated.

### 3.3 Gate family 16–19 (F2) — evaluated in order, each deny audited `safety-gate:deny` with `blockedBy`

**16 risk-day-loss-aggregate** — observation `aggregateRisk.dayLossPct`/`fresh`; null or `fresh !== true` → deny `un-evaluable: <reason>`. `> PICC_RISK_AGGREGATE_DAILY_LOSS_PCT` → deny + trip: `riskHaltStore.tripBreaker("trading","dailyLoss")` (seeds sidecar `globalHalt` → gate 2 blocks the UTC day, persisted).
**17 risk-mdd-size-step** — `drawdownFromPeakPct ≥ 10 && < 15` → effective size ceiling = `cap × 0.5` (env factor); proposal implied margin/exposure above ceiling → deny; at/below → allow with `sizeStepFactor: 0.5` surfaced to the rail (visible `mddAdjusted` in the rationale, mirroring `clamped`, `perpsExecution.mjs:315,341`).
**18 risk-mdd-hard-stop** — `drawdown ≥ 15` or `halted.trip === "drawdown"` → deny ALL new exposure; `proposal.reduceOnly === true` (closes) pass. Trip sets the aggregate `halted` latch (cross-day, R2.5). Latch clears when a refresh observes `equityUsd ≥ runningPeakUsd`.
**19 risk-portfolio-heat** — null → deny; `> PICC_RISK_PORTFOLIO_HEAT_CAP_USD` → deny with sources named.

Composition (M2/M3): after `evaluateGate` (spot) / after `evaluatePerpsGate` (perps) — resolve `observation.risk = refreshAggregateRisk(...) + heat builder`; a deny returns before any proposal:created / executor. Both rails, propose AND execute AND close.

### 3.4 Halt persistence (F3/M1)

`riskHaltStore.mjs`: file `command-centre-halt.json` = `{ version: 1, globalHalt: null|{dayKey,site,breaker,at}, takeover: null|{at} }`. Boot: unreadable → hydrate as tripped (fail-safe). Wires `safetySidecar` seam at module init: mutations write-through; `hydrateHaltState` seeds after boot. Kill-switch store untouched. Gate 16 is the production trip producer.

### 3.5 Consent payload-lock (M2/M3/M4/T5)

- `consentPayloadHash(fields)` = `sha256(canonicalSorted(fields))` (reuse `auditTrail` canonical discipline `:45-52`; export the sort helper or a twin — no behavior change to the chain).
- Propose (both rails): `proposal:created` gains `data.consentHash` over the D5 field set.
- Execute/close routes: body `{ clientOrderId, payload }`; server recomputes + field-compares vs the durable replay; mismatch → `409 { ok:false, error:"consent-payload-mismatch", blockedBeforeVenue:true }` + audit `consent:denied`; match → audit `consent:reconfirmed` (data: clientOrderId, consentHash) then the existing chain. Close payload includes the fresh exit price (locks the displayed price to the executed one); the close `proposal:created` anchor already records post-execution (`perpsExecution.mjs:580-589`).
- Spot verify + perps verify unchanged.
- Optional folded item: duplicate close→verify now 409s consistently (WS-1 residue, flagged in §0).

### 3.6 Spread seam (F4/M5/M6)

`spreadFeedFor(assetClass)` → registered provider output `{ spreadPips, source, at }` | null; registry read from `u4faConfig` providers map (empty default); env `PICC_SPREAD_FEED_PROVIDER` names one provider by key (absent = none). Provider outputs shape-validated (finite non-negative spread, source string, at epoch). `adaptiveConfluence.mjs:972` and any F1 feed path call the seam — null propagates to `spreadGateF1` → `unmeasurable` → class stays blocked honestly (per-class `maxSpreadPips` already configured `u4faConfig.mjs:72-77`).

### 3.7 5-of-7 (F5/M7)

`evaluatePillarGate({ pillars, min = env PICC_V32_PILLAR_MIN ?? v32Config.pillarMin ?? 5 })` — pure, keys: htfbias, vwap, ema921, volumedelta, cvd, adxregime, externalclear (+ optional grouped `oscillator` when present). Classifier maps indicator provenance → family; RSI/StochRSI/Stoch/CCI → ONE family. Each row `{ id, label, available, agrees, reason }`; `ok = agreed ≥ min` (unavailable pillars never count). `v32Engine.mjs`: build pillar inputs from existing ctx/data (reuse `vwapPillar`/`emaPair`/`volumeDelta`/`cumulativeVolumeDelta` output already computed at `:186-192`; HTF bias from ctx regime registers; ADX from `ctx.regime.registers.adx`), add `gates.pillars5of7`, extend the TRADE condition (`:216-218`) and reasons (`:220-232`).

### 3.8 Env vars (all read at call time; invalid numeric → named `invalid-environment` deny, never silent fallback)

| Var | Default | Meaning |
|---|---|---|
| `PICC_RISK_AGGREGATE_DAILY_LOSS_PCT` | `5` | aggregate UTC day-loss ceiling (R1.6) |
| `PICC_RISK_AGGREGATE_STALE_MS` | `300000` | aggregate freshness window (R1.6/R2.2) |
| `PICC_RISK_MDD_STEP_TRIP_PCT` / `PICC_RISK_MDD_HARD_STOP_PCT` / `PICC_RISK_MDD_SIZE_STEP_FACTOR` | `10` / `15` / `0.5` | decision-6 values as defaults (R2.6) |
| `PICC_RISK_PORTFOLIO_HEAT_CAP_USD` | `30` | portfolio heat ceiling (R3.2) |
| `PICC_V32_PILLAR_MIN` | `5` | 5-of-N floor (R7.1) |
| `PICC_SPREAD_FEED_PROVIDER` | absent | provider registry key; absent = fail-closed (R6.1) |

## 4. Acceptance (observable, each mapped to a task's tests)

| AC | Observable behavior | Verification |
|---|---|---|
| AC-1 | Aggregate day-loss = SUM of both stores' UTC baselines; rollover re-baselines; a missing venue → `null` + name, every gate denies | `riskState.test.mjs`, `riskGates.test.mjs` |
| AC-2 | Aggregate dayLoss > 5 (or env) denies both rails at propose AND execute; null dayLoss denies (never passes) | `riskRailWiring.test.mjs` + sidecar test unchanged |
| AC-3 | Day-loss trip hydrates sidecar `globalHalt` + writes `command-centre-halt.json`; restart re-blocks (gate 2) | `riskHaltStore.test.mjs` |
| AC-4 | Ratchet: 100→95→110 peaks once, never decreases; stale aggregate never moves it | `riskState.test.mjs` |
| AC-5 | Drawdown ≥10 → exposure ceiling halved (visible `mddAdjusted`); ≥15 or latch → opens denied, closes allowed; latch clears on new peak, survives restart | `riskGates.test.mjs`, `riskRailWiring.test.mjs` |
| AC-6 | Heat > 30 denies with named sources; unreadable heat source denies | `riskGates.test.mjs` |
| AC-7 | Execute without `payload` or with a mutated field → `409 consent-payload-mismatch` + `consent:denied`, no venue call; exact payload → `consent:reconfirmed` precedes `execution:executed` | `consentPayloadLock.test.mjs` |
| AC-8 | `spreadFeedFor` returns honest null with no provider; a conforming fixture provider passes a class with measured spread ≤ max; wire 4/f1 stay fail-closed on null | `spreadFeedSeam.test.mjs` |
| AC-9 | 5-of-7: 5 agreeing pillars → `ok`; RSI+CCI double-agreement counts once; external-clear unavailable fails honestly; per-row reasons present; TRADE verdict requires `gates.pillars5of7` | `v32PillarGate.test.mjs` + v32Engine fixture updates |
| AC-10 | Serial floor + typecheck green; PICC.md registry row added; `verifyAudit()` green | T8 commands |

## 5. Checklist tasks (ordered; every task ends with Tests: + Command:)

**T0 — Housekeeping (file-disjoint, optional-cheap).** `apps/dashboard/package.json:13` → `--maxWorkers=1` (owner-canonical serial floor, WS-1 §8.3). Nothing else (registry drift → T8; 409 residual → T5). Tests: none (config). Command: `npx vitest run --maxWorkers=1 2>&1 | tail -3` sanity.

**T1 — Aggregate UTC day-loss + wallet peak store (`F1`).** Acceptance per R1.1–R1.3, R2.1–R2.2, AC-1/AC-4: fan-in spot SUM + perps wallet with labeled `hyperliquid:spot`/`hyperliquid:perps` venues; day rollover; null + reason on missing/corrupt/stale venue; one-way peak ratchet gated by freshness; store-health guards preserve an unreadable file; `reset` test seam. Tests: `server/__tests__/riskState.test.mjs` (≥10). Command: `npx vitest run __tests__/riskState.test.mjs`.

**T4 — Halt persistence + sidecar seam (`F3`, `M1`).** Acceptance per R4/AC-3: `command-centre-halt.json` boot/persist with unreadable→tripped; `wireHaltPersistence` write-through from noteBreakerTrip/humanTakeover/clearTakeover; `hydrateHaltState` seeding; existing `commandCentre.sidecar.test.mjs` and `commandCentre.execution.test.mjs` stay green (additive seam only). Tests: `server/__tests__/riskHaltStore.test.mjs` (≥7). Command: `npx vitest run __tests__/riskHaltStore.test.mjs`.

**T2 — Risk gates 16–19 (`F2`).** Acceptance per R1.5, R2.3–R2.5, R3, AC-2/AC-5/AC-6: null→deny day-loss (the behavioral flip), step ceiling + `sizeStepFactor`, hard-stop opens-denied/closes-allowed + cross-day latch + clear-on-new-peak, heat with named sources; trip side-effects call the T4 seam; every deny/allow audited with injected `audit`; env validation named-deny. Tests: `server/__tests__/riskGates.test.mjs` (≥14). Command: `npx vitest run __tests__/riskGates.test.mjs`.

**T3 — Rail + handler wiring (`M2 spot-part`, `M3 spot-part`, `M4`, `M10`).** Acceptance: spot `proposeCcxtOrder` + `executeCcxtOrder` compose `evaluateRiskGate` after `evaluateGate` allow, before `proposal:created`/executor; perps `proposePerpsOpen` (`perpsExecution.mjs:298`), `executePerpsOpen` (`:418`), `executePerpsClose` (`:568`) compose after `evaluatePerpsGate`; both `observe*RailState` (`handlers.mjs:1626-1650`, `:1851-1890`) build aggregate + heat observations; step-zone proposals carry visible `mddAdjusted` + rationale line; `.env.example` gains the WS-2 vars. Tests: `server/__tests__/riskRailWiring.test.mjs` (≥10, cmd-injected execution asserts deny-before-venue). Command: `npx vitest run __tests__/riskRailWiring.test.mjs`.

**T5 — Consent payload-lock (`M2`, `M3`, `M4`).** Acceptance per R5/AC-7: `consentHash` stored on `proposal:created` for open+close; execute/close routes require `{clientOrderId, payload}`; mismatch → 409 + `consent:denied` + no call; match → `consent:reconfirmed` audited before `execution:executed`; spot + perps + close covered; existing orders/perps API tests updated deliberately for the new contract (see §7); optional 409 residual for duplicate close→verify. Tests: `server/__tests__/consentPayloadLock.test.mjs` (≥11) + updated fixtures in `commandCentre.ordersApi.test.mjs`/`perpsExecution.test.mjs` where the contract changed. Command: `npx vitest run __tests__/consentPayloadLock.test.mjs`.

**T5b — Perps panel + reconfirm modal (`F6`, `M8`, `M9`).** IN SCOPE, minimal (flagged: no perps UI exists today — this is the first): new `PerpsCommandCentre.tsx` (positions list, propose, execute-with-modal, close-with-modal, verify) mounted in `CommandCentreRoom.tsx:30`; `CommandCentrePanel.tsx:437-445` execute opens a reconfirm modal rendering the exact payload fields + rationale + `consentBy`, submit sends `{ clientOrderId, payload }`; wording follows the `HumanReviewGate` precedent (`HumanReviewGate.tsx:8-79` countdown + checkbox). Enforcement stays server-side regardless of UI. Tests: `src/components/__tests__/CommandCentrePanel.test.tsx` additive + `PerpsCommandCentre.test.tsx` (≥6). Command: `npx vitest run __tests__/CommandCentrePanel.test.tsx __tests__/PerpsCommandCentre.test.tsx`.

**T6 — Spread seam (`F4`, `M5`, `M6`).** Acceptance per R6/AC-8: registry empty → honest null; fixture provider passes only measured ≤ max; non-finite/negative reads → unmeasurable; commodities `eligibility:"avoid"` unchanged (`u4faConfig.mjs:77`); `adaptiveConfluence.mjs:972` wired to the seam; fail-closed wire 4 + f1 regressions green. Tests: `server/__tests__/spreadFeedSeam.test.mjs` (≥6). Command: `npx vitest run __tests__/spreadFeedSeam.test.mjs`.

**T7 — 5-of-7 evaluator + redundancy classifier (`F5`, `M7`).** Acceptance per R7/AC-9: default N=5, env + config override; classifier counts RSI/StochRSI/Stoch/CCI once; unavailable pillars don't count and carry reasons; external-clear honest-fails; v32Engine verdict downgrades to OBSERVE when pillar gate fails, `gates.pillars5of7` present, reasons list failing rows. Tests: `server/__tests__/v32PillarGate.test.mjs` (≥12) + additive v32Engine fixture updates. Command: `npx vitest run __tests__/v32PillarGate.test.mjs`.

**T8 — Full floor + typecheck + guard + land.** Acceptance per AC-10: `npx vitest run --maxWorkers=1` green from `apps/dashboard` (serial floor, owner-canonical); `npm run typecheck` green; `verifyAudit()` (`auditTrail.mjs:99-107` per WS-1) green after a full rail run; PICC.md §10 gains the WS-2 registry row and §23 methodology note (+ the §10 count drift fix); a source-level guard asserts both rails compose the risk gate (module-import assertion) and that gate 16's trip reaches the persisted halt. Command: `npx vitest run --maxWorkers=1; npx vitest run --maxWorkers=1 2>&1 | tail -3; npm run typecheck` (serial then the named guard command).

### File-bisect conflict matrix (parallel-dispatch safety)

| Task | Files touched | Parallel-safe with |
|---|---|---|
| T0 | `apps/dashboard/package.json` | everything |
| T1 | `riskState.mjs` (new) | T0, T4, T6, T7 |
| T4 | `riskHaltStore.mjs` (new), `safetySidecar.mjs` | T0, T1, T6, T7 |
| T2 | `riskGates.mjs` (new) — imports T1/T4 | T0, T1, T4, T6, T7 |
| T3 | `ccxtExecution.mjs`, `perpsExecution.mjs`, `handlers.mjs`, `.env.example` | T0, T1, T4, T2, T5b, T6, T7 — **NOT T5** |
| T5 | `ccxtExecution.mjs`, `perpsExecution.mjs`, `handlers.mjs` (+ tests) | **after T3 only** (hard serialize: shared rails + handlers) |
| T5b | `src/components/*`, `src/pages/ministry/CommandCentreRoom.tsx` | everything server-side |
| T6 | `spreadFeedSeam.mjs` (new), `adaptiveConfluence.mjs`, `u4faConfig.mjs` | everything except nothing |
| T7 | `v32PillarGate.mjs` (new), `v32Engine.mjs` | everything except nothing |
| T8 | docs, `PICC.md` | last (after all) |

Hard conflicts (must NOT dispatch in parallel): **{T3, T5}** on `ccxtExecution.mjs` + `perpsExecution.mjs` + `handlers.mjs`. Everything else is file-disjoint.

## 6. Risks

1. **The null→deny flip breaks existing gate-8 tests.** `(state.dayLossPct ?? 0)` (`safetySidecar.mjs:265-267`) currently passes null; fixtures today supply explicit `dayLossPct: 0` (`commandCentre.sidecar.test.mjs:40`, `ccxtExecution.test.mjs:37`, `perpsExecution.test.mjs:68`) — the flip lives in the NEW gate 16, so the sidecar byte-identity is preserved, but rail fixtures that would now hit gate 16 with null must be audited. Guard: T3 test that null aggregate denies; T8 serial floor catches stragglers.
2. **Hyperliquid double-key aggregation.** The same wallet address holds spot balances (ccxt-equity.json `hyperliquid` key) and a swap wallet (`ccxt-perps-risk.json`) — both are real, distinct pools and BOTH count, but a future store confusion would double-count one wallet. Guard: labeled venue keys + T1 fixture asserting distinct labels never merge.
3. **Cross-day MDD latch semantics.** Burying the drawdown halt in gate 2's day-scoped `globalHalt` (`safetySidecar.mjs:175`) would wrongly expire it at UTC midnight. Guard: latch lives in the aggregate store (R2.5) + T2 boundary test (trip before midnight, assert blocked after midnight until new peak). Day-loss relies on gate 2 BY DESIGN (expires daily).
4. **Consent contract break.** Execute/close now require `payload` — every existing client/tests hitting the old `{clientOrderId}` shape 409s. This is the intended behavior, but must be delivered WITH the T5b UI modal, else the panel silently breaks. Guard: T5 + T5b land together; §7 flagged.
5. **Size-step renormalization ordering.** Applying −50% after the per-position clamp could push below venue minimums. Guard: step ceiling applied at sizing (before cap clamp), visible `mddAdjusted`, venue minimums still surface as honest adapter denies (WS-1 R2.5 seam).
6. **5-of-7 composition downgrades existing verdicts.** v32Engine fixtures assuming TRADE may now OBSERVE (external-clear unavailable, N=5). Guard: additive fixture updates in T7; default N=5 keeps the honest gap visible rather than silently relaxing.

## 7. Honesty notes

- **No fabricated feeds or spreads.** WS-2 wires seams and enforcement; the spread feed, trades feed (CVD/volume-delta inputs, `v32Execution.mjs:149,176`) and external-clear pillar remain honest-null/unavailable. Un-evaluable everywhere means DENY, never a silent pass (the aggregate, the heat, the day-loss, the spread all follow ADR-0005's null-≠-0 doctrine).
- **The null→deny change is behavioral and deliberate; it is flagged to existing tests** (Risks 1) and lives in the new gate family so the sidecar 10 stay byte-identical (`commandCentre.sidecar.test.mjs` untouched).
- **Retirement is authority-shift, not deletion**: autopilot local-midnight 10% (`autopilot.mjs:52,898-901`) and per-site envelope −5% (`policyGraphCatalog.mjs:77,105,125`) remain in code; WS-2's aggregate barrier outranks them at both rails. Their removal is a separate cleanup.
- **Real-money gating unchanged** — WS-3's unlock ceremony is untouched; WS-2 adds enforcement only. No credentials, tokens, wallet addresses, or account numbers appear in this spec (values referenced by line, never copied — the live `ccxt-equity.json` showed an equity figure; it is cited as a shape, not reproduced as a number).
- **Hyperliquid double-key caveat** (§0.1, Risks 2): two stores, two wallets, one address — both count in the aggregate, labels stay explicit.
- **Consent hashes contain no secrets** — the payload field set excludes credentials; hash entries are audit-visible by design.

## 8. Verified facts and flagged findings from the real code (read this session)

### 8.1 Verified anchors (all read this session)
- `ccxtOrdering.mjs:52` `CCXT_HARD_NOTIONAL_CAP_USD = 10`; `:425-433` dayKey/baseline/dayLossPct per-exchange; `:55` `CCXT_EQUITY_STALE_MS` 5 min. Live `services/data/ccxt-equity.json` shape = per-exchange object, no peak, no persisted dayLossPct.
- `livePositionManager.mjs:103` RISK_FILE; `:14-20` risk-store shape (`halted: null`); `:568-627` `observePerpsWallet` with peak ratchet `:593-616` and `halted: null` `:620`; `:62-69` store-corruption guards; `:105` `canTouchDisk` pattern.
- `safetySidecar.mjs:32-43` GATE_ORDER; `:48-49` in-memory `globalHalt`/`takeover`; `:81-94` `noteBreakerTrip`/`humanTakeover`/`clearTakeover`; `:126` `evaluateGate`; `:174-180` gate 2; `:182-185` gate 3; `:205-209` gate 5 reads `breakers.siteCapped`; `:211-213` gate 6; `:254-267` gate 8 with `(state.dayLossPct ?? 0)` at `:265-267`; `:209` siteCapped demand.
- `commandCentreExecution.mjs:55` `executeProposal` gate call; `:67` `execution:executed` audit.
- `perpsGates.mjs:91` `evaluatePerpsGate`; gates 11 `:113-130`, 12 `:132-144`, 14 `:151-159`; called at `perpsExecution.mjs:298,418,568`.
- `perpsExecution.mjs:149-197` `clampPerpsMargin`; `:302-325` proposal:created with full order fields + `power`/`consentBy`; `:522-589` `executePerpsClose` reduce-only replay; `:580-589` close proposal:created after execution.
- `handlers.mjs:174` `wireKillSwitchReader(() => anyKillActive())`; `:1592-1609` kill-switch API; `:1626-1650` `observeCcxtRailState` (siteCapped false `:1641`, dayLossPct `:1645`); `:1652-1656` `proposalForClientOrderId`; `:1711-1766` spot execute (replay-only); `:1805-1821` `readPerpsRiskStore`; `:1851-1890` `observePerpsRailState` (siteCapped false `:1875`, dayLossPct `:1879`); `:1983-2028` perps execute; `:2035-2080` perps close (position replay, fresh price from body `:2039`); `:2087+` perps verify.
- `commandCentreRuntime.mjs:26` STATE_FILE; `:34-47` boot-fail → GLOBAL KILL; `:49-53` persist; `:77-93` `setKillSwitch` audit+persist.
- `auditTrail.mjs:45-52` canonical/hash (sha-256); `:73-84` `appendAudit` chain append.
- `autopilot.mjs:52` `dailyLossLimitPct: 10`; `:898-901` local-midnight day-loss refuse. `policyGraphCatalog.mjs:61-129` 3 templates; per-site −5% at `:77,:105,:125`.
- `fourFactor.mjs:101-118` `spreadGateF1`; `:477-524` structure leg (`resolveStructureLevels`). `v32Context.mjs:98-129` `biasRegister`; `:287-322` `f1GateRegister`. `v32Copilot.mjs:86-92` wire 2 (ADX), `:112-118` wire 4 (spread). `adaptiveConfluence.mjs:972` `spread: null`. `u4faConfig.mjs:72-77` per-class calibration incl. `maxSpreadPips` and commodities `eligibility:"avoid"`; `:117` `spreadSource: null`.
- `v32Execution.mjs:46-97` `vwapPillar`; `:108-135` `emaPair`; `:146-194` `volumeDelta`/`cumulativeVolumeDelta` (honest "no trades feed"); `:201-220` `relativeVolume`. `indicators.mjs:353` adx; `:396` rsi; `:433` stochRSI; `:456` stochastic; `:532` cci. `v32Engine.mjs:180-263` `v32DecisionForAsset`, `gates` at `:253`, verdict `:216-218`, reasons `:220-232`.
- UI: `CommandCentrePanel.tsx:437-445` execute button (id only); `HumanReviewGate.tsx:8-79` countdown+checkbox precedent; `CommandCentreRoom.tsx:30` panel mount.
- Producers of `noteBreakerTrip`/`humanTakeover`/`clearTakeover` today are test-only (`commandCentre.execution.test.mjs:159-170`; `commandCentre.sidecar.test.mjs:124-152,339-349`; `v32Copilot.test.mjs:198`). `apps/dashboard/package.json:13` `--maxWorkers=3`; serial floor per WS-1 §8.3.

### 8.2 Flagged, verify-at-implementation (UNVERIFIED this session)
- Exact insertion lines inside `ccxtExecution.mjs` `proposeCcxtOrder`/`executeCcxtOrder` bodies (verified only by grep matches at `ccxtExecution.mjs:104-111,146,223,287-300`); the composition points are after `evaluateGate` allow in each — confirmed by reading the perps mirror fully.
- The overview composer's render of a new aggregate-risk cell (`commandCentreOverview.mjs` not fully read this session; the additive-key contract "OBSERVED or not-wired" is the constraint, per WS-1 §8.2 precedent).
- `verifyAudit` (`auditTrail.mjs:99-107`) cited from WS-1's verified floor run, not re-read.

### 8.3 Task count
9 core tasks (T1–T8 + T5b) + 1 optional T0; ~78 asserted acceptance checks across the new test files plus the serial floor.

## 9. Resolution (placeholder — filled after implementation)

- **T0…T8 status:** T0 landed (`apps/dashboard/package.json` `--maxWorkers=1`, commit `ad8c79d`); T1–T8 + T5b landed with their assert batteries; passed a security review (clean), a code review, and the WS-2 review round (`92c1b54`).
- **Gate 16 stays strict (owner decision):** the aggregate day-loss trip denies EVERYTHING for the UTC day, including reduce-only closes — a loss-day must not permit heat-shifting exit trades either; the human escape is the WS-1 takeover ceremony, not a gate carve-out. Pinned by the gate-16 deny tests (`riskGates.test.mjs`) and the seam guard.
- **Gate 19 carve-out (owner decision):** an over-cap portfolio may still CLOSE a perps position when the reduce-only close's projected POST-CLOSE heat (current heat minus the closing margin) is within the cap — a position-reducing close is hardening, not new exposure. A close that does not bring heat under the cap is still denied ("not reducing below the cap"). Opens are unaffected: any over-cap open denies with named sources. Pinned in `riskGates.test.mjs` under "gate 19 reduce-only close carve-out".
- **Pillar-min honest-fail:** an invalid `PICC_V32_PILLAR_MIN` / `v32Config.pillarMin` is a named `invalid-environment` gate failure (never a throw, never a silent fallback) — fail-closed in `v32Engine` as OBSERVE.
- **M4 aggregate-risk cell:** the Command Centre overview now carries an additive read-only `risk` block (day-loss %, drawdown %, portfolio heat, halt state, unobservable venues) composed from the real `observeRiskFeed()` at the `/api/command-centre/overview` route and rendered as a strip in `CommandCentrePanel`.
- **Serial floor:** 263 files, 2908 passed + 1 skipped (2909 tests), exit 0, `--maxWorkers=1` (controller-authorized run 2026-09-23); `npm run typecheck` green.
- **Owner approval:** spec locked and decisions made by owner 2026-09-23 (gate-16 strict, gate-19 projected-heat carve-out, T0 included, T5b in scope, M4 cell built).