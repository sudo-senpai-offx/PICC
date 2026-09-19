// @vitest-environment jsdom
// T10/T11 (slice 6 reskin) — TradingChart wiring integration test. The chart is
// the wired seam the pure-slice tests can't reach, so this pins the actual
// epics end-to-end against the REAL useSourcePreference hook (global fetch
// stubbed) and a mocked useCandleData:
//   • a saved preference becomes the chart's initial source (source={pref})
//   • the dropdown persists on change (POST) + re-pins (optimistic then adopt)
//   • a failed persist rolls back to last-good and surfaces a non-blocking notice
//   • the status badge never claims "EO live" (it now speaks the server's tags)
//   • the "why this source" line names the server's winner + reason
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { TradingChart } from "@/components/TradingChart"
import type { SourceCandidate } from "@/hooks/useCandleData"

// --- mocks -------------------------------------------------------------
const h = vi.hoisted(() => ({
  mockUseCandleData: vi.fn(),
  mockFetchCandles: vi.fn(),
  mockSetSource: vi.fn()
}))

vi.mock("@/lib/auth", () => ({ getToken: () => "" }))

vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({ error: null }),
  subscribeTicks: () => () => {}
}))

vi.mock("@/hooks/useBrokerCapabilities", () => ({
  useBrokerCapabilities: () => ({ servableTimeframes: [], sourceTimeframes: new Map() })
}))

vi.mock("@/lib/trading", () => ({
  getEntryLevels: vi.fn(async () => ({ ok: false, levels: [], buyZone: null, sellZone: null, reason: "no levels (stubbed)" })),
  openPaperTrade: vi.fn(async () => ({ ok: false, message: "stubbed" }))
}))

vi.mock("@/lib/u4faOverlay", () => ({ u4faMarkersFor: () => [] }))

vi.mock("@/components/CandlestickChart", () => ({
  CandlestickChart: () => <div data-testid="chart" />
}))

vi.mock("@/hooks/useCandleData", () => ({
  TIMEFRAME_LABELS: { 5: "5s", 15: "15s", 30: "30s", 60: "1m", 300: "5m", 900: "15m", 1800: "30m", 3600: "1h", 14400: "4h", 86400: "1D", 604800: "1W", 2592000: "1M" },
  fetchCandles: (...args: unknown[]) => h.mockFetchCandles(...args),
  useCandleData: (...args: unknown[]) => h.mockUseCandleData(...args)
}))

// --- per-test chart state ----------------------------------------------
const state = {
  source: "expertoption" as string | null,
  feed: null as string | null,
  stale: false,
  sourceMode: "forced" as "auto" | "forced" | "fallback" | null,
  sources: [] as SourceCandidate[],
  availableSources: [] as { slug: string; label: string; weight: number; serves: boolean }[]
}

const json = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response

const normalize = (s: unknown): string => {
  const v = String(s ?? "").trim().toLowerCase()
  return v === "auto" || v === "" ? "auto" : /^[a-z0-9-]+$/.test(v) ? v : "auto"
}

let serverPref: unknown = { ok: true, userId: "default", source: "auto" }
let serverPostOk = true

function fetchStub(url: unknown, init?: RequestInit): Promise<Response> {
  const u = String(url)
  if (u.includes("/source-preference")) {
    const method = init?.method ?? "GET"
    if (method === "GET") return Promise.resolve(json(serverPref))
    const body = JSON.parse(String(init?.body)) as { source?: unknown }
    if (!serverPostOk) return Promise.resolve(json({ error: "server reject" }, false))
    return Promise.resolve(json({ ok: true, userId: "default", source: normalize(body?.source) }))
  }
  if (u.includes("/trading/candles")) {
    return Promise.resolve(json({ ok: true, source: "none", candles: [], requestedTimeframe: 300, timeframe: 300, resolved: false, sourceMode: "auto", sources: [] }))
  }
  return Promise.resolve(json({ error: "unexpected endpoint " + u }, false))
}

function chartResult(props: { source?: string }) {
  return {
    candles: [], volumes: [], ema20: [], ema50: [], tenkan: [], kijun: [], senkouA: [], senkouB: [],
    kcUpper: [], kcMiddle: [], kcLower: [], sma20: [], bbUpper: [], bbMid: [], bbLower: [],
    rsiLine: [], macdLine: [], macdSignal: [], macdHist: [],
    loading: false, error: null, streamError: null, lastPrice: 1.2345, timeframe: 300, setTimeframe: vi.fn(),
    source: state.source, pinnedSource: props?.source ?? "auto", availableSources: state.availableSources,
    setSource: h.mockSetSource, feed: state.feed, resolvedTimeframe: null, resolved: false,
    verifySources: 0, verifiedCount: 0, verifiedRatio: 0,
    stale: state.stale, sourceMode: state.sourceMode, sources: state.sources
  }
}

