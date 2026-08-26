// PICC Signal Engine — the advisory-first heart (execution removed, Phase A).
//
// On a fixed cadence it evaluates EVERY asset in the shared autopilot scope
// (config reused — no parallel settings universe) through:
//   1. marketDataBus.getBestCandles   — best available data, honestly sourced
//   2. modelMatrix consensus          — 7-model multiplexing vote + weights
//   3. entryLevels                    — ideal buy/sell zones (pivot/swing/EMA)
//
// Alert state machine per asset:
//   IDLE ──(consensus aligns + confidence ≥ pref + price within triggerAtr·ATR
//          of a zone anchor)──► PRE_TRADE dispatched ──► WINDOW(minutes)
//              ├─ price touches zone anchor ──► FOLLOW_UP: "level reached"
//              └─ window expires ────────────► FOLLOW_UP: "window expired"
//          back to IDLE
//
// This is decision support only. Nothing here places orders anywhere.

import { getAutopilotConfig } from "./autopilot.mjs"
import { computeModelMatrix } from "./modelMatrix.mjs"
import { computeEntryLevels } from "./entryLevels.mjs"
import { getBestCandles } from "./marketDataBus.mjs"
import { dispatchAlert, getPrefs } from "./notifier.mjs"

const CHECK_INTERVAL_MS = 45_000
const TRIGGER_ATR = 0.5 // distance from zone anchor (in ATRs) that arms an alert

const engine = {
  timer: null,
  running: false,
  lastRun: null,
  states: {}, // assetId → { phase: "idle"|"alerted", since, zone, alert }
}

export function signalEngineStatus() {
  return {
    ok: true,
    running: Boolean(engine.timer),
    lastRun: engine.lastRun,
    watched: Object.keys(engine.states).length,
    states: Object.fromEntries(Object.entries(engine.states).map(([k, v]) => [k, v.phase]))
  }
}

