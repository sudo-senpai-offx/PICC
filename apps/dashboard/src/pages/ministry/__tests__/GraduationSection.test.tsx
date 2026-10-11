// @vitest-environment jsdom
// W3-04 Task 4 — GraduationSection: the per-tag graduation table that ships
// INSIDE the paper room (no new room key, no nav change).
//
// Mirrors the CostsSection test layout: jsdom render, mocked lib, waitFor
// polling. The contract under test is the ABSENCE ONE: an absent leg or an
// absent statistic renders as an explicit absent state carrying its reason, and
// never as a zero, a bare dash, or an empty cell that a load failure would
// render identically.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { GraduationSection } from "../GraduationSection"
import * as graduationLib from "@/lib/graduation"
import type { GraduationOverview } from "@/lib/graduation"

vi.mock("@/lib/graduation", () => ({
  fetchGraduationOverview: vi.fn()
}))

const mockedFetch = vi.mocked(graduationLib.fetchGraduationOverview)

/** One tag exactly as GET /api/graduation/overview serves it. */
function fixture(): GraduationOverview {
  return {
    ok: true,
    advisory: true,
    bars: { supplied: false, reason: "bar-unavailable" },
    tagSemantics: {
      field: "paperClose.symbol",
      scope: "per-asset",
      note: "A paper close carries no strategy identity."
    },
    legs: {
      backtest: { present: false, reason: "backtest-windows-not-persisted", rowsSeen: 0, windows: 0 },
      paper: { present: true, reason: null, reasons: [], rowsSeen: 4, readLimit: 500, windows: 4 },
      live: { present: false, reason: "strategy-tag-unavailable", rowsSeen: 0, windows: 0 }
    },
    strategies: [
      {
        tag: "BTCUSD",
        stage: "paper",
        verdict: "no-verdict",
        promoted: false,
        demoted: false,
        windowsUsed: 0,
        windowsSeen: 3,
        skipped: { "bar-unavailable": 3 },
        sources: {},
        reasons: ["bar-unavailable", "below-floor", "mainnet-ceremony-required"],
        warnings: ["decay:inside-hysteresis-band"],
        stats: {
          returnPct: { value: -0.31, reason: null, windowsMeasured: 3 },
          sharpe: { value: null, reason: "insufficient-observations", count: 1 },
          maxDd: { value: null, reason: "insufficient-observations", pct: null, count: 1 },
          capitalCommittedUsd: 1000,
          costDragUsd: { value: 4.2, reason: null, provenances: ["modeled"], adjusted: false }
        }
      },
      {
        tag: "ETHUSD",
        stage: "paper",
        verdict: "demote",
        promoted: false,
        demoted: true,
        windowsUsed: 0,
        windowsSeen: 1,
        skipped: { "bar-unavailable": 1 },
        sources: {},
        reasons: ["bar-unavailable", "below-floor", "mainnet-ceremony-required"],
        warnings: ["demotion:run-below-threshold"],
        stats: {
          returnPct: { value: 2, reason: null, windowsMeasured: 1 },
          sharpe: { value: null, reason: "insufficient-observations", count: 1 },
          maxDd: { value: null, reason: "insufficient-observations", pct: null, count: 1 },
          capitalCommittedUsd: 500,
          costDragUsd: { value: null, reason: "costDragUsd:no-cost-lines", provenances: [], adjusted: false }
        }
      }
    ],
    unattributed: { rows: 0, reason: null },
    excluded: [],
    costLinesSkipped: [],
    incomplete: true,
    reason: "bar-unavailable"
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

function text(host: HTMLElement, testId: string): string {
  return host.querySelector(`[data-testid='${testId}']`)?.textContent ?? ""
}

describe("GraduationSection", () => {
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
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => mockedFetch.mock.calls.length >= 1, "overview fetch on mount")
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it("renders one row per tag with its stage label and the gate evidence", async () => {
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='graduation-row-BTCUSD']"), "btc row")
    // The `li` qualifier matters: the row's sub-parts share the prefix, so an
    // unprefixed count would measure the component's parts rather than its rows.
    expect(host.querySelectorAll("li[data-testid^='graduation-row-']")).toHaveLength(2)
    expect(text(host, "graduation-row-BTCUSD-stage")).toContain("paper")
    // Gate evidence, with BOTH counts: what was used for the streak and what was
    // merely seen. They are different numbers and the readout must not merge them.
    expect(text(host, "graduation-row-BTCUSD-windows")).toContain("0 of 3")
    expect(text(host, "graduation-row-BTCUSD-verdict")).toContain("no-verdict")
    expect(text(host, "graduation-row-BTCUSD-reasons")).toContain("bar-unavailable")
  })

  it("states the tag's SCOPE on the readout, not only in a commit message", async () => {
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='graduation-tag-semantics']"), "semantics")
    const scope = text(host, "graduation-tag-semantics")
    expect(scope).toContain("paperClose.symbol")
    expect(scope).toContain("per-asset")
  })

  it("renders the demotion warning and the hysteresis warning as words, not colour alone", async () => {
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='graduation-row-ETHUSD']"), "eth row")
    expect(text(host, "graduation-row-ETHUSD-warnings")).toContain("demotion:run-below-threshold")
    expect(text(host, "graduation-row-BTCUSD-warnings")).toContain("decay:inside-hysteresis-band")
    // No demotion warning on the row that is NOT being demoted.
    expect(text(host, "graduation-row-BTCUSD-warnings")).not.toContain("demotion:run-below-threshold")
  })

  it("renders an ABSENT statistic as absent with its reason, never as a zero", async () => {
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='graduation-row-BTCUSD-sharpe']"), "sharpe cell")
    const sharpe = text(host, "graduation-row-BTCUSD-sharpe")
    expect(sharpe).toContain("absent")
    expect(sharpe).toContain("insufficient-observations")
    // The forbidden readings: a measured 0, and a bare dash. A dash reads as
    // "no data, and that is fine", which is exactly the claim being refused.
    expect(sharpe).not.toMatch(/^[-\s–—]*$/)
    expect(sharpe).not.toMatch(/\b0(\.0+)?\b/)
  })

  it("renders an absent COST DRAG leg as absent, not as USD 0", async () => {
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='graduation-row-ETHUSD-drag']"), "drag cell")
    const drag = text(host, "graduation-row-ETHUSD-drag")
    expect(drag).toContain("absent")
    expect(drag).toContain("costDragUsd:no-cost-lines")
    expect(drag).not.toContain("0")
  })

  it("labels the cost drag MODELED, beside the measured numbers it is not mixed into", async () => {
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='graduation-row-BTCUSD-drag']"), "drag cell")
    const drag = text(host, "graduation-row-BTCUSD-drag")
    expect(drag).toContain("4.2")
    expect(drag).toContain("modeled")
    // The payload's own `adjusted: false` is surfaced as a word.
    expect(drag).toContain("not drag-adjusted")
  })

  it("renders every absent LEG as an explicit absence with its named reason", async () => {
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='graduation-legs']"), "legs")
    const legs = text(host, "graduation-legs")
    expect(legs).toContain("backtest")
    expect(legs).toContain("backtest-windows-not-persisted")
    expect(legs).toContain("live")
    expect(legs).toContain("strategy-tag-unavailable")
    // The live leg read zero rows, and it says so rather than claiming it is
    // present-but-quiet.
    expect(legs).toContain("absent")
  })

  it("names the missing promotion bar instead of implying a clean bill of health", async () => {
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='graduation-bars']"), "bars")
    const bars = text(host, "graduation-bars")
    expect(bars).toContain("bar-unavailable")
    expect(bars).toContain("no promotion bar")
  })

  it("renders the empty readout as an absence with a reason, not an empty table", async () => {
    mockedFetch.mockResolvedValue({
      ...fixture(),
      strategies: [],
      legs: {
        backtest: { present: false, reason: "backtest-windows-not-persisted", rowsSeen: 0, windows: 0 },
        paper: {
        present: false,
        reason: null,
        reasons: ["paper-closes-absent"],
        rowsSeen: 0,
        readLimit: 500,
        windows: 0
      },
        live: { present: false, reason: "strategy-tag-unavailable", rowsSeen: 0, windows: 0 }
      },
      unattributed: { rows: 0, reason: null },
      incomplete: true,
      reason: "bar-unavailable"
    })
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='graduation-absence']"), "empty absence")
    // The absence names WHY there are no rows, not merely that the readout is
    // incomplete: the paper leg's own reason is the informative one here.
    expect(text(host, "graduation-absence")).toContain("paper-closes-absent")
    expect(host.querySelectorAll("li[data-testid^='graduation-row-']")).toHaveLength(0)
  })

  it("renders a fetch failure as a refusal, never as an empty or zeroed table", async () => {
    mockedFetch.mockRejectedValue(new Error("graduation overview GET failed: 502"))
    flushSync(() => { root.render(<GraduationSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='graduation-error']"), "error")
    expect(text(host, "graduation-error")).toContain("502")
    expect(host.querySelectorAll("li[data-testid^='graduation-row-']")).toHaveLength(0)
  })
})

