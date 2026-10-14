// @vitest-environment jsdom
// W3-05, extended by UI-2 — the pre-mortem and symbol-analysis sections are
// MOUNTED in Command Centre.
//
// The components' own behaviour is proven in their own files. What is proven
// HERE is only that the room actually renders them: a section nobody mounted
// passes every test in its own file while being invisible in the product, which
// is the ordinary way a "done" UI feature turns out to be nothing.
//
// Deliberately NOT in the paper room: PaperLiveRoom.test.tsx enumerates every
// interactive element in that room's markup against an authorised allowlist, and
// the four inputs and four buttons these sections add would correctly be
// rejected there. Command Centre's own header already records it as an
// order-execution surface despite D1 calling the room read-only.
//
// The POSITION assertion was rewritten when UI-2 landed rather than deleted. It
// previously proved the pre-mortem section was the room's LAST child, which the
// second section made false — and the honest version is stronger, because it
// pins the ORDER of the two readouts and their position relative to the room's
// header, which is the first element every other child renders into. Measuring
// it as sibling position rather than by counting data-testids matters: counting
// would have counted each section's own internals, and the room's other children
// are stubbed to null here so their testids do not exist at all.

import { describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CommandCentreRoom } from "../CommandCentreRoom"

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

describe("CommandCentreRoom", () => {
  it("renders both readouts at the bottom, in order, so neither is orphaned", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<CommandCentreRoom />))
    flushSync(() => {})

    const premortem = container.querySelector('[data-testid="premortem-section"]')
    const analysis = container.querySelector('[data-testid="market-analysis-section"]')
    expect(premortem).not.toBeNull()
    expect(analysis).not.toBeNull()

    const siblings = Array.from(analysis!.parentElement?.children ?? [])
    // Both readouts are opt-in and three of the four analysis routes make the
    // SERVER fetch per symbol, so neither may sit above the panels the room
    // exists to serve.
    const headerIndex = siblings.findIndex((el) => el.hasAttribute("data-room"))
    const premortemIndex = siblings.indexOf(premortem!)
    const analysisIndex = siblings.indexOf(analysis!)
    expect(headerIndex, "the room's header is the first rendered child").toBe(0)
    expect(premortemIndex).toBeGreaterThan(headerIndex)
    expect(analysisIndex).toBeGreaterThan(premortemIndex)
    // And the analysis section is the very last thing in the room.
    expect(siblings[siblings.length - 1]).toBe(analysis)

    flushSync(() => root.unmount())
    container.remove()
  })
})