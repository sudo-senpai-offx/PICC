// G2 — PICC_RESOURCE_GOVERNOR_v1.md §3.2/§4.2/§7: governor enforcement wired into
// the LLM caller behind PICC_RESOURCE_GOVERNOR=on. Existing provider failover
// stays beneath it (existing llm.test.mjs is untouched and must stay green).
//
// Q3 throttle behavior: budget exceeded → (b) soft-degrade (fall to T3
// overflow, still served, recorded throttled) → (a) hard-stop (honest throw,
// recorded failed). Every verdict lands in the observability ledger.
//
// Seams: PICC_DATA_DIR → tmp dir + vi.resetModules() (ledger store binding);
// provider config via ambient process.env → fresh import of config.mjs;
// provider HTTP via stubbed global fetch. The governor is OFF by default
// unless PICC_RESOURCE_GOVERNOR=on (or opts.governor).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function geminiOk(payload) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: payload }] } }] }),
    text: async () => ""
  }))
}

let tmp
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-gov-llm-"))
  const settings = await import("../services/llmSettings.mjs")
  settings._setSettingsFile(join(tmp, "llm-settings.json"))
  // Trigger the one-time .env load + PICC_ENV_LOADED guard so per-test env
  // vars set below are never clobbered by a later config.mjs re-import.
  await import("../config.mjs")
})

