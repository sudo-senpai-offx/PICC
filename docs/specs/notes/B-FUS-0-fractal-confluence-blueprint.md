# B-FUS-0 — Master Blueprint (Fractal Confluence Engine): mapping note

Captures the user's personal research on indicator combination, supplied during
Phase B execution ("proceed accordingly, and i did my personal research on
indicator combination, and here is the concise outcome"). This note maps the
blueprint onto the real architecture, marks where it conflicts with this repo's
hard constraints, and separates what is implemented from what is UNVERIFIED
strategy backlog. Phase B does not add new indicators (non-goals).

## What the blueprint proposes (summary)

- **Regime-switching core:** classify Flat/Mean-Reverting vs Sloped/Trending;
  fade oscillators in flat regimes, follow them in sloped regimes (Golden
  StochRSI rule).
- **Indicator matrix:** EMA 400 / 200 / 50 (the 50 EMA + 200 EMA = "Master
  Switch"), Bollinger Bands (20,2), StochRSI (14,14,14), ADX (14) — with a
  stated per-regime role for each.
- **Four Boosters:** B1 = 20 SMA / 50 EMA micro-cross; B2 = BB-width squeeze
  breakout; B3 = StochRSI micro-divergence (mean-reversion only); B4 =
  multi-timeframe confluence blockades.
- **Session-based execution matrix:** Tokyo, London, NY post-news, London/NY
  overlap, Dead Zone — with the hybrid intermediary rule (ADX > 25 & 50 EMA
  sloped toggles strategy family).
- **AI copilot confluence scoring:** weighted experts (Macro x3, Structural x3,
  Trend x2, Momentum x2, Volatility x2, News x1); score > 8 → execute 1% risk;
  score 5-7 → Telegram notification for manual approval; < 5 → ignore.
- **Risk management:** 3-strike rule, 2% daily drawdown cap, spread filter,
  news lockout (Red Folder), hardware optimization note (fast execution).

## Mapping to the existing architecture

| Blueprint piece | Where it maps today |
|---|---|
| Flat ↔ Sloped regime switch | `regimeEngine.mjs` RANGING/TRENDING/UNCERTAIN + `regimeKnobs` (per-regime floors); `regimeDetection.mjs` adapter (B-REG-4); `ConvergencePanel` badge (B-REG-5) |
| Booster 4 — MTF blockades | `mtfConvergence.mjs` `converge()` over available planes → `mtfLayer` evidence group (B-FUS) |
| Regime Layer in the fusion report | `regimeLayer` documentary evidence group inside `confluence.groups` (B-FUS-1, source `"regimeEngine"`) |
| Copilot weighted experts | `buildConfluence` group blend (trend 0.45 / momentum 0.35 / volatility 0.2 ≈ blueprint's Trend/Momentum/Volatility weighting); doc layers add evidence, score untouched |
| Session matrix, booster B1–B3, Golden StochRSI, spread/news lockouts, 3-strike, drawdown cap | **Strategy-config backlog** — not implemented anywhere; no new indicators/models in Phase B (non-goals §7) |

## Conflicts with PICC hard constraints — NOT IMPLEMENTED

1. **"Score > 8: Execute 1% risk" (auto-execution).** PICC §0 and the rebuild
   spec forbid auto-execution; execution is human-approved only and the repo's
   autopilot is advisory-only. Only the blueprint's *middle* branch is
   compatible: score 5-7 → notify for manual approval. The > 8 auto-execute
   branch is recorded here as a contradiction and is NOT implemented
   (B-EXE-4 pins zero auto-order call sites).
2. **Win-rate / promise language** ("the win rate skyrockets", "the math will
   work in your favor"). The repo bans win-rate claims (R9/R12/REQ-WIN). Nothing
   built from this blueprint is validated as a promised edge; only observed
   statistics may ever be shown, with the honest-band comment.

## UNVERIFIED / not computed

- StochRSI(14,14,14), EMA(400), BB(20,2)-walk, ADX(14) toggle, 20-SMA/50-EMA
  cross, "Master Switch" — the raw indicator VALUES exist in
  `indicators.mjs`/the dashboard, but the blueprint's *role semantics*
  (fade-in-flat vs follow-in-sloped, squeeze breakout, micro-divergence,
  imbalance filter) are NOT implemented anywhere in Phase B.
- Session matrix behavior, Red Folder news lockout, 3-strike and drawdown caps
  are strategy rules, not data plumbing — they belong to a future strategy
  envelope slice, not the fusion layers.
- The blueprint's claimed edge/confluence thresholds (score > 8, 5-7 bands) are
  uncalibrated in this repo; the documentary layers intentionally do NOT move
  `verdict` thresholds (B-FUS-1 acceptance).

## What B-FUS builds from it

`regimeLayer` + `mtfLayer` = the blueprint's Regime Switch + Booster 4 made
visible as DOCUMENTARY evidence in the Pro Analysis report. Honest emptiness
(`observed:false`, source labels) is preserved; verdict thresholds stay
byte-identical.