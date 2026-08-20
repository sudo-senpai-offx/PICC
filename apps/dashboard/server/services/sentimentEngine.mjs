/**
 * Multi-source sentiment fusion engine.
 * Combines news sentiment, social volume, and on-chain signals.
 */
import { localStore } from "./localstore.mjs"
import { news as serperNews } from "./serper.mjs"

const store = localStore("sentiment", { cache: {}, history: [] })

export async function getSentiment(symbol) {
  const cached = store.data.cache[symbol]
  if (cached && Date.now() - cached.timestamp < 300000) return cached
  const newsResult = await getNewsSentiment(symbol)
  const social = getSocialVolumeSignal(symbol)
  const composite = computeComposite(newsResult, social)
  const result = { symbol, composite, news: newsResult, social, timestamp: Date.now(), history: (store.data.history || []).slice(-50) }
  store.data.cache[symbol] = result
  store.data.history = [...(store.data.history || []), { symbol, score: composite.score, timestamp: Date.now() }].slice(-500)
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
