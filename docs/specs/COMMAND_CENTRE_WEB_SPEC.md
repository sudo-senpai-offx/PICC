# Command Centre Web — Design Spec

**Status:** ready-for-agent (living spec — continuously improved through implementation)
**Date:** 2026-09-05
**Author:** PICC executor (brainstorm + codebase check + design presented & approved in conversation)
**Location note:** This spec is one of the authoritative sources for the cumulative, exhaustive
`PICC.md` doc consolidation (README.md + PICC.md) that the owner has declared as the project's
doc end-state. This file is deliberately self-contained so it can be absorbed and kept as the
single source of truth for this feature throughout implementation.

---

## Problem Statement

PICC is designed to be a one-stop financial command centre managing every financial aspect at
low-to-negligible risk, able to work **autopilot** (execute where it is safe) or **copilot**
(human-gated) — the mode chosen per income stream / per site, backed by the measured risk and the
**workability of automation** for that particular stream.

Today PICC has the raw capabilities but no coherent way to decide and *show* the mode per stream:

- Income streams exist as a suite registry (`suites.mjs`) with per-stream `features`, but most
  streams have an empty feature list and there is **no per-site mode decision**.
- The trading autopilot has rich risk gating but is a single, trading-only surface, **demo-only**,
  and its mode/risk story is buried in one service rather than surfaced as an auditable team.
- The human-in-the-loop layer (`interventions.mjs`) and the risk layer (`u4faRisk.mjs`) are real but
  not unified, not observable as a "risk-backed decision," and not generalized beyond trading.
- There is **no observable "agent team"** — the user cannot see which specialists watch a stream,
  what each found, its sources/staleness, or *why* the mode is autopilot vs copilot vs blocked.
- There is **no per-site automation-permission truth** — the blanket advisory-only/no-execution
  posture can't express that some platforms (crypto venues, some bandwidth sites) sanction
  automation while others forbid it.

The owner wants a **bidirectional hybrid web** — a complex graph of workflows/algorithms with
specific, specialized agents whose findings feed risk and mode, supporting divergence, convergence
and bounded looping (one-to-one, one-to-many, many-to-many, many-to-one) — producing a
**risk-backed, auditable autopilot/copilot mode per site**, with safety as an unbreachable floor,
self-improvement, evolution, anti-hallucination and metalearning baked in. The UI must present it as
a professional, organized, encapsulated command centre that avoids overwhelm and integrates fully
with backend, extension and scripts.

---

## Solution

A **Command Centre Web**: a layered system in which every income stream (trading, bandwidth, then
the rest) is driven by (1) a **per-site policy-graph** (a catalog-defined JSON template declaring
its specialist agents, typed data-flow edges, bounded loops and execution envelope), (2) a
**deliberation layer** that lets those agents converge/diverge over a bounded blackboard with a
convergence detector, (3) a **Mode Engine** that renders an accountable per-site verdict
(AUTOPILOT / COPILOT / BLOCKED + execution power + reason), and (4) an orthogonal, **unbreachable
Safety Sidecar** that gates and can cut any path mid-loop. The whole thing is wrapped in a
**Command Centre UI** that shows, per stream, the agent team, their findings, the mode, the reason,
the safety status and the kill switch — no overwhelm, full integration.

The web is **adaptive** (a)+(b): where automation is possible at low-negligible risk PICC runs
autopilot (including real-money execution through sanctioned venues); otherwise copilot; regulated
by configurable settings that can "streamline beyond" defaults but never pierce the safety floor.
Real-money execution starts via **CCXT (platform-sanctioned, official protocol)** and **bandwidth
browser automation**; **ExpertOption stays demo** (now integrating the ExpertBot pattern), with
live trading deferred until its connector is re-engineered for production trust (unregulated venue
recorded honestly).

