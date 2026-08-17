import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { handleApi, isApiRequest, writeJson } from "./server/handlers.mjs"
import { startTradingHud } from "./server/services/tradingHud.mjs"
import { startLedger } from "./server/services/accuracyLedger.mjs"

startTradingHud()
startLedger()

export default defineConfig({
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
})
