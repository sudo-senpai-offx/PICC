// @vitest-environment jsdom
// UI-3 — the typed clients for the three CANDLE-DERIVED calculator routes, and
// the one helper that turns a fetched series into the wire shape they consume.
//
// WHAT IS UNDER TEST HERE IS THE TRANSPORT AND THE DISCRIMINATORS. Nothing here
// renders; the panels that do are in `CandleCalculatorSection.test.tsx`.
//
//   1. ALL THREE ARE POST-ONLY and send `candles`, because none of them fetches
//      server-side. A GET would 404 here rather than misbehave quietly, but the
//      point is the request body: a client that sent no candles would let the
//      server compute against an empty series and answer `ok:true`.
//   2. A `400` MUST THROW CARRYING THE SERVER'S OWN WORDS. `adaptive-stops` is
//      the only one of the three with a route-level refusal, and it has two
//      distinct ones with two distinct messages; both must survive to the UI.
//   3. THE DISCRIMINATORS GATE ON THE BRANCH, NEVER ON A VALUE. This file exists
//      because two of the three services return a `0` that is a LITERAL CONSTANT
//      standing where a measurement would go, and a third returns a `0` that is
//      genuinely measured. A helper written on the value rather than the branch
//      collapses one pair or breaks the other, and both failures are silent.
//
//        - `expiryOptimizer.mjs:20` (under 20 bars) returns `recommended` =
//          the literal `EXPIRY_OPTIONS[3]` ("1m") and scores every option at a
//          literal 50, and OMITS `volatility`/`avgMove` entirely.
//        - `regimeDetection.mjs:39` (under 30 bars) returns `confidence: 0` as a
//          literal — while `regimeEngine.mjs` returns `confidence: 0` for a
//          genuinely measured "directionless RANGING" read. Two different zeros,
//          one name.
//        - A FLAT candle series makes `optimizeExpiry`'s volatility exactly 0,
//          and that 0 is REAL. It must pass the discriminator.
//        - `computeAdaptiveStops` on a measured series can serve `adx: 0` for a
//          ranging read. That 0 is real and must pass.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  expiryIsScored,
  fetchAdaptiveStops,
  fetchRegime,
  fetchExpiry,
  stopsAreMeasured,
  toWireCandles
} from "@/lib/candleCalculators"
import type { ExpiryResponse, StopsDirection } from "@/lib/candleCalculators"

/** A fetch Response stand-in. `json` may reject, which is a real server case. */
function response(status: number, body: unknown | "unparseable"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === "unparseable") throw new SyntaxError("Unexpected token <")
      return body
    }
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return { url: call[0], init: call[1] }
}

function body(): Record<string, unknown> {
  return JSON.parse(lastCall().init.body as string) as Record<string, unknown>
}

/** A 3-bar series, enough to prove the array crossed the wire intact. */
const SERIES = [
  { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5 },
  { time: 1_700_000_060, open: 1.5, high: 2.5, low: 1, close: 2 },
  { time: 1_700_000_120, open: 2, high: 3, low: 1.5, close: 2.5 }
]

// ---------------------------------------------------------------------
// toWireCandles — the one conversion between the chart's series and the wire
// ---------------------------------------------------------------------

describe("toWireCandles", () => {
  it("passes a well-formed numeric OHLC series through unchanged", () => {
    const out = toWireCandles(SERIES)
    expect(out.candles).toEqual(SERIES)
    expect(out.dropped).toBe(0)
  })

  it("coerces the chart's `time` to a NUMBER, because the services subtract it", () => {
    // `expiryOptimizer.mjs:33` does `Number(candles[i].time) - Number(...)` to infer
    // the bar interval, and a string epoch would silently produce a gap list full
    // of NaN — falling back to an assumed 60s bar and mis-scaling every expected
    // move by √(barSec/60). The chart's `time` is typed as lightweight-charts'
    // `Time`, which may be a string, so this is a real conversion and not a no-op.
    const out = toWireCandles([
      { time: "1700000000" as never, open: 1, high: 2, low: 0.5, close: 1.5 }
    ])
    expect(out.candles[0].time).toBe(1_700_000_000)
    expect(typeof out.candles[0].time).toBe("number")
  })

  it("DROPS a bar whose time is not a finite number, and says how many it dropped", () => {
    // A bar with an unusable time is not a bar these calculators can use, and
    // sending it would make `Number(time)` NaN inside the service's gap loop. It
    // is dropped and COUNTED rather than silently forwarded, because a caller
    // that reports "60 bars" while the server saw 59 is misstating its own input.
    const out = toWireCandles([
      { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: "not-a-time" as never, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 1_700_000_120, open: 2, high: 3, low: 1.5, close: 2.5 }
    ])
    expect(out.candles).toHaveLength(2)
    expect(out.dropped).toBe(1)
  })

  it("DROPS a bar whose OHLC is not all finite, rather than forwarding NaN", () => {
    const out = toWireCandles([
      { time: 1_700_000_000, open: 1, high: Number.NaN, low: 0.5, close: 1.5 },
      { time: 1_700_000_060, open: 1.5, high: 2.5, low: 1, close: 2 }
    ])
    expect(out.candles).toHaveLength(1)
    expect(out.dropped).toBe(1)
  })

  it("returns an empty series rather than throwing on a non-array", () => {
    expect(toWireCandles(undefined as never)).toEqual({ candles: [], dropped: 0 })
    expect(toWireCandles([])).toEqual({ candles: [], dropped: 0 })
  })
})

