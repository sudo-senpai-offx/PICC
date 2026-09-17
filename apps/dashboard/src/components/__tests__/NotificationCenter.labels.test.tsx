// @vitest-environment jsdom
// B-EXE-2 — truthful bell labels. Trade proposals render their OWN workflow
// name (a U4FA proposal stays "U4FA signal"; a suite proposal shows "Suite
// signal") instead of hard-coding "U4FA signal" for every source:trade row.
// Capture rows stay "Capture approval"; workflow rows are never shown (the
// bell only surfaces capture/trade pending proposals).
import { describe, expect, it, vi, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { getInterventions, type InterventionProposal, type InterventionState } from "@/lib/api"
import { NotificationCenter } from "@/components/NotificationCenter"

vi.mock("@/hooks/useWebPush", () => ({
  useWebPush: () => ({ enabled: false, unavailable: true, enable: vi.fn() })
}))

vi.mock("@/components/IOSInstallBanner", () => ({
  IOSInstallBanner: () => null
}))

vi.mock("@/lib/api", () => ({
  getInterventions: vi.fn(async () => ({ proposals: [] })),
  respondIntervention: vi.fn(async () => ({ proposals: [] }))
}))

const base = (over: Partial<InterventionProposal>): InterventionProposal => ({
  id: "p-1",
  source: "trade",
  workflowId: "suite-trade",
  workflowName: "Suite signal",
  tabId: null,
  stepIndex: 0,
  action: "order",
  label: "Suite up EURUSD",
  detail: "Confluence BUY 0.42 — stake $500.00 (5% riskPerTradePct of $10000.00 paper). PAPER ONLY: approving places a demo order; nothing touches a real account.",
  risk: "high",
  status: "pending",
  createdAt: 1_700_000_000_000,
  decidedAt: null,
  ...over
})

function state(proposals: InterventionProposal[]): InterventionState {
  return { ok: true, running: null, proposals }
}

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<NotificationCenter />) })
  return { host, root, unmount() { flushSync(() => { root.unmount() }); document.body.removeChild(host) } }
}

function openBell() {
  const btn = document.querySelector('[aria-label="Notifications"]') as HTMLButtonElement
  if (!btn) throw new Error("bell button missing")
  flushSync(() => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
  flushSync(() => {})
}

describe("NotificationCenter bell labels (B-EXE-2)", () => {
  const mounted: ReturnType<typeof mount>[] = []
  afterEach(() => {
    vi.restoreAllMocks()
    for (const m of mounted) m.unmount()
    mounted.length = 0
    document.body.innerHTML = ""
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, alerts: [] }) } as Response)))
  })

  it("a suite proposal (source:trade, Suite signal) renders its own name, not 'U4FA signal'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, alerts: [] }) } as Response)))
    vi.mocked(getInterventions).mockResolvedValue(state([base({})]))
    mounted.push(mount())
    openBell()

    await waitFor(() => document.body.textContent?.includes("Suite up EURUSD") === true, "suite row")
    const text = document.body.textContent ?? ""
    expect(text).toContain("Suite signal")
    expect(text).not.toContain("U4FA signal")
    expect(text).toContain("Confluence BUY 0.42")
    expect(text).toContain("PAPER ONLY")
  })

  it("a U4FA trade proposal still renders as 'U4FA signal' (unchanged)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, alerts: [] }) } as Response)))
    vi.mocked(getInterventions).mockResolvedValue(state([
      base({ id: "p-u4fa", workflowId: "u4fa-trade", workflowName: "U4FA signal", label: "U4FA up EURUSD (300s)" })
    ]))
    mounted.push(mount())
    openBell()

    await waitFor(() => document.body.textContent?.includes("U4FA up EURUSD (300s)") === true, "U4FA row")
    expect(document.body.textContent ?? "").toContain("U4FA signal")
  })

  it("a capture proposal still renders as 'Capture approval' (unchanged)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, alerts: [] }) } as Response)))
    vi.mocked(getInterventions).mockResolvedValue(state([
      base({ id: "p-cap", source: "capture", workflowId: "capture-ven", workflowName: "Venue headless", label: "Approve venue login" })
    ]))
    mounted.push(mount())
    openBell()

    await waitFor(() => document.body.textContent?.includes("Approve venue login") === true, "capture row")
    const text = document.body.textContent ?? ""
    expect(text).toContain("Capture approval")
    expect(text).toContain("Venue headless")
    expect(text).not.toContain("Suite signal")
  })

  it("a workflow-source proposal is never rendered by the bell (filter unchanged)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, alerts: [] }) } as Response)))
    vi.mocked(getInterventions).mockResolvedValue(state([
      base({ id: "p-suite", workflowName: "Suite signal", label: "Suite up EURUSD" }),
      base({ id: "p-wf", source: "workflow" as const, workflowId: "wf-1", workflowName: "User flow", label: "click Submit" })
    ]))
    mounted.push(mount())
    openBell()

    await waitFor(() => document.body.textContent?.includes("Suite up EURUSD") === true, "suite row")
    expect(document.body.textContent ?? "").not.toContain("click Submit")
  })
})