import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Convergence alert bridge (spec 8b): fired `convergence_above` notifications
// must reach the notifier as kind:"convergence" dispatches (skipped-vs-sent
// honesty lives in notifier.test.mjs — the notifier itself is mocked here).
// The alert store is redirected to a tmp dir so parallel test workers never
// race over the real alerts.json.
vi.mock("../services/notifier.mjs", () => ({
  dispatchAlert: vi.fn(async (payload) => ({ ok: true, kind: payload.kind, assetId: payload.assetId, title: payload.title }))
}))

let tmp
let engine
let notifier
let bridge
let createAlert, deleteAlert, evaluateAlerts, updateConvergence, updatePrice

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-convalert-"))
  process.env.PICC_ALERTS_DATA_DIR = tmp
  engine = await import("../services/alertEngine.mjs")
  notifier = await import("../services/notifier.mjs")
  bridge = await import("../services/convergenceAlerts.mjs")
  ;({ createAlert, deleteAlert, evaluateAlerts, updateConvergence, updatePrice } = engine)
})

afterAll(async () => {
  delete process.env.PICC_ALERTS_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

let created = []
let off = null

afterEach(() => {
  for (const id of created) deleteAlert(id)
  created = []
  if (off) bridge.stopConvergenceAlerts()
  off = null
  vi.mocked(notifier.dispatchAlert).mockClear()
})

describe("convergence alert bridge (8b)", () => {
  it("dispatches a convergence_above notification as kind:'convergence'", async () => {
    bridge.startConvergenceAlerts()
    const a = createAlert({ symbol: "EURUSD", condition: "convergence_above", value: 3, band: ["LONG BIAS"] })
    created.push(a.id)
    updateConvergence("EURUSD", { score5: 4, state: "LONG BIAS", confidence: 80 })
    evaluateAlerts()
    await new Promise((r) => setTimeout(r, 0)) // let the async dispatch run
    expect(notifier.dispatchAlert).toHaveBeenCalledTimes(1)
    const call = vi.mocked(notifier.dispatchAlert).mock.calls[0][0]
    expect(call.kind).toBe("convergence")
    expect(call.assetId).toBe("EURUSD")
    expect(call.title).toContain("LONG BIAS")
    expect(call.title).toContain("4/5")
    expect(call.body).toContain("threshold 3/5")
    expect(call.details).toMatchObject({ condition: "convergence_above", score5: 4, state: "LONG BIAS" })
  })

  it("ignores non-convergence notifications entirely", async () => {
    bridge.startConvergenceAlerts()
    const px = createAlert({ symbol: "EURUSD", condition: "price_above", value: 1.09 })
    created.push(px.id)
    updatePrice("EURUSD", 1.095)
    evaluateAlerts()
    await new Promise((r) => setTimeout(r, 0))
    expect(notifier.dispatchAlert).not.toHaveBeenCalled()
  })

  it("start is idempotent and stop unsubscribes", async () => {
    const dup = bridge.startConvergenceAlerts()
    const a = createAlert({ symbol: "EURUSD", condition: "convergence_above", value: 1 })
    created.push(a.id)
    updateConvergence("EURUSD", { score5: 2, state: "WATCH" })
    evaluateAlerts()
    await new Promise((r) => setTimeout(r, 0))
    expect(notifier.dispatchAlert).toHaveBeenCalledTimes(1) // idempotent start → one listener
    dup() // stop
    updateConvergence("EURUSD", { score5: 5, state: "LONG BIAS" })
    evaluateAlerts()
    await new Promise((r) => setTimeout(r, 0))
    expect(notifier.dispatchAlert).toHaveBeenCalledTimes(1) // no second dispatch
  })
})