Five own-requested protocols + one added are enforced as named, testable rules baked into the web:
**P-SPECIFICITY, P-GROUNDING, P-ANTI-HALLUCINATION, P-PURPOSE (purpose-driven relations),
P-BOUNDED-LOOPS, P-EVOLUTION, P-SELF-IMPROVEMENT, P-METALEARNING.**

---

## User Stories

1. As a PICC user, I want to see every income stream as an **auditable agent team** (which
   specialists watch it, what each found, sources + staleness), so that the decision surface is
   transparent rather than a black box.
2. As a PICC user, I want a **per-site mode verdict** (AUTOPILOT / COPILOT / BLOCKED) with the
   reason, so that I always know why PICC will or won't act on a given platform.
3. As a PICC user, I want the **risk backing** of every decision surfaced (risk gate, breaker,
   exposure ceiling, stale-data status), so that confidence is always tied to measured risk.
4. As a PICC user, I want a **global kill switch** that instantly halts all execution across all
   streams and overrides every setting, so that I have an unconditional off.
5. As a PICC user, I want **per-site opt-in** required before any real-money autopilot on that
   site, so that PICC can recommend but never silently authorize.
6. As a PICC user, I want **hard circuit breakers** (daily-loss cap, consecutive-loss pause,
   regime-shift pause, per-site risk cap) that ignore the mode and can't be disabled via
   "streamline beyond," so that losses are kept minimal with discipline in all endeavours.
7. As a PICC user, I want a full **audit trail** of every mode decision, agent finding, and
   execution with its reason (append-only, tamper-evident via the verifiable-ledger path), so that
   accountability is provable.
8. As a PICC user, I want **immediate human takeover** that interrupts in-flight execution at the
   next safe boundary and returns manual control, so that I can stop mid-action when needed.
9. As a PICC user on a platform that **forbids automation**, I want PICC to stay advisory-only on
   that exact site, so that the no-execution posture is **site-specific**, not lost globally.
10. As a PICC user, I want **execution power separated from audit** so that no single config can
    loosen risk bounds and accountability at the same time.
11. As a PICC user, I want **stale-data forced downgrade** — if a mandatory feed goes stale, the
    stream moves to COPILOT/HOLD rather than auto-running on stale inputs.
12. As a PICC user, I want a **hard single-exposure size ceiling** independent of confidence, so
    that no single action exceeds an absolute dollar bound.
13. As a PICC user, I want every action to have a **renderable rationale** before it executes
    ("why/what/how" in plain language), so that PICC never acts on an inexplicable decision.
14. As a PICC user, I want **idempotent automation**, so that repeat/raced payout claims or orders
    can never double-fire.
15. As a PICC user, I want the **LLM/advisory layer to only downgrade** the mode (never upgrade
    past deterministic bounds), so that the deterministic risk engine is always the ceiling-setter.
16. As a PICC user, I want each agent to have **exactly one specialized task** (P-SPECIFICITY) and
    narrow triggers, so that hallucination surface is minimized.
17. As a PICC user, I want agent findings grounded in **sources + data cutoff** with
    `absent → null` handling (P-GROUNDING), so that claims are evidence-backed.
18. As a PICC user, I want **AI-inferred labels** on any LLM contribution, with deterministic
    computation kept separate (P-ANTI-HALLUCINATION), so that machine-guessed vs computed is never
    blurred.
19. As a PICC user, I want **purpose-driven relations** (every graph edge declares why it exists;
    purposeless edges rejected) so that the web is a deliberate network, not a tangle.
20. As a PICC user, I want **bounded deliberation loops** with a convergence detector so that the
    web converges or stops honestly — never loops infinitely or fabricates agreement.
