// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import MinistryShell from "@/pages/MinistryShell"
import { SUITE_META } from "@/lib/suites"

function mountAt(path: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/suites/:suiteId/*" element={<MinistryShell />} />
        </Routes>
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

describe("MinistryShell", () => {
  let mounted: Array<{ unmount: () => void }> = []

  afterEach(() => {
    // Unmount before global teardown so a failing test never ghosts a live
    // MinistryShell into the next test's document.
    mounted.forEach((m) => m.unmount())
    mounted = []
  })

  it("renders the trading ministry's inner sidebar", () => {
    const m = mountAt("/suites/trading")
    mounted.push(m)
    expect(m.host.textContent).toContain(SUITE_META.trading.label)
    expect(m.host.textContent).toContain("Dashboard") // inner nav
    expect(m.host.textContent).toContain("Markets")
  })

  it("renders the earnings ministry's label + under-development marker", () => {
    const m = mountAt("/suites/earnings")
    mounted.push(m)
    expect(m.host.textContent).toContain(SUITE_META.earnings.label)
    expect(m.host.textContent).toContain("under development")
  })

  it("renders the intelligence ministry's governor entry", () => {
    const m = mountAt("/suites/intelligence")
    mounted.push(m)
    expect(m.host.textContent).toContain(SUITE_META.intelligence.label)
    expect(m.host.textContent).toContain("Governor")
  })

  it("renders an honest unknown-ministry message", () => {
    const m = mountAt("/suites/nope")
    mounted.push(m)
    expect(m.host.textContent).toContain("Unknown ministry")
  })
})