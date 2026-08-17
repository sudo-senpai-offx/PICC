// Minimal RFC 6455 WebSocket client with full header control.
// The dashboard's production server is zero-dependency (`node server/index.mjs`),
// and Node's built-in WebSocket cannot set Origin/User-Agent — which ExpertOption
// requires. This client implements just enough of the protocol (handshake, masked
// text frames, fragmentation, ping/pong, close) to talk to it.
import { createHash, randomBytes } from "node:crypto"
import http from "node:http"
import https from "node:https"

const OP_CONT = 0x0
const OP_TEXT = 0x1
const OP_BINARY = 0x2
const OP_CLOSE = 0x8
const OP_PING = 0x9
const OP_PONG = 0xa

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

export class WsError extends Error {
  constructor(message) {
    super(message)
    this.name = "WsError"
  }
}

export class WsClient {
  constructor(socket) {
    this.socket = socket
    this._incoming = Buffer.alloc(0)
    this._fragmented = null // { opcode, parts: [] }
    this.onMessage = () => {}
    this.onClose = () => {}
    this.onError = () => {}
    this.closed = false

    socket.setNoDelay(true)
    socket.on("data", (chunk) => this._onData(chunk))
    socket.on("error", (err) => {
      if (!this.closed) this.onError(err)
    })
    socket.on("close", () => this._handleClose(1006, ""))
  }

  sendText(text) {
    if (this.closed) throw new WsError("socket closed")
    this.socket.write(encodeFrame(OP_TEXT, Buffer.from(String(text), "utf8")))
  }

  close(code = 1000, reason = "") {
    if (this.closed) return
    try {
      const body = Buffer.alloc(2 + Buffer.byteLength(reason))
      body.writeUInt16BE(code, 0)
      body.write(reason, 2, "utf8")
      this.socket.write(encodeFrame(OP_CLOSE, body))
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        this.socket.destroy()
      } catch {
        /* ignore */
      }
    }, 500)
  }

  _onData(chunk) {
    this._incoming = this._incoming.length ? Buffer.concat([this._incoming, chunk]) : chunk
    while (true) {
      const frame = tryDecodeFrame(this._incoming)
      if (!frame) return
      this._incoming = this._incoming.subarray(frame.consumed)
      this._dispatch(frame.opcode, frame.payload)
    }
  }

  _dispatch(opcode, payload) {
    if (opcode === OP_TEXT || opcode === OP_BINARY) {
      if (this._fragmented) this._fragmented = null
      this._emitMessage(opcode, payload)
      return
    }
    if (opcode === OP_CONT) {
      if (!this._fragmented) return
      this._fragmented.parts.push(payload)
      if (this._fragmented.fin) {
        const full = Buffer.concat(this._fragmented.parts)
        const op = this._fragmented.opcode
        this._fragmented = null
        this._emitMessage(op, full)
      }
      return
    }
    if (opcode === OP_PING) {
      try {
        this.socket.write(encodeFrame(OP_PONG, payload))
      } catch {
        /* ignore */
      }
      return
    }
    if (opcode === OP_PONG) return
    if (opcode === OP_CLOSE) {
      let code = 1000
      let reason = ""
      if (payload.length >= 2) {
        code = payload.readUInt16BE(0)
        reason = payload.subarray(2).toString("utf8")
      }
      try {
        this.socket.write(encodeFrame(OP_CLOSE, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.from([0x03, 0xe8])))
      } catch {
        /* ignore */
      }
      this._handleClose(code, reason)
    }
  }

  _emitMessage(opcode, payload) {
    const text = opcode === OP_TEXT ? payload.toString("utf8") : payload.toString("latin1")
    try {
      this.onMessage(text)
    } catch (err) {
      this.onError(err)
    }
  }

  _handleClose(code, reason) {
    if (this.closed) return
    this.closed = true
    try {
      this.socket.destroy()
    } catch {
      /* ignore */
    }
    this.onClose(code, reason)
  }
}

function encodeFrame(opcode, payload) {
  const len = payload.length
  const header = [0x80 | opcode] // FIN + opcode
  if (len < 126) {
    header.push(0x80 | len)
  } else if (len <= 0xffff) {
    header.push(0x80 | 126, (len >> 8) & 0xff, len & 0xff)
  } else {
    header.push(0x80 | 127)
    const big = BigInt(len)
    for (let i = 7; i >= 0; i--) header.push(Number((big >> BigInt(i * 8)) & 0xffn))
  }
  const hdrLen = header.length
  const mask = randomBytes(4)
  const out = Buffer.alloc(hdrLen + 4 + len)
  for (let i = 0; i < hdrLen; i++) out[i] = header[i]
  const payloadOffset = hdrLen + 4
  mask.copy(out, hdrLen)
  for (let i = 0; i < len; i++) out[payloadOffset + i] = payload[i] ^ mask[i % 4]
  return out
}

/** Returns { opcode, payload, consumed, fin } or null if more bytes are needed. */
function tryDecodeFrame(buf) {
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
    const big = buf.readBigUInt64BE(offset)
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new WsError("frame too large")
    len = Number(big)
    offset += 8
  }
  let mask
  if (masked) {
    if (buf.length < offset + 4) return null
    mask = buf.subarray(offset, offset + 4)
    offset += 4
  }
  if (buf.length < offset + len) return null
  let payload = buf.subarray(offset, offset + len)
  if (masked) {
    const unmasked = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ mask[i % 4]
    payload = unmasked
  }
  return { fin, opcode, payload, consumed: offset + len }
}

/** Open a WebSocket connection with custom headers. */
export function wsConnect(urlStr, { headers = {}, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(urlStr)
    } catch {
      reject(new WsError("invalid websocket url"))
      return
    }
    const isTls = url.protocol === "wss:"
    if (!isTls && url.protocol !== "ws:") {
      reject(new WsError(`unsupported protocol: ${url.protocol}`))
      return
    }
    const key = randomBytes(16).toString("base64")
    const lib = isTls ? https : http
    const port = url.port || (isTls ? 443 : 80)
    const req = lib.request({
      hostname: url.hostname,
      port,
      path: `${url.pathname || "/"}${url.search}`,
      method: "GET",
      timeout: timeoutMs,
      headers: {
        Host: url.host,
        Connection: "Upgrade",
        Upgrade: "websocket",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        ...headers
      }
    })

    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
      reject(err)
    }

    req.on("upgrade", (res, socket, head) => {
      if (settled) return
      const expected = createHash("sha1").update(key + GUID).digest("base64")
      if (String(res.headers["sec-websocket-accept"] ?? "") !== expected) {
        socket.destroy()
        fail(new WsError("websocket accept key mismatch"))
        return
      }
      settled = true
      const client = new WsClient(socket)
      if (head && head.length) {
        try {
          client._onData(head)
        } catch {
          /* handled below via onError */
        }
      }
      resolve(client)
    })

    req.on("response", (res) => {
      res.resume()
      fail(new WsError(`websocket upgrade rejected (HTTP ${res.statusCode})`))
    })
    req.on("error", (err) => fail(new WsError(err.message)))
    req.on("timeout", () => fail(new WsError("websocket connection timed out")))
    req.end()
  })
}
