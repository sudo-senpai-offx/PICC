import { beforeEach, describe, expect, test, vi } from "vitest"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Default (memory) mode — same vitest convention as the audit trail.
import * as runtimeMemory from "../services/commandCentre/commandCentreRuntime.mjs"
import * as auditMemory from "../services/commandCentre/auditTrail.mjs"

beforeEach(() => {
  runtimeMemory._resetKillSwitchState()
  auditMemory._resetAuditTrail()
})

describe("Command Centre — runtime kill-switch store (L0, enforced)", () => {
  test("defaults: every switch OFF — no kill, no global, no site killed", () => {
    expect(runtimeMemory.killSwitchState()).toEqual({ global: false, sites: {} })
    expect(runtimeMemory.siteKilled("trading:ccxt")).toBe(false)
    expect(runtimeMemory.anyKillActive()).toBe(false)
  })

  test("a per-site kill only bites its own site; other sites stay clear", () => {
    expect(runtimeMemory.setKillSwitch("trading:ccxt", true).ok).toBe(true)
    expect(runtimeMemory.siteKilled("trading:ccxt")).toBe(true)
    expect(runtimeMemory.siteKilled("expertoption")).toBe(false)
    expect(runtimeMemory.anyKillActive()).toBe(true)
    expect(runtimeMemory.killSwitchState().global).toBe(false)
  })

  test("the GLOBAL kill overrides every site switch — a site-specific clear cannot out-rank it", () => {
    runtimeMemory.setKillSwitch("global", true)
    // even a site that was explicitly cleared is still killed
    runtimeMemory.setKillSwitch("expertoption", false)
    expect(runtimeMemory.siteKilled("expertoption")).toBe(true)
    expect(runtimeMemory.siteKilled("trading:ccxt")).toBe(true)
    expect(runtimeMemory.anyKillActive()).toBe(true)
  })

  test("clearing is the explicit human rearm — the switch round-trips", () => {
    runtimeMemory.setKillSwitch("trading:ccxt", true)
    runtimeMemory.setKillSwitch("global", true)
    expect(runtimeMemory.siteKilled("trading:ccxt")).toBe(true)
    runtimeMemory.setKillSwitch("trading:ccxt", false)
    runtimeMemory.setKillSwitch("global", false)
    expect(runtimeMemory.siteKilled("trading:ccxt")).toBe(false)
    expect(runtimeMemory.anyKillActive()).toBe(false)
  })

  test("unknown sites are never pre-listed and never secretly killed", () => {
    runtimeMemory.setKillSwitch("trading:ccxt", true)
    expect(runtimeMemory.siteKilled("somewhere:else")).toBe(false)
    expect(Object.keys(runtimeMemory.killSwitchState().sites).sort()).toEqual(["trading:ccxt"])
  })

  test("bad input is rejected without mutating state", () => {
    expect(runtimeMemory.setKillSwitch("", true).ok).toBe(false)
    expect(runtimeMemory.setKillSwitch("   ", true).ok).toBe(false)
    expect(runtimeMemory.setKillSwitch("trading:ccxt", "yes").ok).toBe(false)
    expect(runtimeMemory.setKillSwitch(null, true).ok).toBe(false)
    expect(runtimeMemory.killSwitchState()).toEqual({ global: false, sites: {} })
  })

  test("every transition emits the audit event — the audit chain can verify it", () => {
    // no injected audit → the module uses the shared appendAudit by default
    runtimeMemory.setKillSwitch("trading:ccxt", true)
    const trail = auditMemory.readAudit()
    expect(trail).toHaveLength(1)
    expect(trail[0]).toMatchObject({ site: "trading:ccxt", kind: "kill-switch", data: { kill: true } })
  })
})

describe("Command Centre — runtime kill-switch store: disk persistence", () => {
  test("a set switch survives a fresh boot from the store file (UI toggle → enforced after restart)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-cc-runtime-"))
    const envKey = "PICC_COMMAND_CENTRE_DATA_DIR"
    const prior = process.env[envKey]
    process.env[envKey] = dir

    try {
      vi.resetModules()
      const runtime = await import("../services/commandCentre/commandCentreRuntime.mjs")
      runtime.setKillSwitch("expertoption", true)
      const file = join(dir, "command-centre-runtime.json")
      expect(existsSync(file)).toBe(true)

      // a deliberately closed kill is NOT re-opened by restart
      runtime.setKillSwitch("trading:ccxt", true)
      runtime.setKillSwitch("trading:ccxt", false)

      vi.resetModules()
      const rebooted = await import("../services/commandCentre/commandCentreRuntime.mjs")
      expect(rebooted.siteKilled("expertoption")).toBe(true)
      expect(rebooted.siteKilled("trading:ccxt")).toBe(false)
      // an explicit human clear is RECORDED as an off switch, not forgotten
      expect(rebooted.killSwitchState().sites).toEqual({
        expertoption: true,
        "trading:ccxt": false
      })
    } finally {
      if (prior === undefined) delete process.env[envKey]
      else process.env[envKey] = prior
    }
  })

  test("an unreadable store file boots conservatively with the GLOBAL KILL ON (fail-safe deny)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-cc-runtime-"))
    const envKey = "PICC_COMMAND_CENTRE_DATA_DIR"
    const prior = process.env[envKey]
    process.env[envKey] = dir

    try {
      writeFileSync(join(dir, "command-centre-runtime.json"), "{ corrupted json", "utf8")
      vi.resetModules()
      const rebooted = await import("../services/commandCentre/commandCentreRuntime.mjs")
      // an unreadable store must never look like "all clear"
      expect(rebooted.killSwitchState().global).toBe(true)
      expect(rebooted.siteKilled("trading:ccxt")).toBe(true)
      expect(rebooted.anyKillActive()).toBe(true)
    } finally {
      if (prior === undefined) delete process.env[envKey]
      else process.env[envKey] = prior
    }
  })
})