// ---------------------------------------------------------------------
// fetchRegime
// ---------------------------------------------------------------------

describe("fetchRegime", () => {
  it("POSTs the candles and the timeframe LABEL to the regime route", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: true, regime: "ranging", confidence: 50, factors: [] }))
    await fetchRegime(SERIES, "1h")
    const { url, init } = lastCall()
    expect(url).toBe("/api/trading/regime")
    expect(init.method).toBe("POST")
    // The route reads `body.timeframe` and hands it to `tfSecondsOf`, which only
    // accepts LABELS ("m5", "1h", "d1"). A number would resolve to null and the
    // engine would fall back to a 60s bias plane.
    expect(body()).toEqual({ candles: SERIES, timeframe: "1h" })
  })

  it("omits `timeframe` entirely when none is given, so the server's own default is not shadowed", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: true, regime: "ranging", confidence: 50, factors: [] }))
    await fetchRegime(SERIES)
    expect(body()).toEqual({ candles: SERIES })
    expect("timeframe" in body()).toBe(false)
  })

  it("sends the bearer token when one is stored, and nothing when none is", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: true, regime: "ranging", confidence: 50, factors: [] }))
    await fetchRegime(SERIES, "1h")
    // All three routes are behind `requireAuth`, and an anonymous call is refused
    // with a 401 — which the panels render as a refusal carrying its reason.
    expect((lastCall().init.headers as Record<string, string>).Authorization).toBeUndefined()

    localStorage.setItem(
      "picc.auth",
      JSON.stringify({ access_token: "test-token-not-a-secret", user: { id: "1", email: "a@b", name: "a" } })
    )
    await fetchRegime(SERIES, "1h")
    expect((lastCall().init.headers as Record<string, string>).Authorization).toBe("Bearer test-token-not-a-secret")
  })

  it("surfaces a 401 as a thrown refusal carrying the reason", async () => {
    fetchMock.mockResolvedValue(response(401, { ok: false, error: "unauthorized" }))
    await expect(fetchRegime(SERIES, "1h")).rejects.toThrow("unauthorized")
  })
})

// ---------------------------------------------------------------------
// fetchExpiry
// ---------------------------------------------------------------------

describe("fetchExpiry", () => {
  it("POSTs the candles AND the two upstream inputs, because its output is meaningless without them", async () => {
    fetchMock.mockResolvedValue(
      response(200, { ok: true, recommended: { label: "5m", seconds: 300, score: 80 }, all: [], volatility: 0.01, avgMove: 0.01 })
    )
    await fetchExpiry(SERIES, "trending", 0.9)
    const { url, init } = lastCall()
    expect(url).toBe("/api/trading/expiry")
    expect(init.method).toBe("POST")
    // BOTH inputs are sent on every call, never left to the server's defaults.
    // `optimizeExpiry(candles, regime = "ranging", signalStrength = 0.5)` invents
    // both silently, and a panel that let it would render a score whose regime the
    // operator never chose and cannot see.
    expect(body()).toEqual({ candles: SERIES, regime: "trending", signalStrength: 0.9 })
  })

  it("sends a signalStrength of 0 rather than dropping it, because 0 is a real strength", async () => {
    fetchMock.mockResolvedValue(
      response(200, { ok: true, recommended: { label: "1m", seconds: 60, score: 45 }, all: [], volatility: 0.01, avgMove: 0.01 })
    )
    await fetchExpiry(SERIES, "ranging", 0)
    expect(body().signalStrength).toBe(0)
    expect("signalStrength" in body()).toBe(true)
  })
})

// ---------------------------------------------------------------------
// fetchAdaptiveStops
// ---------------------------------------------------------------------

