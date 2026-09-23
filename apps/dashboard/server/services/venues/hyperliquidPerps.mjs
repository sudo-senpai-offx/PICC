// WS-1 F2 — Hyperliquid perps venue adapter. Implements the venue-adapter
// contract (venueAdapterContract.mjs) for the HS-1 live perps rail.
//
// NON-NEGOTIABLE SEAM RULE: createOrder is reached ONLY through the ordering
// seam's SWAP instance — `ccxtInstanceFor("hyperliquid", { requireKeys: true,
// defaultType: "swap", sandbox: <mode-resolved> })`. Never `new ccxt...`, never
// `placeCcxtOrder` (that is the spot leg). The T9 guard test asserts this at
// source level.
//
// MODE (testnet-first → WS-3 R8.1): resolved once per call from env. A method
// proceeds when sandbox is on, or — mainnet — ONLY when BOTH the env REQUEST
// (PICC_CCXT_PERPS_MAINNET_ENABLED=1) AND the ceremony store unlock agree
// (sandbox off otherwise refuses with RAIL_OFF_TESTNET_ONLY). swapInstance
// builds the seam instance from the resolved mode's sandbox flag, so a genuinely
// unlocked mainnet branch targets LIVE endpoints (setSandboxMode is applied only
// when sandbox is true, and only before any order can exist — echoing
// ccxtOrdering.mjs:177-187).
//
// riskModel SHAPE DECISION: `riskModel` is a lazy GETTER on the adapter object.
// Each property access re-reads the env and rebuilds the 7-field object, so
// validateVenueAdapter (which reads adapter.riskModel and iterates the fields)
// always sees the contract surface while values are never baked constants.
// The getter is TRANSPARENT: it exposes the parsed env values (defaults when a
// var is absent/empty, the raw parse otherwise). The METHODS refuse first via
// readRiskModel() — an invalid numeric env (non-finite, <=0, or min>max) makes
// every env-using member return { ok:false, reason:"invalid-environment: …" }
// before doing anything. Never a silent fallback.
//
// REASON VOCABULARY (the exact strings; T5/T6 regex these — keep stable):
//   perps-rail-off: …                both sandbox flags off + PICC_CCXT_PERPS_MAINNET_ENABLED absent  [EXACT text demanded by tests]
//   perps-rail-off: …                mainnet flag set but sandbox still off (R6.2 — WS-1 testnet-only)
//   invalid-environment: <var>=<value>
//   limit-only                       a rogue `type` field in the request (the contract IS limit)
//   invalid-order: <field>=<value>   malformed side/amount/price/leverage guard before any venue call
//   leverage-out-of-band             leverage outside [PICC_CCXT_LEVERAGE_MIN, PICC_CCXT_LEVERAGE_MAX]
//   cross-not-allowed                marginMode !== "isolated"
//   symbol-not-swap-market           symbol not an ACTIVE swap row in markets()
//   reduceonly-exceeds-position      close amount > open position size
//   margin-exceeds-cap               amount*price/leverage > PICC_CCXT_MARGIN_PER_POSITION_CAP_USD
//   setup-failed: <step>             loadMarkets | swap-market | setMarginMode | setLeverage
//   <step>-unobservable:             markets-unobservable | equity-unobservable | positions-unobservable |
//                                    funding-unobservable | submitOrder-unobservable (venue never fabricated)
//
// CHECK ORDER inside submitOrder (asserted by this suite):
//   1 rail-off → 2 invalid-environment → 3 limit-only → 4 invalid-order params
//   → 5 leverage-out-of-band → 6 cross-not-allowed → 7 symbol-not-swap-market
//   → 8 reduceonly-exceeds-position → 9 margin-exceeds-cap → 10 setup-failed
//   → createOrder (submitOrder-unobservable on venue throw/parse failure).
//   Each refusal names its rule and happens BEFORE any network call.
import { createHash } from "node:crypto"
import { QUOTE_EQUIVALENTS, ccxtInstanceFor } from "../ccxtOrdering.mjs"
import { enablementFor as ceremonyEnablementFor } from "../commandCentre/ceremonyState.mjs"

