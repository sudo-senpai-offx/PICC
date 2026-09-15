// @vitest-environment jsdom
// Settings-page styling lock (missing-class bug family): every text/password
// input must carry the shared .input class and every action button the .btn
// set — while checkboxes deliberately stay native (a .input checkbox renders
// broken). The LLM-provider card renders async (getLLMSettings effect), so the
// provider assertions wait one microtask tick before flushSync.
import { describe, expect, it, vi, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { Settings } from "@/pages/Settings"
import { saveSessionCaptureSettings as saveSpy } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  getHealth: vi.fn(async () => null),
  getAgentSettings: vi.fn(async () => ({
    model: "agent-model",
    base_url: "https://api.groq.com/openai/v1",
    enabled: true,
    api_key_configured: false
  })),
  saveAgentSettings: vi.fn(async (s: Record<string, unknown>) => s),
  getLLMSettings: vi.fn(async () => ({
    order: ["openai", "groq", "custom"],
    providers: {
      openai: { id: "openai", label: "OpenAI", configured: true, apiKeySet: true, model: "gpt-4o-mini" },
      groq: { id: "groq", label: "Groq", configured: true, apiKeySet: true, model: "llama-3.3-70b-versatile" },
      custom: { id: "custom", label: "Custom", configured: false, apiKeySet: false, model: "my-model", baseUrl: "https://host/v1" }
    }
  })),
  saveLLMSettings: vi.fn(async (v: Record<string, unknown>) => ({ ok: true, ...v })),
  testLLMProvider: vi.fn(async () => ({ ok: true, model: "x", latencyMs: 12, reply: "hi" })),
  getSessionCaptureSettings: vi.fn(async () => ({ ok: true, enabled: true, configured: false })),
  saveSessionCaptureSettings: vi.fn(async (enabled: boolean) => ({ ok: true, settings: { enabled, configured: true } })),
  // ResourceGovernorPanel smoke: without this, the panel's mount effect hits
  // a missing export (mock factory replaces the whole module) and the tree
  // unmounts. The fixture is a valid, fully-observed overview.
  getResourceOverview: vi.fn(async () => ({
    ok: true,
    enabled: true,
    budgets: { t0ConfidenceThreshold: 0.6, t1MaxTokens: 500, t2BurstPerHour: 6, maxLedgerEntriesPerDay: 1000 },
    verdicts: { accepted: 1, throttled: 0, failed: 0 },
    perTier: {
      T0: { calls: 0, tokens: 0, latencyMs: 0, verdicts: { accepted: 0, throttled: 0, failed: 0 } },
      T1: { calls: 1, tokens: 200, latencyMs: 412, verdicts: { accepted: 1, throttled: 0, failed: 0 } },
      T2: { calls: 0, tokens: 0, latencyMs: 0, verdicts: { accepted: 0, throttled: 0, failed: 0 } },
      T3: { calls: 0, tokens: 0, latencyMs: 0, verdicts: { accepted: 0, throttled: 0, failed: 0 } }
    },
    burst: { hour: "2026-09-13T04", T2: { callsThisHour: 0, limitPerHour: 6 } },
    ledger: { entriesToday: 1, capped: false, days: ["2026-09-13"] },
    rows: [
      {
        created_at: "2026-09-13T04:40:02.283Z",
        feature: "news-digest",
        tier: "T1",
        verdict: "accepted",
        tokens: 200,
        latencyMs: 412,
        model: "llama3.2:3b"
      }
    ]
  }))
}))

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    )
  })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

const classes = (el: Element) => el.className.split(/\s+/)

describe("Settings page styling", () => {
  afterEach(() => { vi.restoreAllMocks() })

  it("Agents card: model/base-url/api-key inputs carry .input; save button carries .btn", () => {
    const m = mount()
    const model = m.host.querySelector('input[placeholder="openai/llama-3.3-70b-versatile"]')
    const baseUrl = m.host.querySelector('input[placeholder="https://api.groq.com/openai/v1"]')
    const apiKey = m.host.querySelector('input[placeholder="Enter an API key"]')
    expect(model).toBeTruthy()
    expect(classes(model!).includes("input")).toBe(true)
    expect(classes(baseUrl!).includes("input")).toBe(true)
    expect(classes(apiKey!).includes("input")).toBe(true)

    const save = Array.from(m.host.querySelectorAll("button")).find((b) => b.textContent?.includes("Save agent settings"))
    expect(save).toBeTruthy()
    const cl = classes(save!)
    expect(cl.includes("btn")).toBe(true)
    expect(cl.includes("btn-primary")).toBe(true)

    // Checkboxes stay native — a .input checkbox renders broken.
    const liveCheckbox = m.host.querySelector('input[type="checkbox"]')
    expect(liveCheckbox).toBeTruthy()
    expect(classes(liveCheckbox!).includes("input")).toBe(false)
    m.unmount()
  })

  it("AI providers card (async): provider inputs carry .input; Test/order/save buttons carry .btn", async () => {
    const m = mount()
    await new Promise((r) => setTimeout(r, 0)) // let the getLLMSettings effect land
    flushSync(() => {})

    const providerModelInputs = Array.from(m.host.querySelectorAll('input[placeholder="model id"]'))
    expect(providerModelInputs.length).toBeGreaterThanOrEqual(3) // openai + groq + custom
    for (const input of providerModelInputs) expect(classes(input).includes("input")).toBe(true)
    expect(m.host.querySelector('input[placeholder="https://host/v1"]')).toBeTruthy()

    for (const btn of Array.from(m.host.querySelectorAll("button"))) {
      const text = btn.textContent ?? ""
      const cl = classes(btn)
      if (text.includes("Save AI provider settings")) {
        expect(cl.includes("btn")).toBe(true)
        expect(cl.includes("btn-primary")).toBe(true)
      } else if (text.trim() === "Test") {
        expect(cl.includes("btn")).toBe(true)
        expect(cl.includes("btn-secondary")).toBe(true)
      } else if (text === "↑" || text === "↓") {
        expect(cl.includes("btn")).toBe(true)
        expect(cl.includes("btn-secondary")).toBe(true)
      }
    }
    m.unmount()
  })

  it("Session capture card (async): toggle renders, defaults ON-untouched, save flips with honest notice", async () => {
    const m = mount()
    await new Promise((r) => setTimeout(r, 0)) // let the getSessionCaptureSettings effect land
    flushSync(() => {})

    const label = Array.from(m.host.querySelectorAll("h2")).find((h) => h.textContent === "Session capture")
    expect(label).toBeTruthy()
    const checkbox = m.host.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeTruthy()
    // default-ON untouched: the "never changed" note is honest, not a silent off
    expect(m.host.textContent).toContain("never changed")
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    m.unmount()
  })

  it("Session capture OFF save: posts false and surfaces the disable notice", async () => {
    const m = mount()
    await new Promise((r) => setTimeout(r, 0))
    flushSync(() => {})

    const checkbox = Array.from(m.host.querySelectorAll('input[type="checkbox"]')).find(
      (cb) => cb.closest(".card")?.querySelector("h2")?.textContent === "Session capture"
    ) as HTMLInputElement
    expect(checkbox).toBeTruthy()
    checkbox.click()
    await new Promise((r) => setTimeout(r, 0))
    flushSync(() => {})

    expect(saveSpy).toHaveBeenCalledWith(false)
    expect(m.host.textContent).toMatch(/disabled/i)
    m.unmount()
  })
})