// @vitest-environment jsdom
// W3-01 Task 9 — WealthRoom: the cross-venue net-worth ledger surface.
//
// Mirrors the DispatchBell-adjacent test layout: jsdom render, mocked lib,
// waitFor polling. The room is NOT registered in INNER_NAV / MINISTRY_ROOMS:
// the WS-6 T0 room-key contract is frozen (22 keys), and wiring a new key
// needs a spec amendment, so the room ships tested but unwired — recorded in
// the Task 9 report rather than snuck through a guard.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { WealthRoom } from "../WealthRoom"
import * as wealthLib from "@/lib/wealth"
import type { WealthOverview } from "@/lib/wealth"

vi.mock("@/lib/wealth", () => ({
  fetchWealthOverview: vi.fn(),
  postWealthTransfer: vi.fn()
}))

const mockedFetch = vi.mocked(wealthLib.fetchWealthOverview)
const mockedPost = vi.mocked(wealthLib.postWealthTransfer)

const NOW = "2026-10-08T12:00:00+08:00"

function fixture(): WealthOverview {
  return {
    ok: true,
    totalUsd: 218.5,
    incomplete: true,
    reason: null,
    legs: [
      { id: "ccxt-spot", kind: "ccxt-spot", ccy: "USD", amount: 200, observedAt: NOW, status: "LIVE", reason: null, usd: 200, fxSource: "declared-parity", fxAt: null },
      { id: "tng-manual", kind: "manual", ccy: "MYR", amount: 88, asOf: NOW, ageDays: 3, observedAt: null, status: "ENTERED", reason: null, usd: 18.5, fxSource: "yahoo", fxAt: NOW },
      { id: "hyperliquid", kind: "hyperliquid", ccy: "USD", amount: null, observedAt: null, status: "ABSENT", reason: "hyperliquid-credentials-unset", usd: null, fxSource: null, fxAt: null }
    ],
    paper: { equity: 5000, cash: 4800, committed: 200, open: 2, closed: 9 },
    transfers: [
      { id: "x1", fromLeg: "ccxt-spot", toLeg: "tng-manual", ccy: "USD", amount: 50, at: NOW, note: "rebalance" }
    ],
    snapshots: [{ at: NOW, totalUsd: 210, incomplete: true, legStatus: [], tzDate: "2026-10-08" }],
    suggestions: [
      { fromLeg: "jar-a", toLeg: "jar-b", ccy: "USD", amount: 100.5, at: NOW, confidence: "candidate", status: "unconfirmed" }
    ]
  }
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
  flushSync(() => {})
}

describe("WealthRoom", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.clearAllMocks()
    mockedFetch.mockResolvedValue(fixture())
    mockedPost.mockResolvedValue({
      ok: true,
      transfer: { id: "x2", fromLeg: "jar-a", toLeg: "jar-b", ccy: "USD", amount: 100.5, at: NOW, note: "" }
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)
  })

  it("reads the overview on mount with no permit or prop (permission-free read)", async () => {
    flushSync(() => { root.render(<WealthRoom />) })
    await waitFor(() => mockedFetch.mock.calls.length >= 1, "overview fetch on mount")
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it("renders the total, the incomplete banner, and per-leg badges with reasons", async () => {
    flushSync(() => { root.render(<WealthRoom />) })
    await waitFor(() => host.textContent?.includes("218.5") ?? false, "total to render")
    const text = host.textContent ?? ""
    expect(text).toContain("Partial total")
    expect(text).toContain("LIVE")
    expect(text).toContain("ENTERED")
    expect(text).toContain("ABSENT")
    expect(text).toContain("hyperliquid-credentials-unset")
  })

  it("keeps the paper section separate — paper equity is never summed into the total", async () => {
    flushSync(() => { root.render(<WealthRoom />) })
    await waitFor(() => host.textContent?.includes("Paper") ?? false, "paper section")
    const total = host.querySelector('[data-testid="wealth-total"]')?.textContent ?? ""
    const paper = host.querySelector('[data-testid="wealth-paper"]')?.textContent ?? ""
    expect(total).toContain("218.5")
    expect(total, "paper equity must not leak into the total").not.toContain("5000")
    expect(paper).toContain("5000")
    expect(paper).toContain("never summed")
  })

  it("labels transfer suggestions as inferred direction and confirms only on click", async () => {
    flushSync(() => { root.render(<WealthRoom />) })
    await waitFor(() => host.textContent?.includes("inferred direction") ?? false, "suggestion label")
    // Nothing wrote on render: confirmation is an explicit operator action.
    expect(mockedPost).not.toHaveBeenCalled()
    const btn = host.querySelector("[data-testid='confirm-jar-a-jar-b']") as HTMLButtonElement
    expect(btn).toBeTruthy()
    btn.click()
    await waitFor(() => mockedPost.mock.calls.length >= 1, "confirm posts the transfer")
    expect(mockedPost).toHaveBeenCalledWith(
      expect.objectContaining({ fromLeg: "jar-a", toLeg: "jar-b" })
    )
  })

  it("offers a manual transfer form with an as-of field that posts and refetches", async () => {
    flushSync(() => { root.render(<WealthRoom />) })
    await waitFor(() => !!host.querySelector("[data-testid='xfer-at']"), "as-of field")
    const at = host.querySelector("[data-testid='xfer-at']") as HTMLInputElement
    expect(at).toBeTruthy()
    expect(mockedPost).not.toHaveBeenCalled()
    const callsBefore = mockedFetch.mock.calls.length
    const btn = host.querySelector("[data-testid='xfer-submit']") as HTMLButtonElement
    btn.click()
    await waitFor(() => mockedPost.mock.calls.length >= 1, "manual transfer post")
    await waitFor(() => mockedFetch.mock.calls.length > callsBefore, "refetch after post")
  })
})
