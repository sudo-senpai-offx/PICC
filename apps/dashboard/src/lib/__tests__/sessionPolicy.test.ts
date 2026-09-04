import { afterEach, describe, expect, it, vi } from "vitest"
import { getSessionPolicy, setSessionPolicy } from "../api"

// Regression: getSessionPolicy/setSessionPolicy used to pass "/api/trading/..."
// into request/post which already prefix BASE="/api", producing the broken
// "/api/api/trading/session-policy". Assert the resolved URL has ONE /api prefix.
describe("trading session-policy URL construction", () => {
  const calls: string[] = []

  afterEach(() => {
    vi.unstubAllGlobals()
    calls.length = 0
    vi.resetModules()
  })

  function stubFetch(json: unknown) {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url))
      return { ok: true, status: 200, json: async () => json } as Response
    }))
  }

  it("getSessionPolicy requests exactly /api/trading/session-policy (no double prefix)", async () => {
    stubFetch({ ok: true, userId: "u1", venues: {} })
    await getSessionPolicy("t")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe("/api/trading/session-policy")
    expect(calls[0]).not.toContain("/api/api/")
  })

  it("setSessionPolicy posts to exactly /api/trading/session-policy (no double prefix)", async () => {
    stubFetch({ ok: true, userId: "u1", venueId: "expertoption", decision: "approved", at: null })
    await setSessionPolicy("expertoption", "approved", "t")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe("/api/trading/session-policy")
    expect(calls[0]).not.toContain("/api/api/")
  })
})
