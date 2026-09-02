// @vitest-environment jsdom
// T7 / REQ-8 — live in-app window countdown. Three layers:
//  1. windowEndAtForAsset — PURE window math: an alerted asset's `since` +
//     (leadMinutes + windowMinutes) from the SAME prefs feed the dispatch used.
//     Anything missing/foreign → null — a countdown is NEVER fabricated.
//  2. CountdownChip — mm:ss ticking (1s interval), stops at 00:00, unmount
//     clears the interval, null windowEndAt renders nothing.
//  3. SignalWindowChip — wired surface: polls /api/signals/status and reads
//     /api/notifications/status (the SignalNotificationsCard feed), renders
//     the chip only while the in-scope asset is alerted.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { act } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { windowEndAtForAsset, CountdownChip, SignalWindowChip } from "@/components/SignalWindowChip"

function mount(el: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(el) })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 1500) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
  flushSync(() => {})
}

const chipEl = () => document.querySelector<HTMLElement>('[data-testid="window-countdown"]')

const PREFS = { leadMinutes: 3, windowMinutes: 15 }

describe("windowEndAtForAsset (T7 pure window math)", () => {
  it("returns null when the engine snapshot is absent or empty", () => {
    expect(windowEndAtForAsset(null, "EURUSD", PREFS)).toBeNull()
    expect(windowEndAtForAsset({ states: {} }, "EURUSD", PREFS)).toBeNull()
    expect(windowEndAtForAsset({ states: {} }, null, PREFS)).toBeNull()
    expect(windowEndAtForAsset({ states: {} }, "EURUSD", null)).toBeNull()
  })

  it("returns null for a non-alerted or unknown asset", () => {
    expect(windowEndAtForAsset({ states: { EURUSD: { phase: "idle" } } }, "EURUSD", PREFS)).toBeNull()
    expect(windowEndAtForAsset({ states: { EURUSD: { phase: "alerted", since: 1 } } }, "XAUUSD", PREFS)).toBeNull()
  })

  it("never fabricates a window from an alerted state with no `since`", () => {
    expect(windowEndAtForAsset({ states: { EURUSD: { phase: "alerted" } } }, "EURUSD", PREFS)).toBeNull()
  })

  it("computes the window close from `since` + lead + window (same prefs the dispatch used)", () => {
    const since = 1_700_000_000_000
    expect(windowEndAtForAsset({ states: { EURUSD: { phase: "alerted", since } } }, "EURUSD", PREFS))
      .toBe(since + (3 + 15) * 60_000)
  })

  it("returns null when prefs are missing or non-finite (a wrong clock must never tick)", () => {
    const st = { state: { phase: "alerted", since: 5 } }
    expect(windowEndAtForAsset({ states: { EURUSD: st.state } }, "EURUSD", {})).toBeNull()
    expect(windowEndAtForAsset({ states: { EURUSD: st.state } }, "EURUSD", { leadMinutes: "x" as unknown as number, windowMinutes: 15 })).toBeNull()
    expect(windowEndAtForAsset({ states: { EURUSD: st.state } }, "EURUSD", { leadMinutes: 3, windowMinutes: NaN })).toBeNull()
  })
})

describe("CountdownChip (T7 ticking)", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  // Fake timers + React: every render/advance/unmount must run inside `act` so
  // passive effects (the 1s interval) are flushed deterministically — React's
  // scheduler uses MessageChannel, which vi fake timers do NOT fake.
  async function actMount(el: React.ReactNode) {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(el) })
    return {
      host,
      root,
      unmount: async () => {
        await act(async () => { root.unmount() })
        document.body.removeChild(host)
      }
    }
  }

  it("renders nothing when no window is open", async () => {
    const m = await actMount(<CountdownChip windowEndAt={null} />)
    expect(chipEl()).toBeNull()
    await m.unmount()
  })

  it("renders mm:ss and decrements per second, stopping at 00:00", async () => {
    const m = await actMount(<CountdownChip windowEndAt={Date.now() + 120_000} assetId="EURUSD" />)
    expect(chipEl()?.textContent).toMatch(/EURUSD · 02:00/)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(chipEl()?.textContent).toMatch(/01:59/)
    await act(async () => { vi.advanceTimersByTime(59_000) })
    expect(chipEl()?.textContent).toMatch(/01:00/)
    await act(async () => { vi.advanceTimersByTime(59_000) })
    expect(chipEl()?.textContent).toMatch(/00:01/)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(chipEl()?.textContent).toMatch(/00:00/)
    // Once at 00:00 the countdown STOPS — it never goes negative.
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(chipEl()?.textContent).toMatch(/00:00/)
    await m.unmount()
  })

  it("unmount clears the tick interval", async () => {
    const m = await actMount(<CountdownChip windowEndAt={Date.now() + 120_000} />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    await m.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("SignalWindowChip (wired suite surface)", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    mounted = []
    fetchMock = vi.fn(async (url: string) => {
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
      if (/signals\/status/.test(url)) {
        return json({ ok: true, running: true, watched: 1, states: { EURUSD: { phase: "idle" } } })
      }
      if (/notifications\/status/.test(url)) {
        return json({ ok: true, prefs: PREFS, subscriptions: 0, channels: [] })
      }
      return json({ ok: false, error: "no data (stubbed)" })
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    mounted.forEach((mm) => mm.unmount())
    mounted = []
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("renders nothing when the in-scope asset is not alerted", async () => {
    const m = mount(<SignalWindowChip assetId="EURUSD" />)
    mounted.push(m)
    await waitFor(() => fetchMock.mock.calls.length >= 2, "both feeds fetched")
    expect(chipEl()).toBeNull()
  })

  it("counts down an alerted in-scope asset from since + lead + window prefs", async () => {
    const since = Date.now() - (3 + 15) * 60_000 + 120_000 // 2 minutes into... i.e. 2:00 left
    fetchMock.mockImplementation(async (url: string) => {
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
      if (/signals\/status/.test(url)) return json({ ok: true, running: true, watched: 1, states: { EURUSD: { phase: "alerted", since } } })
      if (/notifications\/status/.test(url)) return json({ ok: true, prefs: PREFS, subscriptions: 0, channels: [] })
      return json({ ok: false, error: "no data (stubbed)" })
    })
    const m = mount(<SignalWindowChip assetId="EURUSD" />)
    mounted.push(m)
    await waitFor(() => chipEl() != null, "countdown chip visible")
    expect(chipEl()?.textContent).toMatch(/EURUSD · 02:00/)
  })

  it("renders nothing when the status feeds fail (no phantom countdown)", async () => {
    fetchMock.mockRejectedValue(new Error("server down"))
    const m = mount(<SignalWindowChip assetId="EURUSD" />)
    mounted.push(m)
    await waitFor(() => fetchMock.mock.calls.length >= 2, "both feeds attempted")
    expect(chipEl()).toBeNull()
  })
})