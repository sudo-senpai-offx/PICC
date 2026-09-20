# PICC Trading Suite — Seal-All-Gaps Design v1 (deployment workstreams)

Status: APPROVED (2026-09-21) · Scope: whole PICC trading suite · Predecessor: brainstorm + research verification (2026-09-21)

## Purpose

Seal every gap between the PICC trading suite today and a fully stabilised trading suite that is ready for real-world deployment. Machine role = enforcement/calculation copilot; human decides. Existing architecture (C1 dispatch layer, C2 command deck, v3.2 layered engine, Command Centre 10-gate sidecar, U4FA, constitution) is the substrate; nothing is rebuilt from scratch.

## Working set (docs bound for implementation)

Per the 2026-09-21 canon sweep (commit `02d8b18`), WS-1…WS-5 bind to these authoritative docs only:

- `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md`
- `docs/specs/PICC_COPILOT_REDESIGN_v1.md`
- `docs/specs/COMMAND_CENTRE_WEB_SPEC.md` (slice 7 still queued)
- `docs/specs/PICC_TRADING_SITES_CATALOG_v1.md`
- `docs/specs/PICC_EARNINGS_AGENTIC_MINISTRY_v1.md`
- `docs/specs/PICC_SUITE_MINISTRY_MODEL_v1.md`
- `docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md`
- `docs/adr/` (0001–0005) + `docs/adr/README.md`
- `PICC.md`, `README.md`, `CONTEXT.md`, `AGENTS.md`, `PRIVACY.md`, `summary-work-state.md`

Implemented-record and research docs stay for traceability; archived docs (`docs/archive/`) are out of scope by decision.

## Locked decisions

1. **Sequence**: execute everything one workstream at a time, WS-1 → WS-5, each independently achievable.
2. **First live venue**: Hyperliquid (perps). Architecture must remain venue-agnostic (more platforms coming).
3. **Second live venue**: iqoption (per user, 2026-09-21). **Third live venue**: ExpertOption, after re-engineering + ADR (EO stays blocked meanwhile per `executionAbsence` doctrine).
4. **HL margin model**: small account, isolated margin per position, leverage cap 3–5x, margin-per-position cap (the spot-era flat `$10` notional is replaced by margin-per-position for perps).
5. **Day-loss truth**: single UTC-aggregated barrier, enforced at propose-time AND execution-time, restart-persistent, all venues aggregated. Retire autopilot local-midnight 10% and per-site envelope −5% as authoritative sources.
6. **MDD anchor**: peak-anchored wallet equity. −15% hard breaker from running peak; −50% size step at −10% from peak; one-way until a new peak forms.
7. **Unlock ceremony**: all four gates machine-enforced — 300 resolved/venue-class + 100-resolve flip-gate/engine + 50-resolve streak floor with observed/expected ratio ∈ [0.7, 1.3] + ~30-trading-day calendar window.
8. **Soak data**: hybrid — deterministic sims for debugging/regression only; real-feed resolves are the only ones spendable toward the gates.
9. **Condition stack**: codify 5-of-7 ORTHOGONAL gate in v3.2 (HTF bias, key level/VWAP, 9/21 EMA, volume delta, CVD/no-divergence, ADX regime, external-clear). Redundancy guard counts RSI/Stoch/CCI-family as one. Default N=5, config-tunable, explained per-row.
10. **Copytrading**: pluggable leader-feed client; first adapter = HIP-verified feeds; manual/CSV import fallback. Idea-sourcing ONLY, never auto-mirror. Qualification: 300+ verified trades, <15% MDD, positive expectancy after costs. Auto-unfollow after 21 days no positions; 5% rolling-7-day account stop.
11. **Venue picture**: HL live first; iqoption gains market-data path (not execution) for FX breadth; EO live blocked until re-engineered + ADR. Venue-adapter contract (cap/risk-model/sandbox/config) plus ADR-driven "venue earns live" process.

## Workstreams (sequential)

