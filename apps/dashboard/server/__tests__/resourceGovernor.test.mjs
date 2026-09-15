// G1 — PICC_RESOURCE_GOVERNOR_v1.md §3.2/§4.2/§7: the observability ledger +
// parameter-aware routeTask(). Seam: the module's three public exports.
// Persistence seam: PICC_DATA_DIR → tmp dir + vi.resetModules() (same idiom as
// accountMetrics.test.mjs), so the ledger can never touch the real server data.
//
// Honesty contract:
//   - recordCall strips prompt content (Q5: tokens+metrics only)
//   - never-unbounded: T0/T1 are continuous-but-cheap; T2 is burst-capped;
//     T3 is overflow only; nothing available → "unavailable", never a stall
//   - governorStats on an empty ledger reports observed zeros, never invented rows
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ── routeTask: pure routing matrix (§3.2) ────────────────────────────────────
describe("routeTask — parameter-aware tier routing", () => {
  let gov
  beforeEach(async () => {
    gov = await import("../services/resourceGovernor.mjs")
  })

  it("T0 for tool-call/extraction/micro-decision above the confidence threshold", () => {
    for (const kind of ["tool-call", "extraction", "micro-decision"]) {
      const r = gov.routeTask({ taskKind: kind, confidence: 0.9 })
      expect(r.tier).toBe("T0")
      expect(r.escalated).toBe(false)
    }
  })

  it("T0 acts only above threshold — a low-confidence tool call escalates to T1", () => {
    const r = gov.routeTask({ taskKind: "tool-call", confidence: 0.3 })
    expect(r.tier).toBe("T1")
    expect(r.escalated).toBe(true)
  })

  it("a tool call with NO confidence stated is treated as below threshold (conservative)", () => {
    const r = gov.routeTask({ taskKind: "micro-decision" })
    expect(r.tier).toBe("T1")
    expect(r.escalated).toBe(true)
  })

  it("text gen ≤500 tokens, no deep reasoning → T1 (continuous tier)", () => {
    const r = gov.routeTask({ taskKind: "summary", maxTokens: 300 })
    expect(r.tier).toBe("T1")
  })

  it("reasoning or long synthesis → T2 on a fresh burst budget", () => {
    const r = gov.routeTask({ taskKind: "reasoning", maxTokens: 2000 })
    expect(r.tier).toBe("T2")
    expect(r.burstExhausted).toBe(false)
  })

  it("long synthesis over 500 tokens is heavy even without a reasoning kind", () => {
    const r = gov.routeTask({ taskKind: "text-gen", maxTokens: 1200 })
    expect(r.tier).toBe("T2")
  })

  it("T2 burst exhausted → T3 overflow (never silently falls back to T1)", () => {
    const r = gov.routeTask({ taskKind: "reasoning" }, { usedT2: 6, t2BurstLimit: 6 })
    expect(r.tier).toBe("T3")
    expect(r.burstExhausted).toBe(true)
    expect(r.overflow).toBe(true)
  })

  it("T2 burst exhausted AND overflow disabled → honest 'unavailable'", () => {
    const r = gov.routeTask({ taskKind: "reasoning" }, { usedT2: 6, t2BurstLimit: 6, overflowEnabled: false })
    expect(r.tier).toBe("unavailable")
  })

  it("never unbounded — a maxed T2 window plus disabled overflow goes nowhere else", () => {
    const r = gov.routeTask({ taskKind: "reasoning", maxTokens: 9999 }, { usedT2: 6, t2BurstLimit: 6, overflowEnabled: false })
    expect(r.tier).toBe("unavailable")
    expect(["T0", "T1", "T2", "T3"]).not.toContain(r.tier)
  })

  it("T3 is never the primary tier — a cheap task never overflows", () => {
    const r = gov.routeTask({ taskKind: "summary", maxTokens: 100 })
    expect(r.tier).toBe("T1")
  })

  it("a deadline-critical heavy task with T2 exhausted still overflows to T3 (29s)", () => {
    const r = gov.routeTask({ taskKind: "synthesis", deadlineMs: 29_000 }, { usedT2: 6, t2BurstLimit: 6 })
    expect(r.tier).toBe("T3")
  })
})

