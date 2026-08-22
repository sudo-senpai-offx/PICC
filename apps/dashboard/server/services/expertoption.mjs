// ExpertOption WebSocket client — read-only analysis AND demo trading for the
// PICC trading suite.
//
// ExpertOption has no official public REST API; the browser app talks to an
// unofficial WebSocket endpoint. This client speaks that protocol directly:
// connect (setContext with your session token), getBalance, getAssets,
// getCandles, and — for DEMO accounts only — buy options (call/put binary
// trades) with full settlement tracking. It NEVER sends orders against a live
// (real-money) account: the trading surface refuses when the account is not
// marked as demo.
//
// The protocol is unofficial and can change; every response is parsed
// defensively and failures surface as clear errors, never crashes.
//
// Transport: the broker rejects sockets without browser-like headers, which
// Node's built-in WebSocket cannot send, so this module talks through the
// zero-dependency RFC 6455 client in ./wsclient.mjs.

import { randomBytes } from "node:crypto"
import { wsConnect, WsError } from "./wsclient.mjs"

export const DEFAULT_WS_URL = "wss://fr24g1eu.expertoption.com/ws/v45"

// The browser app sends these headers; without them the broker closes the
// socket with "socketNotAllowed".
export const BROWSER_HEADERS = {
  Origin: "https://app.expertoption.finance",
  Referer: "https://app.expertoption.finance/",
  "Accept-Language": "en-US,en;q=0.9"
}

// The platform routes connections to region endpoints by account location. We
// try the configured URL first, then every region so a stale/default URL still
// connects.
export const REGION_URLS = [
  "wss://fr24g1eu.expertoption.com/ws/v45",
  "wss://fr24g1in.expertoption.com/ws/v45",
  "wss://fr24g1hk.expertoption.com/ws/v45",
  "wss://fr24g1sg.expertoption.com/ws/v45",
  "wss://fr24g1us.expertoption.com/ws/v45",
  "wss://ws.expertoption.com/ws",
  "wss://fr24g1eu.expertoption.finance/ws/v45",
  "wss://fr24g1in.expertoption.finance/ws/v45",
  "wss://fr24g1hk.expertoption.finance/ws/v45",
  "wss://fr24g1sg.expertoption.finance/ws/v45",
  "wss://fr24g1us.expertoption.finance/ws/v45",
  "wss://ws.expertoption.finance/ws"
]

// The browser app signs every socket URL with its app fingerprint; the v45
// gateway requires these params (and the request otherwise fails with
// ERROR_INCORRECT_DATA). `app_session_id` identifies this app session.
function appSessionId() {
  const a = Math.random().toString(36).slice(2, 12)
  const b = Math.random().toString(36).slice(2, 12)
  return `${a}.${b}${Date.now().toString(36)}`
}

export function expertoptionWsUrl(base, params = {}) {
  const query = new URLSearchParams({
    app_os: "win",
    app_source: "web",
    app_type: "web",
    app_version: "34.0.2",
    app_build_number: "32785",
    app_brand: "expertoption",
    app_theme: "dark",
    app_device_info: "desktop",
    app_session_id: appSessionId(),
    ...params
  }).toString()
  return `${base}?${query}`
}

// Bootstrap symbol -> numeric asset id for well-known instruments. The live
// `assets` action is authoritative; this only helps resolve a symbol before the
// asset list arrives (or when a broker renames something).
export const STATIC_ASSETS = {
  EURUSD: 142,
  AUDCAD: 151,
  AUDJPY: 152,
  AUDUSD: 153,
  EURGBP: 154,
  NZDUSD: 156,
  USDCAD: 157,
  USDCHF: 158,
  EURAUD: 211,
  EURCHF: 212,
  GBPCAD: 214,
  GBPCHF: 216,
  EURJPY: 217,
  AUDCHF: 218,
  AUDNZD: 219,
  BTCUSD: 160,
  ETHUSD: 162,
  UKOIL: 177,
  WALLST30: 224,
  GERMANY30: 227,
  HONGKONG33: 225,
  USDX: 233,
  QQQ: 239,
  SMRTY: 240,
  PLATINUM: 221,
  COPPER: 247,
  ALTCOIN: 229,
  TOPCRYPTO: 230,
  EURUSD_OTC: 245,
  USDJPY_OTC: 248,
  GBPUSD_OTC: 250,
  XAUUSD_OTC: 251,
  AUDUSD_OTC: 273,
  USDCAD_OTC: 274,
  NZDUSD_OTC: 275,
  UKOIL_OTC: 267,
  SILVER_OTC: 268,
  GOOG_OTC: 270,
  INTEL_OTC: 269,
  META_OTC: 271,
  AAPL: 192,
  AMZN: 193,
  MSFT: 194,
  TSLA: 195,
  NFLX: 209,
  NVDA: 280,
  BABA: 190,
  MCD: 202,
  DIS: 203,
  IBM: 200
}

let nextId = 1
const newId = () => `p${Date.now().toString(36)}${nextId++}`

export const _nonce = () => randomBytes(6).toString("hex")

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

function dedupe(list) {
  return [...new Set(list.filter(Boolean))]
}

