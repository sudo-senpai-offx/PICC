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
  // The sensor tunnels ALL network I/O through the background worker
  // (T11 finding 2026-08-29: content-script fetches to http://localhost die on
  // CORS + mixed content from https broker pages). The harness therefore
  // mocks chrome.runtime.sendMessage — the worker's probe answers and the
  // relay-flush POST results are resolved here, not via page fetch().
  const pendingMessages = []
  const state = {
    storageSetCalls: 0,
    storageGetCalls: 0,
    setImpl: () => undefined,
    getImpl: (keys, cb) => cb({}),
    relayFlushCalls: []
  }

  const windowObj = {
    addEventListener(type, cb) { listeners.set(type, cb) },
    removeEventListener(type) { listeners.delete(type) }
  }
  const chrome = {
    runtime: {
      id: "picc-test-id",
      sendMessage: (msg) => {
        if (msg?.action === "relay-flush") state.relayFlushCalls.push(msg.frames ?? [])
        return new Promise((resolve, reject) => pendingMessages.push({ resolve, reject, msg }))
      },
      onMessage: { addListener: (fn) => { state.onMessageListener = fn } }
    },
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
    pendingMessages,
    // Resolve every in-flight sendMessage with the worker's probe answer,
    // e.g. { online: true, port: 5173 } or { online: false, port: null }.
    async settleMessages(shape) {
      while (pendingMessages.length) {
        const batch = pendingMessages.splice(0, pendingMessages.length)
        for (const p of batch) p.resolve(shape)
        await new Promise((r) => setTimeout(r, 0))
      }
      await new Promise((r) => setTimeout(r, 0))
    },
    async runCheckTick() {
      const tick = intervalCallbacks[0] // the 15 s probeServer interval
      const p = tick()
      await this.settleMessages({ online: false, port: null })
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
    await h.settleMessages({ online: true, port: 5173 })
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
    await h.settleMessages({ online: true, port: 5173 })
    expect(h.state.storageSetCalls).toBe(1)
    expect(h.window.__PICC_SENSOR_DEAD__).toBe(true)
    expect(h.clearedIntervals).toEqual([1, 2])
  })

  it("pre-check path: chrome.runtime.id gone ⇒ immediate teardown, zero writes", async () => {
    const h = makeHarness()
    h.chrome.runtime = {} // invalidation is observable as a missing runtime.id
    await h.settleMessages({ online: true, port: 5173 })
    expect(h.state.storageSetCalls).toBe(0)
    expect(h.window.__PICC_SENSOR_DEAD__).toBe(true)
  })

  it("kill-switch gate still reads storage through the guard; a dead listener never queues", async () => {
    const h = makeHarness()
    h.state.getImpl = (keys, cb) => cb({ piccRelayEnabled: true })
    await h.settleMessages({ online: true, port: 5173 })
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

  it("relay-flush tunnels cleared batches to the worker and surfaces relay activity", async () => {
    const h = makeHarness()
    h.state.getImpl = (keys, cb) => cb({ piccRelayEnabled: true })
    await h.settleMessages({ online: true, port: 5173 })
    expect(h.state.storageSetCalls).toBe(1)

    let lastStatusWrite = null
    h.state.setImpl = (entry) => { lastStatusWrite = entry.piccSensorStatus }

    h.dispatchBrokerFrame({ action: "candle", message: { assetId: "BTC", candles: [{ t: 1, tf: 60, v: [1, 2, 3] }] } })
    // the 30 s heartbeat interval calls flush() → the sensor hands the batch to
    // the WORKER via relay-flush (never a page-context fetch — CORS/mixed
    // content would kill it on https broker pages)
    h.intervalCallbacks[1]()
    await h.settleMessages({ ok: true }) // the worker's POST result
    expect(h.state.relayFlushCalls.length).toBe(1)
    expect(h.state.relayFlushCalls[0][0].message.assetId).toBe("BTC")

    // the next status write reports relay ACTIVITY (frames relayed, last frame),
    // so the popup can say "online :port" only when frames actually flow
    await h.runCheckTick()
    expect(h.state.storageSetCalls).toBe(2)
    expect(lastStatusWrite.relayedCount).toBe(1)
    expect(typeof lastStatusWrite.lastRelayAt).toBe("number")
    expect(lastStatusWrite.online).toBe(false) // probe answered offline this tick
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

  it("round-trip: sensor-queue-depth answers observed:true with the live queue length", async () => {
    const h = makeHarness()
    await h.settleMessages({ online: true, port: 5173 })

    let response = null
    const listener = h.state.onMessageListener
    expect(typeof listener).toBe("function")
    const handedBack = listener({ action: "sensor-queue-depth" }, {}, (r) => { response = r })
    expect(handedBack).toBe(false) // synchronous reply: port closed
    expect(response).toEqual({ action: "sensor-queue-depth", depth: 0, observed: true })

    // push one real broker-shaped frame, then re-read: the observed depth is 1
    h.state.getImpl = (keys, cb) => cb({ piccRelayEnabled: true })
    h.dispatchBrokerFrame({ action: "candle", message: { assetId: "BTC", candles: [{ t: 1, tf: 60, v: [1, 2, 3] }] } })
    response = null
    listener({ action: "sensor-queue-depth" }, {}, (r) => { response = r })
    expect(response.depth).toBe(1)
  })

  it("non-queue-depth messages are not answered by the sensor (silent)", async () => {
    const h = makeHarness()
    let responded = false
    const ret = h.state.onMessageListener({ action: "server-status" }, {}, () => { responded = true })
    expect(ret).toBe(false)
    expect(responded).toBe(false)
  })
})