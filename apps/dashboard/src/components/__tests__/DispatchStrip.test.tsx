// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { DispatchStrip } from "../DispatchStrip"

let mockUnread = 2
let mockEntries: unknown[] = [{ id: "d1", kind: "decision", severity: "info", title: "Soak milestone", ts: 100, read: false }, { id: "d2", kind: "venue", severity: "warning", title: "Broker notice", ts: 99, read: false }]
vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({ snapshot: { dispatch: { unread: mockUnread, entries: mockEntries } }, live: null, connected: true, error: null })
}))

describe("DispatchStrip", () => {
  afterEach(() => { vi.clearAllMocks() })

  it("shows unread count and latest entries, linking to the Dispatch room", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    flushSync(() => {
      root.render(<MemoryRouter><DispatchStrip /></MemoryRouter>)
    })
    const text = host.textContent ?? ""
    expect(text).toContain("Dispatch")
    expect(text).toContain("2")
    expect(text).toContain("Soak milestone")
    expect(host.querySelector("a[href='/suites/trading/dispatch']")).toBeTruthy()
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)
  })
})