/** Parse one incoming WS frame into { action, msg, id, ok, success, error, payload }. Loose by design. */
export function parseMessage(raw) {
  let obj
  try {
    obj = JSON.parse(String(raw))
  } catch {
    return { ok: false, error: "non-JSON frame" }
  }
  if (!obj || typeof obj !== "object") return { ok: false, error: "empty frame" }
  const payload = obj.message && typeof obj.message === "object" ? obj.message : obj
  return {
    ok: true,
    action: obj.action ?? payload.action ?? "",
    msg: obj.msg ?? payload.msg ?? "",
    id: obj.id ?? payload.id ?? obj.ns ?? payload.ns ?? null,
    success: obj.success ?? payload.success ?? null,
    error:
      obj.error ?? payload.error ?? (typeof obj.message === "string" ? obj.message : null) ?? null,
    payload
  }
}

/**
 * Build the full ExpertOption account model from a profile payload.
 *
 * EO advertises BOTH wallets in every profile response (demo_balance AND
 * real_balance) regardless of the active context, so the suite can show the
 * demo and real account side by side. `is_demo` marks which context the
 * session is bound to; `active` reflects it. `balance`/`demo` stay as the
 * active-context view for backward compatibility with the single-wallet API.
 */
export function accountFrom(payload) {
  const nested = payload?.profile && typeof payload.profile === "object" ? payload.profile : payload ?? {}
  const currency = String(nested.currency ?? nested.curr ?? "USD").toUpperCase()
  const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v))
  const demoAmt = num(nested.demo_balance ?? nested.demoBalance)
  const realAmt = num(nested.real_balance ?? nested.realBalance)
  const single = num(nested.balance ?? nested.amount ?? nested.total) ?? 0
  const isDemo = nested.is_demo === 1 || nested.is_demo === true
  const isReal = nested.is_demo === 0 || nested.is_demo === false

  let demoBalance = 0
  let realBalance = 0
  let active = "real"
  if (isDemo) {
    demoBalance = demoAmt ?? single
    realBalance = realAmt ?? 0
    active = "demo"
  } else if (isReal) {
    demoBalance = demoAmt ?? 0
    realBalance = realAmt ?? single
    active = "real"
  } else if (demoAmt != null) {
    // EO always advertises both wallets plus the active flag; without the flag
    // default to the demo view but still carry the real wallet when present.
    demoBalance = demoAmt
    realBalance = realAmt ?? 0
    active = "demo"
  } else {
    // Legacy/generic payload with a single balance and no context flag.
    realBalance = realAmt ?? single
  }

  const wallet = active === "real" ? { balance: realBalance, currency } : { balance: demoBalance, currency }
  const name = [nested.name, nested.surname].filter(Boolean).join(" ")
  return {
    demoWallet: { balance: demoBalance, currency },
    realWallet: { balance: realBalance, currency },
    active,
    currency,
    balance: wallet.balance,
    demo: active === "demo",
    email: nested.email ? String(nested.email) : null,
    name: name ? String(name) : null
  }
}

/** Normalize a balance response into { balance, currency, demo } (active context). */
export function balanceFrom(payload) {
  const a = accountFrom(payload)
  return { balance: a.balance, currency: a.currency, demo: a.demo }
}

/**
 * Fold a fresh active-wallet balance view ({ balance, currency, demo }) back
 * into the full dual-wallet account model so every consumer always sees
 * demoWallet/realWallet. `balance` only refreshes the ACTIVE wallet; the other
 * wallet keeps its last-known balance.
 */
export function mergeBalanceIntoAccount(account, balance) {
  const cur = String(balance?.currency ?? account?.currency ?? "USD").toUpperCase()
  const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v))
  const fresh = num(balance?.balance)
  const demo = balance?.demo !== false
  const demoBalance = demo ? (fresh ?? account?.demoWallet?.balance ?? 0) : (account?.demoWallet?.balance ?? 0)
  const realBalance = demo ? (account?.realWallet?.balance ?? 0) : (fresh ?? account?.realWallet?.balance ?? 0)
  const base = account ?? {}
  return {
    ...base,
    demoWallet: { balance: demoBalance, currency: cur },
    realWallet: { balance: realBalance, currency: cur },
    active: demo ? "demo" : "real",
    currency: cur,
    balance: demo ? demoBalance : realBalance,
    demo
  }
}

/** Extract a normalized asset list from a profile/assets payload. */
export function assetsFrom(payload) {
  const list =
    (Array.isArray(payload?.assets) ? payload.assets : null) ??
    (Array.isArray(payload?.profile?.assets) ? payload.profile.assets : null) ??
    (Array.isArray(payload?.available_assets) ? payload.available_assets : null) ??
    []
  return list
    .map((a) => {
      if (typeof a === "string") return { id: a, name: a, type: "", currency: "", visible: true }
      const id = a?.id ?? a?.asset_id ?? a?.symbol ?? a?.name
      if (id == null) return null
      return {
        id: String(id),
        name: String(a?.name ?? a?.symbol ?? a?.title ?? id),
        type: String(a?.type ?? a?.kind ?? ""),
        currency: String(a?.currency ?? ""),
        visible: a?.visible !== false
      }
    })
    .filter(Boolean)
}