### WS-1 · Live order lifecycle (HL, then venue-agnostic)
- Venue adapter contract `{id, markets(), submitOrder(capped), verifyFill, observeEquity, positionView, riskModel}`.
- HL perps adapter: isolated margin, 3–5x leverage cap, margin-per-position cap, funding-aware.
- Sandbox-first real-venue E2E (HL testnet): execute → fill → position tracking → close → realized P&L; real venue calls, not stubs.
- Post-fill slippage/re-pricing analysis vs approved limit; fill-unobserved retry/verification.
- Live position manager: open monitoring, close, realized P&L accrual per venue.
- Enforce margin cap inside the seam (leverage/liquidation geometry not reachable via config alone).

### WS-2 · Risk & drawdown enforcement
- Single UTC-aggregated day-loss rule (propose + execution time, restart-persistent).
- Peak-anchored MDD layer: −10% peak → size −50%; −15% → hard stop; one-way until new peak.
- Execution-time portfolio heat (sum of open margin vs cap).
- Persist kill-switch/day-halt/takeover across restart (audit-backed).
- Per-action consent re-confirming exact order payload before real-money execute.
- Wire spread gate (T6, `spreadSource`) so FX/gold/indices/commodities can pass F1; until wired, those classes stay blocked honestly.
- Codify 5-of-7 orthogonal entry gate with redundancy classifier + per-row explanation.

### WS-3 · Validation & unlock ceremony
- Machine-enforced four gates (above, decision 7).
- Hybrid soak (decision 8).
- Unified paper→demo→live switch (replace the "approved" comment with a ceremony).
- Constitution elapse code-enforced (no more "checked by operator").

### WS-4 · Copytrading idea-sourcing module
- Pluggable leader-feed client + HIP-verified adapter + CSV import fallback.
- Qualification + auto-unfollow + 5% rolling-7-day stop (decision 10).
- Idea-sourcing only: subscribe to signals for display/research; no mirror orders.

### WS-5 · Breadth, operability, hardening
- iqoption market-data path (FX breadth; execution in a later ADR-gated step per decision 11).
- Credential rotation/expiry (EO token, CCXT key lifecycle, HL key security); startup credential validation instead of fail-at-propose.
- Frontend: split ~93.8 KB `TradingSuite.tsx` monolith; command-centre order-flow E2E (Playwright); cross-tab live-lock.
- Smallest-scale go-live runbook (exchange choice, sandbox ON, caps, soak milestones, daily ops, spread-feed wiring).
- EO live re-engineering as 3rd live venue, ADR-gated.

## Current limitations (must be disclosed, per user directive)

1. Live execute path has never touched a real venue, even in sandbox — WS-1 is precondition for any real-money recommendation.
2. T6 spread gate unwired → FX/gold/indices/commodities cannot pass F1; only crypto (limit on HL/CCXT) realistically executable today.
3. No unified drawdown-from-peak breaker; no restart-persistent halt today.
4. v3.2 lane has zero resolved trades; flip-gate 100, constitution 300/500 — going live now would mean a sub-statistical sample (violates v3.3 §0.4).
5. Live consent today = bearer token only, no per-action payload reconfirmation.
6. Credential management thin (no rotation/expiry; half-set key pairs fail only at propose time).
7. Frontend command-centre flow has no E2E.

## Research corrections (verified 2026-09-21, folded in)

- 40%/50-trade 7-loss streak: use Schilling estimate (≈42.6%), not log(n·w) formula/71.3%.
- eToro: use SSRN 4668881 (<1.5% pre-jump, ≈−3% after), not "500/167/+2%".
- SEC AI-fraud aggregate: use a2.work $44M tally or verified cases (Fuller $12.3M; TRM 274.6 ETH/$517k), not "$180M/11".
- −4.48% contest result: quote with human −32.21% counterpart.
- "LLMs cannot trade well without human insight" → Shaw Walters (Token2049, Oct 2025): "You probably do not want to give an AI agent a bunch of money and expect it to make you more."
- RF/SPY study = one paper (JRFM 18(3):142 = arXiv 2412.15448); cite once.
- CVD 0.80/70% thresholds: reword to "validate feed vs futures proxy".

## Traceability

- Classifier sweep: 69 tracked markdown docs classified (commit `02d8b18`); 3 removed, 8 archived, index written to `docs/archive/README.md`.
- Design brainstorm artifact: `C:\Users\sharv\AppData\Local\Temp\opencode\trading-suite-gap-design-v3.3.md` (superseded by this spec).
- Evidence dossiers: capability map + research verification (temp, 2026-09-21).