// CCXT ordering seam — the ONE deliberate exception to the read-only guard.
//
// ccxtConnector.mjs replaces every account-mutating method (createOrder,
// transfer, withdraw, …) with a throwing guard, and that guard stays for every
// other module in the process. This module is the ONLY place allowed to call
// createOrder, and that exception is deliberate + documented + security-reviwed:
//
//   • it exists to carry the Command Centre trading:ccxt execution leg (spec
//     slice 6): a human-approved proposal that clears the FULL 10-gate sidecar
//     chain is the only thing that may reach placeCcxtOrder
//   • orders are LIMIT-only (never market — price is bound by the human's
//     approval), and never larger than CCXT_HARD_NOTIONAL_CAP_USD ($10, the
//     envelope ceiling — enforced AGAIN here, independently of the gate, so a
//     bypassed gate still cannot oversize an order; the seam REFUSES, it does
//     not silently shrink)
//   • there is no withdraw/transfer/leverage/cancel code path anywhere in this
//     module — those methods stay guarded in ccxtConnector
//   • credentials come from the process environment, in ONE of two modes per
//     exchange (a complete pair is required; a half-set pair is refused):
//       CEX-style  : PICC_CCXT_APIKEY_<EXCHANGE> + PICC_CCXT_SECRET_<EXCHANGE>
//                    (+ optional PICC_CCXT_PASSWORD_<EXCHANGE>)
//       wallet-key : PICC_CCXT_WALLETADDRESS_<EXCHANGE> +
//                    PICC_CCXT_PRIVATEKEY_<EXCHANGE>
//                    (Hyperliquid: the main wallet address + the API wallet's
//                    private key; ccxt hyperliquid requires these, NOT apiKey/
//                    secret — verified against the installed ccxt build)
//     PICC_CCXT_SANDBOX_<EXCHANGE> (and a global PICC_CCXT_SANDBOX=1) are also
//     honored. Credentials never reach the masked UI and are never logged.
//     On the exchange, configure the API key with "view + trade, NO withdrawal"
//     permission where the venue supports it.
//
// This module manages its OWN exchange instances (a separate cache from
// ccxtConnector.instances) because guardReadOnly would strip createOrder off a
// shared instance. Everything is lazy: importing this module never pays ccxt's
// startup cost, and tests inject a fixture library via _setCcxtLibForTests.

import { createLogger } from "../logger.mjs"
import { toCcxtSymbol } from "./ccxtConnector.mjs"
import { dayKeyOf } from "./u4faRisk.mjs"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const log = createLogger("picc-ccxt-order")

/** The seam's independent ceiling — matches the trading:ccxt envelope. */
export const CCXT_HARD_NOTIONAL_CAP_USD = 10

/** Equity snapshots older than this are stale for a NEW action (5E). */
export const CCXT_EQUITY_STALE_MS = 5 * 60 * 1000

/**
 * Currencies priced at 1.0 USDT-terms for equity math. Labeled assumption:
 * these are designed pegs; a quote currency the exchange actually settles is
 * never silently treated as 1.0 if fetchBalance shows a non-1.0 reality — they
 * only skip a live ticker fetch. Anything else must be priced live or the
 * snapshot reports unpriced and the gate denies (never fabricates).
 */
export const QUOTE_EQUIVALENTS = new Set(["USDT", "USDC", "USD", "BUSD", "FDUSD", "TUSD", "DAI"])

const DATA_DIR =
  process.env.PICC_COMMAND_CENTRE_DATA_DIR || fileURLToPath(new URL("./data", import.meta.url))
const EQUITY_FILE = join(DATA_DIR, "ccxt-equity.json")

const canTouchDisk = () => process.env.VITEST !== "true" || Boolean(process.env.PICC_COMMAND_CENTRE_DATA_DIR)

// Lazy-loaded ccxt (very large package); tests swap in a fixture lib.
let ccxt = null
export function _setCcxtLibForTests(lib) {
  ccxt = lib
}
async function ccxtLib() {
  if (!ccxt) {
    const mod = await import("ccxt")
    ccxt = mod.default ?? mod
  }
  return ccxt
}

const sessions = new Map() // exchangeId -> un-guarded instance

