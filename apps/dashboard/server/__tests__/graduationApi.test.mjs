// W3-04 Task 4 — GET /api/graduation/overview: the read-only readout route.
//
// THE GATE IS ASSERTED HERE, NOT LEFT TO THE STATIC SCAN. `ws7RouteAuthCoverageGuard`
// proves a gate call exists in the route's own block; this proves the route
// answers 401 to an anonymous caller (costsApi precedent).
//
// WHAT THIS ROUTE IS NOT. It is a readout. No permit flip, no unlock, no ceremony
// gate, no credential read, and no write of any kind - the paper ledger is
// asserted byte-identical after a seeded call, the same proof costsApi uses.
//
// Hermetic: booted through the SHARED store-isolation helper, so no store
// resolves to the real `server/data`. No `process.env` assignment by hand.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rmSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const OVERVIEW = "/api/graduation/overview"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    // DELIBERATELY NO `socket` (costsApi precedent): requireAuth admits a
    // loopback peer outright, so omitting it presents a non-loopback caller.
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
      if (evt === "end") cb()
    }
  }
}

function makeRes() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    }
  }
}

async function call(api, method, path, body, headers) {
  const res = makeRes()
  await api(makeReq(method, path, body, headers), res, path)
  return res
}

/** A bearer token whose value is irrelevant to the assertions below. */
const TOKEN = "d".repeat(64)

/**
 * Seed the paper ledger with closed trades.
 *
 * THE FIELD NAMES ARE THE REAL ONES, read off the producers rather than the
 * brief: `trading.mjs:761-774` writes `openedAt` on the open position and
 * `trading.mjs:794-803` writes `closedAt`, `pnl` and the same `amount` on the
 * close. `entry`/`exit` are carried because the ledger's own consumers expect
 * them, and `holdingMs` because `metricsFrom` reads it for `avgHoldMs`.
 */
function seedCloses(tradingDir, closes) {
  writeFileSync(
    join(tradingDir, "trading-ledger.json"),
    JSON.stringify({
      positions: [],
      closed: closes.map((c) => ({
        symbol: "BTCUSD",
        side: "up",
        entry: 50000,
        exit: 50100,
        holdingMs: 3_600_000,
        ...c
      })),
      signals: []
    })
  )
}

