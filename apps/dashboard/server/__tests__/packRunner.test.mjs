// S0/T0.2 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: pack runner envelope gate.
// Honesty floor under test:
//   - blocked when an OBSERVED §8.5 cap is exceeded (ram/cpu/storage);
//   - unobserved usage (null) NEVER fabricates a block;
//   - skipped-unconfigured reason strings are exact (SKIP_REASONS vocabulary);
//   - an l-class step without credentials can never be observed "running";
//   - stopped-at-human is NEVER auto-run — runStep rejects it, the runner
//     never acks; ackStep remains a human-only action.
// Pure gate table-tests + one integration path through runStep. No network,
// no credentials.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let dir
let runner
let reg

async function loadFresh() {
  process.env.PICC_DATA_DIR = dir
  vi.resetModules()
  runner = await import("../services/packRunner.mjs")
  reg = await import("../services/packRegistry.mjs")
}

function step(kind = "run", over = {}) {
  return {
    id: "t-step",
    label: "test step",
    kind,
    envelope: { tier: "T1", cadenceMs: 1000, rpmCeiling: 10, needs: "x", ...over },
    status: "idle",
    lastObservedAt: null,
    lastError: null,
    detail: null,
    acknowledgedBy: null,
    evidence: []
  }
}

describe("packRunner — pure envelope gate", () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-packrun-"))
    await loadFresh()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
  })
  it("no problem when nothing exceeds caps (observed or unobserved)", () => {
    expect(runner.envelopeGate(step(), { usage: { ramMb: 512, cpuPct: 10, storageMb: 50 }, caps: { maxRamMb: 4096, maxCpuPct: 50, maxStorageMb: 2048 } })).toBeNull()
    // unobserved usage (null) is within budget — no fabricated block
    expect(runner.envelopeGate(step(), { usage: {}, caps: { maxRamMb: 4096 } })).toBeNull()
  })

  it("blocks when an observed cap is exceeded — one reason at a time, ram first", () => {
    const caps = { maxRamMb: 4096, maxCpuPct: 50, maxStorageMb: 2048 }
    expect(runner.envelopeGate(step(), { usage: { ramMb: 5000 }, caps })).toEqual({
      status: "blocked",
      reason: "resource-cap-ram-exceeded (observed 5000MB > cap 4096MB)"
    })
    expect(runner.envelopeGate(step(), { usage: { cpuPct: 80 }, caps })).toEqual({
      status: "blocked",
      reason: "resource-cap-cpu-exceeded (observed 80% > cap 50%)"
    })
    expect(runner.envelopeGate(step(), { usage: { storageMb: 3000 }, caps })).toEqual({
      status: "blocked",
      reason: "resource-cap-storage-exceeded (observed 3000MB > cap 2048MB)"
    })
  })

  it("tier availability is a stated gate — unavailable tier → skipped-unconfigured", () => {
    const r = runner.envelopeGate(step("run", { tier: "T2" }), { gates: { tierAvailable: false } })
    expect(r).toEqual({ status: "skipped-unconfigured", reason: "tier-unavailable-T2" })
    expect(runner.envelopeGate(step("run", { tier: "T1" }), { gates: { tierAvailable: true } })).toBeNull()
  })

  it("l-class steps require credentials — running-intent without them stops at human", () => {
    expect(runner.envelopeGate(step("l-class"), { gates: {} })).toEqual({
      status: "stopped-at-human",
      reason: "login-gate: no credentials observed"
    })
    expect(runner.envelopeGate(step("l-class"), { gates: { hasCredentials: true } })).toBeNull()
  })

  it("a declared dependency must be available", () => {
    const dep = step("run", { requiresDependency: true })
    expect(runner.envelopeGate(dep, { gates: { dependencyAvailable: false } })).toEqual({
      status: "skipped-unconfigured",
      reason: "dependency-not-available"
    })
    expect(runner.envelopeGate(dep, { gates: { dependencyAvailable: true } })).toBeNull()
    expect(runner.envelopeGate(step(), { gates: { dependencyAvailable: false } })).toBeNull() // not declared → no gate
  })

  it("SKIP_REASONS vocabulary is exact (single source for S1–S4 observers + UI)", () => {
    expect(runner.SKIP_REASONS).toEqual({
      noNewsSourceConfigured: "no-news-source-configured",
      noVapid: "no-vapid",
      noCcxtPairs: "no-ccxt-pairs-configured",
      signalEngineDisabled: "signal-engine-disabled",
      extensionCaptureDisabled: "extension-capture-disabled",
      sessionCaptureDisabled: "session-capture-disabled",
      cactusNeedleT0NotShipped: "cactus-needle-t0-runtime-not-shipped",
      dependencyNotAvailable: "dependency-not-available",
      noWebhookUrl: "no-webhook-url"
    })
  })
})

