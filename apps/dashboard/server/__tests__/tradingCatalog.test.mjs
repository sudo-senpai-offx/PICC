import { describe, expect, it } from "vitest"
import { tradingCatalog, tradingCatalogIds } from "../services/tradingCatalog.mjs"
import { yahooSymbolFor } from "../services/assetCatalog.mjs"
import { handleApi } from "../handlers.mjs"

// T4 acceptance (Decision D): grouped shape, every entry symbol-resolvable
// (no undefined), QUICK_ASSETS all present, endpoint reachable over HTTP.

function makeReq(method, url) {
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json" },
    raw: null,
    on(evt, cb) {
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
    end(json) {
      this.body = json ? JSON.parse(json) : null
    },
    setHeader() {},
    getHeader() {},
    removeHeader() {}
  }
}

const QUICK_ASSETS = ["EURUSD", "GBPUSD", "BTCUSD", "ETHUSD", "GOLD", "AUDUSD"]

describe("trading catalog (T4)", () => {
  it("returns grouped categories with resolvable symbols — never an undefined yahooSymbol", () => {
    const { categories } = tradingCatalog()
    expect(Array.isArray(categories)).toBe(true)
    expect(categories.length).toBeGreaterThanOrEqual(6)
    for (const cat of categories) {
      expect(typeof cat.id).toBe("string")
      expect(typeof cat.name).toBe("string")
      expect(Array.isArray(cat.symbols)).toBe(true)
      for (const s of cat.symbols) {
        expect(typeof s.id).toBe("string")
        expect(typeof s.name).toBe("string")
        // Decision D invariant: every entry must resolve — never undefined/empty.
        expect(s.yahooSymbol).toBeTruthy()
        expect(yahooSymbolFor(s.id)).toBe(s.yahooSymbol)
      }
    }
  })

  it("contains every QUICK_ASSETS id (the quick-analysis buttons are catalog assets)", () => {
    const ids = new Set(tradingCatalogIds())
    for (const qa of QUICK_ASSETS) expect(ids.has(qa)).toBe(true)
  })

  it("ships a curated equity/ETF set of at least 20 liquid tickers", () => {
    const byCat = Object.fromEntries(tradingCatalog().categories.map((c) => [c.id, c.symbols]))
    const curated = [...(byCat.equities ?? []), ...(byCat.etfs ?? [])]
    expect(curated.length).toBeGreaterThanOrEqual(20)
    // Equity/ETF ids pass through their own symbol untouched.
    for (const s of curated) expect(s.yahooSymbol).toBe(s.id)
  })

  it("GET /api/trading/catalog serves the grouped payload over HTTP", async () => {
    const res = makeRes()
    await handleApi(makeReq("GET", "/api/trading/catalog"), res, "/api/trading/catalog")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(Array.isArray(res.body.categories)).toBe(true)
    expect(res.body.categories[0].symbols.length).toBeGreaterThan(0)
  })
})