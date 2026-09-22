// WS-1 T9 no-regression seam guard — pins, at SOURCE level (real files read
// from disk, no module imported), that the perps live-order path reaches CCXT
// `createOrder` ONLY through the ordering seam's swap instance and that the
// spot leg stays the sole `placeCcxtOrder` carve-out. A reintroduced direct
// call anywhere else in the server tree fails the gate.
//
// Mirrors executionAbsence.test.mjs: same readFileSync/fileURLToPath/new URL
// style, same "forbidden elsewhere, sanctioned seam only" shape. What stays
// legal:
//   - services/ccxtOrdering.mjs:246 — `placeCcxtOrder`'s spot leg (sanctioned).
//   - services/venues/hyperliquidPerps.mjs:331 — `submitOrder` on the swap
//     instance produced by swapInstance() = ccxtInstanceFor("hyperliquid",
//     { requireKeys: true, defaultType: "swap", sandbox: true }) (:133-135).
// READ_ONLY_BLOCKED (ccxtConnector.mjs:33-66) is asserted untouched so every
// non-seam module stays read-only; the audit-trail export pins keep the
// floor's rail suites meaningful without duplicating their integrity checks.
//
// NOT pinned as plain tokens (legit doc words that share characters, as in
// executionAbsence): hyperliquidPerps.mjs's header (:4-7) STATES the seam rule
// in prose — "Never `new ccxt...`", "never `placeCcxtOrder`" — so those two
// words appear exactly once each IN THE HEADER COMMENT ONLY. The guard pins
// the behavior: no `new ccxt` construction and no `placeCcxtOrder` invocation
// anywhere in the file.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const serverRoot = fileURLToPath(new URL("..", import.meta.url))

// The amputated-path pin (ccxtConnector.mjs:33-66): EVERY entry the read-only
// guard must still list, mirroring the live export order. Asserted as quoted
// tokens inside the array block.
const READ_ONLY_BLOCKED_TOKENS = [
  '"createOrder"',
  '"createOrders"',
  '"createOrderWs"',
  '"createOrdersWs"',
  '"editOrder"',
  '"editOrders"',
  '"editOrderWs"',
  '"cancelOrder"',
  '"cancelOrders"',
  '"cancelOrdersWs"',
  '"cancelAllOrders"',
  '"cancelAllOrdersWs"',
  '"cancelWsOrder"',
  '"setLeverage"',
  '"setLeverageWs"',
  '"setMarginMode"',
  '"setPositionMode"',
  '"setMargin"',
  '"addMargin"',
  '"reduceMargin"',
  '"setSandboxMode"',
  '"transfer"',
  '"transferWs"',
  '"withdraw"',
  '"withdrawWs"',
  '"borrowMargin"',
  '"repayMargin"',
  '"borrowCrossMargin"',
  '"repayCrossMargin"',
  '"createDepositAddress"',
  '"closePosition"',
  '"closePositions"'
]

/** Deterministic top-down walk of server `*.mjs` files, skipping __tests__. */
function serverSources() {
  const out = []
  for (const rel of readdirSync(serverRoot).sort()) {
    const abs = join(serverRoot, rel)
    const s = statSync(abs)
    if (s.isDirectory()) {
      if (rel === "__tests__") continue
      for (const child of serverSourcesIn(abs)) out.push(child)
    } else if (rel.endsWith(".mjs")) {
      out.push(abs)
    }
  }
  return out
}

function serverSourcesIn(dir) {
  const out = []
  for (const rel of readdirSync(dir).sort()) {
    const abs = join(dir, rel)
    const s = statSync(abs)
    if (s.isDirectory()) {
      if (rel === "__tests__") continue
      out.push(...serverSourcesIn(abs))
    } else if (rel.endsWith(".mjs")) {
      out.push(abs)
    }
  }
  return out
}

function source(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
}

describe("WS-1 perps live-order seam guard (T9 no-regression)", () => {
  it("ccxtConnector.mjs READ_ONLY_BLOCKED still lists every amputated path entry", () => {
    const src = source("../services/ccxtConnector.mjs")
    expect(src).toContain("export const READ_ONLY_BLOCKED")
    const start = src.indexOf("export const READ_ONLY_BLOCKED = [")
    const end = src.indexOf("]", start)
    const block = src.slice(start, end)
    for (const token of READ_ONLY_BLOCKED_TOKENS) {
      expect(block, `READ_ONLY_BLOCKED must keep ${token}`).toContain(token)
    }
  })

  it("whole server tree has exactly two createOrder-family call sites — placeCcxtOrder (spot) and the perps seam instance", () => {
    const hits = {}
    for (const abs of serverSources()) {
      const label = relative(serverRoot, abs).split("\\").join("/")
      hits[label] = (readFileSync(abs, "utf8").match(/\.createOrder(?:s|Ws)?\s*\(/g) ?? []).length
    }
    const sites = Object.entries(hits).filter(([, n]) => n > 0)
    expect(sites).toEqual([
      ["services/ccxtOrdering.mjs", 1],
      ["services/venues/hyperliquidPerps.mjs", 1]
    ])
  })

  it("hyperliquidPerps.mjs reaches createOrder only through the seam's swap instance", () => {
    const src = source("../services/venues/hyperliquidPerps.mjs")
    const calls = src.match(/\.createOrder\s*\(/g) ?? []
    expect(calls).toHaveLength(1)
    expect(src).toContain('import { QUOTE_EQUIVALENTS, ccxtInstanceFor } from "../ccxtOrdering.mjs"')
    expect(src).toContain("ccxtInstanceFor(")
    // The two documented words appear ONLY in the header seam-rule comment
    // (:4-7) — never as a construction or an invocation.
    expect(src.match(/new ccxt\.[A-Za-z_$][$\w]*\s*\(/g) ?? []).toEqual([])
    expect(src.match(/new ccxt\s*\(/g) ?? []).toEqual([])
    expect(src.match(/placeCcxtOrder\s*\(/g) ?? []).toEqual([])
    expect(src.match(/new ccxt/g) ?? []).toHaveLength(1)
    expect(src.match(/placeCcxtOrder/g) ?? []).toHaveLength(1)
    // Swap-type pin (T2's id:type cache-key rule): the instance call passes
    // defaultType + sandbox, beating the spot defaults in ccxtOrdering.mjs.
    expect(src).toContain('DEFAULT_TYPE = "swap"')
    expect(src).toContain("defaultType: DEFAULT_TYPE")
    expect(src).toMatch(/sandbox:\s*true/)
  })

  it("audit trail module still exports the rail wiring (appendAudit + verifyAudit)", () => {
    const src = source("../services/commandCentre/auditTrail.mjs")
    expect(src).toContain("export function appendAudit")
    expect(src).toContain("export function verifyAudit")
  })
})