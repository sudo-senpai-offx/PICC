// @vitest-environment jsdom
// WS-6 T2 — RoomFrame reserved-state rendering (RED).
//
// Spec §4.7: a reserved capability renders a stable component with the
// capability label and room/owner, a workstream identifier, the reason, and a
// timestamp — and with NO fabricated number, chart point, score, source badge,
// or success animation. UNVERIFIED must be visibly different from a legitimate
// zero (PICC Constitution; the order-flow P0 precedent).
import { describe, expect, it, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { RoomFrame } from "../RoomFrame"
import { reserved, unavailable, stale } from "../../domain/availability"

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

describe("RoomFrame — normal room", () => {
  it("renders the room title and exposes its room key", () => {
    const host = render(<RoomFrame roomKey="markets" title="Markets"><div>panel body</div></RoomFrame>)
    expect(host.textContent).toContain("Markets")
    expect(host.querySelector("[data-room-key='markets']")).not.toBeNull()
    expect(host.textContent).toContain("panel body")
  })

  it("does not render a reserved panel when the capability is live", () => {
    const host = render(
      <RoomFrame roomKey="markets" title="Markets">
        <div>real data</div>
      </RoomFrame>
    )
    expect(host.querySelector("[data-availability]")).toBeNull()
  })
})

describe("RoomFrame — reserved capability", () => {
  it("renders the workstream, reason, and capability label", () => {
    const host = render(
      <RoomFrame
        roomKey="markets"
        title="Markets"
        capabilityLabel="Backtest engine"
        reserved={reserved({ workstream: "WS-7", reason: "backtest engine not built" })}
      />
    )
    const panel = host.querySelector("[data-availability='reserved']")
    expect(panel).not.toBeNull()
    expect(host.textContent).toContain("Backtest engine")
    expect(host.textContent).toContain("WS-7")
    expect(host.textContent).toContain("backtest engine not built")
  })

  it("renders NO fabricated number for a reserved capability", () => {
    // The order-flow P0 shipped a fabricated `0` delta. A reserved capability
    // must not reproduce that shape.
    const host = render(
      <RoomFrame
        roomKey="markets"
        title="Markets"
        capabilityLabel="Expectancy"
        reserved={reserved({ workstream: "WS-7", reason: "awaiting 500 resolved samples" })}
      />
    )
    expect(host.querySelector("[data-value]")).toBeNull()
    expect(host.querySelector("[data-metric]")).toBeNull()
  })

  it("does not render a live/source badge or success styling when reserved", () => {
    const host = render(
      <RoomFrame
        roomKey="markets"
        title="Markets"
        reserved={reserved({ workstream: "WS-7", reason: "not built" })}
      />
    )
    expect(host.querySelector("[data-source-badge]")).toBeNull()
    expect(host.querySelector("[data-status='live']")).toBeNull()
  })

  it("marks the reserved state for assistive tech", () => {
    const host = render(
      <RoomFrame roomKey="markets" title="Markets" reserved={reserved({ workstream: "WS-7", reason: "not built" })} />
    )
    const panel = host.querySelector("[data-availability='reserved']")
    expect(panel?.getAttribute("role")).toBe("status")
    expect(panel?.getAttribute("aria-live")).toBe("polite")
  })

  it("renders an unavailable capability with its owner and reason", () => {
    const host = render(
      <RoomFrame
        roomKey="markets"
        title="Markets"
        capabilityLabel="Order flow"
        reserved={unavailable({ reason: "no signed-trades feed", owner: "WS-7", since: 1_700_000_000 })}
      />
    )
    const panel = host.querySelector("[data-availability='unavailable']")
    expect(panel).not.toBeNull()
    expect(host.textContent).toContain("no signed-trades feed")
    expect(host.textContent).toContain("WS-7")
  })

  it("still renders the room title alongside a reserved body", () => {
    const host = render(
      <RoomFrame roomKey="markets" title="Markets" reserved={reserved({ workstream: "WS-8", reason: "queued" })}>
        <div>partial body</div>
      </RoomFrame>
    )
    expect(host.textContent).toContain("Markets")
    expect(host.textContent).toContain("partial body")
  })

  it("renders a STALE capability with its source and reason, not an owner", () => {
    // Regression: the panel originally read `.owner` for every non-reserved
    // status, but a stale reading has `source` + `reason` and no owner. The
    // TypeScript compiler caught this; this test makes the runtime behaviour
    // explicit so the three non-live states cannot be conflated again.
    const host = render(
      <RoomFrame
        roomKey="markets"
        title="Markets"
        capabilityLabel="Candles"
        reserved={stale({ source: "yahoo-daily", observedAt: 1_600_000_000, reason: "feed is DAILY resolution" })}
      />
    )
    const panel = host.querySelector("[data-availability='stale']")
    expect(panel).not.toBeNull()
    expect(host.textContent).toContain("yahoo-daily")
    expect(host.textContent).toContain("feed is DAILY resolution")
  })

  it("never claims an owner for a stale capability", () => {
    const host = render(
      <RoomFrame
        roomKey="markets"
        title="Markets"
        reserved={stale({ source: "yahoo-daily", observedAt: 1_600_000_000, reason: "DAILY only" })}
      />
    )
    expect(host.textContent).not.toMatch(/Owned by/)
  })
})
