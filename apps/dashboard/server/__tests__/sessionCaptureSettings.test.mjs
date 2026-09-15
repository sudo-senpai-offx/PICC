import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  sessionCaptureEnabled,
  saveSessionCaptureSetting,
  sessionCaptureSettingsView,
  _setSessionCaptureFile,
  _resetSessionCaptureCache
} from "../services/sessionCaptureSettings.mjs"

let tmp

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "picc-scsetting-"))
  _setSessionCaptureFile(join(tmp, "session-capture-settings.json"))
})

afterAll(() => {
  _resetSessionCaptureCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe("sessionCaptureSettings store", () => {
  it("defaults to enabled when the file is absent (kill-switch unset = allowed)", () => {
    expect(sessionCaptureEnabled()).toBe(true)
    const view = sessionCaptureSettingsView()
    expect(view).toEqual({ enabled: true, configured: false })
  })

  it("persists a disabled setting and reads it back", () => {
    saveSessionCaptureSetting(false)
    expect(sessionCaptureEnabled()).toBe(false)
    expect(sessionCaptureSettingsView()).toEqual({ enabled: false, configured: true })
  })

  it("persists re-enabling after a disable", () => {
    saveSessionCaptureSetting(true)
    expect(sessionCaptureEnabled()).toBe(true)
    expect(sessionCaptureSettingsView()).toEqual({ enabled: true, configured: true })
  })

  it("rejects non-boolean input (never stores junk)", () => {
    // @ts-expect-error exercising the runtime guard
    expect(() => saveSessionCaptureSetting("nope")).toThrow(/boolean/)
    expect(sessionCaptureEnabled()).toBe(true)
  })

  it("writes a JSON file on disk", () => {
    saveSessionCaptureSetting(false)
    const raw = JSON.parse(readFileSync(join(tmp, "session-capture-settings.json"), "utf8"))
    expect(raw).toEqual({ enabled: false })
  })
})