describe("fetchAdaptiveStops", () => {
  it("POSTs the candles, the direction and the timeframe", async () => {
    fetchMock.mockResolvedValue(
      response(200, { ok: true, takeProfit: 2, stopLoss: 1, atr: 0.1, adx: 20, regime: "ranging", reason: null })
    )
    await fetchAdaptiveStops(SERIES, "up", 60)
    const { url, init } = lastCall()
    expect(url).toBe("/api/trading/adaptive-stops")
    expect(init.method).toBe("POST")
    expect(body()).toEqual({ candles: SERIES, direction: "up", timeframe: 60 })
  })

  it("omits `timeframe` when none is given, leaving the server's ATR-period default alone", async () => {
    fetchMock.mockResolvedValue(
      response(200, { ok: true, takeProfit: 2, stopLoss: 1, atr: 0.1, adx: 20, regime: "ranging", reason: null })
    )
    await fetchAdaptiveStops(SERIES, "up")
    expect(body()).toEqual({ candles: SERIES, direction: "up" })
  })

  it("throws the candle-count refusal verbatim", async () => {
    fetchMock.mockResolvedValue(response(400, { ok: false, error: "at least 20 candles required" }))
    await expect(fetchAdaptiveStops(SERIES, "up", 60)).rejects.toThrow("at least 20 candles required")
  })

  it("throws the direction refusal verbatim — a DIFFERENT refusal from the same route", async () => {
    fetchMock.mockResolvedValue(response(400, { ok: false, error: "direction must be 'up' or 'down'" }))
    await expect(fetchAdaptiveStops(SERIES, "sideways" as StopsDirection, 60)).rejects.toThrow(
      "direction must be 'up' or 'down'"
    )
  })
})

// ---------------------------------------------------------------------
// The discriminators. This block is the point of the file.
// ---------------------------------------------------------------------

describe("expiryIsScored — gates on the BRANCH, never on the value", () => {
  /**
   * `expiryOptimizer.mjs:20`, verbatim. `volatility` and `avgMove` are ABSENT
   * keys on this branch — not `undefined`-valued, not zero — and `recommended` is
   * the literal `EXPIRY_OPTIONS[3]` with no `score` of its own.
   */
  const unscored: ExpiryResponse = {
    ok: true,
    recommended: { label: "1m", seconds: 60 },
    all: [{ label: "5s", seconds: 5, score: 50 }]
  }

  it("is FALSE on the short branch, where the recommendation is a CONSTANT", () => {
    expect(expiryIsScored(unscored)).toBe(false)
  })

  it("is TRUE for a genuinely computed volatility of 0 — a FLAT series", () => {
    // THE MEASURED-ZERO CONTROL. A perfectly flat candle series gives every return
    // 0, so `volatility = sqrt(Σr²/n)` is exactly 0 (`expiryOptimizer.mjs:25`).
    // That 0 is REAL and a helper gated on `volatility !== 0` would erase it.
    const scored: ExpiryResponse = {
      ok: true,
      recommended: { label: "1m", seconds: 60, score: 45, expectedMove: 0 },
      all: [{ label: "1m", seconds: 60, score: 45, expectedMove: 0 }],
      volatility: 0,
      avgMove: 0
    }
    expect(expiryIsScored(scored)).toBe(true)
  })

  it("narrows the type so the scored branch cannot be read without its volatility", () => {
    const scored: ExpiryResponse = {
      ok: true,
      recommended: { label: "1m", seconds: 60, score: 45, expectedMove: 0 },
      all: [],
      volatility: 0,
      avgMove: 0
    }
    if (!expiryIsScored(scored)) throw new Error("expected the scored branch")
    // Reachable only on the scored branch; `avgMove` is `?: never` on the other.
    expect(scored.avgMove).toBe(0)
  })
})

describe("stopsAreMeasured — gates on `reason`, never on a null number", () => {
  it("is TRUE only when the service returned `reason: null`", () => {
    expect(
      stopsAreMeasured({
        ok: true,
        takeProfit: 2,
        stopLoss: 1,
        atr: 0.1,
        adx: 20,
        atrRatio: 1.2,
        regime: "ranging",
        reason: null,
        multipliers: { tp: 1.8, sl: 1.5 }
      })
    ).toBe(true)
  })

  it("is FALSE on the adx-unobservable branch EVEN THOUGH `atr` IS A REAL MEASUREMENT", () => {
    // THE SUBTLE ONE. `computeAdaptiveStops` returns
    //   `{ takeProfit: null, stopLoss: null, atr: currentAtr, adx: null,
    //      regime: "unknown", atrRatio, reason: "adx-unobservable: ..." }`
    // — a branch where `atr` is genuinely computed and genuinely non-null while
    // every stop is null. A panel that gated the STOPS on "did we get an atr?" or
    // on "are takeProfit and stopLoss both zero?" would print a real ATR beside a
    // stop nobody could produce. The discriminator is `reason === null`.
    expect(
      stopsAreMeasured({
        ok: true,
        takeProfit: null,
        stopLoss: null,
        atr: 0.42,
        adx: null,
        atrRatio: 1.1,
        regime: "unknown",
        reason: "adx-unobservable: ADX has not warmed up on these candles, so no trend regime is claimed (unobserved never counts as neutral)"
      })
    ).toBe(false)
  })

  it("is TRUE for a measured `adx` of 0, which a ranging read really produces", () => {
    expect(
      stopsAreMeasured({
        ok: true,
        takeProfit: 1.1,
        stopLoss: 0.9,
        atr: 0.05,
        adx: 0,
        atrRatio: 1,
        regime: "ranging",
        reason: null,
        multipliers: { tp: 1.8, sl: 1.5 }
      })
    ).toBe(true)
  })
})