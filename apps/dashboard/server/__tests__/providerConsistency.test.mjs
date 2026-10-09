// Wave3+04 — provider-consistency signal (TRADING SIGNALS ONLY, OFF by default).
// TDD RED: imports providerConsistency.mjs + chatSignalText/chatSignalJSON from
// llm.mjs, neither of which exists yet. Mocked providers only (stubbed fetch).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function geminiText(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: payload }] } }] }),
    text: async () => ""
  }
}
function groqText(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: payload } }] }),
    text: async () => ""
  }
}

let tmp
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-consistency-"))
  const settings = await import("../services/llmSettings.mjs")
  settings._setSettingsFile(join(tmp, "llm-settings.json"))
  await import("../config.mjs")
})

let dir
let llm
let consistency
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "picc-consistency-data-"))
  process.env.PICC_DATA_DIR = dir
  process.env.GEMINI_API_KEY = "test-key-gemini"
  process.env.GROQ_API_KEY = "test-key-groq"
  process.env.LLM_PROVIDERS = "gemini,groq"
  delete process.env.PICC_RESOURCE_GOVERNOR
  delete process.env.PICC_PROVIDER_CONSISTENCY
  vi.resetModules()
  llm = await import("../services/llm.mjs")
  consistency = await import("../services/providerConsistency.mjs")
})
afterEach(() => {
  delete process.env.PICC_DATA_DIR
  delete process.env.GEMINI_API_KEY
  delete process.env.GROQ_API_KEY
  delete process.env.LLM_PROVIDERS
  delete process.env.PICC_RESOURCE_GOVERNOR
  delete process.env.PICC_PROVIDER_CONSISTENCY
  vi.unstubAllGlobals()
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

describe("provider consistency (trading signals only, OFF by default)", () => {
  it("flag OFF → single-provider behavior byte-identical (one fetch, no second sample)", async () => {
    expect(consistency.isConsistencyEnabled()).toBe(false)
    const fetchMock = vi.fn(async () => geminiText("GO long EURUSD"))
    vi.stubGlobal("fetch", fetchMock)
    const out = await llm.chatSignalText("sys", "signal?")
    expect(out).toBe("GO long EURUSD")
    expect(fetchMock.mock.calls.length).toBe(1)
    expect(llm.lastConsistency()).toBeNull()
  })

  it("agreement path proceeds with the primary output", async () => {
    process.env.PICC_PROVIDER_CONSISTENCY = "on"
    vi.resetModules()
    llm = await import("../services/llm.mjs")
    consistency = await import("../services/providerConsistency.mjs")
    expect(consistency.isConsistencyEnabled()).toBe(true)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("generativelanguage") ? geminiText("HOLD caution") : groqText("HOLD caution")
      )
    )
    const out = await llm.chatSignalText("sys", "signal?")
    expect(out).toBe("HOLD caution")
    const check = llm.lastConsistency()
    expect(check.agree).toBe(true)
    expect(check.primaryProvider).toBe("gemini")
    expect(check.secondaryProvider).toBe("groq")
    // Default provider order/selection unchanged: primary is still first in order.
    expect(check.failoverOrder[0]).toBe("gemini")
  })

  it("divergence path holds with both outputs attached (advisory only, never auto-GO)", async () => {
    process.env.PICC_PROVIDER_CONSISTENCY = "on"
    vi.resetModules()
    llm = await import("../services/llm.mjs")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("generativelanguage") ? geminiText("GO long EURUSD") : groqText("SELL EURUSD now")
      )
    )
    const out = await llm.chatSignalText("sys", "signal?")
    expect(typeof out).toBe("object")
    expect(out.verdict).toBe("HOLD")
    expect(out.advisory).toBe("HOLD")
    expect(out.reason).toMatch(/divergence/)
    expect(out.primary.output).toBe("GO long EURUSD")
    expect(out.secondary.output).toBe("SELL EURUSD now")
    expect(out.note).toMatch(/advisory/i)
    // Advisory ceiling: no execution directive.
    expect(JSON.stringify(out)).not.toMatch(/"execute"\s*:\s*true/i)
  })

  it("second-sample failure → named reason, primary stands", async () => {
    process.env.PICC_PROVIDER_CONSISTENCY = "on"
    vi.resetModules()
    llm = await import("../services/llm.mjs")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("generativelanguage")) return geminiText("GO long EURUSD")
        throw new Error("groq overloaded")
      })
    )
    const out = await llm.chatSignalText("sys", "signal?")
    expect(out).toBe("GO long EURUSD")
    const check = llm.lastConsistency()
    expect(check.agree).toBeNull()
    expect(check.reason).toMatch(/groq/)
    expect(check.reason).toMatch(/overloaded/)
  })

  it("pure agreement rule: exact trimmed text match agrees, anything else diverges", () => {
    expect(consistency.signalOutputsAgree("HOLD caution ", "HOLD caution")).toBe(true)
    expect(consistency.signalOutputsAgree("GO long", "SELL now")).toBe(false)
    expect(consistency.signalOutputsAgree({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(consistency.signalOutputsAgree({ a: 1 }, { a: 2 })).toBe(false)
  })
})
