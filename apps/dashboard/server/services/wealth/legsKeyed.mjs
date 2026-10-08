// Wealth keyed leg readers — ccxt-spot, hyperliquid, BTCPay (+ default FX readers).
//
// Binding spec (design doc §2, decisions 3/7/10/13/18):
// - FX-missing legs are excluded downstream (never last-known-stale conversion,
//   never total-nulling) — readers report what was observed, nothing more.
// - Settled-only billing: the BTCPay leg reads confirmedBalance; the
//   unconfirmedBalance is reported separately on the leg and NEVER summed.
// - Status by the 90s/5min rule (decision 10): observedAt < 90s → LIVE,
//   < 5min → STALE, older → ABSENT with `stale-exceeded`; missing → ABSENT.
// - Hyperliquid is read directly (decision 13, spot-only collector scope).
// - BTCPay credentials follow the existing env/vault pattern: server URL + API
//   key (+ store id), ABSENT with `btcpay-unconfigured` when any is unset.
//   Env names accept the PICC_-prefixed wealth vars, falling back to the
//   existing BTCPAY_* names in server/config.mjs (same vault, either spelling).
//
// BTCPay endpoint (researched Greenfield wallet API):
//   GET {URL}/api/v1/stores/{STORE_ID}/payment-methods/{METHOD_ID default BTC}/wallet
//   with `Authorization: token $API_KEY`
//   → { balance, confirmedBalance, unconfirmedBalance } (decimal strings).
// The API key needs the `btcpay.store.canviewwallet` permission. The secret is
// sent in the Authorization header only — it never appears in URLs, reasons,
// or logs (reasons carry only `btcpay-http-<status>` / `btcpay-unreachable`).
//
// Read-only mappers: no persistence here (store.mjs owns it), no static
// imports of market modules (dynamic `await import()` only, so tests stay
// hermetic and importing this module never pays ccxt's load cost).

const LIVE_MS = 90_000
const USABLE_MS = 5 * 60_000

function pickEnv(env, ...names) {
  for (const n of names) {
    const v = env?.[n]
    if (typeof v === "string" && v.length > 0) return v
  }
  return ""
}

function statusFor(observedAt, now = Date.now()) {
  if (!observedAt) return "ABSENT"
  const t = new Date(observedAt).getTime()
  if (!Number.isFinite(t)) return "ABSENT"
  const age = now - t
  if (age < 0) return "LIVE"
  if (age < LIVE_MS) return "LIVE"
  if (age < USABLE_MS) return "STALE"
  return "ABSENT"
}

function nowIso() {
  return new Date().toISOString()
}

// ── ccxt-spot ────────────────────────────────────────────────────────────────
// Consumes the broker registry's keyed exchanges (read-only balances).
// ABSENT `ccxt-keys-unset` when no PICC_CCXT_* credential pair is configured.

function keyedExchangeIds(env) {
  const ids = new Set()
  for (const key of Object.keys(env ?? {})) {
    const m = /^PICC_CCXT_(?:WALLETADDRESS|APIKEY)_(.+)$/.exec(key)
    if (m) ids.add(m[1].trim().toLowerCase())
  }
  return [...ids]
}

export async function readCcxtSpotLeg(deps = {}) {
  const env = deps.env ?? process.env
  const ids = keyedExchangeIds(env)
  if (ids.length === 0) {
    return {
      id: "ccxt-spot", kind: "ccxt-spot", ccy: "USD", amount: null,
      observedAt: null, status: "ABSENT", reason: "ccxt-keys-unset",
      fxSource: null, fxAt: null
    }
  }
  try {
    const { observeCcxtEquity } = await import("../ccxtOrdering.mjs")
    let equityUsd = 0
    let usable = false
    let latestAt = null
    const failures = []
    for (const id of ids) {
      const r = await observeCcxtEquity({ exchange: id })
      if (r?.ok && Number.isFinite(Number(r.equityUsd))) {
        equityUsd += Number(r.equityUsd)
        usable = true
        if (r.at && (!latestAt || r.at > latestAt)) latestAt = r.at
      } else {
        failures.push(`${id}:${r?.reason ?? "unobservable"}`)
      }
    }
    if (!usable) {
      return {
        id: "ccxt-spot", kind: "ccxt-spot", ccy: "USD", amount: null,
        observedAt: null, status: "ABSENT",
        reason: `ccxt-unobservable:${failures.join("; ") || "no balance observable"}`,
        fxSource: null, fxAt: null
      }
    }
    const observedAt = latestAt ?? nowIso()
    const status = statusFor(observedAt)
    return {
      id: "ccxt-spot", kind: "ccxt-spot", ccy: "USD", amount: equityUsd,
      observedAt, status,
      reason: status === "ABSENT" ? "stale-exceeded" : null,
      fxSource: null, fxAt: null
    }
  } catch (err) {
    return {
      id: "ccxt-spot", kind: "ccxt-spot", ccy: "USD", amount: null,
      observedAt: null, status: "ABSENT",
      reason: `ccxt-unobservable:${String(err?.message ?? err).slice(0, 120)}`,
      fxSource: null, fxAt: null
    }
  }
}

