# 0010 - PAPER_ONLY_ORDER_PATH_CLAIM v1 -> v2

Supersession record for the claim, in two documents, that paper trading is the
only order path in the codebase and that venue execution is removed by design.

rule: PAPER_ONLY_ORDER_PATH_CLAIM
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0010-PAPER_ONLY_ORDER_PATH_CLAIM-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 was already false before this correction, and the correction is not new
  judgement - it is the same correction owner decision D19 made to `PICC.md`
  §0 on 2026-09-26, applied to the two places D19 did not reach. D19 amended
  guardrail 1 to describe two venue-capable, ceremony-gated, hard-capped rails
  that are intentionally retained. `README.md` still carried the unamended
  "the only order path in the codebase is the paper-trading ledger" in two
  places, and `PICC.md` §4 still said "No adapter has an order-placement surface
  except paper + demo-gated EO legacy paths - execution is removed by design" 220
  lines below the guardrail that contradicts it. The code is unambiguous:
  `ccxtOrdering.mjs:246` calls `instance.createOrder(sym, "limit", ...)` and the
  file's own header at `:217` calls it "The ONLY createOrder caller in the
  process"; `handlers.mjs` exposes `POST /api/command-centre/orders/execute` at
  `:1993` and `POST /api/command-centre/orders/verify` at `:2073`;
  `commandCentre/ccxtExecution.mjs` exports `proposeCcxtOrder` /
  `executeCcxtOrder`; and the ceremony-gated perps rail is documented in guardrail
  1. v2 makes every one of those documents say the same thing.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, requirement
  R5.1 and acceptance criterion AC-016; owner decision D19, resolved
  2026-09-26 and already applied to PICC.md section 0 guardrail 1. Findings H4
  and H5 of
  .superpowers/sdd/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1/task-t5b-investigation.md.
  Sibling records: 0011-BANDWIDTH_PAYOUT_CLAIMS_LEG (a third, different claimed
  execution leg, absent for a different reason),
  0013-WS7_REGISTRY_ROW_PROGRESS_NOTE (the registry row that described D19 as
  still owed), 0012-MODE_ENGINE_WORKABILITY_WIRING.

## What changed

| Location | v1 claim | v2 |
|---|---|---|
| `README.md` intro | "**PICC never executes transactions on your behalf.** ... the only order path in the codebase is the paper-trading ledger behind a human-approval gate" | "**By default, PICC never executes transactions on your behalf.**" - paper trading named as the everyday path, the one retained venue-capable rail named with its consent gate, and a pointer to `PICC.md` §0 guardrail 1 |
| `README.md` legal posture | "Read-only data connections wherever possible; the only order path is paper trading" | "paper trading is the everyday order path, and the one venue-capable rail runs only on fresh per-action human consent" |
| `README.md` roadmap | "First real-money execution (CCXT sanctioned automation + bandwidth auto-claim, within safety floor) \| 🔜" | the CCXT leg is described as landed, and the outstanding item is the perps `cancelOrder` closure plus the approved-but-unlanded ExpertOption removal (see 0011 for the bandwidth auto-claim half) |
| `PICC.md` §3.1 | "Neither the dashboard, the extension, nor the agents can place orders, publish, or buy anything." | the studio browser named, and the single carve-out pointed at inline |
| `PICC.md` §3.2 diagram | "External platforms ... - user clicks, PICC never executes" | "the user places; PICC's only order-capable path is the consent-gated `ccxtOrdering` rail" |
| `PICC.md` §3.2 frontend/backend | unchanged in substance - `ccxtOrdering` is already carved out in §3.1 | unchanged; the correction makes §4 agree with §3 rather than inventing a new carve-out |
| `PICC.md` §4 brokers | "**No adapter has an order-placement surface except paper + demo-gated EO legacy paths - execution is removed by design (roadmap §0 dead-letter).**" | "`ccxtOrdering` is order-capable. **Execution is NOT removed by design** (an earlier revision of this line said it was, and the code contradicted that)", both retained rails named, and the `ccxtConnector` amputation preserved |
| `PICC.md` §12.1 F6/F7 | untouched | untouched - the F-series row describes doc-drift closure, not an order-path claim |

## Why "by default" rather than a deletion

The v1 sentence in `README.md` was not simply wrong in one direction. Its
*substance* - that a human is in the loop and that the everyday path is paper -
is true and is the product's posture. What was false was the absolutism: "the
only order path in the codebase". Deleting the sentence would have removed a
true statement along with the false one and left a reader with no posture at
all, which is the over-correction D19 already rejected when it chose to amend
guardrail 1 rather than delete it. v2 keeps the posture, states the exception
with its gate, and points at the section that carries the full rail table.

The same reasoning applies to `PICC.md` §4. The paragraph's inventory of the six
`brokers/` adapters is accurate and is preserved verbatim; only the trailing
claim, which asserted the absence of a capability the same document documents
twice, is corrected.

## Why historicalTradesAffected is `none`

Decided, not defaulted, and this is the record where the decision is least
obviously free, so it is argued rather than asserted.

The corrected text is a statement about which code paths can place an order. The
gates, the envelope, the carriers, the idempotency keying, the consent payload
lock and the audit rows are all unchanged by this correction - D19 did not touch
them and neither did this slice. No paper trade, backtest fold or recorded
result was produced by `ccxtOrdering.mjs`, and none could have been: the CCXT
rail is consent-gated, requires a fresh per-action `consentBy`, and no live venue
is enabled, so the repository holds no venue-order result for it to relabel.
`executionAbsence.test.mjs` and the machine-discovered scope added by WS-7 T0
guard the modules that must *not* place orders, and that guard is untouched.

The direction of the error is what makes this safe to record as `none`. v1
understated the code's capability; v2 states it accurately. Neither version
changes what the code does, and `historicalTradesAffected` asks whether prior
*results* change meaning - not whether prior *prose* was wrong. A reader who
acted on v1 would have believed a capability absent; that reader is now
corrected, and that correction is exactly what the field is for. It is
`reinterpret` only if a past result was labelled under the v1 claim, and no
result was.