/**
 * THE SECTION IS ACTUALLY MOUNTED IN THE PAPER ROOM, and the room's two
 * documented regions keep their meaning.
 *
 * Proved by rendering the ROOM rather than by grepping its source, because the
 * room's own invariant is a rendered-markup one: `PaperLiveRoom.test.tsx`
 * enumerates every interactive element in this room and requires each to sit
 * inside `data-paper-region="ledger"` and none inside the boundary half. A
 * section placed in either of those halves would have to be read against that
 * invariant; a third region leaves it exactly as it was.
 */
describe("GraduationSection inside the paper room", () => {
  it("mounts in its own region and adds no interactive element to the room", async () => {
    const INTERACTIVE =
      /<(button|input|select|textarea|form|a\s[^>]*href)\b|contentEditable|onClick|onChange|onSubmit|role="(button|switch|checkbox|link|combobox|option|menuitem)"/gi
    vi.doMock("@/components/TradingSuite", () => ({
      PaperTradingCard: () => <button type="button">paper trade</button>
    }))
    vi.doMock("@/components/LedgerPanel", () => ({ LedgerPanel: () => <button type="button">flush</button> }))
    vi.doMock("@/components/TradeJournalPanel", () => ({
      TradeJournalPanel: () => <button type="button">journal</button>
    }))
    vi.doMock("@/components/RiskMetricsCard", () => ({
      RiskMetricsCard: () => <button type="button">risk</button>
    }))
    vi.doMock("@/lib/trading", () => ({
      getPaperPositions: async () => ({ positions: [] }),
      getPaperHistory: async () => ({ closed: [] })
    }))
    vi.doMock("@/terminal/routes/PaperLiveRoom", () => ({
      PaperLiveRoom: () => <div data-testid="paper-live-stub" />
    }))
    vi.doMock("@/terminal/adapters/governanceReading", () => ({
      fetchPaperLivePermit: async () => ({ readout: null, error: null }),
      fetchBrokerRegistry: async () => ({ readout: null, error: null }),
      fetchCommandCentreOverview: async () => ({ readout: null, error: null }),
      fetchCeremonyReadout: async () => ({ readout: null, error: null })
    }))
    vi.doMock("@/lib/graduation", () => ({ fetchGraduationOverview: vi.fn().mockResolvedValue(fixture()) }))
    vi.resetModules()

    const { PaperRoom } = await import("../PaperRoom")
    const { renderToStaticMarkup } = await import("react-dom/server")
    const markup = renderToStaticMarkup(<PaperRoom />)

    const regionAt = markup.indexOf('data-paper-region="graduation"')
    expect(regionAt, "the room must mount the graduation section").toBeGreaterThan(-1)
    // Its OWN region, after the ledger — so neither documented half changes.
    expect(regionAt).toBeGreaterThan(markup.indexOf('data-paper-region="ledger"'))
    // And it contributes no interactive control to the room at all.
    const graduationSlice = markup.slice(regionAt)
    expect(markup.slice(0, regionAt).match(INTERACTIVE)?.length ?? 0).toBeGreaterThan(0)
    expect(graduationSlice.match(INTERACTIVE) ?? []).toEqual([])
  })
})