// ── hyperliquid (read directly) ──────────────────────────────────────────────
// Creds share the ccxt env namespace (PICC_CCXT_*_HYPERLIQUID); either the
// wallet-key pair or the CEX-style pair marks the leg as configured.

function hyperliquidCreds(env) {
  const e = env ?? {}
  const walletPair = Boolean(e.PICC_CCXT_WALLETADDRESS_HYPERLIQUID && e.PICC_CCXT_PRIVATEKEY_HYPERLIQUID)
  const cexPair = Boolean(e.PICC_CCXT_APIKEY_HYPERLIQUID && e.PICC_CCXT_SECRET_HYPERLIQUID)
  return walletPair || cexPair
}

export async function readHyperliquidLeg(deps = {}) {
  const env = deps.env ?? process.env
  if (!hyperliquidCreds(env)) {
    return {
      id: "hyperliquid", kind: "hyperliquid", ccy: "USD", amount: null,
      observedAt: null, status: "ABSENT", reason: "hyperliquid-credentials-unset",
      fxSource: null, fxAt: null
    }
  }
  try {
    const observe = deps.observeEquity
      ?? (await import("../venues/hyperliquidPerps.mjs")).hyperliquidPerps.observeEquity
    const r = await observe()
    if (!r?.ok || !Number.isFinite(Number(r.equityUsd))) {
      return {
        id: "hyperliquid", kind: "hyperliquid", ccy: "USD", amount: null,
        observedAt: null, status: "ABSENT",
        reason: String(r?.reason ?? "hyperliquid-unobservable").slice(0, 160),
        fxSource: null, fxAt: null
      }
    }
    const observedAt = r.at ?? nowIso()
    const status = statusFor(observedAt)
    return {
      id: "hyperliquid", kind: "hyperliquid", ccy: "USD", amount: Number(r.equityUsd),
      observedAt, status,
      reason: status === "ABSENT" ? "stale-exceeded" : null,
      fxSource: null, fxAt: null
    }
  } catch (err) {
    return {
      id: "hyperliquid", kind: "hyperliquid", ccy: "USD", amount: null,
      observedAt: null, status: "ABSENT",
      reason: `hyperliquid-unobservable:${String(err?.message ?? err).slice(0, 120)}`,
      fxSource: null, fxAt: null
    }
  }
}

// ── BTCPay (settled-only) ────────────────────────────────────────────────────

function btcpayConf(env) {
  const url = pickEnv(env, "PICC_BTCPAY_URL", "BTCPAY_URL").replace(/\/+$/, "")
  const apiKey = pickEnv(env, "PICC_BTCPAY_API_KEY", "BTCPAY_API_KEY")
  const storeId = pickEnv(env, "PICC_BTCPAY_STORE_ID", "BTCPAY_STORE_ID")
  const methodId = pickEnv(env, "PICC_BTCPAY_PAYMENT_METHOD_ID", "BTCPAY_PAYMENT_METHOD_ID") || "BTC"
  return { url, apiKey, storeId, methodId }
}