/** Test seam only — drop instances + in-memory equity (file wiped when permitted). */
export function _resetCcxtOrderingState() {
  for (const inst of sessions.values()) {
    if (typeof inst?.close === "function") inst.close().catch(() => null)
  }
  sessions.clear()
  equityStore = {}
  if (canTouchDisk()) rmSync(EQUITY_FILE, { force: true })
}

/** Exchange id -> env key suffix ("binance" -> "BINANCE"). */
function envKey(exchangeId) {
  return String(exchangeId ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
}

/**
 * Read the ordering credentials for one exchange from the process environment.
 * Two modes, selected by which pair is complete (one of them MUST be):
 *   CEX-style  : PICC_CCXT_APIKEY_<EX> + PICC_CCXT_SECRET_<EX>
 *   wallet-key : PICC_CCXT_WALLETADDRESS_<EX> + PICC_CCXT_PRIVATEKEY_<EX>
 * Returns null when neither pair is complete — the leg is then honestly
 * inoperable (never a silent "no keys needed"). Both pairs may be set at once
 * (each venue reads the fields it requires).
 */
export function ccxtKeysForExchange(exchangeId) {
  const suffix = envKey(exchangeId)
  const apiKey = process.env[`PICC_CCXT_APIKEY_${suffix}`]
  const secret = process.env[`PICC_CCXT_SECRET_${suffix}`]
  const walletAddress = process.env[`PICC_CCXT_WALLETADDRESS_${suffix}`]
  const privateKey = process.env[`PICC_CCXT_PRIVATEKEY_${suffix}`]
  const cexPair = Boolean(apiKey && secret)
  const walletPair = Boolean(walletAddress && privateKey)
  if (!cexPair && !walletPair) return null
  return {
    ...(cexPair ? { apiKey, secret } : {}),
    ...(walletPair ? { walletAddress, privateKey } : {}),
    password: process.env[`PICC_CCXT_PASSWORD_${suffix}`] ?? undefined,
    sandbox:
      process.env[`PICC_CCXT_SANDBOX_${suffix}`] === "1" ||
      (!process.env[`PICC_CCXT_SANDBOX_${suffix}`] && process.env.PICC_CCXT_SANDBOX === "1")
  }
}

/**
 * Create (or reuse) the un-guarded exchange instance for the ordering seam.
 * requireKeys=true (the default) refuses an instance without configured
 * credentials — private endpoints (fetchBalance/fetchOrder/createOrder) cannot
 * work without them, and the seam must never quietly connect keyless.
 */
export async function ccxtInstanceFor(exchangeId, { requireKeys = true, sandbox = null } = {}) {
  const id = String(exchangeId ?? "").trim().toLowerCase()
  if (!id) throw new Error("ccxt ordering seam requires an exchange id")
  const cached = sessions.get(id)
  if (cached) return cached

  const keys = ccxtKeysForExchange(id)
  if (requireKeys && !keys) {
    throw new Error(
      `ccxt ordering seam: no ${envKey(id)} credentials configured — set either PICC_CCXT_APIKEY_${envKey(id)} + PICC_CCXT_SECRET_${envKey(id)} (CEX-style) or PICC_CCXT_WALLETADDRESS_${envKey(id)} + PICC_CCXT_PRIVATEKEY_${envKey(id)} (Hyperliquid-style) — the execution leg is inoperable without them`
    )
  }

  const lib = await ccxtLib()
  const Ctor = lib[id]
  if (typeof Ctor !== "function") throw new Error(`unknown ccxt exchange "${id}"`)

  const opts = {
    enableRateLimit: true,
    timeout: 15_000,
    options: { defaultType: "spot" }
  }
  if (keys?.apiKey) opts.apiKey = keys.apiKey
  if (keys?.secret) opts.secret = keys.secret
  if (keys?.password) opts.password = keys.password
  if (keys?.walletAddress) opts.walletAddress = keys.walletAddress
  if (keys?.privateKey) opts.privateKey = keys.privateKey

  const instance = new Ctor(opts)
  const wantSandbox = sandbox ?? keys?.sandbox ?? false
  if (wantSandbox && typeof instance.setSandboxMode === "function") {
    // Deliberate: sandbox mode is set BEFORE any order can be placed. The
    // global read-only guard blocks setSandboxMode elsewhere; here it is the
    // first live-verify safeguard (testnet orders spend no capital).
    try {
      instance.setSandboxMode(true)
      instance._piccSandbox = true
    } catch {
      log.warn(`sandbox requested but ${id} has no sandbox — live endpoints will be used`)
    }
  }
  sessions.set(id, instance)
  return instance
}

/** Normalize a raw ccxt order into PICC's honest shape; malformed -> null. */
export function normalizeOrder(order) {
  if (!order || typeof order !== "object") return null
  const id = String(order.id ?? "")
  if (!id) return null
  const average = Number(order.average ?? order.price ?? NaN)
  const filled = Number(order.filled ?? 0)
  const amount = Number(order.amount ?? 0)
  const price = Number(order.price ?? NaN)
  return {
    id,
    symbol: order.symbol ?? null,
    side: order.side ?? null,
    type: order.type ?? null,
    amount: Number.isFinite(amount) ? amount : null,
    price: Number.isFinite(price) ? price : null,
    status: order.status ?? null,
    filled: Number.isFinite(filled) ? filled : 0,
    average: Number.isFinite(average) && average > 0 ? average : null,
    at: Number(order.timestamp) > 0 ? new Date(order.timestamp).toISOString() : new Date().toISOString()
  }
}

/**
 * The ONLY createOrder caller in the process. Refuses (throws, loudly) anything
 * that is not a within-cap limit order — the caller never gets a silent
 * shrink. Throws also when credentials are missing or the venue rejects the
 * order; the audit records the failure honestly.
 */
export async function placeCcxtOrder({ exchange, symbol, side, amount, price, clientOrderId }) {
  const id = String(exchange ?? "").trim().toLowerCase()
  const sym = toCcxtSymbol(symbol)
  const orderSide = String(side ?? "").toLowerCase()
  const orderAmount = Number(amount)
  const orderPrice = Number(price)

  if (!id) throw new Error("ccxt ordering seam: exchange is required")
  if (!sym) throw new Error(`ccxt ordering seam: cannot resolve symbol "${symbol}"`)
  if (!["buy", "sell"].includes(orderSide)) throw new Error(`ccxt ordering seam: side must be buy or sell (got "${side}")`)
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) throw new Error("ccxt ordering seam: amount must be a positive number")
  if (!Number.isFinite(orderPrice) || orderPrice <= 0) throw new Error("ccxt ordering seam: price must be a positive number")

  const notional = orderAmount * orderPrice
  if (notional > CCXT_HARD_NOTIONAL_CAP_USD) {
    throw new Error(
      `ccxt ordering seam: notional $${notional.toFixed(4)} exceeds the $${CCXT_HARD_NOTIONAL_CAP_USD} hard cap — refused (envelope defense-in-depth)`
    )
  }

  // Throws when credentials are absent — the seam never silently goes keyless.
  const instance = await ccxtInstanceFor(id, { requireKeys: true })

  try {
    const raw = await instance.createOrder(sym, "limit", orderSide, orderAmount, orderPrice, {
      ...(clientOrderId ? { clientOrderId } : {})
    })
    return normalizeOrder(raw)
  } catch (err) {
    const message = `ccxt order refused by ${id} (${orderSide} ${sym} limit ${orderAmount} @ ${orderPrice}): ${String(err?.message ?? err)}`
    log.warn(message)
    const augmented = new Error(message)
    augmented.cause = err
    throw augmented
  }
}

