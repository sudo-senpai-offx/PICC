// Free crypto market data from CoinGecko (public API, no key required).
// Powers the "Crypto & markets" widget: watchlist prices, top movers, trending coins.
const BASE = "https://api.coingecko.com/api/v3"
const CACHE_TTL_MS = 2 * 60 * 1000
const cache = new Map()

const WATCHLIST = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "polkadot", symbol: "DOT", name: "Polkadot" },
  { id: "litecoin", symbol: "LTC", name: "Litecoin" },
  { id: "chainlink", symbol: "LINK", name: "Chainlink" }
]

async function cached(key, ttl, loader) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.data
  const data = await loader()
  cache.set(key, { at: Date.now(), data })
  return data
}

async function getJSON(url) {
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (PICC dashboard)" },
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) {
    if (res.status === 429) throw new Error("CoinGecko rate limited — try again shortly")
    throw new Error(`CoinGecko HTTP ${res.status}`)
  }
  return res.json()
}

export async function getCryptoMarket() {
  return cached("market", CACHE_TTL_MS, async () => {
    const ids = WATCHLIST.map((w) => w.id).join(",")

    const [simple, marketsRes, trendingRes] = await Promise.allSettled([
      getJSON(
        `${BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true`
      ),
      getJSON(`${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h&sparkline=false`),
      getJSON(`${BASE}/search/trending`)
    ])

    const priceMap = simple.status === "fulfilled" ? simple.value : {}
    const marketRows = marketsRes.status === "fulfilled" ? marketsRes.value : []
    const trending =
      trendingRes.status === "fulfilled" && Array.isArray(trendingRes.value?.coins)
        ? trendingRes.value.coins.map((c) => ({
            id: c.item?.id,
            name: c.item?.name,
            symbol: c.item?.symbol,
            thumb: c.item?.thumb,
            rank: c.item?.market_cap_rank ?? c.item?.score ?? null
          }))
        : []

    const watchlist = WATCHLIST.map((w) => {
      const p = priceMap[w.id]
      return {
        id: w.id,
        symbol: w.symbol,
        name: w.name,
        price: typeof p?.usd === "number" ? p.usd : null,
        change24h: typeof p?.usd_24h_change === "number" ? p.usd_24h_change / 100 : null,
        marketCap: typeof p?.usd_market_cap === "number" ? p.usd_market_cap : null
      }
    })

    const priced = marketRows.filter((c) => typeof c.price_change_percentage_24h === "number")
    const sortByChange = (a, b) => a.price_change_percentage_24h - b.price_change_percentage_24h
    const mapMover = (c) => ({
      id: c.id,
      symbol: String(c.symbol ?? "").toUpperCase(),
      name: c.name,
      price: c.current_price ?? null,
      change24h: (c.price_change_percentage_24h ?? 0) / 100,
      marketCap: c.market_cap ?? null
    })
    const losers = [...priced].sort(sortByChange).slice(0, 5).map(mapMover)
    const gainers = [...priced].sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h).slice(0, 5).map(mapMover)

    return {
      updatedAt: Date.now(),
      watchlist,
      movers: { gainers, losers },
      trending
    }
  })
}

/** Current USD price + 24h change for a single CoinGecko coin id or symbol. */
export async function getCryptoPrice(query) {
  const id = String(query || "").trim().toLowerCase()
  if (!id) throw new Error("coin id required")
  return cached(`price:${id}`, 60 * 1000, async () => {
    const data = await getJSON(
      `${BASE}/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
    )
    const p = data?.[id]
    if (!p) throw new Error(`unknown coin: ${id}`)
    return {
      id,
      price: typeof p.usd === "number" ? p.usd : null,
      change24h: typeof p.usd_24h_change === "number" ? p.usd_24h_change / 100 : null,
      marketCap: typeof p.usd_market_cap === "number" ? p.usd_market_cap : null
    }
  })
}

/** @internal for tests */
export function _clearCryptoCache() {
  cache.clear()
}
