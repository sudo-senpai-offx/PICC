// Trading catalog — the full asset breadth for the Live Chart selector.
//
// Grounded in assetCatalog.mjs (ASSET_ALIASES + yahooSymbolFor): every entry's
// id is either a canonical PICC asset id (metals/energies/indices/crypto/
// forex/equities from ASSET_ALIASES) or a curated equity/ETF ticker that passes
// through untouched (assetCatalog.mjs:162-163). QUICK_ASSETS (src/lib/trading.
// ts:623-630) is a sub-set of the forex/crypto/metals ids below, so the six
// quick-analysis buttons are all present — the endpoint test asserts that.
//
// Unmapable entries are excluded (no undefined) — every symbol below must
// resolve through yahooSymbolFor; the service filters and the test greps for
// the invariant.

import { yahooSymbolFor } from "./assetCatalog.mjs"

const NAMES = {
  // metals
  GOLD: "Gold (XAU)",
  SILVER: "Silver (XAG)",
  PLATINUM: "Platinum",
  PALLADIUM: "Palladium",
  COPPER: "Copper",
  // energies
  OIL: "WTI Crude Oil",
  BRENT: "Brent Crude",
  NATGAS: "Natural Gas",
  // indices
  US30: "US30 — Dow Jones",
  NAS100: "Nasdaq 100",
  SPX500: "S&P 500",
  GER40: "DAX 40",
  UK100: "FTSE 100",
  FRA40: "CAC 40",
  EU50: "Euro Stoxx 50",
  JP225: "Nikkei 225",
  AUS200: "ASX 200",
  HK50: "Hang Seng",
  VIX: "VIX Volatility",
  // crypto
  BTCUSD: "Bitcoin (BTC/USD)",
  ETHUSD: "Ethereum (ETH/USD)",
  LTCUSD: "Litecoin",
  XRPUSD: "Ripple (XRP)",
  SOLUSD: "Solana",
  ADAUSD: "Cardano",
  DOGEUSD: "Dogecoin",
  DOTUSD: "Polkadot",
  LINKUSD: "Chainlink",
  AVAXUSD: "Avalanche",
  // forex
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  USDCHF: "USD/CHF",
  AUDUSD: "AUD/USD",
  USDCAD: "USD/CAD",
  NZDUSD: "NZD/USD",
  EURGBP: "EUR/GBP",
  EURJPY: "EUR/JPY",
  GBPJPY: "GBP/JPY",
  USDTRY: "USD/TRY",
  USDZAR: "USD/ZAR",
  USDMXN: "USD/MXN"
}

// Curated liquid equity/ETF set — a super-set of the tickers the existing
// widgets already reference, all pass through yahooSymbolFor untouched.
const EQUITIES = [
  ["AAPL", "Apple"],
  ["TSLA", "Tesla"],
  ["GOOGL", "Alphabet (Google)"],
  ["MSFT", "Microsoft"],
  ["AMZN", "Amazon"],
  ["NVDA", "NVIDIA"],
  ["META", "Meta Platforms"],
  ["NFLX", "Netflix"],
  ["AMD", "AMD"],
  ["INTC", "Intel"],
  ["KO", "Coca-Cola"],
  ["JPM", "JPMorgan Chase"],
  ["BAC", "Bank of America"],
  ["WMT", "Walmart"],
  ["DIS", "Disney"],
  ["BA", "Boeing"],
  ["PFE", "Pfizer"]
]

const ETFS = [
  ["SPY", "SPDR S&P 500 ETF"],
  ["QQQ", "Invesco QQQ Trust (Nasdaq-100)"],
  ["IWM", "iShares Russell 2000 ETF"],
  ["DIA", "SPDR Dow Jones ETF"],
  ["EEM", "iShares MSCI Emerging Markets ETF"],
  ["VWO", "Vanguard FTSE Emerging Markets ETF"],
  ["GLD", "SPDR Gold Trust ETF"],
  ["SLV", "iShares Silver Trust ETF"],
  ["TLT", "iShares 20+ Year Treasury ETF"],
  ["HYG", "iShares High Yield Corporate Bond ETF"],
  ["LQD", "iShares Investment Grade Corporate Bond ETF"],
  ["XLE", "Energy Select Sector SPDR"],
  ["XLF", "Financials Select Sector SPDR"],
  ["XLK", "Technology Select Sector SPDR"],
  ["XLV", "Health Care Select Sector SPDR"],
  ["XLY", "Consumer Discretionary Select SPDR"],
  ["XLI", "Industrial Select Sector SPDR"],
  ["XLP", "Consumer Staples Select SPDR"],
  ["XLU", "Utilities Select SPDR"],
  ["VTI", "Vanguard Total Stock Market ETF"],
  ["ARKK", "ARK Innovation ETF"],
  ["SOXX", "iShares Semiconductor ETF"],
  ["TQQQ", "ProShares UltraPro QQQ (3x)"],
  ["UUP", "Invesco DB US Dollar Index ETF"]
]

const FOREX = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY", "USDTRY", "USDZAR", "USDMXN"]

// (id, name) tuples — category order mirrors the spec's requirement groups.
const CATEGORIES = [
  { id: "forex", name: "Forex", entries: FOREX },
  { id: "crypto", name: "Crypto", entries: ["BTCUSD", "ETHUSD", "LTCUSD", "XRPUSD", "SOLUSD", "ADAUSD", "DOGEUSD", "DOTUSD", "LINKUSD", "AVAXUSD"] },
  { id: "metals", name: "Metals", entries: ["GOLD", "SILVER", "PLATINUM", "PALLADIUM", "COPPER"] },
  { id: "energies", name: "Energies", entries: ["OIL", "BRENT", "NATGAS"] },
  { id: "indices", name: "Indices", entries: ["US30", "NAS100", "SPX500", "GER40", "UK100", "FRA40", "EU50", "JP225", "AUS200", "HK50", "VIX"] },
  { id: "equities", name: "Equities", entries: EQUITIES },
  { id: "etfs", name: "ETFs", entries: ETFS }
]

const nameFor = (tupleOrId) =>
  Array.isArray(tupleOrId) ? tupleOrId[1] : NAMES[tupleOrId] || tupleOrId

/** Grouped, symbol-resolvable catalog for GET /api/trading/catalog. */
export function tradingCatalog() {
  const categories = CATEGORIES.map(({ id, name, entries }) => ({
    id,
    name,
    symbols: entries
      .map((e) => {
        const assetId = Array.isArray(e) ? e[0] : e
        const yahooSymbol = yahooSymbolFor(assetId)
        // Exclusion seam: any entry that cannot resolve a Yahoo symbol is
        // dropped rather than shipped undefined (Decision D invariant).
        if (!yahooSymbol) return null
        return { id: assetId, name: nameFor(e), yahooSymbol }
      })
      .filter(Boolean)
  }))
  return { categories }
}

/** All catalog ids in display order — used by tests to assert QUICK_ASSETS presence. */
export function tradingCatalogIds() {
  return tradingCatalog().categories.flatMap((c) => c.symbols.map((s) => s.id))
}