import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tmp
let engine

let createAlert, deleteAlert, evaluateAlerts, getAlertHistory, listAlerts, updateConvergence, updatePrice, getConvergence

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-alertengine-"))
  process.env.PICC_ALERTS_DATA_DIR = tmp
  engine = await import("../services/alertEngine.mjs")
  ;({ createAlert, deleteAlert, evaluateAlerts, getAlertHistory, listAlerts, updateConvergence, updatePrice, getConvergence } = engine)
})

afterAll(async () => {
  delete process.env.PICC_ALERTS_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

// convergence_above alert condition (spec 8a): fires when the asset's MTF
// convergence score (5-scale) crosses the threshold OR its engine state lands
// in a configured band; stays silent below the threshold and whenever no
// convergence read exists (R10 — an absent read is not a zero). Timer-free:
// assertions drive evaluateAlerts() directly.

let created = []

function makeAlert(opts) {
  const a = createAlert({ symbol: "EURUSD", condition: "convergence_above", value: 3, ...opts })
  created.push(a.id)
  return a
}

afterEach(() => {
  for (const id of created) deleteAlert(id)
  created = []
})

describe("convergence_above condition (8a)", () => {
  it("fires when the 5-scale score crosses the threshold", () => {
    makeAlert({ value: 3 })
    updateConvergence("EURUSD", { score5: 2, state: "WATCH", confidence: 55 })
    evaluateAlerts()
    expect(listAlerts()[0].status).toBe("armed") // still below — silent

    updateConvergence("EURUSD", { score5: 3, state: "LONG ONLY", confidence: 60 })
    evaluateAlerts()
    const a = listAlerts()[0]
    expect(a.status).toBe("triggered")
    expect(a.lastScore).toBe(3)

    const n = getAlertHistory({ symbol: "EURUSD", limit: 5 })[0]
    expect(n.condition).toBe("convergence_above")
    expect(n.score5).toBe(3)
    expect(n.state).toBe("LONG ONLY")
  })

  it("fires when the engine state lands in the configured band even below the score threshold", () => {
    makeAlert({ value: 5, band: ["LONG BIAS", "SHORT BIAS"] })
    // Below the 5/5 score but in-band -> fires
    updateConvergence("EURUSD", { score5: 4, state: "LONG BIAS", confidence: 80 })
    evaluateAlerts()
    expect(listAlerts()[0].status).toBe("triggered")
    // In-band on the short side too
    const a2 = createAlert({ symbol: "GBPUSD", condition: "convergence_above", value: 5, band: ["SHORT BIAS"] })
    created.push(a2.id)
    updateConvergence("GBPUSD", { score5: 4, state: "SHORT BIAS" })
    evaluateAlerts()
    const gbp = listAlerts().find((a) => a.id === a2.id)
    expect(gbp.status).toBe("triggered")
  })

  it("stays silent below threshold and outside the band", () => {
    makeAlert({ value: 4, band: ["LONG BIAS"] })
    updateConvergence("EURUSD", { score5: 3, state: "LONG WATCH", confidence: 50 })
    evaluateAlerts()
    expect(listAlerts()[0].status).toBe("armed")
  })

  it("an absent convergence read never triggers (R10)", () => {
    makeAlert({ value: 1 })
    updateConvergence("EURUSD", { score5: null, state: null }) // no read yet
    evaluateAlerts()
    expect(listAlerts()[0].status).toBe("armed")
    expect(getConvergence("EURUSD")).toMatchObject({ score5: null, state: null })
  })

  it("recurring convergence alerts re-arm and fire again on the next pass", () => {
    // NZDUSD keeps history isolation from the EURUSD/GBPUSD tests above.
    const a = createAlert({ symbol: "NZDUSD", condition: "convergence_above", value: 3, recurring: true })
    created.push(a.id)
    updateConvergence("NZDUSD", { score5: 4, state: "LONG BIAS" })
    evaluateAlerts()
    evaluateAlerts()
    expect(listAlerts().find((x) => x.id === a.id).status).toBe("armed") // keep firing while >= 3
    const hist = getAlertHistory({ symbol: "NZDUSD" }).filter((n) => n.condition === "convergence_above")
    expect(hist.length).toBe(2)
  })

  it("price conditions keep working unchanged (regression guard)", () => {
    const a = createAlert({ symbol: "EURUSD", condition: "price_above", value: 1.09 })
    created.push(a.id)
    updatePrice("EURUSD", 1.085)
    evaluateAlerts()
    expect(listAlerts().find((x) => x.id === a.id).status).toBe("armed")
    updatePrice("EURUSD", 1.092)
    evaluateAlerts()
    expect(listAlerts().find((x) => x.id === a.id).status).toBe("triggered")
  })
})

// T9 — multi-condition compose (AND/OR over the same enum). Fresh symbols keep
// the isolated tests above untouched; absent reads NEVER count as a fire.

describe("composed conditions (T9)", () => {
  it("AND fires only when every condition matches", () => {
    const a = createAlert({
      symbol: "AUDUSD",
      condition: "price_above",
      value: 1.09,
      conditions: [
        { condition: "price_above", value: 1.09 },
        { condition: "price_below", value: 1.12 }
      ],
      logic: "AND"
    })
    created.push(a.id)
    updatePrice("AUDUSD", 1.125) // above ✓, below ✗
    evaluateAlerts()
    expect(listAlerts().find((x) => x.id === a.id).status).toBe("armed")

    updatePrice("AUDUSD", 1.095) // above ✓, below ✓
    evaluateAlerts()
    const fired = listAlerts().find((x) => x.id === a.id)
    expect(fired.status).toBe("triggered")
    expect(fired.logic).toBe("AND")
    const n = getAlertHistory({ symbol: "AUDUSD", limit: 5 }).find((h) => h.alertId === a.id)
    expect(n.conditions).toHaveLength(2)
    expect(n.logic).toBe("AND")
  })

  it("OR fires when any condition matches", () => {
    const a = createAlert({
      symbol: "USDCAD",
      condition: "price_above",
      value: 1.09,
      conditions: [
        { condition: "price_above", value: 1.09 },
        { condition: "price_below", value: 1.08 }
      ],
      logic: "OR"
    })
    created.push(a.id)
    updatePrice("USDCAD", 1.085) // neither side
    evaluateAlerts()
    expect(listAlerts().find((x) => x.id === a.id).status).toBe("armed")

    updatePrice("USDCAD", 1.095) // above side wins
    evaluateAlerts()
    expect(listAlerts().find((x) => x.id === a.id).status).toBe("triggered")

    const a2 = createAlert({
      symbol: "USDCHF",
      condition: "price_above",
      value: 1.09,
      conditions: [{ condition: "price_below", value: 1.08 }],
      logic: "OR"
    })
    created.push(a2.id)
    updatePrice("USDCHF", 1.075) // below side wins
    evaluateAlerts()
    expect(listAlerts().find((x) => x.id === a2.id).status).toBe("triggered")
  })

  it("respects the convergence band inside a composed condition", () => {
    const a = createAlert({
      symbol: "NZDUSD",
      condition: "convergence_above",
      value: 5,
      conditions: [
        { condition: "convergence_above", value: 5, band: ["LONG BIAS"] },
        { condition: "price_below", value: 1.5 }
      ],
      logic: "AND"
    })
    created.push(a.id)
    updateConvergence("NZDUSD", { score5: 4, state: "LONG BIAS", confidence: 70 })
    updatePrice("NZDUSD", 1.45) // in band (4 < 5 but band hit) ✓ AND below ✓
    evaluateAlerts()
    expect(listAlerts().find((x) => x.id === a.id).status).toBe("triggered")
  })

  it("absent data never fires a composed alert (R10 extended)", () => {
    const a = createAlert({
      symbol: "GBPJPY",
      condition: "price_above",
      value: 190,
      conditions: [{ condition: "price_above", value: 190 }, { condition: "convergence_above", value: 1 }],
      logic: "AND"
    })
    created.push(a.id)
    // No price, no convergence read at all
    evaluateAlerts()
    expect(listAlerts().find((x) => x.id === a.id).status).toBe("armed")
  })

  it("malformed composed conditions are dropped at creation (never half-evaluated)", () => {
    const a = createAlert({
      symbol: "USDCAD",
      condition: "price_above",
      value: 1.09,
      conditions: [
        { condition: "not_a_real_condition", value: 1 },
        { condition: "price_above", value: null },
        { condition: "price_below", value: 1.08 }
      ],
      logic: "AND"
    })
    created.push(a.id)
    // Only the usable condition survives; two malformed entries dropped.
    expect(a.conditions).toHaveLength(1)
    expect(a.conditions[0].condition).toBe("price_below")
  })
})