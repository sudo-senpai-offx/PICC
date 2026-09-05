import { beforeEach, describe, expect, test, vi } from "vitest"
import { existsSync, readFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Default (memory) mode: VITEST is set by the runner, PICC_COMMAND_CENTRE_DATA_DIR
// is NOT set here → no disk is ever touched by appends (repo VITEST convention).
import * as auditMemory from "../services/commandCentre/auditTrail.mjs"

beforeEach(() => {
  auditMemory._resetAuditTrail()
  vi.resetModules()
})

describe("Command Centre — audit trail: append-only + tamper-evident (5A)", () => {
  test("appends derive seq/prev/hash — callers cannot forge a sequence", () => {
    const e = auditMemory.appendAudit({ site: "trading:ccxt", kind: "mode-verdict", data: { mode: "AUTOPILOT" } })
    expect(e.seq).toBe(1)
    expect(e.prev).toBeNull()
    expect(typeof e.hash).toBe("string")
    expect(e.hash).toHaveLength(64) // sha-256 hex
    const e2 = auditMemory.appendAudit({ site: "expertoption", kind: "safety-gate:deny", data: { blockedBy: "5C" } })
    expect(e2.seq).toBe(2)
    expect(e2.prev).toBe(e.hash)
  })

  test("read returns the trail oldest-first and verify is clean", () => {
    auditMemory.appendAudit({ site: "a", kind: "k1", data: { n: 1 } })
    auditMemory.appendAudit({ site: "b", kind: "k2", data: { n: 2 } })
    const trail = auditMemory.readAudit()
    expect(trail.map((t) => t.seq)).toEqual([1, 2])
    expect(auditMemory.verifyAudit()).toEqual({ ok: true, brokenAt: null, reason: null })
  })

  test("mutating any entry breaks the chain and verify names the broken entry", () => {
    auditMemory.appendAudit({ site: "trading:ccxt", kind: "mode-verdict", data: { mode: "COPILOT" } })
    auditMemory.appendAudit({ site: "expertoption", kind: "safety-gate:allow", data: { action: "demo" } })
    // readAudit returns shallow copies — the nested data object is shared with
    // the chain, so tampering through it is exactly the attack verify must catch
    auditMemory.readAudit()[0].data.mode = "AUTOPILOT" // an edit pretending to be a verdict
    const v = auditMemory.verifyAudit()
    expect(v.ok).toBe(false)
    expect(v.brokenAt).toBe(1)
    expect(v.reason).toBe("entry hash mismatch")
  })

  test("appending after a tamper keeps the breach detectable (append does not heal)", () => {
    auditMemory.appendAudit({ site: "a", kind: "k", data: { x: 1 } })
    auditMemory.readAudit()[0].data.x = 999
    auditMemory.appendAudit({ site: "b", kind: "k", data: { x: 2 } })
    expect(auditMemory.verifyAudit().ok).toBe(false)
  })

  test("audit trail has no update/delete API — only append, read, verify", () => {
    const api = Object.keys(auditMemory).filter((k) => !k.startsWith("_"))
    expect(api.sort()).toEqual(["appendAudit", "readAudit", "verifyAudit"].sort())
  })
})

describe("Command Centre — audit trail: disk persistence (PICC_COMMAND_CENTRE_DATA_DIR)", () => {
  test("appends are written to the JSONL trail and verified after a fresh import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-audit-"))
    const envKey = "PICC_COMMAND_CENTRE_DATA_DIR"
    const prior = process.env[envKey]
    process.env[envKey] = dir

    try {
      vi.resetModules() // fresh instance reads the tmp DATA_DIR at import
      const audit = await import("../services/commandCentre/auditTrail.mjs")
      audit.appendAudit({ site: "trading:ccxt", kind: "mode-verdict", data: { mode: "AUTOPILOT" } })
      audit.appendAudit({ site: "bandwidth:browser", kind: "safety-gate:deny", data: { blockedBy: "5C" } })
      const file = join(dir, "command-centre-audit.jsonl")
      expect(existsSync(file)).toBe(true)
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean)
      expect(lines).toHaveLength(2)

      // another fresh module (fresh chain) boots from disk and verifies the persisted chain
      vi.resetModules()
      const rebooted = await import("../services/commandCentre/auditTrail.mjs")
      expect(rebooted.readAudit().map((e) => e.kind)).toEqual(["mode-verdict", "safety-gate:deny"])
      expect(rebooted.verifyAudit()).toEqual({ ok: true, brokenAt: null, reason: null })
    } finally {
      if (prior === undefined) delete process.env[envKey]
      else process.env[envKey] = prior
    }
  })
})