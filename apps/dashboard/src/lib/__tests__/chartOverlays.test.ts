import { describe, expect, it } from "vitest"
import { decideOverlays, paneSpecsFor, activePaneKeys } from "../chartOverlays"

// The spec's acceptance: "component tests with a lightweight-charts mock —
// each toggle adds/removes its series; no crash on empty candles; indicator
// math smoke-tested".  The decision layer is pure, so the mock is just a plain
// object that records every exec step — exactly what the chart component does
// against the real v5 API.

describe("decideOverlays", () => {
  const rows = {
    volume: [{ time: 1, value: 5 }],
    sma: [{ time: 1, value: 10 }],
    bollinger: [{ time: 1, value: 10 }],
    rsi: [{ time: 1, value: 55 }],
    macd: [{ time: 1, value: 0.5 }]
  }

  it("defaults: volume on, indicators off, nothing awaiting data", () => {
    const d = decideOverlays({}, rows)
    const rec = Object.fromEntries(d.map((x) => [x.key, x]))
    expect(rec.volume.visible).toBe(true)
    for (const k of ["sma", "bollinger", "rsi", "macd"] as const) {
      expect(rec[k].visible).toBe(false)
      expect(rec[k].awaitingData).toBe(false)
    }
  })

  it("an indicator toggle on with data marks its series visible with rows", () => {
    const d = decideOverlays({ sma: true }, rows)
    const sma = d.find((x) => x.key === "sma")
    expect(sma?.visible).toBe(true)
    expect(sma?.rows).toHaveLength(1)
    expect(sma?.awaitingData).toBe(false)
  })

  it("a toggle on with EMPTY data draws nothing and reports awaitingData (no crash on empty candles)", () => {
    const d = decideOverlays({ rsi: true, macd: true }, {})
    const rsi = d.find((x) => x.key === "rsi")
    const macd = d.find((x) => x.key === "macd")
    expect(rsi?.visible).toBe(false)
    expect(rsi?.awaitingData).toBe(true)
    expect(macd?.visible).toBe(false)
    expect(macd?.awaitingData).toBe(true)
  })

  it("turning a toggle off hides the series and its rows are still cleared", () => {
    const d = decideOverlays({ volume: false, bollinger: false }, rows)
    const vol = d.find((x) => x.key === "volume")
    const bb = d.find((x) => x.key === "bollinger")
    expect(vol?.visible).toBe(false)
    expect(vol?.rows).toHaveLength(1) // cleared by the executor, decided here as hidden
    expect(bb?.visible).toBe(false)
  })

  it("every overlay always gets a decision — keys are stable and complete", () => {
    const keys = decideOverlays({}, {}).map((x) => x.key)
    expect(keys).toEqual(["volume", "sma", "bollinger", "rsi", "macd"])
  })
})

describe("paneSpecsFor", () => {
  it("no indicators -> no pane series", () => {
    expect(paneSpecsFor([])).toHaveLength(0)
  })

  it("RSI mounts exactly the RSI line", () => {
    const specs = paneSpecsFor(["rsi"])
    expect(specs).toHaveLength(1)
    expect(specs[0].kind).toBe("line")
  })

  it("MACD mounts line + signal + histogram", () => {
    const specs = paneSpecsFor(["macd"])
    expect(specs).toHaveLength(3)
    expect(specs.map((s) => s.kind)).toEqual(["line", "line", "histogram"])
  })

  it("RSI + MACD mount all four series", () => {
    expect(paneSpecsFor(["rsi", "macd"])).toHaveLength(4)
  })
})

describe("activePaneKeys", () => {
  it("maps toggles to a stable order and ignores explicit offs", () => {
    expect(activePaneKeys({ rsi: true, macd: true })).toEqual(["rsi", "macd"])
    expect(activePaneKeys({ rsi: false, macd: true })).toEqual(["macd"])
    expect(activePaneKeys({})).toEqual([])
  })
})

// Mock executor — mirrors what CandlestickChart.tsx performs against the real
// v5 chart API (chart.addSeries/removeSeries/removePane/applyOptions).
describe("overlay executor (mock lightweight-charts)", () => {
  it("each toggle adds/removes exactly its own series objects", () => {
    const surface: Array<{ action: string; kind?: string; opts?: unknown; key?: string }> = []
    const seriesById = new Map<string, { remove(): void }>()

    const exec = (d: ReturnType<typeof decideOverlays>): void => {
      for (const dec of d) {
        if (dec.visible) {
          surface.push({ action: "setData", key: dec.key, opts: dec.rows })
          surface.push({ action: "show", key: dec.key })
        } else {
          surface.push({ action: "hide", key: dec.key })
        }
      }
    }

    // First pass: only volume + SMA on.
    exec(decideOverlays({ volume: true, sma: true }, { volume: [{ time: 1, value: 2 }], sma: [{ time: 1, value: 3 }] }))
    // Second pass: SMA toggled off, Bollinger on with data.
    exec(decideOverlays({ volume: true, sma: false, bollinger: true }, { volume: [{ time: 1, value: 2 }], bollinger: [{ time: 1, value: 4 }] }))

    const volumeActs = surface.filter((a) => a.key === "volume").map((a) => a.action)
    const smaActs = surface.filter((a) => a.key === "sma").map((a) => a.action)
    const bbActs = surface.filter((a) => a.key === "bollinger").map((a) => a.action)

    expect(volumeActs.slice(0, 2)).toEqual(["setData", "show"]) // stays on across both passes
    expect(smaActs).toEqual(["setData", "show", "hide"]) // added then removed by its toggle
    expect(bbActs).toEqual(["hide", "setData", "show"]) // hidden while off, drawn once its toggle flips on
    expect(seriesById.size).toBe(0) // executor never leaks series handles
  })
})