// @vitest-environment jsdom
// WS-6 T3 — StatusBoundary: venue integrity + availability rendering (RED, AC-012 / AC-017).
//
// AC-012 requires the conflict to be NAMED and visible, with the room showing
// the blocker rather than silently awarding independence. AC-017 requires that
// nothing secret reaches the DOM.
import { describe, expect, it, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { StatusBoundary } from "../StatusBoundary"
import { assessRegister, type VenueRecord } from "../../adapters/venueIntegrity"
import { live } from "../../domain/availability"

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
})

const credsOk = live({ source: "vault", observedAt: 1_700_000_000, freshnessMs: 10 })

const conflicted: VenueRecord = {
  venueId: "suspect",
  feedAuthority: "suspect",
  counterpartyAuthority: "suspect",
  settlementAuthority: "suspect",
  credentialStatus: credsOk
}

const clean: VenueRecord = {
  venueId: "hata",
  feedAuthority: "hata",
  counterpartyAuthority: "independent-cs",
  settlementAuthority: "licensed-custodian",
  credentialStatus: credsOk
}

describe("StatusBoundary — venue conflict is named (AC-012)", () => {
  it("renders the conflicting entity and the roles it holds", () => {
    const host = render(<StatusBoundary register={assessRegister([conflicted])} />)
    expect(host.textContent).toContain("suspect")
    expect(host.textContent).toMatch(/counterparty/i)
    expect(host.textContent).toMatch(/settlement/i)
  })

  it("does NOT present a conflicted venue as verified", () => {
    const host = render(<StatusBoundary register={assessRegister([conflicted])} />)
    const row = host.querySelector("[data-venue-id='suspect']")
    expect(row?.getAttribute("data-integrity")).toBe("conflict")
    expect(row?.getAttribute("data-integrity")).not.toBe("verified")
  })

  it("renders a verified venue as verified", () => {
    const host = render(<StatusBoundary register={assessRegister([clean])} />)
    expect(host.querySelector("[data-venue-id='hata']")?.getAttribute("data-integrity")).toBe("verified")
  })

  it("shows the register is not all-clear when any venue conflicts", () => {
    const host = render(<StatusBoundary register={assessRegister([clean, conflicted])} />)
    expect(host.textContent).not.toMatch(/all clear/i)
  })
})

describe("StatusBoundary — empty register is unconfigured, not safe (AC-007)", () => {
  it("never renders an empty register as all-clear", () => {
    const host = render(<StatusBoundary register={assessRegister([])} />)
    expect(host.textContent).toMatch(/no venues/i)
    expect(host.textContent).not.toMatch(/all clear/i)
  })
})

describe("StatusBoundary — no secret reaches the DOM (AC-017)", () => {
  it("renders no secret material even when a record carries credential noise", () => {
    const leaky = {
      ...clean,
      // A malformed record that leaked a key must not reach the DOM.
      privateKey: "0x" + "a".repeat(64)
    } as unknown as VenueRecord
    const host = render(<StatusBoundary register={assessRegister([leaky])} />)
    expect(host.innerHTML).not.toContain("0x" + "a".repeat(64))
    expect(host.textContent).not.toMatch(/[0-9a-fA-F]{64}/)
  })
})
