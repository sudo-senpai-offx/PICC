// Canonical PICC asset catalog — single source of truth for normalizing
// instrument names across the extension overlay, the server pipeline and the
// Yahoo fallback feed.
//
// Brokers surface instruments under wildly different labels ("XAU/USD",
// "Gold (OTC)", "BITCOIN", "US30", "Wall Street", "S&P 500"...). Every layer
// previously had its own partial mapping, so active-asset detection silently
// failed for anything outside plain forex pairs and the two metals. These
// tables give one canonical id per instrument class:
//   forex pairs · crypto · metals · energies · indices · equities
//
// Keep the ALIASES table mirrored in extensions/picc-overlay/content.js
// (normalizeAssetId) so client and server always agree.

export const ASSET_ALIASES = {
  // ── Metals ──────────────────────────────────────────────────────────────
  GOLD: ["GOLD", "XAUUSD", "XAU", "GOLDUSD", "GOLD/USD", "GOLDUSDOtc"],
  SILVER: ["SILVER", "XAGUSD", "XAG", "SILVERUSD"],
  PLATINUM: ["PLATINUM", "XPTUSD", "XPT"],
  PALLADIUM: ["PALLADIUM", "XPDUSD", "XPD"],
  COPPER: ["COPPER", "HG", "COPPERUSD"],

  // ── Energies ────────────────────────────────────────────────────────────
  OIL: ["OIL", "WTI", "WTIUSD", "USOIL", "CRUDE", "CRUDEOIL", "USCRUDE", "XTIUSD"],
  BRENT: ["BRENT", "BRENTOIL", "UKOIL", "XBRUSD"],
  NATGAS: ["NATGAS", "NATURALGAS", "NGAS", "GAS"],

  // ── Indices ─────────────────────────────────────────────────────────────
  US30: ["US30", "DOW", "DOWJONES", "DJI", "WALLSTREET", "WALLSTREET30"],
  NAS100: ["NAS100", "USTEC", "NASDAQ", "NASDAQ100", "USTECH"],
  SPX500: ["SPX500", "US500", "SP500", "S&P500", "INX"],
  GER40: ["GER40", "GER30", "DAX", "DE40", "GERMANY40"],
  UK100: ["UK100", "FTSE", "FTSE100"],
  FRA40: ["FRA40", "CAC40", "CAC"],
  EU50: ["EU50", "STOXX50", "ESTX50"],
  JP225: ["JP225", "NIKKEI", "NIKKEI225", "JAPAN225"],
  AUS200: ["AUS200", "ASX200"],
  HK50: ["HK50", "HANGSENG", "HSI"],
  VIX: ["VIX", "VOLATILITY"],

  // ── Crypto (full names + short handles) ─────────────────────────────────
  BTCUSD: ["BTCUSD", "BTC/USD", "BITCOIN", "BTC", "XBTUSD"],
  ETHUSD: ["ETHUSD", "ETH/USD", "ETHEREUM", "ETH"],
  LTCUSD: ["LTCUSD", "LITECOIN", "LTC"],
  XRPUSD: ["XRPUSD", "RIPPLE", "XRP"],
  SOLUSD: ["SOLUSD", "SOLANA", "SOL"],
  ADAUSD: ["ADAUSD", "CARDANO", "ADA"],
  DOGEUSD: ["DOGEUSD", "DOGECOIN", "DOGE"],
  DOTUSD: ["DOTUSD", "POLKADOT", "DOT"],
  LINKUSD: ["LINKUSD", "CHAINLINK", "LINK"],
  AVAXUSD: ["AVAXUSD", "AVALANCHE", "AVAX"]
}

// alias (already separator-stripped, uppercased) → canonical id
const LOOKUP = new Map()
for (const [canonical, aliases] of Object.entries(ASSET_ALIASES)) {
  LOOKUP.set(canonical.toUpperCase(), canonical)
  for (const alias of aliases) {
    LOOKUP.set(String(alias).replace(/[/\s.\-_]+/g, "").toUpperCase(), canonical)
  }
}

/** Strip separators/OTC suffixes and resolve to the canonical PICC asset id. */
export function canonicalAssetId(raw) {
  if (!raw) return ""
  const s = String(raw)
    .replace(/\s*\(otc\)/gi, "")
    .replace(/[/\s.\-_]+/g, "")
    .toUpperCase()
  return LOOKUP.get(s) ?? s
}

/** True when two raw labels refer to the same canonical instrument. */
export function assetsEquivalent(a, b) {
  const ca = canonicalAssetId(a)
  const cb = canonicalAssetId(b)
  return Boolean(ca) && Boolean(cb) && ca === cb
}

/**
 * Map a canonical PICC asset id to a tradable Yahoo Finance symbol.
 * Falls through to forex/crypto pair conventions for unknown 6-letter ids.
 */
export function yahooSymbolFor(assetId) {
  const s = canonicalAssetId(assetId)
  const COMMODITIES = {
    GOLD: "GC=F",
    SILVER: "SI=F",
    PLATINUM: "PL=F",
    PALLADIUM: "PA=F",
    COPPER: "HG=F",
    OIL: "CL=F",
    BRENT: "BZ=F",
    NATGAS: "NG=F"
  }
  const INDICES = {
    US30: "^DJI",
    NAS100: "^NDX",
    SPX500: "^GSPC",
    GER40: "^GDAXI",
    UK100: "^FTSE",
    FRA40: "^FCHI",
    EU50: "^STOXX50E",
    JP225: "^N225",
    AUS200: "^AXJO",
    HK50: "^HSI",
    VIX: "^VIX"
  }
  if (COMMODITIES[s]) return COMMODITIES[s]
  if (INDICES[s]) return INDICES[s]

  // 6-letter ids: crypto bases use BASE-QUOTE, everything else QUOTE=X forex.
  if (/^[A-Z]{6}$/.test(s)) {
    const base = s.slice(0, 3)
    const quote = s.slice(3)
    const CRYPTO_BASES = new Set([
      "BTC", "ETH", "LTC", "XRP", "SOL", "DOGE", "ADA", "DOT", "BNB", "MATIC",
      "AVAX", "LINK", "UNI", "ATOM", "ETC", "FIL", "XLM", "XTZ", "VET", "TRX",
      "SHIB", "NEAR", "APT", "ARB", "OP", "SUI", "PEPE", "TON", "INJ", "SEI"
    ])
    if (CRYPTO_BASES.has(base)) return `${base}-${quote}`
    return `${s}=X`
  }

  // Equities / already-symbol-shaped ids pass through untouched.
  return s || assetId
}