21. As a PICC user, I want **evolution** so that candidate strategies are forward-tested and
    survivors promoted, and decaying edges rotated (measure, don't guess).
22. As a PICC user, I want **self-improvement** so that every settled outcome refines calibration,
    model weights and edge weights — bounded, auditable, never silent.
23. As a PICC user, I want **metalearning** so that PICC learns *how to learn* per regime — agent
    weighting, edge trust, convergence tuning — while never touching the safety floor or any
    in-flight execution.
24. As a PICC user, I want a **Command Centre UI** that is professional, well-organized,
    encapsulated, and easy to access — showing per stream the agent team, findings, mode, reason,
    safety status, and kill switch, without overwhelm, fully integrated with backend/extension.
25. As a PICC user, I want **configurable settings** per site/stream that let me tune the
    "streamline beyond (a)+(b)" surface (exposure, concurrency, risk targets) within the floor.
26. As a PICC user, I want **real-money autopilot** to begin on **platform-sanctioned venues**
    (CCXT crypto first, bandwidth browser auto-claim second) after a demo-first prove-gate, so
    that execution starts where it is honestly safe, not where it is philosophically uncertain.
27. As a PICC user, I want **ExpertOption** to integrate the **ExpertBot pattern** (rules config,
    cloud-analytics signal leg, journal) on the **demo** path now and go live only after the
    connector matures and an explicit ADR-level decision, so that an unregulated venue is never
    rushed.
28. As a PICC owner, I want the whole system to **expand one-by-one** — a new site/venue is a new
    catalog template + truth-table row, not new engine code — so that breadth comes by wiring, not
    by redesign.
29. As a PICC developer, I want every slice to land with the full suite green and typecheck clean
    (the 1620+ test floor never shrinks), so that the system is always in a verified state.
30. As a PICC developer, I want the **improvement loop** — post-slice post-brainstorm, cumulative
    review, self-improvisation loops, completion, and resolution of hidden defects per slice, and a
    full review at the end of all slices — gated to the spec, so that nothing is left off and the
    spec itself is continuously improved.

---

## Implementation Decisions

### Architecture — layered web (Section 1)

Six layers plus an orthogonal zero layer:

- **L6 Command Centre UI** — observability surface, per-stream command card.
- **L5 Mode Engine** — per-site accountable verdict + execution power + reason.
- **L4 Deliberation Layer** — bounded blackboard rounds with a convergence detector.
- **L3 Agent Roster** — catalog-defined specialist agents, one task each, deterministic core +
  optional LLM, grounded.
- **L2 Policy Graph + Catalog** — per-site JSON templates: nodes, typed edges, loop bounds, purpose
  tags, execution envelope.
- **L1 Execution Layer** — CCXT live · interventions browser engine · ExpertOption demo. The only
  layer that touches venues.
- **L0 Safety Sidecar** — orthogonal, unbreachable; gates every edge and can cut any path mid-loop.

### Catalog schema (L2) — "site = template"

Each site/stream has a JSON template. Fields include: `site`, `stream`, `venue`,
`automationPermission` (sanctioned/gray/forbidden — 5C, per-site not per-stream), `roster`
(ordered list of agent ids), `edges` (`{from,to,topology,purpose}`), `loops`
(`[{node,maxRounds,convergenceDelta}]`), `execution` (mode, maxExposureUsd, maxConcurrent,
maxDailyLossPct), `protocols` (which P-* protocols apply). **New site = new template, no server
code** — this is how "expand one-by-one" works.

### Agent roster (L3) — first-slice teams

**Trading** (scales with site, not fixed 350): News/Sentiment (`sentimentEngine.mjs`, `serper.mjs`),
Technical (`indicators.mjs`, `multiTimeframe.mjs`, `mtfConvergence.mjs`, `patterns.mjs`), Regime
(`regimeDetection.mjs`), Volatility (`volatility.mjs` — estimator-chooser seam), Order-Flow
(`orderFlow.mjs`), Whale/On-chain (new dedicated service, crypto venues), Consensus
(`marketDataBus.mjs` `getCrossSourceCandles` → `verified` tags), Risk Manager (`u4faRisk.mjs`,
`kellyCriterion.mjs`, `positionManager.mjs` — deterministic-only, cannot be overridden), Model-Matrix
(`modelMatrix.mjs` — confidence-floored, abstains below significance).

**Bandwidth** (lighter): Uptime/Node (`automator.mjs` scan/status), Daily-Quest (`automator.mjs`
quest catalog + presence heartbeat), Payout (`automator.mjs` `payout_ready` + interventions engine,
idempotent), Credential (`automator.mjs` `credential_expiry`).

Every agent: one task (P-SPECIFICITY), sources + cutoff (P-GROUNDING), AI-inferred labels for LLM
(P-ANTI-HALLUCINATION), narrow triggers.

### Deliberation (L4) — flow topologies & bounded loops

Typed edges implement 1:1 (straightforward single relation, e.g. risk→gate), 1:N (one finding fans
out), N:N (the true web — cross-pollination on the blackboard), N:1 (many findings converge to one
decision point). Each loop has `maxRounds` (default 3) + `convergenceDelta` (default 0.05). Each
round agents read the blackboard, publish, and the **Convergence detector** measures how much the
collective verdict surface moved; converge → early-stop; hit `maxRounds` → stop (P-BOUNDED-LOOPS,
never infinite). Non-convergence is surfaced honestly as an output (the Mode Engine emits the
conservative deterministic-only verdict, LLM excluded), never papered over.

### Mode Engine (L5) — verdict in fixed order

1. Kill-switch + per-site opt-in → BLOCKED / COPILOT-only.
2. Risk Manager gate (breakers + site cap) → BLOCKED with breaker named / downgrade.
3. Stale-data check (5E) → forced COPILOT/HOLD.
4. ToS-survival (5C, `automationPermission`) → forbidden=BLOCKED, gray=COPILOT.
5. Automation-workability score (deterministic — how safely auto-run is possible).
6. Deliberation evidence (weighted by edge trust, fed by P-METALEARNING).
7. LLM/advisory input — **advisory only, downgrade-only (5H), never upgrades**.

Output: `{ site, mode, executionPower, reason: [...], breadcrumbs: [agent findings that mattered] }`.

Mode names per site: **AUTOPILOT(live)** (opt-in + sanctioned + all breakers green + fresh data +
envelope within ceiling), **AUTOPILOT(demo)** (the existing demo autopilot, now named),
**COPILOT** (proposals via interventions review queue), **BLOCKED** (a breaker / stale / missing
opt-in / forbidden site; needs a human action or a fresh gate pass to re-enter — never silently
downgraded back).

### Safety Sidecar (L0) — the box the web runs inside

**Pre-action gate, in fixed order:** kill-switch → per-site opt-in → hard breakers → fresh data
(5E) → ToS-survival (5C) → envelope within ceiling (5D) → rationale renderable (5F) → idempotent
(5G).

**Five deeper invariants:**
- **5A Execution-power separation** — no single config loosens risk AND audit; the audit toggle is
  always-on, tamper-evident (hooks the Tier-A verifiable ledger); changing the risk axis never mutes
  the recorded "why."
- **5B Immediate human takeover / interrupt in-flight** — every execution is a resumable unit with
  a safe-stop boundary; sidecar can pause mid-flight, return manual control in one click, log it;
  extends `interventions.mjs` INTERRUPT to all streams.
- **5C Credential & ToS-survival** — per-venue truth table (crypto=sanctioned, ExpertOption
  demo-only today, bandwidth per-site); venue changes hit the catalog, never guesses.
- **5E Stale-data forced downgrade** — generalized `maxCandleAgeSec`; every mandatory feed has a
  staleness ceiling; breach = COPILOT/HOLD with the stale feed named.
- **5H Downgrade-only** — LLM/agent web pushes a mode down (with reason), never up; upgrades only
  from the deterministic gate rerunning after conditions improve.

**Mid-loop / mid-flight cut semantics:** convergence-failure → freeze blackboard, surface
"non-converged," emit conservative verdict; breaker trip mid-execution → halt all further entries
across all sites for the day (cross-site `riskDayState` pattern); takeover → in-flight units stop at
safe boundaries, power reverts to COPILOT, re-entry needs a full gate pass. **The sidecar's own
invariants are outside metalearning/self-improvement reach.**

### Execution layer (L1) — first real-money path

- **CCXT live first**: dedicated executor on `ccxtConnector`/`ccxtAdapter`/`liveCCXT`;
  Binance/Bybit/OKX-class venues (official, platform-sanctioned automation). Demo-first prove-gate:
  provable paper/demo results on that exact venue through the same policy-graph path before live is
  offered. Venue truth-table: CCXT crypto = `sanctioned`.
- **Bandwidth auto-claim second**: `interventions.mjs` workflow engine drives payout claiming;
  Payout Agent proposes → gate (opt-in + sanctioned + envelope + idempotency) → executes as a
  resumable unit with human interrupt. Per-site permission (5C), not per-stream.
- **ExpertOption demo + ExpertBot pattern now, live later**: stays demo-only in the first slice.
  Ships the ExpertBot pattern as a mapped node — rules config (stake/expiry/caps via autopilot
  DEFAULTS + tier-aware concurrency), a cloud-analytics signal leg (trend prediction from PICC's own
  deterministic indicators, **not** a third-party bot), and the existing hard demo gate stays. Live
  later only after (a) the connector is re-engineered for production trust (official-protocol
  assessment, error-surface hardening, settlement verification) and (b) an explicit ADR-level
  decision — because ExpertOption (EOLabs LLC, St. Vincent & Grenadines) is **unregulated**, and
  that fact is recorded in the venue truth-table, not hidden.

### First-slice authority envelope

| Parameter | Default | Raiseable? |
|---|---|---|
| Max single exposure | $10 | Yes, within floor |
| Max concurrent live units | 2 | Yes, within floor |
| Max daily loss | -5% | Yes, within floor |
| Live venues | CCXT(sanctioned) + bandwidth(browser) | One-by-one expansion |
| ExpertOption | demo only | After connector maturity + ADR decision |
| Kill-switch / breakers / opt-in / audit | always-on | Never |

### Protocols (named, testable)

- **P-SPECIFICITY** — one task per agent; overlap rejected at catalog-validation (L3/L4).
- **P-GROUNDING** — findings carry sources + cutoff; `absent → null`, never fabricated; edges cite
  evidence (L3/L4).
- **P-ANTI-HALLUCINATION** — deterministic core computes what's computable; LLM claims
  `ai-inferred`, downgrade-only (5H), staleness visible (L3/L5/L0).
- **P-PURPOSE** — every graph edge declares its purpose; purposeless edges rejected by the catalog
  validator (L2/L4).
- **P-BOUNDED-LOOPS** — every deliberation loop has maxRounds + convergenceDelta; never infinite
  (L4).
- **P-EVOLUTION** — candidate strategies forward-tested (walk-forward, embargoed); survivors
  promoted to catalog; decay detection rotates stale edges (L4↔L5) — Algory lesson.
- **P-SELF-IMPROVEMENT** — settled outcomes feed calibration/confidence/model-weights/edge-weights,
  bounded, auditable, never silent-rule-change (L5↔L3).
- **P-METALEARNING** — a Meta-Optimizer between L4 and L5 learns *how to learn*: per-regime agent
  weighting, edge trust, convergence tuning (latency↔accuracy Pareto per site), strategy-portfolio
  evolution (feeding P-EVOLUTION). Outcome-gated, audit events with before/after, revertible,
  operates on discovery time never live-money time, and can never touch the floor.

---

## Testing Decisions

**What makes a good test:** only external behavior — the verdict a site gets, the gate result, the
catalog rejection — never internal wiring. Deterministic inputs → deterministic outputs, so every
case is a plain assertion, following the hermetic pattern established by the R4 wave
(`modelMatrix.test.mjs`, `u4faRisk`/`volatility`-style pure-logic tests).

**Modules tested (new files follow the existing `__tests__/` pattern):**

| Module | Surface |
|---|---|
| Catalog validator | Rejects purposeless edges (P-PURPOSE), duplicate-task rosters (P-SPECIFICITY), unbounded loops (P-BOUNDED-LOOPS) |
| Mode engine | Verdict matrix (kill-switch/breaker/stale/permission × mode); downgrade-only proof (LLM can't upgrade) |
| Safety sidecar runtime | Pre-action gate order; mid-loop cut; 5B safe-stop; 5G idempotency (double-claim race); cross-site breaker trip |
| Deliberation | Convergence early-stop; `maxRounds` divergence cutoff; non-converged → conservative verdict |
| Metalearning | Outcome-gated weight shifts; audit events with before/after; no floor mutation proof |
| Execution envelope | Ceiling enforcement (single-exposure, maxConcurrent, daily-loss); per-site opt-in |
| Command Centre UI | Component tests: safety-status rail, mode card, kill-switch UX (React-testing-library) |

**Prior art:** `server/__tests__/*.test.mjs` hermetic patterns; `src/components/__tests__/*.test.tsx`
React-testing-library patterns; the standing rule that auth/payment/broker/ledger paths get a
`security-review` pass.

**Venue-touching code stays thin & mocked:** CCXT adapter + interventions executor are
integration-tested against **fixtures** (recorded candle/session payloads), never live accounts in
CI; live-venue behavior is a manual verify step, not a unit test.

**Rollout slices (each independently verifiable, full suite + typecheck green each):**
1. Catalog + validator + roster registry (P-PURPOSE/P-SPECIFICITY/P-BOUNDED-LOOPS; trading +
   bandwidth templates; agent mapping onto existing services). **Landed 2026-09-05** —
   `commandCentre/agentRoster.mjs` (13 registry agents: 9 trading incl. the declared-built
   `whale_onchain` seam, 4 bandwidth), `commandCentre/policyGraphCatalog.mjs` (3 site templates:
   trading:ccxt sanctioned · bandwidth:browser gray · expertoption forbidden/demo — the 5C truth
   table), `commandCentre/policyGraphValidator.mjs` (P-PURPOSE / P-SPECIFICITY / P-BOUNDED-LOOPS /
   5C / 5D, collects ALL violations in one pass). 31 hermetic tests in
   `server/__tests__/commandCentre.test.mjs`; suite 1,622 → 1,653; typecheck clean.
2. Mode engine + safety sidecar (deterministic; outage-of-LLM downgrade-only proven; audit events).
   **Landed 2026-09-05** — `commandCentre/modeEngine.mjs` (5 modes BLOCKED|HOLD|COPILOT|
   AUTOPILOT_DEMO|AUTOPILOT, 7-step fixed verdict order: kill switch → opt-in → breakers → 5E
   staleness (forced HOLD) → 5C truth table → workability floor → deliberation (declared
   "not-yet-available" until slice 3) → advisory; 5H is downgrade-only, upgrade attempts audited +
   rejected, LLM outage leaves the deterministic verdict identical), `commandCentre/auditTrail.mjs`
   (append-only hash-chained JSONL under `PICC_COMMAND_CENTRE_DATA_DIR`; no update/delete API;
   canonical recursive-sorted-keys hashing — an array-replacer serialization that drops `data` keys
   was caught by the tamper test and replaced; memory-backed under vitest without the env var),
   `commandCentre/safetySidecar.mjs` (10-step pre-action gate order as the enforced contract:
   kill-switch → cross-site-day-halt → human-takeover 5B → per-site-opt-in → hard-breakers →
   fresh-data 5E → toS-survival 5C → envelope-within-ceiling 5D → rationale-renderable 5F →
   idempotent 5G; cross-site breaker halt day-scoped via `dayKeyOf`; idempotency verified in-memory +
   durable through the audit trail with fail-safe deny when the reader throws; every decision —
   allow and deny — is audited (5A), never muted by loosening the envelope). 59 hermetic tests in
   `server/__tests__/commandCentre.{modeEngine,sidecar,auditTrail}.test.mjs`; suite 1,653 → 1,712;
   typecheck clean.
3. Deliberation layer (blackboard, bounded loops, convergence detector, non-converged handling;
    P-EVOLUTION/P-SELF-IMPROVEMENT/P-METALEARNING tuners, outcome-gated, floor-proof).
    **Landed 2026-09-05** — `commandCentre/deliberation.mjs` (blackboard engine: BFS hop distance
    from the decision node over reversed edges; findings land per hop-round; weighted directional
    surface with neutral sides excluded from numerator AND denominator; convergence = movement <
    `convergenceDelta` early-stop, `maxRounds` exhausted while still moving → honest
    `non-converged` divergence cutoff; unlanded findings surfaced, never dropped; edge-trust seam
    `edgeTrust(edgeId)` multiplies into path trust; `strongestPath` = max product over simple
    paths; MAX_WORKABILITY_SHIFT 0.1; DEFAULT_LOOP 3/0.05), `commandCentre/metalearning.mjs`
    (outcome-gated edge-trust tuner: `applyOutcome` requires `settled`, hit ×1.05 / miss ×0.95 /
    push ×1.0, clamps [0.2, 3.0], before/after audit event via `_audit`, `revertLastOutcome`,
    discovery-time `setTrust` separately audited; export whitelist = floor-proof — no envelope /
    breaker / audit knob reachable), mode engine slot 6 + 7 wired (deliberation optional; absent →
    "not-yet-available"; non-converged → capped at COPILOT with advisory/LLM leg EXCLUDED; converged
    → bounded ±0.1 workability modulation that can only lower; advisory `null` when excluded with
    the reason surfaced; breadcrumbs merged, deduped by agentId). 32 hermetic tests in
    `server/__tests__/commandCentre.{deliberation,modeEngine.slice3,metalearning}.test.mjs`; suite
    1,712 → 1,744; typecheck clean.
4. Command Centre surface (per-stream command card, safety rail, mode verdict, kill-switch UI).
   **Landed 2026-09-05** — `commandCentre/commandCentreRuntime.mjs` (kill-switch store: global +
   per-site switches, persisted under `PICC_COMMAND_CENTRE_DATA_DIR` as `command-centre-runtime.json`,
   every transition audited (5A) with site/kind/data shape, explicit clears recorded as off switches
   (never forgotten), an UNREADABLE store boots conservatively with the GLOBAL KILL ON — fail-safe
   deny, `siteKilled` global-dominates), `commandCentre/commandCentreOverview.mjs` (PURE composition:
   every cell is OBSERVED state or an explicit "not-wired — arrives with execution (slice 5+)" label,
   never a silent OK; verdicts come from the REAL engine `renderVerdict` over observed inputs —
   killSwitch from the runtime store, breakers from the sidecar's recorded cross-site halt (breaker
   names mapped: dailyLoss → dailyLossHalted, regime/regimeHalted → regimeHalted), fresh-data from
   capture-profile rows + computed account-metrics staleness, workability conservatively 0 (no
   scorer wired — caps at COPILOT, never an invented number that could raise a verdict),
   deliberation null (engine reports "not-yet-available"), optIn false with not-decided label —
   sync-approval is explicitly NOT an opt-in; 10-gate rail in GATE_ORDER with pass/block/restricted/
   mechanism-on/not-wired/not-decided vocabulary), sidecar seam `wireKillSwitchReader(readFn)`
   (gate 1 = state argument OR reader; a throwing reader reads as KILL — cannot prove OFF, so deny),
   handlers wiring (`GET /api/command-centre/overview` per-site rows + optional `?stream=` filter,
   `POST /api/command-centre/kill-switch` sanitized against catalog ids + "global", both
   authenticated; handlers wire `wireKillSwitchReader(() => anyKillActive())` +
   `wireAuditReader(() => readAudit())` at import so the panel toggle and the gate read ONE switch
   and 5G survives restarts), frontend `src/components/CommandCentrePanel.tsx` (one shared
   component, `stream` prop, mounted as "Command Centre" tab on BOTH trading and bandwidth suite
   details; per-site command cards + global kill header + full rail, not-wired rendered as not-wired).
   22 server tests in `commandCentre.{runtime,overviewApi}.test.mjs` (9 + 9) + 4 sidecar reader
   tests + 4 TSX panel tests; first-live executive wiring deferred to slice 5 by design. Suite
   1,744 → 1,770; typecheck clean.
5. Execution: bandwidth auto-claim (first live) — fixture-tested, manual live verify.
6. Execution: CCXT live — fixture-tested, security-review, manual live verify on smallest envelope.
7. ExpertOption ExpertBot pattern (demo) + expansion docs/checklist.
   **Slice 7 is not the end** — the web expands to remaining platforms one-by-one via the catalog;
   the methodology (below) continues beyond slice 7 indefinitely.

---

## The Living Methodology (baked into this spec — the "improve loop")

The owner explicitly requires that implementation is **not a one-shot 1→7 then stop**. The spec and
the code evolve together through a disciplined loop. This section codifies it so every implementer
follows the same protocol:

1. **Post-slice post-brainstorm** — after each slice lands, re-brainstorm that slice's slice ahead
   via the brainstorming skill to ensure nothing was missed before building the next.
2. **Targeted, specific implementation** — each slice is implemented **highly targeted** (one
   coherent unit), never a broad sweep.
3. **Self-improvisation loops** — after each slice, run an improve/review pass and implement the
   follow-up back into the code (refine/stabilize) before declaring the slice complete.
4. **Cumulative review** — at the end of each slice, review the full accumulated state to resolve
   any hidden potential defects; at the end of all slices, run an exhaustive end-to-end review,
   testing, refinement and improvisation loops so nothing is left off.
5. **Completion gate** — nothing is "done" until it is verified complete **in this spec doc** — the
   spec's checklists are the definition of done; the spec is continuously improved alongside the
   code.
6. **Spec is living** — this document is a source of truth that is updated as implementation
   reveals reality; it feeds the cumulative `PICC.md` consolidation.

---

## Out of Scope

- **ExpertOption live trading** in the first slice (stays demo; live requires connector maturity +
  explicit ADR decision — a later phase).
- **Non-trading, non-bandwidth streams** (depin, nft, defi, crypto, p2p, agent) beyond registry
  readiness — they plug in as their suites gain features via the catalog (no engine redesign).
- **Network-acceleration bandwidth sharing** and **extension-based account tracking** — both
  explicitly deferred ("needs more brainstorming") by the owner; not specced here.
- **Auto-execution on `forbidden` sites** — never, by design (5C).
- **Removing the human-approval floor** for any real-money execution on non-sanctioned sites.
- **The README/PICC.md doc consolidation** — a declared separate workstream, not part of this spec
  (this spec is one authoritative source that consolidation absorbs).

---

## Further Notes

- **Non-negotiable carries:** advisory-on-forbidden-stays; honesty labels stay
  (`absent → null`, `unconfigured ≠ zero-filled`); the 1620+ test suite never shrinks;
  auth/payment/broker/ledger paths get a `security-review` pass; no behavioral camouflage; no
  withdrawals of safety-floor promises.
- **Anti-hallucination is architectural**, not cosmetic: deterministic computation stays
  separate from LLM inference, claims are labeled, and staleness is always visible.
- **Metalearning & self-improvement are bounded** — they tune the "streamline beyond" surface only;
  the sidecar's invariants, the kill switch, breakers, opt-in, exposure ceilings, downgrade-only,
  and audit are outside their reach.
- **This is a design/planning artifact** — nothing here is yet implemented; production wiring and
  tests are required before any slice is claimed done, and verification is observed, never assumed.
