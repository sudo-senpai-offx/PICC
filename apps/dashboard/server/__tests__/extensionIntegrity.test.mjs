import { describe, expect, it } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, dirname } from "node:path"

/**
 * Extension-level smoke checks (Phase 1 exit criteria, kept cheap and
 * dependency-free): the manifest references only real files, the canonical
 * extension is self-consistent, and the dockable presets in the overlay
 * match the dashboard's copy so both UIs advertise the same suite.
 */

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../extensions/picc-overlay")

function extractPresetIds(source) {
  const block = source.match(/SUITE_DOCKABLE_PRESETS\s*=\s*\{[\s\S]*?\n  \}/)
  expect(block, "SUITE_DOCKABLE_PRESETS block found in content.js").toBeTruthy()
  const ids = {}
  for (const m of block[0].matchAll(/id:\s*"([a-z0-9-]+)"/g)) {
    ;(ids.__all ??= []).push(m[1])
  }
  // Per-suite lists: trading is the one the dashboard mirrors.
  const tradingMatch = block[0].match(/trading:\s*\[([\s\S]*?)\]/)
  expect(tradingMatch, "trading preset list found").toBeTruthy()
  ids.trading = [...tradingMatch[1].matchAll(/id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1])
  return ids
}

describe("canonical extension integrity", () => {
  it("manifest content scripts exist on disk", () => {
    const manifest = JSON.parse(readFileSync(join(EXT_DIR, "manifest.json"), "utf8"))
    expect(manifest.manifest_version).toBe(3)
    const files = []
    for (const cs of manifest.content_scripts ?? []) files.push(...cs.js)
    if (manifest.background?.service_worker) files.push(manifest.background.service_worker)
    if (manifest.action?.default_popup) files.push(manifest.action.default_popup)
    if (manifest.side_panel?.default_path) files.push(manifest.side_panel.default_path)
    for (const f of files) {
      expect(existsSync(join(EXT_DIR, f)), `${f} exists`).toBe(true)
    }
  })

  it("MAIN-world sniffer is registered only on broker domains", () => {
    const manifest = JSON.parse(readFileSync(join(EXT_DIR, "manifest.json"), "utf8"))
    const main = (manifest.content_scripts ?? []).find((cs) => cs.world === "MAIN")
    expect(main).toBeTruthy()
    expect(main.run_at).toBe("document_start")
    for (const pat of main.matches) {
      expect(pat).toMatch(/expertoption/)
      expect(pat).not.toBe("*://*/*")
    }
  })

  it("overlay presets expose the full trading suite", () => {
    const src = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    const presets = extractPresetIds(src)
    for (const id of [
      "price-ticker",
      "positions",
      "portfolio",
      "ai-signals",
      "risk-mgr",
      "autopilot",
      "kelly-sizing",
      "regime-detect",
      "order-flow",
      "expiry-opt",
      "sentiment",
      "calibration",
      "server-status",
      "data-sources"
    ]) {
      expect(presets.trading, `trading preset includes ${id}`).toContain(id)
    }
  })

  it("dashboard overlaySettings mirror the same trading dockables", () => {
    const src = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    const extIds = extractPresetIds(src).trading
    // Parse the dashboard copy by regex â€” keeps this test loader-agnostic.
    const tsSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/lib/overlaySettings.ts"), "utf8")
    const block = tsSrc.match(/trading:\s*\[([\s\S]*?)\]/)
    expect(block, "overlaySettings.ts trading preset list found").toBeTruthy()
    const webIds = [...block[1].matchAll(/id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1])
    expect(webIds.sort()).toEqual([...extIds].sort())
  })

  it("no behavioral-camouflage defaults leaked into the extension", () => {
    const src = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    // The upstream bridge must relay real frames only â€” no synthetic frame
    // generation, no timing-jitter helpers.
    expect(src).not.toMatch(/syntheticMouse|jitterClick|fakeMove|humanizeInput/i)
  })
})
