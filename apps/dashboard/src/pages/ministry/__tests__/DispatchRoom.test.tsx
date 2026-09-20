// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { DispatchRoom } from "../DispatchRoom"
import * as dispatchLib from "@/lib/dispatch"

const hookState = vi.hoisted(() => ({ connected: true, dispatch: null as null | { unread: number; entries: unknown[] } }))

vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({
    snapshot: { dispatch: hookState.dispatch },
    live: null,
    connected: hookState.connected,
    error: null
  })
}))

vi.mock("@/lib/dispatch", () => ({
  fetchDispatch: vi.fn(),
  markDispatchRead: vi.fn().mockResolvedValue({ ok: true }),
  KIND_LABEL: { decision: "Decision" },
  SEVERITY_LABEL: { info: "Info" }
}))

const mockedFetch = vi.mocked(dispatchLib.fetchDispatch)

async function waitFor(check: () => boolean, what: string, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
  flushSync(() => {})
}

describe("DispatchRoom", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.clearAllMocks()
    hookState.connected = true
    hookState.dispatch = null
    mockedFetch.mockResolvedValue({
      ok: true, unread: 1,
      entries: [{ id: "d1", kind: "decision", severity: "info", title: "EURUSD TRADE", body: "cost line passes", ref: null, ts: 1, read: false }]
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)
  })

  it("renders the inbox title and entries", async () => {
    flushSync(() => { root.render(<DispatchRoom />) })
    await waitFor(() => host.textContent?.includes("EURUSD TRADE") ?? false, "dispatch entry to render")
    expect(host.textContent).toContain("Dispatch")
    expect(host.textContent).toContain("EURUSD TRADE")
  })

  it("marks an entry read then refetches the inbox", async () => {
    flushSync(() => { root.render(<DispatchRoom />) })
    await waitFor(() => !!host.querySelector("[data-testid='read-d1']"), "read button")
    const btn = host.querySelector("[data-testid='read-d1']") as HTMLButtonElement
    btn.click()
    await waitFor(() => mockedFetch.mock.calls.length >= 2, "refetch after mark-read")
    expect(dispatchLib.markDispatchRead).toHaveBeenCalledWith("d1")
  })

  it("renders an honest empty state when there are no entries", async () => {
    mockedFetch.mockResolvedValue({ ok: true, unread: 0, entries: [] })
    flushSync(() => { root.render(<DispatchRoom />) })
    await waitFor(() => host.textContent?.includes("no dispatch yet") ?? false, "empty state")
  })

  it("shows the stale-guard line when the stream is disconnected", async () => {
    hookState.connected = false
    flushSync(() => { root.render(<DispatchRoom />) })
    await waitFor(() => host.textContent?.includes("reconnecting") ?? false, "disconnected guard")
  })
})