function fmtPx(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return "—"
  return v < 10 ? v.toFixed(4) : v.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

async function evaluateAsset(assetId) {
  const prefs = getPrefs()
  const st = (engine.states[assetId] ??= { phase: "idle" })

  const feed = await getBestCandles(assetId, { timeframe: 60, count: 200 })
  if (!feed.candles.length || feed.source === "none") {
    return `${assetId}: no data (${feed.source})`
  }
  if (feed.stale && feed.source === "yahoo") {
    // Daily bars make minute-scale windows meaningless — skip honestly.
    return `${assetId}: daily-resolution fallback — skipped for intraday timing`
  }

  const matrix = computeModelMatrix(feed.candles)
  if (!matrix.ok) return `${assetId}: matrix unavailable`
  const c = matrix.consensus
  if (c.direction === "flat" || c.confidence < prefs.minConfidence) {
    if (st.phase === "alerted" && Date.now() - st.since > prefs.windowMinutes * 60_000) {
      await dispatchAlert({
        kind: "FOLLOW_UP",
        assetId,
        title: `⏱ ${assetId} — window expired`,
        body: `No entry triggered within ${prefs.windowMinutes} min. Consensus faded to ${c.direction} @ ${c.confidence}%.`
      })
      engine.states[assetId] = { phase: "idle" }
      return `${assetId}: follow-up expired`
    }
    return `${assetId}: no signal (${c.direction} @ ${c.confidence}%)`
  }

  const levels = computeEntryLevels(feed.candles, { timeframe: 60 })
  if (!levels.ok) return `${assetId}: levels unavailable`

  // The actionable side follows the consensus: up → buy zone, down → sell zone.
  const zone = c.direction === "up" ? levels.buyZone : levels.sellZone
  if (!zone) return `${assetId}: no ${c.direction === "up" ? "buy" : "sell"} zone`

  const spot = Number(levels.spot)
  const atr = Number(levels.atr) || spot * 0.002
  const distanceAtr = Math.abs(zone.anchor - spot) / atr

  if (st.phase !== "alerted") {
    if (distanceAtr <= TRIGGER_ATR) {
      // Fire the PRE_TRADE heads-up now — this IS the lead time; the window
      // that follows is the actionable period the user asked to be warned of.
      const dirWord = c.direction === "up" ? "BUY" : "SELL"
      await dispatchAlert({
        kind: "PRE_TRADE",
        assetId,
        title: `🎯 ${assetId} — ideal ${dirWord} window opening (~${prefs.leadMinutes} min ahead)`,
        body:
          `Consensus ${c.direction.toUpperCase()} @ ${c.confidence}% (${c.agree}/${c.total} models agree).\n` +
          `Ideal ${dirWord.toLowerCase()} zone ${fmtPx(zone.low)} – ${fmtPx(zone.high)} · spot ${fmtPx(spot)} · strength ${zone.strength}/5.\n` +
          `Sources: ${zone.sources.join(", ")}. Data: ${feed.source}.`
      })
      engine.states[assetId] = {
        phase: "alerted",
        since: Date.now(),
        zoneAnchor: zone.anchor,
        direction: c.direction,
        confidence: c.confidence
      }
      return `${assetId}: PRE_TRADE alerted (${dirWord}, ${distanceAtr.toFixed(2)} ATR from anchor)`
    }
    return `${assetId}: warming (${distanceAtr.toFixed(2)} ATR from zone)`
  }

  // ALERTED → watch for outcome inside the window.
  const touched =
    (st.direction === "up" && spot <= Number(st.zoneAnchor)) ||
    (st.direction === "down" && spot >= Number(st.zoneAnchor))
  if (touched) {
    await dispatchAlert({
      kind: "FOLLOW_UP",
      assetId,
      title: `✅ ${assetId} — level reached`,
      body: `Price hit the ${st.direction === "up" ? "buy" : "sell"} zone anchor ${fmtPx(st.zoneAnchor)} (spot ${fmtPx(spot)}). Window idea resolved in your favor — act on your platform if you choose.`
    })
    engine.states[assetId] = { phase: "idle" }
    return `${assetId}: follow-up level-reached`
  }
  if (Date.now() - st.since > prefs.windowMinutes * 60_000) {
    await dispatchAlert({
      kind: "FOLLOW_UP",
      assetId,
      title: `⏱ ${assetId} — window expired`,
      body: `The ${st.direction.toUpperCase()} window around ${fmtPx(st.zoneAnchor)} closed without a touch (spot ${fmtPx(spot)}).`
    })
    engine.states[assetId] = { phase: "idle" }
    return `${assetId}: follow-up expired`
  }
  return `${assetId}: watching (alerted)`
}

async function runOnce() {
  const started = Date.now()
  try {
    const config = await getAutopilotConfig()
    const targets = (await import("./autopilot.mjs")).enabledAssetTargets(config)
    if (!targets.length) {
      engine.lastRun = { at: new Date().toISOString(), ms: Date.now() - started, notes: ["no assets in scope"] }
      return
    }
    const notes = []
    for (const t of targets) {
      try {
        notes.push(await evaluateAsset(t.assetId))
      } catch (err) {
        notes.push(`${t.assetId}: evaluation failed — ${err.message}`)
      }
    }
    engine.lastRun = { at: new Date().toISOString(), ms: Date.now() - started, notes }
  } catch (err) {
    engine.lastRun = { at: new Date().toISOString(), ms: Date.now() - started, error: err.message }
  }
}

/** Start the cadence. Env kill-switch: PICC_SIGNAL_ENGINE=0. */
export function startSignalEngine() {
  if (engine.timer) return signalEngineStatus()
  if (process.env.PICC_SIGNAL_ENGINE === "0") {
    console.log("[picc-signals] disabled via PICC_SIGNAL_ENGINE=0")
    return signalEngineStatus()
  }
  console.log("[picc-signals] Signal Engine started — advisory-only monitoring")
  engine.timer = setInterval(() => {
    void runOnce().catch((err) => console.warn("[picc-signals] run failed:", err.message))
  }, CHECK_INTERVAL_MS)
  void runOnce().catch(() => {})
  return signalEngineStatus()
}

export function stopSignalEngine() {
  if (engine.timer) clearInterval(engine.timer)
  engine.timer = null
  return signalEngineStatus()
}
