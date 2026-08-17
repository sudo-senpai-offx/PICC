// Mock ExpertOption WebSocket server for integration tests.
// Speaks just enough of the unofficial protocol to exercise the client:
// setContext (auth ack / token rejection), profile, assets, history/candles,
// buyOption -> buySuccessful -> optionFinished, and live optStatus pushes.
import http from "node:http"
import { createHash } from "node:crypto"

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

function serverFrame(opcode, text) {
  const payload = typeof text === "string" ? Buffer.from(text, "utf8") : text
  const len = payload.length
  const header = [0x80 | opcode]
  if (len < 126) {
    header.push(len)
  } else if (len <= 0xffff) {
    header.push(126, (len >> 8) & 0xff, len & 0xff)
  } else {
    header.push(127)
    const big = BigInt(len)
    for (let i = 7; i >= 0; i--) header.push(Number((big >> BigInt(i * 8)) & 0xffn))
  }
  return Buffer.concat([Buffer.from(header), payload])
}

function decodeClientFrame(buf) {
  if (buf.length < 2) return null
  const fin = Boolean(buf[0] & 0x80)
  const opcode = buf[0] & 0x0f
  const masked = Boolean(buf[1] & 0x80)
  let len = buf[1] & 0x7f
  let offset = 2
  if (len === 126) {
    if (buf.length < offset + 2) return null
    len = buf.readUInt16BE(offset)
    offset += 2
  } else if (len === 127) {
    if (buf.length < offset + 8) return null
    len = Number(buf.readBigUInt64BE(offset))
    offset += 8
  }
  let mask = null
  if (masked) {
    if (buf.length < offset + 4) return null
    mask = buf.subarray(offset, offset + 4)
    offset += 4
  }
  if (buf.length < offset + len) return null
  let payload = buf.subarray(offset, offset + len)
  if (mask) {
    const unmasked = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ mask[i % 4]
    payload = unmasked
  }
  return { fin, opcode, payload, consumed: offset + len }
}

/**
 * @param {object} options
 * @param {1|0} options.isDemo
 * @param {number} options.demoBalance
 * @param {number} options.realBalance
 * @param {string} options.currency
 * @param {boolean} options.win            whether settled trades win or lose
 * @param {number} options.payout          payout percent (e.g. 85)
 * @param {number} options.buyAckDelayMs   delay before buySuccessful
 * @param {number} options.settlementDelayMs delay before optionFinished
 * @param {boolean} options.rejectToken    reject setContext with ERROR_INCORRECT_TOKEN
 * @param {boolean} options.contextRejectDemo reject setContext with is_demo=1 using
 *                                           ERROR_CONTEXT_ONLY_FOR_REAL_USER (simulates a
 *                                           real account that refuses the demo context)
 */
