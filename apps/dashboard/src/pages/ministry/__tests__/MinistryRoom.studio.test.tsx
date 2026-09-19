// @vitest-environment jsdom
// Studio universality (UI-reskin REQ-D.2/3 + REQ-E.3).
//
// DELIBERATE REVERSAL — this file records the PRESENCE of the shared browser
// studio in every ministry. The 2026-09-16 removal decision (studio = its own
// top-level surface only; the suite-level entrypoints were unwired) is
// SUPERSEDED by docs/specs/PICC_FRONTEND_UI_RESKIN_v1.md REQ-D.2/3: every
// ministry's INNER_NAV lists "studio" (before settings) and
// /suites/:suiteId/studio resolves to the SAME shared Studio surface as the
// standalone page — one component reused three times, no forked logic, per
// REQ-E.3. The `/studio` route and primary sidebar entry stay.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { Suspense } from "react"
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

async function waitFor(check: () => boolean, what: string, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
  flushSync(() => {})
}

function mountAt(path: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/suites/:suiteId" element={<MinistryShell />}>
              <Route index element={<div>suite landing</div>} />
              <Route path="*" element={<MinistryRoom />} />
            </Route>
          </Routes>
        </Suspense>
      </MemoryRouter>
    )
  })
  return { host, root, unmount() { flushSync(() => { root.unmount() }); document.body.removeChild(host) } }
}

describe("suite inner sidebars expose the shared browser studio (REQ-D.2/3)", () => {
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    mounted.forEach((m) => m.unmount())
    mounted = []
  })

  it("INNER_NAV lists 'studio' in every suite, before settings", () => {
    for (const suiteId of ["trading", "earnings", "intelligence"]) {
      const entries = INNER_NAV[suiteId] ?? []
      const tos = entries.map((e) => e.to)
      expect(tos, `${suiteId} nav`).toContain("studio")
      expect(tos.indexOf("studio"), `${suiteId} studio before settings`).toBeLessThan(tos.indexOf("settings"))
    }
  })

  it.each([
    "/suites/trading/studio",
    "/suites/earnings/studio",
    "/suites/intelligence/studio"
  ])("renders the shared studio surface at %s", async (path) => {
    const m = mountAt(path)
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector("[data-testid='studio-page']"), "shared studio surface to render")
    // REQ-E.3: the per-ministry room surfaces the same observed status as the
    // standalone page. The mocked browser reports open:false, so the status chip
    // honestly reads "closed" — never a fabricated "live".
    const live = m.host.querySelector("[data-testid='studio-live']")
    expect(live?.textContent).toContain("closed")
  })
})