/** Normalize a candle history response into { closes, ohlc, count }. */
export function candlesFrom(payload) {
  // Already-normalized shapes pass through unchanged (from historyCandlesFrom).
  if (payload && Array.isArray(payload.ohlc) && Array.isArray(payload.closes)) {
    return { closes: payload.closes, ohlc: payload.ohlc, count: payload.ohlc.length }
  }
  const raw =
    (Array.isArray(payload) ? payload : null) ??
    (Array.isArray(payload?.candles) ? payload.candles : null) ??
    (Array.isArray(payload?.data) ? payload.data : null) ??
    (Array.isArray(payload?.history) ? payload.history : null) ??
    (Array.isArray(payload?.values) ? payload.values : null) ??
    []
  const closes = []
  const ohlc = []
  for (const c of raw) {
    if (Array.isArray(c)) {
      const close = Number(c[2] ?? c[1])
      if (Number.isFinite(close) && close > 0) {
        closes.push(close)
        ohlc.push({ time: Number(c[0]) || 0, open: Number(c[1]) || 0, close, high: Number(c[3]) || 0, low: Number(c[4]) || 0 })
      }
    } else if (c && typeof c === "object") {
      const close = Number(c.close ?? c.c ?? c.price)
      if (Number.isFinite(close) && close > 0) {
        closes.push(close)
        ohlc.push({
          time: Number(c.time ?? c.t ?? c.time_from) || 0,
          open: Number(c.open ?? c.o) || 0,
          close,
          high: Number(c.high ?? c.h) || 0,
          low: Number(c.low ?? c.l) || 0
        })
      }
    }
  }
  return { closes, ohlc, count: closes.length }
}

/**
 * Normalize the v45 `assetHistoryCandles` response:
 * { candles: [{ tf: <seconds>, periods: [[ts, [[open,high,low,close], …]]] }] }
 * into the same { closes, ohlc, count } shape as candlesFrom.
 */
export function historyCandlesFrom(payload) {
  const closes = []
  const ohlc = []
  const groups = Array.isArray(payload?.candles) ? payload.candles : []
  for (const group of groups) {
    const batches = Array.isArray(group?.periods) ? group.periods : []
    for (const batch of batches) {
      if (!Array.isArray(batch)) continue
      const [time, rows] = batch
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        if (!Array.isArray(row)) continue
        const close = Number(row[3] ?? row[2])
        if (!Number.isFinite(close) || close <= 0) continue
        closes.push(close)
        ohlc.push({
          time: Number(time) || 0,
          open: Number(row[0]) || 0,
          high: Number(row[1]) || 0,
          low: Number(row[2]) || 0,
          close
        })
      }
    }
  }
  // Fallback for flat candle lists (mock/legacy shape): [{time, open, close,
  // high, low}] or [{time, open, high, low, close}].
  if (!closes.length) {
    const flat = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.candles)
        ? payload.candles
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.history)
            ? payload.history
            : []
    for (const row of flat) {
      if (!row || typeof row !== "object") continue
      const time = Number(row.time ?? row.t ?? 0) || 0
      const close = Number(row.close ?? row.c ?? row[2] ?? row[3])
      if (!Number.isFinite(close) || close <= 0) continue
      closes.push(close)
      ohlc.push({
        time,
        open: Number(row.open ?? row.o ?? row[0]) || 0,
        high: Number(row.high ?? row.h ?? row[3] ?? row[1]) || 0,
        low: Number(row.low ?? row.l ?? row[2]) || 0,
        close
      })
    }
  }
  return { closes, ohlc, count: closes.length, timeframes: groups.map((g) => Number(g.tf) || 0) }
}

/**
 * Parse a live "candles" subscription push frame into a normalized shape.
 * Live candles are `{ tf, t, v: [open, high, low, close] }` under
 * `message.candles`, keyed by `message.assetId`.
 * @returns {{assetId:string, timeframe:number, candles:Array<{time,open,high,low,close,timeframe}>}|null}
 */
export function liveCandlesFrom(frame) {
  const message = frame?.message
  if (!message || typeof message !== "object") return null
  const assetId = String(message.assetId ?? message.asset_id ?? "")
  const rows = Array.isArray(message.candles) ? message.candles : []
  if (!rows.length) return null
  const candles = rows
    .map((c) => {
      if (!c || typeof c !== "object") return null
      const v = Array.isArray(c.v) ? c.v : []
      const open = Number(v[0])
      const high = Number(v[1])
      const low = Number(v[2])
      const close = Number(v[3])
      if (!Number.isFinite(close)) return null
      return {
        time: Number(c.t ?? c.time ?? 0) || 0,
        open: Number.isFinite(open) ? open : 0,
        high: Number.isFinite(high) ? high : 0,
        low: Number.isFinite(low) ? low : 0,
        close,
        timeframe: Number(c.tf ?? 0) || 0
      }
    })
    .filter(Boolean)
  if (!candles.length) return null
  return {
    assetId,
    timeframe: Number(message.timeframe ?? rows[0]?.tf ?? 0) || 0,
    candles
  }
}

// Assets that trade only at minute boundaries — their expiration shift aligns
// to 60s steps instead of the default 5s.
const MINUTE_BOUNDARY_ASSETS = new Set([142, 160, 162, 224, 225, 227, 233, 239, 240, 245, 248, 250, 251, 273, 274, 275, 267, 268])

/**
 * Seconds until the option expires. Ported from the reference client: the
 * broker aligns expiries to the asset's step boundary minus the purchase
 * window, so a 60s trade placed mid-minute expires on a real boundary rather
 * than an odd offset.
 */
export function expirationShift({ duration = 60, assetId = null, now = Math.floor(Date.now() / 1000), maxSec = 86400 } = {}) {
  const step = MINUTE_BOUNDARY_ASSETS.has(Number(assetId)) ? 60 : 5
  const purchaseTime = now % step
  const durationShift = Math.max(5, Math.round(Number(duration) || 60)) - 5
  const missedCycle = purchaseTime > 45 || purchaseTime >= durationShift || purchaseTime > durationShift - 5
  const shift = missedCycle ? step - purchaseTime + durationShift : durationShift - purchaseTime
  return Math.max(1, Math.min(Number(maxSec), Math.round(shift)))
}