export function createMockExpertOptionServer(options = {}) {
  const {
    isDemo = 1,
    demoBalance = 10000,
    realBalance = 20000,
    currency = "USD",
    win = true,
    payout = 85,
    buyAckDelayMs = 30,
    settlementDelayMs = 120,
    rejectToken = false,
    contextRejectDemo = false
  } = options

  const received = []
  const sent = []
  const candleSubs = new Set() // assetId (number) with an active subscribeCandles
  let sockets = new Set()
  let nextDealId = 1
  let effectiveDemo = isDemo // account mode; set by the accepted setContext
  const basePrice = 1.2345

  const server = http.createServer()
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"]
    const accept = createHash("sha1").update(key + GUID).digest("base64")
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        "\r\n"
    )
    sockets.add(socket)
    let incoming = Buffer.alloc(0)
    socket.on("data", (chunk) => {
      incoming = incoming.length ? Buffer.concat([incoming, chunk]) : chunk
      while (true) {
        const frame = decodeClientFrame(incoming)
        if (!frame) return
        incoming = incoming.subarray(frame.consumed)
        if (frame.opcode === 0x8) {
          // close request: reply with a close ack
          try {
            socket.write(serverFrame(0x8, frame.payload.length >= 2 ? frame.payload.subarray(0, 2) : Buffer.from([0x03, 0xe8])))
          } catch {
            /* ignore */
          }
          continue
        }
        if (frame.opcode === 0x9) {
          try {
            socket.write(serverFrame(0xa, frame.payload))
          } catch {
            /* ignore */
          }
          continue
        }
        if (frame.opcode === 0x1 || frame.opcode === 0x2) {
          const text = frame.payload.toString(frame.opcode === 0x1 ? "utf8" : "latin1")
          try {
            handleMessage(JSON.parse(text))
          } catch {
            /* ignore malformed client frame */
          }
        }
      }
    })
    socket.on("error", () => {})
    socket.on("close", () => sockets.delete(socket))
  })

  function send(obj) {
    const text = JSON.stringify(obj)
    sent.push(text)
    for (const s of sockets) {
      try {
        s.write(serverFrame(0x1, text))
      } catch {
        /* ignore */
      }
    }
  }

  function makeCandles(msg) {
    const m = msg.message || {}
    let count = Math.min(Number(m.count) || 120, 500)
    let period = Number(m.period) || 60
    // v45 gateway shape: { periods: [[from, to]], timeframes: [period] }
    if (Array.isArray(m.periods) && Array.isArray(m.periods[0]) && Array.isArray(m.timeframes)) {
      const [from, to] = m.periods[0].map(Number)
      const tf = Number(m.timeframes[0])
      if (Number.isFinite(from) && Number.isFinite(to) && Number.isFinite(tf) && tf > 0) {
        period = tf
        count = Math.max(1, Math.min(500, Math.round((to - from) / tf)))
      }
    }
    const out = []
    let price = basePrice
    const start = Math.floor(Date.now() / 1000) - count * period
    for (let i = 0; i < count; i++) {
      const drift = (Math.sin(i * 0.7) + 0.12) * 0.002
      const open = price
      const close = Math.max(0.0001, open * (1 + drift))
      price = close
      out.push({
        time: start + i * period,
        open: Math.round(open * 1e5) / 1e5,
        close: Math.round(close * 1e5) / 1e5,
        high: Math.round(Math.max(open, close) * 1.0005 * 1e5) / 1e5,
        low: Math.round(Math.min(open, close) * 0.9995 * 1e5) / 1e5
      })
    }
    return out
  }

  function handleMessage(msg) {
    received.push(msg)
    const action = msg.action

    if (action === "setContext") {
      const requested = msg.message?.is_demo === 1 || msg.message?.is_demo === true
      if (rejectToken) {
        send({ action: "error", message: "ERROR_INCORRECT_TOKEN", ns: msg.ns })
        return
      }
      if (contextRejectDemo && requested) {
        send({ action: "error", message: "ERROR_CONTEXT_ONLY_FOR_REAL_USER", ns: msg.ns })
        return
      }
      // Accept whatever context the client settled on; the account's own mode
      // follows the last accepted context (so profile/buy echo the real one).
      effectiveDemo = requested ? 1 : 0
      send({ action: "setContext", ns: msg.ns, token: msg.token, message: { is_demo: effectiveDemo } })
      return
    }

    if (action === "profile") {
      // EO advertises BOTH wallets in every profile response regardless of the
      // active context; `is_demo` only marks which one the session is bound to.
      send({
        action: "profile",
        ns: msg.ns,
        message: {
          demo_balance: demoBalance,
          real_balance: realBalance,
          balance: effectiveDemo ? demoBalance : realBalance,
          currency,
          is_demo: effectiveDemo,
          assets: [
            { id: 142, name: "EUR/USD", type: "currency", currency: "EUR" },
            { id: 160, name: "BTC/USD", type: "crypto", currency: "USD" }
          ]
        }
      })
      return
    }

    if (action === "assets") {
      send({
        action: "assets",
        ns: msg.ns,
        message: {
          assets: [
            { id: 142, name: "EUR/USD", type: "currency", currency: "EUR" },
            { id: 160, name: "BTC/USD", type: "crypto", currency: "USD" }
          ]
        }
      })
      return
    }

    if (action === "history" || action === "getCandles") {
      send({ action: "history", ns: msg.ns, message: makeCandles(msg) })
      return
    }

    if (action === "assetHistoryCandles") {
      send({ action: "assetHistoryCandles", ns: msg.ns, message: makeCandles(msg) })
      return
    }

    if (action === "buyOption") {
      const m = msg.message || {}
      const dealId = `deal-${nextDealId++}`
      const strikeTime = Number(m.strike_time)
      const amount = Number(m.amount)
      const trade = {
        id: dealId,
        asset_id: m.assetid,
        type: m.type,
        amount,
        strike_time: strikeTime,
        strike_rate: basePrice,
        exp_time: strikeTime + Number(m.expiration_shift),
        profit: payout
      }
      setTimeout(() => send({ action: "buySuccessful", message: { trade } }), buyAckDelayMs)
      setTimeout(() => {
        send({
          action: "optionFinished",
          message: {
            deals: [
              {
                id: dealId,
                status: win ? "win" : "loss",
                amount,
                win_amount: win ? Math.round(amount * (1 + payout / 100) * 100) / 100 : 0,
                open_rate: basePrice,
                close_rate: win ? basePrice + 0.01 : basePrice - 0.01,
                profit: payout
              }
            ]
          }
        })
      }, settlementDelayMs)
      return
    }

    if (action === "subscribeCandles") {
      candleSubs.add(Number((msg.message || {}).asset_id))
      if (msg.ns) send({ action, ns: msg.ns, message: {} })
      return
    }

    if (action === "unsubscribeCandles") {
      candleSubs.delete(Number((msg.message || {}).asset_id))
      return
    }

    // Unknown action: echo an ack using the client's ns when present.
    if (msg.ns) send({ action, ns: msg.ns, message: {} })
  }

  /**
   * Simulate a live candle push for an asset that has an active subscription.
   * @param {number} assetId
   * @param {number} timeframe
   * @param {Array<{t:number, tf?:number, v:[o,h,l,c]}>} rows
   */
  function pushCandles(assetId, timeframe = 60, rows = []) {
    if (!rows.length) rows = [
      { t: Math.floor(Date.now() / 1000), v: [basePrice, basePrice * 1.001, basePrice * 0.999, basePrice * 1.0005] }
    ]
    const payload = {
      action: "candles",
      message: {
        assetId: String(assetId),
        timeframe,
        candles: rows.map((r) => ({ t: r.t, tf: r.tf ?? timeframe, v: r.v }))
      }
    }
    send(payload)
  }

  return {
    received,
    sent,
    pushCandles,
    activeCandleSubs: candleSubs,
    port: null,
    url: null,
    basePrice,
    async start() {
      await new Promise((res) => server.listen(0, "127.0.0.1", res))
      this.port = server.address().port
      this.url = `ws://127.0.0.1:${this.port}`
      return this
    },
    async stop() {
      for (const s of sockets) {
        try {
          s.destroy()
        } catch {
          /* ignore */
        }
      }
      sockets.clear()
      await new Promise((res) => server.close(res))
    }
  }
}
