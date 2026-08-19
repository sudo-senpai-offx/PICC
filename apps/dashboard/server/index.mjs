// Production server for the PICC dashboard.
// Serves the built SPA from dist/ plus the /api/extension/* endpoints.
// Zero dependencies: `node server/index.mjs`
import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { isApiRequest, handleApi, writeJson } from "./handlers.mjs"
import { startScheduler } from "./services/scheduler.mjs"
import { startLedger } from "./services/accuracyLedger.mjs"

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
      writeJson(res, 500, { error: "internal error" })
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
  process.on("unhandledRejection", (reason) => {
    console.error("[picc-server] unhandledRejection:", reason)
  })

  let shuttingDown = false
  async function gracefulShutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[picc-server] ${signal} received — shutting down gracefully...`)

    const shutdownFns = []
    try {
      const { stopAutopilot } = await import("./services/autopilot.mjs")
      shutdownFns.push(() => stopAutopilot("server shutdown"))
    } catch { /* optional */ }
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
      console.log("[picc-server] HTTP server closed")
      process.exit(0)
    })

    setTimeout(() => {
      console.warn("[picc-server] forced exit after timeout")
      process.exit(1)
    }, 5000).unref()
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
  process.on("SIGINT", () => gracefulShutdown("SIGINT"))

  server.listen(PORT, () => {
    console.log(`PICC dashboard + API serving dist/ on http://localhost:${PORT}`)
    if (startScheduler()) {
      console.log("[picc-scheduler] started")
    }
    startLedger()
    console.log("[picc-accuracy-ledger] auto-resolving trading decisions")
  })
}