/**
 * Build the wire payload for a demo binary-option purchase. `type` is "call"
 * (price up) or "put" (price down). Matches the protocol verified against the
 * broker.
 */
export function buyPayload({ token, assetId, type, amount, duration = 60, isDemo = true, now = Math.floor(Date.now() / 1000), ns = newId() }) {
  const typeStr = type === "put" ? "put" : "call"
  return {
    action: "buyOption",
    message: {
      type: typeStr,
      amount: round2(Number(amount) || 0),
      assetid: Number(assetId),
      strike_time: Math.floor(now),
      is_demo: isDemo ? 1 : 0,
      expiration_shift: expirationShift({ duration, assetId, now: Math.floor(now) }),
      ratePosition: 0
    },
    ns,
    token
  }
}

/** Fingerprint used to correlate a buyOption with its buySuccessful ack. */
export function fingerprintKey(assetId, type, amount, now) {
  const typeInt = type === "put" || Number(type) === 1 ? 1 : 0
  return `${Number(assetId)}|${typeInt}|${round2(Number(amount))}|${Number(now)}`
}

/** Parse a buySuccessful / openTradeSuccessful frame into a normalized open deal. */
export function openDealFrom(payload, { requestId = null, symbol = "", duration = 0 } = {}) {
  const trade = payload?.trade ?? payload?.option ?? payload
  if (!trade || typeof trade !== "object") return null
  if (trade.id == null && trade.asset_id == null && trade.amount == null) return null
  const typeRaw = trade.type
  const typeInt = typeRaw === 0 || typeRaw === "call" || typeRaw === "CALL" ? 0 : 1
  const type = typeInt === 0 ? "call" : "put"
  const strikeTime = Number(trade.strike_time) || 0
  const expTime = Number(trade.exp_time) || 0
  const payoutRaw = Number(trade.profit ?? trade.payout ?? 0) || 0
  return {
    requestId,
    serverId: String(trade.id),
    assetId: String(trade.asset_id),
    asset: String(trade.symbol ?? trade.asset ?? symbol ?? trade.asset_id),
    type,
    amount: round2(Number(trade.amount ?? 0)),
    openPrice: Number(trade.strike_rate ?? trade.open_rate ?? 0) || 0,
    payout: payoutRaw > 0 && payoutRaw <= 1 ? payoutRaw * 100 : payoutRaw, // normalize to percent
    strikeTime,
    expTime,
    openedAt: strikeTime ? new Date(strikeTime * 1000).toISOString() : new Date().toISOString(),
    expiresAt: expTime ? new Date(expTime * 1000).toISOString() : null,
    status: "active",
    duration: Number(duration) || 0
  }
}

/**
 * Parse an optionFinished / closeTradeSuccessful frame into closed-deal records
 * for the given active deals (keyed by serverId). Result/profit is taken from
 * the server fields when present, otherwise inferred from close vs open price.
 */
export function settlementsFrom(payload, activeDeals = []) {
  const rows =
    (Array.isArray(payload?.deals) ? payload.deals : null) ??
    (Array.isArray(payload?.rows) ? payload.rows : null) ??
    (Array.isArray(payload?.trades) ? payload.trades : null) ??
    []
  const byServer = new Map(activeDeals.map((d) => [String(d.serverId), d]))
  const out = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const serverId = String(row.id ?? row.deal_id ?? "")
    const active = serverId && byServer.get(serverId)
    if (!active) continue

    const closePrice = Number(row.close_rate ?? row.rate ?? row.close_price ?? active.lastPrice ?? 0) || 0
    const amount = Number(row.amount ?? active.amount ?? 0) || 0
    const statusRaw = String(row.status ?? "").toLowerCase()
    let result
    if (["win", "won", "profit", "success"].includes(statusRaw)) result = "win"
    else if (["loss", "lose", "lost", "fail"].includes(statusRaw)) result = "loss"
    else if (["draw", "equal", "refund"].includes(statusRaw)) result = "draw"
    else {
      const diff = closePrice - active.openPrice
      if (Math.abs(diff) <= 1e-8) result = "draw"
      else result = active.type === "call" ? (diff > 0 ? "win" : "loss") : diff < 0 ? "win" : "loss"
    }

    let profit
    const serverWin = row.win_amount ?? row.win ?? row.result_amount
    if (serverWin != null) {
      const sp = Number(serverWin) || 0
      profit = result === "loss" ? -amount : result === "draw" ? 0 : sp > amount + 1e-6 ? sp - amount : sp
    } else {
      profit = result === "win" ? round2(amount * (Number(active.payout) || 0) / 100) : result === "loss" ? -amount : 0
    }

    out.push({
      ...active,
      status: "closed",
      result,
      closePrice,
      profit: round2(profit),
      closedAt: new Date().toISOString()
    })
  }
  return out
}

// ---------------------------------------------------------------------
// Transport (shared by read-only and trading sessions)
// ---------------------------------------------------------------------