describe("packRunner — runStep integration", () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-packrun-"))
    await loadFresh()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
  })

  it("running-intent through a satisfied gate records running", async () => {
    const { step: s, applied } = await runner.runStep({
      packId: "pack1-local-trading-core",
      stepId: "p1-2-ccxt-data-poll",
      observation: { status: "running", detail: "polls ok", observed: { ok: 12 } },
      gates: { tierAvailable: true },
      usage: { ramMb: 800, cpuPct: 20, storageMb: 100 }
    })
    expect(applied).toBeNull()
    expect(s.status).toBe("running")
    expect(s.evidence).toHaveLength(1)
  })

  it("running-intent through an exceeded cap is rewritten to blocked with the exact reason", async () => {
    const { step: s, applied } = await runner.runStep({
      packId: "pack1-local-trading-core",
      stepId: "p1-2-ccxt-data-poll",
      observation: { status: "running" },
      usage: { ramMb: 99999 },
      caps: { maxRamMb: 4096 }
    })
    expect(applied).toEqual({
      from: "running",
      to: "blocked",
      reason: "resource-cap-ram-exceeded (observed 99999MB > cap 4096MB)"
    })
    expect(s.status).toBe("blocked")
    expect(s.detail).toBe("resource-cap-ram-exceeded (observed 99999MB > cap 4096MB)")
    expect(s.lastError).toBe("resource-cap-ram-exceeded (observed 99999MB > cap 4096MB)")
  })

  it("an l-class step can never be observed running without credentials", async () => {
    const { step: s, applied } = await runner.runStep({
      packId: "pack1-local-trading-core",
      stepId: "p1-1-eo-session-capture",
      observation: { status: "running", detail: "token present" },
      gates: { hasCredentials: false, tierAvailable: true }
    })
    expect(applied.to).toBe("stopped-at-human")
    expect(s.status).toBe("stopped-at-human")
    expect(s.detail).toBe("login-gate: no credentials observed")
  })

  it("with credentials the l-class capture step may run", async () => {
    const { step: s } = await runner.runStep({
      packId: "pack1-local-trading-core",
      stepId: "p1-1-eo-session-capture",
      observation: { status: "running", detail: "token present, session connected", observed: { sourceLeg: "extension" } },
      gates: { hasCredentials: true, tierAvailable: true }
    })
    expect(s.status).toBe("running")
    expect(s.evidence[0].observed.sourceLeg).toBe("extension")
  })

  it("stopped-at-human is NEVER auto-run: a running-intent later is rejected, and the runner never acks", async () => {
    // human-less flow: capture degrades → stopped; a fresh token observation must NOT resume it
    await runner.runStep({
      packId: "pack1-local-trading-core",
      stepId: "p1-1-eo-session-capture",
      observation: { status: "stopped-at-human", detail: "token expired" }
    })
    await expect(
      runner.runStep({
        packId: "pack1-local-trading-core",
        stepId: "p1-1-eo-session-capture",
        observation: { status: "running", detail: "token back" },
        gates: { hasCredentials: true, tierAvailable: true }
      })
    ).rejects.toThrow(/stopped-at-human exits only via ack/)
    const step = await reg.getStep("pack1-local-trading-core", "p1-1-eo-session-capture")
    expect(step.status).toBe("stopped-at-human") // unchanged, no auto-resume
    // and only the human ack moves it (proving the runner has no ack path)
    const acked = await reg.ackStep("pack1-local-trading-core", "p1-1-eo-session-capture", { by: "human" })
    expect(acked.status).toBe("idle")
    expect(acked.acknowledgedBy).toBe("human")
  })

  it("observer-honest statuses pass through the gate untouched", async () => {
    const { step: s, applied } = await runner.runStep({
      packId: "pack1-local-trading-core",
      stepId: "p1-3-news-digest",
      observation: { status: "skipped-unconfigured", detail: runner.SKIP_REASONS.noNewsSourceConfigured }
    })
    expect(applied).toBeNull()
    expect(s.status).toBe("skipped-unconfigured")
    expect(s.detail).toBe("no-news-source-configured")
  })
})