// ── recordCall: append-only ledger, privacy, day rotation ────────────────────
describe("recordCall — observability ledger", () => {
  let dir
  beforeEach(() => {
    vi.resetModules() // never reuse a prior describe's cached module instance
    dir = mkdtempSync(join(tmpdir(), "picc-gov-ledger-"))
    process.env.PICC_DATA_DIR = dir
  })
  afterEach(() => {
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("appends a row and returns it with id/day stamped — round-trip through stats", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    const row = await gov.recordCall({ feature: "news-digest", tier: "T1", model: "qwen2.5:1.5b", tokens: 412, latencyMs: 830, verdict: "accepted" })
    expect(row.id).toBeTruthy()
    expect(row.created_at).toBeTruthy()
    expect(row.day).toBeTruthy()
    const stats = await gov.governorStats()
    expect(stats.verdicts.accepted).toBe(1)
    expect(stats.perTier.T1.calls).toBe(1)
    expect(stats.perTier.T1.tokens).toBe(412)
  })

  it("never stores prompt content — only tokens + metrics (Q5 privacy)", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    await gov.recordCall({ feature: "strategy-brief", tier: "T2", model: "qwen2.5:7b", tokens: 900, latencyMs: 3120, verdict: "accepted", prompt: "secret risk assessment text" })
    const stats = await gov.governorStats()
    const flat = JSON.stringify(stats)
    expect(flat).not.toContain("secret")
    expect(flat).not.toContain("risk assessment")
  })

  it("verdicts and throttled/failed calls are counted, not dropped", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    await gov.recordCall({ feature: "signal", tier: "T1", tokens: 80, latencyMs: 120, verdict: "accepted" })
    await gov.recordCall({ feature: "signal", tier: "T1", tokens: 80, latencyMs: 120, verdict: "throttled" })
    await gov.recordCall({ feature: "strategy", tier: "T2", tokens: 1500, latencyMs: 4000, verdict: "failed" })
    const stats = await gov.governorStats()
    expect(stats.verdicts).toEqual({ accepted: 1, throttled: 1, failed: 1 })
    expect(stats.perTier.T2.verdicts.failed).toBe(1)
  })

  it("rotation: a previous-day ledger is not mixed into today's stats", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await gov.recordCall({ feature: "old", tier: "T3", tokens: 10, latencyMs: 1, verdict: "accepted" }, { now: `${yesterday}T23:00:00.000Z` })
    const stats = await gov.governorStats()
    expect(stats.day).toBe(new Date().toISOString().slice(0, 10))
    expect(stats.verdicts.accepted).toBe(0) // yesterday's row does not count today
  })

  it("survives a module restart — the ledger is the persisted truth (boot read)", async () => {
    const g1 = await import("../services/resourceGovernor.mjs")
    await g1.recordCall({ feature: "news-digest", tier: "T1", model: "llama3.2:3b", tokens: 200, latencyMs: 400, verdict: "accepted" })
    vi.resetModules() // fresh instance: PICC_DATA_DIR re-binds to the same tmp dir
    const g2 = await import("../services/resourceGovernor.mjs")
    const stats = await g2.governorStats()
    expect(stats.verdicts.accepted).toBe(1)
    expect(stats.perTier.T1.tokens).toBe(200)
  })
})

