// PICC crypto & staking yield monitor — free, keyless reference data.
//
//   DeFi pools:       https://yields.llama.fi/pools   (real-time, no key)
//   Liquid staking:   derived from the pools list by matching known LSD token
//                     symbols (the dedicated /lsdRates endpoint is paywalled).
//   Native staking:   curated reference APYs from CoinGecko's published
//                     staking research (rates vary with network stake level
//                     and validator performance — treated as ranges, not quotes).
//
// The pool fetch goes through the shared polite rate limiter and is cached
// for an hour so the dashboard never pounds DeFiLlama (the /pools payload is
// large — single-flight + TTL keeps it to one fetch per hour).
import { cached, throttle } from "./rateLimit.mjs"

const POOLS_URL = "https://yields.llama.fi/pools"
const CACHE_TTL_MS = 60 * 60 * 1000
const POOL_MIN_TTL_MS = 60 * 1000

export const YIELD_SOURCES = {
  defi: "DeFiLlama yields API",
  lsd: "DeFiLlama pools (liquid-staking filter)",
  native: "CoinGecko staking research (2024–2026)"
}

// Native-staking APY ranges are reference figures from CoinGecko's published
// staking research. They move with network stake levels — shown as ranges.
export const NATIVE_STAKING = [
  { symbol: "ETH", name: "Ethereum", apyLow: 2.7, apyHigh: 3.5, note: "Native solo staking; liquid staking (Lido/Rocket Pool) is easier." },
  { symbol: "SOL", name: "Solana", apyLow: 5.9, apyHigh: 7.0, note: "Inflation-based; rewards fall as stake ratio grows." },
  { symbol: "ADA", name: "Cardano", apyLow: 2.3, apyHigh: 3.0, note: "Non-custodial pool delegation, no lock-up." },
  { symbol: "AVAX", name: "Avalanche", apyLow: 6.7, apyHigh: 8.0, note: "Delegate to a validator with low fee; 14-day lock." },
  { symbol: "SUI", name: "Sui", apyLow: 1.7, apyHigh: 3.0, note: "Native staking, no lock-up; validator cuts vary." },
  { symbol: "DOT", name: "Polkadot", apyLow: 11.5, apyHigh: 12.5, note: "Nominated Proof-of-Stake; 28-day unbonding." },
  { symbol: "XTZ", name: "Tezos", apyLow: 8.5, apyHigh: 10.0, note: "Baker delegation; no lock-up." },
  { symbol: "ATOM", name: "Cosmos", apyLow: 18.5, apyHigh: 20.6, note: "Highest in the table; validator commission + unbonding 21 days." },
  { symbol: "APT", name: "Aptos", apyLow: 6.5, apyHigh: 7.5, note: "Direct or liquid staking via DEXs." },
  { symbol: "TRX", name: "Tron", apyLow: 4.5, apyHigh: 6.0, note: "Energy/bandwidth delegated staking; no lock-up." }
]

const LSD_COIN_SUFFIXES = new Set([
  "ETH", "SOL", "AVAX", "SUI", "DOT", "ATOM", "TIA", "SEI", "NEAR", "FIL", "TAO", "MATIC", "BNB", "INJ", "OSMO"
])
const LSD_EXTRA = new Set(["JITOSOL", "MSOL", "BSOL", "JSOL", "SAVAX", "SSUI", "SDOT", "SATOM", "SUSDE", "SDEUSD"])

function isLsdSymbol(raw) {
  const s = String(raw ?? "").toUpperCase().trim()
  if (LSD_EXTRA.has(s)) return true
  const m = s.match(/^(ST|WST|CB|R|WE|OS|SFXR)([A-Z]+)$/)
  return Boolean(m && LSD_COIN_SUFFIXES.has(m[2]))
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.data)) return payload.data
  return []
}

async function fetchJSON(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "PICC-dashboard/0.2.0", Accept: "application/json" }
  })
  if (!r.ok) throw new Error(`yield source ${url} responded ${r.status}`)
  return r.json()
}

/** Raw DeFi pool list from DeFiLlama (single-flight cached + rate limited). */
export function fetchDefiPools() {
  return cached("yields:defi", CACHE_TTL_MS, async () => {
    const gated = throttle("yields:defi", POOL_MIN_TTL_MS)
    if (!gated.allowed) throw new Error(`rate limited (retry in ${gated.remainingMs}ms)`)
    return asArray(await fetchJSON(POOLS_URL))
  })
}

/**
 * Curated yield snapshot. Filters DeFiLlama pools to plausible, high-TVL,
 * non-bonus-bloated options so the dashboard only surfaces realistic rates.
 * Liquid-staking rows are derived from the same pools list (the dedicated
 * LSD endpoint is paywalled). Read-only reference data — no staking, moving,
 * or lending ever happens here.
 */
export async function yieldSnapshot({ minTvlUsd = 10_000_000, maxApy = 100, top = 8 } = {}) {
  const pools = await fetchDefiPools()

  const defi = pools
    .filter((p) => {
      const apy = Number(p?.apy)
      const tvl = Number(p?.tvlUsd)
      return Number.isFinite(apy) && Number.isFinite(tvl) && tvl >= minTvlUsd && apy >= 0.1 && apy <= maxApy
    })
    .map((p) => ({
      pool: String(p.pool ?? ""),
      project: String(p.project ?? "unknown"),
      symbol: String(p.symbol ?? "?"),
      chain: String(p.chain ?? ""),
      apy: Number(p.apy),
      apyBase: Number(p.apyBase) || 0,
      apyReward: Number(p.apyReward) || 0,
      tvlUsd: Math.round(Number(p.tvlUsd) || 0),
      il7d: Number.isFinite(Number(p.il7d)) ? Number(p.il7d) : 0,
      ilRisk: Number(p.il7d) < -2,
      poolMeta: p.poolMeta ? String(p.poolMeta) : ""
    }))
    .sort((a, b) => b.apy - a.apy)
    .slice(0, Math.max(1, Math.min(top, 25)))

  // Best rate per LSD asset: keep the highest-APY pool for each symbol and
  // floor out near-zero pools so the reference card only shows real rates.
  const best = new Map()
  for (const p of pools) {
    if (!isLsdSymbol(p?.symbol)) continue
    const apy = Number(p?.apy)
    const tvl = Number(p?.tvlUsd)
    if (!Number.isFinite(apy) || !Number.isFinite(tvl) || apy < 0.5) continue
    const sym = String(p.symbol).toUpperCase()
    const cur = best.get(sym)
    if (!cur || apy > cur.apy) {
      best.set(sym, { symbol: String(p.symbol), apy, tvlUsd: Math.round(tvl) })
    }
  }
  const liquid = [...best.values()]
    .sort((a, b) => b.apy - a.apy)
    .slice(0, 6)

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    sources: YIELD_SOURCES,
    native: NATIVE_STAKING,
    lsd: liquid,
    defi,
    filters: { minTvlUsd, maxApy }
  }
}