describe("graduation API (W3-04 Task 4) — overview route", () => {
  let authDir
  let tradingDir
  let costsDir

  beforeEach(() => {
    authDir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR")
    tradingDir = useIsolatedStoreDir("PICC_TRADING_DATA_DIR")
    costsDir = useIsolatedStoreDir("PICC_COSTS_DATA_DIR")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of [authDir, tradingDir, costsDir]) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  async function loadHandlers({ withUser = true } = {}) {
    if (withUser) {
      writeFileSync(
        join(authDir, "users.json"),
        JSON.stringify({ users: [{ id: "u1", email: "grad@example.test", password: "x", salt: "y" }] })
      )
    }
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?graduation-api-test")
    return handleApi
  }

  /** An AUTHENTICATED, non-loopback caller: a user AND a session carrying the token. */
  async function authed() {
    writeFileSync(
      join(authDir, "users.json"),
      JSON.stringify({ users: [{ id: "u1", email: "grad@example.test", password: "x", salt: "y" }] })
    )
    writeFileSync(
      join(authDir, "sessions.json"),
      JSON.stringify({ sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } } })
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?graduation-api-authed")
    return { api: handleApi, headers: { authorization: `Bearer ${TOKEN}` } }
  }

  it("GET overview refuses an anonymous caller with 401", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", OVERVIEW)
    expect(res.status).toBe(401)
  })

  it("GET overview states its own honesty: no bar supplied, absent legs named, advisory", async () => {
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    // The payload is a readout. Nothing in it moves a permit.
    expect(res.body.advisory).toBe(true)
    expect(Array.isArray(res.body.strategies)).toBe(true)
    expect(typeof res.body.incomplete).toBe("boolean")
    // Empty isolated store: incomplete, never a confident clean bill.
    expect(res.body.incomplete).toBe(true)
    // NO BAR EXISTS IN THE PLATFORM, so the route supplies none and says so.
    expect(res.body.bars.supplied).toBe(false)
    expect(res.body.bars.reason).toBe("bar-unavailable")
    // THE TAG IS DERIVED FROM A REAL FIELD, and the payload says which one.
    expect(res.body.tagSemantics.field).toBe("paperClose.symbol")
    expect(res.body.tagSemantics.scope).toBe("per-asset")
    // Every leg reports presence AND its reason when absent. None is bucketed
    // under a placeholder.
    expect(res.body.legs.backtest.present).toBe(false)
    expect(res.body.legs.backtest.reasons).toContain("backtest-windows-not-persisted")
    expect(res.body.legs.live.present).toBe(false)
    expect(res.body.legs.live.reasons).toContain("strategy-tag-unavailable")
    expect(typeof res.body.legs.paper.present).toBe("boolean")
    // The read limit is DISCLOSED beside the count it bounds. `paperHistory`
    // answers the most recent `limit` closes, so a count is a window onto the
    // history — and a reader who cannot see the cap would read it as the whole.
    expect(typeof res.body.legs.paper.readLimit).toBe("number")
    expect(res.body.legs.paper.readLimit).toBeGreaterThan(0)
    expect(Array.isArray(res.body.legs.paper.reasons)).toBe(true)
  })

  it("names the read-limit truncation instead of reporting a capped count as a whole history", async () => {
    // A pile sitting exactly AT the cap is indistinguishable from one that fits,
    // so the route reports the cap's own reason and the reader can act on it.
    seedCloses(
      tradingDir,
      Array.from({ length: 500 }, (_, i) => ({
        id: `c${i}`,
        symbol: "BTCUSD",
        amount: 1000,
        pnl: 1,
        openedAt: "2026-09-01T09:00:00.000Z",
        closedAt: `2026-09-01T09:00:${String(i % 60).padStart(2, "0")}.000Z`
      }))
    )
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    expect(res.body.legs.paper.rowsSeen).toBe(500)
    expect(res.body.legs.paper.readLimit).toBe(500)
    expect(res.body.legs.paper.reasons).toContain("paper-closes-read-limit-reached")
    // Still `present` — a capped read is not an absent one, and the two reasons
    // are separate fields precisely so neither can overwrite the other.
    expect(res.body.legs.paper.present).toBe(true)
  })

  it("discloses the LIVE leg's read cap with the same treatment the paper leg gets", async () => {
    // I3. `listFillCosts` defaults to `limit = 500` and applies `.slice(0, limit)`
    // (costs/store.mjs:84-91). The route passed no limit and reported none, so
    // past 500 rows `legs.live.rowsSeen` was a bare capped number — contradicting
    // the route's own "the absence below is a MEASURED one" comment.
    const costsStore = await import("../services/costs/store.mjs")
    for (let i = 0; i < 500; i += 1) {
      costsStore.recordFillCost({
        venue: "hyperliquid",
        route: "close",
        kind: "fee",
        amountUsd: 0.01,
        ccy: "USDT",
        provenance: "measured"
      })
    }
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)

    expect(res.body.legs.live.readLimit).toBeGreaterThan(0)
    expect(res.body.legs.live.rowsSeen).toBe(500)
    expect(res.body.legs.live.reasons).toContain("live-fills-read-limit-reached")
    // The identity reason is kept alongside it — a capped read does not replace
    // the reason the leg cannot be bucketed at all.
    expect(res.body.legs.live.reasons).toContain("strategy-tag-unavailable")
    // Every leg carries the read-limit field, so no leg can be structurally
    // unable to disclose its cap.
    for (const name of ["backtest", "paper", "live"]) {
      // Every leg carries the field, so no leg is structurally unable to
      // disclose a cap. `backtest` reports `null` because no read was attempted
      // and there is no population to be capped below.
      expect(res.body.legs[name], `${name} must carry readLimit`).toHaveProperty("readLimit")
      expect(res.body.legs[name].readLimit === null || Number.isInteger(res.body.legs[name].readLimit)).toBe(true)
    }
    expect(res.body.legs.backtest.readLimit).toBeNull()
  })

  it("buckets paper closes per traded symbol and maps pnl/amount onto returnPct in percent", async () => {
    seedCloses(tradingDir, [
      { id: "c1", symbol: "BTCUSD", amount: 1000, pnl: 2, openedAt: "2026-09-01T09:00:00.000Z", closedAt: "2026-09-01T10:00:00.000Z" },
      { id: "c2", symbol: "BTCUSD", amount: 1000, pnl: -5, openedAt: "2026-09-02T09:00:00.000Z", closedAt: "2026-09-02T10:00:00.000Z" },
      { id: "c3", symbol: "ETHUSD", amount: 500, pnl: 10, openedAt: "2026-09-03T09:00:00.000Z", closedAt: "2026-09-03T10:00:00.000Z" }
    ])
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    expect(res.body.strategies.map((s) => s.tag)).toEqual(["BTCUSD", "ETHUSD"])

    const btc = res.body.strategies[0]
    expect(btc.windowsSeen).toBe(2)
    // NO BAR IS SUPPLIED, so no window is STREAK evidence and every one of them
    // is skipped with that reason. Never silently promoted into the evidence pile.
    expect(btc.windowsUsed).toBe(0)
    expect(btc.skipped["bar-unavailable"]).toBe(2)
    expect(btc.stage).toBe("paper")
    expect(btc.verdict).toBe("no-verdict")
    expect(btc.promoted).toBe(false)
    expect(btc.reasons).toContain("bar-unavailable")
    expect(btc.reasons).toContain("below-floor")
    expect(btc.reasons).toContain("mainnet-ceremony-required")

    // pnl 2 on amount 1000 is +0.2 PERCENT, not 0.002 and not 2. With ONE
    // window the recency weight cancels against itself, so ETHUSD's 10/500
    // returns as exactly 2 — a value only the percent mapping produces.
    expect(res.body.strategies[1].stats.returnPct.value).toBe(2)

    // BTCUSD is +0.2 (2026-09-01) then -0.5 (2026-09-02). The LATER window is
    // weighted MORE heavily, so the weighted mean is pulled BELOW the flat mean
    // of -0.15 rather than landing on it. A plain average would report exactly
    // -0.15, so this also pins that recency weighting is really applied here
    // and that no window is averaged in as a zero.
    const weighted = btc.stats.returnPct
    expect(Number.isFinite(weighted.value)).toBe(true)
    expect(weighted.value).toBeGreaterThan(-0.5)
    expect(weighted.value).toBeLessThan(-0.15)
    expect(weighted.reason).toBeNull()
    expect(weighted.windowsMeasured).toBe(2)

    expect(res.body.legs.paper.present).toBe(true)
    expect(res.body.legs.paper.windows).toBe(3)
  })

  it("EXCLUDES a close it cannot read rather than coercing it into a window", async () => {
    seedCloses(tradingDir, [
      { id: "ok", symbol: "BTCUSD", amount: 1000, pnl: 2, openedAt: "2026-09-01T09:00:00.000Z", closedAt: "2026-09-01T10:00:00.000Z" },
      // no openedAt: a zero-width window defaulted to "now" would sort into a
      // chronology it never belonged to and count toward a consecutive gate
      { id: "no-open", symbol: "BTCUSD", amount: 1000, pnl: 3 },
      // no closedAt
      { id: "no-close", symbol: "BTCUSD", amount: 1000, pnl: 4, openedAt: "2026-09-02T09:00:00.000Z" },
      // blank amount is ABSENCE, not zero: Number("") is 0, and a measured 0
      // return would read as a genuinely flat window
      { id: "blank-amount", symbol: "BTCUSD", amount: "  ", pnl: 5, openedAt: "2026-09-03T09:00:00.000Z", closedAt: "2026-09-03T10:00:00.000Z" },
      // zero amount committed no capital, so it has no return to express
      { id: "zero-amount", symbol: "BTCUSD", amount: 0, pnl: 6, openedAt: "2026-09-04T09:00:00.000Z", closedAt: "2026-09-04T10:00:00.000Z" }
    ])
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)

    // Only the closes with usable BOUNDS became windows: the two without a
    // usable start or end are excluded outright, and the two with usable
    // bounds but no usable return stay windows whose return reads absent.
    expect(res.body.strategies).toHaveLength(1)
    expect(res.body.strategies[0].windowsSeen).toBe(3)
    expect(res.body.legs.paper.rowsSeen).toBe(5)
    expect(res.body.legs.paper.windows).toBe(3)

    // Each exclusion is COUNTED UNDER ITS OWN REASON. The two closes with no
    // usable bounds are named; the two with usable bounds but no usable return
    // stay windows whose return reads absent, not zero.
    const keys = res.body.excluded.map((row) => row.key)
    expect(keys).toContain("paper:windowStart:missing")
    expect(keys).toContain("paper:windowEnd:missing")
    expect(res.body.excluded.find((r) => r.key === "paper:windowStart:missing").count).toBe(1)

    // The two bounded-but-unmeasurable closes ARE windows, and their return is
    // null with the sibling module's reason — never 0.
    const returns = res.body.strategies[0].sources.paper
    expect(returns.windowsSeen).toBe(3)
    // Exactly ONE of the three windows measured a return. The blank amount and the
    // zero amount both read absent, so neither contributed a value AND neither
    // inflated the measured count — a blank field that became 0 would have made
    // this three, and would have argued the tag over a line nobody measured.
    expect(res.body.strategies[0].stats.returnPct.windowsMeasured).toBe(1)
  })

  it("builds the equity pile from the WINDOW pile, so a close with no usable bounds contributes no P&L step", async () => {
    // I2. The window pile drops a close with no usable start/end; the equity
    // pile must be built FROM that pile, not from the raw closes. In this
    // fixture all five closes carry a usable `pnl`, so before the fix sharpe and
    // maxDd reported a count of FIVE against windowsSeen of THREE: two closes
    // the window pile had already rejected as unmeasurable-in-time still moved
    // the equity curve.
    seedCloses(tradingDir, [
      { id: "ok-1", symbol: "BTCUSD", amount: 1000, pnl: 2, openedAt: "2026-09-01T09:00:00.000Z", closedAt: "2026-09-01T10:00:00.000Z" },
      { id: "ok-2", symbol: "BTCUSD", amount: 1000, pnl: -5, openedAt: "2026-09-02T09:00:00.000Z", closedAt: "2026-09-02T10:00:00.000Z" },
      { id: "ok-3", symbol: "BTCUSD", amount: 1000, pnl: 4, openedAt: "2026-09-03T09:00:00.000Z", closedAt: "2026-09-03T10:00:00.000Z" },
      // rejected by the window pile for a missing bound — must NOT reach the
      // equity path, even though its pnl is perfectly readable
      { id: "no-open", symbol: "BTCUSD", amount: 1000, pnl: 999, closedAt: "2026-09-04T10:00:00.000Z" },
      { id: "no-close", symbol: "BTCUSD", amount: 1000, pnl: -999, openedAt: "2026-09-05T09:00:00.000Z" }
    ])
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    const row = res.body.strategies[0]
    expect(row.windowsSeen).toBe(3)

    // The equity statistics are built over exactly the window pile.
    expect(row.stats.sharpe.count).toBe(3)
    expect(row.stats.maxDd.count).toBe(3)
    // And nothing anywhere reports a count of five.
    expect(row.stats.sharpe.count).not.toBe(5)
    expect(row.stats.maxDd.count).not.toBe(5)

    // THE VALUE PROVES IT, not just the count: recomputing over the three
    // windowed closes must reproduce the shipped figures exactly. Recomputing
    // over all five would fold in +999 and -999 and change the answer.
    const analytics = await import("../services/analytics.mjs")
    const windowed = [
      { pnl: 2, amount: 1000, closedAt: "2026-09-01T10:00:00.000Z", holdingMs: 3_600_000 },
      { pnl: -5, amount: 1000, closedAt: "2026-09-02T10:00:00.000Z", holdingMs: 3_600_000 },
      { pnl: 4, amount: 1000, closedAt: "2026-09-03T10:00:00.000Z", holdingMs: 3_600_000 }
    ]
    expect(row.stats.maxDd.value).toBe(
      Math.max(
        ...analytics
          .drawdownSeries(analytics.equitySeries(windowed, 3000))
          .map((p) => p.drawdownDollars)
      )
    )
    expect(row.stats.sharpe.value).toBe(analytics.metricsFrom(windowed, 3000).annualizedSharpe)
  })

  it("SURFACES rowsUnmeasured: a window whose pnl cannot be read is counted, not silently dropped", async () => {
    // I1. The field was computed and returned by the adapter but never reached
    // the payload, while a comment claimed it was reported. A tag whose closes
    // have an unreadable pnl loses them from the equity path with nothing
    // anywhere saying how many were lost.
    seedCloses(tradingDir, [
      { id: "ok-1", symbol: "BTCUSD", amount: 1000, pnl: 2, openedAt: "2026-09-01T09:00:00.000Z", closedAt: "2026-09-01T10:00:00.000Z" },
      { id: "ok-2", symbol: "BTCUSD", amount: 1000, pnl: -5, openedAt: "2026-09-02T09:00:00.000Z", closedAt: "2026-09-02T10:00:00.000Z" },
      { id: "ok-3", symbol: "BTCUSD", amount: 1000, pnl: 4, openedAt: "2026-09-03T09:00:00.000Z", closedAt: "2026-09-03T10:00:00.000Z" },
      // usable BOUNDS (so it IS a window) but an unusable pnl (blank string):
      // it is counted in windowsSeen and must also be counted as unmeasured.
      { id: "blank-pnl", symbol: "BTCUSD", amount: 1000, pnl: "  ", openedAt: "2026-09-04T09:00:00.000Z", closedAt: "2026-09-04T10:00:00.000Z" }
    ])
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    const row = res.body.strategies[0]

    // Four windows, one of which measured no pnl.
    expect(row.windowsSeen).toBe(4)
    // THE DISCLOSURE: the gap between the pile size and the sample that produced
    // the statistics is stated, with both halves, rather than left to be inferred.
    expect(row.stats.rowsUnmeasured).toBe(1)
    expect(row.stats.rowsInEquityPile).toBe(3)
    // And the sample size that produced each statistic travels with it.
    expect(row.stats.sharpe.count).toBe(3)
    expect(row.stats.maxDd.count).toBe(3)
    // The identity is checkable: window pile = equity pile + unmeasured.
    expect(row.stats.rowsInEquityPile + row.stats.rowsUnmeasured).toBe(row.windowsSeen)
  })

  it("reports a close with no usable symbol as UNATTRIBUTED, never under a placeholder tag", async () => {
    seedCloses(tradingDir, [
      { id: "ok", symbol: "BTCUSD", amount: 1000, pnl: 2, openedAt: "2026-09-01T09:00:00.000Z", closedAt: "2026-09-01T10:00:00.000Z" },
      { id: "blank-symbol", symbol: "   ", amount: 1000, pnl: 2, openedAt: "2026-09-02T09:00:00.000Z", closedAt: "2026-09-02T10:00:00.000Z" },
      // `null`, not a missing key: JSON.stringify drops an `undefined`, which
      // would let the fixture's own default symbol back in.
      { id: "no-symbol", symbol: null, amount: 1000, pnl: 2, openedAt: "2026-09-03T09:00:00.000Z", closedAt: "2026-09-03T10:00:00.000Z" }
    ])
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    // Exactly ONE row, and it is the real symbol. No "unknown"/"UNKNOWN" bucket.
    expect(res.body.strategies.map((s) => s.tag)).toEqual(["BTCUSD"])
    expect(res.body.unattributed.rows).toBe(2)
    expect(res.body.unattributed.reason).toBe("strategy-tag-unavailable")
    expect(res.body.incomplete).toBe(true)
  })

  it("derives the paper leg's sharpe and drawdown by AGGREGATION, matching analytics.mjs exactly", async () => {
    const closes = [
      { id: "c1", symbol: "BTCUSD", amount: 1000, pnl: 2, openedAt: "2026-09-01T09:00:00.000Z", closedAt: "2026-09-01T10:00:00.000Z" },
      { id: "c2", symbol: "BTCUSD", amount: 1000, pnl: -5, openedAt: "2026-09-02T09:00:00.000Z", closedAt: "2026-09-02T10:00:00.000Z" },
      { id: "c3", symbol: "BTCUSD", amount: 1000, pnl: 10, openedAt: "2026-09-03T09:00:00.000Z", closedAt: "2026-09-03T10:00:00.000Z" }
    ]
    seedCloses(tradingDir, closes)
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)

    // Recomputed INDEPENDENTLY from the same read-only helpers the route must
    // use. Equality here is the proof that the route aggregates with
    // `services/analytics.mjs` rather than reimplementing the math.
    const analytics = await import("../services/analytics.mjs")
    const oldestFirst = [...closes].sort((a, b) => a.closedAt.localeCompare(b.closedAt))
    const capital = 3000
    const dd = analytics.drawdownSeries(analytics.equitySeries(oldestFirst, capital))

    const stats = res.body.strategies[0].stats
    expect(stats.sharpe.value).toBe(analytics.metricsFrom(oldestFirst, capital).annualizedSharpe)
    expect(stats.maxDd.value).toBe(Math.max(...dd.map((p) => p.drawdownDollars)))
    expect(stats.maxDd.pct).toBe(Math.max(...dd.map((p) => p.drawdown)))
    expect(stats.capitalCommittedUsd).toBe(capital)
    // The base the percentage is a ratio of is stated, so the ratio is readable.
    expect(stats.maxDd.count).toBe(3)
    expect(stats.sharpe.reason).toBeNull()
    expect(stats.maxDd.reason).toBeNull()
  })

  it("reads a SINGLE close's sharpe and drawdown as absent with a reason, never zero", async () => {
    seedCloses(tradingDir, [
      { id: "c1", symbol: "BTCUSD", amount: 1000, pnl: 2, openedAt: "2026-09-01T09:00:00.000Z", closedAt: "2026-09-01T10:00:00.000Z" }
    ])
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    const stats = res.body.strategies[0].stats
    // One observation has no spread and no peak-to-trough. Reporting 0 here is
    // the defect: a lucky single win would read as a riskless track record.
    expect(stats.sharpe.value).toBeNull()
    expect(stats.sharpe.reason).toBe("insufficient-observations")
    expect(stats.maxDd.value).toBeNull()
    expect(stats.maxDd.pct).toBeNull()
    expect(stats.maxDd.reason).toBe("insufficient-observations")
    expect(stats.capitalCommittedUsd).toBe(1000)
  })

  it("surfaces cost drag as UNADJUSTED measured evidence with its modeled provenance", async () => {
    const closes = [
      { id: "c1", symbol: "BTCUSD", amount: 1000, pnl: 2, openedAt: "2026-09-01T09:00:00.000Z", closedAt: "2026-09-01T10:00:00.000Z" },
      { id: "c2", symbol: "BTCUSD", amount: 1000, pnl: -5, openedAt: "2026-09-02T09:00:00.000Z", closedAt: "2026-09-02T10:00:00.000Z" }
    ]
    seedCloses(tradingDir, closes)
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)

    // The drag is the W3-02 total, and `adjusted: false` is asserted because a
    // drag-ADJUSTED return would be an arithmetic this route invented: no layer
    // in the stack defines a drag policy.
    const drag = res.body.strategies[0].stats.costDragUsd
    expect(Number.isFinite(drag.value)).toBe(true)
    expect(drag.value).toBeGreaterThan(0)
    expect(drag.adjusted).toBe(false)
    expect(drag.reason).toBeNull()
    // Paper charges no explicit fee, so W3-02's fee leg is a modeled zero and
    // the whole line is MODELED. Reporting it without that label would let a
    // reader take a modeled number for a measured one.
    expect(drag.provenances).toEqual(["modeled"])

    // The return beside it is the RAW, un-adjusted one.
    expect(res.body.strategies[0].stats.returnPct.value).toBeLessThan(-0.15)
  })

  it("cannot mark or close paper positions (byte-identical ledger)", async () => {
    seedCloses(tradingDir, [
      { id: "c1", symbol: "BTCUSD", amount: 1000, pnl: 2, openedAt: "2026-09-01T09:00:00.000Z", closedAt: "2026-09-01T10:00:00.000Z" }
    ])
    const ledgerFile = join(tradingDir, "trading-ledger.json")
    const before = readFileSync(ledgerFile, "utf8")
    const { api, headers } = await authed()
    const res = await call(api, "GET", OVERVIEW, undefined, headers)
    expect(res.status).toBe(200)
    expect(readFileSync(ledgerFile, "utf8"), "overview must not write the paper ledger").toBe(before)
  })

  it("keeps the route's own source honest: gate first, no clock, no env, no write path", async () => {
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    // THE SHARED LEXER, so a `requireAuth` written inside a comment cannot pass
    // this as a gate, and so the scans below are not defeated by prose either.
    const { stripComments } = await import("../scripts/guard-primitives.mjs")
    const code = stripComments(src)

    const start = code.indexOf('path === "/api/graduation/overview"')
    expect(start, "the graduation route must exist").toBeGreaterThan(-1)
    const end = code.indexOf('path === "/api/tax/lots"', start)
    expect(end, "the graduation route must be a bounded block").toBeGreaterThan(start)
    const block = code.slice(start, end)

    // THE GATE IS THE FIRST STATEMENT, not merely present.
    const body = block.slice(block.indexOf("{") + 1)
    expect(body.trimStart().startsWith("if (!(await requireAuth(req, res))) return")).toBe(true)

    // NO CLOCK IN THE ROUTE. `decayWeight` owns the wall clock; a `Date.now()`
    // here would be a second, untested clock the route could drift against.
    expect(block).not.toMatch(/Date\.now|new Date\(|performance\.now/)
    // NO ENVIRONMENT READ. The half-life is resolved inside `weighting.mjs`;
    // re-reading its variable here would duplicate a precedence rule.
    expect(block).not.toMatch(/process\.env/)
    // NO WRITE PATH. Read-only, like every other W3 readout.
    for (const forbidden of [
      "closePaperTrade",
      "markToMarket",
      "paperAnalytics(",
      "saveLedger",
      "recordFillCost",
      "rollupDay"
    ]) {
      expect(block, `the graduation route must not reach ${forbidden}`).not.toContain(forbidden)
    }
    // NO BAR IS INVENTED INLINE, and no bar is read from an env var.
    expect(block).not.toMatch(/hitRateNet\s*:\s*0?\.\d/)
    expect(block).toContain("graduationBars()")
    // EVERY SERVICE IS DYNAMICALLY IMPORTED, so the static-import count the
    // bootstrap guard pins does not move.
    expect(code.slice(0, code.indexOf("export async function handleApi"))).not.toContain("graduation/")
  })
})