const EXCHANGE_ID = "hyperliquid"
const DEFAULT_TYPE = "swap"

const RAIL_OFF_EXACT =
  "perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)"
const RAIL_OFF_TESTNET_ONLY =
  "perps-rail-off: WS-1 is testnet-only — sandbox mode was not requested (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1); PICC_CCXT_PERPS_MAINNET_ENABLED alone is insufficient until the WS-3 ceremony"

// KNOWN WIRING SIDE-EFFECT (shared ccxt env namespace): this adapter consumes the
// SAME `PICC_CCXT_*_HYPERLIQUID` env pair as the spot leg, so once the pair exists
// ccxtKeyedExchangeIds()/refreshAllCcxtEquity() (ccxtOrdering.mjs:463-471, scheduler.mjs)
// will also record this perps F3 wallet's equity under ccxt-equity.json["hyperliquid"] —
// the spot-owned key per WS-1 spec §8.1 (F3 keeps its own ccxt-perps-risk.json baseline).
const ENV_KEYS = [
  "PICC_CCXT_LEVERAGE_MIN",
  "PICC_CCXT_LEVERAGE_MAX",
  "PICC_CCXT_MARGIN_PER_POSITION_CAP_USD",
  "PICC_CCXT_PERPS_MAX_OPEN_POSITIONS",
  "PICC_CCXT_FUNDING_STALE_MS"
]

const ENV_DEFAULTS = {
  PICC_CCXT_LEVERAGE_MIN: 3,
  PICC_CCXT_LEVERAGE_MAX: 5,
  PICC_CCXT_MARGIN_PER_POSITION_CAP_USD: 10,
  PICC_CCXT_PERPS_MAX_OPEN_POSITIONS: 1,
  PICC_CCXT_FUNDING_STALE_MS: 7_200_000
}

// Margin-cap tolerance absorbs floating-point noise at the exact boundary
// (e.g. 0.01 * 4000 / 4 = 10.000000000000002). 1e-8 dollars is far below any
// real order; it is NOT a clamp — an order a cent over is still refused.
const MARGIN_CAP_EPSILON = 1e-8

// ── mode / env resolution ──────────────────────────────────────────────────

const VENUE_CLASS_HYPERLIQUID_PERPS = "hyperliquid-perps"

// WS-3 R8.1: mainnet also needs the ceremony store unlock — unhealthy/absent reads LOCKED, never unlocks.
function ceremonyUnlockForPerps() {
  let rec
  try {
    rec = ceremonyEnablementFor(VENUE_CLASS_HYPERLIQUID_PERPS)
  } catch {
    return false
  }
  return rec != null && rec.unlocked === true
}

function modeOf() {
  const sandbox =
    process.env.PICC_CCXT_SANDBOX_HYPERLIQUID === "1" || process.env.PICC_CCXT_SANDBOX === "1"
  const mainnetAllowed = process.env.PICC_CCXT_PERPS_MAINNET_ENABLED === "1"
  if (!sandbox && !mainnetAllowed) return { ok: false, reason: RAIL_OFF_EXACT }
  if (!sandbox) {
    if (!ceremonyUnlockForPerps()) return { ok: false, reason: RAIL_OFF_TESTNET_ONLY }
    return { ok: true, sandbox: false }
  }
  return { ok: true, sandbox: true }
}

function envNumber(key) {
  const raw = process.env[key]
  return { raw, value: raw === undefined || raw === "" ? ENV_DEFAULTS[key] : Number(raw) }
}

