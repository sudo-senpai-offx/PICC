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