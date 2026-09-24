/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { defineConfig, loadEnv } from "vite"
import { configDefaults } from "vitest/config"
import react from "@vitejs/plugin-react"
import { handleApi, isApiRequest, writeJson } from "./server/handlers.mjs"
import { startTradingHud } from "./server/services/tradingHud.mjs"
import { startLedger } from "./server/services/accuracyLedger.mjs"
import { initErrorLog } from "./server/errorLog.mjs"
import { runStartupHealth } from "./server/services/commandCentre/startupHealth.mjs"
import { startLivenessMonitor, startScheduler } from "./server/services/scheduler.mjs"

// ---------------------------------------------------------------------------
// T6 — build-time PWA shell precache.
//
// After `vite build` succeeds this plugin rewrites dist/sw.js (Vite copies the
// hand-written public/sw.js verbatim) so its two placeholder declarations become
// the real, versioned app-shell precache:
//   PICC_SHELL_VERSION = "picc-shell-v0.0.0"  -> "picc-shell-v<pkg version>"
//   PRECACHE_URLS = []                        -> every hashed dist/assets/* file
//                                                + index.html + manifest + icons
// Runs in closeBundle: by then the bundle AND the publicDir copy are on disk, so
// dist/sw.js is guaranteed readable regardless of Vite's internal plugin order.
// The SW only ever reads this list at install; runtime fetches are never cached.
// ---------------------------------------------------------------------------
function piccPrecachePlugin() {
  return {
    name: "picc-precache",
    apply: "build",
    closeBundle() {
      const distDir = fileURLToPath(new URL("./dist", import.meta.url))
      const urls: string[] = []
      const assetsDir = join(distDir, "assets")
      if (existsSync(assetsDir)) {
        for (const file of readdirSync(assetsDir).sort()) urls.push(`/assets/${file}`)
      }
      for (const root of ["/index.html", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"]) {
        if (existsSync(join(distDir, root.slice(1)))) urls.push(root)
      }
      const swPath = join(distDir, "sw.js")
      if (!existsSync(swPath)) {
        console.warn("[picc-precache] dist/sw.js missing — precache injection skipped")
        return
      }
      const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as { version: string }
      const cacheName = `picc-shell-v${pkg.version}`
      let sw = readFileSync(swPath, "utf8")
      sw = sw.replace(/var PICC_SHELL_VERSION = "[^"]*"/, `var PICC_SHELL_VERSION = "${cacheName}"`)
      sw = sw.replace(/var PRECACHE_URLS = \[[^\]]*\]/, `var PRECACHE_URLS = ${JSON.stringify(urls)}`)
      writeFileSync(swPath, sw)
      console.log(`[picc-precache] ${urls.length} shell assets cached under ${cacheName}`)
    }
  }
}

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
  // Boot validation is a first-class boot step for dev/e2e too, exactly as it is for the standalone
  // server in index.mjs. Without this the first GET performed the "boot" work and wrote the
  // audit:startup-health row lazily. Read-only and advisory — failures are logged, never fatal.
  runStartupHealth().catch((error) => {
    console.warn("[picc] startup health failed (advisory, boot continues):", error?.message ?? error)
  })
}

export default defineConfig(({ mode }) => {
  // Load ALL env vars (not just VITE_*) so the single PICC_ERROR_LOG flag
  // controls both the server file sink and the browser-side error capture.
  const allEnv = loadEnv(mode, fileURLToPath(new URL("./", import.meta.url)), "")
  return {
    plugins: [
      react(),
      piccPrecachePlugin(),
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
    // Vitest reads this file (it carries the `@` alias, so there is deliberately no separate
    // vitest.config.ts). The e2e/ specs are Playwright's, not Vitest's — without this exclusion
    // `npx vitest run` collects them too and the serial floor fails on a harness mismatch.
    test: {
      exclude: [...configDefaults.exclude, "**/e2e/**"]
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