/** Gated resolver — methods use this; invalid env is refused, never defaulted. */
function readRiskModel() {
  const parsed = {}
  for (const key of ENV_KEYS) {
    const { raw, value } = envNumber(key)
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: `invalid-environment: ${key}=${raw ?? ""}` }
    }
    parsed[key] = value
  }
  if (parsed.PICC_CCXT_LEVERAGE_MIN > parsed.PICC_CCXT_LEVERAGE_MAX) {
    return { ok: false, reason: `invalid-environment: PICC_CCXT_LEVERAGE_MIN=${parsed.PICC_CCXT_LEVERAGE_MIN}` }
  }
  return { ok: true, model: riskModelFrom(parsed) }
}

/** Transparent view for the getter — parsed env values, defaults when absent. */
function riskModelView() {
  const parsed = {}
  for (const key of ENV_KEYS) parsed[key] = envNumber(key).value
  return riskModelFrom(parsed)
}

function riskModelFrom(p) {
  return {
    leverageBandMin: p.PICC_CCXT_LEVERAGE_MIN,
    leverageBandMax: p.PICC_CCXT_LEVERAGE_MAX,
    marginPerPositionCapUsd: p.PICC_CCXT_MARGIN_PER_POSITION_CAP_USD,
    maxOpenPositions: p.PICC_CCXT_PERPS_MAX_OPEN_POSITIONS,
    fundingStaleMs: p.PICC_CCXT_FUNDING_STALE_MS,
    isolatedOnly: true,
    testnetOnly: true
  }
}

// ── instance + markets (the ONLY path to the venue) ────────────────────────

async function swapInstance() {
  // WS-3 R8.1: the seam honors the resolved mode — mainnet (sandbox off) only
  // when env REQUEST + store unlock agree AND no sandbox flag is on; a refused
  // mode still builds sandbox (fail-safe, never a silent mainnet call).
  const mode = modeOf()
  const sandbox = mode.ok ? mode.sandbox !== false : true
  return ccxtInstanceFor(EXCHANGE_ID, { requireKeys: true, defaultType: DEFAULT_TYPE, sandbox })
}

let marketsPromise = null
let marketsCache = null

/** Promise-memoized: concurrent first callers share ONE in-flight loadMarkets. */
async function loadMarketsOnce() {
  if (marketsCache) return marketsCache
  if (!marketsPromise) {
    marketsPromise = (async () => {
      const inst = await swapInstance()
      marketsCache = await inst.loadMarkets()
      return marketsCache
    })()
    // a failed load must not be cached — the next caller re-attempts honestly
    marketsPromise.catch(() => {
      marketsPromise = null
    })
  }
  return marketsPromise
}

function numOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function toMarketRow(m) {
  return {
    symbol: m?.symbol ?? null,
    base: m?.base ?? null,
    quote: m?.quote ?? null,
    type: m?.type ?? null,
    minAmount: numOrNull(m?.limits?.amount?.min),
    minNotional: numOrNull(m?.limits?.cost?.min),
    isActive: m?.active !== false && !m?.inactive,
    fundingTickMs: numOrNull(m?.info?.fundingIntervalMillis ?? m?.info?.fundingIntervalMs)
  }
}

function isActiveMarketRow(row) {
  return row != null && row.type === "swap" && row.isActive === true
}

async function markets() {
  const mode = modeOf()
  if (!mode.ok) return { ok: false, reason: mode.reason }
  try {
    const map = await loadMarketsOnce()
    const rows = []
    for (const m of Object.values(map ?? {})) {
      if (m?.type !== "swap") continue
      rows.push(toMarketRow(m))
    }
    return rows
  } catch {
    return { ok: false, reason: "markets-unobservable" }
  }
}

// ── idempotent per-symbol setup (loadMarkets → swap assert → isolated → leverage) ──
// Promise-memoized per symbol: concurrent first orders for the same symbol await
// the SAME in-flight setup (the second waiter never re-runs setMarginMode /
// setLeverage), and a resolved promise IS the cached "done" bit.

const setupPromiseForSymbol = new Map()

async function ensureSymbolSetup(symbol, leverage) {
  const inFlight = setupPromiseForSymbol.get(symbol)
  if (inFlight) return inFlight
  const p = (async () => {
    const result = await doSymbolSetup(symbol, leverage)
    // a FAILED setup is not memoized — the next order re-attempts honestly
    if (!result.ok) setupPromiseForSymbol.delete(symbol)
    return result
  })()
  setupPromiseForSymbol.set(symbol, p)
  return p
}