export async function readBtcpayLeg(deps = {}) {
  const env = deps.env ?? process.env
  const { url, apiKey, storeId, methodId } = btcpayConf(env)
  const base = {
    id: "btcpay", kind: "btcpay", ccy: methodId, amount: null,
    observedAt: null, status: "ABSENT", reason: "btcpay-unconfigured",
    fxSource: null, fxAt: null, unconfirmed: null
  }
  if (!url || !apiKey || !storeId) return base
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  try {
    const res = await fetchImpl(
      `${url}/api/v1/stores/${encodeURIComponent(storeId)}/payment-methods/${encodeURIComponent(methodId)}/wallet`,
      { method: "GET", headers: { Authorization: `token ${apiKey}` } }
    )
    if (!res?.ok) {
      return { ...base, reason: `btcpay-http-${res?.status ?? "unknown"}` }
    }
    const data = await res.json().catch(() => ({}))
    const confirmed = Number(data?.confirmedBalance)
    if (!Number.isFinite(confirmed)) {
      return { ...base, reason: "btcpay-unobservable:missing-confirmedBalance" }
    }
    const unconfirmedRaw = Number(data?.unconfirmedBalance)
    const observedAt = nowIso()
    return {
      ...base,
      // Settled-only billing (decision 7): confirmedBalance is the leg;
      // unconfirmed is evidence on the side, never summed.
      amount: confirmed,
      unconfirmed: Number.isFinite(unconfirmedRaw) ? unconfirmedRaw : null,
      observedAt,
      status: statusFor(observedAt),
      reason: null
    }
  } catch {
    return { ...base, reason: "btcpay-unreachable" }
  }
}

// ── Default FX readers (Task 2's injected-reader contract) ───────────────────
// Each returns `{ rate, quotedAt } | null` — null when unobservable.
// USD is 1 by definition (no observation needed).

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"

function yahooQuotedAt(result) {
  const stamps = result?.timestamp
  if (Array.isArray(stamps) && stamps.length > 0) {
    const last = stamps[stamps.length - 1]
    if (Number.isFinite(Number(last))) return new Date(Number(last) * 1000).toISOString()
  }
  return nowIso()
}

async function yahooPair(pair, fetchImpl) {
  const res = await fetchImpl(
    `${YAHOO_BASE}/${encodeURIComponent(pair)}?range=5d&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0 (PICC dashboard)" } }
  )
  if (!res?.ok) return null
  const json = await res.json().catch(() => null)
  const result = json?.chart?.result?.[0]
  const price = Number(result?.meta?.regularMarketPrice)
  if (!Number.isFinite(price) || price <= 0) return null
  return { price, quotedAt: yahooQuotedAt(result) }
}

export async function yahooQuote(ccy, deps = {}) {
  const code = String(ccy ?? "").trim().toUpperCase()
  if (!code) return null
  if (code === "USD") return { rate: 1, quotedAt: nowIso() }
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  try {
    // Direct quote: CCY priced in USD (e.g. MYRUSD=X = MYR in USD).
    const direct = await yahooPair(`${code}USD=X`, fetchImpl)
    if (direct) return { rate: direct.price, quotedAt: direct.quotedAt }
    // Inverse quote: USD priced in CCY (e.g. USDJPY=X) — invert honestly.
    const inverse = await yahooPair(`USD${code}=X`, fetchImpl)
    if (inverse) return { rate: 1 / inverse.price, quotedAt: inverse.quotedAt }
    return null
  } catch {
    return null
  }
}

export async function ccxtQuote(ccy, deps = {}) {
  const code = String(ccy ?? "").trim().toUpperCase()
  if (!code) return null
  if (code === "USD") return { rate: 1, quotedAt: nowIso() }
  try {
    if (typeof deps.referencePrice === "function") {
      const r = await deps.referencePrice({ ccy: code })
      const price = Number(r?.price)
      if (!Number.isFinite(price) || price <= 0) return null
      return { rate: price, quotedAt: r?.at ? new Date(r.at).toISOString() : nowIso() }
    }
    const { fetchReferencePrice } = await import("../ccxtOrdering.mjs")
    const exchange = (deps.env ?? process.env).PICC_WEALTH_CCXT_QUOTE_EXCHANGE ?? "coinbase"
    for (const symbol of [`${code}/USD`, `${code}/USDT`]) {
      const r = await fetchReferencePrice({ exchange, symbol })
      if (r && Number.isFinite(Number(r.price)) && Number(r.price) > 0) {
        return {
          rate: Number(r.price),
          quotedAt: r.at ? new Date(r.at).toISOString() : nowIso()
        }
      }
    }
    return null
  } catch {
    return null
  }
}
