// @vitest-environment jsdom
// T6 / REQ-9 deep-link landing: /suites?asset=A&panel=chart[&venue=V] selects
// the chart asset, focuses/scrolls the chart panel, and routes a verified
// venue through the extension bridge (fallback tab when unanswered). Unknown
// values degrade to the current view without a throw.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { useEffect, useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"

vi.mock("@/lib/auth", () => ({
  getStoredSession: () => ({ access_token: "t", user: { id: "u", name: "SP0 Observer", email: "sp0.observer@picc.local" } }),
  fetchMe: async () => ({ id: "u", name: "SP0 Observer", email: "sp0.observer@picc.local" }),
  signOutLocal: async () => {},
  setStoredSession: () => {},
  getToken: () => "t"
}))

vi.mock("@/hooks/useRealtimeSuite", () => {
  const useRealtimeSuite = () => {
    const [snapshot] = useState<unknown>(null)
    const [error] = useState<string | null>(null)
    useEffect(() => { /* static — no stream churn in the deep-link tests */ }, [])
    return { snapshot, live: null, connected: true, error }
  }
  const subscribeTicks = () => () => {}
  return { useRealtimeSuite, subscribeTicks }
})

vi.mock("@/components/CandlestickChart", () => ({
  CandlestickChart: () => <div />,
  ColorType: "Solid",
  createChart: vi.fn(),
  createSeriesMarkers: vi.fn(),
  CandlestickSeries: "candlestick",
  HistogramSeries: "hist",
  LineSeries: "line",
  default: null
}))

// The bridge seam is mocked so the component test asserts the *wiring*
// (resolve → openBrokerTab payload). The postMessage → fallback behavior is
// pinned separately in src/lib/__tests__/brokerLink.test.ts.
vi.mock("@/lib/brokerLink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brokerLink")>()
  return { ...actual, openBrokerTab: vi.fn(async () => ({ attempt: true, fellBack: false })) }
})

import { openBrokerTab } from "@/lib/brokerLink"
import { MarketsSuite } from "@/components/TradingSuite"
import { Suites } from "@/pages/Suites"
import App from "@/App"

vi.stubGlobal("confirm", () => true)

/**
 * Poll until the deep-link effect has actually run (side effects observed),
 * then commit a flush. Fixed sleeps are too fragile under full-suite load:
 * the catalog/realtime chain can take longer than 40ms when the worker is busy.
 */
async function waitFor(check: () => boolean, what: string, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
  flushSync(() => {})
}

const chartSelect = () => document.querySelector<HTMLSelectElement>('[data-panel="chart"] select')

function mount(url: string, element: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/suites" element={element} />
        </Routes>
      </MemoryRouter>
    )
  })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

/**
 * Mount the full App route tree so the /suites redirect actually runs, and
 * record every committed pathname+search so the test can assert the query
 * string survived the redirect end-to-end.
 */
