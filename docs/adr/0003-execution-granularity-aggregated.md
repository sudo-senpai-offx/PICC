# ADR-0003: Execution granularity — 15s pipeline + 15s human HUD inside a 60s engine core

**Date**: 2026-09-19
**Status**: accepted
**Deciders**: project owner, PICC agent

## Context

The v3.2 master blueprint describes a 15-second Lemorei execution engine with a 5-point
execution score (VWAP position, 9/21 EMA alignment, EMA direction, Volume Delta, CVD) and
relative-volume context, producing GO LONG / WAIT / NO SIGNAL / GO SHORT.

PICC's honest bar-resolution floor is 60 seconds — documented at
`adaptiveConfluence.mjs:33` ("15s excluded: 60s bar resolution can't estimate it honestly"),
and the ccxt timeframe ladder starts at 60s (`ccxtAdapter.mjs:19`). Volume is only honestly
available on crypto (ccxt OHLCV carries volume; `yahooAdapter.mjs:75` drops it; EO candles
carry none), so Volume Delta / CVD / Relative Volume are crypto-only by construction.

Three futures previously looked mutually exclusive: (a) rebuild the engine at 60s with the
v3.2 degradation path, (b) build a 15s data pipeline first, (c) expose a 15s human-advisory
HUD only.

## Decision

Adopt (b) and (c) **inside** (a), as one aggregated, future-proof architecture:

1. **Engine core (60s+).** Full 5-point score where real volume exists (crypto via ccxt);
   VWAP + EMA-alignment only elsewhere (forex/EO), with Delta/CVD/Relative Volume documented
   as honest-null — exactly v3.2 §2.5's degradation rule.
2. **15s data slot (b).** The architecture reserves a pluggable sub-minute feed seam so the
   5-point score can later run at true 15s with a futures-proxy validation leg (>0.80
   correlation and >70% same-sign before proxy volume counts as truth). The studio browser
   itself is the natural first 15s source (live venue chart capture via captureProfiles),
   needing no new infrastructure when connected.
3. **15s human-advisory HUD (c).** The studio renders the live 5-point execution score on the
   human's own sub-minute chart — GO LONG / SHORT, reasons, invalidation, ATR stop/target/size
   and the explicit cost line. The automated decision core stays on 60s+; 15s is advisory only.
4. One engine vocabulary at 60s, one HUD at 15s — never conflated.

## Alternatives Considered

### Alternative 1: 60s engine only (a)
- **Pros**: cleanest; zero extra infra.
- **Cons**: permanently void of the sub-minute execution horizon the v3.2 timing tool targets.
- **Why not**: rejected — it forecloses the future-proofing the owner explicitly requested.

### Alternative 2: build 15s data pipeline first (b)
- **Pros**: true 15s engine from day one when feed exists.
- **Cons**: blocks the entire decision-core rebuild on unprovisioned feed infrastructure
  (no venue supplies honest crypto sub-minute volume via existing adapters today).
- **Why not**: rejected alone — infrastructure-gated, stalls the valuable 60s core.

### Alternative 3: 15s HUD only (c)
- **Pros**: human value now; no engine change.
- **Cons**: no 5-point engine at all; the automated core never improves.
- **Why not**: rejected alone — misses the central v3.2 execution engine.

## Consequences

### Positive
- The 5-point engine is volume-honest per venue from launch (crypto full score; everything
  else degrades per v3.2 §2.5 rather than faking a delta).
- Future sub-minute feeds and a futures-proxy leg plug into a reserved seam without reworking
  the decision path.
- One signal vocabulary (5-point score) drives both the 60s automated core and the 15s studio
  HUD; the human sees the same reading the engine uses.
- The existing 15s decision rhythm (`DECISION_INTERVAL_MS = 15_000`, `adaptiveConfluence.mjs:54`)
  already re-evaluates on the newest complete 60s candle — the cadence seam is real.

### Negative
- Forex/EO trade with a reduced feature set (VWAP + EMA-only) until the futures-proxy leg
  validates volume on those instruments — by design, not deficiency.
- 15s data remains advisory; the automated core cannot yet act sub-minute.

### Risks
- A proxy leg that never validates could leave delta/CVD/rel-vol crypto-only indefinitely.
  Mitigation: proxy validator is part of the (b) slot and is explicitly built, not deferred;
  if a feed never connects, crypto still exercises the full score.