// WS-7 T2 diagnostic — WHERE does the room-transition time actually go?
//
// The recorded budget evidence reports a 2747ms p95 for a legacy suite route
// transition at 6x CPU throttle against a 250ms budget. A single stopwatch
// reading does not say what to fix, and it cannot tell a cold cache from a slow
// render. Two very different causes look identical:
//
//   RENDER-BOUND  mounting/unmounting components dominates.
//   DATA-BOUND   the route changes instantly but the room marker only appears
//                 after a network round-trip, so the stopwatch measures a fetch.
//
// A first attempt at this diagnostic timestamped from Playwright's side and
// read the split from inside the page. That was WRONG: the in-page clock
// started after the outer t0, producing negative residuals. The split below is
// taken entirely INSIDE the page so both timestamps share one clock.
//
// Instrumentation is installed before the loop and is idempotent. It is
// read-only: it observes and asserts nothing about product behaviour, and fails
// loudly if the room markers disappear so it cannot rot into a green lie.
import { expect, test } from "@playwright/test"
import { useSharedSession } from "../e2e/sharedAuth"

// Read-only spec: shares one authenticated account for the whole run instead of
// spending the auth rate limiter's budget. See sharedAuth.ts.
async function signupAndLogin(page, request) {
  await useSharedSession(page, request)
  await page.goto("/markets")
  await expect(page).not.toHaveURL(/\/login(?:$|\?)/)
}

const INSTALL_PROBE = () => {
  const w = window
  if (w.__ws7probe) return
  w.__ws7probe = {
    armed: false,
    clickedAt: null,
    fromRoom: null,
    routeAt: null,
    roomAt: null,
    roomName: null
  }

  // Capture-phase so we stamp the click before any framework handler runs.
  w.addEventListener(
    "click",
    () => {
      const p = w.__ws7probe
      // The room being LEFT, read while it is still mounted, and read BEFORE
      // clickedAt is stamped so the probe's own cost stays outside the window
      // routeMs is measured over.
      p.fromRoom = document.querySelector("[data-room]")?.getAttribute("data-room") ?? null
      p.clickedAt = performance.now()
      p.routeAt = null
      p.roomAt = null
      p.roomName = null
    },
    true
  )

  // Client-side routing commits through history; stamp the moment it does.
  const push = w.history.pushState.bind(w.history)
  w.history.pushState = function patched(...args) {
    const r = push(...args)
    if (w.__ws7probe.clickedAt !== null && w.__ws7probe.routeAt === null) {
      w.__ws7probe.routeAt = performance.now()
    }
    return r
  }

  // The room marker CHANGING is the render completing. This observer watches the
  // whole document, so it also sees unrelated mutations, and the outgoing room
  // keeps ticking its own timers until React commits the new one. Only a room
  // that differs from the one we left counts; stamping the first mutation seen
  // instead recorded the OUTGOING room and, being single-shot, never corrected.
  const target = document.documentElement
  const observer = new MutationObserver(() => {
    const el = document.querySelector("[data-room]")
    const p = w.__ws7probe
    if (!el || p.clickedAt === null || p.roomAt !== null) return
    const room = el.getAttribute("data-room")
    if (room === null || room === p.fromRoom) return
    p.roomAt = performance.now()
    p.roomName = room
  })
  const start = () => observer.observe(target, { attributes: true, childList: true, subtree: true })
  if (document.documentElement) start()
  else w.addEventListener("DOMContentLoaded", start, { once: true })
}

