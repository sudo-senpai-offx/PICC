// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { DispatchBell } from "../DispatchBell"

vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({
    snapshot: { dispatch: { unread: 3, entries: [] } },
    live: null, connected: true, error: null
  })
}))

describe("DispatchBell", () => {
  afterEach(() => { vi.clearAllMocks() })

  it("renders the Dispatch nav link with the unread count", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    flushSync(() => {
      root.render(
        <MemoryRouter>
          <DispatchBell />
        </MemoryRouter>
      )
    })
    expect(host.textContent).toContain("Dispatch")
    expect(host.textContent).toContain("3")
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)
  })
})