async function doSymbolSetup(symbol, leverage) {
  let inst
  try {
    inst = await swapInstance()
    await loadMarketsOnce()
  } catch {
    return { ok: false, reason: "setup-failed: loadMarkets" }
  }
  const m = (marketsCache ?? {})[symbol]
  const valid = m != null && m.type === "swap" && m.active !== false && !m.inactive
  if (!valid) return { ok: false, reason: "setup-failed: swap-market" }
  try {
    await inst.setMarginMode("isolated", symbol)
  } catch {
    return { ok: false, reason: "setup-failed: setMarginMode" }
  }
  try {
    await inst.setLeverage(leverage, symbol)
  } catch {
    return { ok: false, reason: "setup-failed: setLeverage" }
  }
  return { ok: true }
}

// ── helpers ────────────────────────────────────────────────────────────────

function tsToIso(ts) {
  return Number(ts) > 0 ? new Date(Number(ts)).toISOString() : new Date().toISOString()
}

/** R2.7 — HL clientOrderId is a 128-bit hex; deterministic, 34 chars ≤ 66. */
function hexCloidFor(seed) {
  const digest = createHash("sha256").update(String(seed), "utf8").digest("hex")
  return `0x${digest.slice(0, 32)}`
}

function posSizeOrView(symbol, position) {
  if (position != null && Number.isFinite(Number(position?.size))) return Number(position.size)
  return NaN
}

async function readPositionSize(symbol, position) {
  const supplied = posSizeOrView(symbol, position)
  if (Number.isFinite(supplied) && supplied >= 0) return supplied
  // fall back to the venue view — a close can only be proved safe against the
  // venue's own positions; an unobservable read refuses the close honestly
  const view = await positionView()
  if (!Array.isArray(view)) {
    if (view && typeof view === "object" && !view.ok) return { ok: false, reason: view.reason ?? "positions-unobservable" }
    return { ok: false, reason: "positions-unobservable" }
  }
  const row = view.find((p) => p.symbol === symbol)
  return row ? Number(row.size ?? 0) : 0
}

