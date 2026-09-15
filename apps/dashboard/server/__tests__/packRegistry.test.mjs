// S0/T0.1 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: pack registry data model +
// honesty contract. Persistence seam: PICC_DATA_DIR → tmp dir +
// vi.resetModules() (same idiom as resourceGovernor.test.mjs).
//
// Honesty contract (spec "Pack registry data model", test-enforced):
//   - observed: null renders "not-observed", NEVER 0 — but an observed 0 IS
//     an observation and must render as "0";
//   - stopped-at-human exits ONLY via ackStep (explicit human handoff);
//     observation can never auto-transition it (Governor §7 / ministry §11);
//   - every transition lands an evidence row with ts; evidence is pruned by
//     count (PICC_PACK_REGISTRY_MAX_ROWS) and 30-day retention.
// No network, no credentials anywhere in this file.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let dir
let reg

async function loadFresh() {
  process.env.PICC_DATA_DIR = dir
  vi.resetModules()
  reg = await import("../services/packRegistry.mjs")
}

describe("pack registry — Pack 1 definition", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "picc-packreg-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
  })

  it("defines exactly the four Pack 1 steps with kinds + envelopes", async () => {
    await loadFresh()
    const def = reg.packOneDefinition()
    expect(def.id).toBe("pack1-local-trading-core")
    expect(def.steps.map((s) => s.id)).toEqual([
      "p1-1-eo-session-capture",
      "p1-2-ccxt-data-poll",
      "p1-3-news-digest",
      "p1-4-signal-notifications"
    ])
    expect(def.steps[0].kind).toBe("l-class") // EO login gate stops at human
    expect(def.steps.slice(1).every((s) => s.kind === "run")).toBe(true)
    for (const s of def.steps) {
      expect(s.envelope.tier).toBeTruthy()
      expect(s.envelope.cadenceMs).toBeGreaterThan(0)
      expect(s.envelope.rpmCeiling).toBeGreaterThanOrEqual(0)
      expect(s.envelope.needs).toBeTruthy()
    }
  })
})

