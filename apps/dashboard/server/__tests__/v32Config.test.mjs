// v3.2 Plan 3 — Task 1 test bed: v32Config (REQ-P3-1 toggle gate, REQ-P3-9 proposal cap).
import { describe, it, expect } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  V32_DEFAULTS,
  validateV32Config,
  deepMergeConfig,
  loadV32Config,
  saveV32Config
} from "../services/v32Config.mjs"

describe("V32_DEFAULTS — the toggle is OFF in every committed config (REQ-P3-1)", () => {
  it("enabled defaults to false", () => {
    expect(V32_DEFAULTS.enabled).toBe(false)
  })

  it("proposalCap defaults to unlimited (0)", () => {
    expect(V32_DEFAULTS.proposalCap).toBe(0)
  })

  it("sessionHaltFloorPct is a non-configurable 2 floor (blueprint §5 wire 1)", () => {
    // The floor constant lives in v32Copilot; here we only pin the documented
    // contract so a stray config knob can never override it.
    expect(V32_DEFAULTS).not.toHaveProperty("sessionHaltFloorPct")
  })
})

describe("validateV32Config — unknown keys fail loudly (u4faConfig.mjs:178 pattern)", () => {
  it("accepts a defaults-shaped config with unknown-free keys", () => {
    const res = validateV32Config(V32_DEFAULTS)
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
  })

  it("accepts proposalCap 0 and an explicit enabled:false", () => {
    const res = validateV32Config({ enabled: false, proposalCap: 0 })
    expect(res.ok).toBe(true)
  })

  it("rejects an unknown top-level key", () => {
    const res = validateV32Config({ enabled: true, batmanMode: true })
    expect(res.ok).toBe(false)
    expect(res.errors.join("; ")).toMatch(/unknown top-level key "batmanMode"/)
  })

  it("rejects a non-boolean enabled", () => {
    const res = validateV32Config({ enabled: "yes" })
    expect(res.ok).toBe(false)
    expect(res.errors.join("; ")).toMatch(/enabled: expected boolean/)
  })

  it("rejects a non-integer proposalCap", () => {
    const res = validateV32Config({ proposalCap: 2.5 })
    expect(res.ok).toBe(false)
  })

  it("rejects a negative proposalCap", () => {
    const res = validateV32Config({ proposalCap: -1 })
    expect(res.ok).toBe(false)
  })

  it("rejects a non-null consecutiveLossThreshold below 1", () => {
    const res = validateV32Config({ consecutiveLossThreshold: 0 })
    expect(res.ok).toBe(false)
  })

  it("accepts null consecutiveLossThreshold (disabled-until-owner, wire 7)", () => {
    const res = validateV32Config({ consecutiveLossThreshold: null })
    expect(res.ok).toBe(true)
  })
})

describe("deepMergeConfig — scalars/arrays replace, objects recurse (REQ-P3-9 round-trip)", () => {
  it("defaults win where the overlay is silent", () => {
    const merged = deepMergeConfig(V32_DEFAULTS, { enabled: true })
    expect(merged.enabled).toBe(true)
    expect(merged.proposalCap).toBe(0)
  })

  it("undefined proposalCap over the default serializes as unlimited (0)", () => {
    const merged = deepMergeConfig(V32_DEFAULTS, { proposalCap: undefined })
    expect(merged.proposalCap).toBe(0)
  })
})

describe("loadV32Config / saveV32Config — tmp-dir round-trip (REQ-P3-9)", () => {
  it("returns the defaults when no file exists (source 'defaults')", async () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-v32-cfg-"))
    const res = await loadV32Config({ file: join(dir, "absent-v32-config.json") })
    expect(res.source).toBe("defaults")
    expect(res.config.enabled).toBe(false)
    expect(res.config.proposalCap).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it("deep-merges a valid file over the defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-v32-cfg-"))
    const file = join(dir, "v32-config.json")
    writeFileSync(file, JSON.stringify({ proposalCap: 2 }))
    const res = await loadV32Config({ file })
    expect(res.source).toBe("file")
    expect(res.config.proposalCap).toBe(2)
    expect(res.config.enabled).toBe(false) // untouched sibling survives
    expect(res.config.consecutiveLossThreshold).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it("round-trips through saveV32Config when VITEST is unset", async () => {
    const old = process.env.VITEST
    delete process.env.VITEST
    try {
      const dir = mkdtempSync(join(tmpdir(), "picc-v32-cfg-"))
      const file = join(dir, "v32-config.json")
      const saved = await saveV32Config(deepMergeConfig(V32_DEFAULTS, { proposalCap: 3 }), { file })
      expect(saved).toBe(true)
      const res = await loadV32Config({ file })
      expect(res.config.proposalCap).toBe(3)
      rmSync(dir, { recursive: true, force: true })
    } finally {
      if (old === undefined) delete process.env.VITEST
      else process.env.VITEST = old
    }
  })

  it("saveV32Config is VITEST-suppressed (tests never touch disk by default)", async () => {
    expect(await saveV32Config(V32_DEFAULTS)).toBe(true)
  })

  it("throws on a file with an unknown key (loud failure, no silent default)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-v32-cfg-"))
    const file = join(dir, "v32-config.json")
    writeFileSync(file, JSON.stringify({ enabledMistyped: true }))
    await expect(loadV32Config({ file })).rejects.toThrow(/unknown top-level key "enabledMistyped"/)
    rmSync(dir, { recursive: true, force: true })
  })
})

import { stampV32Config } from "../services/v32Config.mjs"

describe("v32Config enabledAt stamp (C2 uptime source)", () => {
  it("stamps a fresh enabled-at when a config first turns enabled", () => {
    const out = stampV32Config({ enabled: true, proposalCap: 3, consecutiveLossThreshold: null }, 12345)
    expect(out.enabledAt).toBe(12345)
    expect(out.enabled).toBe(true)
  })

  it("keeps an existing stamp while enabled (uptime is continuous)", () => {
    const out = stampV32Config({ enabled: true, enabledAt: 111 }, 222)
    expect(out.enabledAt).toBe(111)
  })

  it("clears the stamp when disabled so a re-enable re-stamps", () => {
    const out = stampV32Config({ enabled: false, enabledAt: 111 }, 222)
    expect(out.enabledAt).toBeNull()
  })

  it("leaves unrelated config keys untouched", () => {
    const out = stampV32Config({ enabled: true, proposalCap: 7 }, 5)
    expect(out.proposalCap).toBe(7)
  })
})