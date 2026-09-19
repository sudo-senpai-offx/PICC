// @vitest-environment jsdom
// Ministry index landing (UX-2 + UX-3):
//  - fresh suite  -> navlinks only, no marketing copy, no other-suite cards
//  - stored room  -> the suite reopens on the last closed room
//  - stale room   -> falls through to the landing, never a dead link
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { Suites } from "@/pages/Suites"

async function waitFor(check: () => boolean, what: string, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
  flushSync(() => {})
}

const ROOM_PROBE = 'div[data-room-probe]'

function mountAt(path: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/suites/:suiteId" element={<Suites />} />
          <Route path="/suites/:suiteId/:room" element={<div data-room-probe>room hit</div>} />
        </Routes>
      </MemoryRouter>
    )
  })
  return {
    host,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

describe("ministry index landing (UX-2/UX-3)", () => {
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    mounted = []
    localStorage.clear()
  })

  afterEach(() => {
    mounted.forEach((m) => m.unmount())
    mounted = []
  })

  it("fresh suite shows only its own nav links — no marketing copy, no other-suite cards", () => {
    const m = mountAt("/suites/trading")
    mounted.push(m)
    expect(m.host.querySelector("h1")?.textContent).toBe("Trading")
    for (const label of ["Dashboard", "Markets", "Paper", "Autopilot", "Command Centre", "Simulator", "Studio", "Settings"]) {
      expect(m.host.textContent).toContain(label)
    }
    expect(m.host.textContent).not.toContain("Every income-source category")
    expect(m.host.textContent).not.toContain("Manageable")
    // The outer sidebar owns suite switching: no other-ministry links here.
    expect(m.host.textContent).not.toContain("Intelligence for PICC")
    expect(m.host.querySelector(ROOM_PROBE)).toBeNull() // no redirect on fresh state
  })

  it("reopens the last closed room when one is stored", async () => {
    localStorage.setItem("picc.ministry.trading.lastRoom", "markets")
    const m = mountAt("/suites/trading")
    mounted.push(m)
    await waitFor(() => !!m.host.querySelector(ROOM_PROBE), "redirect to the stored room")
  })

  it("a stored room that no longer exists falls back to the landing (never a dead link)", () => {
    localStorage.setItem("picc.ministry.trading.lastRoom", "removed-room")
    const m = mountAt("/suites/trading")
    mounted.push(m)
    expect(m.host.querySelector(ROOM_PROBE)).toBeNull()
    expect(m.host.textContent).toContain("Markets")
  })

  it("rooms are per-suite: earnings history never resumes a trading room", () => {
    localStorage.setItem("picc.ministry.earnings.lastRoom", "settings")
    const m = mountAt("/suites/trading")
    mounted.push(m)
    expect(m.host.querySelector(ROOM_PROBE)).toBeNull()
    expect(m.host.textContent).toContain("Markets")
  })
})