// T2 — content.js context-lifecycle guard. Loads the REAL sensor source into a
// vm sandbox with a chrome mock that reproduces "Extension context invalidated."
// (the exact error the user saw on http://localhost:5173/suites) and asserts the
// dead context tears itself down silently: no escaping rejection, intervals
// cleared, listener removed, later ticks no-op.
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../extensions/picc-overlay")
const SOURCE = readFileSync(join(EXT_DIR, "content.js"), "utf8")

const INVALIDATED = () => new Error("Extension context invalidated.")

function makeHarness() {
  const listeners = new Map()
  const intervalCallbacks = []
  const clearedIntervals = []
  const consoleCalls = { error: [], info: [], log: [] }
  const pendingFetches = []
  const state = {
    storageSetCalls: 0,
    storageGetCalls: 0,
    setImpl: () => undefined,
    getImpl: (keys, cb) => cb({})
  }

  const windowObj = {
    addEventListener(type, cb) { listeners.set(type, cb) },
    removeEventListener(type) { listeners.delete(type) }
  }
  const chrome = {
    runtime: { id: "picc-test-id" },
    storage: {
      local: {
        set: (entry) => { state.storageSetCalls += 1; return state.setImpl(entry) },
        get: (keys, cb) => { state.storageGetCalls += 1; return state.getImpl(keys, cb) }
      }
    }
  }

  const context = vm.createContext({
    window: windowObj,
    chrome,
    fetch: () => new Promise((resolve, reject) => pendingFetches.push({ resolve, reject })),
    AbortController: globalThis.AbortController,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn) => { intervalCallbacks.push(fn); return intervalCallbacks.length },
    clearInterval: (id) => clearedIntervals.push(id),
    console: {
      log: (...a) => consoleCalls.log.push(a),
      info: (...a) => consoleCalls.info.push(a),
      error: (...a) => consoleCalls.error.push(a)
    },
    Date: globalThis.Date
  })
  vm.runInContext(SOURCE, context)

  return {
    window: windowObj,
    chrome,
    state,
    consoleCalls,
    intervalCallbacks,
    clearedIntervals,
    listeners,
    pendingFetches,
    async settleFetches(shape) {
      while (pendingFetches.length) {
        const batch = pendingFetches.splice(0, pendingFetches.length)
        for (const p of batch) p.resolve(shape)
        await new Promise((r) => setTimeout(r, 0))
      }
      await new Promise((r) => setTimeout(r, 0))
    },
    async runCheckTick() {
      const tick = intervalCallbacks[0] // the 15 s checkServer interval
      const p = tick()
      await this.settleFetches({ ok: false })
      await p
      await new Promise((r) => setTimeout(r, 0))
    },
    dispatchBrokerFrame(frame) {
      const cb = listeners.get("message")
      cb?.({ source: windowObj, data: { __piccEOFrame: true, frame } })
    }
  }
}

describe("sensor content.js context lifecycle (T2)", () => {
  it("sync chrome throw: silences the reported crash, tears down, later ticks no-op", async () => {
    const h = makeHarness()
    expect(h.state.storageSetCalls).toBe(0)

    // boot round: server found → the "online" write succeeds
    await h.settleFetches({ ok: true })
    expect(h.state.storageSetCalls).toBe(1)

    // next 15 s tick: server gone; mid-round Chrome invalidates the context
    // so the offline write throws the exact reported error
    h.state.setImpl = () => { throw INVALIDATED() }
    await h.runCheckTick()
    expect(h.state.storageSetCalls).toBe(2) // the throw happened INSIDE the write
    expect(h.window.__PICC_SENSOR_DEAD__).toBe(true)
    expect(h.clearedIntervals).toContain(1) // 15 s interval
    expect(h.clearedIntervals).toContain(2) // 30 s heartbeat interval
    expect(h.listeners.has("message")).toBe(false) // listener removed
    expect(h.consoleCalls.error).toHaveLength(0) // silent teardown

    // a rogue later tick must not reach chrome again
    h.state.setImpl = () => { throw new Error("must never be reached after teardown") }
    await h.runCheckTick()
    expect(h.state.storageSetCalls).toBe(2)
  })

  it("promise-rejection path (async chrome APIs) also tears down silently", async () => {
    const h = makeHarness()
    h.state.setImpl = () => Promise.reject(INVALIDATED())
    await h.settleFetches({ ok: true })
    expect(h.state.storageSetCalls).toBe(1)
    expect(h.window.__PICC_SENSOR_DEAD__).toBe(true)
    expect(h.clearedIntervals).toEqual([1, 2])
  })

  it("pre-check path: chrome.runtime.id gone ⇒ immediate teardown, zero writes", async () => {
    const h = makeHarness()
    h.chrome.runtime = {} // invalidation is observable as a missing runtime.id
    await h.settleFetches({ ok: true })
    expect(h.state.storageSetCalls).toBe(0)
    expect(h.window.__PICC_SENSOR_DEAD__).toBe(true)
  })

  it("kill-switch gate still reads storage through the guard; a dead listener never queues", async () => {
    const h = makeHarness()
    h.state.getImpl = (keys, cb) => cb({ piccRelayEnabled: true })
    await h.settleFetches({ ok: true })
    expect(h.state.storageSetCalls).toBe(1)

    // a real broker-shaped frame routes through the guarded get
    h.dispatchBrokerFrame({ action: "candle", message: { assetId: "BTC", candles: [{ t: 1, tf: 60, v: [1, 2, 3] }] } })
    expect(h.state.storageGetCalls).toBe(1)

    // invalidate, then a trapped postMessage arrives after teardown
    h.state.setImpl = () => { throw INVALIDATED() }
    await h.runCheckTick()
    expect(h.window.__PICC_SENSOR_DEAD__).toBe(true)
    h.dispatchBrokerFrame({ action: "candle", message: { assetId: "BTC" } })
    expect(h.state.storageGetCalls).toBe(1) // listener gone: nothing queued
  })

  it("static: content.js touches chrome.* only inside the guarded accessor", () => {
    const tokens = new Set([...SOURCE.matchAll(/chrome\.\w+/g)].map((m) => m[0]))
    for (const t of tokens) {
      expect(["chrome.storage", "chrome.runtime"].includes(t), `unexpected chrome token: ${t}`).toBe(true)
    }
    // the only chrome.* call sites are the two accessor lines
    const storageCalls = SOURCE.match(/chrome\.storage\.local\.(set|get)/g) ?? []
    expect(storageCalls).toEqual(["chrome.storage.local.set", "chrome.storage.local.get"])
  })
})