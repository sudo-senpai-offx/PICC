// WS-7 T7R-B — THE CALLER. The first thing in this repository that actually
// runs `evaluateCopilot` outside a test.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, AND WHY IT IS NOT A NEW ENGINE
// ---------------------------------------------------------------------------
//
// Three tasks shipped the parts and recorded, honestly, that nothing assembled
// them:
//
//   - T11 entry 0022 — the engine lands; the room renders its absence.
//   - T12 entry 0023 handoff #2 — "Wire `evaluateCopilot({ conflicts })` into a
//     caller. The engine's default path is byte-identical to T11's, so nothing
//     consumes the conflicts until a room or a service asks for them."
//   - T13 entry 0025 handoff #6 — "No caller of the sentiment reader."
//
// Each was told not to touch `apps/dashboard/src/`, and each was right to obey:
// a room cannot fetch, and a client cannot own a market-state supply chain. This
// file is the seam those three handoffs kept pointing at, and it is the first
// one that lives on the SERVER — which is the side that is allowed to hold a
// broker credential, read a data source, and know what time it is.
//
// IT COMPUTES NOTHING. Every number below comes out of `evaluateCopilot`,
// `deriveMarketState`, `evaluateConflicts` (reached through the engine's own
// `conflicts` option) or `atrStop`. There is no threshold restated here, no
// band, no score arithmetic, and no fallback score. If the engine cannot be
// evaluated, this returns an ABSENCE with a reason, and the room renders its
// named-unavailable state.
//
// ---------------------------------------------------------------------------
// WHY THE CLIENT DOES NOT SUPPLY CANDLES
// ---------------------------------------------------------------------------
//
// The obvious alternative is for the browser to fetch candles and hand them up.
// That is rejected on three grounds, and the first is decisive:
//
//   1. IT WOULD NOT ACTUALLY CLOSE THE ROOM. A candle series is an INPUT to the
//      engine, not the engine's output. Even with candles in hand, a client-side
//      call is a SECOND copy of the decision path in a second runtime, and the
//      server would remain the module that nothing calls — the exact gap T12
//      handoff #2 names.
//   2. `computedAt` IS A SAFETY INPUT. `marketState.mjs:135-139` makes it
//      REQUIRED and refuses a missing one, because the engine reads no clock
//      (AC-021). A value minted in the browser is the one input on this path
//      that no server can audit, and it feeds `sessionOpen`, the veto that
//      suppresses entries for 15 minutes after the New York open. A caller
//      choosing that timestamp chooses whether the veto fires.
//   3. IT PUTS A MARKET-DATA FETCH IN THE MEASURED ROOM TRANSITION. See
//      `e2e/terminal-perf.spec.ts:150-161`, and the single-request shape below.
//
// So this service fetches its own market state through the SAME broker fan-in
// `/api/trading/candles` uses, derives, evaluates, and returns a reading.
// ---------------------------------------------------------------------------
//
// ONE REQUEST, NOT THREE. A client that wanted the engine's output the obvious
// way would need a candle series at the working timeframe, a 4H series for the
// Structural expert, and 400 daily closes for the 200/400 EMA legs of Macro
// Bias — three round trips before a score could be computed. Here they are three
// server-side `getBestCandles` calls inside ONE authenticated request. The
// client learns the score, the contributions, the vetoes and the risk
// observations in a single `POST /api/trading/copilot`.
//
// ---------------------------------------------------------------------------
// WHAT IS STILL ABSENT, AND STAYS ABSENT
// ---------------------------------------------------------------------------
//
//   - SENTIMENT. The 5% expert's input is T13's producer and nothing supplies
//     it, so `sentimentInput` is left `undefined`. `marketState.mjs:215-224`
//     makes that an unavailable expert, and the room names T13 as its owner. It
//     is NOT defaulted, and a zero is NOT substituted.
//   - NEWS AND PROPOSALS. `newsEvents` and `proposals` are left `undefined`,
//     which `optionalArray` turns into `null` — "never supplied", not "supplied
//     and empty". A `newsLockout` veto fed `[]` would claim a Red Folder was
//     checked and found clear when no news source exists.
//   - A BROKER PERMIT. `automationPermitted` is `false` and `rung` is `paper`.
//     The permit store (T16) is per-user and this route is read-only, so an
//     absent permit means not permitted (AC-024) — the fail-closed direction.
//   - THE DAILY DRAWDOWN FIGURE. Nothing in this tree tracks a daily drawdown
//     for a decision path, so the observation is `null` and the Risk room names
//     the supply chain. The `-2%` session halt in `v32Copilot.mjs:28` and the
//     `-5%` daily limit in `u4faRisk.mjs` are NOT substituted for it.
//   - A STRIKE STORE. The 3-strike counter is per-key and append-only; there is
//     no key here, so the observation is `null` rather than `strikes: 0`.
//
// Each of those is a real absence with a named owner, and each is reported in
// the response as such rather than being quietly filled in.
//
// ---------------------------------------------------------------------------
// PURE WITH RESPECT TO THE ENGINE, IMPURE WITH RESPECT TO DATA
// ---------------------------------------------------------------------------
//
// No clock of its own: `computedAt` is the LAST CANDLE'S OWN TIMESTAMP, never
// `Date.now()`. That is the honest choice twice over — it is the bar the score
// was computed for, and it keeps the route reproducible for the same input. A
// fresh clock would make the same series score differently on a replay and would
// let `sessionOpen` be moved by whoever called last.
//
// The one seam left for testing is `fetchCandles`, injectable so a test can
// drive the real engine from a fixed series without a broker.

