import { defineConfig } from "@playwright/test"
import isolatedEnv, { assertIsolatedEnv, ISOLATION_TMP_ROOT } from "./e2e/helpers/isolatedEnv.mjs"

const baseURL = "http://127.0.0.1:5173"

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