function createTransport({ token, isDemo, wsUrl, timeoutMs, regionUrls }) {
  const urls = dedupe([wsUrl, ...(Array.isArray(regionUrls) ? regionUrls : REGION_URLS)]).map((u) =>
    u.includes("?") ? u : expertoptionWsUrl(u)
  )
  let ws = null
  let keepAlive = null
  let assetCache = null
  let userClosed = false
  let reconnecting = false
  let reconnectTimer = null
  let reconnectAttempts = 0
  let authFailed = false
  let lastFrameAt = Date.now()
  const MAX_RECONNECT_ATTEMPTS = 8

  const pendingNs = new Map() // ns -> { resolve, reject, timer }
  const pendingAction = new Map() // action -> { resolve, reject, timer }
  const frameListeners = new Set()
  const candleListeners = new Set()
  const reconnectListeners = new Set()
  const dropListeners = new Set()
  const outbox = [] // queued payloads during disconnect, drained on reconnect
  const MAX_OUTBOX = 50

  /**
   * Reject every in-flight waiter with `reason` and clear the maps. Without
   * this, a dropped socket / explicit close orphans the promises and the
   * awaiting callers hang forever (e.g. session.candles() during seedAll).
   */
  const rejectPending = (reason) => {
    for (const [, w] of pendingNs) {
      clearTimeout(w.timer)
      try {
        w.reject(reason)
      } catch {
        /* a waiter's own settle may already have cleaned it up */
      }
    }
    for (const [, w] of pendingAction) {
      clearTimeout(w.timer)
      try {
        w.reject(reason)
      } catch {
        /* ignore */
      }
    }
    pendingNs.clear()
    pendingAction.clear()
  }

  /** Notify higher-level consumers (e.g. pending buy confirmations). */
  const notifyDrop = (reason) => {
    for (const cb of dropListeners) {
      try {
        cb(reason)
      } catch {
        /* a listener's own error never breaks the socket */
      }
    }
  }

  function dispatch(text) {
    const frame = parseMessage(text)
    if (!frame.ok) return
    const action = frame.action

    if (action === "error") {
      const ns = frame.id
      const waiter = ns && pendingNs.get(ns)
      if (waiter) {
        pendingNs.delete(ns)
        clearTimeout(waiter.timer)
        waiter.reject(new Error(String(frame.error ?? "request rejected")))
      }
      return
    }

    const ns = frame.id
    if (ns && pendingNs.has(ns)) {
      const waiter = pendingNs.get(ns)
      pendingNs.delete(ns)
      clearTimeout(waiter.timer)
      waiter.resolve(frame.payload)
      return
    }

    if (action === "assets") assetCache = assetsFrom(frame.payload)

    const waiter = pendingAction.get(action)
    if (waiter) {
      clearTimeout(waiter.timer)
      pendingAction.delete(action)
      waiter.resolve(frame.payload)
      return
    }

    // Live candle pushes (subscribeCandles): never consumed by pendingAction
    // waiters, so they always reach the subscription listeners.
    if (action === "candles") {
      const live = liveCandlesFrom({ message: frame.payload })
      if (live) {
        for (const cb of candleListeners) {
          try {
            cb(live)
          } catch {
            /* listener errors never break the socket */
          }
        }
      }
    }

    for (const cb of frameListeners) {
      try {
        cb(frame)
      } catch {
        /* listener errors never break the socket */
      }
    }
  }

  /** Unexpected socket drop: clear in-flight work and try to reconnect. */
  function handleDrop(err) {
    if (userClosed || authFailed) return
    clearInterval(keepAlive)
    keepAlive = null
    notifyDrop(new Error(`expertoption connection dropped (${err?.message ?? "unknown"})`))
    rejectPending(new Error(`expertoption connection dropped (${err?.message ?? "unknown"})`))
    ws = null
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[picc-expertoption] connection lost (${err?.message}) — reconnecting…`)
    }
    scheduleReconnect()
  }

  function scheduleReconnect() {
    if (userClosed || reconnecting || authFailed) return
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        `[picc-expertoption] giving up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts — run Trading → ExpertOption again to reconnect`
      )
      return
    }
    reconnecting = true
    const delay = Math.min(30_000, Math.max(500, 1000 * 2 ** Math.min(reconnectAttempts, 5)))
    reconnectAttempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void (async () => {
        try {
          await openSocket()
          reconnecting = false
          reconnectAttempts = 0
          drainOutbox()
          for (const cb of reconnectListeners) {
            try {
              cb()
            } catch {
              /* listener errors never break reconnect */
            }
          }
        } catch {
          reconnecting = false
          scheduleReconnect()
        }
      })()
    }, delay)
  }

  async function openSocket() {
    let lastErr = null
    for (const url of urls) {
      try {
        ws = await wsConnect(url, { headers: BROWSER_HEADERS, timeoutMs })
        break
      } catch (err) {
        lastErr = err
      }
    }
    if (!ws) throw new WsError(lastErr?.message ?? "no websocket endpoint available")

    ws.onMessage = (t) => {
      lastFrameAt = Date.now()
      try {
        dispatch(t)
      } catch (err) {
        console.warn("[picc-expertoption] frame error:", err.message)
      }
    }
    ws.onClose = () => handleDrop(new Error("expertoption connection closed"))
    ws.onError = (err) => handleDrop(new Error(err.message))

    // Authenticate. The server acks setContext (or rejects with an error
    // frame carrying the same ns). The token is a browser session token, not
    // a permanent API key — PICC keeps it in local credentials.
    const ns = newId()
    const authed = new Promise((res, rej) => {
      const timer = setTimeout(() => {
        pendingNs.delete(ns)
        rej(new Error("setContext timed out — invalid or stale session token?"))
      }, timeoutMs)
      pendingNs.set(ns, {
        resolve: () => {
          clearTimeout(timer)
          res()
        },
        reject: (err) => {
          clearTimeout(timer)
          rej(err)
        },
        timer
      })
      ws.sendText(JSON.stringify({ action: "setContext", token, message: { is_demo: isDemo ? 1 : 0 }, ns }))
    })

    try {
      await authed
    } catch (err) {
      const msg = String(err?.message ?? "")
      try {
        ws?.close(1000)
      } catch {
        /* ignore */
      }
      ws = null
      if (!/timed out|timeout/i.test(msg)) {
        // The broker actively rejected the session token — retrying against the
        // same token can never succeed, so stop reconnecting and surface a
        // friendly message to the caller instead.
        authFailed = true
        throw new Error(
          `ExpertOption rejected the session token (${msg}) — reconnect in ExpertOption and update the token in Trading Settings`
        )
      }
      throw err
    }
    reconnectAttempts = 0
    clearInterval(keepAlive)
    keepAlive = setInterval(() => {
      // Ping keeps the socket alive; the watchdog force-drops a socket that
      // has stopped producing any frames so the reconnect loop can revive it.
      if (!userClosed && Date.now() - lastFrameAt > 90_000) {
        try {
          ws?.close(1000)
        } catch {
          /* ignore */
        }
        return
      }
      try {
        ws?.sendText(JSON.stringify({ action: "ping", v: 23, message: { data: String(Date.now()) } }))
      } catch {
        /* ignore */
      }
    }, 20_000)
  }

  function connect() {
    return openSocket()
  }

  function ensureOpen() {
    if (userClosed) throw new Error("connection closed")
    if (!ws) throw new Error("connection unavailable — reconnecting")
  }

  function requestNs(payload, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      try {
        ensureOpen()
      } catch (err) {
        return reject(err)
      }
      const ns = payload.ns ?? newId()
      const framed = { ...payload, ns }
      const timer = setTimeout(() => {
        pendingNs.delete(ns)
        reject(new Error(`no response for "${payload.action}" (${ns})`))
      }, timeoutMs)
      pendingNs.set(ns, { resolve: (v) => resolve(v), reject: (e) => reject(e), timer })
      ws.sendText(JSON.stringify(framed))
    })
  }

  /**
   * Send a request and resolve with the payload of the next frame whose action
   * matches any of `actions`. Server pushes (profile/assets/candles) don't echo
   * our ns, so matching is by action.
   */
  function requestAction(payload, actions, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      try {
        ensureOpen()
      } catch (err) {
        return reject(err)
      }
      const list = Array.isArray(actions) ? actions : [actions]
      const timers = []
      const cleanup = () => {
        for (const a of list) pendingAction.delete(a)
        for (const t of timers) clearTimeout(t)
      }
      const settle = (fn, v) => {
        cleanup()
        fn(v)
      }
      const waiter = {
        resolve: (v) => settle(resolve, v),
        reject: (e) => settle(reject, e)
      }
      for (const a of list) {
        if (!pendingAction.has(a)) pendingAction.set(a, waiter)
      }
      const timer = setTimeout(() => settle(reject, new Error(`no response for "${payload.action}" (${list.join("/")})`)), timeoutMs)
      timers.push(timer)
      ws.sendText(JSON.stringify(payload))
    })
  }

  function send(payload) {
    if (ws && !userClosed) {
      ws.sendText(JSON.stringify(payload))
    } else if (!userClosed && !authFailed) {
      // Queue for delivery once reconnected (bounded to prevent memory growth)
      if (outbox.length < MAX_OUTBOX) outbox.push(payload)
    } else {
      throw new Error("connection closed — cannot send")
    }
  }

  function drainOutbox() {
    while (outbox.length > 0 && ws && !userClosed) {
      const payload = outbox.shift()
      try {
        ws.sendText(JSON.stringify(payload))
      } catch {
        // Socket died mid-drain — re-queue remaining
        outbox.unshift(payload)
        break
      }
    }
  }

  function withAsset(assetId) {
    if (assetId == null) return Promise.reject(new Error("asset id or symbol required"))
    if (/^\d+$/.test(String(assetId))) return Promise.resolve(Number(assetId))
    const key = String(assetId).trim().toUpperCase()
    const tryResolve = () => {
      const list = assetCache ?? []
      const found = list.find((a) => a.id.toUpperCase() === key || a.name.toUpperCase() === key)
      if (found && /^\d+$/.test(found.id)) return Number(found.id)
      const stat = STATIC_ASSETS[key]
      if (stat) return stat
      return null
    }
    const hit = tryResolve()
    if (hit) return Promise.resolve(hit)
    // The live asset list may not have arrived yet — load it once before
    // giving up (handles broker-specific names like "BTC/USD" vs "BTCUSD").
    if (assetCache == null) {
      return requestAction({ action: "assets", token }, ["assets"], 8000).then((p) => {
        const again = tryResolve()
        if (again) return again
        return Promise.reject(new Error(`unknown ExpertOption asset "${assetId}"`))
      })
    }
    return Promise.reject(new Error(`unknown ExpertOption asset "${assetId}"`))
  }

  return {
    connect,
    requestNs,
    requestAction,
    send,
    withAsset,
    onFrame: (cb) => {
      frameListeners.add(cb)
      return () => frameListeners.delete(cb)
    },
    onCandles: (cb) => {
      candleListeners.add(cb)
      return () => candleListeners.delete(cb)
    },
    onReconnect: (cb) => {
      reconnectListeners.add(cb)
      return () => reconnectListeners.delete(cb)
    },
    onDrop: (cb) => {
      dropListeners.add(cb)
      return () => dropListeners.delete(cb)
    },
    close() {
      if (userClosed) return
      userClosed = true
      reconnecting = false
      clearInterval(keepAlive)
      keepAlive = null
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      notifyDrop(new Error("expertoption session closed"))
      rejectPending(new Error("expertoption session closed"))
      try {
        ws?.close(1000)
      } catch {
        /* ignore */
      }
      ws = null
    },
    get connected() {
      return !userClosed && Boolean(ws)
    }
  }
}

// ---------------------------------------------------------------------
// Read-only session (analysis only — never places orders)
// ---------------------------------------------------------------------

/**
 * Open a read-only ExpertOption session: balance / assets / candles.
 * @param {object} opts { token, isDemo, wsUrl, timeoutMs }
 * @returns {Promise<{close():void, balance():Promise<object>, assets():Promise<object>, candles(id,period,count):Promise<object>}>}
 */
export async function connectSession({ token, isDemo = true, wsUrl = DEFAULT_WS_URL, timeoutMs = 15000, regionUrls } = {}) {
  if (!token || typeof token !== "string") throw new Error("expertoption token required")
  let demo = isDemo
  let transport = createTransport({ token, isDemo: demo, wsUrl, timeoutMs, regionUrls })
  try {
    await transport.connect()
  } catch (err) {
    // The requested context (demo vs real) can mismatch the account type — EO
    // refuses the wrong one with CONTEXT_ONLY_FOR_REAL_USER. Retry once with the
    // opposite context. connectSession is read-only (balance/assets/candles), so
    // flipping can never risk trading the wrong account.
    if (!/CONTEXT_ONLY_FOR_REAL_USER/i.test(String(err?.message ?? ""))) throw err
    demo = !demo
    transport = createTransport({ token, isDemo: demo, wsUrl, timeoutMs, regionUrls })
    await transport.connect()
  }

  return {
    close: () => transport.close(),
    isDemo: demo,
    sendRaw: (payload) => transport.send(payload),
    onFrame: (cb) => transport.onFrame(cb),
    profile: () =>
      transport.requestAction({ action: "profile", token }, ["profile"]).then((p) => accountFrom(p.profile ?? p)),
    balance: () =>
      transport.requestAction({ action: "profile", token }, ["profile"]).then((p) => balanceFrom(p.profile ?? p)),
    assets: () => transport.requestAction({ action: "assets", token }, ["assets"]),
    candles: (assetId, period = 60, count = 120) =>
      transport.withAsset(assetId).then((aid) => {
        const now = Math.floor(Date.now() / 1000)
        const from = now - period * count * 2
        // v45 gateway: `assetHistoryCandles` both returns history AND enables
        // live candle pushes for the requested timeframes. Correlated by echoed
        // id (ns) so concurrent requests can never cross-wire.
        return transport
          .requestNs(
            {
              action: "assetHistoryCandles",
              message: { assetid: aid, periods: [[from, now]], timeframes: [period] },
              token
            },
            12000
          )
          .then((p) => historyCandlesFrom(p))
      }),
    subscribeCandles: (assetId, period = 60) =>
      transport.withAsset(assetId).then((aid) => {
        transport.send({
          action: "subscribeCandles",
          message: { asset_id: aid, timeframes: [period] },
          token,
          ns: newId()
        })
        return { assetId: aid, period }
      }),
    unsubscribeCandles: (assetId) =>
      transport.withAsset(assetId).then((aid) => {
        transport.send({ action: "unsubscribeCandles", message: { asset_id: aid }, token })
        return { assetId: aid }
      }),
    onCandles: (cb) => transport.onCandles(cb),
    onReconnect: (cb) => transport.onReconnect(cb)
  }
}

// ---------------------------------------------------------------------
// Trading session (DEMO only)
// ---------------------------------------------------------------------

/**
 * Open a trading-capable session for a DEMO ExpertOption account.
 *
 * @param {object} opts { token, isDemo, wsUrl, timeoutMs }
 * @returns {Promise<object>} {
 *   connected:boolean, isDemo, close(),
 *   profile():Promise<object>, assets():Promise<object>,
 *   candles(assetId,period,count):Promise<object>,
 *   buy({assetId,type,amount,duration}):Promise<deal>,
 *   deals():Array, settled():Array, livePrice(serverId):number|null,
 *   onDeal(cb):unsubscribe
 * }
 */
export async function connectTradingSession({ token, isDemo = true, wsUrl = DEFAULT_WS_URL, timeoutMs = 15000, regionUrls } = {}) {
  if (!token || typeof token !== "string") throw new Error("expertoption token required")
  if (!isDemo) throw new Error("live trading is disabled — connect with a demo account (isDemo: true)")

  const transport = createTransport({ token, isDemo, wsUrl, timeoutMs, regionUrls })
  await transport.connect()

  const activeDeals = new Map() // serverId -> deal
  const settledDeals = []
  const pendingBuys = new Map() // requestId -> { resolve, reject, timer, info }
  const fingerprints = new Map() // fpKey -> requestId
  const listeners = new Set()

  transport.onDrop(() => {
    for (const [, pending] of pendingBuys) {
      clearTimeout(pending.timer)
      try {
        pending.reject(new Error("expertoption connection dropped while waiting for trade confirmation"))
      } catch {
        /* ignore */
      }
    }
    pendingBuys.clear()
    fingerprints.clear()
  })

  const emit = (kind, deal) => {
    for (const cb of listeners) {
      try {
        cb(kind, deal)
      } catch {
        /* ignore */
      }
    }
  }

  transport.onFrame((frame) => {
    const action = frame.action

    if (action === "buySuccessful" || action === "openTradeSuccessful") {
      const deal = openDealFrom(frame.payload)
      if (!deal) return
      // Match by fingerprint (asset, direction, amount, strike time). The
      // server may round the strike by a second or two, so scan a small window.
      let requestId = fingerprints.get(fingerprintKey(deal.assetId, deal.type, deal.amount, deal.strikeTime))
      if (!requestId) {
        for (let delta = -5; delta <= 5 && !requestId; delta++) {
          if (delta === 0) continue
          requestId = fingerprints.get(fingerprintKey(deal.assetId, deal.type, deal.amount, deal.strikeTime + delta))
        }
      }
      const pending = requestId ? pendingBuys.get(requestId) : null
      if (pending) {
        pendingBuys.delete(requestId)
        clearTimeout(pending.timer)
        deal.requestId = requestId
        deal.symbol = pending.info.symbol
        deal.duration = pending.info.duration
        activeDeals.set(deal.serverId, deal)
        pending.resolve(deal)
        emit("opened", deal)
      }
      return
    }

    if (action === "optionFinished" || action === "closeTradeSuccessful") {
      const closed = settlementsFrom(frame.payload, [...activeDeals.values()])
      for (const c of closed) {
        activeDeals.delete(c.serverId)
        settledDeals.push(c)
        if (settledDeals.length > 500) settledDeals.shift()
        emit("settled", c)
      }
      return
    }

    if (action === "optStatus" || action === "tradesStatus") {
      const rows = frame.payload?.options ?? frame.payload?.trades ?? []
      for (const r of rows) {
        if (r?.id != null && r.p != null) {
          const deal = activeDeals.get(String(r.id))
          if (deal) deal.lastPrice = Number(r.p)
        }
      }
    }
  })

  function buy({ assetId, type, amount, duration = 60 }) {
    return new Promise((resolve, reject) => {
      transport.withAsset(assetId).then(
        (aid) => {
          const amt = round2(Number(amount))
          if (!Number.isFinite(amt) || amt < 1) {
            reject(new Error("minimum demo trade amount is $1"))
            return
          }
          const dur = Math.round(Number(duration) || 60)
          if (dur < 5 || dur > 43200) {
            reject(new Error("duration must be between 5 seconds and 12 hours"))
            return
          }
          const now = Math.floor(Date.now() / 1000)
          const requestId = newId()
          const info = { symbol: String(assetId), duration: dur }
          const payload = buyPayload({ token, assetId: aid, type, amount: amt, duration: dur, isDemo, now, ns: requestId })
          const key = fingerprintKey(aid, type, amt, now)
          const timer = setTimeout(() => {
            pendingBuys.delete(requestId)
            reject(new Error("trade confirmation timed out — the server did not acknowledge buyOption"))
          }, 20000)
          pendingBuys.set(requestId, { resolve, reject, timer, info })
          fingerprints.set(key, requestId)
          try {
            transport.send(payload)
          } catch (err) {
            clearTimeout(timer)
            pendingBuys.delete(requestId)
            reject(err)
          }
        },
        reject
      )
    })
  }

  return {
    connected: transport.connected,
    isDemo,
    close: () => transport.close(),
    profile: () => transport.requestAction({ action: "profile", token }, ["profile"]),
    balance: () =>
      transport.requestAction({ action: "profile", token }, ["profile"]).then((p) => balanceFrom(p.profile ?? p)),
    assets: () => transport.requestAction({ action: "assets", token }, ["assets"]),
    candles: (assetId, period = 60, count = 120) =>
      transport.withAsset(assetId).then((aid) =>
        transport.requestAction(
          {
            action: "history",
            msg: "getCandles",
            message: {
              asset_id: aid,
              period,
              count,
              time_from: Math.floor(Date.now() / 1000) - period * count * 2,
              time_to: Math.floor(Date.now() / 1000),
              chunk_size: count
            },
            token
          },
          // NB: "candles" is deliberately absent — that action is reserved for
          // live subscription pushes and must never be consumed as a reply.
          ["assetHistoryCandles", "history"]
        )
      ),
    subscribeCandles: (assetId, period = 60) =>
      transport.withAsset(assetId).then((aid) => {
        transport.send({
          action: "subscribeCandles",
          message: { asset_id: aid, timeframes: [period] },
          token,
          ns: newId()
        })
        return { assetId: aid, period }
      }),
    unsubscribeCandles: (assetId) =>
      transport.withAsset(assetId).then((aid) => {
        transport.send({ action: "unsubscribeCandles", message: { asset_id: aid }, token })
        return { assetId: aid }
      }),
    onCandles: (cb) => transport.onCandles(cb),
    onReconnect: (cb) => transport.onReconnect(cb),
    buy,
    deals: () => [...activeDeals.values()],
    settled: () => settledDeals.slice(),
    livePrice: (serverId) => activeDeals.get(String(serverId))?.lastPrice ?? null,
    onDeal: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}