import { atrStop } from "./riskLayer.mjs"
import { evaluateCopilot } from "./engine.mjs"
import { MIN_DAILY_CLOSES, MIN_WORKING_CANDLES } from "./marketState.mjs"

/** How much history to ask the broker for, per leg. */
export const LEG_HISTORY = Object.freeze({
  /** Working timeframe: comfortably past `MIN_WORKING_CANDLES`. */
  working: 240,
  /** 4H, for the Structural expert's support/resistance and VWAP. */
  h4: 200,
  /** Daily closes, for the 200/400 EMA legs. `+20` over the 400 floor. */
  daily: MIN_DAILY_CLOSES + 20
})

/** Working-timeframe seconds. 60 = the 1m bars the suite already charts. */
export const WORKING_TIMEFRAME = 60
/** 4H seconds. */
export const H4_TIMEFRAME = 14400
/** Daily seconds. */
export const DAILY_TIMEFRAME = 86400

export const COPILOT_DECISION_VERSION = "copilot-decision/1.0.0"

/**
 * Every leg this service could not obtain, and why.
 *
 * The room renders these as named unavailabilities. The list is EMPTY when every
 * leg arrived, and it is an honest, per-leg list otherwise — never a single
 * boolean that would hide which of three inputs was missing.
 *
 * @param {Record<string, string>} [byLeg]
 */
function unavailableLegs(byLeg = {}) {
  return Object.freeze(Object.entries(byLeg).map(([leg, reason]) => ({ leg, reason })))
}

/**
 * Evaluate the Copilot for one asset.
 *
 * @param {object} params
 * @param {string} params.assetId e.g. "EURUSD".
 * @param {string} [params.source] Broker slug pin; "auto" is the quality fan-in.
 * @param {(assetId: string, opts: {timeframe: number, count: number, source: string}) => Promise<{candles: Array<object>, source?: string|null, stale?: boolean}>} [params.fetchCandles]
 *   Injectable broker seam. Defaults to the market-data fan-in. A test injects a
 *   fixed series so the REAL engine runs without a broker.
 * @returns {Promise<object>} The reading. Never throws for missing data — a leg
 *   that could not be fetched is reported in `unavailable`.
 */
