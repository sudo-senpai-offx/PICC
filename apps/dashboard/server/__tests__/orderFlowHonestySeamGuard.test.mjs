// P0 honesty seam guard — order-flow must never be derived from candle structure.
//
// Context: the pre-hotfix orderFlow.mjs inferred buy/sell delta from candle
// body direction and published it as `imbalance`, `bullish-absorption`,
// `bearish-absorption`, and `divergence — hidden selling`. That is fabricated
// market microstructure. This guard pins the removal so it cannot silently
// return during WS-6 implementation.
//
// Contract sources: PICC Constitution; WS-6 D14 / AC-008;
// server/services/v32Execution.mjs (`volumeDelta` honest-null shape).
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const source = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

const stripComments = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")

const ORDER_FLOW = "../services/orderFlow.mjs"
const HANDLERS = "../handlers.mjs"

const orderFlowCode = stripComments(source(ORDER_FLOW))
const handlersCode = stripComments(source(HANDLERS))

// Identifiers that only exist in the removed candle-derived approximation.
const FABRICATION_IDENTIFIERS = ["bodyRatio", "buyPct", "sellPct"]

function routeBlock(code) {
  const start = code.indexOf('"/api/trading/orderflow"')
  expect(start, "orderflow route must exist in handlers.mjs").toBeGreaterThan(-1)
  // The route is a short `if` block terminated by the next top-level route path.
  const next = code.indexOf('if (path === "/api/', start + 1)
  return code.slice(start, next === -1 ? start + 1200 : next)
}

describe("order-flow honesty seam guard (WS-6 D14 / AC-008)", () => {
  it("orderFlow.mjs contains no candle-body delta derivation", () => {
    for (const id of FABRICATION_IDENTIFIERS) {
      expect(orderFlowCode, `orderFlow.mjs must not reference ${id}`).not.toContain(id)
    }
  })

  it("orderFlow.mjs does not branch on candle high/low/open/close fields", () => {
    // A real signed-trades implementation never needs intrabar structure.
    for (const field of ["c.high", "c.low", "c.open", "c.close", "bar.close", "bar.open"]) {
      expect(orderFlowCode, `orderFlow.mjs must not derive from ${field}`).not.toContain(field)
    }
  })

  it("orderFlow.mjs declares the honest unavailable contract", () => {
    expect(orderFlowCode).toMatch(/available:\s*false/)
    expect(orderFlowCode).toMatch(/imbalance:\s*"unavailable"/)
    expect(orderFlowCode).toMatch(/cumulative:\s*null/)
    expect(orderFlowCode).toMatch(/dataFidelity/)
    expect(orderFlowCode).toMatch(/reason/)
  })

  it("orderFlow.mjs still computes genuinely from a signed-trades feed", () => {
    // Guard against "fixing" the defect by stubbing the module out.
    expect(orderFlowCode).toMatch(/available:\s*true/)
    expect(orderFlowCode).toMatch(/dataFidelity:\s*"signed-trades"/)
    expect(orderFlowCode).toContain('side === "buy"')
    expect(orderFlowCode).toContain('side === "sell"')
  })

  it("the HTTP route cannot be made available by a client-supplied trades array", () => {
    const block = routeBlock(handlersCode)
    expect(block, "route must not read trades from the request body").not.toMatch(/body\??\.trades/)
    expect(block).not.toMatch(/body\??\.orderFlowTrades/)
    // The only body reads permitted are bars/candles and lookback.
    expect(block).toMatch(/body\??\.candles/)
  })

  it("no test re-asserts the removed buyPct/sellPct fabrication", () => {
    // Negative assertions legitimately NAME the removed field
    // (`not.toHaveProperty("buyPct")`), so match only reads/constructions:
    // property access (`.buyPct`) or object-literal key (`buyPct:`).
    const reads = [/\.buyPct\b/, /\.sellPct\b/, /\bbuyPct\s*:/, /\bsellPct\s*:/]
    for (const f of ["../__tests__/orderFlow.test.mjs", "../__tests__/decisionEngine.test.mjs", "../__tests__/liveTestingPrep.test.mjs"]) {
      const code = stripComments(source(f))
      for (const re of reads) {
        expect(code, `${f} must not read or construct ${re}`).not.toMatch(re)
      }
    }
  })
})
