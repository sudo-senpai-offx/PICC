// @vitest-environment jsdom
// W3-05 — the pre-mortem section is MOUNTED in Command Centre.
//
// The component's own behaviour is proven in PreMortemSection.test.tsx. What is
// proven HERE is only that the room actually renders it: a section nobody mounted
// passes every test in its own file while being invisible in the product, which is
// the ordinary way a "done" UI feature turns out to be nothing.
//
// Deliberately NOT in the paper room: PaperLiveRoom.test.tsx enumerates every
// interactive element in that room's markup against an authorised allowlist, and
// this section's run button would correctly be rejected there. Command Centre's
// own header already records it as an order-execution surface despite D1 calling
// the room read-only, so the button introduces no new interaction class.

import { describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CommandCentreRoom } from "../CommandCentreRoom"

// Every child is stubbed to render nothing. The room's own children each fetch,
// poll and hold state; stubbing them keeps this test about the MOUNT and nothing
// else, so a failure here can only mean the section stopped being rendered.
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
  it("renders the pre-mortem section, so it is reachable and not orphaned", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    flushSync(() => root.render(<CommandCentreRoom />))
    flushSync(() => {})

    expect(container.querySelector('[data-testid="premortem-section"]')).not.toBeNull()

    // Mounted LAST among the room's own sections: the readout costs ~11s per run
    // and is opt-in, so it must not sit above the panels the room exists to serve.
    // Measured as sibling POSITION, not by counting data-testids — that would have
    // counted the section's own internals, and the room's other children are
    // stubbed to null here so their testids do not exist at all.
    const section = container.querySelector('[data-testid="premortem-section"]')!
    const siblings = Array.from(section.parentElement?.children ?? [])
    expect(siblings[siblings.length - 1]).toBe(section)

    flushSync(() => root.unmount())
    container.remove()
  })
})