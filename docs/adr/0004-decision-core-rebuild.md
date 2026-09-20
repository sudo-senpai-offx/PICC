# ADR-0004: Decision-core rebuild — U4FA verdict retires under the v3.2 layered engine

**Date**: 2026-09-19
**Status**: accepted
**Deciders**: project owner, PICC agent

## Context

The v3.2 blueprint bans StochRSI, Bollinger Bands and the 50-EMA as primary triggers on
5–60s charts (documented false-signal behavior, v3.2 §3.2) and requires that confidence be
expressed only through sample size plus cost-adjusted expectancy — never a standalone
percentage or score.

PICC's current decision core, U4FA (`fourFactor.mjs` + `u4faConfig.mjs`), emits a
TRADE/OBSERVE/NEUTRAL verdict driven by F4 booster majority: `boosterB1` StochRSI-K/D cross,
`boosterB2` candle-vs-SMA20, `boosterB3` Bollinger %B-hug — all built on the now-banned
inputs. The owner asked for a *clean-fresh logical rebuild of the engine as the blueprint
updates*, rather than patching the old decision path.

## Decision

Retire the U4FA `verdict` object. Replace the decision path with the v3.2 layered engine:

```
Constitution (always-on): sample floor 300+ / forward 500+, cost-adjusted EV gate,
  no confidence without sample + expectancy
→ Context/Regime: ADX(14) + Regime-3 Chop halt, 4H/daily S/R, MTF HTF bias + EMA400 chain,
  dead-zone / red-folder session gates, F1 safety gates (spread, news, correlation)
→ Execution 5-point score (60s+): VWAP · 9/21 EMA · Volume Delta · CVD · Relative Volume
  (crypto full score; VWAP+EMA-only elsewhere)
→ Copilot (deterministic trip-wires, LLM explain-only)
```

- U4FA + MTF outputs keep logging as **reference registers during the soak period**, then retire.
- Their living legs (F1 safety gates, ADX/Chop, 4H S/R) are re-homed into the new layers.
- Staging is **parallel soak, then flip**: the new engine ships alongside the old; a config
  toggle routes the decision path; the old path keeps logging. Flip gate: new path's
  cost-adjusted expectancy ≥ old path's over the same window, with ≥ 100 paper trades on each,
  and the ~2–4 week soak elapsed.
- Paper + demo run the **new engine immediately** (fast-forwarding the sample clock toward the
  300+ floor); real money is Constitution-gated.
- The ~2,341-test floor is preserved and never shrinks; tests pinning demoted trigger paths are
  re-pointed to the new decision surface over the soak, with honesty pins carried over.
- The U4FA Trit boosts the risk layer. Risk knobs move to the new Normalization layer
  (0.5%/trade, −5% daily UTC, 15-min post-loss cooldown; the daily proposals cap becomes a
  user-configurable setting, default unlimited — see Consequences).

## Alternatives Considered

### Alternative 1: U4FA survives as a hard pre-filter
- **Pros**: minimal regression risk; old verdict still guards entries.
- **Cons**: keeps a decision path built on the exact inputs v3.2 bans; postpones the honesty
  fix and muddies the single-vocabulary design.
- **Why not**: rejected — the owner chose a clean-fresh rebuild, and the whole point is to stop
  letting StochRSI/BB/50-EMA-like legs gate trades.

### Alternative 2: 5-point score primes entry; old verdicts veto-only
- **Pros**: old verdicts keep a watchdog role.
- **Cons**: two decision vocabularies coexist under the hood; every old trigger must still be
  maintained and its veto semantics reasoned about.
- **Why not**: rejected — veto-only reintroduces the demoted inputs as de facto decision
  authority and contradicts the single-path rebuild.

### Alternative 3: immediate clean cut (no soak)
- **Pros**: simplest; single code path at once.
- **Cons**: high regression risk on a live-trading engine with 2,341 pinned tests.
- **Why not**: rejected — data-gated parallel soak is safer and gives a numeric flip gate.

## Consequences

### Positive
- One honest decision path aligned to v3.2; banned triggers demoted to context registers
  (logged, HUD-visible, never decision inputs).
- Flip is data-gated (expectancy comparison, 100+ paper trades each), not calendar-gated.
- New engine accumulates real evidence on paper/demo immediately, shortening time-to-floor.

### Negative
- Two engines run concurrently during the soak (higher operational surface, dual ledger
  tagging required).
- Demoted logic (StochRSI/BB legs) stays in-tree as context registers rather than being
  deleted — an intentional trade-off to keep the HUD honest and tests meaningful.

### Risks
- A soak period longer than expected if new-path expectancy trails old. Mitigation: flip gate
  is explicit; if the new path cannot match after a bounded window, the comparison data shows
  exactly which leg to fix rather than guessing.
- **Trade-cap setting**: the proposals/day cap is now a user-facing, persisted setting
  (data-dir config, same pattern as U4FA knobs), UI default **unlimited**; `0` in the UI
  means unlimited. The prior `maxDailyTrades` knob and the blueprint's 10/day references are
  superseded when the setting is unlimited. The −2% session hard-halt remains a
  non-configurable safety floor.