// A-6 grep-assert — pins the D1 clean break in the key modules. Reads the REAL
// sources from disk (not a stub), so a reintroduction of the extension era
// anywhere in the capture/feed/client seam fails the suite.
//
// Mirrors the MinistryRoom.studio absence pattern: the wiring was removed
// (slices A-1..A-5) and this file pins the absence so a future re-introduction
// without owner approval is caught at the test gate.
//
// NOT pinned (legit, non-PICC-extension uses of the word):
//   - Fibonacci "extensions"/"extensionRatios" in indicators.mjs / trading.ts /
//     AdvancedIndicatorsPanel.tsx (math levels, not a Chrome extension);
//   - the Automatad third-party note in streamCatalog.ts ("browser extension"
//     describing an external product);
//   - Chromium's own profile cache dir "extensions_crx_cache" in
//     browserBridge.mjs (the browser's directory name, not PICC's);
//   - feedMode.test.mjs "extension" strings — the INTENTIONAL legacy-coercion
//     test proving a stored "extension" preference degrades to "auto".
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Each pinned module must contain ZERO occurrences of the extension-era word
// or any live browser-extension / dead-bridge token.
const PINNED = {
  "services/liveEO.mjs": "../services/liveEO.mjs",
  "services/packObservers.mjs": "../services/packObservers.mjs",
  "services/packRunner.mjs": "../services/packRunner.mjs",
  "services/packRegistry.mjs": "../services/packRegistry.mjs",
  "services/scheduler.mjs": "../services/scheduler.mjs",
  "services/dataSources.mjs": "../services/dataSources.mjs",
  "services/autopilot.mjs": "../services/autopilot.mjs",
  "services/adaptiveConfluence.mjs": "../services/adaptiveConfluence.mjs",
  "services/captureProfiles.mjs": "../services/captureProfiles.mjs",
  "services/accountMetrics.mjs": "../services/accountMetrics.mjs",
  "services/assetCatalog.mjs": "../services/assetCatalog.mjs",
  "services/connectors.mjs": "../services/connectors.mjs",
  "services/sessionCaptureSettings.mjs": "../services/sessionCaptureSettings.mjs",
  "errorLog.mjs": "../errorLog.mjs",
  "handlers.mjs": "../handlers.mjs",
  "index.mjs": "../index.mjs",
  "prompts.mjs": "../services/prompts.mjs",
  "browserStudio.mjs": "../services/browserStudio.mjs",
  "src/lib/brokerLink.ts": "../../src/lib/brokerLink.ts",
  "src/lib/api.ts": "../../src/lib/api.ts",
  "src/hooks/useCandleData.ts": "../../src/hooks/useCandleData.ts",
  "src/pages/Settings.tsx": "../../src/pages/Settings.tsx",
  "src/components/TradingChart.tsx": "../../src/components/TradingChart.tsx",
  "src/lib/income.ts": "../../src/lib/income.ts",
  "src/lib/settings.ts": "../../src/lib/settings.ts"
}

const FORBIDDEN = [
  /chrome\.(runtime|storage|tabs|alarms|extension)/g,
  /content\.js/g,
  /__piccCommand/g,
  /extensionCaptureDisabled/g,
  /captureEnabled/g,
  /PICC extension/g,
  /extension kill-switch/g,
  /extension feed/g,
  /the extension/g
]

describe("D1 clean break — no extension-era references in key modules (A-6)", () => {
  it.each(Object.entries(PINNED))("%s is free of the word 'extension'", (label, rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    const matches = src.match(/extension/gi) ?? []
    expect(matches, `${label} must not mention the extension era (got: ${matches.join(", ") || "none"})`).toEqual([])
  })

  it.each(Object.entries(PINNED))("%s carries no live-extension / dead-bridge token", (label, rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    for (const re of FORBIDDEN) {
      const hits = src.match(re) ?? []
      expect(hits, `${label} must not contain ${re} (got: ${hits.join(", ") || "none"})`).toEqual([])
    }
  })
})