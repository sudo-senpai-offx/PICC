// ExpertOption DOM-selector map — PICC's data-collection layer for the
// Priority-1 venue. PURE module: takes a document-like reader and returns
// extracted observations. No global state, no side effects, no secrets.
//
// Design constraints:
//   • Versioned anchor map — EO is a hashed-class React SPA, so selectors are
//     TEXT ANCHORS ("balance", the pair label, a standalone price blob) not
//     brittle class names. Same pattern as the server bridge's `text:` selector.
//   • Honest extraction — every reader returns null when the anchor is not
//     clearly on the page. No fabricated or zero-filled observations.
//   • Collector only — this module NEVER builds an order, expiry, or trade
//     intent. It reports what the page shows.
//   • Testable — takes `doc` explicitly; the dashboard suite drives it with a
//     fake document (no jsdom).

export const EO_SELECTOR_SPEC_VERSION = "2026-08-28.1"

/** Minimal document surface the selectors need — easy to fake in tests. */
export interface DocLike {
  querySelectorAll(selectors: string): Iterable<{
    textContent: string | null
    innerText?: string | undefined
  }>
}

const TEXT_TAGS = "div, span, p, strong, td, h1, h2, h3, li, label, a, dd, dt, button"

/** Shortest element whose text contains `needle` and (optionally) a digit. */
export function findAnchorText(
  doc: DocLike,
  needle: string,
  opts: { needNumber?: boolean; maxLen?: number } = {}
): string | null {
  const { needNumber = true, maxLen = 120 } = opts
  const needleLower = needle.toLowerCase()
  const matches: string[] = []
  for (const el of doc.querySelectorAll(TEXT_TAGS)) {
    const t = (el.textContent ?? "").trim().replace(/\s+/g, " ")
    if (!t) continue
    if (!t.toLowerCase().includes(needleLower)) continue
    if (maxLen > 0 && t.length > maxLen) continue
    matches.push(t)
  }
  if (matches.length === 0) return null
  if (needNumber) {
    const withNumber = matches.filter((m) => /\d/.test(m))
    if (withNumber.length) matches.splice(0, matches.length, ...withNumber)
  }
  matches.sort((a, b) => a.length - b.length)
  return matches[0]?.slice(0, maxLen) ?? null
}

/** First number inside a scraped label — commas and decimal commas accepted. */
export function numberFromText(text: string | null): number | null {
  if (!text) return null
  const m = text.match(/[\d][\d.,\s]*/)?.[0]
  if (!m) return null
  const n = Number(m.replace(/\s/g, "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

/** Anchored pair labels EO renders verbatim when nothing canonical matches. */
const PAIR_LABEL_ANCHORS = ["EUR / USD", "EUR/USD", "GBP / USD", "BTC / USD", "ETH / USD", "GOLD", "SILVER", "US 500", "US500", "WALL STREET", "DOW", "NASDAQ"]

/** The currently-viewed instrument label (chart/header), e.g. "EUR/USD". */
export function extractActiveAssetLabel(doc: DocLike): string | null {
  let best: string | null = null
  for (const el of doc.querySelectorAll(TEXT_TAGS)) {
    const t = (el.textContent ?? "").trim().replace(/\s+/g, " ")
    if (!t || t.length > 40) continue
    const matchingAnchor = PAIR_LABEL_ANCHORS.find((a) => t === a || t.endsWith(a) || t.startsWith(a))
    const upper = t.toUpperCase()
    const looksPair =
      matchingAnchor != null ||
      (/^[A-Z0-9 .\/-]{3,30}$/.test(t) && /[A-Za-z]/.test(t) && (upper.includes("/") || /^BTC|^ETH|^GOLD|^SILVER|^US ?500|^WALL ?STREET|^DOW|^NASDAQ/.test(upper)))
    if (!looksPair) continue
    // A lone-digit blob is a price/clock, not an instrument label.
    if (matchingAnchor == null && /\d/.test(t) && !/^[A-Z0-9]+$/.test(t)) continue
    // "Trade · EUR/USD" → report the anchored suffix, not the whole element.
    let candidate = t
    if (matchingAnchor && t.endsWith(matchingAnchor) && t !== matchingAnchor) candidate = matchingAnchor
    if (best === null || candidate.length < best.length) best = candidate
  }
  return best
}

/**
 * The live price blob — a standalone compact number in the chart header.
 * Callers must ALSO gate on extractActiveAssetLabel: the two anchors together
 * are what make a statement like "price visible" honest.
 */
export function extractLivePrice(doc: DocLike): number | null {
  for (const el of doc.querySelectorAll(TEXT_TAGS)) {
    const t = (el.textContent ?? "").trim().replace(/\s+/g, " ")
    if (!t || t.length > 18) continue
    // Price-shaped: 3+ numeric chars, no letters, no clock/date punctuation.
    if (!/^[\d.,]{3,15}$/.test(t)) continue
    const hasDot = t.includes(".")
    const hasComma = t.includes(",")
    // Decimal commas from locale-formatted pages misread badly ("1,09812" is
    // 1.09 not 109812) — only accept comma-only blobs in a thousands pattern
    // ("64,213"), otherwise require a real dot decimal.
    if (hasComma && !hasDot && !/^\d{1,3}(,\d{3})+$/.test(t)) continue
    const n = numberFromText(t)
    if (n != null && n > 0) return n
  }
  return null
}

const BALANCE_ANCHORS = ["Balance", "Available", "Account"]

/** Currency signals the page advertises — symbol first, then word anchors. */
function currencyFromLabel(label: string): string | null {
  if (label.includes("$")) return "USD"
  if (label.includes("€")) return "EUR"
  if (label.includes("£")) return "GBP"
  const m = label.match(/\b(USD|EUR|GBP|USDT?)\b/i)
  return m?.[1]?.toUpperCase() ?? null
}

/** The account balance shown in the wallet header. */
export function extractBalance(doc: DocLike): { amount: number | null; currency: string | null } {
  for (const anchor of BALANCE_ANCHORS) {
    const label = findAnchorText(doc, anchor, { needNumber: true, maxLen: 60 })
    if (label) {
      const amount = numberFromText(label)
      return { amount, currency: currencyFromLabel(label) }
    }
  }
  return { amount: null, currency: null }
}

const POSITION_ANCHORS = ["Open deals", "Open positions", "Active deals"]

interface PositionRow {
  amount: number | null
  expiry: string | null
  profitMark: string | null
}

/**
 * Open binary deals/positions from the deals dialog. Rows are currency-led
 * ("$25.00 Trade · 15:30") inside a section whose text mentions the dialog.
 */
export function extractOpenPositions(doc: DocLike): { count: number | null; rows: PositionRow[] } {
  const rows: PositionRow[] = []
  let sectionSeen = false
  for (const el of doc.querySelectorAll(TEXT_TAGS)) {
    const t = (el.textContent ?? "").trim().replace(/\s+/g, " ")
    if (!t || t.length > 160) continue
    if (POSITION_ANCHORS.some((p) => t.includes(p))) {
      sectionSeen = true // the dialog header — not a row itself
      continue
    }
    if (!sectionSeen) continue
    // Rows are currency-led: "$25.00 Trade · 15:30"
    if (!/^\$\d/.test(t) || !/Trade|Deal|Option/i.test(t)) continue
    const amount = numberFromText(t)
    if (amount == null) continue
    const expiry = t.match(/\b\d{1,2}:\d{2}\b/)?.[0] ?? null
    rows.push({ amount, expiry, profitMark: null })
    if (rows.length >= 20) break
  }
  return { count: rows.length > 0 ? rows.length : null, rows }
}