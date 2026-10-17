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

import { stripComments } from "../scripts/guard-primitives.mjs"

const source = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

const ORDER_FLOW = "../services/orderFlow.mjs"
const HANDLERS = "../handlers.mjs"

const orderFlowCode = stripComments(source(ORDER_FLOW))
const handlersCode = stripComments(source(HANDLERS))

// The files this guard reads through the shared lexer, named once so the
// line-preservation proof below cannot drift away from the scans above.
const STRIPPED_INPUTS = [
  ["orderFlow.mjs", source(ORDER_FLOW)],
  ["handlers.mjs", source(HANDLERS)],
  ...["orderFlow.test.mjs", "decisionEngine.test.mjs", "liveTestingPrep.test.mjs"].map((f) => [
    `${f}`,
    source(`../__tests__/${f}`)
  ])
]

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

  // THE MIGRATION HAZARD, PINNED ON THIS GUARD'S OWN INPUTS. This file used to
  // carry its own lexer, which DELETED comments instead of blanking them. That is
  // invisible while every assertion is a whole-file substring test, and fatal the
  // moment one reports a position: deleting a multi-line block comment removes
  // its newlines, so every line index after it names the wrong source line. The
  // shared lexer preserves both length and line count, and this asserts it on the
  // real files rather than on a fixture, so the contract cannot rot silently.
  it("the stripped view keeps every source line at its own index", () => {
    for (const [label, src] of STRIPPED_INPUTS) {
      const view = stripComments(src)
      expect(view.length, `${label}: length changed, so a column offset would point at the wrong token`).toBe(src.length)
      expect(view.split("\n"), `${label}: line count changed, so a file:line finding would name the wrong line`).toHaveLength(
        src.split("\n").length
      )
    }
  })

  it("a `//` inside a URL string in handlers.mjs survives, at its own line", () => {
    // `handlers.mjs` really does put URL defaults beside route logic, and the
    // lexer this guard used to carry had no string-literal awareness at all. The
    // line number is read from the source rather than written down, so the pin
    // names the FILE and the TOKEN and stays correct when the file is edited; if
    // it fails, the source line it names is where to look.
    const raw = source(HANDLERS).split("\n")
    const view = stripComments(source(HANDLERS)).split("\n")
    const line = raw.findIndex((l) => l.includes('"http://localhost:5173"'))
    expect(line, "handlers.mjs must still carry a localhost:5173 origin literal").toBeGreaterThan(-1)
    expect(view[line], `line ${line + 1} lost its URL`).toContain("http://localhost:5173")
    // Reading `view[line]` is only sound because the stripped view keeps one source
    // line per index, which the assertion above already proves FOR THIS FILE — it
    // is in `STRIPPED_INPUTS`. Not re-checked here: a third copy of the same length
    // comparison is not a route-span check, and this test locates no route.
  })
})
