import { describe, expect, it } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, dirname } from "node:path"

/**
 * Extension-level smoke checks — Phase C sensor edition. The extension is a
 * PASSIVE market-data relay now: no overlay, no dockables, no automation.
 * These tests lock that contract in place.
 */

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../extensions/picc-overlay")

describe("sensor extension integrity", () => {
  it("manifest content scripts exist on disk", () => {
    const manifest = JSON.parse(readFileSync(join(EXT_DIR, "manifest.json"), "utf8"))
    expect(manifest.manifest_version).toBe(3)
    const files = []
    for (const cs of manifest.content_scripts ?? []) files.push(...cs.js)
    if (manifest.background?.service_worker) files.push(manifest.background.service_worker)
    if (manifest.action?.default_popup) files.push(manifest.action.default_popup)
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

  it("no overlay-era content ships anymore", () => {
    const manifest = JSON.parse(readFileSync(join(EXT_DIR, "manifest.json"), "utf8"))
    const js = (manifest.content_scripts ?? []).flatMap((cs) => cs.js)
    expect(js).not.toContain("autopilotPanel.js")
    expect(manifest.side_panel).toBeUndefined()
    expect(manifest.permissions ?? []).not.toContain("cookies")
    expect(manifest.permissions ?? []).not.toContain("downloads")

    const src = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    // Dockables/automation vocabulary must be gone from the sensor.
    for (const gone of ["SUITE_DOCKABLE_PRESETS", "createDockable", "data-picc-action", "shadowRoot.attachShadow"]) {
      expect(src.includes(gone), `content.js must not contain ${gone}`).toBe(false)
    }
  })

  it("sensor keeps the exact upstream relay contract", () => {
    const src = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    // inject.js hands frames over under this marker — the relay MUST keep it.
    expect(src.includes("__piccEOFrame")).toBe(true)
    expect(src.includes("/api/extension/ingest")).toBe(true)
    // Hostile-input guard survives refactors.
    expect(src.includes("sanitizeUpstreamFrame")).toBe(true)
    expect(src.includes("JSON.stringify(clean).length > 4096")).toBe(true)
    // Queue caps + user kill-switch.
    expect(src.includes("> 400")).toBe(true)
    expect(src.includes("piccRelayEnabled")).toBe(true)
  })

  it("popup is a connection/config surface, not an execution surface", () => {
    const popup = readFileSync(join(EXT_DIR, "popup.js"), "utf8")
    expect(popup.includes("piccSensorStatus")).toBe(true)
    expect(popup.includes("backendUrl")).toBe(true)
    for (const gone of ["autopilot", "buyOption", "/api/trading/demo/place"]) {
      expect(popup.toLowerCase().includes(gone.toLowerCase()), `popup must not contain ${gone}`).toBe(false)
    }
  })
})
