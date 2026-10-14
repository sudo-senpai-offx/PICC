// @vitest-environment jsdom
// W3-05, extended by UI-2, UI-3 and UI-4 — the pre-mortem, symbol-analysis,
// candle-calculator and risk-of-ruin sections are MOUNTED in Command Centre.
//
// The components' own behaviour is proven in their own files. What is proven
// HERE is only that the room actually renders them: a section nobody mounted
// passes every test in its own file while being invisible in the product, which
// is the ordinary way a "done" UI feature turns out to be nothing.
//
// Deliberately NOT in the paper room: PaperLiveRoom.test.tsx enumerates every
// interactive element in that room's markup against an authorised allowlist, and
// the inputs and buttons these sections add would correctly be rejected there.
// Command Centre's own header already records it as an order-execution surface
// despite D1 calling the room read-only.
//
// The POSITION assertion has been rewritten twice rather than deleted. It
// previously proved the pre-mortem section was the room's LAST child, which the
// second section made false; UI-4 made it false again. Each time the honest
// version got stronger: it now pins the ORDER of all four readouts and their
// position relative to the room's header, which is the first element every other
// child renders into. Measuring it as sibling position rather than by counting
// data-testids matters: counting would have counted each section's own internals,
// and the room's other children are stubbed to null here so their testids do not
// exist at all.

import { describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CommandCentreRoom } from "../CommandCentreRoom"
import { fetchCandles } from "@/hooks/useCandleData"
import { fetchRiskOfRuin } from "@/lib/riskOfRuin"

// The candle source is mocked so "the room adds no traffic on mount" is an
// assertion rather than an assumption. The timeframe vocabulary is kept real,
// since the calculator panels genuinely read it.
vi.mock("@/hooks/useCandleData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCandleData")>()),
  fetchCandles: vi.fn()
}))

// Every child is stubbed to render nothing. The room's own children each fetch,
// poll and hold state; stubbing them keeps this test about the MOUNT and nothing
// else, so a failure here can only mean a section stopped being rendered.
//
// The two analysis sections are deliberately NOT stubbed: they are the thing
// under test, and neither fetches on mount, so rendering them for real costs
// nothing and proves the room reaches them.
vi.mock("@/components/TradingSuite", () => ({ SignalsCard: () => null }))
vi.mock("@/components/CommandCentrePanel", () => ({ CommandCentrePanel: () => null }))
vi.mock("@/components/UnlockCeremony", () => ({ UnlockCeremony: () => null }))
vi.mock("@/components/LeaderIdeasPanel", () => ({ LeaderIdeasPanel: () => null }))
vi.mock("@/components/PerpsCommandCentre", () => ({ PerpsCommandCentre: () => null }))
vi.mock("@/components/PatternPanel", () => ({ PatternPanel: () => null }))
vi.mock("@/components/AdvancedIndicatorsPanel", () => ({ AdvancedIndicatorsPanel: () => null }))
vi.mock("@/lib/trading", () => ({ getTradingSignals: vi.fn().mockResolvedValue([]) }))
vi.mock("@/terminal/routes/ReadOnlyRoom", () => ({ ReadOnlyRoom: () => null }))

// The risk-of-ruin network client is mocked so "the room adds no traffic on
// mount" is an assertion rather than an assumption for the UI-4 section too. Its
// TYPE — the provenance record — is left real, because a panel gating on
// something other than the server's own `state` is the defect under test and a
// fake discriminator would hide exactly that.
vi.mock("@/lib/riskOfRuin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/riskOfRuin")>()),
  fetchRiskOfRuin: vi.fn()
}))

describe("CommandCentreRoom", () => {
  it("renders all four readouts at the bottom, in order, so none is orphaned", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<CommandCentreRoom />))
    flushSync(() => {})

    const premortem = container.querySelector('[data-testid="premortem-section"]')
    const analysis = container.querySelector('[data-testid="market-analysis-section"]')
    const calculators = container.querySelector('[data-testid="candle-calc-section"]')
    const ruin = container.querySelector('[data-testid="risk-of-ruin-section"]')
    expect(premortem).not.toBeNull()
    expect(analysis).not.toBeNull()
    expect(calculators).not.toBeNull()
    expect(ruin).not.toBeNull()

    const siblings = Array.from(ruin!.parentElement?.children ?? [])
    // All four readouts are opt-in and three of the four analysis routes make the
    // SERVER fetch per symbol, so none may sit above the panels the room exists to
    // serve.
    const headerIndex = siblings.findIndex((el) => el.hasAttribute("data-room"))
    const premortemIndex = siblings.indexOf(premortem!)
    const analysisIndex = siblings.indexOf(analysis!)
    const calculatorsIndex = siblings.indexOf(calculators!)
    const ruinIndex = siblings.indexOf(ruin!)
    expect(headerIndex, "the room's header is the first rendered child").toBe(0)
    expect(premortemIndex).toBeGreaterThan(headerIndex)
    expect(analysisIndex).toBeGreaterThan(premortemIndex)
    expect(calculatorsIndex).toBeGreaterThan(analysisIndex)
    expect(ruinIndex).toBeGreaterThan(calculatorsIndex)
    // And the risk-of-ruin panel is the very last thing in the room.
    expect(siblings[siblings.length - 1]).toBe(ruin)

    flushSync(() => root.unmount())
    container.remove()
  })

  it("renders the opt-in readouts WITHOUT fetching, so the room gains no traffic", () => {
    // The three calculator routes fetch nothing server-side, so those panels read
    // the dashboard's own candle source — and they must do it only on the run
    // button. The risk-of-ruin route is the same: four caller-supplied numbers
    // and a ledger read that must not happen until asked for. A section that read
    // on mount would add a request to every visit of this room.
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<CommandCentreRoom />))
    flushSync(() => {})

    expect(fetchCandles).not.toHaveBeenCalled()
    expect(fetchRiskOfRuin).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="cc-regime-idle"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="cc-expiry-idle"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="cc-stops-idle"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="roe-idle"]')).not.toBeNull()

    flushSync(() => root.unmount())
    container.remove()
  })
})