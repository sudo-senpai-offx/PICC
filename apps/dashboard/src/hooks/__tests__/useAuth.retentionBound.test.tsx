// @vitest-environment jsdom
// Behavioural red-then-green guard for the retention BOUND, deliberately
// written so it COMPILES against the pre-bound code.
//
// The companion suite (useAuth.retention.test.tsx) imports the tuning constants
// and so cannot even load before they exist — which proves the constants were
// added, but not that the behaviour changed. This file imports only `useAuth`
// and hard-codes the expected outcome, so against the old unbounded hook it
// runs and FAILS: the old hook called /me once, got an inconclusive answer,
// retained the session, and never re-checked or signed out. That is the actual
// defect, and this is the test that would have caught it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { useAuth } from "@/hooks/useAuth"

const KEY = "picc.auth"
const USER = { id: "u1", email: "e@example.test", name: "E" }

// 6 = the tolerance (5 re-checks) plus the answer that ends it.
const ANSWERS_BEFORE_SIGN_OUT = 6

let latest: { session: { access_token: string; user?: unknown } | null; loading: boolean } | null = null

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

async function advance(totalMs: number) {
  const STEP_MS = 25
  let elapsed = 0
  do {
    const step = Math.min(STEP_MS, Math.max(totalMs - elapsed, 0))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step)
    })
    elapsed += step
  } while (elapsed < totalMs)
}

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

describe("an unprovable session cannot be retained forever", () => {
  it(`gives up and signs out after ${ANSWERS_BEFORE_SIGN_OUT} inconclusive answers`, async () => {
    // Every /me answer is "could not tell" (503). A server that never recovers.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "auth store unavailable" }) }))
    )
    const probe = mountProbe()

    // 60s of virtual time is far beyond any bounded ladder the hook might use.
    await advance(60_000)

    expect(latest!.session).toBeNull()
    expect(window.localStorage.getItem(KEY)).toBeNull()
    probe.unmount()
  })
})