// PICC -> venue order type: the contract IS limit. The seam's armed path is
// structurally limit-only and the adapter never forwards a caller type.
async function submitOrder({
  symbol,
  side,
  amount,
  price,
  leverage,
  marginMode,
  reduceOnly = false,
  clientOrderId,
  type,
  position
} = {}) {
  const mode = modeOf()
  if (!mode.ok) return { ok: false, reason: mode.reason }

  const rm = readRiskModel()
  if (!rm.ok) return { ok: false, reason: rm.reason }
  const risk = rm.model

  if (type != null && type !== "limit") return { ok: false, reason: "limit-only" }

  if (side !== "buy" && side !== "sell") return { ok: false, reason: `invalid-order: side=${String(side ?? "")}` }
  const amountN = Number(amount)
  if (!Number.isFinite(amountN) || amountN <= 0) return { ok: false, reason: `invalid-order: amount=${String(amount ?? "")}` }
  const priceN = Number(price)
  if (!Number.isFinite(priceN) || priceN <= 0) return { ok: false, reason: `invalid-order: price=${String(price ?? "")}` }
  const levN = Number(leverage)
  if (!Number.isFinite(levN) || levN <= 0) return { ok: false, reason: `invalid-order: leverage=${String(leverage ?? "")}` }

  if (levN < risk.leverageBandMin || levN > risk.leverageBandMax) return { ok: false, reason: "leverage-out-of-band" }
  if (marginMode !== "isolated") return { ok: false, reason: "cross-not-allowed" }

  const list = await markets()
  if (!Array.isArray(list)) {
    return list && list.ok === false ? { ok: false, reason: list.reason } : { ok: false, reason: "symbol-not-swap-market" }
  }
  if (!list.some((row) => row.symbol === symbol && isActiveMarketRow(row))) {
    return { ok: false, reason: "symbol-not-swap-market" }
  }

  if (reduceOnly) {
    const size = await readPositionSize(symbol, position)
    if (size && typeof size === "object") return size
    if (amountN > size) return { ok: false, reason: "reduceonly-exceeds-position" }
  }

  const marginUsd = (amountN * priceN) / levN
  if (marginUsd - risk.marginPerPositionCapUsd > MARGIN_CAP_EPSILON) {
    return { ok: false, reason: "margin-exceeds-cap" }
  }

  const setup = await ensureSymbolSetup(symbol, levN)
  if (!setup.ok) return setup

  const inst = await swapInstance()
  const seed = clientOrderId || [symbol, side, amount, price, levN].join(":")
  const cloid = hexCloidFor(seed)
  const params = reduceOnly ? { clientOrderId: cloid, reduceOnly: true } : { clientOrderId: cloid }
  try {
    const raw = await inst.createOrder(symbol, "limit", side, amountN, priceN, params)
    const id = String(raw?.id ?? "")
    if (!id) return { ok: false, reason: "submitOrder-unobservable" }
    return {
      ok: true,
      order: {
        id,
        clientOrderId: cloid,
        symbol: raw?.symbol ?? symbol,
        side: raw?.side ?? side,
        type: "limit",
        amount: amountN,
        price: priceN,
        status: raw?.status ?? "new",
        at: tsToIso(raw?.timestamp),
        marginUsd,
        leverage: levN,
        reduceOnly
      }
    }
  } catch {
    return { ok: false, reason: "submitOrder-unobservable" }
  }
}

// ── observer surface ───────────────────────────────────────────────────────

async function verifyFill({ symbol, orderId } = {}) {
  if (modeOf().ok === false) return null
  if (!symbol || !orderId) return null
  try {
    const inst = await swapInstance()
    const raw = await inst.fetchOrder(orderId, symbol)
    const id = String(raw?.id ?? "")
    if (!id) return null
    return {
      ok: true,
      fill: {
        id,
        symbol: raw?.symbol ?? null,
        side: raw?.side ?? null,
        filled: Number.isFinite(Number(raw?.filled ?? 0)) ? Number(raw?.filled ?? 0) : 0,
        // ONLY the venue's reported average fill price is a fill price. A
        // resting limit's `price` (or the order `amount`) is NEVER an exit
        // price — P&L cannot be claimed from an unfilled exit.
        average:
          Number.isFinite(Number(raw?.average ?? NaN)) && Number(raw?.average ?? NaN) > 0
            ? Number(raw?.average ?? NaN)
            : null,
        fee: raw?.fee != null ? (Number.isFinite(Number(raw?.fee?.cost)) ? Number(raw?.fee.cost) : null) : null,
        status: raw?.status ?? null,
        at: tsToIso(raw?.timestamp)
      }
    }
  } catch {
    return null
  }
}

async function observeEquity() {
  const mode = modeOf()
  if (!mode.ok) return { ok: false, reason: mode.reason }
  let inst
  let balance
  try {
    inst = await swapInstance()
    balance = await inst.fetchBalance()
  } catch {
    return { ok: false, reason: "equity-unobservable" }
  }
  const total = balance?.total ?? {}
  const quote = [...QUOTE_EQUIVALENTS].find((c) => Number(total[c]) > 0) ?? "USDT"
  let equityUsd = 0
  let usable = false
  const unpriced = []
  for (const [currency, rawAmount] of Object.entries(total)) {
    const amount = Number(rawAmount)
    if (!(amount > 0)) continue
    if (QUOTE_EQUIVALENTS.has(currency)) {
      equityUsd += amount
      usable = true
      continue
    }
    let price = null
    try {
      const t = await inst.fetchTicker(`${currency}/${quote}`)
      const p = Number(t?.last ?? t?.close ?? t?.bid ?? t?.ask)
      if (Number.isFinite(p) && p > 0) price = p
    } catch {
      price = null
    }
    if (price != null) {
      equityUsd += amount * price
      usable = true
    } else {
      unpriced.push(currency)
    }
  }
  if (!usable || unpriced.length > 0) {
    return {
      ok: false,
      reason: unpriced.length ? `equity-unobservable: unpriced ${unpriced.join(", ")}` : "equity-unobservable: no balance"
    }
  }
  return { ok: true, equityUsd, currency: quote, at: new Date().toISOString() }
}

