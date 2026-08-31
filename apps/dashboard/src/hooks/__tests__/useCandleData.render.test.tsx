// @vitest-environment jsdom
// Repro + regression guard for the /suites "Maximum update depth exceeded" render
// loop. Mounts the REAL MarketsSuite (the whole `/suites` trading surface) with
// a flapping realtime stream + repeated snapshot pushes — the exact conditions
// present when EO is down (reconnect ~2s) — and asserts React never throws the
// update-depth error.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { Component, type ReactNode, useEffect, useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

// Non-loop render errors (from undershaped polling-panel stubs) are captured
// here rather than surfacing as unhandled — the harness's sole assertion is the
// React update-depth loop, everything else is documented stub noise.
export const renderErrors: string[] = []
export class ErrorCapture extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(e: unknown) {
    renderErrors.push(String((e as Error)?.message ?? e).slice(0, 90))
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    renderErrors.push(String((e as Error)?.message ?? e).slice(0, 90))
  }
  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

// Faked shared suite data + a flapping stream error, like the real EO reconnect.
const state = {
  error: null as string | null,
  snapshot: null as unknown | null,
  flappers: new Set<() => void>(),
  snapListeners: new Set<(s: unknown) => void>()
}
let started = false
function startLoop() {
  if (started) return
  started = true
  const base = Date.now() + 5_000_000 // future-ish server clock so snapshot.ts > lastLoadAt
  let snapTs = base
  setInterval(() => {
    // flap error (reconnect)
    state.error = state.error ? null : "stream failed — reconnecting"
    for (const f of state.flappers) f()
    // every other tick, push a fresh snapshot (new object identity + new ts)
    snapTs += 1000
    state.snapshot = {
      ts: snapTs,
      trading: { paper: { simulatedBalance: 1000, equity: 1000, positions: 0 }, riskPerTradePct: 2 },
      live: { watched: ["EURUSD", "GBPUSD"], account: null },
      demo: null,
      analytics: null,
      deals: null
    }
    for (const l of state.snapListeners) l(state.snapshot)
  }, 90)
}

vi.mock("@/lib/auth", () => ({ getToken: () => "" }))

vi.mock("@/hooks/useRealtimeSuite", () => {
  const useRealtimeSuite = (onEvent?: (e: { type: string; snapshot?: unknown; stats?: unknown }) => void) => {
    const [snapshot, setSnapshot] = useState<unknown>(state.snapshot)
    const [error, setError] = useState<string | null>(state.error)
    useEffect(() => {
      const f = () => setError(state.error)
      const l = (s: unknown) => { setSnapshot(s); onEvent?.({ type: "snapshot", snapshot: s }) }
      state.flappers.add(f)
      state.snapListeners.add(l)
      return () => { state.flappers.delete(f); state.snapListeners.delete(l) }
    }, [onEvent])
    return { snapshot, live: null, connected: true, error }
  }
  const subscribeTicks = () => () => {}
  return { useRealtimeSuite, subscribeTicks }
})

vi.mock("@/components/CandlestickChart", () => ({
  CandlestickChart: () => <div data-testid="chart" />,
  ColorType: "Solid",
  createChart: vi.fn(),
  createSeriesMarkers: vi.fn(),
  CandlestickSeries: "candlestick",
  HistogramSeries: "hist",
  LineSeries: "line",
  default: null
}))

import { MarketsSuite } from "@/components/TradingSuite"

vi.stubGlobal("confirm", () => true)

describe("MarketsSuite — no 'Maximum update depth exceeded' (realtime + reconnect guard)", () => {
  beforeEach(() => {
    state.error = null
    state.snapshot = null
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
      // Realistic per-endpoint shapes (the panels render real data paths, so an
      // undershaped stub only hides the very crashes we want to catch).
      if (/portfolio\/aggregate/.test(u)) {
        return json({ ok: true, totals: { openPositions: 0, notional: 0, instruments: 0 } })
      }
      if (/trading\/candles/.test(u)) {
        return json({ ok: true, source: "none", candles: [], requestedTimeframe: 60, timeframe: 60, resolved: false })
      }
      if (/brokers/.test(u)) return json({ ok: true, brokers: [], latency: [] })
      // Honest "no data": panels that poll other endpoints render their empty /
      // unavailable state (mirroring a live page where a source returns non-ok)
      // instead of crashing on fields we did not stub.
      return json({ ok: false, error: "no data (stubbed)" })
    }))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it("sustained realtime + reconnect does not exceed update depth", async () => {
    let loopFired = 0
    const soaked: string[] = []
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const m = args.map(String).join(" ")
      if (/Maximum update depth exceeded/.test(m)) loopFired++
      else soaked.push(m.slice(0, 90))
    })

    startLoop()
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    flushSync(() => {
      root.render(
        <ErrorCapture>
          <MarketsSuite />
        </ErrorCapture>
      )
    })

    await new Promise((r) => setTimeout(r, 400))
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)

    // eslint-disable-next-line no-console
    if (soaked.length <= 3) console.log("non-loop react warnings:", [...soaked, ...renderErrors].slice(0, 8))
    expect(loopFired, "React 'Maximum update depth exceeded' must not fire").toBe(0)
  })
})