test.describe("WS-7 T2 diagnostic", () => {
  test.setTimeout(300_000)
  // Same floor the budget is defined against.
  test.use({ viewport: { width: 1280, height: 800 } })

  test("decomposes the room transition and exposes warm-up", async ({ page, request }) => {
    await signupAndLogin(page, request)
    await page.goto("/suites/trading/dashboard", { waitUntil: "domcontentloaded" })
    await page.waitForSelector("[data-room='dashboard']", { timeout: 30_000 })

    await page.evaluate(INSTALL_PROBE)

    // Throttle to the same rate the recorded budget evidence uses, so this is
    // comparable with the 2747ms figure rather than a different regime.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 })

    const rows = []
    for (let i = 0; i < 8; i++) {
      await page.click("a[href='/suites/trading/markets']").catch(() => {})
      // Wait on the PROBE, not just the DOM. The read below takes roomName from
      // the probe, and the observer that writes it has no ordering guarantee
      // against a selector wait, so the two could disagree.
      //
      // THE ONLY CONJUNCT THAT ACTUALLY BLOCKS IS `q.roomName === expected`.
      // This comment used to credit a different mechanism: "The click handler
      // nulls roomAt/roomName and sets fromRoom, so a stale stamp cannot satisfy
      // this." It does null them - but that is not what holds this wait, and the
      // other two conjuncts are NOT a safety net. Traced through the swallowed-
      // click case, `q.roomAt` is still non-null and `q.roomName !== q.fromRoom`
      // is already true, so both are satisfied by the previous iteration's state
      // and discriminate nothing. They are cheap sanity checks on the probe, not
      // the mechanism.
      //
      // So: do NOT "simplify" this predicate down to the two room fields, and do
      // not drop the equality on the grounds that the others look sufficient.
      // `q.roomName === expected` is the conjunct that makes a swallowed click
      // time out loudly instead of recording a sample the probe never took.
      await page.waitForFunction(
        (expected) => {
          const q = window.__ws7probe
          return (
            q != null &&
            q.roomAt !== null &&
            q.fromRoom != null &&
            q.roomName === expected &&
            q.roomName !== q.fromRoom
          )
        },
        "markets",
        { timeout: 15_000 }
      )

      const p = await page.evaluate(() => {
        const q = window.__ws7probe
        return {
          clickedAt: q.clickedAt,
          routeAt: q.routeAt,
          roomAt: q.roomAt,
          roomName: q.roomName,
          url: location.pathname
        }
      })

      // All three timestamps come from the same in-page clock, so the deltas
      // are directly comparable and cannot go negative by construction.
      const routeMs = p.routeAt === null ? null : Math.round(p.routeAt - p.clickedAt)
      const renderMs = p.roomAt === null || p.routeAt === null ? null : Math.round(p.roomAt - p.routeAt)
      rows.push({
        i,
        routeMs,
        renderMs,
        totalMs: routeMs === null ? null : routeMs + (renderMs ?? 0),
        roomName: p.roomName,
        url: p.url
      })

      await page.click("a[href='/suites/trading/dashboard']").catch(() => {})
      await page.waitForSelector("[data-room='dashboard']", { timeout: 15_000 })
    }

    console.log("WS7_T2_DECOMPOSITION " + JSON.stringify(rows))

    const usable = rows.filter((r) => r.totalMs !== null)
    expect(usable.length, "every sample must produce an in-page total").toBe(rows.length)
    for (const r of rows) {
      expect(r.totalMs, "total must be positive").toBeGreaterThan(0)
      expect(r.roomName, "the markets room marker must be what rendered").toBe("markets")
      expect(r.url, "the route must actually have changed").toContain("/markets")
    }

    // Report the warm-up shape explicitly. This is the finding: if the last
    // samples are far cheaper than the first, a p95 over all samples is
    // reporting cold-start cost, not steady-state cost.
    const totals = usable.map((r) => r.totalMs as number)
    const first = totals.slice(0, 3)
    const last = totals.slice(-3)
    const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
    const summary = {
      firstThreeAvgMs: avg(first),
      lastThreeAvgMs: avg(last),
      warmUpRatio: Number((avg(first) / avg(last)).toFixed(2)),
      routeAvgMs: avg(usable.map((r) => r.routeMs as number)),
      renderAvgMs: avg(usable.map((r) => (r.renderMs ?? 0) as number))
    }
    console.log("WS7_T2_SUMMARY " + JSON.stringify(summary))
  })
})