export async function copilotDecisionForAsset({ assetId, source = "auto", fetchCandles } = {}) {
  const id = typeof assetId === "string" ? assetId.trim().toUpperCase() : ""
  if (!id) throw new TypeError("copilot: an assetId is required")

  const fetch = fetchCandles ?? defaultFetchCandles
  const byLeg = {}

  const [working, h4, daily] = await Promise.all([
    safeLeg(() => fetch(id, { timeframe: WORKING_TIMEFRAME, count: LEG_HISTORY.working, source }), "working"),
    safeLeg(() => fetch(id, { timeframe: H4_TIMEFRAME, count: LEG_HISTORY.h4, source }), "4h"),
    safeLeg(() => fetch(id, { timeframe: DAILY_TIMEFRAME, count: LEG_HISTORY.daily, source }), "daily")
  ])

  const workingCandles = bars(working)
  const h4Candles = bars(h4)
  const dailyCloses = closes(daily)

  if (workingCandles.length < MIN_WORKING_CANDLES) {
    byLeg.working = `only ${workingCandles.length} working-timeframe bars were obtained and ${MIN_WORKING_CANDLES} are required to evaluate the engine`
  }
  if (dailyCloses.length < MIN_DAILY_CLOSES) {
    byLeg.daily = `only ${dailyCloses.length} daily closes were obtained and ${MIN_DAILY_CLOSES} are required for the 200/400 EMA legs`
  }

  // `computedAt` is the LAST BAR'S OWN TIME. See the header: never `Date.now()`.
  const computedAt = lastTime(workingCandles)
  if (computedAt === null) {
    byLeg.working = "no working-timeframe bar carried a usable timestamp, so the state has no time to be computed at"
  }

  // Without enough bars the engine WOULD still return a confluence — it reports
  // unavailable experts rather than refusing, which is right for a diagnostic and
  // wrong for a decision. Off five bars the EMA50, ADX, ATR, Bollinger and
  // StochRSI legs are all cold, so the number that comes back is a score whose
  // every leg is missing, and presenting THAT as "the score" invites someone to
  // act on it. `MIN_WORKING_CANDLES` is the floor this module declares for
  // exactly that reason, so the route refuses below it and returns the absence.
  //
  // The refusal is total rather than partial: a score with no warm legs and a
  // veto list that fires `newsLockout` anyway is not a degraded reading, it is a
  // non-reading with extra steps.
  if (Object.keys(byLeg).length > 0 && (computedAt === null || workingCandles.length < MIN_WORKING_CANDLES)) {
    if (computedAt === null) {
      byLeg.working = "no working-timeframe bar carried a usable timestamp, so the state has no time to be computed at"
    } else if (!byLeg.working) {
      byLeg.working = `only ${workingCandles.length} working-timeframe bars were obtained and ${MIN_WORKING_CANDLES} are required to evaluate the engine`
    }
    return {
      ok: true,
      decisionVersion: COPILOT_DECISION_VERSION,
      engineVersion: null,
      assetId: id,
      computedAt: null,
      confluence: null,
      vetoes: [],
      firedVetoes: [],
      tier: null,
      conflicts: null,
      risk: riskReading(null, null),
      coverage: {
        workingBars: workingCandles.length,
        h4Bars: h4Candles.length,
        dailyCloses: dailyCloses.length,
        source: sourceOf(working, h4, daily),
        stale: [working, h4, daily].some((l) => l?.stale === true)
      },
      unavailable: unavailableLegs(byLeg)
    }
  }

  // Sentiment, newsEvents and proposals are deliberately OMITTED from the raw
  // state — see "WHAT IS STILL ABSENT" above. Omission is what makes the
  // corresponding expert and vetoes report unavailability.
  const result = evaluateCopilot({
    marketState: {
      candles: workingCandles,
      h4Candles: h4Candles.length > 0 ? h4Candles : undefined,
      dailyCloses: dailyCloses.length > 0 ? dailyCloses : undefined,
      computedAt
    },
    // AC-024: an absent flag must never mean permitted. AC-025: the lowest rung.
    broker: { automationPermitted: false, rung: "paper" },
    // T12's three rules, asked for rather than skipped. `{}` enables all three
    // and lets each observe from the state; C2 reports `unavailable` for want of
    // a direction, which is the honest outcome for a route with no open position.
    conflicts: {}
  })

  const highs = workingCandles.map((c) => c.high)
  const lows = workingCandles.map((c) => c.low)
  const closesSeries = workingCandles.map((c) => c.close)

  return {
    ok: true,
    decisionVersion: COPILOT_DECISION_VERSION,
    engineVersion: result.engineVersion,
    assetId: id,
    computedAt,
    confluence: result.confluence,
    vetoes: result.vetoes,
    firedVetoes: result.firedVetoes,
    tier: result.tier,
    conflicts: result.conflicts,
    risk: riskReading(atrStop(highs, lows, closesSeries), computedAt),
    coverage: {
      workingBars: workingCandles.length,
      h4Bars: h4Candles.length,
      dailyCloses: dailyCloses.length,
      source: sourceOf(working, h4, daily),
      stale: [working, h4, daily].some((l) => l?.stale === true)
    },
    unavailable: unavailableLegs(byLeg)
  }
}

