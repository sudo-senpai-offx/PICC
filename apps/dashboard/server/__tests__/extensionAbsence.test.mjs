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
//     browserBridge.mjs (the browser's directory name, not PICC's).
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// D2/AC-005: `services/liveEO.mjs` was a PINNED row here. WS-7 T2 deleted the
// module outright, so the row could no longer be READ from disk — reading it
// would throw ENOENT and fail the guard for a reason that has nothing to do
// with the extension era. Deleting the row would have silently REDUCED
// coverage, so the intent is instead PRESERVED and inverted: a dedicated
// assertion below proves the file is gone and that no surviving module
// re-imports it. Same guarantee, stated as an absence rather than a scan.
const DELETED_MODULES = {
  "services/liveEO.mjs": "../services/liveEO.mjs",
  "services/expertoption.mjs": "../services/expertoption.mjs",
  "services/brokers/expertoption.mjs": "../services/brokers/expertoption.mjs"
}

// Each pinned module must contain ZERO occurrences of the extension-era word
// or any live browser-extension / dead-bridge token.
const PINNED = {
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
  // D2/AC-005: the absence of the deleted EO/liveEO modules is the stronger
  // statement — a resurrected module cannot satisfy a grep-assert on a path
  // that no longer resolves, so pin the ABSENCE of the file itself.
  it.each(Object.entries(DELETED_MODULES))("%s is deleted and stays deleted", (label, rel) => {
    const abs = fileURLToPath(new URL(rel, import.meta.url))
    expect(existsSync(abs), `${label} must not exist on disk (WS-7 T2 removed it)`).toBe(false)
  })

  it("no pinned module re-imports a deleted EO/liveEO module", () => {
    // A deleted module that is still imported would fail at import time, not
    // at grep time — but pinning it here makes the failure legible and stops
    // the import from being quietly reintroduced behind an alias.
    const deadPaths = Object.values(DELETED_MODULES).map((rel) => rel.replace("../", ""))
    for (const [label, rel] of Object.entries(PINNED)) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
      for (const dead of deadPaths) {
        expect(src.includes(dead), `${label} must not import ${dead}`).toBe(false)
      }
    }
  })

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