// @vitest-environment jsdom
// T10 (slice 6 reskin) — the source-preference round-trip hook. The server
// (handlers.mjs:2370) already persists per-user chart source prefs:
//   GET /api/trading/source-preference → { ok, userId, source }
//   POST { source }                      → { ok, userId, source } (normalized;
//                                          unknown slugs resolve to "auto")
// The hook must:
//   • load the saved pref on mount without blocking the chart that rides it
//   • persist on the user's action and adopt the server-NORMALIZED answer
//   • keep the last-good pref + a non-blocking notice when a persist fails
//   • never let a slow/late GET clobber a choice the user made meanwhile
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { useEffect, useRef } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { useSourcePreference } from "@/hooks/useSourcePreference"

type PrefResult = ReturnType<typeof useSourcePreference>

function Harness({ onValue }: { onValue: (v: PrefResult) => void }) {
  const v = useSourcePreference()
  const report = useRef(onValue)
  report.current = onValue
  useEffect(() => { report.current(v) })
  return null
}

const json = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response

const normalize = (s: unknown): string => {
  const v = String(s ?? "").trim().toLowerCase()
  return v === "auto" || v === "" ? "auto" : /^[a-z0-9-]+$/.test(v) ? v : "auto"
}

interface StubOpts {
  get?: { body: unknown; ok?: boolean }
  postOk?: boolean
}

function stubServer(opts: StubOpts = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? "GET"
    if (!u.includes("/source-preference")) return json({ error: "unexpected endpoint " + u }, false)
    if (method === "GET") {
      const g = opts.get ?? { body: { ok: true, userId: "default", source: "expertoption" } }
      if (g.ok === false) return json({ error: "pref read failed" }, false)
      return json(g.body)
    }
    const body = JSON.parse(String(init?.body)) as { source?: unknown }
    if (opts.postOk === false) return json({ error: "post rejected" }, false)
    return json({ ok: true, userId: "default", source: normalize(body?.source) })
  }))
}

function mountApp() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  let latest: PrefResult | null = null
  flushSync(() => {
    root.render(<Harness onValue={(v) => { latest = v }} />)
  })
  return {
    host,
    get latest() {
      expect(latest, "expected a reported hook value").not.toBeNull()
      return latest as PrefResult
    },
    async settle() {
      // Wall-clock soak: React schedules async (promise-sourced) updates via
      // its MessageChannel scheduler, which a single 0ms hop + empty flushSync
      // does not reliably drain. A short sleep then flushSync is the same
      // pattern the suite's other async-state tests rely on (see
      // useCandleData.render.test.tsx), and makes the read deterministic.
      await new Promise((r) => setTimeout(r, 10))
      flushSync(() => {})
    },
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

describe("useSourcePreference (T10 round-trip)", () => {
  beforeEach(() => { stubServer({}) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it("starts non-blocking on 'auto', then loads the saved pref on mount", async () => {
    const h = mountApp()
    expect(h.latest.loaded).toBe(false)
    expect(h.latest.pref).toBe("auto")
    expect(h.latest.notice).toBeNull()
    await h.settle()
    expect(h.latest.pref).toBe("expertoption")
    expect(h.latest.loaded).toBe(true)
    expect(h.latest.notice).toBeNull()
    h.unmount()
  })

  it("a failed GET keeps 'auto' and surfaces a non-blocking notice", async () => {
    vi.unstubAllGlobals()
    stubServer({ get: { body: { error: "pref read failed" }, ok: false } })
    const h = mountApp()
    await h.settle()
    expect(h.latest.pref).toBe("auto")
    expect(h.latest.loaded).toBe(true)
    expect(h.latest.notice).not.toBeNull()
    h.unmount()
  })

  it("persist POSTs the slug and adopts the server's normalized answer", async () => {
    const h = mountApp()
    await h.settle()
    expect(h.latest.pref).toBe("expertoption")
    const ok = await h.latest.persist("ccxt")
    expect(ok).toBe(true)
    await h.settle()
    expect(h.latest.pref).toBe("ccxt")
    expect(h.latest.notice).toBeNull()

    const fetchMock = vi.mocked(fetch)
    const postCall = fetchMock.mock.calls.find(([u, i]) => String(u).includes("/source-preference") && (i as RequestInit | undefined)?.method === "POST")
    expect(postCall, "expected a POST to /api/trading/source-preference").toBeTruthy()
    const init = postCall![1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ source: "ccxt" })
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" })
    h.unmount()
  })

  it("adopts 'auto' when the server normalizes an unknown slug", async () => {
    const h = mountApp()
    await h.settle()
    const ok = await h.latest.persist("not-a-real-slug!")
    expect(ok).toBe(true)
    await h.settle()
    expect(h.latest.pref).toBe("auto")
    h.unmount()
  })

  it("a failed persist keeps the last-good pref, returns false and sets a notice", async () => {
    vi.unstubAllGlobals()
    stubServer({ postOk: false })
    const h = mountApp()
    await h.settle()
    expect(h.latest.pref).toBe("expertoption")
    const ok = await h.latest.persist("ccxt")
    expect(ok).toBe(false)
    await h.settle()
    expect(h.latest.pref).toBe("expertoption")
    expect(h.latest.notice).not.toBeNull()
    h.unmount()
  })

  it("a late GET response never clobbers a choice the user already made", async () => {
    let resolveGet!: (body: unknown) => void
    const gate = new Promise<unknown>((res) => { resolveGet = res })
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes("/source-preference") && (init?.method ?? "GET") === "GET") {
        return gate.then((body) => json(body as unknown))
      }
      const body = JSON.parse(String(init?.body)) as { source?: unknown }
      return json({ ok: true, userId: "default", source: normalize(body?.source) })
    }))
    const h = mountApp()
    await h.settle() // GET still in flight
    const ok = await h.latest.persist("ccxt")
    expect(ok).toBe(true)
    await h.settle()
    expect(h.latest.pref).toBe("ccxt")
    // The stale GET finally settles LONG after the user's choice — it must lose.
    resolveGet({ ok: true, userId: "default", source: "expertoption" })
    await h.settle()
    expect(h.latest.pref).toBe("ccxt")
    h.unmount()
  })
})