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
    // The ingest POST lives in the WORKER (host-permission-exempt): a
    // content-script fetch to http://localhost from an https broker page dies
    // on CORS + mixed content (T11 finding 2026-08-29), so content.js must
    // NEVER fetch the ingest URL itself — it tunnels batches via relay-flush.
    expect(src.includes("/api/extension/ingest")).toBe(false)
    expect(src.includes('action: "relay-flush"')).toBe(true)
    const bg = readFileSync(join(EXT_DIR, "background.js"), "utf8")
    expect(bg.includes("/api/extension/ingest")).toBe(true)
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

  it("sensor is read-only by construction — zero DOM MUTATION, one auditable read (T9/T13 lock)", () => {
    const src = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    for (const forbidden of [
      "MutationObserver",
      "createElement",
      "insertAdjacentHTML",
      ".innerHTML",
      "appendChild"
    ]) {
      expect(src.includes(forbidden), `content.js must not mutate the page DOM via ${forbidden}`).toBe(false)
    }
    // T13: the ONLY page-DATA `document.` reads in executable code are the two
    // auditable ones below: document.cookie inside readStoredKeys — the
    // venue-session scan's single data read (querySelector, getElementById,
    // addEventListener, … all fail this lock) — and document.visibilityState,
    // the sensor's single BROWSER-STATE read used to decide "this venue tab
    // became visible, re-observe" under the per-stream cadence. Both are pinned
    // PRESENT here and nothing else may touch the document. That keeps the
    // sensor's page surface to exactly one data read and one state read.
    // Comments are stripped first so prose may name the API.
    const codeOnly = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
    const reads = codeOnly.split("document.")
    expect(reads.length, "exactly two document. occurrences in executable code").toBe(3)
    expect(reads[1].startsWith("cookie")).toBe(true)
    expect(reads[2].startsWith("visibilityState")).toBe(true)
    // The ONLY page-global writes are the idempotent load guard and the dead marker.
    expect(src.includes("window.__PICC_SENSOR__ = true")).toBe(true)
  })

  it("__PICC_SENSOR_DEAD__ marker exists (forbidden-access contract, T9 lock)", () => {
    const src = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    // A dead content-script context must announce itself this way — anything
    // that drops or renames the marker breaks the popup's "n/a" honesty path.
    expect(src.includes("window.__PICC_SENSOR_DEAD__ = true")).toBe(true)
    // ...and it is set inside teardown() before the timers are cleared.
    const teardown = src.slice(src.indexOf("function teardown") || 0, src.indexOf("const store"))
    expect(teardown.includes("window.__PICC_SENSOR_DEAD__ = true")).toBe(true)
  })

  it("every chrome.* call in the sensor goes through chromeGuard (T9 lock)", () => {
    const src = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    const lines = src.split("\n").map((l) => l.trim())

    // chrome.storage may exist ONLY inside the `store` helper — which wraps
    // each call in chromeGuard. A raw chrome.storage call anywhere else in the
    // sensor fails this (T9 acceptance: deliberate violation must not pass).
    const storageHits = lines.filter((l) => l.includes("chrome.storage"))
    expect(storageHits).toHaveLength(2)
    for (const hit of storageHits) {
      expect(/^(set|get)\(/.test(hit), `chrome.storage only via store helper: ${hit}`).toBe(true)
    }

    // Every chrome.runtime line must be the guard-wrapped register or the
    // guard's own pre-check. Un-guarded chrome.runtime use fails this.
    // (Line-comments are stripped first — prose may name the API.)
    const codeLines = lines.filter((l) => !l.startsWith("//") && !l.startsWith("*"))
    const runtimeLines = codeLines.filter((l) => l.includes("chrome.runtime"))
    expect(runtimeLines.length).toBeGreaterThan(0)
    for (const line of runtimeLines) {
      const guarded = line.includes("chromeGuard(") || line.includes("chrome?.runtime?.id")
      expect(guarded, `raw chrome.runtime outside the guard: ${line}`).toBe(true)
    }

    // No other chrome.* surface may appear in the page-context sensor.
    for (const api of ["chrome.tabs", "chrome.alarms", "chrome.windows", "chrome.action", "chrome.scripting"]) {
      expect(src.includes(api), `content.js must not use ${api}`).toBe(false)
    }
  })

  it("every message action is sent by someone and handled — popup ∪ content scripts, actions pinned (T9 lock)", () => {
    const popup = readFileSync(join(EXT_DIR, "popup.js"), "utf8")
    const background = readFileSync(join(EXT_DIR, "background.js"), "utf8")
    const content = readFileSync(join(EXT_DIR, "content.js"), "utf8")

    // Both sender contexts: the popup AND the sensor content scripts message
    // the worker (server-status probe + relay-flush tunnel — T11 2026-08-29).
    // The worker ALSO messages content scripts via chrome.tabs.sendMessage
    // (sensor-queue-depth round-trip; venue-scan-now cadence ping) — that send
    // surface is captured too so the vocabulary stays symmetric.
    const ACTION_RE = /chrome\.runtime\.sendMessage\(\s*\{\s*action:\s*"([^"]+)"/g
    const TABS_SEND_RE = /chrome\.tabs\.sendMessage\([^)]*\{\s*action:\s*"([^"]+)"/g
    const sends = new Set([
      ...[...popup.matchAll(ACTION_RE)].map((m) => m[1]),
      ...[...content.matchAll(ACTION_RE)].map((m) => m[1]),
      ...[...background.matchAll(TABS_SEND_RE)].map((m) => m[1])
    ])
    const bgHandlers = new Set(
      [...background.matchAll(/msg\.action\s*===\s*"([^"]+)"/g)].map((m) => m[1])
    )
    const contentHandlers = new Set(
      [...content.matchAll(/msg\.action\s*===\s*"([^"]+)"/g)].map((m) => m[1])
    )
    // Background forwards popup actions to the tab; content answers them.
    // Union = what can actually be answered. Contract: symmetric with sends.
    const allHandlers = new Set([...bgHandlers, ...contentHandlers])

    expect(sends.size).toBeGreaterThan(0)
    expect(sends.size, "no orphan sends (every send has a handler)").toBe(allHandlers.size)
    for (const action of sends) {
      expect(allHandlers.has(action), `${action} is sent but nobody handles it`).toBe(true)
    }
    for (const action of allHandlers) {
      expect(sends.has(action), `handler ${action} is unreachable from any sender`).toBe(true)
    }
    // The full action vocabulary, pinned — adding an action must touch every side.
    expect([...sends].sort()).toEqual([
      "capture-profiles", "capture-session", "open-broker-tab", "relay-flush", "sensor-queue-depth", "server-status", "venue-scan-now"
    ])
  })

  it("T8 locks the __piccCommand bridge: single-action intake, https-only url, truthful ack", () => {
    const src = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    // The dashboard (T6) posts commands under __piccCommand and waits for a
    // __piccCommandAck — without the ack it falls back to a new tab (double-open).
    expect(src.includes("__piccCommand")).toBe(true)
    expect(src.includes("__piccCommandAck")).toBe(true)
    // Single-action whitelist: only open-broker-tab is honored (any script can
    // forge a marker; unknown actions must be ignored, not acked).
    expect(src.includes('cmd.action !== "open-broker-tab"')).toBe(true)
    // The command URL is re-validated as http(s) INSIDE content.js (defense in
    // depth — the dashboard already validates, but the bridge runs on every page).
    expect(src.includes("/^https?:\\/\\//i")).toBe(true)
    // The ack carries venueId + ok so the dashboard settles (or falls back).
    expect(src.includes("__piccCommandAck: { venueId: clean.venueId, ok")).toBe(true)
  })

  it("T13 vault-rule guard: the venue session token is TRANSIENT — never a chrome.storage value", () => {
    const bg = readFileSync(join(EXT_DIR, "background.js"), "utf8")
    const content = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    // The capture leg adds NO storage surface: the worker's chrome.storage CALL
    // count is pinned (heartbeat + port + install + headless-status mirror +
    // auth read) once comments are stripped (prose may name the API). An
    // observation stored is an observation that can leak to any extension
    // context / UI — the token rides content→worker→server only.
    const bgCodeOnly = bg.replace(/\/\/[^\n]*/g, "")
    const bgStorageCalls = bgCodeOnly.match(/chrome\.storage/g) ?? []
    expect(bgStorageCalls.length).toBe(7)
    // The scanner keeps exactly the two guard-wrapped `store` helper hits that
    // the chromeGuard lock above pins (set/get) — the observed token never
    // enters extension storage by any route.
    expect(content.includes("piccSessionCapture")).toBe(true) // user kill-switch, defaults ON
  })

  it("T13 parity: the built-in EO scan config equals the served capture-profiles entry", async () => {
    const content = readFileSync(join(EXT_DIR, "content.js"), "utf8")
    const { extensionCaptureConfigs } = await import("../services/captureProfiles.mjs")
    const served = extensionCaptureConfigs().find((v) => v.venueId === "expertoption")
    expect(served).toBeTruthy()
    // The built-in fallback (used when the web app is absent) must be the
    // server config verbatim — drift on either side breaks the honesty of
    // extension-only mode. hostRe is compared after evaluating the JS-string
    // escape (the built-in source may spell \. or \\. — both evaluate to the
    // same regex source the server serves).
    const jsStringValue = (s) => s.replace(/\\\\/g, "\\")
    expect(jsStringValue(content).includes(`hostRe: "${served.hostRe}"`)).toBe(true)
    expect(served.via).toBe("liveEO")
    for (const line of [
      '{ type: "cookie", key: "token" }',
      '{ type: "cookie", key: "tokenDemo" }',
      '{ type: "localStorage", key: "token" }',
      '{ type: "sessionStorage", key: "token" }',
      'via: "liveEO"',
      'profileKeys: "user|account|profile|auth|session|current|me$|identity"'
    ]) {
      expect(content.includes(line), `built-in EO mirror keeps: ${line}`).toBe(true)
    }
    // The liveEO shape-scan is the extension twin of captureExpertOptionSession's
    // in-page matcher (browserStudio.mjs:3606-3618) — the three value-shape
    // patterns must stay present and identical so key-name drift can never
    // silence the scanner.
    for (const pat of [
      "/^[0-9a-f]{32}$/",
      "/([0-9a-f]{32})$/",
      "/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}::[A-Za-z0-9+/=_\\-]+$/"
    ]) {
      expect(jsStringValue(content).includes(pat), `shape-scan pattern kept: ${pat}`).toBe(true)
    }
    expect(served.keys.map((k) => `${k.type}:${k.key}`)).toEqual([
      "cookie:token", "cookie:tokenDemo", "localStorage:token", "sessionStorage:token"
    ])
    expect(served.profileKeys).toBe("user|account|profile|auth|session|current|me$|identity")
  })
})
