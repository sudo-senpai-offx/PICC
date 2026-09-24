import { defineConfig } from "@playwright/test"
import isolatedEnv, { assertIsolatedEnv, ISOLATION_TMP_ROOT } from "./e2e/helpers/isolatedEnv.mjs"

// vite.config.ts sets port 5173 + strictPort but no `host`, so the dev server binds to
// `localhost` (IPv6 ::1 on Windows). Probing 127.0.0.1 gets ECONNREFUSED — verified, not assumed.
const baseURL = "http://localhost:5173"

assertIsolatedEnv(isolatedEnv, ISOLATION_TMP_ROOT)

export default defineConfig({
  testDir: "e2e/",
  workers: 1,
  use: {
    baseURL
  },
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: false,
    env: isolatedEnv
  }
})
