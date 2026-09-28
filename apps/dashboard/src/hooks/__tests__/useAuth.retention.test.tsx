// @vitest-environment jsdom
// Regression guard for the RETENTION BOUND on an inconclusive /api/auth/me.
//
// A valid session must survive inconclusive answers — that was the point of the
// resilience fix. But retaining it with no upper bound is its own defect: a
// permanently unreachable backend leaves a permanently "logged in" shell whose
// every request fails, and a session that was genuinely revoked never redirects
// cleanly. So the tolerance is bounded and then the user is signed out.
//
// This drives the REAL hook (no mocking of @/lib/auth) and only fakes `fetch`,
// so it exercises fetchMe() and useAuth() together through their public
// contract rather than asserting on internals.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { useAuth, MAX_INCONCLUSIVE_CHECKS, INCONCLUSIVE_RETRY_DELAYS_MS } from "@/hooks/useAuth"

const KEY = "picc.auth"
const USER = { id: "u1", email: "e@example.test", name: "E" }

type AuthState = { session: { access_token: string; user?: unknown } | null; loading: boolean }

let latest: AuthState | null = null

function Probe() {
  latest = useAuth()
  return null
}

function mountProbe() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<Probe />)
  })
  return {
    unmount() {
      act(() => root.unmount())
      document.body.removeChild(host)
    }
  }
}

function sessionInStorage() {
  return window.localStorage.getItem(KEY)
}

/** One repeated /me answer. */
function answerWith(status: number, body: unknown = { error: "auth store unavailable" }) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }))
}

/**
 * Advance fake timers in small steps, flushing React between each.
 *
 * The steps matter. Each re-check resolves a promise, sets state, and only then
 * schedules the next timer — so if the clock is advanced in one jump, the timer
 * for the next attempt is created AFTER the window has already passed and never
 * fires. Stepping with an act() flush between steps lets the effect chain
 * actually advance, which is what makes the ladder observable.
 */
async function advance(totalMs: number) {
  const STEP_MS = 25
  let elapsed = 0
  // do/while so a zero-length advance still performs one act() flush — that is
  // how a mount-time answer with no backoff gets applied.
  do {
    const step = Math.min(STEP_MS, Math.max(totalMs - elapsed, 0))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step)
    })
    elapsed += step
  } while (elapsed < totalMs)
}

const LADDER_MS = INCONCLUSIVE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)
const CEILING_MS = INCONCLUSIVE_RETRY_DELAYS_MS[INCONCLUSIVE_RETRY_DELAYS_MS.length - 1]

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  window.localStorage.setItem(KEY, JSON.stringify({ access_token: "tok", user: USER }))
  latest = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe("useAuth bounds how long an unprovable session is retained", () => {
  it("keeps the session across every tolerated inconclusive answer", async () => {
    const fetchMock = answerWith(503)
    vi.stubGlobal("fetch", fetchMock)
    const probe = mountProbe()

    // Enough clock for the whole tolerated ladder, but short of the extra step
    // that triggers the sign-out decision.
    await advance(LADDER_MS)

    // Retried rather than giving up…
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    // …and still signed in with the stored session intact.
    expect(latest!.session).not.toBeNull()
    expect(sessionInStorage()).not.toBeNull()
    probe.unmount()
  })

  // THE FINDING. N+1 consecutive inconclusive answers must end the session.
  it(`signs out after ${MAX_INCONCLUSIVE_CHECKS + 1} consecutive inconclusive answers`, async () => {
    const fetchMock = answerWith(503)
    vi.stubGlobal("fetch", fetchMock)
    const probe = mountProbe()

    // Generous drain: the whole ladder plus the final backoff step, with slack
    // so the assertion is about the BEHAVIOUR (it eventually signs out) rather
    // than about the exact tick a fake clock lands on.
    await advance(LADDER_MS + CEILING_MS + 5_000)

    // More checks than the tolerance allows, and the session is gone.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(MAX_INCONCLUSIVE_CHECKS)
    expect(latest!.session).toBeNull()
    expect(sessionInStorage()).toBeNull()
    probe.unmount()
  })

  it("does NOT sign out on a single inconclusive answer", async () => {
    let n = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n += 1
        return n === 1
          ? { ok: false, status: 503, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({ ok: true, user: { ...USER, name: "Recovered" } }) }
      })
    )
    const probe = mountProbe()
    await advance(INCONCLUSIVE_RETRY_DELAYS_MS[0] + 50)

    // Recovered on the first re-check: still signed in, user refreshed.
    expect(latest!.session).not.toBeNull()
    expect(sessionInStorage()).not.toBeNull()
    probe.unmount()
  })

  it("signs out immediately on an authoritative 401 without retrying", async () => {
    const fetchMock = answerWith(401, { error: "not authenticated" })
    vi.stubGlobal("fetch", fetchMock)
    const probe = mountProbe()
    await advance(0)

    expect(latest!.session).toBeNull()
    expect(sessionInStorage()).toBeNull()
    // No inconclusive retry ladder for a real rejection.
    expect(fetchMock.mock.calls.length).toBe(1)
    probe.unmount()
  })

  it("keeps the backoff bounded so a dead backend is not hammered", async () => {
    const fetchMock = answerWith(503)
    vi.stubGlobal("fetch", fetchMock)
    const probe = mountProbe()

    await advance(CEILING_MS)
    const calls = fetchMock.mock.calls.length
    // A full ceiling window buys at most ONE further check.
    await advance(CEILING_MS)
    expect(fetchMock.mock.calls.length - calls).toBeLessThanOrEqual(1)
    probe.unmount()
  })
})
