// @vitest-environment jsdom
// S5/T5.1–T5.2 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: the Pack Registry strip.
// The strip renders server-OBSERVED step status with an "as of" timestamp;
// a failed fetch renders "registry unreachable", never fabricated rows; the
// ack button exists ONLY on stopped-at-human steps and POSTs the human
// handoff (the ONLY legal exit); the footer shows the §8.5 caps as read-only
// server env truth (never guessed by the browser).
// fetch is stubbed so no network ever leaves the test.
import { afterEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { PackRegistryStrip } from "@/components/PackRegistryStrip"
import type { PackRegistryPayload } from "@/lib/packRegistry"

function mount(node: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<>{node}</>) })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

function stubFetch(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload
  } as unknown as Response)))
}

const ctx = {
  totalBudgetUsd: 0,
  capExBudgetUsd: 0,
  env: "dev",
  ownerCountry: "BD"
}

const registry = (steps: Record<string, { status: string; detail?: string | null; pathway?: unknown }>) => ({
  ok: true,
  registry: {
    version: 1,
    updatedAt: "2026-09-14T10:00:00.000Z",
    ...ctx,
    packs: [
      {
        id: "pack1-local-trading-core",
        label: "Local Trading Core",
        gateSet: ["hasApiKey", "hasCredentials", "hasVapid", "dependencyAvailable"],
        steps: [
          {
            id: "p1-1-eo-session-capture",
            label: "EO session capture",
            kind: "l-class",
            envelope: { tier: "T0", cadenceMs: 1_800_000, rpmCeiling: 0, needs: "human demo-session login" },
            status: steps["p1-1-eo-session-capture"]?.status ?? "idle",
            detail: steps["p1-1-eo-session-capture"]?.detail ?? null,
            pathway: steps["p1-1-eo-session-capture"]?.pathway ?? null,
            lastObservedAt: "2026-09-14T09:59:00.000Z",
            lastError: null,
            acknowledgedBy: null,
            evidence: [{ ts: "2026-09-14T09:59:00.000Z", status: "stopped", detail: "token expired", observed: { present: true } }]
          },
          {
            id: "p1-2-ccxt-data-poll",
            label: "CCXT market-data poll",
            kind: "run",
            envelope: { tier: "T1", cadenceMs: 15_000, rpmCeiling: 60, needs: "≥1 ccxt pair configured" },
            status: steps["p1-2-ccxt-data-poll"]?.status ?? "idle",
            detail: steps["p1-2-ccxt-data-poll"]?.detail ?? null,
            lastObservedAt: "2026-09-14T09:59:45.000Z",
            lastError: null,
            acknowledgedBy: null,
            evidence: []
          },
          {
            id: "p1-3-news-digest",
            label: "News digest",
            kind: "run",
            envelope: { tier: "T3", cadenceMs: 600_000, rpmCeiling: 6, needs: "free news feeds" },
            status: steps["p1-3-news-digest"]?.status ?? "idle",
            detail: steps["p1-3-news-digest"]?.detail ?? null,
            lastObservedAt: null,
            lastError: null,
            acknowledgedBy: null,
            evidence: []
          },
          {
            id: "p1-4-signal-notifications",
            label: "Signal notifications",
            kind: "run",
            envelope: { tier: "T1", cadenceMs: 45_000, rpmCeiling: 0, needs: "in-app channel" },
            status: steps["p1-4-signal-notifications"]?.status ?? "idle",
            detail: steps["p1-4-signal-notifications"]?.detail ?? null,
            lastObservedAt: "2026-09-14T09:59:30.000Z",
            lastError: null,
            acknowledgedBy: null,
            evidence: []
          }
        ]
      }
    ]
  },
  caps: { maxRamMb: 4096, maxCpuPct: 50, maxStorageMb: 2048 }
}) as unknown as PackRegistryPayload

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("PackRegistryStrip (S5/T5.1)", () => {
  it("renders every observed step status + envelope fact line + 'as of' timestamp; never echoes credentials", async () => {
    stubFetch(registry({
      "p1-1-eo-session-capture": { status: "stopped-at-human", detail: "token expired — re-login in the extension" },
      "p1-2-ccxt-data-poll": { status: "running", detail: "polls ok" },
      "p1-3-news-digest": { status: "skipped-unconfigured", detail: "no feeds configured" },
      "p1-4-signal-notifications": { status: "idle" }
    }))
    const m = mount(<PackRegistryStrip />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    expect(text).toContain("Pack registry")
    expect(text).toContain("as of")
    expect(text).toContain("EO session capture")
    expect(text).toContain("stopped-at-human")
    expect(text).toContain("CCXT market-data poll")
    expect(text).toContain("running")
    expect(text).toContain("News digest")
    expect(text).toContain("skipped-unconfigured")
    expect(text).toContain("Signal notifications")
    expect(text).toContain("idle")
    // envelope fact lines (tier · cadence · rpm)
    expect(text).toContain("T0")
    expect(text).toContain("30min")
    expect(text).toContain("T1")
    expect(text).toContain("≤6 rpm")
    // evidence.observed values (presence-flags/handoffs) are config detail,
    // but secret-shaped values must never be echoed by the strip
    expect(m.host.querySelectorAll("[data-secret]")).toHaveLength(0)
    m.unmount()
  })

  it("shows the honest unreachable message instead of fabricated rows when the endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "registry exploded" })
    } as unknown as Response)))
    const m = mount(<PackRegistryStrip />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    expect(text).toContain("registry unreachable")
    expect(text).toContain("registry exploded")
    // no step row is fabricated
    expect(text).not.toContain("EO session capture")
    expect(text).not.toContain("running")
    m.unmount()
  })

  it("renders the workflow pathway prompt (structured steps + ack) on a stopped L-class step; never elsewhere", async () => {
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
    stubFetch(registry({
      "p1-1-eo-session-capture": { status: "stopped-at-human", detail: "needs: re-login", pathway },
      "p1-2-ccxt-data-poll": { status: "running", detail: "polls ok" }
    }))
    const m = mount(<PackRegistryStrip />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    // the structured workflow prompt (owner Q2) is exposed with the ack button
    expect(text).toContain("Manual login required")
    expect(text).toContain("Open the ExpertOption app tab for the capture leg you use")
    expect(text).toContain("Log in AGAIN to the DEMO account manually")
    expect(text).toContain("acknowledge this handoff in the packs strip")
    expect(m.host.querySelector('button[aria-label="ack p1-1-eo-session-capture"]')).toBeTruthy()
    // running steps never render a pathway block (nothing to do)
    const p1 = m.host.querySelector('[data-step="p1-1-eo-session-capture"]')!
    const p2 = m.host.querySelector('[data-step="p1-2-ccxt-data-poll"]')!
    expect(p2.textContent).not.toContain("Manual login required")
    expect(p1.querySelector("ol")).toBeTruthy()
    expect(p2.querySelector("ol")).toBeNull()
    m.unmount()
  })

  it("renders the 'capture' pathway on a SKIPPED step (PICC settings kill-switch) with NO ack button — the settings toggle re-arms it", async () => {
    const pathway = {
      need: "capture",
      prompt: "Session capture is disabled in PICC settings — re-enable it there to resume. PICC never enables capture on its own.",
      steps: [
        "Open the PICC Settings page (Settings → Session capture).",
        "Turn the session-capture toggle ON.",
        "Back on the packs strip, the step re-arms from skipped-unconfigured on the next pass."
      ]
    }
    stubFetch(registry({
      "p1-1-eo-session-capture": { status: "skipped-unconfigured", detail: "session-capture-disabled", pathway },
      "p1-2-ccxt-data-poll": { status: "running", detail: "polls ok" }
    }))
    const m = mount(<PackRegistryStrip />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    // the settings-kill-switch pathway is surfaced (owner: "prompts you to
    // enable session capture in PICC settings") even though the step is
    // skipped-unconfigured, NOT stopped-at-human
    expect(text).toContain("Session capture is disabled in PICC settings")
    expect(text).toContain("Settings → Session capture")
    const p1 = m.host.querySelector('[data-step="p1-1-eo-session-capture"]')!
    expect(p1.querySelector('[data-pathway="capture"]')).toBeTruthy()
    expect(p1.querySelector("ol")).toBeTruthy()
    // capture is a PICC-settings action — the ack button stays ONLY on
    // stopped-at-human handoffs; the toggle re-arms, never the ack
    expect(m.host.querySelector('button[aria-label="ack p1-1-eo-session-capture"]')).toBeNull()
    m.unmount()
  })

  it("acks ONLY stopped-at-human: L-class chip + ack button on p1-1, never on run steps", async () => {
    stubFetch(registry({
      "p1-1-eo-session-capture": { status: "stopped-at-human", detail: "token expired — re-login" },
      "p1-2-ccxt-data-poll": { status: "running", detail: "polls ok" }
    }))
    const m = mount(<PackRegistryStrip />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    // the L-class handoff chip is exact and honest
    expect(text).toContain("needs human: re-login")
    const ack = m.host.querySelector('button[aria-label="ack p1-1-eo-session-capture"]')
    expect(ack).toBeTruthy()
    expect(m.host.querySelector('button[aria-label="ack p1-2-ccxt-data-poll"]')).toBeNull()
    expect(m.host.querySelector('button[aria-label="ack p1-3-news-digest"]')).toBeNull()
    expect(m.host.querySelector('button[aria-label="ack p1-4-signal-notifications"]')).toBeNull()
    m.unmount()
  })

  it("clicking ack POSTs the human handoff and re-renders the re-armed step", async () => {
    const posts: { path: string; body: { packId: string; stepId: string } }[] = []
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ path: String(path), body: JSON.parse(String(init.body)) as { packId: string; stepId: string } })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            step: {
              id: "p1-1-eo-session-capture",
              label: "EO session capture",
              kind: "l-class",
              envelope: { tier: "T0", cadenceMs: 1_800_000, rpmCeiling: 0, needs: "human demo-session login" },
              status: "idle",
              detail: "human handoff acknowledged — step re-armed",
              lastObservedAt: "2026-09-14T10:01:00.000Z",
              lastError: null,
              acknowledgedBy: "human",
              evidence: [{ ts: "2026-09-14T10:01:00.000Z", status: "acknowledged", detail: "human handoff acknowledged (human)", observed: null }]
            }
          })
        } as unknown as Response
      }
      // before any ack the step is stopped-at-human; after the ack the fresh
      // read shows it re-armed to idle (the strip never fabricates the re-arm)
      const stopped = posts.length === 0
      return {
        ok: true,
        status: 200,
        json: async () => registry({
          "p1-1-eo-session-capture": stopped
            ? { status: "stopped-at-human", detail: "token expired — re-login in the extension" }
            : { status: "idle", detail: "human handoff acknowledged — step re-armed" }
        })
      } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const m = mount(<PackRegistryStrip />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    expect(m.host.querySelector('button[aria-label="ack p1-1-eo-session-capture"]')).toBeTruthy()

    const ack = m.host.querySelector('button[aria-label="ack p1-1-eo-session-capture"]') as HTMLButtonElement
    ack.click()
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})

    expect(posts).toEqual([{ path: "/api/packs/ack", body: { packId: "pack1-local-trading-core", stepId: "p1-1-eo-session-capture" } }])
    const after = m.host.textContent ?? ""
    expect(after).toContain("human handoff acknowledged")
    expect(m.host.querySelector('button[aria-label="ack p1-1-eo-session-capture"]')).toBeNull()
    m.unmount()
  })
})

describe("PackRegistryStrip footer (S5/T5.2)", () => {
  it("renders the §8.5 caps as read-only server env truth with the config note; no settings affordance", async () => {
    stubFetch(registry({}))
    const m = mount(<PackRegistryStrip />)
    await new Promise((r) => setTimeout(r, 10))
    flushSync(() => {})
    const text = m.host.textContent ?? ""
    expect(text).toContain("RAM 4096MB")
    expect(text).toContain("CPU 50%")
    expect(text).toContain("storage 2048MB")
    expect(text).toContain("PICC_RESOURCE_*")
    expect(m.host.querySelector('a[href*="settings"], button[aria-label*="resource" i]')).toBeNull()
    m.unmount()
  })
})