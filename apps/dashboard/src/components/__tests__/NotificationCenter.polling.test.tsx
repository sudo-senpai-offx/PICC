// @vitest-environment jsdom
// RED loop for the NotificationCenter polling bug: the alerts poller spirals.
// Every successful /api/trading/alerts poll writes setLastCheck(Date.now()),
// which churns the useCallback identity, which re-runs the polling effect,
// which refetches immediately — a self-perpetuating request stream with no
// rate limiting. A healthy 10s poll issues exactly ONE alerts request in the
// mount window; the bug issues dozens in the same window.
import { describe, expect, it, vi, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { NotificationCenter } from "@/components/NotificationCenter"

vi.mock("@/hooks/useWebPush", () => ({
  useWebPush: () => ({ enabled: false, unavailable: true, enable: vi.fn() })
}))

vi.mock("@/components/IOSInstallBanner", () => ({
  IOSInstallBanner: () => null
}))

vi.mock("@/lib/api", () => ({
  getInterventions: vi.fn(async () => ({ proposals: [] })),
  respondIntervention: vi.fn()
}))

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<NotificationCenter />) })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

describe("NotificationCenter polling (rate-limited)", () => {
  afterEach(() => { vi.restoreAllMocks() })

  it("issues a BOUNDED number of /api/trading/alerts requests (~1 per poll, not a loop)", async () => {
    const calls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        calls.push(String(url))
        return { ok: true, json: async () => ({ ok: true, alerts: [] }) } as Response
      })
    )

    const m = mount()
    await new Promise((r) => setTimeout(r, 1200)) // well under one 10s poll interval
    m.unmount()

    const alertsCalls = calls.filter((u) => u.includes("/api/trading/alerts")).length
    expect(alertsCalls).toBeLessThanOrEqual(2)
  })
})