let dir
let llm
let gov
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "picc-gov-llm-data-"))
  process.env.PICC_DATA_DIR = dir
  process.env.GEMINI_API_KEY = "test-key-gemini"
  process.env.GROQ_API_KEY = "test-key-groq"
  process.env.LLM_PROVIDERS = "gemini"
  // Baseline OFF: the .env flag is ambient once config.mjs loads it (beforeAll
  // above); PICC_ENV_LOADED prevents a reload after deletion. The ON tests
  // below set the flag explicitly.
  delete process.env.PICC_RESOURCE_GOVERNOR
  vi.resetModules()
  llm = await import("../services/llm.mjs")
  gov = await import("../services/resourceGovernor.mjs")
})
afterEach(() => {
  delete process.env.PICC_DATA_DIR
  delete process.env.GEMINI_API_KEY
  delete process.env.GROQ_API_KEY
  delete process.env.LLM_PROVIDERS
  delete process.env.PICC_RESOURCE_GOVERNOR
  vi.unstubAllGlobals()
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

describe("governed LLM caller (G2)", () => {
  it("governor OFF — existing path unchanged, nothing hits the ledger", async () => {
    vi.stubGlobal("fetch", geminiOk('{"headline":"Hi"}'))
    const out = await llm.chatJSON("sys", "user")
    expect(out.headline).toBe("Hi")
    const stats = await gov.governorStats()
    expect(stats.ledger.entriesToday).toBe(0)
    expect(stats.verdicts).toEqual({ accepted: 0, throttled: 0, failed: 0 })
  })

  it("governor ON — light request routes to T1 and records accepted", async () => {
    process.env.PICC_RESOURCE_GOVERNOR = "on"
    vi.resetModules()
    llm = await import("../services/llm.mjs")
    gov = await import("../services/resourceGovernor.mjs")
    vi.stubGlobal("fetch", geminiOk('{"ok":true}'))
    const out = await llm.chatJSON("sys", "user", { feature: "news-digest" })
    expect(out.ok).toBe(true)
    const stats = await gov.governorStats()
    expect(stats.verdicts.accepted).toBe(1)
    expect(stats.perTier.T1.calls).toBe(1)
  })

  it("governor ON — heavy request within the T2 burst is served and recorded on T2", async () => {
    process.env.PICC_RESOURCE_GOVERNOR = "on"
    vi.resetModules()
    llm = await import("../services/llm.mjs")
    gov = await import("../services/resourceGovernor.mjs")
    for (let i = 0; i < 5; i++) {
      await gov.recordCall({ feature: "prefill", tier: "T2", tokens: 100, latencyMs: 5, verdict: "accepted" })
    }
    vi.stubGlobal("fetch", geminiOk('{"ok":true}'))
    const out = await llm.chatJSON("sys", "user", { feature: "brief", maxTokens: 1200 })
    expect(out.ok).toBe(true)
    const stats = await gov.governorStats()
    expect(stats.burst.T2.callsThisHour).toBe(6) // 5 pre-filled + this one
    expect(stats.perTier.T2.verdicts.accepted).toBe(6)
  })

  it("governor ON — T2 burst exhausted soft-degrades to T3: still served, recorded throttled", async () => {
    process.env.PICC_RESOURCE_GOVERNOR = "on"
    vi.resetModules()
    llm = await import("../services/llm.mjs")
    gov = await import("../services/resourceGovernor.mjs")
    for (let i = 0; i < 6; i++) {
      await gov.recordCall({ feature: "prefill", tier: "T2", tokens: 100, latencyMs: 5, verdict: "accepted" })
    }
    vi.stubGlobal("fetch", geminiOk('{"ok":true}'))
    const out = await llm.chatJSON("sys", "user", { feature: "brief", maxTokens: 1200 })
    expect(out.ok).toBe(true) // soft: still answered
    const stats = await gov.governorStats()
    expect(stats.verdicts.throttled).toBe(1)
    expect(stats.perTier.T3.verdicts.throttled).toBe(1)
    // the degraded marker is persisted with the row
    const raw = (await import("node:fs/promises")).readFile(join(dir, "resource_ledger.json"), "utf8")
    expect(await raw).toContain('"degraded": true')
  })

  it("governor ON — overflow disabled hard-stops: honest throw, no provider call, failed recorded", async () => {
    process.env.PICC_RESOURCE_GOVERNOR = "on"
    vi.resetModules()
    llm = await import("../services/llm.mjs")
    gov = await import("../services/resourceGovernor.mjs")
    for (let i = 0; i < 6; i++) {
      await gov.recordCall({ feature: "prefill", tier: "T2", tokens: 100, latencyMs: 5, verdict: "accepted" })
    }
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      llm.chatJSON("sys", "user", { feature: "brief", maxTokens: 1200, governorOverflow: false })
    ).rejects.toThrow(/resource governor/)
    expect(fetchMock.mock.calls.length).toBe(0) // hard stop before any provider
    const stats = await gov.governorStats()
    expect(stats.verdicts.failed).toBe(1)
    expect(stats.perTier.T2.verdicts.failed).toBe(1)
  })

  it("provider failover still works beneath the governor — second provider serves", async () => {
    process.env.PICC_RESOURCE_GOVERNOR = "on"
    process.env.LLM_PROVIDERS = "gemini,groq"
    vi.resetModules()
    llm = await import("../services/llm.mjs")
    gov = await import("../services/resourceGovernor.mjs")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("generativelanguage")) {
          return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" }
        }
        if (String(url).includes("api.groq.com")) {
          return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }), text: async () => "" }
        }
        throw new Error("unexpected url " + url)
      })
    )
    const out = await llm.chatJSON("sys", "user", { feature: "news-digest" })
    expect(out.ok).toBe(true)
    expect(llm.provider()).toBe("groq")
    const stats = await gov.governorStats()
    expect(stats.verdicts.accepted).toBe(1)
  })

  it("all providers fail — combined error surfaces and the ledger records failed", async () => {
    process.env.PICC_RESOURCE_GOVERNOR = "on"
    vi.resetModules()
    llm = await import("../services/llm.mjs")
    gov = await import("../services/resourceGovernor.mjs")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "boom" }))
    )
    await expect(llm.chatJSON("sys", "user", { feature: "news-digest" })).rejects.toThrow(/gemini/)
    const stats = await gov.governorStats()
    expect(stats.verdicts.failed).toBe(1)
  })
})