function mountApp(url: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  const urls: string[] = []
  function UrlProbe() {
    const location = useLocation()
    urls.push(location.pathname + location.search)
    return null
  }
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <UrlProbe />
        <App />
      </MemoryRouter>
    )
  })
  return {
    host,
    urls,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

describe("deep-link landing (T6 / REQ-9)", () => {
  let scrollSpy: ReturnType<typeof vi.fn>
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    mounted = []
    vi.mocked(openBrokerTab).mockClear()
    scrollSpy = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
      if (/trading\/venues/.test(u)) {
        return json({
          ok: true,
          assetId: "BTCUSD",
          venues: [
            { id: "expertoption", name: "ExpertOption", url: "https://expertoption.com", note: "", platformKind: "binary", tradeUrl: "https://app.expertoption.finance/", linkMode: "venue" },
            { id: "iqoption", name: "IQ Option", url: "https://iqoption.com", note: "", platformKind: "binary", tradeUrl: "https://iqoption.com", linkMode: "venue" }
          ]
        })
      }
      if (/trading\/accuracy/.test(u)) {
        // The accuracy panel crashes on a truthy-but-undershaped body
        // (accuracy.byDirection.length), a PRE-EXISTING latent bug surfaced by
        // any ok:false 200 response — tracked separately, not part of T6.
        return json({ ok: true, winRate: null, total: 0, byDirection: [] })
      }
      if (/trading\/news/.test(u)) {
        // Same ok:false-body truthy-crash class as accuracy above: NewsCard
        // maps news.items unguarded (TradingSuite.tsx:1856).
        return json({ ok: true, query: "stub", source: "stub", items: [] })
      }
      if (/trading\/catalog/.test(u)) {
        return json({
          ok: true,
          categories: [
            { id: "fx", name: "Forex", symbols: [{ id: "EURUSD", name: "EUR/USD", yahooSymbol: "EURUSD=X" }] },
            { id: "crypto", name: "Crypto", symbols: [{ id: "BTCUSD", name: "Bitcoin", yahooSymbol: "BTC-USD" }] }
          ]
        })
      }
      if (/portfolio\/aggregate/.test(u)) return json({ ok: true, totals: { openPositions: 0, notional: 0, instruments: 0 } })
      if (/trading\/candles/.test(u)) return json({ ok: true, source: "none", candles: [], requestedTimeframe: 60, timeframe: 60, resolved: false })
      if (/brokers/.test(u)) return json({ ok: true, brokers: [], latency: [] })
      return json({ ok: false, error: "no data (stubbed)" })
    }))
    // jsdom has no layout: capture the scroll intent instead of implementing it.
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrollSpy })
  })

  afterEach(() => {
    // Unmount before global teardown so a failing test never ghosts a live
    // MarketsSuite into the next test's document.
    mounted.forEach((m) => m.unmount())
    mounted = []
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    // QoL: jsdom's Element.prototype.scrollIntoView is restored by unstubAllGlobals
    // only if it was stubbed through vi.stubGlobal; the defineProperty above is
    // reset by restoreAllMocks refusing element props, so delete it cleanly.
    delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView
  })

  it("?asset=BTCUSD&panel=chart selects the asset and focuses the chart panel", async () => {
    const m = mount("/suites?asset=BTCUSD&panel=chart", <MarketsSuite />)
    mounted.push(m)
    // Poll the observable the test asserts on (the chart asset), not an earlier
    // side effect — under loaded workers the select value lands one commit later.
    await waitFor(() => chartSelect()?.value === "BTCUSD", "chart select == BTCUSD")
    expect(scrollSpy).toHaveBeenCalled()
    expect(document.activeElement?.matches('[data-panel="chart"]')).toBe(true)
  })

  it("an unknown asset id leaves the selection unchanged (logged, no throw)", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {})
    const m = mount("/suites?asset=NOPEUSD&panel=chart", <MarketsSuite />)
    mounted.push(m)
    await waitFor(() => log.mock.calls.some((c) => c[0] === "[suites] deep-link asset \"NOPEUSD\" is unknown — selection unchanged"), "unknown-asset log line")
    expect(chartSelect()?.value).toBe("EURUSD")
    expect(scrollSpy).toHaveBeenCalled() // panel=chart is still honored
  })

  it("?venue=expertoption resolves a verified tradeUrl and calls openBrokerTab once", async () => {
    const m = mount("/suites?asset=BTCUSD&panel=chart&venue=expertoption", <MarketsSuite />)
    mounted.push(m)
    await waitFor(() => vi.mocked(openBrokerTab).mock.calls.length > 0, "openBrokerTab call")
    expect(chartSelect()?.value).toBe("BTCUSD")
    expect(vi.mocked(openBrokerTab)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(openBrokerTab)).toHaveBeenCalledWith({
      venueId: "expertoption",
      url: "https://app.expertoption.finance/"
    })
  })

  it("no venue param never touches the bridge", async () => {
    const m = mount("/suites?asset=BTCUSD&panel=chart", <MarketsSuite />)
    mounted.push(m)
    await waitFor(() => scrollSpy.mock.calls.length > 0, "panel=chart scroll")
    expect(vi.mocked(openBrokerTab)).not.toHaveBeenCalled()
  })

  it("Suites auto-expands the trading suite on a deep link (REQ-9 end-to-end)", async () => {
    const m = mount("/suites?asset=BTCUSD&panel=chart", <Suites />)
    mounted.push(m)
    // The trading suite opened itself: the chart select is live and asset is applied.
    await waitFor(() => chartSelect()?.value === "BTCUSD", "chart select == BTCUSD")
  })

  it("/suites redirect preserves search params into /suites/trading (App route tree)", async () => {
    // jsdom omits matchMedia, which the shell's components may query.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
    const m = mountApp("/suites?asset=EURUSD&panel=chart")
    mounted.push(m)
    await waitFor(() => m.urls.some((u) => u === "/suites/trading?asset=EURUSD&panel=chart"), "redirected URL carries the query string")
    // Deep link works end-to-end through the redirect.
    await waitFor(() => chartSelect()?.value === "EURUSD", "chart select == EURUSD through the redirect")
    expect(m.host.textContent).not.toContain("Something went wrong")
  })
})