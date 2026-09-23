// @vitest-environment jsdom
// The leader-ideas readout must render honest state (WS-4 R8.2/AC-6): a denied
// leader carries its `leader:deny:*` reason verbatim, UNVERIFIED is a muted
// badge (never a deny, never a pass), ADVERSARIAL/suppressed rows surface their
// reason, an empty store is "not-wired", and an API error is the not-wired
// cell, not a spinner. fetch is stubbed so no network ever leaves the test.
import { afterEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { LeaderIdeasPanel } from "@/components/LeaderIdeasPanel"
import type { LeaderIdea, LeaderIdeaRow, LeaderIdeasOverview } from "@/lib/api"

function mount(node: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<>{node}</>) })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

function stubFetch(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload
  } as unknown as Response)))
}

async function settle() {
  await new Promise((r) => setTimeout(r, 10))
  flushSync(() => {})
}

const ideaRow = (overrides: Partial<LeaderIdeaRow> = {}): LeaderIdeaRow => ({
  id: "row-1",
  at: "2026-09-01T00:00:00.000Z",
  asset: "BTCUSD",
  direction: "long",
  sizeUsd: 1000,
  entryPrice: 20000,
  exitPrice: 20400,
  closedAt: "2026-09-02T00:00:00.000Z",
  pnlAfterCosts: 120,
  feesUsd: 4,
  ts: 1756598400000,
  ...overrides
})

const leader = (overrides: Partial<LeaderIdea>): LeaderIdea => ({
  id: "leader-1",
  label: "operator-name",
  source: "csv",
  followedAt: "2026-09-01T00:00:00.000Z",
  lastPositionAt: "2026-09-02T00:00:00.000Z",
  status: "followed",
  platformTrust: { value: "UNVERIFIED", at: null, by: null, evidence: null },
  qualification: { verdict: "denied", deny: "leader:deny:trades-short (have 12, require 300)" },
  guard: {
    autoUnfollow: { active: false, reason: null },
    sevenDay: { active: false, reason: null }
  },
  deny: null,
  ideas: [],
  ...overrides
})