describe("pack registry — state machine + honesty", () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-packreg-"))
    await loadFresh()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
  })

  it("fresh registry: all steps idle, lastObservedAt null, no evidence", async () => {
    const r = await reg.getRegistry()
    const steps = r.packs[0].steps
    expect(steps).toHaveLength(4)
    for (const s of steps) {
      expect(s.status).toBe("idle")
      expect(s.lastObservedAt).toBeNull()
      expect(s.evidence).toEqual([])
    }
  })

  it("legal transitions land evidence rows and update the step", async () => {
    await reg.observeStep("pack1-local-trading-core", "p1-2-ccxt-data-poll", {
      status: "running",
      detail: "polls ok",
      observed: { ok: 12, fail: 0 }
    })
    const step = await reg.getStep("pack1-local-trading-core", "p1-2-ccxt-data-poll")
    expect(step.status).toBe("running")
    expect(step.evidence).toHaveLength(1)
    expect(step.evidence[0].status).toBe("running")
    expect(step.evidence[0].observed).toEqual({ ok: 12, fail: 0 })
    expect(step.lastObservedAt).not.toBeNull()
  })

  it("illegal transitions throw — and stopped-at-human can NEVER be left by observation", async () => {
    const id = "p1-1-eo-session-capture"
    await reg.observeStep("pack1-local-trading-core", id, { status: "stopped-at-human", detail: "token expired" })
    await expect(
      reg.observeStep("pack1-local-trading-core", id, { status: "running", detail: "token back" })
    ).rejects.toThrow(/stopped-at-human exits only via ack/)
    await expect(
      reg.observeStep("pack1-local-trading-core", id, { status: "idle" })
    ).rejects.toThrow(/stopped-at-human exits only via ack/)
    // evidence refresh on the same status is legal (stays stopped-at-human)
    await reg.observeStep("pack1-local-trading-core", id, { status: "stopped-at-human", detail: "still expired" })
    const step = await reg.getStep("pack1-local-trading-core", id)
    expect(step.status).toBe("stopped-at-human")
    expect(step.evidence).toHaveLength(2)
  })

  it("unknown status / unknown step / unknown transition are typed errors", async () => {
    await expect(
      reg.observeStep("pack1-local-trading-core", "p1-2-ccxt-data-poll", { status: "bogus" })
    ).rejects.toThrow(/unknown status/)
    await expect(
      reg.observeStep("pack1-local-trading-core", "nope", { status: "running" })
    ).rejects.toThrow(/unknown step/)
    await expect(
      reg.observeStep("nope", "p1-2-ccxt-data-poll", { status: "running" })
    ).rejects.toThrow(/unknown step/)
  })

  it("ackStep is the ONLY exit from stopped-at-human: re-arms to idle, records the human handoff", async () => {
    const id = "p1-1-eo-session-capture"
    await reg.observeStep("pack1-local-trading-core", id, { status: "stopped-at-human", detail: "re-login" })
    await expect(reg.ackStep("pack1-local-trading-core", "p1-2-ccxt-data-poll", {})).rejects.toThrow(
      /ack only valid on stopped-at-human/
    )
    const step = await reg.ackStep("pack1-local-trading-core", id, { by: "human" })
    expect(step.status).toBe("idle")
    expect(step.acknowledgedBy).toBe("human")
    expect(step.evidence.at(-1).status).toBe("acknowledged")
    expect(step.evidence.at(-1).detail).toContain("human handoff acknowledged")
    // after ack, observation may resume the step
    await reg.observeStep("pack1-local-trading-core", id, { status: "running", detail: "token captured" })
    const resumed = await reg.getStep("pack1-local-trading-core", id)
    expect(resumed.status).toBe("running")
  })

  it("projects the workflow pathway from the LATEST evidence row (owner Q2: structured steps surface to the strip)", async () => {
    const id = "p1-1-eo-session-capture"
    const pathway = {
      need: "re-login",
      prompt: "Manual login required — PICC never auto-fills, auto-detects, or automates broker logins.",
      steps: [
        "Open the ExpertOption app tab for the capture leg you use",
        "Log in AGAIN to the DEMO account manually",
        "Keep the tab open — the 60s session-refresh pass reads the token automatically.",
        "Then acknowledge this handoff in the packs strip"
      ]
    }
    // A stopped-at-human observation whose observed carries a pathway
    await reg.observeStep("pack1-local-trading-core", id, {
      status: "stopped-at-human",
      detail: "needs: re-login",
      observed: { degradedKind: "expired", tokenConfigured: true, pathway }
    })
    const stopped = await reg.getStep("pack1-local-trading-core", id)
    expect(stopped.pathway).toEqual(pathway) // read surface carries it for the UI

    // A later observation WITHOUT a pathway replaces it (latest evidence wins)
    await reg.observeStep("pack1-local-trading-core", id, {
      status: "stopped-at-human",
      detail: "needs: re-login",
      observed: { degradedKind: "expired" }
    })
    const repl = await reg.getStep("pack1-local-trading-core", id)
    expect(repl.pathway).toBeNull()

    // After the human ack the re-armed step carries NO pathway (nothing to do)
    const acked = await reg.ackStep("pack1-local-trading-core", id, { by: "human" })
    expect(acked.pathway).toBeNull()
  })

  it("honesty: unobserved renders 'not-observed'; an observed 0 stays 0", async () => {
    expect(reg.renderObserved(null)).toBe("not-observed")
    expect(reg.renderObserved(undefined)).toBe("not-observed")
    expect(reg.renderObserved(0)).toBe(0)
    expect(reg.renderObserved({ ok: 0, fail: 3 })).toEqual({ ok: 0, fail: 3 })
    // observed:null is stored null, never silently upgraded
    await reg.observeStep("pack1-local-trading-core", "p1-3-news-digest", { status: "running" })
    const step = await reg.getStep("pack1-local-trading-core", "p1-3-news-digest")
    expect(step.evidence[0].observed).toBeNull()
  })

  it("persistence round-trip survives a fresh module load", async () => {
    await reg.observeStep("pack1-local-trading-core", "p1-4-signal-notifications", {
      status: "running",
      detail: "in-app dispatched",
      observed: { inApp: 3, webpush: "skipped (no vapid)" }
    })
    await loadFresh() // new import = new localStore cache = re-reads the file
    const step = await reg.getStep("pack1-local-trading-core", "p1-4-signal-notifications")
    expect(step.status).toBe("running")
    expect(step.evidence[0].observed.inApp).toBe(3)
    expect(step.evidence[0].observed.webpush).toBe("skipped (no vapid)")
  })

  it("evidence prunes by cap and 30-day retention", async () => {
    process.env.PICC_PACK_REGISTRY_MAX_ROWS = "3"
    await loadFresh()
    const id = "p1-2-ccxt-data-poll"
    const DAY = 24 * 60 * 60 * 1000
    const day0 = new Date("2026-09-01T00:00:00Z").getTime()
    await reg.observeStep("pack1-local-trading-core", id, { status: "running", observed: { ok: 1 } }, { now: day0 })
    await reg.observeStep("pack1-local-trading-core", id, { status: "running", observed: { ok: 2 } }, { now: day0 + DAY })
    await reg.observeStep("pack1-local-trading-core", id, { status: "running", observed: { ok: 3 } }, { now: day0 + 2 * DAY })
    // older than 30 days → pruned; beyond cap → oldest dropped, newest kept
    await reg.observeStep(
      "pack1-local-trading-core",
      id,
      { status: "running", observed: { ok: 4 } },
      { now: day0 + 31 * DAY }
    )
    const step = await reg.getStep("pack1-local-trading-core", id)
    expect(step.evidence).toHaveLength(3)
    expect(step.evidence.map((e) => e.observed.ok)).toEqual([2, 3, 4])
  })
})