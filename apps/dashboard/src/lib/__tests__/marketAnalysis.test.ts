// @vitest-environment jsdom
// UI-2 — the typed clients for the four analysis routes.
//
// WHAT IS UNDER TEST HERE IS THE TRANSPORT, and specifically the four ways a
// refusal reaches the UI:
//
//   1. a `400`/`502`/401 must THROW carrying the server's own words, because
//      the reason is the only useful part of a refusal and the panel renders it;
//   2. the `volatility` route serves its refusal with HTTP 200 and `ok: false`,
//      so a client that branched on `res.ok` alone would hand an empty panel to
//      the UI and the panel would read as "measured, and nothing to say";
//   3. `risk-parity` refuses from two places with two different shapes, and only
//      one of them carries a `weights` key at all — normalised to `null` here so
//      a route-level refusal cannot read as a portfolio measured at zero weight;
//   4. `orderflow` has NO `trades` parameter and this module must have no way to
//      send one, because a client-supplied signed-trade series would let any
//      authenticated caller manufacture an `available: true` readout.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  fetchOrderFlow,
  fetchRiskParity,
  fetchSentiment,
  fetchVolatility
} from "@/lib/marketAnalysis"

type Body = Record<string, unknown>

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

describe("fetchVolatility", () => {
  it("POSTs the symbol to the volatility route", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: false, symbol: "X", name: "X", error: "e" }))
    await fetchVolatility("eurusd")
    const { url, init } = lastCall()
    expect(url).toBe("/api/trading/volatility")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ symbol: "eurusd" })
  })

  it("sends the bearer token when one is stored, and nothing when none is", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: false, symbol: "X", name: "X", error: "e" }))
    await fetchVolatility("EURUSD")
    expect((lastCall().init.headers as Record<string, string>).Authorization).toBeUndefined()

    localStorage.setItem(
      "picc.auth",
      JSON.stringify({ access_token: "test-token-not-a-secret", user: { id: "1", email: "a@b", name: "a" } })
    )
    await fetchVolatility("EURUSD")
    expect((lastCall().init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token-not-a-secret"
    )
  })

  it("RESOLVES the route's own refusal, which arrives on a 200 with ok:false", async () => {
    // The shape `volatility.mjs:434` produces when the fetched history held under
    // 30 usable closes. Throwing here would be survivable; resolving it is what
    // lets the panel render the reason instead of a generic failure.
    fetchMock.mockResolvedValue(
      response(200, { ok: false, symbol: "NOPE", name: "NOPE", error: "need at least 30 candles" })
    )
    const out = await fetchVolatility("NOPE")
    expect(out.ok).toBe(false)
    if (out.ok === false) expect(out.error).toBe("need at least 30 candles")
  })

  it("throws a 400 carrying the server's own words", async () => {
    fetchMock.mockResolvedValue(response(400, { error: "symbol required" }))
    await expect(fetchVolatility("")).rejects.toThrow("symbol required")
  })

  it("throws a 502 carrying the UPSTREAM message, not the status code", async () => {
    fetchMock.mockResolvedValue(response(502, { ok: false, error: "Yahoo Finance 404 for NOPE" }))
    await expect(fetchVolatility("NOPE")).rejects.toThrow("Yahoo Finance 404 for NOPE")
  })

  it("falls back to the status code only when the body carries no error", async () => {
    fetchMock.mockResolvedValue(response(401, "unparseable"))
    await expect(fetchVolatility("EURUSD")).rejects.toThrow("volatility failed: 401")
  })
})

describe("fetchSentiment", () => {
  it("POSTs the symbol, unnormalised — the engine owns normalisation", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: true, available: false }))
    await fetchSentiment("EUR/USD")
    const { url, init } = lastCall()
    expect(url).toBe("/api/trading/sentiment")
    expect(JSON.parse(init.body as string)).toEqual({ symbol: "EUR/USD" })
  })

  it("throws a 400 carrying the server's own words", async () => {
    fetchMock.mockResolvedValue(response(400, { ok: false, error: "symbol required" }))
    await expect(fetchSentiment("")).rejects.toThrow("symbol required")
  })
})

