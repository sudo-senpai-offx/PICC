# v3.2 Execution 5-point + Copilot + Live Wiring — plan 3

Companion plan doc for `docs/specs/PICC_V3_2_PLAN3_EXECUTION_COPILOT_v1.md` (authority: spec). This doc is the plan-2-style status surface (section 2 predecessor: `2026-09-19-v32-context-regime-layer.md` §7).

## 1. Modules

| Module | Kind | Status |
|---|---|---|
| `docs/specs/PICC_V3_2_PLAN3_EXECUTION_COPILOT_v1.md` | New — plan-3 spec | Shipped |
| `apps/dashboard/server/services/v32Config.mjs` | New | Shipped (18 tests) |
| `apps/dashboard/server/services/v32Execution.mjs` | New | Shipped (20 tests) |
| `apps/dashboard/server/services/v32Copilot.mjs` | New | Shipped (36 tests) |
| `apps/dashboard/server/services/v32Engine.mjs` | New | Shipped (17 tests) |
| `apps/dashboard/server/services/adaptiveConfluence.mjs` | Edit — additive, toggle-guarded | Shipped (v32Status, lane wiring) |
| `apps/dashboard/server/services/v32Context.mjs` | Edit — `sessionClassify` now returns `available: true` | Shipped |
| `apps/dashboard/server/__tests__/v32Honesty.test.mjs` | New — REQ-P3-12 sweep | Shipped (17 tests) |
| `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` | Edit — §8 task-table evidence | Shipped |
| `docs/superpowers/plans/2026-09-19-v32-execution-copilot-layer.md` | New — this status doc | This doc |

## 2. Tasks

Ran TDD-first: red (targeted bed) → green → full floor → typecheck, for tasks 1–6, then task 7's docs + sweep.

| Task | Deliverable | Landing evidence |
|---|---|---|
| 1 — config toggle | `v32Config.mjs` (`enabled:false` default, `proposalCap`, `consecutiveLossThreshold`, file+default sources, save/load) | `v32Config.test.mjs` 18 |
| 2 — execution pillars | `v32Execution.mjs` (`vwapPillar` cum + session-reset, `emaPair`, `volumeDelta`, `cumulativeVolumeDelta`, `relativeVolume`, `executionScore` venue-degraded, no `confidence`) | `v32Execution.test.mjs` 20 |
| 3 — copilot | `v32Copilot.mjs` (wires 1–8 fail-closed, `explainState` deterministic zero-LLM, `SESSION_HALT_FLOOR_PCT = 2` fixed, `proposalCap` wire 8) | `v32Copilot.test.mjs` 36 |
| 4 — per-asset engine | `v32Engine.mjs` (`v32ContextForAsset` mirroring live load path + `confidenceShape` strict + `costLine` == `costAdjustedEv().line` + `rederiveExpectancy` consistency vs `flipGate`; chop latch persisted) | `v32Engine.test.mjs` 17 |
| 5 — live wiring | `adaptiveConfluence.mjs` (`buildV32Strategy`, `decideAssets` lane, `evaluateAsset` `v32Row`/`withV32`, exported `logTradeVerdicts` v3.2 block + `v32:` cooldown, `u4faRuntimeContext` v32Config/v32Rows/risk) | `adaptiveConfluence.v32.test.mjs` 7 |
| 6 — flip readiness | `v32Status()` (shadow/powered, flip-gate numbers read-only) + `computeNow` `status.v32` attach only when ON | `adaptiveConfluence.v32.test.mjs` 4 more (11 total) |
| 7 — spec/docs + sweep | §8 evidence, companion status, REQ-P3-12 sweep | `v32Honesty.test.mjs` 17 |

## 7. Status

**All tasks shipped (2026-09-20).**

**Verification:** full floor `npm run test --workspace @picc/dashboard` — **2527 tests / 232 files green** (Plan-2 floor 2408/226 preserved + 119 new tests across 6 new files); `npm run typecheck --workspace @picc/dashboard` clean.

**Legacy byte-identity:** `adaptiveConfluence.test.mjs`, `u4faPayload.test.mjs` green **unmodified**; with `enabled:false` the v3.2 lane is unreachable (decisions carry no `v32` fields). Toggle confirmed OFF in every committed config — `v32-config.json` absent from the repo (runtime data-dir file; default `enabled:false`).

**Fail-closed arms (honest, never fabricated):** no trades feed → Δ/CVD `available:false reason:"no trades feed"`; no spread source → F1 `unmeasurable` (closed); session PnL → wire 1 fails closed ("balance unavailable") until the closed-trades feed exists; `buildV32Strategy` null-context → per-asset OBSERVE, never kills the batch; decision honesty block reports `sampleSource`/`spreadSource`/`calendarSource`/`candleSource`/`tradesFeed` truthfully.

**What the flip needs (REQ-STG-3, operator's call, not this code):** the v3.2 lane is wired and soak-instrumented (`v32Status` reports the numbers) but **`enabled` stays false** until ≥100 paper trades per engine and `flipGate` signs off after the ~2–4-week soak. Demoted-trigger test re-pointing (layered-spec T12) stays pinned as the plan-2 global pin.

**Deferred (post-ship, not in this plan):** 15s (b)/(c) cadence + futures-proxy leg + 15s real-venue E2E (T3/T4/T13) land in a future 15s-slot plan gated on a feed probe; maker-flow Δ/CVD feed wiring lands with an actual trades feed; LLM explain-in-HUD is the frontend track.

**Commits:** none made during execution — commit steps were left pending the user's explicit go-ahead (one intent per commit, per the plan-3 spec §3 header and the plan-2 precedent).