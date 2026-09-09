// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { NewsCard } from "@/components/TradingSuite"
import { getMarketNews } from "@/lib/trading"

vi.mock("@/lib/trading", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trading")>()
  return { ...actual, getMarketNews: vi.fn() }
})

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
  flushSync(() => {})
}

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(<NewsCard />)
  })
  return {
    host,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

function hintRendered(host: HTMLElement) {
  return host.textContent.includes("configure SERPER_API_KEY to enable live news")
}

describe("NewsCard degraded state (SP-4 Task 4.5)", () => {
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    mounted = []
    vi.mocked(getMarketNews).mockResolvedValue({
      ok: true,
      query: "test",
      source: "serper",
      items: [],
      degraded: { reason: "news_api_unconfigured" }
    })
  })

  afterEach(() => {
    mounted.forEach((m) => m.unmount())
    mounted = []
    vi.restoreAllMocks()
  })

  it("renders the honest reason + hint and never the empty-news message", async () => {
    const m = mount()
    mounted.push(m)
    await waitFor(() => hintRendered(m.host), "degraded live-news hint")
    expect(m.host.textContent).toContain("live news is not configured")
    expect(m.host.textContent).toContain("configure SERPER_API_KEY to enable live news")
    expect(m.host.textContent).not.toContain("No news found for that query.")
    expect(m.host.querySelectorAll("a.link").length).toBe(0)
  })

  it("maps an unknown degraded reason to the honest unavailable label", async () => {
    vi.mocked(getMarketNews).mockResolvedValue({
      ok: true,
      query: "test",
      source: "serper",
      items: [],
      degraded: { reason: "serper_outage" }
    })
    const m = mount()
    mounted.push(m)
    await waitFor(() => hintRendered(m.host), "degraded unavailable hint")
    expect(m.host.textContent).toContain("live news unavailable")
    expect(m.host.textContent).not.toContain("No news found for that query.")
    expect(m.host.querySelectorAll("a.link").length).toBe(0)
  })
})