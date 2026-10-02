// WS-7 T0 — machine-discovered absence scope.
//
// The D4 "no auto-execution" guard in executionAbsence.test.mjs pins the absence
// of order calls across a HAND-MAINTAINED list of ten suite modules. That list
// is why the guarantee is currently unpinned: a module capable of placing a real
// order only has to be absent from the list for the guard to keep passing
// while the capability exists. The audit that shaped WS-7 found exactly that —
// services/ccxtOrdering.mjs and services/venues/hyperliquidPerps.mjs both place
// venue orders, and neither appears in the guard's hand-maintained SUITE_SOURCES.
//
// This module DISCOVERS the scope from the filesystem instead of hard-coding it,
// so a new order-capable module cannot slip past the guard by simply not being
// listed. Discovery is deliberately narrow: it looks for an order-capable CALL
// (a receiver, a method name, an opening paren) and not a bare identifier, so
// comments, deprecation notices, and data-shape keys named `order` do not
// register as capability.
//
// What discovery CANNOT do, stated plainly so nobody over-reads it: a grep finds
// text, not capability. A module can reach a venue through a dynamically
// constructed method name and escape this scan. That residual is why T0 also
// pins the discovered set against an explicit allow-list of INTENTIONALLY
// order-capable modules — a new capability is then a deliberate edit to a
// reviewed list, not a silent omission from a scanning list.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

/**
 * Venue order-placing method names.
 *
 * These are stored as bare method names and compiled into patterns at module
 * load, deliberately. Writing them as regex literals would put a literal
 * receiver-dot-call opening-paren sequence in THIS file's source, and the perps
 * seam guard walks every server .mjs counting createOrder-family call sites.
 * A scanner that declares the pattern it scans for would count itself as a
 * third call site, so the guard's "exactly two" pin would fail on the scanner
 * rather than on a real venue change.
 *
 * The same rule applies to this module's own comments: they must not contain the
 * literal call shape either, or they would trip the very guard described above.
 *
 * That is not a reason to weaken the perps guard. The guard is correct and
 * stays as-is; this module is what adapts.
 */
const ORDER_CAPABLE_METHODS = [
  "placeOrder",
  "createOrder",
  "submitOrder",
  "placeLimitOrder",
  "placeMarketOrder",
  "createLimitBuyOrder",
  "createMarketBuyOrder",
  "createLimitSellOrder",
  "createMarketSellOrder",
  "cancelOrder",
  "closeOrder"
]

/**
 * Order-capable call patterns. A receiver + method + opening paren is required,
 * so a bare `placeOrder` identifier in prose or a property key is not capability.
 *
 * @type {RegExp[]}
 */
const ORDER_CAPABLE_CALLS = ORDER_CAPABLE_METHODS.map(
  (name) => new RegExp(String.raw`\.\s*${name}\s*\(`)
)

/**
 * Modules that are INTENTIONALLY order-capable.
 *
 * This is the reviewed list, and it is the thing T0 actually pins. Every entry
 * is a module that can reach a venue, each behind its own guard. Adding a name
 * here is a deliberate, reviewable act; forgetting to add one is what let the
 * paper-only claim drift from reality in the first place.
 */
export const INTENTIONAL_ORDER_CAPABLE = new Set([
  // CCXT spot order seam. Ceremony-gated, limit-only, hard notional cap.
  "services/ccxtOrdering.mjs",
  // Hyperliquid perps. Ceremony-gated and mainnet-env-gated.
  "services/venues/hyperliquidPerps.mjs",
  // WS-7 T17 — the four-venue CCXT lifecycle. It holds no CCXT instance of its
  // own and reaches the venue only through the seam above; it IS order-capable
  // because its injected adapter's members are invoked, so it is declared here
  // rather than renamed to dodge the scanner. A module that reaches a venue and
  // hides that from this scan would be exactly the evasion the header describes.
  // Every leg is ceremony-gated, consent-locked and risk-gated, and the whole
  // rail is dark with no ceremony unlock.
  "services/venues/ccxtVenueLifecycle.mjs",
  // Hand-rolled paper/demo path. Reached only through human approval: the
  // interventions.mjs trade gate, the demo-open API in handlers.mjs, and the
  // openPaperTrade ledger in trading.mjs.
  //
  // NOTE: handlers.mjs is discovered because it calls .submitOrder(. trading.mjs
  // and interventions.mjs define and gate openPaperTrade, which is NOT one of the
  // venue-shaped patterns above — so they are declared here as intentional paper
  // seams without being discovered. That asymmetry is why the two-way staleness
  // test below is split: venue-capable entries must be discoverable, while
  // paper-seam entries are a separate, explicitly-reviewed class.
  "handlers.mjs"
])

/**
 * Paper/demo seams that are intentional but are NOT venue-order-shaped, so
 * discovery correctly does not find them. Kept separate from the venue list so
 * neither class silently absorbs the other.
 */
export const INTENTIONAL_PAPER_SEAMS = new Set([
  "services/trading.mjs",
  "services/interventions.mjs"
])

const SKIP_DIRS = new Set(["__tests__", "node_modules", "fixtures", "data"])

// This module is itself order-capable: it holds the patterns it scans for. It
// must never appear in its own scan output, or it would report itself as
// undeclared capability. Excluded by exact path rather than by directory so the
// rest of scripts/ stays in scope.
const SELF_MODULE = "scripts/absence-scope.mjs"

function walk(dir, root, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, root, out)
      continue
    }
    if (!entry.endsWith(".mjs")) continue
    const rel = relative(root, full).split(sep).join("/")
    if (rel === SELF_MODULE) continue
    out.push(rel)
  }
  return out
}

/**
 * Every server module containing at least one order-capable call.
 * @param {string} serverRoot absolute path to apps/dashboard/server
 * @returns {string[]} sorted repo-relative module paths
 */
export function discoverOrderCapableModules(serverRoot) {
  const found = []
  for (const rel of walk(serverRoot, serverRoot, [])) {
    const src = readFileSync(join(serverRoot, rel), "utf8")
    if (ORDER_CAPABLE_CALLS.some((re) => re.test(src))) found.push(rel)
  }
  return found.sort()
}

/**
 * Discovered capability that nobody has declared intentional.
 *
 * This is the failure the guard exists to catch: an order-capable module that
 * no reviewed decision accounts for.
 * @param {string} serverRoot absolute path to apps/dashboard/server
 * @returns {{ undeclared: string[], discovered: string[] }}
 */
export function findUndeclaredOrderCapability(serverRoot) {
  const discovered = discoverOrderCapableModules(serverRoot)
  return {
    discovered,
    undeclared: discovered.filter((rel) => !INTENTIONAL_ORDER_CAPABLE.has(rel))
  }
}