function toPositionRecord(raw) {
  if (!raw || typeof raw !== "object") return null
  const contracts = Number(raw.contracts ?? raw.size ?? 0)
  const size = Math.abs(contracts)
  if (!(size > 0)) return null
  const entryPrice = Number(raw.entryPrice ?? NaN)
  if (!Number.isFinite(entryPrice)) return null
  const sideRaw = String(raw.side ?? "").toLowerCase()
  const side = sideRaw === "long" || sideRaw === "short" ? sideRaw : contracts < 0 ? "short" : "long"
  const notional = Number.isFinite(Number(raw.notional)) ? Number(raw.notional) : size * entryPrice
  const leverage = Number.isFinite(Number(raw.leverage)) ? Number(raw.leverage) : null
  const liquidationPrice = Number.isFinite(Number(raw.liquidationPrice)) ? Number(raw.liquidationPrice) : null
  return {
    symbol: raw.symbol ?? null,
    side,
    size,
    entryPrice,
    notional,
    leverage,
    marginMode: raw.marginMode ?? "isolated",
    liquidationPrice,
    at: tsToIso(raw.timestamp)
  }
}

async function positionView() {
  const mode = modeOf()
  if (!mode.ok) return { ok: false, reason: mode.reason }
  let rows
  try {
    const inst = await swapInstance()
    rows = await inst.fetchPositions()
  } catch {
    return { ok: false, reason: "positions-unobservable" }
  }
  const out = []
  for (const raw of Array.isArray(rows) ? rows : []) {
    const p = toPositionRecord(raw)
    if (p) out.push(p)
  }
  return out
}

function fundingIntervalHrsOf(raw) {
  const iv = raw?.interval
  if (typeof iv === "string") {
    const m = /^(\d+(?:\.\d+)?)\s*([hmds])?$/.exec(iv.trim())
    if (m) {
      const n = Number(m[1])
      const unit = m[2] ?? "h"
      if (unit === "h") return n
      if (unit === "m") return n / 60
      if (unit === "d") return n * 24
      if (unit === "s") return n / 3600
    }
  }
  const secs = Number(raw?.info?.intervalSeconds ?? raw?.info?.fundingIntervalSeconds ?? NaN)
  if (Number.isFinite(secs) && secs > 0) return secs / 3600
  return null
}

async function observeFunding({ symbol } = {}) {
  const mode = modeOf()
  if (!mode.ok) return { ok: false, reason: mode.reason }
  if (!symbol) return { ok: false, reason: "invalid-order: symbol" }
  let raw
  try {
    const inst = await swapInstance()
    raw = await inst.fetchFundingRate(symbol)
  } catch {
    return { ok: false, reason: "funding-unobservable" }
  }
  const rate = Number(raw?.fundingRate ?? raw?.info?.fundingRate ?? NaN)
  if (!Number.isFinite(rate)) return { ok: false, reason: "funding-unobservable" }
  return { ok: true, rate, fundingIntervalHrs: fundingIntervalHrsOf(raw), at: tsToIso(raw?.timestamp), symbol }
}

// ── the adapter (F2 contract member set) ───────────────────────────────────

export const hyperliquidPerps = {
  id: "hyperliquid",
  label: "Hyperliquid perps (testnet)",
  get riskModel() {
    return riskModelView()
  },
  markets,
  submitOrder,
  verifyFill,
  observeEquity,
  positionView,
  observeFunding
}