/**
 * Live ExpertOption realtime layer.
 *
 * Data source: the ExpertOption platform's own WebSocket connection, which the
 * in-app browser holds while `app.expertoption.com` is open. The v45 gateway
 * streams live candle pushes ONLY to that browser connection — headless sockets
 * get history/balance/assets but never live ticks. So this layer:
 *
 *   • reads the app's WS frames (via the studio bridge) for true realtime on
 *     the asset currently open in the app (tf:0 ticks + tf:5 bars);
 *   • aggregates tf:5 bars locally into 1m / 5m / 15m / 1h;
 *   • runs a headless read-only session for balance, the asset list, and
 *     multi-timeframe history re-seeding (~20s) so the whole watch set stays
 *     fresh even for assets the app is not viewing.
 *
 * Token freshness: when the app tab is open on app.expertoption.com the session
 * token is re-captured from that live tab, so data always reflects the account
 * the user is signed into (demo by default; live once enabled + approved).
 *
 * Lifecycle: starts on first subscriber, closes itself after a period of
 * inactivity. Degrades gracefully — history/board still works if the browser
 * is closed, only the tick-level view goes stale.
 */
import { connectSession, assetsFrom, balanceFrom, accountFrom, mergeBalanceIntoAccount } from "./expertoption.mjs"
import { getCredentials } from "./trading.mjs"
import { STATIC_ASSETS } from "./expertoption.mjs"
import { createLogger } from "../logger.mjs"
import { assetsEquivalent } from "./assetCatalog.mjs"

const log = createLogger("picc-live")
const AUTH_FAIL_RE = /(unauthorized|auth_failed|authfail|token_expired|tokenexpire|forbidden|rejected the session token|session token rejected)/i

const BASE_PERIOD = 60 // board display / sparkline timeframe (seconds)
const WATCH_PERIODS = [60, 300, 900, 3600] // 1m, 5m, 15m, 1h
const LIVE_BAR_PERIOD = 5 // the app's live bar timeframe (seconds)
// Multi-class watch coverage: forex, crypto, metals, energies, indices and
// equities — so active-asset detection works across every instrument class.
const WATCH_DEFAULT = [
  "EURUSD", "GBPUSD", "USDJPY",
  "BTCUSD", "ETHUSD",
  "GOLD", "SILVER", "PLATINUM", "BRENT",
  "US30", "GER40", "SPX500",
  "AAPL", "TSLA"
]
const HISTORY_COUNT = 240
const BUFFER_CAP = 400
const IDLE_CLOSE_MS = 30_000
const TICK_THROTTLE_MS = 350
const RESEED_INTERVAL_MS = 20_000

let session = null // headless read-only session (balance / assets / history)
let studioOff = null // bridge frame subscription
let reseedTimer = null
let starting = null
let generation = 0 // bumped on every start/stop; in-flight starts check it to self-cancel
let startedAt = 0
let idleTimer = null
let lastError = null
let currentMode = "demo"
let account = null
let viewedAssetId = null
let lastSeen = 0 // last time any frame was consumed
let degraded = null // { kind: "expired"|"unconfigured", reason, at } — sticky until a session connects again
let staleFlag = false // "connected but no ticks for >60s" (set by the scheduler staleness job)

const subscribers = new Set()
const buffers = new Map() // `${assetId}:${period}` -> { ohlc, prevClose, tickedAt }
const lastTick = new Map() // `${assetId}:${period}` -> { price, change, changePct, ts }
const assetTicks = new Map() // assetId -> { count, up, down, lastPrice, perBar: Map<barTs,{up,down}> }
const byId = new Map() // assetId -> asset
const watching = [] // { id, name, type }

function emit(type, payload) {
  const msg = { type, ts: Date.now(), ...payload }
  for (const cb of subscribers) {
    try {
      cb(msg)
    } catch {
      /* subscriber errors never break the stream */
    }
  }
}

function modeLabel(demo) {
  return demo ? "demo" : "live"
}

function currentStatus() {
  if (session) {
    // Truthfulness check: a non-null session whose transport died (reconnects
    // exhausted, socket closed) must never report "connected".
    try {
      if (session.connected === false) return "stale"
    } catch { /* getter unavailable — assume legacy */ }
    return "connected"
  }
  // No headless session, but the user's own browser is streaming broker
  // frames through the extension bridge — that IS a live feed.
  if (!degraded && upstreamStats.lastAt && Date.now() - upstreamStats.lastAt < 60_000) return "connected"
  if (degraded) return degraded.kind
  if (starting) return "connecting"
  return "idle"
}