// ── governorStats: honest aggregates ─────────────────────────────────────────
describe("governorStats — honest aggregates", () => {
  let dir
  beforeEach(() => {
    vi.resetModules() // never reuse a prior describe's cached module instance
    dir = mkdtempSync(join(tmpdir(), "picc-gov-stats-"))
    process.env.PICC_DATA_DIR = dir
  })
  afterEach(() => {
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("empty ledger reports observed zeros — nothing fabricated, no rows invented", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    const stats = await gov.governorStats()
    expect(stats.verdicts).toEqual({ accepted: 0, throttled: 0, failed: 0 })
    expect(stats.perTier.T0.calls).toBe(0)
    expect(stats.perTier.T1.calls).toBe(0)
    expect(stats.perTier.T2.calls).toBe(0)
    expect(stats.perTier.T3.calls).toBe(0)
    expect(stats.ledger.entriesToday).toBe(0)
  })

  it("per-tier split with tokens and latency totals", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    await gov.recordCall({ feature: "a", tier: "T1", tokens: 100, latencyMs: 200, verdict: "accepted" })
    await gov.recordCall({ feature: "b", tier: "T1", tokens: 300, latencyMs: 400, verdict: "accepted" })
    await gov.recordCall({ feature: "c", tier: "T2", tokens: 2000, latencyMs: 5000, verdict: "accepted" })
    const stats = await gov.governorStats()
    expect(stats.perTier.T1).toMatchObject({ calls: 2, tokens: 400, latencyMs: 600 })
    expect(stats.perTier.T2).toMatchObject({ calls: 1, tokens: 2000, latencyMs: 5000 })
    expect(stats.perTier.T3.calls).toBe(0)
  })

  it("burst state is surfaced (owner amendment: ceilings are configurable, never magic)", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    const stats = await gov.governorStats()
    expect(stats.burst.T2.callsThisHour).toBe(0)
    expect(stats.burst.T2.limitPerHour).toBeGreaterThan(0)
  })
})

// ── recentRows: bounded live-table read (G3 dashboard endpoint source) ──────
describe("recentRows — bounded, newest-first ledger read", () => {
  let dir
  beforeEach(() => {
    vi.resetModules()
    dir = mkdtempSync(join(tmpdir(), "picc-gov-rows-"))
    process.env.PICC_DATA_DIR = dir
  })
  afterEach(() => {
    delete process.env.PICC_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("empty ledger → [] — nothing invented for the table", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    expect(await gov.recentRows()).toEqual([])
  })

  it("returns persisted rows newest-first with full metric fields", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    await gov.recordCall({ feature: "signal", tier: "T1", model: "llama3.2:3b", tokens: 80, latencyMs: 120, verdict: "accepted" })
    await gov.recordCall({ feature: "strategy-brief", tier: "T2", model: "qwen2.5:7b", tokens: 1500, latencyMs: 4100, verdict: "accepted" }, { now: new Date(Date.now() + 1000) })
    const rows = await gov.recentRows()
    expect(rows.length).toBe(2)
    expect(rows[0].feature).toBe("strategy-brief")
    expect(rows[1].feature).toBe("signal")
    expect(rows[0].tokens).toBe(1500)
    expect(rows[0].latencyMs).toBe(4100)
  })

  it("limit caps the live table (bounded read)", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    for (let i = 0; i < 5; i++) {
      await gov.recordCall({ feature: "f" + i, tier: "T1", tokens: 10, latencyMs: 1, verdict: "accepted" }, { now: new Date(Date.now() + i * 1000) })
    }
    const rows = await gov.recentRows({ limit: 2 })
    expect(rows.map((r) => r.feature)).toEqual(["f4", "f3"])
  })

  it("spans recent days newest-first without leaking yesterday into today's stats", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await gov.recordCall({ feature: "old-day", tier: "T3", tokens: 10, latencyMs: 1, verdict: "throttled" }, { now: `${yesterday}T23:00:00.000Z` })
    await gov.recordCall({ feature: "today", tier: "T1", tokens: 10, latencyMs: 1, verdict: "accepted" }, { now: new Date(Date.now() + 1000) })
    const rows = await gov.recentRows()
    expect(rows.map((r) => r.feature)).toEqual(["today", "old-day"])
    // and today-only stats stay honest
    const stats = await gov.governorStats()
    expect(stats.verdicts.accepted).toBe(1)
  })

  it("read-back rows never contain prompt content (Q5 privacy at the endpoint)", async () => {
    const gov = await import("../services/resourceGovernor.mjs")
    await gov.recordCall({ feature: "brief", tier: "T2", tokens: 900, verdict: "accepted", prompt: "never expose this", context: "or this" })
    const rows = await gov.recentRows()
    const flat = JSON.stringify(rows)
    expect(flat).not.toContain("never expose")
    expect(flat).not.toContain("or this")
  })
})