/**
 * B-carrier verification — READ-ONLY (fetchOrder never mutates anything).
 * Returns the normalized fill truth when the venue answers; null when
 * credentials are missing or the order cannot be observed (the caller reports
 * "verify unobserved", never a fabricated fill).
 */
export async function verifyCcxtFill({ exchange, symbol, orderId }) {
  const id = String(exchange ?? "").trim().toLowerCase()
  const sym = toCcxtSymbol(symbol)
  const oid = String(orderId ?? "").trim()
  if (!id || !sym || !oid) return null
  if (!ccxtKeysForExchange(id)) return null
  try {
    const instance = await ccxtInstanceFor(id, { requireKeys: true })
    const raw = await instance.fetchOrder(oid, sym)
    return normalizeOrder(raw)
  } catch (err) {
    log.warn(`ccxt verify failed ${id} ${oid}`, { error: err.message })
    return null
  }
}

/**
 * Read-only reference price for a pair (public ticker on the ordering seam's
 * instance — no credentials required). null when the venue cannot be read.
 */
export async function fetchReferencePrice({ exchange, symbol }) {
  const id = String(exchange ?? "").trim().toLowerCase()
  const sym = toCcxtSymbol(symbol)
  if (!id || !sym) return null
  try {
    const instance = await ccxtInstanceFor(id, { requireKeys: false })
    const t = await instance.fetchTicker(sym)
    const price = Number(t?.last ?? t?.close ?? t?.bid ?? t?.ask)
    if (!Number.isFinite(price) || price <= 0) return null
    return { exchange: id, symbol: sym, price, bid: Number(t?.bid) || null, ask: Number(t?.ask) || null, at: Date.now() }
  } catch (err) {
    log.warn(`ccxt reference price failed ${id} ${sym}`, { error: err.message })
    return null
  }
}

