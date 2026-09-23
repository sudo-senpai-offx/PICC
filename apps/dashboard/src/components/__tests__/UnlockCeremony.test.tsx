// @vitest-environment jsdom
// The unlock-ceremony readout must render honest gate state: pass gates with a
// pass tone, deny gates with their `ceremony:deny:*` reason verbatim, absent
// data as "not-wired" (never a pass), and an API error as the not-wired cell,
// not a spinner-forever. fetch is stubbed so no network ever leaves the test.
import { afterEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { UnlockCeremony } from "@/components/UnlockCeremony"
import type { CeremonyClassState, CeremonyGate, CeremonyOverview } from "@/lib/api"

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

const gate = (id: string, pass: boolean, reason: string | null = null): CeremonyGate => ({ id, pass, reason })

const classState = (overrides: Partial<CeremonyClassState>): CeremonyClassState => ({
  venueClass: "ccxt-crypto",
  spendableResolved: 120,
  scaleResolved: 120,
  gates: [],
  enablement: null,
  binaryOptions: false,
  platformVerification: null,
  lastCreditAt: "2026-09-23T00:00:00.000Z",
  ledgerRunning: true,
  ...overrides
})

const overview = (classes: CeremonyClassState[], overrides: Partial<CeremonyOverview> = {}): CeremonyOverview => ({
  ok: true,
  at: "2026-09-23T00:00:00.000Z",
  scaleMinResolves: 500,
  scaleEnvError: null,
  classes,
  ...overrides
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("UnlockCeremony (WS-3 ceremony readout)", () => {
  it("renders a pass gate with a pass tone and a deny gate with its verbatim ceremony:deny reason", async () => {
    stubFetch(overview([
      classState({
        venueClass: "ccxt-crypto",
        spendableResolved: 300,
        scaleResolved: 305,
        gates: [
          gate("gate1-constitution-300", true),
          gate("gate2-flip-gate-100", false, "ceremony:deny:flip-unmet (legacy trail below 100)"),
          gate("gate4-trading-days-30", false, "ceremony:deny:days-short (have 12 trading days, require 30)")
        ]
      })
    ]))
    const m = mount(<UnlockCeremony />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("ccxt-crypto")
    expect(text).toContain("gate1-constitution-300")
    expect(text).toContain("pass")
    expect(text).toContain("gate2-flip-gate-100")
    expect(text).toContain("ceremony:deny:flip-unmet (legacy trail below 100)")
    expect(text).toContain("ceremony:deny:days-short (have 12 trading days, require 30)")
    // the pass gate carries a success tone; the denies carry a danger tone
    const successBadge = m.host.querySelector("span.badge-success")
    const dangerBadge = m.host.querySelector("span.badge-danger")
    expect(successBadge?.textContent).toContain("gate1-constitution-300")
    expect(dangerBadge?.textContent).toContain("gate2-flip-gate-100")
    m.unmount()
  })

  it("shows the spendable count and the scale 500+ marker once scaleResolved reaches the default 500 floor", async () => {
    stubFetch(overview([
      classState({ venueClass: "hyperliquid-perps", spendableResolved: 318, scaleResolved: 512 })
    ]))
    const m = mount(<UnlockCeremony />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("hyperliquid-perps")
    expect(text).toContain("spendable 318")
    expect(text).toContain("scale 500+ reached")
    m.unmount()
  })

  it("renders the scale marker off the server-emitted scaleMinResolves floor, not a hardcoded 500", async () => {
    stubFetch(overview([classState({ venueClass: "ccxt-crypto", scaleResolved: 512 })], { scaleMinResolves: 600 }))
    const m = mount(<UnlockCeremony />)
    await settle()
    const below = m.host.textContent ?? ""
    expect(below).toContain("scale 512 (< 600)")
    expect(below).not.toContain("scale 500+ reached")
    m.unmount()

    stubFetch(overview([classState({ venueClass: "ccxt-crypto", scaleResolved: 650 })], { scaleMinResolves: 600 }))
    const m2 = mount(<UnlockCeremony />)
    await settle()
    expect(m2.host.textContent).toContain("scale 600+ reached")
    m2.unmount()
  })

  it("an invalid scale knob renders the named invalid-environment honesty cell (scale not-wired), never a fabricated floor", async () => {
    stubFetch(
      overview([classState({ venueClass: "ccxt-crypto", scaleResolved: 512 })], {
        scaleMinResolves: null,
        scaleEnvError: "invalid-environment: PICC_CEREMONY_SCALE_MIN_RESOLVES=abc"
      })
    )
    const m = mount(<UnlockCeremony />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("scale not-wired — invalid-environment: PICC_CEREMONY_SCALE_MIN_RESOLVES=abc")
    expect(text).not.toContain("scale 500+ reached")
    m.unmount()
  })

  it("renders the derived ledger-stale deny (gate-ledger-health) with its verbatim reason when the resolve loop is stopped", async () => {
    stubFetch(overview([
      classState({
        venueClass: "ccxt-crypto",
        ledgerRunning: false,
        gates: [gate("gate-ledger-health", false, "ceremony:deny:ledger-stale")]
      })
    ]))
    const m = mount(<UnlockCeremony />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("gate-ledger-health")
    expect(text).toContain("ceremony:deny:ledger-stale")
    expect(text).not.toContain("pass")
    const dangerBadge = m.host.querySelector("span.badge-danger")
    expect(dangerBadge?.textContent).toContain("gate-ledger-health")
    m.unmount()
  })

  it("renders a locked enablement for a class whose store record is null", async () => {
    stubFetch(overview([classState({ venueClass: "ccxt-crypto", enablement: null })]))
    const m = mount(<UnlockCeremony />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("locked")
    expect(text).not.toContain("unlocked")
    m.unmount()
  })

  it("renders an unlocked enablement with its recorded by-line once the ceremony store unlocks", async () => {
    stubFetch(overview([
      classState({
        venueClass: "hyperliquid-perps",
        enablement: { unlocked: true, at: "2026-09-23T00:00:00.000Z", by: "ceremony-action-41" }
      })
    ]))
    const m = mount(<UnlockCeremony />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("unlocked")
    expect(text).toContain("by ceremony-action-41")
    m.unmount()
  })

  it("shows platform unverified for the binary-options class with a null record, and the record when verified", async () => {
    stubFetch(overview([
      classState({ venueClass: "expertoption", binaryOptions: true, platformVerification: null })
    ]))
    let m = mount(<UnlockCeremony />)
    await settle()
    expect(m.host.textContent).toContain("expertoption")
    expect(m.host.textContent).toContain("platform unverified")
    m.unmount()

    stubFetch(overview([
      classState({
        venueClass: "expertoption",
        binaryOptions: true,
        platformVerification: {
          verified: true,
          at: "2026-09-23T00:00:00.000Z",
          by: "ceremony-action-42",
          regulator: "CySEC",
          payoutFloorPct: 90,
          withdrawalTested: true
        }
      })
    ]))
    m = mount(<UnlockCeremony />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("platform verified")
    expect(text).toContain("CySEC")
    expect(text).toContain("payout floor 90%")
    expect(text).toContain("withdrawal tested")
    m.unmount()
  })

  it("renders not-wired cells for absent per-class data instead of passing", async () => {
    stubFetch({
      ok: true,
      at: "2026-09-23T00:00:00.000Z",
      classes: [
        {
          venueClass: "ccxt-crypto",
          gates: [],
          enablement: null,
          binaryOptions: false,
          platformVerification: null,
          lastCreditAt: null,
          ledgerRunning: true
        }
      ]
    } as unknown as CeremonyOverview)
    const m = mount(<UnlockCeremony />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("spendable not-wired")
    expect(text).toContain("scale not-wired")
    expect(text).toContain("gates not-wired")
    expect(text).not.toContain("pass")
    m.unmount()
  })

  it("renders the not-wired honesty state when the class list is absent", async () => {
    stubFetch(overview([]))
    const m = mount(<UnlockCeremony />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("not-wired — no ceremony classes reported")
    expect(text).not.toContain("pass")
    m.unmount()
  })

  it("renders the not-wired honesty state instead of a spinner when the API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "ceremony exploded" })
    } as unknown as Response)))
    const m = mount(<UnlockCeremony />)
    await settle()
    const text = m.host.textContent ?? ""
    expect(text).toContain("not-wired")
    expect(text).toContain("ceremony exploded")
    expect(text).not.toContain("loading ceremony readout")
    m.unmount()
  })
})