// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { SettingsRoom } from "@/pages/ministry/SettingsRoom"
import { getMinistrySettings } from "@/lib/ministrySettings"

function mountAt(path: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/suites/:suiteId/*" element={<SettingsRoom />} />
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

describe("SettingsRoom", () => {
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    mounted.forEach((m) => m.unmount())
    mounted = []
    localStorage.clear()
  })

  it("renders the two per-ministry controls", () => {
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    expect(m.host.textContent).toContain("Autopilot mode")
    expect(m.host.textContent).toContain("Confidence threshold")
    expect(m.host.textContent).toContain("stored locally on this machine per ministry")
  })

  it("persists a mode flip to copilot via saveMinistrySettings", () => {
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    const toggle = m.host.querySelector("input[type=checkbox]") as HTMLInputElement | null
    expect(toggle).not.toBeNull()
    flushSync(() => {
      toggle!.click()
    })
    expect(getMinistrySettings("trading").mode).toBe("copilot")
  })
})