const overview = (leaders: LeaderIdea[], overrides: Partial<LeaderIdeasOverview> = {}): LeaderIdeasOverview => ({
  ok: true,
  at: "2026-09-23T00:00:00.000Z",
  storeUnhealthy: false,
  deny: null,
  leaders,
  ...overrides
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("LeaderIdeasPanel (WS-4 R8.2 readout)", () => {
  it("renders the readout for a followed, verified, qualified leader with its surfaced idea rows", async () => {
    stubFetch(overview([
      leader({
        label: "alpha-trader",
        status: "followed",
        platformTrust: { value: "VERIFIED", at: "2026-09-20T00:00:00.000Z", by: "operator@picc", evidence: "reg-register-idx-9" },
        qualification: { verdict: "qualified", deny: null },
        deny: null,
        ideas: [ideaRow()]
      })
    ]))
    const m = mount(<LeaderIdeasPanel />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("alpha-trader")
    expect(text).toContain("csv")
    expect(text).toContain("followed")
    expect(text).toContain("verified")
    expect(text).toContain("qualified")
    expect(text).toContain("BTCUSD")
    expect(text).toContain("long")
    expect(text).toContain("1,000")
    m.unmount()
  })

  it("shows a denied leader's qualification deny reason verbatim", async () => {
    stubFetch(overview([
      leader({
        label: "short-track",
        qualification: { verdict: "denied", deny: "leader:deny:trades-short (have 12, require 300)" }
      })
    ]))
    const m = mount(<LeaderIdeasPanel />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("leader:deny:trades-short (have 12, require 300)")
    const dangerBadge = m.host.querySelector("span.badge-danger")
    expect(dangerBadge?.textContent).toContain("denied")
    m.unmount()
  })

  it("renders an UNVERIFIED leader with a muted unverified badge — never a deny for trust, never a pass", async () => {
    stubFetch(overview([
      leader({
        label: "unknown-source",
        platformTrust: { value: "UNVERIFIED", at: null, by: null, evidence: null }
      })
    ]))
    const m = mount(<LeaderIdeasPanel />)
    await settle()
    const text = m.host.textContent ?? ""
    const muted = [...m.host.querySelectorAll("span.badge-muted")]
    const trustBadge = muted.find((el) => el.textContent?.trim() === "unverified")
    expect(trustBadge).toBeTruthy()
    expect(text).not.toContain("platform-adversarial")
    expect(text).not.toContain("pass")
    // the muted badge is the only trust badge — no success tone claims it verified
    expect(m.host.querySelector("span.badge-success")).toBeNull()
    m.unmount()
  })

  it("surfaces the platform-adversarial suppress reason for an ADVERSARIAL leader and hides its ideas", async () => {
    stubFetch(overview([
      leader({
        label: "bad-actor",
        platformTrust: { value: "ADVERSARIAL", at: "2026-09-21T00:00:00.000Z", by: "operator@picc", evidence: "reg-register-idx-11" },
        deny: "leader:deny:platform-adversarial",
        ideas: [ideaRow({ id: "row-hidden" })]
      })
    ]))
    const m = mount(<LeaderIdeasPanel />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("leader:deny:platform-adversarial")
    expect(text).not.toContain("row-hidden")
    const dangerBadge = m.host.querySelector("span.badge-danger")
    expect(dangerBadge?.textContent).toContain("adversarial")
    m.unmount()
  })

  it("surfaces the sourcing 7d-stop reason for a suppressed leader and hides its ideas", async () => {
    stubFetch(overview([
      leader({
        label: "hot-streak",
        guard: {
          autoUnfollow: { active: false, reason: null },
          sevenDay: { active: true, reason: "leader:idea-suppressed:7d-stop" }
        },
        deny: "leader:idea-suppressed:7d-stop",
        ideas: [ideaRow({ id: "row-suppressed" })]
      })
    ]))
    const m = mount(<LeaderIdeasPanel />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("leader:idea-suppressed:7d-stop")
    expect(text).not.toContain("row-suppressed")
    m.unmount()
  })

  it("renders the not-wired honesty state for an auto-unfollowed leader with no ideas and no deny", async () => {
    stubFetch(overview([
      leader({
        label: "silent-leader",
        status: "auto-unfollowed",
        lastPositionAt: null,
        guard: {
          autoUnfollow: { active: true, reason: "leader:auto-unfollow:no-positions-21d" },
          sevenDay: { active: false, reason: null }
        },
        ideas: []
      })
    ]))
    const m = mount(<LeaderIdeasPanel />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("auto-unfollowed")
    expect(text).toContain("leader:auto-unfollow:no-positions-21d")
    expect(text).toContain("not-wired")
    expect(text).not.toContain("pass")
    m.unmount()
  })

  it("renders the not-wired honesty state when the leader store is empty", async () => {
    stubFetch(overview([]))
    const m = mount(<LeaderIdeasPanel />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("not-wired — no leaders reported")
    expect(text).not.toContain("pass")
    m.unmount()
  })

  it("renders the named store-unhealthy deny as a not-wired state when the store is unhealthy", async () => {
    stubFetch(overview([], {
      storeUnhealthy: true,
      deny: "leader:deny:store-unhealthy"
    }))
    const m = mount(<LeaderIdeasPanel />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("not-wired")
    expect(text).toContain("leader:deny:store-unhealthy")
    expect(text).not.toContain("pass")
    m.unmount()
  })

  it("renders the not-wired honesty state instead of a spinner when the API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "leader readout exploded" })
    } as unknown as Response)))
    const m = mount(<LeaderIdeasPanel />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("not-wired")
    expect(text).toContain("leader readout exploded")
    expect(text).not.toContain("loading leader-ideas readout")
    m.unmount()
  })
})