/** True when a message/close reason looks like an auth rejection by the gateway. */
function isAuthRejection(text) {
  return AUTH_FAIL_RE.test(String(text ?? ""))
}

/**
 * Mark the session as expired/unconfigured: sticky state that survives until a
 * fresh token connects, an honest status event for the UI, and a warning log.
 */
function markAuthRejected(reason) {
  const kind = /no expertoption session/i.test(String(reason)) ? "unconfigured" : "expired"
  degraded = { kind, reason: String(reason).slice(0, 300), at: Date.now() }
  emit("status", { status: kind, mode: currentMode, error: degraded.reason })
  log.warn(`ExpertOption session ${kind}`, { reason: degraded.reason })
  if (kind === "expired") {
    import("./notificationCenter.mjs")
      .then((m) => m.emitEvent("connector.expired", { connector: "expertoption", reason: degraded.reason, at: new Date(degraded.at).toISOString() }))
      .catch(() => {})
  }
}

/** Scheduler hook: flip the "connected but stale" warning flag. */
export function setLiveEOStale(v) {
  staleFlag = Boolean(v)
}

function bufferKey(assetId, period) {
  return `${assetId}:${period}`
}

/** Tick-activity volume proxy for an asset (honest label: tick activity, not real volume). */
function tickState(assetId) {
  if (!assetTicks.has(assetId)) {
    assetTicks.set(assetId, { count: 0, up: 0, down: 0, lastPrice: null, perBar: new Map() })
  }
  return assetTicks.get(assetId)
}

function recordTick(assetId, price, ts) {
  const st = tickState(assetId)
  st.count += 1
  const bar = Math.floor((ts || Date.now() / 1000) / LIVE_BAR_PERIOD) * LIVE_BAR_PERIOD
  if (!st.perBar.has(bar)) st.perBar.set(bar, { t: bar, up: 0, down: 0 })
  if (st.lastPrice != null) {
    if (price > st.lastPrice) {
      st.up += 1
      st.perBar.get(bar).up += 1
    } else if (price < st.lastPrice) {
      st.down += 1
      st.perBar.get(bar).down += 1
    }
  }
  st.lastPrice = price
  if (st.perBar.size > 240) {
    const oldest = [...st.perBar.keys()].sort((a, b) => a - b)[0]
    st.perBar.delete(oldest)
  }
}

/** Per-bar tick profile (last up to `bars` 5s buckets), oldest first. */
function tickProfile(assetId, bars = 24) {
  const st = assetTicks.get(assetId)
  if (!st) return []
  return [...st.perBar.values()].sort((a, b) => a.t - b.t).slice(-bars)
}

function ensureBuffer(assetId, period) {
  const key = bufferKey(assetId, period)
  if (!buffers.has(key)) buffers.set(key, { ohlc: [], prevClose: 0, tickedAt: 0 })
  return buffers.get(key)
}

/** Seed a buffer from a history response, re-applying any newer live bar. */
function reseedBuffer(assetId, period, ohlc) {
  const pbuf = ensureBuffer(assetId, period)
  if (Array.isArray(ohlc) && ohlc.length) {
    // Defensive sort: mergeLiveCandle/cascadeBar assume ascending time. If the
    // wire ever delivers a different order, honor it instead of silently
    // discarding every subsequent live bar.
    const sorted = [...ohlc].sort((a, b) => Number(a.time) - Number(b.time))
    pbuf.ohlc = sorted.slice(-BUFFER_CAP)
    pbuf.prevClose = pbuf.ohlc.at(-2)?.close ?? pbuf.ohlc.at(-1)?.close ?? 0
  }
  // Re-apply the in-progress bar captured from the app stream, if newer.
  const live5 = buffers.get(bufferKey(assetId, LIVE_BAR_PERIOD))?.ohlc?.at(-1)
  if (live5 && live5.time > (pbuf.ohlc.at(-1)?.time ?? 0) && period !== LIVE_BAR_PERIOD) {
    const bucket = Math.floor(live5.time / period) * period
    if (bucket >= (pbuf.ohlc.at(-1)?.time ?? 0)) {
      cascadeBar(pbuf, bucket, live5.open, live5.high, live5.low, live5.close)
    }
  }
  return pbuf
}

/** Merge one live candle into the buffer; returns the previous close. */
export function mergeLiveCandle(buf, candle) {
  const last = buf.ohlc.at(-1)
  const prevClose = buf.prevClose || last?.close || 0
  if (last && candle.time === last.time) {
    buf.ohlc[buf.ohlc.length - 1] = candle
  } else if (!last || candle.time > last.time) {
    buf.ohlc.push(candle)
    if (buf.ohlc.length > BUFFER_CAP) buf.ohlc.shift()
    buf.prevClose = last?.close ?? prevClose
  }
  return prevClose
}

