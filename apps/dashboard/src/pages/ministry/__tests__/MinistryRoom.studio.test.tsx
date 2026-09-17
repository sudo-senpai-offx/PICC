// @vitest-environment jsdom
// Regression test: the shared browser studio is intentionally NOT part of the
// suite inner sidebars. The studio is its own top-level surface (/studio) and
// a separate real browser window; suite rooms are ministry-specific surfaces.
// Previously the suite-level entrypoints were wired (studio room + INNER_NAV
// entry per suite); that wiring was removed 2026-09-16. This file pins the
// absence so a future re-introduction without owner approval is caught.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import MinistryShell, { INNER_NAV } from "@/pages/MinistryShell"
import { MinistryRoom } from "@/pages/ministry/MinistryRoom"

vi.mock("@/lib/api", () => ({
  getBrowserStatus: vi.fn().mockResolvedValue({ ok: true, available: true, open: false }),
  openBrowser: vi.fn().mockResolvedValue({ ok: true }),
  closeBrowser: vi.fn().mockResolvedValue({ ok: true }),
  browserGoto: vi.fn().mockResolvedValue({ ok: true }),
  browserNav: vi.fn().mockResolvedValue({ ok: true }),
  browserTab: vi.fn().mockResolvedValue({ ok: true }),
  getBrowserSettings: vi.fn(),
  saveBrowserSettings: vi.fn(),
  streamBrowser: () => ({ close: vi.fn() })
}))

function mountAt(path: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/suites/:suiteId" element={<MinistryShell />}>
            <Route index element={<div>suite landing</div>} />
            <Route path="*" element={<MinistryRoom />} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
  })
  return { host, root, unmount() { flushSync(() => { root.unmount() }); document.body.removeChild(host) } }
}

describe("suite inner sidebars never expose the shared browser studio", () => {
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    mounted.forEach((m) => m.unmount())
    mounted = []
  })

  it("INNER_NAV has no 'studio' entry in any suite", () => {
    for (const suiteId of ["trading", "earnings", "intelligence"]) {
      const tos = (INNER_NAV[suiteId] ?? []).map((e) => e.to)
      expect(tos).not.toContain("studio")
    }
  })

  it.each([
    "/suites/trading/studio",
    "/suites/earnings/studio",
    "/suites/intelligence/studio"
  ])("does not render the studio surface at %s", (path) => {
    const m = mountAt(path)
    mounted.push(m)
    // The inner sidebar offers no studio entry…
    expect(m.host.textContent).not.toContain("Browser Studio")
    // …and the room itself is not the studio management surface.
    expect(m.host.querySelector("[data-testid='studio-page']")).toBeNull()
  })
})