// ── Equity observation (read-only fetchBalance) + persisted day baseline ────
// The -5% daily-loss gate (5D) needs a real day P/L input. PICC measures it as
// the change in the exchange wallet's USDT-terms equity since the UTC day's
// FIRST observed snapshot: dayLossPct = max(0, (dayStart - now) / dayStart).
// The baseline persists to the command-centre data dir so a restart does not
// silently reset today's loss window. A balance that cannot be fully valued
// (unpriced assets) is reported as such — the gate denies (5E), it never
// fabricates.

let equityStore = bootEquity()

function bootEquity() {
  if (!canTouchDisk() || !existsSync(EQUITY_FILE)) return {}
  try {
    return JSON.parse(readFileSync(EQUITY_FILE, "utf8")) ?? {}
  } catch {
    return {}
  }
}

function persistEquity() {
  if (!canTouchDisk()) return
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  // Object store — OVERWRITE, not append (append is the JSONL audit's shape).
  writeFileSync(EQUITY_FILE, JSON.stringify(equityStore, null, 2), "utf8")
}

/**
 * Freshness view of the last equity observation for the overview surface.
 * { lastObservedAt, ageSec } — flat nulls when nothing was ever observed.
 */
export function ccxtEquityFreshness(exchange) {
  const rec = equityStore[String(exchange ?? "").trim().toLowerCase()]
  if (!rec?.at) return null
  return { lastObservedAt: rec.at, ageSec: Math.max(0, Math.round((Date.now() - Date.parse(rec.at)) / 1000)) }
}

/**
 * Site-level freshness view for the overview surface: the MOST RECENT equity
 * observation across every observed exchange, or null when nothing was ever
 * observed (the overview then reports the feed as not-wired — never a silent OK).
 */
export function ccxtEquityLastObserved() {
  let best = null
  let bestId = null
  for (const [id, rec] of Object.entries(equityStore)) {
    if (!rec?.at) continue
    if (!best || Date.parse(rec.at) > Date.parse(best.at)) {
      best = rec
      bestId = id
    }
  }
  if (!best) return null
  return {
    exchange: best.exchange ?? bestId,
    lastObservedAt: best.at,
    ageSec: Math.max(0, Math.round((Date.now() - Date.parse(best.at)) / 1000))
  }
}

/**
 * Observe the exchange wallet and fold it into the day baseline.
 * Never throws on venue/network failure — returns the honest null-equity shape
 * so the caller can feed the 5E gate. `now` is injectable for tests.
 */
