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

/**
 * How long the one test below may wait for a LAZY room chunk to resolve, and why
 * the fix is the wait budget and NOT a per-test `timeout`.
 *
 * WHAT THE TEST IS ACTUALLY WAITING ON. `:107` mounts `/suites/earnings/
 * simulator`. `EARNINGS_ROOMS.simulator` is a `lazy(...)` component
 * (MinistryRoom.tsx:56), so `MinistryRoom` renders `<Room />` and the
 * `header[data-room="simulator"]` this test looks for DOES NOT EXIST until React
 * has resolved the dynamic `import("./EarningsRooms")`. The wait is on a module
 * load, not on a render, and not on a timer.
 *
 * WHY 1000ms WAS TOO SHORT. Measured with a scratch probe over 16 cold loads on
 * this host: 1207, 1297, 1367, 1510, 1615, 1705, 1742, 2185, 2251, 2338, 2413,
 * 2430, 2533, 2534, 2628, 2710ms — worst 2710ms. The SAME load again once warm
 * resolves in 4-5ms, which is why the cost is transform/registry cold-start and
 * not the component. `vi.waitFor`'s DEFAULT timeout is 1000ms, so the outcome
 * depended on whether Vite's transform cache happened to be warm: this test
 * failed at 1020ms and 1032ms run after run when this file was run alone, and
 * passed inside a full suite. That is the flake, and it is a cache-warmth
 * dependency rather than a concurrency one — the opposite of the two
 * server-side files fixed alongside it.
 *
 * WHY A PER-TEST `timeout` IS NOT THE FIX, stated because it is the obvious
 * wrong move. `vi.waitFor` enforces its OWN deadline and rejects on it; it never
 * consults `testTimeout`. The observed failures landed at 1020ms and 1032ms
 * under a 5000ms test ceiling, which is the proof. Raising only the test budget
 * would change nothing and the test would still be red.
 *
 * WHY 8000ms. ~3x the worst observed cold load (3 x 2710 = 8130), which is the
 * sizing convention `0dc9989` states for this repo, and it is inside the range
 * this repo already uses for exactly this kind of wait: `ministryRooms.test.tsx`
 * waits on this IDENTICAL element at `:93` with `timeoutMs = 3000` (`:18`), and
 * `SettingsRoom`/`HoldingsEditor`/`FinanceTracker` all use `WAIT = { timeout:
 * 5000 }`. This file was the one place that waited with no budget at all.
 *
 * WHY THE TEST CARRIES A LARGER CEILING STILL. A wait ceiling is only reachable
 * if it sits strictly INSIDE the test ceiling; otherwise vitest kills the test
 * first and a genuine failure is reported as an opaque "Test timed out in
 * 5000ms" instead of the assertion that actually failed. 10000ms leaves 2000ms
 * of headroom, so a chunk that genuinely never resolves still fails HERE, with
 * `expected null not to be null`, which is the diagnostic worth having.
 */
const LAZY_ROOM_WAIT_MS = 8_000
const LAZY_ROOM_TEST_MS = 10_000

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

  // WS-7 T7R-A. This file is the PARITY guard and carries no literal, so the
  // 2026-09-30 amendment (18/11 -> 22/15) needed no value change here — the
  // two assertions above pass unchanged once all four authorised keys are
  // present in BOTH surfaces. That is this guard working, not a gap in it.
  //
  // But "no value change" must not become "no evidence". A parity guard proves
  // the two surfaces AGREE; it cannot prove they agree on the RIGHT thing, so
  // this file adds the third-file consistency the amendment requires: the four
  // keys are named here, in the surface that actually serves them.
  it("serves all four keys authorised by the 2026-09-30 WS-6 §0.3 amendment", () => {
    for (const key of ["risk", "ceremony", "ministry", "strategy"] as const) {
      expect(INNER_NAV.trading.map((e) => e.to), `${key} must be advertised by INNER_NAV`).toContain(key)
      expect(Object.keys(MINISTRY_ROOMS.trading ?? {}), `${key} must be served by MINISTRY_ROOMS`).toContain(key)
    }
    // 22 across the nav, 22 served, 15 distinct — the numbers the amendment
    // records, asserted where parity lives rather than only where a literal is.
    const navTotal = Object.values(INNER_NAV).reduce((n, e) => n + e.length, 0)
    const servedTotal = Object.values(MINISTRY_ROOMS).reduce((n, rooms) => n + Object.keys(rooms).length, 0)
    const distinct = new Set(Object.values(INNER_NAV).flatMap((entries) => entries.map((e) => e.to))).size
    expect({ navTotal, servedTotal, distinct }).toEqual({ navTotal: 22, servedTotal: 22, distinct: 15 })
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

  it("still renders a known room through the normal path, with no reserved state", { timeout: LAZY_ROOM_TEST_MS }, async () => {
    const host = mountRoom("/suites/earnings/simulator")
    // Legacy rooms keep their own `data-room` header marker; the reserved state
    // is reserved for rooms that are genuinely NOT mapped.
    await vi.waitFor(() => {
      expect(host.querySelector("header[data-room='simulator']")).not.toBeNull()
    }, { timeout: LAZY_ROOM_WAIT_MS })
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
