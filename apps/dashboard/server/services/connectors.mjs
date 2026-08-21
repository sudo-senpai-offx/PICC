// Connector registry — every income source exposes one interface and emits the
// same normalized Earnings shape, regardless of which transport produced it:
//   1. api      — the provider's official API (yfinance, Stripe, Aave, ...)
//   2. ws       — a reverse-engineered protocol client (expertoption.mjs)
//   3. browser  — the browser bridge (real Chrome/Edge via CDP): login once,
//                 then read the live dashboard DOM + the page's own WebSocket
//                 frames. This is the universal path for sources with no API.
//
// PICC never executes on external platforms: connectors only read/aggregate,
// and every suggestion still flows through the human-review gate.
import { mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { openBridge, browserAvailable } from "./browserBridge.mjs"

/**
 * Coerce loose text into a number ("$1,234.56", "1 234,5", "1.2k") or null.
 */
export function parseAmount(text) {
  if (text == null) return null
  const s = String(text).trim()
  if (!s) return null
  const m = s.match(/[-+]?[\d.,\s]+\d/)
  if (!m) return null
  const cleaned = m[0].replace(/\s/g, "").replace(/,([0-9]{3})(?=[^0-9]|$)/g, "$1").replace(",", ".")
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  const k = /[kmb]/i.test(s) ? s.match(/[kmb]/i)[0].toLowerCase() : ""
  const mult = k === "k" ? 1e3 : k === "m" ? 1e6 : k === "b" ? 1e9 : 1
  return n * mult
}

/**
 * The single normalized snapshot every connector produces.
 * @param {object} r
 * @param {string} r.provider     connector slug
 * @param {string} r.platform     display name
 * @param {number|null} r.balance current withdrawable balance
 * @param {number|null} r.today   today's earnings
 * @param {number|null} r.lifetime lifetime earnings
 * @param {number|null} r.payoutThreshold
 * @param {number|null} r.estimatedDaily
 * @param {string} [r.currency]
 * @param {string} [r.source]     'api' | 'ws' | 'browser' | 'manual'
 * @param {string} [r.status]     'ok' | 'error'
 * @param {string|null} [r.error]
 * @param {object} [r.extra]      transport-specific metrics (e.g. ws frames)
 */
export function normalizeEarnings(r = {}) {
  return {
    provider: r.provider ?? "",
    platform: r.platform ?? r.provider ?? "",
    balance: r.balance ?? null,
    today: r.today ?? null,
    lifetime: r.lifetime ?? null,
    payoutThreshold: r.payoutThreshold ?? null,
    estimatedDaily: r.estimatedDaily ?? null,
    currency: r.currency ?? "USD",
    source: r.source ?? "manual",
    status: r.status ?? (r.error ? "error" : "ok"),
    error: r.error ?? null,
    lastChecked: Date.now(),
    extra: r.extra ?? {}
  }
}

const registry = new Map()

/**
 * @param {object} def
 * @param {string} def.slug
 * @param {string} def.label
 * @param {string} def.category   treasury | trading | bandwidth | depin | nft | defi | ...
 * @param {string[]} def.transports  ['api','ws','browser', ...]
 * @param {string} def.url        dashboard URL the browser transport navigates to
 * @param {object} [def.selectors]  DOM selectors -> { balance, today, lifetime, ... }
 * @param {object} [def.defaults]   fallback earnings values when the DOM is missing
 * @param {(opts)=>Promise<any>} [def.collect]  custom collector; overrides generic browser path
 */
export function registerConnector(def) {
  if (!def?.slug) throw new Error("connector requires a slug")
  registry.set(def.slug, {
    transport: def.transports?.[0] ?? "browser",
    tuned: false, // DOM selectors need per-site verification before trusting
    ...def
  })
}

export const getConnector = (slug) => registry.get(slug)
export const listConnectors = () => [...registry.values()]
export const hasConnector = (slug) => registry.has(slug)

/**
 * Generic browser-transport collector: opens a persistent bridge session for
 * the connector's profile, navigates to its dashboard, reads the DOM via the
 * connector's selectors, and returns a normalized Earnings snapshot.
 */
export async function browserCollect({ slug, url, selectors = {}, defaults = {}, waitMs = 9000, headless = true, onFrame } = {}) {
  if (!(await browserAvailable())) {
    return normalizeEarnings({
      provider: slug,
      platform: slug,
      source: "browser",
      status: "error",
      error: "no browser available — install Chrome/Edge or set PICC_BROWSER_PATH"
    })
  }
  const bridge = await openBridge({ profile: slug, headless })
  const frames = []
  let off = null
  if (onFrame) off = bridge.onFrame((f) => onFrame(f, frames))
  else off = bridge.onFrame((f) => frames.push(f))
  try {
    await bridge.goto(url)
    const deadline = Date.now() + waitMs
    let snapshot = { url: bridge.page?.url?.() ?? url }
    // Poll the dashboard DOM until a selector yields a value or the timeout
    // elapses — dashboards hydrate at different speeds, so a blind sleep is
    // both too slow and too fragile.
    while (Date.now() < deadline) {
      snapshot = await bridge.read({ selectors })
      if (Object.values(snapshot).some((v) => v != null && String(v).trim() !== "")) break
      await new Promise((r) => setTimeout(r, 500))
    }
    const parsed = {}
    for (const key of Object.keys(snapshot)) {
      const v = parseAmount(snapshot[key])
      if (v != null) parsed[key] = v
    }
    const fallback = (key) => (defaults[key] != null ? parseAmount(defaults[key]) : null)
    // Only earnings-shaped keys count — url/title are metadata, not values
    // (and a URL with a port number must not look like a balance).
    const parsedValues = Object.keys(parsed).filter((k) => k !== "url" && k !== "title")
    const noValues = parsedValues.length === 0 && ["balance", "today", "lifetime", "payoutThreshold", "estimatedDaily"].every((k) => fallback(k) == null)
    const result = normalizeEarnings({
      provider: slug,
      platform: defaults.label ?? slug,
      source: "browser",
      status: noValues ? "error" : "ok",
      // Honest when the dashboard yielded nothing readable: selectors are
      // "tuned:false" for a reason, and a null row is a failed scrape, not a
      // zero balance.
      error: noValues
        ? "dashboard yielded no readable values — selectors may need tuning"
        : null,
      balance: parsed.balance ?? parsed.floor ?? parsed.available ?? fallback("balance"),
      today: parsed.today ?? parsed.daily ?? fallback("today"),
      lifetime: parsed.lifetime ?? fallback("lifetime"),
      payoutThreshold: parsed.payoutThreshold ?? fallback("payoutThreshold"),
      estimatedDaily: parsed.estimatedDaily ?? fallback("estimatedDaily"),
      extra: {
        url: snapshot?.url,
        title: snapshot?.title,
        raw: snapshot,
        frames: frames.slice(-20),
        metrics: parsed
      }
    })
    result.bridge = bridge
    return result
  } catch (err) {
    await bridge.close().catch(() => {})
    return normalizeEarnings({
      provider: slug,
      platform: defaults.label ?? slug,
      source: "browser",
      status: "error",
      error: err.message,
      extra: { frames: frames.slice(-20) }
    })
  }
}

/**
 * Route a collection to a connector's best transport.
 * @param {string} slug
 * @param {object} [opts] { headless, waitMs, ws } — passed through to the transport
 */
export async function collectSource(slug, opts = {}) {
  const conn = getConnector(slug)
  if (!conn) throw new Error(`unknown connector "${slug}"`)
  if (conn.collect) return conn.collect(opts)
  return browserCollect({
    slug,
    url: opts.url ?? conn.url,
    selectors: opts.selectors ?? conn.selectors,
    defaults: conn.defaults,
    waitMs: opts.waitMs,
    headless: opts.headless ?? true
  })
}

// ---------------------------------------------------------------------------
// Snapshot persistence — every successful collection (manual or live) is
// appended to a JSON time-series so the dashboard can chart balances/history
// over time. Fully self-hosted, no database required.
// ---------------------------------------------------------------------------

function connectorDataDir() {
  return process.env.PICC_CONNECTOR_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJson(file, data) {
  try {
    await writeFile(file, JSON.stringify(data, null, 2), "utf8")
    return true
  } catch (err) {
    // ENOENT happens when the data dir was created after import time (tests,
    // or a fresh machine where the parent was never made). Ensure it exists
    // and retry once instead of silently dropping the write.
    if (err && err.code === "ENOENT") {
      try {
        mkdirSync(dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify(data, null, 2), "utf8")
        return true
      } catch (retryErr) {
        console.warn(`[picc-connectors] store write failed ${file}:`, retryErr.message)
        return false
      }
    }
    console.warn(`[picc-connectors] store write failed ${file}:`, err.message)
    return false
  }
}

const MAX_HISTORY = 5000

/**
 * Append a normalized snapshot to the per-provider time-series and refresh the
 * "latest" map. The heavy `extra` payload (raw DOM, ws frames) is trimmed so
 * the history stays small; the bridge handle is never persisted.
 */
export async function persistSnapshot(snapshot) {
  if (!snapshot?.provider) return null
  const entry = {
    ...snapshot,
    extra: {
      url: snapshot.extra?.url,
      title: snapshot.extra?.title
    }
  }
  delete entry.bridge
  const dir = connectorDataDir()
  mkdirSync(dir, { recursive: true })
  const historyFile = join(dir, "connector_history.json")
  const latestFile = join(dir, "connector_latest.json")
  const history = await readJson(historyFile, [])
  history.push(entry)
  const trimmed = history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history
  await writeJson(historyFile, trimmed)
  const latest = await readJson(latestFile, {})
  latest[entry.provider] = entry
  await writeJson(latestFile, latest)
  return entry
}

export async function getLatestSnapshots() {
  return readJson(join(connectorDataDir(), "connector_latest.json"), {})
}

export async function getHistory(provider, limit = 100) {
  const history = await readJson(join(connectorDataDir(), "connector_history.json"), [])
  const rows = history.filter((h) => h.provider === provider)
  const n = Math.max(1, Math.min(Number(limit) || 100, 2000))
  return rows.slice(-n)
}

// ---------------------------------------------------------------------------
// Live streaming — a persistent bridge session per connector that pushes the
// page's own WebSocket frames + a fresh DOM snapshot to subscribers in real
// time (SSE). The session closes when the last subscriber disconnects.
// ---------------------------------------------------------------------------

const liveSessions = new Map()

async function tickLive(state, opts, conn) {
  if (state.closed) return
  try {
    const snapshot = await state.bridge.read({ selectors: opts.selectors ?? conn.selectors })
    const hasValue = Object.values(snapshot).some((v) => v != null && String(v).trim() !== "")
    if (hasValue || state.latest) {
      const result = normalizeEarnings({
        provider: state.slug,
        platform: conn.label,
        source: "browser",
        balance: parseAmount(snapshot.balance),
        today: parseAmount(snapshot.today),
        lifetime: parseAmount(snapshot.lifetime),
        payoutThreshold: parseAmount(snapshot.payoutThreshold),
        estimatedDaily: parseAmount(snapshot.estimatedDaily),
        extra: { url: snapshot.url, title: snapshot.title, frames: state.frames.slice(-20) }
      })
      state.latest = result
      const sig = JSON.stringify([result.balance, result.today, result.lifetime, result.payoutThreshold, result.status])
      if (sig !== state.lastSig) {
        state.lastSig = sig
        await persistSnapshot(result)
      }
      for (const cb of state.subscribers) {
        try {
          cb({ type: "snapshot", snapshot: result })
        } catch {
          /* subscriber errors never break the session */
        }
      }
    }
  } catch (err) {
    for (const cb of state.subscribers) {
      try {
        cb({ type: "error", error: err.message })
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Open (or reuse) a persistent live session for a connector. The bridge stays
 * open and navigated; a 5s DOM poll emits snapshots and the page's own
 * WebSocket frames are forwarded to subscribers.
 */
export async function openLiveSession(slug, opts = {}) {
  if (liveSessions.has(slug)) return liveSessions.get(slug)
  const conn = getConnector(slug)
  if (!conn) throw new Error(`unknown connector "${slug}"`)
  if (!(await browserAvailable())) {
    const err = new Error("no browser available — install Chrome/Edge or set PICC_BROWSER_PATH")
    err.code = "NO_BROWSER"
    throw err
  }
  const bridge = await openBridge({ profile: slug, headless: opts.headless ?? true })
  const state = {
    slug,
    bridge,
    frames: [],
    subscribers: new Set(),
    latest: null,
    lastSig: null,
    closed: false,
    timer: null,
    off: null
  }
  // Register before navigation so an early failure can still be cleaned up.
  liveSessions.set(slug, state)
  try {
    state.off = bridge.onFrame((f) => {
      state.frames.push(f)
      if (state.frames.length > 300) state.frames.shift()
      for (const cb of state.subscribers) {
        try {
          cb({ type: "frame", frame: f })
        } catch {
          /* ignore */
        }
      }
    })
    await bridge.goto(opts.url ?? conn.url)
    state.timer = setInterval(() => tickLive(state, opts, conn).catch(() => {}), 5000)
    await tickLive(state, opts, conn)
    return state
  } catch (err) {
    await closeLiveSession(slug)
    throw err
  }
}

export function getLiveSession(slug) {
  return liveSessions.get(slug) ?? null
}

export function liveSubscriberCount(slug) {
  return liveSessions.get(slug)?.subscribers.size ?? 0
}

export function liveSessionSlugs() {
  return [...liveSessions.keys()]
}

export function subscribeLive(slug, cb) {
  const s = liveSessions.get(slug)
  if (!s) throw new Error(`no live session for "${slug}"`)
  s.subscribers.add(cb)
  return () => s.subscribers.delete(cb)
}

export async function closeLiveSession(slug) {
  const s = liveSessions.get(slug)
  if (!s) return
  liveSessions.delete(slug)
  s.closed = true
  if (s.timer) clearInterval(s.timer)
  if (s.off) s.off()
  for (const cb of s.subscribers) {
    try {
      cb({ type: "closed" })
    } catch {
      /* ignore */
    }
  }
  s.subscribers.clear()
  await s.bridge.close().catch(() => {})
}

export async function closeAllLiveSessions() {
  for (const slug of [...liveSessions.keys()]) await closeLiveSession(slug)
}

// ---------------------------------------------------------------------------
// Built-in connectors
// ---------------------------------------------------------------------------

// ExpertOption — the primary read path is the WS client (expertoption.mjs);
// the browser transport is the fallback when a token isn't available, reading
// the same numbers straight off the dashboard DOM.
registerConnector({
  slug: "expertoption",
  label: "ExpertOption",
  category: "trading",
  transports: ["ws", "browser"],
  url: "https://app.expertoption.finance/",
  defaults: { label: "ExpertOption" },
  selectors: {
    balance: "input[placeholder*='balance'], [class*='balance']",
    today: "[class*='today-profit'], [class*='profit-today'], [class*='daily']",
    lifetime: "[class*='total-profit'], [class*='total-earned']"
  }
})

// Bandwidth / DePIN sources with no public API — read their own dashboards.
const BANDWIDTH = [
  ["honeygain", "Honeygain", "https://dashboard.honeygain.com/"],
  ["earnapp", "EarnApp", "https://earnapp.com/dashboard"],
  ["pawns", "Pawns.app", "https://app.pawns.app/"],
  ["repocket", "Repocket", "https://app.repocket.com/"],
  ["grass", "Grass", "https://app.getgrass.io/"],
  ["gradient", "Gradient", "https://app.gradient.network/"],
  ["silencio", "Silencio", "https://silencio.network/"]
]
for (const [slug, label, url] of BANDWIDTH) {
  registerConnector({
    slug,
    label,
    category: "bandwidth",
    transports: ["browser"],
    url,
    defaults: { label },
    selectors: {
      balance: "[class*='balance'], [class*='credits'], [class*='earnings']",
      today: "[class*='today'], [class*='daily']",
      lifetime: "[class*='total'], [class*='lifetime']",
      payoutThreshold: "[class*='minimum'], [class*='threshold']"
    }
  })
}

// NFT marketplaces — floor price / volume from the collection page. Tuned
// against the live OpenSea homepage (2026): OpenSea's class names are hashed
// utility classes, so we match by label text via the `text:` selector.
registerConnector({
  slug: "opensea",
  label: "OpenSea",
  category: "nft",
  transports: ["browser"],
  url: "https://opensea.io/",
  tuned: true,
  defaults: { label: "OpenSea" },
  selectors: {
    floor: "text:Floor price",
    volume: "text:Total volume"
  }
})

// DeFi dashboards — APY / positions from the user's own portfolio page.
registerConnector({
  slug: "aave",
  label: "Aave",
  category: "defi",
  transports: ["browser"],
  url: "https://app.aave.com/",
  defaults: { label: "Aave" },
  selectors: {
    balance: "[class*='balance'], [class*='supply']",
    today: "[class*='apy'], [class*='APY']"
  }
})

registerConnector({
  slug: "yearn",
  label: "Yearn",
  category: "defi",
  transports: ["browser"],
  url: "https://yearn.fi/",
  defaults: { label: "Yearn" },
  selectors: {
    balance: "[class*='balance'], [class*='token']",
    today: "[class*='apy'], [class*='APY']"
  }
})

// DeFi lending / markets referenced by the extension overlay but missing from
// the registry — registered so the browser transport can read them directly.
registerConnector({
  slug: "compound",
  label: "Compound",
  category: "defi",
  transports: ["browser"],
  url: "https://app.compound.finance/",
  defaults: { label: "Compound" },
  selectors: {
    balance: "[class*='balance'], [class*='supply']",
    today: "[class*='apy'], [class*='APY']"
  }
})

// NFT marketplaces — floor price / volume via `text:` label matching (hashed
// utility classes). Magic Eden referenced by the extension; OpenSea above.
registerConnector({
  slug: "magiceden",
  label: "Magic Eden",
  category: "nft",
  transports: ["browser"],
  url: "https://magiceden.io/",
  defaults: { label: "Magic Eden" },
  selectors: {
    floor: "text:Floor price",
    volume: "text:Volume"
  }
})

// Crypto staking & restaking dashboards — verified keyless monitor surfaces
// (Lido stake.lido.fi, Jito jito.network/staking, EigenLayer app). Selectors
// are untested: `tuned:false` keeps the UI honest until per-site verification.
registerConnector({
  slug: "lido",
  label: "Lido (stETH)",
  category: "staking",
  transports: ["browser"],
  url: "https://stake.lido.fi/",
  defaults: { label: "Lido" },
  selectors: {
    balance: "[class*='balance'], [class*='staked']",
    today: "[class*='apy'], [class*='apr'], [class*='reward']"
  }
})

registerConnector({
  slug: "jito",
  label: "Jito (JitoSOL)",
  category: "staking",
  transports: ["browser"],
  url: "https://www.jito.network/staking/",
  defaults: { label: "Jito" },
  selectors: {
    balance: "[class*='balance'], [class*='staked']",
    today: "[class*='apy'], [class*='yield']"
  }
})

registerConnector({
  slug: "eigenlayer",
  label: "EigenLayer",
  category: "staking",
  transports: ["browser"],
  url: "https://app.eigenlayer.xyz/",
  defaults: { label: "EigenLayer" },
  selectors: {
    balance: "[class*='balance'], [class*='restaked']",
    today: "[class*='apy'], [class*='reward']"
  }
})

registerConnector({
  slug: "pendle",
  label: "Pendle",
  category: "defi",
  transports: ["browser"],
  url: "https://app.pendle.finance/trade/markets",
  defaults: { label: "Pendle" },
  selectors: {
    balance: "[class*='balance'], [class*='position']",
    today: "[class*='apy'], [class*='fixed']"
  }
})

// DePIN dashboards — verified monitor URLs, no public earner API.
registerConnector({
  slug: "mysterium",
  label: "Mysterium",
  category: "depin",
  transports: ["browser"],
  url: "https://mystnodes.com/",
  defaults: { label: "Mysterium" },
  selectors: {
    balance: "[class*='balance'], [class*='earning']",
    today: "[class*='today'], [class*='daily']"
  }
})

// Storage node local dashboard (Docker node on the same machine).
registerConnector({
  slug: "storj",
  label: "Storj Node",
  category: "storage",
  transports: ["browser"],
  url: "http://127.0.0.1:14002/",
  defaults: { label: "Storj" },
  selectors: {
    balance: "[class*='earned'], [class*='payout']",
    today: "[class*='bandwidth'], [class*='current']"
  }
})

// DePIN reference dashboards — public explorer / aggregator, not per-user.
registerConnector({
  slug: "rustchain",
  label: "RustChain",
  category: "environmental",
  transports: ["browser"],
  url: "https://rustchain.org/explorer/",
  defaults: { label: "RustChain" },
  selectors: {
    balance: "[class*='miner'], [class*='reward']",
    today: "[class*='epoch'], [class*='block']"
  }
})

registerConnector({
  slug: "defillama",
  label: "DeFiLlama",
  category: "defi",
  transports: ["browser"],
  url: "https://defillama.com/",
  defaults: { label: "DeFiLlama" },
  selectors: {
    balance: "[class*='apy'], [class*='tvl']",
    today: "[class*='yield'], [class*='pool']"
  }
})
