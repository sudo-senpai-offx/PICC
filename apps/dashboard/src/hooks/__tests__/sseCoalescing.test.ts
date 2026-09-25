// T8 — SSE coalescing: the shared realtime tick bus.
//
// N charts must open exactly ONE /api/trading/realtime fetch (the suite stream
// manager), ticks must route per assetId, and the connection must close only
// when the LAST consumer (suite or tick) unsubscribes. The transport is
// streamLiveTrading() → global fetch, so we stub fetch with a controllable SSE
// body and observe: fetch call count, per-subscriber delivery, and the abort
// signal on the last unsubscribe.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import type { LiveTick } from "../../lib/liveTrading"

function tickEvent(a: string, price: number, ts = 1_700_000_000): string {
  return `event: tick\ndata: ${JSON.stringify({ assetId: a, price, ts })}\n\n`
}

let fetchCount = 0
let aborted = false
let controllers: ReadableStreamDefaultController<Uint8Array>[] = []

function stubSseFetch() {
  fetchCount = 0
  aborted = false
  controllers = []
  vi.stubGlobal("fetch", vi.fn((_url: unknown, opts?: { signal?: AbortSignal }) => {
    fetchCount += 1
    opts?.signal?.addEventListener("abort", () => { aborted = true })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllers.push(controller)
      },
      cancel() { /* transport hung up — nothing to do */ }
    })
    return Promise.resolve(new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }))
  }))
}

async function flush() {
  await vi.waitFor(() => { expect(controllers.length).toBeGreaterThan(0) }, { timeout: 1000 })
  await new Promise((r) => setTimeout(r, 10)) // let the reader drain enqueued chunks
}

async function freshBus() {
  delete (globalThis as unknown as Record<string, unknown>).__picc_suite_stream
  vi.resetModules()
  const mod = await import("../useRealtimeSuite")
  return mod as typeof import("../useRealtimeSuite")
}

beforeEach(() => {
  stubSseFetch()
})

describe("shared realtime tick bus", () => {
  it("opens exactly ONE fetch for two charts on different assets", async () => {
    const { subscribeTicks } = await freshBus()
    const btc = vi.fn()
    const eur = vi.fn()
    const off1 = subscribeTicks("BTCUSD", btc)
    const off2 = subscribeTicks("EURUSD", eur)
    expect(fetchCount).toBe(1) // two charts → one /api/trading/realtime fetch

    controllers[0].enqueue(new TextEncoder().encode(tickEvent("BTCUSD", 1.2)))
    controllers[0].enqueue(new TextEncoder().encode(tickEvent("EURUSD", 1.09)))
    await flush()
    expect(btc).toHaveBeenCalledWith(expect.objectContaining({ assetId: "BTCUSD", price: 1.2 }))
    expect(eur).toHaveBeenCalledWith(expect.objectContaining({ assetId: "EURUSD", price: 1.09 }))

    off1()
    off2()
    expect(aborted).toBe(true) // last consumer left → connection closed
  })

  it("routes ticks to the matching assetId subscriber only", async () => {
    const { subscribeTicks } = await freshBus()
    const btc = vi.fn()
    const eur = vi.fn()
    const off = subscribeTicks("BTCUSD", btc)
    subscribeTicks("EURUSD", eur)

    controllers[0].enqueue(new TextEncoder().encode(tickEvent("BTCUSD", 64000)))
    controllers[0].enqueue(new TextEncoder().encode(tickEvent("NOPE", 1))) // not subscribed
    await flush()
    expect(btc).toHaveBeenCalledTimes(1)
    expect(eur).toHaveBeenCalledTimes(0)

    off()
    // EURUSD still subscribed → stream stays open (refcount > 0).
    expect(aborted).toBe(false)
  })

  it("closes the stream only after the LAST subscriber of either kind leaves", async () => {
    const { subscribeTicks } = await freshBus()
    const off1 = subscribeTicks("BTCUSD", vi.fn())
    const off2 = subscribeTicks("BTCUSD", vi.fn()) // second chart, same asset
    expect(fetchCount).toBe(1)

    off1()
    expect(aborted).toBe(false) // one chart still listening

    off2()
    expect(aborted).toBe(true)
  })

  it("delivers the full LiveTick payload through the bus", async () => {
    const { subscribeTicks } = await freshBus()
    const cb = vi.fn()
    const off = subscribeTicks("BTCUSD", cb)
    controllers[0].enqueue(new TextEncoder().encode(tickEvent("BTCUSD", 5)))
    await flush()
    expect(cb).toHaveBeenCalled()
    expect((cb.mock.calls[0][0] as LiveTick).ts).toBe(1_700_000_000)
    off()
  })
})

/**
 * WS-6 T0 — process-wide singleton invariant (characterisation).
 *
 * The tests above all call `freshBus()`, which DELETES
 * `globalThis.__picc_suite_stream` and re-imports the module. That proves the
 * bus coalesces in isolation, but it does NOT prove the invariant WS-6 must
 * preserve: that the module installs exactly one manager per process and that
 * repeated module evaluation reuses it. T12 pins "single realtime
 * subscription" against this, so it is frozen here.
 *
 * Freeze of current behaviour — expected to pass with no production change.
 */
describe("WS-6 T0 — the suite stream manager is a process-wide singleton", () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__picc_suite_stream
  })

  it("installs the manager on globalThis under the pinned key", async () => {
    delete (globalThis as unknown as Record<string, unknown>).__picc_suite_stream
    vi.resetModules()
    await import("../useRealtimeSuite")
    const g = globalThis as unknown as Record<string, unknown>
    expect(g.__picc_suite_stream).toBeDefined()
    expect(typeof g.__picc_suite_stream).toBe("object")
  })

  it("reuses the SAME manager instance across repeated imports", async () => {
    delete (globalThis as unknown as Record<string, unknown>).__picc_suite_stream
    vi.resetModules()
    await import("../useRealtimeSuite")
    const first = (globalThis as unknown as Record<string, unknown>).__picc_suite_stream
    vi.resetModules()
    await import("../useRealtimeSuite")
    const second = (globalThis as unknown as Record<string, unknown>).__picc_suite_stream
    expect(second).toBe(first)
  })

  it("does not open a second transport when a second consumer subscribes", async () => {
    const { subscribeTicks } = await freshBus()
    const g = globalThis as unknown as Record<string, unknown>
    const managerAtFirstSubscribe = g.__picc_suite_stream

    const offA = subscribeTicks("BTCUSD", vi.fn())
    await flush()
    const afterFirst = fetchCount
    expect(afterFirst).toBe(1)

    // A different asset, and a second listener on the SAME asset.
    const offB = subscribeTicks("EURUSD", vi.fn())
    const offC = subscribeTicks("BTCUSD", vi.fn())
    await flush()

    expect(fetchCount, "extra consumers must not open another transport").toBe(afterFirst)
    expect(g.__picc_suite_stream).toBe(managerAtFirstSubscribe)

    offA(); offB(); offC()
  })
})