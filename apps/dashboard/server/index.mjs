// Production server for the PICC dashboard.
// Serves the built SPA from dist/ plus the /api/extension/* endpoints.
// Zero dependencies: `node server/index.mjs`
import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { isApiRequest, handleApi, writeJson } from "./handlers.mjs"
import { startScheduler, startLivenessMonitor } from "./services/scheduler.mjs"
import { startLedger } from "./services/accuracyLedger.mjs"
import { log } from "./logger.mjs"
import { initErrorLog } from "./errorLog.mjs"
import { startSignalEngine, stopSignalEngine } from "./services/signalEngine.mjs"
import { loadBrokers } from "./services/marketDataBus.mjs"

const ROOT = process.env.PICC_DIST_DIR || fileURLToPath(new URL("../dist", import.meta.url))
const PORT = Number(process.env.PORT ?? 3000)

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
}

export function resolveStatic(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "")
  const filePath = normalize(join(ROOT, rel))
  const rootWithSep = ROOT.endsWith(sep) ? ROOT : ROOT + sep
  return filePath === ROOT || filePath.startsWith(rootWithSep) ? filePath : null
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/"
  if (req.method === "OPTIONS") {
    writeJson(res, 200, {})
    return
  }
  if (isApiRequest(url)) {
    try {
      await handleApi(req, res, url)
    } catch (err) {
      console.error("[picc-server] API error:", err)
      log.error("API error", { error: err.message })
      // Only attempt the 500 when nothing was written — writing after headers
      // throws ERR_HTTP_HEADERS_SENT and escalates a handled error into a crash.
      if (!res.headersSent) writeJson(res, 500, { error: "internal error" })
      else try { res.end() } catch { /* socket gone */ }
    }
    return
  }

  const filePath = resolveStatic(url)
  if (!filePath) {
    writeJson(res, 404, { error: "Not found" })
    return
  }
  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error("not a file")
    const body = await readFile(filePath)
    const isHashedAsset = /-[A-Za-z0-9]{8}\.(js|css)$/.test(filePath)
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": isHashedAsset ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate"
    })
    res.end(body)
  } catch {
    try {
      const body = await readFile(join(ROOT, "index.html"))
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(body)
    } catch {
      writeJson(res, 500, { error: "dist not built — run `npm run build` first" })
    }
  }
})

if (!process.env.PICC_NO_LISTEN) {
  // Root-level error log: emptied + rewritten on every launch, then captures
  // every server-side error (console.error/warn, crashes, rejections).
  initErrorLog()
  process.on("unhandledRejection", (reason) => {
    console.error("[picc-server] unhandledRejection:", reason)
  })
  // Last-resort guard: an uncaught exception in a request listener would
  // otherwise take down the whole dashboard (autopilot + scheduler with it).
  process.on("uncaughtException", (err) => {
    console.error("[picc-server] uncaughtException:", err)
    log.error("uncaughtException", { error: err?.message, stack: err?.stack })
  })

  let shuttingDown = false
  async function gracefulShutdown(signal) {
    if (shuttingDown) return
    try { stopSignalEngine() } catch { /* best effort */ }
    shuttingDown = true
    console.log(`[picc-server] ${signal} received — shutting down gracefully...`)
    log.info("shutdown initiated", { signal })

    const shutdownFns = []
        try {
      const { stopDecisionEngine } = await import("./services/adaptiveConfluence.mjs")
      shutdownFns.push(stopDecisionEngine)
    } catch { /* optional */ }
    try {
      const { stopLiveEO } = await import("./services/liveEO.mjs")
      shutdownFns.push(stopLiveEO)
    } catch { /* optional */ }
    try {
      const { stopStudioAutomation } = await import("./services/browserStudio.mjs")
      shutdownFns.push(stopStudioAutomation)
    } catch { /* optional */ }
    try {
      const { stopWorkflow } = await import("./services/interventions.mjs")
      shutdownFns.push(stopWorkflow)
    } catch { /* optional */ }

    for (const fn of shutdownFns) {
      try { await fn() } catch { /* best effort */ }
    }

    server.close(() => {
      log.info("HTTP server closed")
      process.exit(0)
    })

    setTimeout(() => {
      console.warn("[picc-server] forced exit after timeout")
      process.exit(1)
    }, 5000).unref()
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
  process.on("SIGINT", () => gracefulShutdown("SIGINT"))

  // Bind loopback explicitly. The auth model trusts "not-localhost needs a
  // token", so binding all interfaces would hand LAN neighbors (and any
  // tunnel forwarder, which connects from 127.0.0.1) an unauthenticated
  // control plane.
  // Advisory Signal Engine replaces the deprecated execution autopilot.
  // Broker registry must load BEFORE the signal engine and decision engine,
  // as they depend on getBrokerData/getBestCandles.
  await loadBrokers()
  log.info("broker registry loaded")
  startSignalEngine()
  server.listen(PORT, "127.0.0.1", () => {
    log.info("server started", { port: PORT, host: "127.0.0.1", dist: ROOT })
    // Register the liveness/uptime monitor BEFORE the scheduler starts —
    // jobs registered after startScheduler() never get an interval.
    startLivenessMonitor()
    if (startScheduler()) {
      console.log("[picc-scheduler] started")
    }
    startLedger()
    console.log("[picc-accuracy-ledger] auto-resolving trading decisions")
        import("./services/adaptiveConfluence.mjs").then(({ startDecisionEngine }) => {
      startDecisionEngine()
      console.log("[picc-decision-engine] started — AI signals + liveEO active")
    }).catch(() => {})
  })
}