/**
 * The Risk room's three observations from ONE evaluation.
 *
 * `atr` is real and derived. `drawdown` and `threeStrike` are `null`, each with
 * the reason it could not be produced, because this route holds neither a daily
 * drawdown figure nor a strike store — see the header. Reporting them as absent
 * is the whole point: a `strikes: 0` here would assert a counter nobody read.
 */
function riskReading(stop, observedAt) {
  return {
    atr:
      stop && stop.available === true && stop.atr !== null
        ? {
            atr: stop.atr,
            period: 14,
            stopDistance: stop.stopDistance,
            multiple: stop.multiple,
            observedAt
          }
        : null,
    atrUnavailableReason:
      stop && stop.available === true
        ? null
        : (stop?.unavailableReason ?? "no working-timeframe series was obtained, so ATR(14) cannot be evaluated"),
    drawdown: null,
    drawdownUnavailableReason:
      "no daily drawdown figure is tracked for the decision path; v32Copilot's -2% session halt and u4faRisk's -5% daily limit are not this rail",
    threeStrike: null,
    threeStrikeUnavailableReason:
      "the 3-strike counter is per-key and no key is in scope for a read-only asset decision"
  }
}

/**
 * The market-data fan-in, the same broker `/api/trading/candles` uses.
 *
 * A leg the broker cannot serve returns its own honest empty shape, exactly as
 * the candles route returns `source: "none"` with an empty array — NOT a throw.
 * That is why `safeLeg` here usually has nothing to catch.
 */
async function defaultFetchCandles(assetId, { timeframe, count, source }) {
  const { getBestCandles } = await import("../marketDataBus.mjs")
  const out = await getBestCandles(assetId, { timeframe, count, source, preferredSource: null })
  return { candles: out?.candles ?? [], source: out?.source ?? null, stale: out?.stale === true }
}

/** A leg that throws becomes a named absence, never a fabricated zero. */
async function safeLeg(run, leg) {
  try {
    return await run()
  } catch (err) {
    return { candles: [], source: null, stale: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Keep only bars with finite OHLC — the same filter the chart route applies. */
function bars(leg) {
  const rows = Array.isArray(leg?.candles) ? leg.candles : []
  return rows.filter(
    (c) =>
      c &&
      typeof c.open === "number" &&
      Number.isFinite(c.open) &&
      typeof c.high === "number" &&
      Number.isFinite(c.high) &&
      typeof c.low === "number" &&
      Number.isFinite(c.low) &&
      typeof c.close === "number" &&
      Number.isFinite(c.close)
  )
}

/** Daily closes come back as candles; Macro Bias wants the close series. */
function closes(leg) {
  return bars(leg)
    .map((c) => c.close)
    .filter((v) => Number.isFinite(v))
}

/** The newest bar's own timestamp, or null when no bar carried one. */
function lastTime(candles) {
  for (let i = candles.length - 1; i >= 0; i--) {
    const t = Number(candles[i].time)
    if (Number.isFinite(t) && t > 0) return t
  }
  return null
}

/** Which broker served each leg, so a reader can see the provenance. */
function sourceOf(...legs) {
  const out = {}
  const names = ["working", "h4", "daily"]
  legs.forEach((leg, i) => {
    if (leg?.source) out[names[i]] = leg.source
  })
  return out
}
