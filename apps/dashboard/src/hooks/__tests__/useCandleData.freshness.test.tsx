// @vitest-environment jsdom
// T11 (slice 6 reskin) — the client must parse what the server already sends on
// every candles response (handlers.mjs:2334-2346): `stale`, `sourceMode`
// ("auto"|"forced"|"fallback") and the per-candidate `sources[]` report (who was
// tried, in what rank, and who won). The previous client ignored all three —
// that silence is exactly why the old badge could claim "EO live" no matter
// what the server said.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { useEffect, useRef } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { useCandleData, fetchCandles } from "@/hooks/useCandleData"

vi.mock("@/lib/auth", () => ({ getToken: () => "" }))
vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({ error: null }),
  subscribeTicks: () => () => {}
}))

const json = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response

const FULL_RESPONSE = {
  ok: true,
  source: "expertoption",
  feed: null,
  stale: true,
  timeframe: 60,
  requestedTimeframe: 60,
  resolved: false,
  sourceMode: "forced",
  sources: [
    { slug: "expertoption", label: "ExpertOption", rank: 1, alive: true, exact: true, servedTf: 60, lastSeen: 1770000000000, medianMs: 24, reason: "alive, exact, 60s, 24 ms", winner: true },
    { slug: "ccxt", label: "CCXT", rank: 2, alive: true, exact: false, servedTf: null, lastSeen: null, medianMs: 180, reason: "buffered frames only", winner: false }
  ],
  candles: [{ time: 1770000000, open: 1.1, high: 1.12, low: 1.09, close: 1.11, timeframe: 60 }]
}

function Probe({ onResult }: { onResult: (r: ReturnType<typeof useCandleData>) => void }) {
  const r = useCandleData({ assetId: "EURUSD", timeframe: 60, count: 50 })
  const report = useRef(onResult)
  report.current = onResult
  useEffect(() => { report.current(r) })
  return null
}

function mountProbe() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  let latest: ReturnType<typeof useCandleData> | null = null
  flushSync(() => {
    root.render(<Probe onResult={(r) => { latest = r }} />)
  })
  return {
    host,
    get latest() {
      expect(latest, "expected a reported hook value").not.toBeNull()
      return latest as ReturnType<typeof useCandleData>
    },
    async settle() {
      await new Promise((r) => setTimeout(r, 10))
      flushSync(() => {})
    },
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

describe("useCandleData freshness passthrough (T11)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => json(FULL_RESPONSE)))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it("parses stale=true from the served series", async () => {
    const p = mountProbe()
    await p.settle()
    expect(p.latest.stale).toBe(true)
    p.unmount()
  })

  it("parses the sourceMode the server reported", async () => {
    const p = mountProbe()
    await p.settle()
    expect(p.latest.sourceMode).toBe("forced")
    p.unmount()
  })

  it("parses the per-candidate report with the winner marked", async () => {
    const p = mountProbe()
    await p.settle()
    expect(p.latest.sources).toHaveLength(2)
    const winner = p.latest.sources.find((s) => s.winner)
    expect(winner?.slug).toBe("expertoption")
    expect(winner?.reason).toContain("24 ms")
    expect(p.latest.sources[1]).toMatchObject({ slug: "ccxt", rank: 2 })
    p.unmount()
  })

  it("defaults stale=false / sourceMode=null-like / [] when the empty-candles path omits stale", async () => {
    // The server's empty-candles branch (handlers.mjs:2328) carries sourceMode
    // + sources but NO `stale` key — the client must not fabricate staleness.
    vi.stubGlobal("fetch", vi.fn(async () => json({
      ok: true, source: "none", feed: null, requestedTimeframe: 60, timeframe: 60, resolved: false,
      candles: [], sourceMode: "auto", sources: []
    })))
    const p = mountProbe()
    await p.settle()
    expect(p.latest.stale).toBe(false)
    expect(p.latest.sourceMode).toBe("auto")
    expect(p.latest.sources).toEqual([])
    expect(p.latest.source).toBe("none")
    p.unmount()
  })

  it("fetchCandles surfaces stale / sourceMode / sources straight from the wire", async () => {
    const r = await fetchCandles("EURUSD", 60, 50, "expertoption", false)
    expect(r.stale).toBe(true)
    expect(r.sourceMode).toBe("forced")
    expect(r.sources).toHaveLength(2)
    expect(r.sources.find((s) => s.winner)?.slug).toBe("expertoption")
  })
})