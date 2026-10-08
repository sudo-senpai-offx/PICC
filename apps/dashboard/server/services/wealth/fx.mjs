// Wealth FX — USD conversion via observed Yahoo/CCXT rates.
//
// Spec decisions 11 + 19 (binding):
// - Declared parity for USD-pegged stables (labeled assumption, no observation).
// - Every other currency always via an observed Yahoo/CCXT rate; missing or
//   stale-beyond-threshold rates exclude the leg with `fx-unobservable:<ccy>`
//   (never last-known-stale conversion, never total-nulling).
// - Conflicts resolve freshest-wins by quoted-at; tie goes to CCXT.
// - Freshness uses the same 90s/5min rule as legs (decision 10):
//   LIVE < 90s, usable < 5min, older excluded.
//
// Pure async mapper. Price readers are injected — no imports from market
// modules, no network in this file (hermetic tests use doubles).

// Declared-parity assumption (decision 11): these trade at 1 USD by
// declaration, labeled `fxSource: "declared-parity"`, never observed.
export const PEGGED = new Set(["USDT", "USDC", "DAI"])

// Leg-freshness twin of the same rule (decision 10): legs read LIVE < 90s.
// For FX only the usability bound matters (older excluded); the 90s LIVE
// bound stays documented here so the two never drift apart silently.
const USABLE_MS = 5 * 60_000
const FUTURE_SKEW_MS = 60_000

function quoteTimeMs(quotedAt) {
  const t = new Date(quotedAt).getTime()
  return Number.isFinite(t) ? t : null
}

function usableQuote(q, now) {
  if (!q || typeof q !== "object") return null
  const rate = Number(q.rate)
  if (!Number.isFinite(rate) || rate <= 0) return null
  const t = quoteTimeMs(q.quotedAt)
  if (t === null) return null
  const age = now - t
  if (age > USABLE_MS) return null
  if (age < -FUTURE_SKEW_MS) return null
  return { rate, quotedAt: q.quotedAt, t }
}

async function safeQuote(fn, ccy) {
  try {
    if (typeof fn !== "function") return null
    return await fn(ccy)
  } catch {
    return null
  }
}

export async function convertToUsd(ccy, amount, readers) {
  const qty = Number(amount)
  if (!Number.isFinite(qty)) {
    return { usd: null, reason: `fx-invalid-amount:${ccy}` }
  }
  // Base currency and declared-parity stables skip observation (decision 11).
  if (ccy === "USD" || PEGGED.has(ccy)) {
    return { usd: qty, fxSource: "declared-parity", fxAt: null }
  }
  const now = Date.now()
  const [yahooRaw, ccxtRaw] = await Promise.all([
    safeQuote(readers?.yahooQuote, ccy),
    safeQuote(readers?.ccxtQuote, ccy)
  ])
  const yahoo = usableQuote(yahooRaw, now)
  const ccxt = usableQuote(ccxtRaw, now)
  let winner = null
  let fxSource = null
  if (yahoo && ccxt) {
    // Freshest quotedAt wins; tie goes to CCXT (decision 19).
    if (ccxt.t >= yahoo.t) {
      winner = ccxt
      fxSource = "ccxt"
    } else {
      winner = yahoo
      fxSource = "yahoo"
    }
  } else if (ccxt) {
    winner = ccxt
    fxSource = "ccxt"
  } else if (yahoo) {
    winner = yahoo
    fxSource = "yahoo"
  }
  if (!winner) {
    return { usd: null, reason: `fx-unobservable:${ccy}` }
  }
  return { usd: qty * winner.rate, fxSource, fxAt: winner.quotedAt }
}