export async function observeCcxtEquity({ exchange, now = Date.now() } = {}) {
  const id = String(exchange ?? "").trim().toLowerCase()
  if (!id) return { ok: false, exchange: id, reason: "ccxt ordering seam requires an exchange id" }
  if (!ccxtKeysForExchange(id)) {
    return { ok: false, exchange: id, reason: "ccxt-keys-not-configured", fresh: false }
  }

  let balance = null
  let instance = null
  try {
    instance = await ccxtInstanceFor(id, { requireKeys: true })
    balance = await instance.fetchBalance()
  } catch (err) {
    log.warn(`ccxt balance observation failed ${id}`, { error: err.message })
    return { ok: false, exchange: id, reason: "balance-unobservable", fresh: false }
  }

  const total = balance?.total ?? {}
  const quotes = ["USDT", "USDC", "USD", "BUSD", "FDUSD", "TUSD", "DAI"]
  const quote = quotes.find((q) => Number(total[q]) > 0) ?? "USDT"
  const unpriced = []
  let equityUsd = 0
  let usable = false

  for (const [currency, rawAmount] of Object.entries(total)) {
    const amount = Number(rawAmount) || 0
    if (amount <= 0) continue
    if (QUOTE_EQUIVALENTS.has(currency)) {
      equityUsd += amount
      usable = true
      continue
    }
    const symbol = `${currency}/${quote}`
    let price = null
    try {
      const t = await instance.fetchTicker(symbol)
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
      exchange: id,
      reason: unpriced.length ? `unpriced assets: ${unpriced.join(", ")}` : "no balance observable",
      unpriced,
      fresh: false
    }
  }

  const dayKey = dayKeyOf(now)
  const prev = equityStore[id]
  const baselineSeeded = !prev || prev.dayKey !== dayKey
  const dayStartEquityUsd = baselineSeeded ? equityUsd : Number(prev.dayStartEquityUsd) || equityUsd
  equityStore[id] = { exchange: id, dayKey, at: new Date(now).toISOString(), equityUsd, dayStartEquityUsd }
  persistEquity()

  const dayLossPct =
    dayStartEquityUsd > 0 ? Math.max(0, Math.round(((dayStartEquityUsd - equityUsd) / dayStartEquityUsd) * 10000) / 100) : null

  return {
    ok: true,
    exchange: id,
    equityUsd,
    dayStartEquityUsd,
    dayLossPct,
    baselineSeeded,
    unpriced: [],
    at: new Date(now).toISOString(),
    dayKey,
    fresh: true
  }
}

// Scheduled-sweep guard: the 4 min job cadence already spaces passes, so a
// store record younger than this window means a rail action observed the
// wallet moments ago — skip it instead of hammering the venue with a
// duplicate fetchBalance.
const CCXT_EQUITY_MIN_OBSERVE_GAP_MS = 60_000

/**
 * Exchange ids that have ordering credentials configured in the environment —
 * either the wallet-key pair (PICC_CCXT_WALLETADDRESS_<EX> + PRIVATEKEY) or
 * the CEX-style pair (PICC_CCXT_APIKEY_<EX> + SECRET) marks the exchange as
 * keyed. The scan needs only ONE of the pair's keys present to NAME the
 * exchange; observeCcxtEquity then refuses honestly if the pair is incomplete
 * (ccxt-keys-not-configured) instead of silently skipping it.
 */
export function ccxtKeyedExchangeIds() {
  const ids = new Set()
  for (const key of Object.keys(process.env)) {
    const m = /^PICC_CCXT_(?:WALLETADDRESS|APIKEY)_(.+)$/.exec(key)
    if (!m) continue
    ids.add(m[1].trim().toLowerCase())
  }
  return [...ids].sort()
}

/**
 * The overview's freshness driver: observe equity on every keyed exchange and
 * fold each result into the persisted day baseline. Never throws — a failing
 * exchange is reported honestly (and stored nothing, so the 5E gate keeps
 * denying on its stale data instead of fabricating) and never starves the
 * other exchanges. `now` is injectable for tests.
 */
export async function refreshAllCcxtEquity({ now = Date.now() } = {}) {
  const keyedExchanges = ccxtKeyedExchangeIds()
  const observed = []
  const skipped = []
  let okCount = 0
  for (const exchange of keyedExchanges) {
    const prev = equityStore[exchange]
    if (prev?.at && now - Date.parse(prev.at) < CCXT_EQUITY_MIN_OBSERVE_GAP_MS) {
      skipped.push({ exchange, reason: "observed-recently" })
      continue
    }
    const obs = await observeCcxtEquity({ exchange, now })
    observed.push({
      exchange,
      ok: obs.ok,
      equityUsd: obs.ok ? (Number(obs.equityUsd) || null) : null,
      reason: obs.ok ? null : (obs.reason ?? "balance-unobservable")
    })
    if (obs.ok) okCount += 1
  }
  return { keyedExchanges, observed, skipped, okCount, at: new Date(now).toISOString() }
}