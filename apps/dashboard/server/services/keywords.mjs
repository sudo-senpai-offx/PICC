// Lightweight Amazon keyword research for the Listing Optimizer.
// Extracts weighted unigrams/bigrams/trigrams from the user's own listing text
// (free, local), then optionally enriches with long-tail ideas from an LLM.
const STOP = new Set(
  `a an the and or but if then than so for with without into from by on at in of to as is are was were be been being
  this that these those it its they their there here we you your our us i me my not no yes product products item items
  new best top quality perfect great amazing easy use used using make makes made features feature includes include
  ideal perfect suitable perfect for excellent high premium durable long lasting most more less very much many few
  all each any some every one two three etc whats what why how when where who which amazon listing`.split(/\s+/)
)

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'&%-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
}

function addGram(map, gram) {
  map.set(gram, (map.get(gram) ?? 0) + 1)
}

/** Extract weighted unigrams + n-grams from title and bullets. */
export function extractKeywords(title, bullets) {
  const texts = [String(title || ""), ...(Array.isArray(bullets) ? bullets : []).map(String)]
  const tokens = tokenize(texts.join(" "))

  const unigrams = new Map()
  const bigrams = new Map()
  const trigrams = new Map()
  for (let i = 0; i < tokens.length; i++) {
    addGram(unigrams, tokens[i])
    if (i + 1 < tokens.length) addGram(bigrams, `${tokens[i]} ${tokens[i + 1]}`)
    if (i + 2 < tokens.length) addGram(trigrams, `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`)
  }

  const top = (map, max) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .slice(0, max)
      .map(([word, count]) => ({ word, count }))

  return {
    unigrams: top(unigrams, 15).filter((k) => k.count >= 1),
    phrases: top(bigrams, 10).concat(top(trigrams, 6)).slice(0, 12),
    source: "local"
  }
}
