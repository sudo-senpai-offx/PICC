# PICC Resource Governor (v1) — local-first LLM rotation + resource governance

- **Status:** APPROVED (2026-09-12) — §3 hybrid, §5 pack order, §6 Q1–Q6 all approved; §8 complete. Amendment: multiple providers/stack models allowed; max RAM/storage/CPU usage limits configurable (owner decision).
- **Classification:** ARCHITECTURAL — the resource-governance layer of the country-ministry model: every ministry (trading, earnings, bandwidth, intelligence...) draws on a shared, budgeted pool of compute + data sources, never unbounded
- **Owner answers (this session, governing):**
  - **A1:** models up to 8B; smaller models **continuous** run, larger **burst/intermittent** "run only when needed". Hardware: Core 5 120U (iGPU only, no dGPU), 16GB DDR4, strict/configurable CPU/GPU/RAM allocation including iGPU, conserve power. **Design target = Celeron N-series Chromebook** (the floor everything must run on).
  - **A2:** any model combo incl. kilo/million-parameter models (owner previously provided a 14MB model); allowed to build a "highly lite-edition" local AI/ML platform for PICC-specific everything.
  - **A3:** option B chosen (tiny→cheap, big→heavy, Groq only for overflow) — open to hybrid proposal (§3).
  - **B4:** resource dashboard yes as intended + an additional feature — **owner asked us to ask questions + provide recommendations** (§6).
  - **B5:** adhere to strict rate limits, still assure optimal/ideal feature provisioning.
  - **D8:** remove Supabase, keep everything local.
  - **E9/E10:** proceed with workflow pack (pack list §5); develop mini-(lite) AI/ML platform for PICC functionality; adhere to country-ministry-resource concept.
- **Anchors:** `PICC_EARNINGS_AGENTIC_MINISTRY_v1.md` §11 (tiered 24/7 router, Cactus Needle Tier-0); `PICC_TRADING_SITES_CATALOG_v1.md` §5 (multiplexing contract, shared rpm envelope); `handlers.mjs:321` `rateLimited()`; `config.mjs` (env surface); `.env` (local-first: `LLM_PROVIDERS=groq`, `CUSTOM_LLM_BASE_URL` block = intended primary local path, commented)

## 1. The problem

PICC now runs **fully local-first** (D8). The machines that must run it are resource-poor: even the reference machine (Core 5 120U / 16GB / iGPU) must conserve power, and the **design floor is a Celeron N-series Chromebook** — ~2-4 cores, 4-8GB RAM, no GPU worth naming. An LLM call that spins 8B params continuously would melt that target. Yet E10 asks PICC to become a "mini AI/ML platform". The resolution is not "pick one model" — it is **parameter-aware routing with strict budgets**:

> Every PICC task asks: *how heavy does this task actually need to be?* The cheapest model tier that satisfies the task runs. Bigger models run only on burst, and only when a human or regulator says "now".

## 2. Verified starting state (this session)

- `LLM_PROVIDERS=groq` (only live provider); `GROQ_MODEL=groq/compound-mini` verified live (HTTP 200, 972ms).
- `CUSTOM_LLM_BASE_URL` block in `.env` reworded as the **intended primary** local path (LM Studio/Ollama/llama.cpp), currently commented.
- Gemini/Vertex/Serper removed (owner decisions); `config.mjs` still carries the env keys as comments/empty strings (code degrades honestly — `providers()` gates on key presence).
- `rateLimited()` at `handlers.mjs:321`; `PICC_EO_GATEWAY_RPM` default 120; 429 failover → honest local rule engine.
- `PICC_BROWSER_PERF` stays auto (`resolvePerf`/`detectPerfMode`).
- Supabase removal scoped: `localstore.mjs` already the JSON-backed persistence replacement (`server/data/<table>.json`); `services/supabase.mjs` remains only as a sync/billing belt for `handlers.mjs` — the removal slice is small and well-defined. (`paypal.mjs` was removed per owner directive 2026-09-13 — the PayPal leg of the belt is gone; G4 no longer covers it.)

## 3. A3 — the tiered rotation policy (hybrid, recommended — owner to approve)

### 3.1 Tiers (each with a provider + model class + run mode)