/**
 * Fold an OHLC update into the aggregate bar for a bucket. First update of a
 * new bucket opens a bar; later updates refresh the same (current) bar live.
 */
export function cascadeBar(pbuf, bucket, o, h, l, cl) {
  const last = pbuf.ohlc.at(-1)
  if (!last || last.time < bucket) {
    pbuf.ohlc.push({ time: bucket, open: o, high: h, low: l, close: cl })
    pbuf.prevClose = last?.close ?? pbuf.prevClose ?? 0
    if (!pbuf.prevClose) pbuf.prevClose = o
    if (pbuf.ohlc.length > BUFFER_CAP) pbuf.ohlc.shift()
  } else if (last.time === bucket) {
    last.high = Math.max(last.high, h)
    last.low = Math.min(last.low, l)
    last.close = cl
  }
}

function emitThrottled(assetId, period, price, prevClose, force = false) {
  const key = bufferKey(assetId, period)
  const buf = buffers.get(key)
  if (!buf) return
  const now = Date.now()
  if (!force && now - buf.tickedAt < TICK_THROTTLE_MS) return
  buf.tickedAt = now
  if (!prevClose && price) prevClose = price
  const change = price - prevClose
  const changePct = prevClose ? (change / prevClose) * 100 : 0
  lastTick.set(key, { price, change, changePct, ts: now })
  emit("tick", {
    assetId,
    name: assetName(assetId),
    price,
    change,
    changePct,
    period,
    ts: now
  })
}

function assetName(assetId) {
  const a = byId.get(assetId) ?? watching.find((w) => w.id === assetId)
  return a ? displayName(a.name, a.name) : assetId
}

function applyLiveBar(assetId, t5, o, h, l, cl) {
  const buf = ensureBuffer(assetId, LIVE_BAR_PERIOD)
  const prevClose = mergeLiveCandle(buf, { time: t5, open: o, high: h, low: l, close: cl })
  emitThrottled(assetId, LIVE_BAR_PERIOD, cl, prevClose)
  for (const period of WATCH_PERIODS) {
    const pbuf = ensureBuffer(assetId, period)
    const bucket = Math.floor(t5 / period) * period
    cascadeBar(pbuf, bucket, o, h, l, cl)
    const last = pbuf.ohlc.at(-1)
    emitThrottled(assetId, period, last?.close ?? cl, pbuf.prevClose)
  }
}

