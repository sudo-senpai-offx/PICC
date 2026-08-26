// Phase B wiring: /api/notifications/* routes + Signal Engine boot.
import { readFileSync, writeFileSync } from "node:fs"

function patch(p, fn) {
  let s = readFileSync(p, "utf8").replace(/\r\n/g, "\n")
  const out = fn(s)
  if (out === s) console.log("no-op", p)
  else { writeFileSync(p, out); console.log("patched", p) }
}

// ── handlers.mjs — notification routes (before the brokers route block) ────
patch("server/handlers.mjs", (s) => {
  const anchor = '  // ── Broker adapter registry — plug-and-play venue status ──────────────'
  if (!s.includes(anchor)) throw new Error("anchor missing")
  const routes = `  // ── Notifications — universal attention layer (advisory signals) ──────
  if (path.startsWith("/api/notifications")) {
    try {
      const n = await import("./services/notifier.mjs")
      if (path === "/api/notifications/status" && req.method === "GET") {
        writeJson(res, 200, n.notifierStatus())
        return true
      }
      if (path === "/api/notifications/prefs" && req.method === "POST") {
        writeJson(res, 200, { ok: true, prefs: n.setPrefs(body) })
        return true
      }
      if (path === "/api/notifications/subscribe-push" && req.method === "POST") {
        if (!body?.endpoint) return writeJson(res, 400, { ok: false, error: "subscription endpoint required" })
        writeJson(res, 200, { ok: n.addPushSubscription(body), subscriptions: n.listPushSubscriptions() })
        return true
      }
      if (path === "/api/notifications/test" && req.method === "POST") {
        const rec = await n.dispatchAlert({
          kind: "TEST",
          assetId: String(body?.assetId ?? "TEST"),
          title: "🔔 PICC test notification",
          body: "If you can read this on any channel, the advisory pipeline is wired end-to-end."
        })
        writeJson(res, 200, { ok: true, record: rec })
        return true
      }
    } catch (err) {
      writeJson(res, 500, { ok: false, error: err.message })
      return true
    }
  }

${anchor}`
  return s.replace(anchor, routes)
})

// ── index.mjs — start/stop the engine with the server lifecycle ─────────────
patch("server/index.mjs", (s) => {
  s = s.replace(
    'import { initErrorLog } from "./errorLog.mjs"',
    'import { initErrorLog } from "./errorLog.mjs"\nimport { startSignalEngine, stopSignalEngine } from "./services/signalEngine.mjs"'
  )
  s = s.replace(
    'server.listen(PORT, "127.0.0.1", () => {',
    `// Advisory Signal Engine replaces the deprecated execution autopilot.
  startSignalEngine()
  server.listen(PORT, "127.0.0.1", () => {`
  )
  s = s.replace(
    'async function gracefulShutdown(signal) {\n    if (shuttingDown) return',
    'async function gracefulShutdown(signal) {\n    if (shuttingDown) return\n    try { stopSignalEngine() } catch { /* best effort */ }'
  )
  return s
})
console.log("done")
