// Autodetect — propose (never trust) an income-site adaptor from a URL + a few
// read-only page observations. Pure proposal builder: no writes, no side
// effects. Human acceptance = copying the proposal into a registerConnector
// (or config) definition; a proposal is always `tuned:false`.
import { getConnector, listConnectors, DEFAULT_CADENCE } from "./connectors.mjs"

// Standard profile-ish storage key names a page might keep (exact-key reads).
const PROFILE_KEY_RE = /(user|profile|account|session|member|id)([._-]|$)/i

// Small public-suffix heuristic: treat well-known second-level labels as part
// of the registrable domain so `foo.co.uk` -> `foo.co.uk` (not `co.uk`).
const BARELY_LD = new Set([
  "co", "com", "org", "net", "gov", "edu", "ac", "mil",
  "me", "io", "dev", "app", "cloud"
])

function registrableDomains(host) {
  const labels = host.split(".")
  if (labels.length >= 3 && BARELY_LD.has(labels[labels.length - 2])) {
    return labels.slice(-3).join(".")
  }
  return labels.slice(-2).join(".")
}

function originsFor(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    return [registrableDomains(host), host]
  } catch {
    return []
  }
}

function isSameHost(wsUrl, host) {
  try {
    const w = new URL(wsUrl).hostname.toLowerCase()
    const h = host.toLowerCase()
    if (w === h) return true
    // a subdomain of the page host is still the same site's gateway
    return w.endsWith(`.${h}`) || h.endsWith(`.${w}`)
  } catch {
    return false
  }
}

/**
 * Pure proposal builder.
 * @param {object} input
 * @param {string} input.url       observed page URL
 * @param {string[]} [input.domNodes]  number-bearing DOM node texts (heuristic hints)
 * @param {string[]} [input.storageKeys] storage key *names* the page reads
 * @param {string[]} [input.wsUrls]  page-observed WebSocket target URLs
 * @returns {object} proposal — always tuned:false
 */
export function fingerprint({ url, domNodes = [], storageKeys = [], wsUrls = [] } = {}) {
  const origins = originsFor(url)
  const rd = origins.length ? registrableDomains(origins[0]) : ""

  // 1. Match existing (fast path — avoids duplicate proposals). Check every
  //    candidate form of the observed host (registrable domain AND full host)
  //    against each connector's declared origins.
  for (const c of listConnectors()) {
    if ((c.origins || []).some((o) => origins.includes(o) || o === rd)) {
      return { matched: true, slug: c.slug, origins, tuned: false }
    }
  }
  const host = origins.length ? origins[0] : ""
  const scan = { mode: null, keys: [], profileKeys: null, wsUrlRe: null, mapFrame: null }
  let confidence = 0

  // 2. Scan proposal from page observations.
  const hasWs = (wsUrls || []).some((w) => isSameHost(w, host))
  const sawKeys = Array.isArray(storageKeys) ? storageKeys.filter(Boolean) : []
  const profileHit = sawKeys.some((k) => PROFILE_KEY_RE.test(k))
  const interactable = Array.isArray(domNodes) && domNodes.filter((d) => d != null && String(d).trim() !== "").length > 0

  if (hasWs) {
    scan.mode = "wsFrames"
    scan.wsUrlRe = rd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    scan.mapFrame = {
      balance: ["balance", "credits", "amount"],
      today: ["today", "daily", "earning", "profit"],
      lifetime: ["total", "lifetime", "alltime"]
    }
    confidence += 1
  }
  if (sawKeys.length) {
    scan.keys = sawKeys
    scan.profileKeys = profileHit || null
    if (scan.mode === null) scan.mode = "storageKeys"
    confidence += 1
  }
  if (interactable) confidence += 1

  const extractors = {
    candidates: interactable ? domNodes.length : 0,
    needsTune: true
  }

  return {
    slug: undefined, // no existing adaptor matched
    origins,
    proposed: {
      origins,
      cadence: { ...DEFAULT_CADENCE },
      scan,
      extractors
    },
    confidence,
    tuned: false
  }
}