describe("fetchRiskParity", () => {
  it("POSTs the symbol list", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: true, weights: {}, method: "inverse-vol" }))
    await fetchRiskParity(["EURUSD", "BTCUSD"])
    const { url, init } = lastCall()
    expect(url).toBe("/api/trading/risk-parity")
    expect(JSON.parse(init.body as string)).toEqual({
      symbols: ["EURUSD", "BTCUSD"],
      method: "inverse-vol"
    })
  })

  it("normalises the ROUTE-level refusal, which carries no weights key, to null", async () => {
    // `handlers.mjs:5173` serves `{ok:false, error:"no symbols"}` with no weights
    // key. Left as `undefined` this would reach `Object.keys()` downstream; read
    // as `{}` it would read as a portfolio measured at zero weight across zero
    // assets. `null` says the route refused before allocating.
    fetchMock.mockResolvedValue(response(200, { ok: false, error: "no symbols" }))
    const out = await fetchRiskParity([])
    expect(out).toEqual({ ok: false, error: "no symbols", weights: null })
  })

  it("keeps the ALLOCATOR-level refusal's empty weights as {}, not null", async () => {
    // `riskParity.mjs:150` really does serve `weights: {}`. Collapsing it into
    // the route-level shape would erase the difference between "refused before
    // fetching" and "fetched, and nothing had enough history".
    fetchMock.mockResolvedValue(
      response(200, { ok: false, error: "no symbols with sufficient data", weights: {} })
    )
    const out = await fetchRiskParity(["EURUSD"])
    expect(out).toEqual({
      ok: false,
      error: "no symbols with sufficient data",
      weights: {}
    })
  })

  it("fills every branch-absent key with null rather than leaving it undefined", async () => {
    // The single-asset branch carries no `symbolCount`, no `riskContributions`,
    // no `iterations`, and no `portfolioVol` — it builds no covariance, so it
    // computes no portfolio volatility and now says so with `null` rather than
    // the literal `0` this fixture used to send. Undefined would be
    // indistinguishable, at the render boundary, from a key the server sent as
    // null, which is the distinction the whole normaliser exists to preserve.
    fetchMock.mockResolvedValue(
      response(200, {
        ok: true,
        weights: { EURUSD: 1 },
        method: "single-asset",
        vols: { EURUSD: 0.0651 },
        volStatus: { EURUSD: { state: "measured", annual: 0.0651, reason: null } },
        portfolioVol: null,
        reason: "single-asset portfolio: no covariance is built"
      })
    )
    const out = await fetchRiskParity(["EURUSD"])
    expect(out).toEqual({
      ok: true,
      weights: { EURUSD: 1 },
      method: "single-asset",
      symbolCount: null,
      vols: { EURUSD: 0.0651 },
      volStatus: { EURUSD: { state: "measured", annual: 0.0651, reason: null } },
      portfolioVol: null,
      portfolioVolPct: null,
      riskContributions: null,
      iterations: null,
      reason: "single-asset portfolio: no covariance is built"
    })
  })

  it("normalises an UNMEASURED per-symbol vol to null and keeps it named", async () => {
    // The allocator no longer substitutes 0.20 for a symbol it could not measure,
    // so `vols` carries a null and `volStatus` says which of the three states it
    // was. A client that printed `vols[symbol]` without checking would otherwise
    // print a null it did not expect, so the state is what makes it legible.
    fetchMock.mockResolvedValue(
      response(200, {
        ok: true,
        weights: { A: 1 },
        method: "inverse-vol",
        symbolCount: 2,
        vols: { A: 0.0651, B: null },
        volStatus: {
          A: { state: "measured", annual: 0.0651, reason: null },
          B: { state: "unmeasured", annual: null, reason: "too few usable positive-price transitions" }
        }
      })
    )
    const out = await fetchRiskParity(["A", "B"])
    if (out.ok === false) throw new Error("expected a measurement")
    expect(out.vols?.B).toBeNull()
    expect(out.volStatus?.B.state).toBe("unmeasured")
    expect(out.volStatus?.B.reason).toMatch(/too few usable/)
  })

  it("keeps a genuine measured portfolioVol of 0 as 0", async () => {
    fetchMock.mockResolvedValue(
      response(200, {
        ok: true,
        weights: { A: 0.5, B: 0.5 },
        method: "inverse-vol",
        symbolCount: 2,
        vols: { A: 0, B: 0.5 },
        portfolioVol: 0
      })
    )
    const out = await fetchRiskParity(["A", "B"])
    if (out.ok === false) throw new Error("expected a measurement")
    // `?? null` would turn this into null; `?? null` on a 0 does not, and that is
    // the whole reason the normaliser uses `??` and never `||`.
    expect(out.portfolioVol).toBe(0)
    expect(out.vols?.A).toBe(0)
  })

  it("throws a 502 carrying the upstream message", async () => {
    fetchMock.mockResolvedValue(response(502, { ok: false, error: "watchlist unavailable" }))
    await expect(fetchRiskParity(["EURUSD"])).rejects.toThrow("watchlist unavailable")
  })
})

describe("fetchOrderFlow", () => {
  it("sends NOTHING but an empty object, so it cannot manufacture an available readout", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: true, available: false }))
    await fetchOrderFlow()
    const { url, init } = lastCall()
    expect(url).toBe("/api/trading/orderflow")
    const body = JSON.parse(init.body as string) as Body
    // THE STRUCTURAL GUARANTEE. There is no `trades` parameter on this function
    // to pass and no `candles` either, so the request cannot carry a
    // signed-trade series whatever a caller wants.
    expect(Object.keys(body)).toEqual([])
    expect("trades" in body).toBe(false)
    expect("candles" in body).toBe(false)
  })

  it("sends only the lookback when one is given", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: true, available: false }))
    await fetchOrderFlow(50)
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ lookback: 50 })
  })

  it("preserves an unavailable reading's nulls and its refusal of the word neutral", async () => {
    fetchMock.mockResolvedValue(
      response(200, {
        ok: true,
        available: false,
        delta: [],
        cumulative: null,
        avgDelta: null,
        imbalance: "unavailable",
        signals: [],
        dataFidelity: "no-feed",
        reason: "no signed-trades feed",
        lookback: 20
      })
    )
    const out = await fetchOrderFlow()
    if (out.available) throw new Error("expected unavailable")
    // THE THREE FIELDS THAT MUST NOT BECOME ZERO. `delta: []` and
    // `avgDelta: 0` would both be fabrications on a panel that then says the
    // tape was flat.
    expect(out.cumulative).toBeNull()
    expect(out.avgDelta).toBeNull()
    expect(out.imbalance).toBe("unavailable")
  })
})