| Tier | Model class | Run mode | Where it runs | Used for |
|---|---|---|---|---|
| T0 | **Cactus Needle 2** (45M params, 14MB binary, ~28MB session RAM, 500+ tok/s on a Pi 5, runs in WASM in-browser; Apache-2.0) | **continuous** | browser tab (Chromebook-safe — no install, no server RAM) | tool-calling, structured extraction, micro-decisions, enum picks, confidence-gated escalation (`PICC_EARNINGS_AGENTIC_MINISTRY_v1.md` §11.3 — owner's 14MB model) |
| T1 | **tiny local** (1–3B: `qwen2.5:1.5b`, `llama3.2:3b`, `phi4-mini:3.8b` class) | **continuous** | llama.cpp/Ollama CPU (iGPU optional when free) | summaries, classification, news digest, signal drafting, most earnings briefs |
| T2 | **medium local** (7–8B Q4_K_M) | **burst only** — "run only when needed", idle otherwise; power guarded | llama.cpp CPU, iGPU offload when idle budget allows | analysis that needs real reasoning: strategy briefs, opportunity vetting, trading-session review |
| T3 | **Groq** (cloud, free tier; `groq/compound-mini` verified) | **overflow only** | cloud API | anything the local tiers cannot do within their rpm/burst budgets; never the primary for any feature |

### 3.2 Routing rule (parameter-aware)

A task descriptor `{taskKind, complexity, maxTokens, deadlineMs, toolCall:bool}` maps to a tier:
- tool-call / extraction / micro-decision → **T0** (confidence-gated: act above threshold, escalate below)
- text gen ≤ ~500 tokens, no deep reasoning → **T1**
- reasoning / long synthesis → **T2**, gated by burst budget (X calls/hour, configurable, default conservative)
- T2 budget exhausted OR deadlineMs critical AND T1/T2 unavailable → **T3** overflow
- nothing available → **honest "unavailable"** (never a stall, never a fabricated result — ministry §11.2)

### 3.3 Why hybrid beats pure B

Option B alone (tiny→cheap, big→heavy, Groq overflow) is approved and sound, but **T0 (Cactus Needle, WASM) is free on the Chromebook's weakest resource** — it does not consume the server's 16GB or the iGPU at all, and it is *the* owner-provided 14MB model the owner explicitly named in A2. Routing micro-decisions to it removes ~80% of calls from T1, which stretches the continuous budget enormously. The hybrid = B + T0. Recommendation: **approve hybrid (3.1), keep T2 burst conservative (default e.g. 6 calls/hour/feature), keep T3 as overflow-only.**

## 4. Resource governance — what exists + what is proposed

### 4.1 Already enforced (verified)
- `rateLimited()` rpm gates on the server; `PICC_EO_GATEWAY_RPM` 120 default; provider failover + honesty contract in the LLM router.
- Browser perf mode auto-detect. Trading data cadence capped (`DECISION_INTERVAL_MS 15_000`).

### 4.2 Proposed — the Resource Governor (one governance layer, all ministries)
1. **Budget sheet (the core):** per-source + per-feature rpm ceilings; a shared envelope so suites multiplex without exceeding venue caps (`PICC_TRADING_SITES_CATALOG_v1.md` §5). Ceilings configurable (settings page), defaults conservative.
2. **LLM rotation governor:** enforces §3 tiers — per-feature per-tier budgets, burst windows for T2, overflow gating for T3, Cactus Needle as always-on T0. Parameter-aware routing lives here (shared `routeTask(task)` used by every LLM caller).
3. **Observability ledger (new, this is the "additional feature" candidate):** every LLM call + every data fetch logged with `{feature, tier/model, tokens, latencyMs, rpmWindow, cpuMs?, verdict:accepted|throttled|failed}`. This is the *honest* resource truth-teller — it is what the dashboard renders, and it is what the governor decides against. Without it the dashboard would show guessed numbers, which the honesty contract forbids.

## 5. Preconfigured lightweight workflow packs (E9 — pack list for approval)

Packs are ready-to-run workflow bundles pinned to the lightest model tiers + rate ceilings, consistent with ministry workflow rules (RUN steps auto, L-class steps human-executed, `agent_logs` records, human flips "done"). Adhere to country-ministry-resource concept: each pack declares its resource envelope.

**Pack 1 — "Local Trading Core" (first slice; depends on trading-suite trust gate for anything beyond advisory):**
1. EO session capture (T0-class extraction of demo session state; human logs in once — the blocked owner action)
2. CCXT data poll (T1, respaced cadence; reads only)
3. News digest (T1 local or T3 overflow; free sources per catalog §4)
4. Signal notifications (web push, existing channel; "skipped" honesty when unconfigured)

**Pack 2 — "Earnings Monitor"** (payout/owed digest + opportunity vetting briefs; RUN only; L-class stops at human)

**Pack 3 — "Review & Strategy"** (monthly earnings review + trading-session review → strategy brief; T2 burst; human executes any L-class step)

Owner: approve order / reorder / add packs. Each pack ships only when its resources (model tier availability) are observed live — no "should work" claims.

## 6. B4 — Resource dashboard questions + recommendations (owner asked us to ask)

**Q1 — Scope of the dashboard.** Show only LLM/resources, or the full ministry budget sheet (LLM + data-source rpm + per-suite envelope)?
*Recommendation:* full budget sheet. The multiplexing contract (catalog §5) only works if every suite sees the shared envelope, not just LLM. LLM gets its own tab (rotation ledger).

**Q2 — The "additional feature" (owner's ask).** We propose the **Observability ledger** (4.2.3) as the additional feature: a per-call resource truth-log rendered as (a) live table, (b) per-feature burn-down, (c) verdict counts (accepted/throttled/failed), (d) model-tier split. Is that the "additional feature" you had in mind — or did you mean something else (e.g., a power-conservation mode indicator, a burst scheduler UI)?

**Q3 — Throttle behavior.** When a feature exceeds its budget: (a) hard-stop (reject), (b) soft-degrade (fall to cheaper tier), (c) queue, or (d) escalate to human banner?
*Recommendation:* (b) soft-degrade then (a) hard-stop, with every action logged in the ledger. Never silent. B5 says "adhere to strict limits" → the ceiling is hard; the *response* to hitting it can be graceful. Except L-class/health-critical steps which always escalate to human.

**Q4 — Burst semantics for T2 (7-8B).** Define "burst": (a) calls/min cap, (b) daily cap, (c) power-aware window (only when machine is on AC / iGPU idle), or a combination?
*Recommendation:* combination — (c) as the gate, (a) as the wall, (b) as the daily sanity check. On the Celeron floor, T2 may be effectively unavailable; the governor must degrade to T3 overflow or honest "unavailable", never freeze.

**Q5 — Persistence of the ledger.** Where does the observability ledger live post-D8?
*Recommendation:* local JSON via existing `localstore.mjs` (`server/data/`), no Supabase. Ledger is append-only, bounded (rotate by day), never contains prompt content (tokens+metrics only — privacy).

**Q6 — Settings surface.** Where do ceilings live?
*Recommendation:* extend existing `/settings/llm` with a Resource tab (per-feature rpm, tier budgets, burst window, per-source caps from the catalog). No new top-level settings page in P1.

## 7. Slices

- **G1 — Observability ledger + routeTask() (TDD):** `server/services/resourceGovernor.mjs` — `routeTask(task)` (tier decision, pure function, table-tested), `recordCall(entry)` (append-only JSON via localstore), `governorStats()` (window/counters/verdicts). Tests: routing matrix (every tier reachable, never unbounded, honest unavailable), ledger round-trip, stats correctness.
- **G2 — Governor enforcement:** wire `routeTask` into the LLM caller as the default path (env flag `PICC_RESOURCE_GOVERNOR=on` to switch); existing provider failover stays beneath it. Tests: existing LLM tests stay green; new tests for budget-exceeded → soft-degrade → hard-stop.
- **G3 — Dashboard:** Resource tab rendering ledger + budget sheet from `governorStats()`; honesty: unobserved metrics render "—", never zero. Component tests + smoke.
- **G4 — Supabase removal (D8):** strip the `supabase.mjs` sync/billing belt from `handlers.mjs`, pin local paths, delete dependency usage (package.json), keep env keys documented as dead. (Note: `paypal.mjs` + its test were removed per owner directive before G4 — the stripePortal sync test remains the one `supabase.mjs` mock to rewrite to local-only; no test weakens honesty.)
- **G5 — Pack 1 "Local Trading Core"** + pack registry (per-pack resource envelope declared). Acceptance: pack runs are observed live once tiers are up; L-class steps stop at human handoff.

## 8. Approval decisions (2026-09-13, owner)

1. §3 hybrid policy (B + T0 Cactus Needle) — **APPROVED**.
2. §5 pack list order (Trading Core → Earnings Monitor → Review & Strategy) — **APPROVED**.
3. §6 Q1–Q6 — **all answers approved as recommended** (full budget sheet incl. data-source rpm; Observability ledger as the additional feature; soft-degrade then hard-stop; power-aware+rate+daily burst combination; local JSON ledger; Resource tab on `/settings/llm`).
4. Sequencing: G1→G4→G5 (G4 already landed as a separate slice).
5. **Owner amendment (binding):** multiple providers / stack models may be included as needed; **max RAM / storage / CPU usage limits must be configurable** (settings surface, conservative defaults — §4.2.1 and §3 tables are defaults, not hardcoded ceilings).