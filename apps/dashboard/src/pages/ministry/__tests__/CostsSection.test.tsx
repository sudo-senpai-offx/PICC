// @vitest-environment jsdom
// Fee-intelligence Task 7 — CostsSection: per-venue day/all-time lines with
// provenance badges, absences as reasons (never zeros), paper drag panel.
//
// Mirrors the WealthRoom test layout: jsdom render, mocked lib, waitFor
// polling. Ships inside the wealth room (spec decision 4+6), unwired like its
// host — no INNER_NAV / MINISTRY_ROOMS key (WS-6 T0 freeze).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CostsSection } from "../CostsSection"
import * as costsLib from "@/lib/costs"
import type { CostsOverview } from "@/lib/costs"

vi.mock("@/lib/costs", () => ({
  fetchCostsOverview: vi.fn()
}))

const mockedFetch = vi.mocked(costsLib.fetchCostsOverview)

function fixture(): CostsOverview {
  return {
    ok: true,
    venues: [
      {
        venue: "hyperliquid",
        day: {
          totalUsd: 0.03,
          provenance: "measured",
          reason: null,
          byKind: [
            { kind: "fee", totalUsd: 0.01, provenance: "measured" },
            { kind: "funding", totalUsd: 0.02, provenance: "measured" }
          ]
        },
        allTime: {
          totalUsd: 0.08,
          provenance: "modeled",
          reason: null,
          byKind: [{ kind: "spread", totalUsd: 0.08, provenance: "modeled" }]
        },
        waste: { refused: 2, failed: 1 }
      },
      {
        venue: "paper",
        day: { totalUsd: null, provenance: null, reason: "no-observed-costs-for-day", byKind: [] },
        allTime: {
          totalUsd: 0.05,
          provenance: "modeled-with-calibrated-inputs",
          reason: null,
          byKind: [{ kind: "spread", totalUsd: 0.05, provenance: "modeled-with-calibrated-inputs" }]
        },
        waste: null
      }
    ],
    totalUsd: 0.13,
    provenance: "modeled",
    incomplete: false,
    reason: null,
    skipped: [],
    window: { tzDate: "2026-10-08", tz: "Asia/Singapore" },
    paper: {
      label: "drag-adjusted (modeled)",
      starting: 10000,
      lines: [{ closeId: "c1", feeUsd: 0, spreadUsd: 15, slipUsd: 0, provenance: "modeled" }],
      series: [
        { t: null, equity: 10000, dragEquity: 10000, cumulativeCostUsd: 0 },
        { t: "2026-09-01T10:00:00.000Z", equity: 10002, dragEquity: 9987, cumulativeCostUsd: 15 }
      ],
      skipped: [],
      reason: null
    }
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

describe("CostsSection", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.clearAllMocks()
    mockedFetch.mockResolvedValue(fixture())
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)
  })

  it("reads the overview on mount", async () => {
    flushSync(() => { root.render(<CostsSection />) })
    await waitFor(() => mockedFetch.mock.calls.length >= 1, "overview fetch on mount")
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it("renders per-venue day/all-time lines with provenance badges", async () => {
    flushSync(() => { root.render(<CostsSection />) })
    await waitFor(() => host.textContent?.includes("hyperliquid") ?? false, "venue row")
    const text = host.textContent ?? ""
    expect(text).toContain("measured")
    expect(text).toContain("modeled")
    expect(text).toContain("modeled-with-calibrated-inputs")
    expect(host.querySelector("[data-testid='costs-venue-hyperliquid-day-provenance']")?.textContent).toBe("measured")
    expect(host.querySelector("[data-testid='costs-venue-hyperliquid-day-fee-provenance']")?.textContent).toBe("measured")
    expect(host.querySelector("[data-testid='costs-venue-hyperliquid-waste']")?.textContent).toContain("2 refused")
  })

  it("renders near-empty windows as absences with reasons, never zeros", async () => {
    flushSync(() => { root.render(<CostsSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='costs-venue-paper-day']"), "paper day absence")
    const day = host.querySelector("[data-testid='costs-venue-paper-day']")?.textContent ?? ""
    expect(day).toContain("no observed costs")
    expect(day).toContain("no-observed-costs-for-day")
  })

  it("keeps the paper drag panel separate with its modeled label", async () => {
    flushSync(() => { root.render(<CostsSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='costs-paper']"), "paper panel")
    const paper = host.querySelector("[data-testid='costs-paper']")?.textContent ?? ""
    expect(paper).toContain("drag-adjusted (modeled)")
    expect(paper).toContain("Never summed into venue totals")
    expect(host.querySelector("[data-testid='costs-paper-total']")?.textContent).toContain("15")
  })

  it("renders the empty scorecard as an absence with a reason", async () => {
    mockedFetch.mockResolvedValue({ ...fixture(), venues: [], totalUsd: null, reason: "no-observed-costs", incomplete: true })
    flushSync(() => { root.render(<CostsSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='costs-absence']"), "empty absence")
    expect(host.querySelector("[data-testid='costs-absence']")?.textContent).toContain("no-observed-costs")
  })
})
