// @vitest-environment jsdom
// WS-6 T2 — terminal shell + room routing integration (RED).
//
// T2 acceptance: AC-001/AC-002 pass; legacy deep links work; existing
// `data-room` hooks and auth/feature gates remain; each room can render a
// reserved state; no room directly opens a socket or accesses secrets.
//
// Two real integration risks are pinned here:
//  1. `MinistryRoom.tsx:61` returned `null` for an unmapped room — a blank
//     screen. WS-6 requires an explicit reserved state instead.
//  2. `MinistryRoom`'s per-suite room maps are a HAND-MAINTAINED DUPLICATE of
//     `INNER_NAV`'s keys with nothing asserting they agree, so a valid nav link
//     can silently 404 to blank.
import { describe, expect, it, afterEach, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { INNER_NAV } from "@/pages/MinistryShell"
import { MINISTRY_ROOMS } from "@/pages/ministry/MinistryRoom"
import { MinistryRoom } from "@/pages/ministry/MinistryRoom"
import { TerminalShell } from "../../components/TerminalShell"

let mounted: Array<{ unmount: () => void }> = []

function render(node: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(node))
  mounted.push({
    unmount() {
      flushSync(() => root.unmount())
      document.body.removeChild(host)
    }
  })
  return host
}

afterEach(() => {
  mounted.forEach((m) => m.unmount())
  mounted = []
  vi.restoreAllMocks()
})

describe("room-key parity — INNER_NAV vs MINISTRY_ROOMS", () => {
  it("serves exactly the rooms the nav advertises, for every suite", () => {
    for (const [suite, entries] of Object.entries(INNER_NAV)) {
      const advertised = entries.map((e) => e.to).sort()
      const served = Object.keys(MINISTRY_ROOMS[suite] ?? {}).sort()
      expect(served, `suite "${suite}" serves a different room set than its nav advertises`).toEqual(advertised)
    }
  })

  it("exposes the same total room count through both surfaces", () => {
    const navTotal = Object.values(INNER_NAV).reduce((n, e) => n + e.length, 0)
    const servedTotal = Object.values(MINISTRY_ROOMS).reduce((n, rooms) => n + Object.keys(rooms).length, 0)
    expect(servedTotal).toBe(navTotal)
  })
})

describe("MinistryRoom — unmapped room is honest, not blank", () => {
  function mountRoom(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/suites/:suiteId/*" element={<MinistryRoom />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it("renders an explicit reserved state for a room that is not mapped", () => {
    const host = mountRoom("/suites/trading/does-not-exist")
    // The old contract rendered `null`, i.e. a blank body.
    expect(host.textContent?.trim()).not.toBe("")
    expect(host.querySelector("[data-availability]")).not.toBeNull()
  })

  it("names the room and suite that were requested in the reserved state", () => {
    const host = mountRoom("/suites/trading/does-not-exist")
    expect(host.textContent).toContain("does-not-exist")
    expect(host.textContent).toContain("trading")
  })

  it("still renders a known room through the normal path, with no reserved state", async () => {
    const host = mountRoom("/suites/earnings/simulator")
    // Legacy rooms keep their own `data-room` header marker; the reserved state
    // is reserved for rooms that are genuinely NOT mapped.
    await vi.waitFor(() => {
      expect(host.querySelector("header[data-room='simulator']")).not.toBeNull()
    })
    expect(host.querySelector("[data-availability]")).toBeNull()
  })
})

describe("TerminalShell", () => {
  it("renders its title and children", () => {
    const host = render(
      <TerminalShell title="Markets" roomKey="markets">
        <div>room body</div>
      </TerminalShell>
    )
    expect(host.textContent).toContain("Markets")
    expect(host.textContent).toContain("room body")
  })

  it("exposes the room key for the existing data-room hooks", () => {
    const host = render(
      <TerminalShell title="Markets" roomKey="markets">
        <div>body</div>
      </TerminalShell>
    )
    expect(host.querySelector("[data-room-key='markets']")).not.toBeNull()
  })

  it("renders a reserved state when given one, instead of the children as if live", () => {
    const host = render(
      <TerminalShell
        title="Markets"
        roomKey="markets"
        reserved={{ status: "reserved", workstream: "WS-7", reason: "backtest engine not built" }}
      >
        <div data-testid="body">body</div>
      </TerminalShell>
    )
    expect(host.querySelector("[data-availability='reserved']")).not.toBeNull()
    expect(host.textContent).toContain("WS-7")
  })
})