// ---------------------------------------------------------------------
// App-stream consumption (the realtime source)
// ---------------------------------------------------------------------
function parseFrame(f) {
  if (f.dir !== "recv") return null
  const t = Buffer.isBuffer(f.payload) ? f.payload.toString("utf8") : String(f.payload ?? "")
  if (!t) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

function handleAppFrame(f) {
  const obj = parseFrame(f)
  if (!obj) return
  processAppObject(obj, "studio")
}

/**
 * Core frame processor — shared by the studio bridge (WS frames relayed from
 * the PICC-managed browser) and the extension bridge (frames sniffed in the
 * user's own browser via inject.js). Both feed identical candle buffers, so
 * whichever is live becomes the realtime source.
 */
function processAppObject(obj, source = "studio") {
  lastSeen = Date.now()
  if (source === "extension") {
    upstreamStats.framesSeen += 1
    upstreamStats.lastAt = Date.now()
  }
  if (obj.action === "error") {
    // Error frames relayed through the extension reflect the USER'S BROWSER
    // session, not our headless session — closing the headless feed because
    // of browser-tab noise would be wrong. Studio frames (our own socket)
    // remain authoritative for auth rejections.
    if (source === "extension") return
    const text = JSON.stringify(obj.message ?? obj)
    if (isAuthRejection(text)) {
      const reason = String(obj.message?.message ?? obj.message?.error ?? "gateway rejected the session token")
      if (session) {
        try { session.close() } catch { /* ignore */ }
        session = null
        clearTimeout(reseedTimer)
        reseedTimer = null
      }
      markAuthRejected(reason)
    }
    return
  }
  if (obj.action === "candles") {
    const assetId = String(obj.message?.assetId ?? "")
    const rows = Array.isArray(obj.message?.candles) ? obj.message.candles : []
    if (!assetId) return
    // Headless not up yet? Track the asset from the frame itself instead of
    // discarding the realtime push — the next reseed will reconcile it.
    if (!byId.has(assetId) && !watching.some((w) => w.id === assetId)) {
      const stub = { id: assetId, name: obj.message?.name || assetId, type: "", currency: "", visible: true }
      byId.set(assetId, stub)
      watching.push(stub)
    }
    viewedAssetId = assetId
    seedViewed(assetId)
    for (const c of rows) {
      if (!c || !Array.isArray(c.v)) continue
      const tf = Number(c.tf ?? 0)
      if (tf === 0 && c.v.length === 1) {
        const price = Number(c.v[0])
        // A malformed scrape (locale decimal comma, a loading-state
        // placeholder, a selector that missed) must never be treated as a
        // real tick — it would silently poison recordTick's lastPrice
        // comparison for every tick that follows, not just this one.
        if (!Number.isFinite(price) || price <= 0) continue
        const ts = Date.now()
        recordTick(assetId, price, ts / 1000)
        const key = bufferKey(assetId, "tick")
        lastTick.set(key, { price, change: 0, changePct: 0, ts })
        emit("tick", {
          assetId,
          name: assetName(assetId),
          price,
          change: 0,
          changePct: 0,
          period: 0,
          ts
        })
        continue
      }
      if (tf === LIVE_BAR_PERIOD && c.v.length >= 4) {
        const [o, h, l, cl] = c.v.map(Number)
        if (Number.isFinite(cl) && cl > 0 && [o, h, l].every((n) => Number.isFinite(n) && n > 0)) {
          recordTick(assetId, cl, Number(c.t) || Date.now() / 1000)
          applyLiveBar(assetId, Number(c.t) || 0, o, h, l, cl)
        }
      }
    }
    return
  }
  if (obj.action === "profile") {
    const acc = accountFrom({ profile: obj.message?.profile ?? obj.message })
    if (acc && acc.balance != null) {
      account = acc
      emit("account", { account: acc, mode: modeLabel(acc.demo) })
    }
  }
}

const upstreamStats = { framesSeen: 0, accepted: 0, lastAt: 0 }

/**
 * Ingest a broker frame captured by the browser extension in the user's own
 * session. Accepts an already-parsed frame object (the JSON the gateway sent).
 * Returns true when the frame was recognized and processed.
 */
export function ingestAppFrame(obj) {
  try {
    if (!obj || typeof obj !== "object" || typeof obj.action !== "string" || !obj.action) return false
    if (obj.message != null && typeof obj.message !== "object") return false
    processAppObject(obj, "extension")
    upstreamStats.accepted += 1
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------
// Headless session: balance / assets / history seeding
// ---------------------------------------------------------------------
/** Normalize a platform asset name for loose matching: strip spaces, slashes,
 * dots, "OTC", ampersands; lowercase. "EUR / USD" -> "eurusd". */
export function normName(name = "") {
  if (name == null) return ""
  return String(name)
    .toLowerCase()
    .replace(/\(otc\)/g, "")
    .replace(/[\s/&.,-]+/g, "")
    .trim()
}

/** Display name: "EUR / USD" -> "EUR/USD", keeps OTC suffix. */
function displayName(name = "", symbol = "") {
  const n = String(name).replace(/\s*\/\s*/g, "/")
  return n && n !== String(symbol) ? n : symbol
}

function resolveWatchSet(assets) {
  const resolved = []
  for (const symbol of WATCH_DEFAULT) {
    const key = symbol.toLowerCase().replace(/[\s/&.,-]+/g, "")
    // S&P 500 ETF stands in for the US 500 index.
    const matches = assets.filter((a) => {
      const n = normName(a.name)
      return n && (n === key || n.includes(key) || (key === "us500" && n.includes("sp500")))
    })
    // Alias-aware fallback: broker labels like "Gold"/"XAU/USD"/"Wall Street"
    // must still resolve even when spelled nothing like the canonical key.
    if (!matches.length) {
      const aliased = assets.filter((a) => assetsEquivalent(a.name, symbol))
      matches.push(...aliased)
    }
    let found = matches.find((a) => a.visible !== false) ?? matches[0] ?? null
    let id = found ? String(found.id) : null
    if (!id && STATIC_ASSETS[symbol] != null) {
      id = String(STATIC_ASSETS[symbol])
      found = { id, name: symbol, type: "", currency: "", visible: true }
    }
    if (!id) continue
    if (resolved.some((w) => w.id === id)) continue
    resolved.push(found ?? { id, name: symbol, type: "", currency: "", visible: true })
  }
  return resolved
}

async function seedAll(assetIds = watching.map((w) => w.id)) {
  if (!session) return
  for (const id of assetIds) {
    for (const period of WATCH_PERIODS) {
      try {
        const hist = await session.candles(id, period, HISTORY_COUNT)
        if (hist?.ohlc?.length) {
          reseedBuffer(id, period, hist.ohlc)
          lastSeen = Date.now()
        }
      } catch {
        /* one failed seed never blocks the loop */
      }
      // Smooth the burst: N assets × 4 timeframes back-to-back is exactly the
      // pattern that looks abusive regardless of intent — space requests out.
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  emit("status", { status: "connected", mode: currentMode, account })
}

const viewedSeeding = new Set()
function seedViewed(assetId) {
  if (!session || watching.some((w) => w.id === assetId)) return
  if (viewedSeeding.has(assetId)) return
  viewedSeeding.add(assetId)
  seedAll([assetId]).finally(() => viewedSeeding.delete(assetId))
}

async function refreshHeadless() {
  if (!session) return
  const [balRes, assetsRes] = await Promise.allSettled([session.balance(), session.assets()])
  // balance() is the active-wallet view — fold it back into the full dual-wallet
  // model so status/snapshot/suite events always carry demoWallet + realWallet.
  if (balRes.status === "fulfilled") account = mergeBalanceIntoAccount(account, balRes.value)
  if (assetsRes.status === "fulfilled") {
    const assets = assetsFrom(assetsRes.value)
    // MERGE, don't clobber: extension/studio frames register stub entries for
    // assets the user is viewing that may not exist in this broker asset list
    // (e.g. OTC variants). Wiping them every 20s made the viewed asset
    // intermittently vanish from the decision feed.
    const watchingSnapshot = [...watching]
    byId.clear()
    for (const a of assets) byId.set(String(a.id), a)
    const freshIds = new Set(assets.map((a) => String(a.id)))
    for (const prev of watchingSnapshot) {
      if (!freshIds.has(String(prev.id))) {
        // Preserve unseen-but-tracked entries only while they have live data.
        const hasData = buffers.get(bufferKey(prev.id, LIVE_BAR_PERIOD))?.ohlc?.length
        if (!hasData && String(prev.id) !== String(viewedAssetId)) continue
        if (!byId.has(String(prev.id))) byId.set(String(prev.id), prev)
      }
    }
    watching.length = 0
    const resolved = resolveWatchSet([...byId.values()])
    watching.push(...resolved)
    // Preserve any OTHER previously-tracked asset that still has live buffer
    // data (the user browsed it recently) — keeps multi-asset tracking stable
    // across refreshes.
    for (const prev of watchingSnapshot) {
      if (watching.some((w) => String(w.id) === String(prev.id))) continue
      if (buffers.get(bufferKey(prev.id, LIVE_BAR_PERIOD))?.ohlc?.length) {
        if (!byId.has(String(prev.id))) byId.set(String(prev.id), prev)
        watching.push(prev)
      }
    }
    // The asset the user is actually viewing must ALWAYS stay tracked, even
    // when it is absent from both the broker list and the default watch set.
    if (viewedAssetId && !watching.some((w) => String(w.id) === String(viewedAssetId))) {
      const known = byId.get(String(viewedAssetId)) ?? { id: String(viewedAssetId), name: viewedAssetId, type: "", currency: "", visible: true }
      byId.set(String(viewedAssetId), known)
      watching.push(known)
    }
  }
  const ids = [...watching.map((w) => w.id)]
  if (viewedAssetId && !ids.includes(viewedAssetId)) ids.push(viewedAssetId)
  await seedAll(ids)
}

async function reseedLoop() {
  reseedTimer = setTimeout(async () => {
    reseedTimer = null
    // Stopped? (stopLiveEO nulls the session) — never reschedule after a stop.
    if (!session) return
    try {
      await refreshHeadless()
    } catch (err) {
      lastError = String(err?.message ?? err)
    }
    reseedLoop()
  }, RESEED_INTERVAL_MS)
}

// ---------------------------------------------------------------------
// Browser stream: the live source
// ---------------------------------------------------------------------
async function ensureBrowserStream() {
  const studio = await import("./browserStudio.mjs")
  const onEO = () => {
    try {
      const status = studio.studioStatus()
      const active = status?.tabs?.find((t) => t.id === status.activeTabId)
      return active && /app\.expertoption\.(com|finance)/i.test(active.url ?? "")
    } catch {
      return false
    }
  }
  try {
    if (!studio.studioIsOpen()) {
      // Background read-only data feed — keep it embedded (invisible). Only
      // used when the studio is closed, so it can never clash with an open
      // interactive real window.
      await studio.openStudio({ headless: true, homepage: "" })
    }
    if (!onEO()) {
      await studio.studioGoto("https://app.expertoption.finance/").catch(() => {})
    }
  } catch {
    /* browser unavailable — headless history still works */
  }
  try {
    studioOff = studio.studioOnFrame(handleAppFrame)
  } catch {
    studioOff = null
  }
  return onEO()
}

// ---------------------------------------------------------------------
// Session boot / teardown
// ---------------------------------------------------------------------
async function openLiveSession(gen) {
  const creds = await getCredentials()
  if (gen !== generation) return
  let token = creds.expertoptionToken

  const studio = await import("./browserStudio.mjs").catch(() => null)
  if (studio?.studioIsOpen?.()) {
    const cap = await studio.captureExpertOptionSession().catch(() => null)
    if (cap?.ok && cap.token) token = cap.token
  }

  if (!token) {
    throw new Error(
      "No ExpertOption session — open app.expertoption.finance in the PICC browser (or save a token in Trading Suite settings), then retry."
    )
  }

  const isDemo = creds.expertoptionDemo !== false
  currentMode = modeLabel(isDemo)
  lastError = null

  // Headless session first (reliable), then the live browser stream.
  const s = await connectSession({
    token,
    isDemo,
    wsUrl: creds.expertoptionWsUrl || undefined
  })
  if (gen !== generation) {
    try {
      s.close()
    } catch {
      /* ignore */
    }
    return
  }
  // The account may have refused the requested context (demo vs real), so use
  // whichever one the connection actually settled on rather than the requested
  // credential flag — otherwise the status card misreports the mode. The full
  // account model carries BOTH wallets (demo_balance + real_balance are always
  // advertised), so the suite can show demo and real side by side.
  const acc = await s.profile().catch(() => null)
  if (gen !== generation) {
    try {
      s.close()
    } catch {
      /* ignore */
    }
    return
  }
  const actualDemo = acc ? acc.demo : (s.isDemo ?? isDemo)
  currentMode = modeLabel(actualDemo)
  account = acc
  session = s

  // Transport give-up: after exhausting reconnect attempts the socket is dead
  // for good. Without this hook the session object stays non-null and every
  // status endpoint reports "connected" over frozen data forever.
  if (typeof s.onGiveUp === "function") {
    s.onGiveUp((reason) => {
      if (session !== s) return // a newer session owns the slot
      session = null
      lastError = String(reason?.message ?? reason ?? "transport gave up")
      emit("status", { status: "error", error: lastError })
      log.warn("ExpertOption transport gave up — scheduling soft reconnect", { error: lastError })
      setTimeout(() => {
        if (!session && subscribers.size > 0) void softReconnectLiveEO()
      }, 5_000).unref?.()
    })
  }

  const assetsRaw = await s.assets().catch(() => null)
  if (assetsRaw) {
    const assets = assetsFrom(assetsRaw)
    byId.clear()
    for (const a of assets) byId.set(String(a.id), a)
    watching.length = 0
    watching.push(...resolveWatchSet(assets))
  }

  if (gen !== generation) {
    try {
      s.close()
    } catch {
      /* ignore */
    }
    if (session === s) session = null
    return
  }
  await ensureBrowserStream()
  await seedAll().catch(() => {})
  if (gen !== generation) {
    try {
      s.close()
    } catch {
      /* ignore */
    }
    if (session === s) session = null
    return
  }

  startedAt = Date.now()
  degraded = null
  staleFlag = false
  emit("status", { status: "connected", mode: currentMode, account })
  emit("snapshot", buildSnapshot())
  reseedLoop()
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------
function buildSnapshot() {
  const assets = watching.map((w) => {
    const base = buffers.get(bufferKey(w.id, BASE_PERIOD))
    const closes = base?.ohlc?.map((c) => c.close) ?? []
    const lastClose = closes.at(-1)
    const prevClose = base?.prevClose || closes.at(-2) || lastClose || 0
    const change = lastClose != null && prevClose ? lastClose - prevClose : 0
    const changePct = prevClose ? (change / prevClose) * 100 : 0
    const tick = lastTick.get(bufferKey(w.id, "tick"))
    const periods = {}
    for (const p of WATCH_PERIODS) {
      const b = buffers.get(bufferKey(w.id, p))
      periods[p] = b?.ohlc?.at(-1)?.close ?? null
    }
    return {
      id: w.id,
      name: w.name,
      type: w.type,
      price: tick?.price ?? lastClose ?? null,
      change,
      changePct,
      spark: closes.slice(-48),
      periods
    }
  })
  return { assets, account, viewed: viewedAssetId, watching: assets.map((a) => a.name), ts: Date.now() }
}

export function liveSnapshot() {
  return {
    status: currentStatus(),
    mode: currentMode,
    startedAt,
    error: lastError,
    viewed: viewedAssetId,
    account,
    ts: Date.now()
  }
}

/**
 * Deep data accessor for downstream consumers (the adaptive-confluence
 * decision engine, the on-demand decisions endpoint). Exposes the candle
 * buffers per asset/period plus the tick-activity volume proxy.
 */
export function liveEOData() {
  const assets = watching.map((w) => {
    const periods = {}
    for (const p of WATCH_PERIODS) {
      periods[p] = buffers.get(bufferKey(w.id, p))?.ohlc ?? []
    }
    const st = assetTicks.get(w.id)
    const profile = tickProfile(w.id, 24)
    const recent = profile.slice(-12)
    const totalRecent = recent.reduce((a, b) => a + b.up + b.down, 0)
    const spanSec = recent.length ? Math.max(1, recent[recent.length - 1].t - recent[0].t) : 0
    return {
      id: w.id,
      name: w.name,
      type: w.type,
      periods,
      ticks: {
        count: st?.count ?? 0,
        up: st?.up ?? 0,
        down: st?.down ?? 0,
        delta: (st?.up ?? 0) - (st?.down ?? 0),
        ratePerMin: spanSec > 0 ? Math.round((totalRecent / spanSec) * 60) : 0,
        profile,
        proxy: "tick-activity"
      }
    }
  })
  return {
    status: currentStatus(),
    mode: currentMode,
    account,
    viewed: viewedAssetId,
    watching: watching.map((w) => ({ id: w.id, name: w.name, type: w.type })),
    assets,
    ts: Date.now()
  }
}

export async function startLiveEO() {
  if (session) return session
  if (starting) return starting
  clearTimeout(idleTimer)
  idleTimer = null
  const gen = ++generation
  const run = (async () => {
    try {
      await openLiveSession(gen)
    } catch (err) {
      if (gen !== generation) return
      lastError = String(err?.message ?? err)
      const kind = /no expertoption session/i.test(lastError)
        ? "unconfigured"
        : isAuthRejection(lastError)
          ? "expired"
          : null
      if (kind) markAuthRejected(lastError)
      else emit("status", { status: "error", error: lastError })
      console.warn("[picc-live] ExpertOption session error:", lastError)
    } finally {
      if (starting === run) starting = null
    }
  })()
  starting = run
  return run
}

export async function stopLiveEO() {
  // Invalidate any in-flight start so it self-cancels instead of resurrecting
  // a session after we've torn everything down.
  generation += 1
  starting = null
  clearTimeout(idleTimer)
  idleTimer = null
  clearTimeout(reseedTimer)
  reseedTimer = null
  if (studioOff) {
    try {
      studioOff()
    } catch {
      /* ignore */
    }
    studioOff = null
  }
  if (session) {
    const s = session
    session = null
    try {
      s.close()
    } catch {
      /* ignore */
    }
  }
  // While the extension bridge streams frames from the user's own browser,
  // keep candle buffers intact — they are being fed right now and wiping
  // them would flash every dockable to "no data".
  const upstreamActive = upstreamStats.lastAt && Date.now() - upstreamStats.lastAt < 60_000
  if (!upstreamActive) {
    buffers.clear()
    lastTick.clear()
    assetTicks.clear()
    watching.length = 0
    byId.clear()
    viewedAssetId = null
  }
  account = null
  startedAt = 0
  degraded = null
  staleFlag = false
  emit("status", { status: "idle" })
}

/**
 * Soft reconnect: closes the current session but preserves candle buffers so
 * higher-timeframe analysis (MTF) doesn't lose context during reconnection.
 * Buffers are re-seeded from the new session once it connects.
 */
export async function softReconnectLiveEO() {
  generation += 1
  starting = null
  clearTimeout(reseedTimer)
  reseedTimer = null
  if (studioOff) {
    try { studioOff() } catch { /* ignore */ }
    studioOff = null
  }
  if (session) {
    const s = session
    session = null
    try { s.close() } catch { /* ignore */ }
  }
   // Deliberately keep buffers/lastTick/assetTicks/watching/byId intact so
   // MTF checks and price renderers continue to show stale-but-useful data
   // while the new session seeds fresh candles.
   startedAt = 0
   staleFlag = false
   emit("status", { status: "reconnecting" })
  void startLiveEO()
}

export function subscribeLiveEO(cb) {
  subscribers.add(cb)
  clearTimeout(idleTimer)
  idleTimer = null
  void startLiveEO()
  return () => {
    subscribers.delete(cb)
    if (subscribers.size === 0 && !idleTimer) {
      idleTimer = setTimeout(() => {
        idleTimer = null
        void stopLiveEO()
      }, IDLE_CLOSE_MS)
    }
  }
}

/**
 * Revive a dead ExpertOption session (stale/rejected token) with a fresh
 * browser-captured token. A healthy connected session is left alone unless
 * `force` is set (a token change was just captured, or the session is sitting
 * in an error state). `stopLiveEO` re-boots `starting` so an in-flight start
 * self-cancels cleanly.
 */
export async function restartLiveEO({ force = false } = {}) {
  const broken = lastError !== null
  if (session && !force && !broken) return false // healthy — keep it running
  // Use soft reconnect to preserve candle buffers during token changes and
  // connection drops — stale data is better than no data for MTF analysis.
  if (force || broken) {
    await softReconnectLiveEO()
  } else {
    const hadSubscribers = subscribers.size > 0
    await stopLiveEO()
    if (hadSubscribers) void startLiveEO()
  }
  return true
}

export function liveEOStats() {
  return {
    status: currentStatus(),
    error: lastError,
    startedAt,
    watched: watching.map((w) => w.name),
    buffers: buffers.size,
    tickCount: lastTick.size,
    subscribers: subscribers.size,
    viewed: viewedAssetId,
    lastSeen,
    stale: staleFlag,
    degraded: degraded ? { kind: degraded.kind, reason: degraded.reason, at: degraded.at } : null,
    upstream: {
      framesSeen: upstreamStats.framesSeen,
      accepted: upstreamStats.accepted,
      lastAt: upstreamStats.lastAt
    },
    account
  }
}

const lastLiveFetch = new Map() // `${assetId}:${period}` -> ts (per-key re-fetch throttle)
const LIVE_FETCH_MIN_MS = 3000

/**
 * On-demand candle fetch for an arbitrary asset. Returns OHLC from the buffer
 * if already seeded; otherwise issues a live headless request and caches the
 * result. Returns { ohlc, source } where source is "buffer" | "live" | null.
 */
export async function fetchAssetCandles(assetId, period = 60, count = 120) {
  if (!assetId) return { ohlc: [], source: null }
  const key = bufferKey(assetId, period)
  const buf = buffers.get(key)
  if (buf && buf.ohlc.length >= Math.min(count, 30)) {
    return { ohlc: buf.ohlc.slice(-count), source: "buffer" }
  }
  if (!session) return { ohlc: buf?.ohlc ?? [], source: buf?.ohlc?.length ? "buffer" : null }
  // Per-asset/period throttle: rapid asset switching in the UI must not fire
  // a burst of near-simultaneous history pulls at the gateway.
  const lastAt = Number(lastLiveFetch.get(key)) || 0
  if (Date.now() - lastAt < LIVE_FETCH_MIN_MS) {
    return { ohlc: buf?.ohlc ?? [], source: buf?.ohlc?.length ? "buffer" : null }
  }
  try {
    lastLiveFetch.set(key, Date.now())
    const hist = await session.candles(assetId, period, count)
    if (hist?.ohlc?.length) {
      reseedBuffer(assetId, period, hist.ohlc)
      lastSeen = Date.now()
      const updatedBuf = buffers.get(key)
      return { ohlc: updatedBuf.ohlc.slice(-count), source: "live" }
    }
  } catch { /* asset may not exist on broker */ }
  return { ohlc: buf?.ohlc ?? [], source: buf?.ohlc?.length ? "buffer" : null }
}

/**
 * Fetch a fresh account/balance profile from the headless session. Returns the
 * full dual-wallet account model or null if the session is unavailable.
 */
export async function fetchFreshAccount() {
  if (!session) return account
  try {
    const acc = await session.profile()
    if (acc && acc.balance != null) {
      account = acc
      return acc
    }
  } catch { /* profile fetch failed */ }
  return account
}

/**
 * Ensure a specific asset is in the watching set and seeded. Returns the
 * resolved asset ID (numeric) or null if the asset can't be resolved.
 */
export async function ensureWatchingAsset(assetSymbol) {
  if (!assetSymbol || !session) return null
  const existing = byId.get(String(assetSymbol)) ?? watching.find((w) => w.id === assetSymbol)
  if (existing) return String(existing.id)
  try {
    const assetsRaw = await session.assets()
    const assets = assetsFrom(assetsRaw)
    for (const a of assets) byId.set(String(a.id), a)
    const found = assets.find((a) => {
      const n = normName(a.name)
      const key = normName(assetSymbol)
      return n === key || n.includes(key) || key.includes(n)
    })
    if (found) {
      const fid = String(found.id)
      if (!watching.some((w) => w.id === fid)) watching.push(found)
      return fid
    }
  } catch { /* assets fetch failed */ }
  return null
}
