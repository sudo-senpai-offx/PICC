import { afterEach, describe, expect, it } from "vitest"
import { resolvePerf } from "../services/browserStudio.mjs"

const prev = { perf: process.env.PICC_BROWSER_PERF, fps: process.env.PICC_BROWSER_FPS }

afterEach(() => {
  process.env.PICC_BROWSER_PERF = prev.perf
  process.env.PICC_BROWSER_FPS = prev.fps
})

describe("browser perf profile resolver", () => {
  it("honors an explicit low env profile", () => {
    process.env.PICC_BROWSER_PERF = "low"
    const p = resolvePerf({})
    expect(p.mode).toBe("low")
    expect(p.auto).toBe(false)
    expect(p.captureFps).toBe(8)
    expect(p.idleFps).toBe(2)
    expect(p.quality).toBe(40)
  })

  it("honors an explicit high env profile", () => {
    process.env.PICC_BROWSER_PERF = "high"
    const p = resolvePerf({})
    expect(p.mode).toBe("high")
    expect(p.captureFps).toBe(20)
    expect(p.idleFps).toBe(5)
    expect(p.quality).toBe(62)
  })

  it("prefers the settings profile when env is auto", () => {
    process.env.PICC_BROWSER_PERF = "auto"
    const p = resolvePerf({ perfMode: "medium" })
    expect(p.mode).toBe("medium")
    expect(p.captureFps).toBe(12)
  })

  it("env overrides the settings profile", () => {
    process.env.PICC_BROWSER_PERF = "low"
    const p = resolvePerf({ perfMode: "high" })
    expect(p.mode).toBe("low")
  })

  it("auto resolves to a real profile on this host", () => {
    process.env.PICC_BROWSER_PERF = "auto"
    const p = resolvePerf({})
    expect(["low", "medium", "high"]).toContain(p.mode)
    expect(p.auto).toBe(true)
    expect(p.captureFps).toBeGreaterThan(0)
  })

  it("PICC_BROWSER_FPS overrides the capture rate and clamps idle", () => {
    process.env.PICC_BROWSER_PERF = "high"
    process.env.PICC_BROWSER_FPS = "5"
    const p = resolvePerf({})
    expect(p.captureFps).toBe(5)
    expect(p.idleFps).toBe(5) // clamped to the forced capture rate
  })

  it("unknown perf mode falls back to auto without crashing", () => {
    process.env.PICC_BROWSER_PERF = "extreme"
    const p = resolvePerf({})
    expect(["low", "medium", "high"]).toContain(p.mode)
    expect(p.auto).toBe(true)
  })
})