function mountChart() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<TradingChart assetId="EURUSD" />) })
  return {
    host,
    text: () => host.textContent ?? "",
    async settle() {
      await new Promise((r) => setTimeout(r, 0))
      flushSync(() => {})
    },
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

describe("TradingChart × useSourcePreference (T10/T11 wiring)", () => {
  beforeEach(() => {
    Object.assign(state, {
      source: "expertoption", feed: null, stale: false, sourceMode: "forced",
      sources: [], availableSources: [
        { slug: "expertoption", label: "ExpertOption", weight: 100, serves: true },
        { slug: "ccxt", label: "CCXT", weight: 50, serves: true }
      ]
    })
    serverPref = { ok: true, userId: "default", source: "auto" }
    serverPostOk = true
    h.mockSetSource.mockReset()
    h.mockUseCandleData.mockReset()
    h.mockFetchCandles.mockReset()
    h.mockUseCandleData.mockImplementation((props: { source?: string }) => chartResult(props))
    vi.stubGlobal("fetch", vi.fn(fetchStub))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it("applies a saved preference as the chart's initial source", async () => {
    serverPref = { ok: true, userId: "default", source: "expertoption" }
    const c = mountChart()
    // Before the GET lands the chart starts on "auto" (never blocks).
    const firstProps = h.mockUseCandleData.mock.calls[0][0] as { source?: string }
    expect(firstProps.source).toBe("auto")
    await c.settle()
    const lastProps = h.mockUseCandleData.mock.calls[h.mockUseCandleData.mock.calls.length - 1][0] as { source?: string }
    expect(lastProps.source).toBe("expertoption")
    const sel = c.host.querySelector("select") as HTMLSelectElement | null
    expect(sel).not.toBeNull()
    expect(sel!.value).toBe("expertoption")
    expect(sel!.textContent).toContain("ExpertOption")
    c.unmount()
  })

  it("changing the dropdown persists via POST and re-pins the chart", async () => {
    serverPref = { ok: true, userId: "default", source: "expertoption" }
    const c = mountChart()
    await c.settle()
    const sel = c.host.querySelector("select")
    expect(sel).not.toBeNull()
    sel!.value = "ccxt"
    sel!.dispatchEvent(new Event("change", { bubbles: true }))

    // Optimistic pin + POST with the picked slug.
    expect(h.mockSetSource).toHaveBeenCalledWith("ccxt")
    const fetchMock = vi.mocked(fetch)
    const postCall = fetchMock.mock.calls.find(([u, i]) => String(u).includes("/source-preference") && (i as RequestInit | undefined)?.method === "POST")
    expect(postCall, "expected a POST to /api/trading/source-preference").toBeTruthy()
    expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({ source: "ccxt" })

    await c.settle()
    const lastProps = h.mockUseCandleData.mock.calls[h.mockUseCandleData.mock.calls.length - 1][0] as { source?: string }
    expect(lastProps.source).toBe("ccxt")
    c.unmount()
  })

  it("a failed persist rolls back to last-good and shows a non-blocking notice", async () => {
    serverPref = { ok: true, userId: "default", source: "expertoption" }
    serverPostOk = false
    const c = mountChart()
    await c.settle()
    const sel = c.host.querySelector("select")!
    sel.value = "ccxt"
    sel.dispatchEvent(new Event("change", { bubbles: true }))
    await c.settle()

    // Optimistic pin, then rollback to the last-good preference.
    expect(h.mockSetSource).toHaveBeenCalledWith("ccxt")
    expect(h.mockSetSource).toHaveBeenCalledWith("expertoption")
    const lastProps = h.mockUseCandleData.mock.calls[h.mockUseCandleData.mock.calls.length - 1][0] as { source?: string }
    expect(lastProps.source).toBe("expertoption")
    expect(c.text()).toContain("Couldn't save source")
    c.unmount()
  })

  it("the status badge speaks the server's tags — never a static 'EO live'", async () => {
    state.source = "buffer"
    state.feed = null
    state.stale = true
    const c = mountChart()
    await c.settle()
    const t = c.text()
    expect(t).toContain("EO buffer")
    expect(t).not.toContain("EO live")
    expect(t).not.toContain("EO headless live")
    c.unmount()
  })

  it("a studio-fed fresh series is labeled 'EO studio' — not 'EO headless live'", async () => {
    state.source = "expertoption"
    state.feed = "studio"
    state.stale = false
    const c = mountChart()
    await c.settle()
    const t = c.text()
    expect(t).toContain("EO studio")
    expect(t).not.toContain("EO headless live")
    c.unmount()
  })

  it("the 'why' line names the server's winner + reason", async () => {
    state.source = "expertoption"
    state.sourceMode = "forced"
    state.sources = [
      { slug: "expertoption", label: "ExpertOption", rank: 1, alive: true, exact: true, servedTf: 60, lastSeen: 1770000000000, medianMs: 24, reason: "alive, exact, 60s, 24 ms", winner: true }
    ]
    const c = mountChart()
    await c.settle()
    const t = c.text()
    expect(t).toContain("Pinned to ExpertOption")
    expect(t).toContain("24 ms")
    c.unmount()
  })
})