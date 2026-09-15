import { fileURLToPath, URL } from "node:url"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import { handleApi, isApiRequest, writeJson } from "./server/handlers.mjs"
import { startTradingHud } from "./server/services/tradingHud.mjs"
import { startLedger } from "./server/services/accuracyLedger.mjs"
import { initErrorLog } from "./server/errorLog.mjs"
import { startLivenessMonitor, startScheduler } from "./server/services/scheduler.mjs"

startTradingHud()
startLedger()

// Dev launch counts as a launch: empty + rewrite the root-level error log and
// install the server-side error hooks (gated by PICC_ERROR_LOG in .env).
// Skipped under vitest — tests must not rewrite the real session log.
if (!process.env.VITEST) {
  initErrorLog()
  // Dev mode is a first-class boot: without this the scheduler registers its
  // jobs but NEVER runs them (index.mjs does this for the standalone entry,
  // vite dev was missing it) — ccxt equity polling, EO staleness/liveness,
  // headless session refresh and paper marking all silently stay dormant.
  // Liveness monitor FIRST: it registers the eo-liveness job, and jobs added
  // after startScheduler() never get an interval.
  startLivenessMonitor()
  startScheduler()
}

export default defineConfig(({ mode }) => {
  // Load ALL env vars (not just VITE_*) so the single PICC_ERROR_LOG flag
  // controls both the server file sink and the browser-side error capture.
  const allEnv = loadEnv(mode, fileURLToPath(new URL("./", import.meta.url)), "")
  return {
    plugins: [
      react(),
      {
        name: "picc-api-dev-server",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = req.url ?? "/"
            if (req.method === "OPTIONS") {
              writeJson(res, 200, {})
              return
            }
            if (isApiRequest(url)) {
              try {
                await handleApi(req, res, url)
              } catch (err) {
                console.error("[picc-api] error:", err)
                writeJson(res, 500, { error: "internal error" })
              }
              return
            }
            next()
          })
        }
      }
    ],
    define: {
      __PICC_ERROR_LOG__: JSON.stringify(allEnv.PICC_ERROR_LOG === "1")
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    server: {
      port: 5173,
      strictPort: true,
      watch: {
        // The Browser Studio's real-Chromium profile dir holds SQLite/DB files
        // that are locked by the running browser — never let Vite watch them.
        ignored: [
          fileURLToPath(new URL("./server/data", import.meta.url))
        ]
      }
    }
  }
})
