/**
 * PICC upstream bridge — MAIN world WebSocket sniffer.
 *
 * Runs in the page's own JS world (world: "MAIN") on ExpertOption domains.
 * Wraps window.WebSocket so incoming JSON frames from the broker gateway are
 * relayed to the PICC content script via window.postMessage. The content
 * script batches them and pushes to the local PICC server, which folds them
 * into the same candle buffers the studio bridge feeds — making YOUR real
 * browser session the realtime source.
 *
 * Defensive by design: never throws into the page, never blocks frames,
 * silently no-ops when anything is unavailable.
 */
(() => {
  if (typeof WebSocket === "undefined") return
  const RELAY_KEY = "__piccEOFrame"
  // Only sniff sockets that talk to a broker gateway host — never touch other
  // sockets (analytics, support chat, etc).
  const EO_WS_RE = /expertoption\.(com|finance)/i

  let NativeWS = WebSocket
  try {
    class PatchedWebSocket extends NativeWS {
      constructor(url, protocols) {
        super(url, protocols)
        try {
          if (typeof url === "string" && EO_WS_RE.test(url)) this.__piccHook()
        } catch { /* never break construction */ }
      }

      __piccHook() {
        const ws = this
        const handle = (ev) => {
          try {
            if (typeof ev.data !== "string") return
            if (ev.data.length > 512 * 1024) return
            const parsed = JSON.parse(ev.data)
            if (parsed && typeof parsed === "object") {
              window.postMessage({ [RELAY_KEY]: true, frame: parsed }, "*")
            }
          } catch { /* non-JSON frame — ignore */ }
        }
        // Wrap addEventListener-based listeners AND the onmessage property so
        // either registration style is captured.
        const origAdd = ws.addEventListener.bind(ws)
        ws.addEventListener = function (type, listener, opts) {
          if (type === "message") {
            const wrapped = (ev) => { try { handle(ev) } catch { /* ignore */ } finally { listener.call(ws, ev) } }
            return origAdd(type, wrapped, opts)
          }
          return origAdd(type, listener, opts)
        }
        let userHandler = null
        Object.defineProperty(ws, "onmessage", {
          get: () => userHandler,
          set: (fn) => {
            userHandler = fn
            origAdd("message", (ev) => {
              try { handle(ev) } catch { /* ignore */ }
              if (typeof fn === "function") fn.call(ws, ev)
            })
          },
          configurable: true
        })
      }
    }
    // Preserve statics/constants so page code relying on them still works.
    // (The class prototype itself stays intact — it derives from NativeWS.)
    PatchedWebSocket.CONNECTING = NativeWS.CONNECTING
    PatchedWebSocket.OPEN = NativeWS.OPEN
    PatchedWebSocket.CLOSING = NativeWS.CLOSING
    PatchedWebSocket.CLOSED = NativeWS.CLOSED
    Object.defineProperty(window, "WebSocket", { value: PatchedWebSocket, configurable: true, writable: true })
  } catch { /* keep native WebSocket — degrade to no upstream feed */ }
})()
