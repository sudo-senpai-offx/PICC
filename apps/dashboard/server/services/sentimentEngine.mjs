/**
 * Multi-source sentiment fusion engine.
 * Combines news sentiment, social volume, and on-chain signals.
 */
import { localStore } from "./localstore.mjs"
import { news as serperNews } from "./serper.mjs"

const store = localStore("sentiment", { cache: {}, history: [] })

// ── Symbol normalization: EO display names / numeric IDs → canonical tickers ──
const SYMBOL_MAP = {
  "EUR/USD": "EURUSD", "EUR/USD (OTC)": "EURUSD", "EURUSD": "EURUSD",
  "GBP/USD": "GBPUSD", "GBP/USD (OTC)": "GBPUSD", "GBPUSD": "GBPUSD",
  "USD/JPY": "USDJPY", "USD/JPY (OTC)": "USDJPY", "USDJPY": "USDJPY",
  "AUD/USD": "AUDUSD", "AUD/USD (OTC)": "AUDUSD", "AUDUSD": "AUDUSD",
  "USD/CAD": "USDCAD", "USD/CAD (OTC)": "USDCAD", "USDCAD": "USDCAD",
  "NZD/USD": "NZDUSD", "NZD/USD (OTC)": "NZDUSD", "NZDUSD": "NZDUSD",
  "USD/CHF": "USDCHF", "USD/CHF (OTC)": "USDCHF", "USDCHF": "USDCHF",
  "EUR/GBP": "EURGBP", "EUR/JPY": "EURJPY", "GBP/JPY": "GBPJPY",
  "AUD/JPY": "AUDJPY", "EUR/AUD": "EURAUD", "EUR/CAD": "EURCAD",
  "EUR/NZD": "EURNZD", "EUR/CHF": "EURCHF", "GBP/AUD": "GBPAUD",
  "GBP/CAD": "GBPCAD", "GBP/NZD": "GBPNZD", "GBP/CHF": "GBPCHF",
  "AUD/CAD": "AUDCAD", "AUD/NZD": "AUDNZD", "AUD/CHF": "AUDCHF",
  "CAD/JPY": "CADJPY", "CHF/JPY": "CHFJPY", "NZD/JPY": "NZDJPY",
  "CAD/CHF": "CADCHF", "NZD/CHF": "NZDCHF",
  "GOLD": "XAUUSD", "XAUUSD": "XAUUSD", "Gold": "XAUUSD",
  "SILVER": "XAGUSD", "XAGUSD": "XAGUSD", "Silver": "XAGUSD",
  "BITCOIN": "BTCUSD", "BTCUSD": "BTCUSD", "Bitcoin": "BTCUSD", "BTC/USD": "BTCUSD",
  "ETHEREUM": "ETHUSD", "ETHUSD": "ETHUSD", "Ethereum": "ETHUSD", "ETH/USD": "ETHUSD",
  "OIL": "USOIL", "USOIL": "USOIL", "Crude Oil": "USOIL",
  "NASDAQ": "NASDAQ", "S&P500": "SPX500", "SP500": "SPX500",
}
function normalizeSentimentSymbol(raw) {
  if (!raw) return "EURUSD"
  const s = String(raw).trim()
  if (SYMBOL_MAP[s]) return SYMBOL_MAP[s]
  const cleaned = s.replace(/[-]?\s*\(otc\)|[-]otc\b/gi, "").replace(/\s+/g, "").toUpperCase()
  if (SYMBOL_MAP[cleaned]) return SYMBOL_MAP[cleaned]
  // Numeric IDs (EO internal) — can't normalize, skip news search
  if (/^\d+$/.test(cleaned)) return null
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(cleaned)) return cleaned.replace("/", "")
  if (/^[A-Z]{6}$/.test(cleaned)) return cleaned
  return cleaned.slice(0, 12) || "EURUSD"
}

export async function getSentiment(symbol) {
  const normalized = normalizeSentimentSymbol(symbol)
  // Numeric IDs (EO internal) can't be searched — return neutral
  if (!normalized) return { symbol, composite: { score: 0, label: "Neutral", extreme: false, weighted: { news: 0, social: 0 } }, news: { score: 0, bullish: 0, bearish: 0, neutral: 0, sampleSize: 0, source: "news" }, social: { score: 0, velocity: 0, source: "social-derived" }, timestamp: Date.now(), history: [] }
  const cacheKey = normalized
  const cached = store.data.cache[cacheKey]
  if (cached && Date.now() - cached.timestamp < 300000) return cached
  const newsResult = await getNewsSentiment(normalized)
  const social = getSocialVolumeSignal(normalized)
  const composite = computeComposite(newsResult, social)
  const result = { symbol: normalized, composite, news: newsResult, social, timestamp: Date.now(), history: (store.data.history || []).slice(-50) }
  store.data.cache[cacheKey] = result
  store.data.history = [...(store.data.history || []), { symbol: normalized, score: composite.score, timestamp: Date.now() }].slice(-500)
  store.write()
  return result
}

async function getNewsSentiment(symbol) {
  try {
    const results = await serperNews(`${symbol} trading news`, 10)
    const items = (results || []).slice(0, 10)
    let bullish = 0, bearish = 0, neutral = 0
    for (const item of items) {
      const text = ((item.title || "") + " " + (item.snippet || "")).toLowerCase()
      if (/surge|rally|gain|bull|up|rise|soar|jump|high|record|beat|strong/.test(text)) bullish++
      else if (/drop|fall|bear|down|crash|decline|loss|weak|low|miss|slump/.test(text)) bearish++
      else neutral++
    }
    const total = bullish + bearish + neutral || 1
    const score = (bullish - bearish) / total
    return { score: Math.round(score * 100) / 100, bullish, bearish, neutral, sampleSize: items.length, source: "news" }
  } catch { return { score: 0, bullish: 0, bearish: 0, neutral: 0, sampleSize: 0, source: "news" } }
}

function getSocialVolumeSignal(symbol) {
  const history = (store.data.history || []).filter((h) => h.symbol === symbol).slice(-20)
  const avgScore = history.length > 0 ? history.reduce((s, h) => s + h.score, 0) / history.length : 0
  const velocity = history.length >= 2 ? history[history.length - 1].score - history[history.length - 2].score : 0
  const score = avgScore * 0.6 + velocity * 0.4
  return { score: Math.round(score * 100) / 100, velocity: Math.round(velocity * 100) / 100, source: "social-derived" }
}

function computeComposite(news, social) {
  const w1 = 0.6, w2 = 0.4
  const score = news.score * w1 + social.score * w2
  let label = "Neutral"
  if (score > 0.3) label = "Bullish"
  else if (score > 0.1) label = "Slightly Bullish"
  else if (score < -0.3) label = "Bearish"
  else if (score < -0.1) label = "Slightly Bearish"
  const extreme = Math.abs(score) > 0.5
  return { score: Math.round(score * 100) / 100, label, extreme, weighted: { news: Math.round(news.score * w1 * 100) / 100, social: Math.round(social.score * w2 * 100) / 100 } }
}
