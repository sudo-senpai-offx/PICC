// @vitest-environment jsdom
// WS-7 T7 room instance 2 of 18 (D1's order): Risk.
//
// T7's acceptance line for this room is "Risk surfaces ATR, the 2% drawdown
// disable, and the 3-strike state with honest unavailability". The phrase is
// load-bearing: two of the three capabilities DO NOT EXIST in this tree, so the
// honest-unavailability path is the SPECIFIED behaviour today rather than a
// degraded fallback, and these tests pin it as such.
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { RiskRoom, RISK_COMPLETION } from "../RiskRoom"
import { RiskLayerSurface } from "../../components/RiskLayerSurface"
import { RISK_LAYER_OWNER, RISK_LAYER_SPEC, riskLayerView } from "../../domain/riskLayer"
import type { AtrObservation, DrawdownObservation } from "../../domain/riskLayer"

const ATR: AtrObservation = { atr: 0.0025, period: 14, stopDistance: 0, observedAt: 1_700_000_000_000, source: "indicators.atr" }

describe("T7 room 2 - the risk layer reports each capability's own availability", () => {
  it("names the spec's three values rather than choosing its own thresholds", () => {
    expect(RISK_LAYER_SPEC.atrStop).toBe("ATR(14) stop at 1.5x")
    expect(RISK_LAYER_SPEC.drawdownDisable).toBe("2% daily drawdown disable")
    expect(RISK_LAYER_SPEC.threeStrike).toBe("3-strike rule locks keys for 24h")
  })

  it("renders a live ATR(14) with the 1.5x stop distance derived from it", () => {
    const view = riskLayerView({ atr: ATR, drawdown: null, threeStrike: null })
    const atr = view.readings.find((r) => r.key === "atrStop")
    expect(atr?.availability.status).toBe("live")
    // 0.0025 * 1.5 = 0.00375. The multiplier is applied in exactly one place,
    // so a producer cannot hand the room a stop distance that does not match
    // its own ATR.
    expect(atr?.value).toContain("0.00250")
    expect(atr?.value).toContain("0.00375")
  })

  it("is NOT complete while two of three capabilities are unbuilt, and names the owner", () => {
    const view = riskLayerView({ atr: ATR, drawdown: null, threeStrike: null })
    expect(view.complete).toBe(false)
    expect(view.incompleteOwners).toEqual([RISK_LAYER_OWNER])
  })

  it("marks the two unbuilt capabilities unavailable with a reason, never as zero", () => {
    const view = riskLayerView({ atr: null, drawdown: null, threeStrike: null })
    for (const key of ["drawdownDisable", "threeStrike"] as const) {
      const reading = view.readings.find((r) => r.key === key)
      expect(reading?.availability.status).toBe("unavailable")
      expect(reading?.value).toBeNull()
      expect(reading?.availability.status === "unavailable" ? reading.availability.reason : "").toBeTruthy()
    }
    // A live ATR next to two silent rails must not read as a live risk layer.
    const html = renderToStaticMarkup(<RiskLayerSurface view={view} />)
    expect(html).toContain('data-risk-layer="incomplete"')
    expect(html).toContain(RISK_LAYER_OWNER)
  })

  it("refuses to display the -2% session halt or the -5% daily limit as the 2% daily rail", () => {
    // Both numbers exist in this tree and NEITHER is this capability. A
    // near-match shown under this label would read as a working safety rail.
    //
    // WS-7 T7R-B: this row no longer carries the "NOT IMPLEMENTED" string. The
    // producer exists (`dailyDrawdownDisable`), so claiming the capability is
    // unimplemented would be a false record. What must NOT change is the
    // refusal, which is the part that was ever at risk: with no daily figure
    // supplied, the row must still name both near-matches as rejected rather
    // than adopting either.
    const html = renderToStaticMarkup(<RiskLayerSurface view={riskLayerView({ atr: null, drawdown: null, threeStrike: null })} />)
    const row = html.slice(html.indexOf('data-risk-capability="drawdownDisable"'))
    const rowEnd = row.indexOf("</li>")
    const drawdownRow = row.slice(0, rowEnd)
    expect(drawdownRow).not.toContain("NOT IMPLEMENTED")
    expect(drawdownRow).toContain("cannot be observed")
    expect(drawdownRow).toContain("v32Copilot")
    expect(drawdownRow).toContain("u4faRisk")
    // The live-looking figure must not appear as a value on this row.
    expect(drawdownRow).not.toContain('data-risk-value=')
    // Unavailable must not read as disarmed.
    expect(drawdownRow).toContain("not disarmed")
  })

  it("rejects a stop distance the producer invented rather than deriving one", () => {
    // `stopDistance` is accepted on the input for the producer's convenience
    // but never trusted: the 1.5x is applied in the reading.
    const lying: AtrObservation = { ...ATR, stopDistance: 99 }
    const reading = riskLayerView({ atr: lying, drawdown: null, threeStrike: null }).readings.find((r) => r.key === "atrStop")
    expect(reading?.value).not.toContain("99")
  })

  it("rejects an ATR period other than 14", () => {
    expect(() => riskLayerView({ atr: { ...ATR, period: 20 as never }, drawdown: null, threeStrike: null })).toThrow(
      /ATR period must be 14/
    )
  })

  it("treats a missing ATR as unavailable, and never as an ATR of 0", () => {
    // ATR 0 would mean a market with no range. Stop distance 0 would mean a
    // stop at the entry price, which is catastrophic rather than absent.
    const view = riskLayerView({ atr: { ...ATR, atr: null, stopDistance: null }, drawdown: null, threeStrike: null })
    const atr = view.readings.find((r) => r.key === "atrStop")
    expect(atr?.availability.status).toBe("unavailable")
    expect(atr?.value).toBeNull()
    expect(atr?.detail).toMatch(/not zero/i)
  })
})

describe("T7 room 2 - the two unbuilt capabilities have a working path, not a stub", () => {
  it("evaluates the 2% daily drawdown rail against the DAILY figure, not the session figure", () => {
    const observation: DrawdownObservation = {
      sessionLossPct: 0.5,
      dailyDrawdownPct: 2.4,
      dayKey: "2026-09-30",
      observedAt: 1_700_000_000_000,
      source: "riskHaltStore"
    }
    const reading = riskLayerView({ atr: null, drawdown: observation, threeStrike: null }).readings.find(
      (r) => r.key === "drawdownDisable"
    )
    expect(reading?.availability.status).toBe("live")
    expect(reading?.value).toBe("disable FIRED")
    // A 0.5% session loss with a 2.4% daily loss fires the DAILY rail. If the
    // implementation read the session figure, this would read "armed".
    expect(reading?.detail).toContain("is NOT the rail's input")
  })

  it("reports an armed rail below 2% without rounding into a fire", () => {
    const reading = riskLayerView({
      atr: null,
      drawdown: { sessionLossPct: 0, dailyDrawdownPct: 1.999, dayKey: "2026-09-30", observedAt: 1, source: "s" },
      threeStrike: null
    }).readings.find((r) => r.key === "drawdownDisable")
    expect(reading?.value).toBe("disable armed")
  })

  it("reports a 3-strike lock and a not-yet-struck key from a real counter", () => {
    const locked = riskLayerView({
      atr: null,
      drawdown: null,
      threeStrike: { strikes: 3, lockedUntil: 1_700_086_400_000, observedAt: 1_700_000_000_000, source: "keyLock" }
    }).readings.find((r) => r.key === "threeStrike")
    expect(locked?.value).toBe("key LOCKED")

    const counting = riskLayerView({
      atr: null,
      drawdown: null,
      threeStrike: { strikes: 1, lockedUntil: null, observedAt: 1_700_000_000_000, source: "keyLock" }
    }).readings.find((r) => r.key === "threeStrike")
    expect(counting?.value).toBe("1 of 3 strikes")
  })

  it("rejects a non-integer or negative strike count rather than rendering it", () => {
    for (const strikes of [1.5, -1]) {
      expect(() =>
        riskLayerView({ atr: null, drawdown: null, threeStrike: { strikes, lockedUntil: null, observedAt: 1, source: "s" } })
      ).toThrow(/non-negative integer/)
    }
  })

  it("is complete only when all three report live", () => {
    const view = riskLayerView({
      atr: ATR,
      drawdown: { sessionLossPct: 0, dailyDrawdownPct: 0, dayKey: "d", observedAt: 1, source: "s" },
      threeStrike: { strikes: 0, lockedUntil: null, observedAt: 1, source: "s" }
    })
    expect(view.complete).toBe(true)
    expect(view.incompleteOwners).toEqual([])
  })
})

describe("T7 room 2 - the room is read-only and honest about its own reachability", () => {
  it("renders the room frame and the three capability rows", () => {
    const html = renderToStaticMarkup(<RiskRoom atr={ATR} />)
    expect(html).toContain('data-room-key="risk"')
    for (const key of ["atrStop", "drawdownDisable", "threeStrike"]) {
      expect(html).toContain(`data-risk-capability="${key}"`)
    }
  })

  it("exposes no write affordance of any kind", () => {
    // T10's contract for the read-only rooms is stricter, but a surface that
    // grows a control here would be a scope change nobody notices. The room
    // surfaces state; T9's Paper/Live room owns the rails.
    const html = renderToStaticMarkup(<RiskRoom atr={ATR} />)
    expect(html).not.toMatch(/<button/i)
    expect(html).not.toMatch(/<input/i)
    expect(html).not.toMatch(/<form/i)
    expect(html).not.toMatch(/type="submit"/i)
  })

  it("states a completeness verdict, and no longer carries a resolved blocker", () => {
    // AC-020's verification, and D27's flag-never-trim obligation.
    //
    // WS-7 T7R-B flipped this verdict. T7 recorded
    // "surface-complete, producer-pending, route-unmounted" with a
    // `pendingScope` naming T11 and a `routeBlocker` naming the two frozen
    // assertions. Both producers shipped (`a4fac35`) and the owner's
    // 2026-09-30 ruling plus the WS-6 §0.3 amendment mounted the room, so both
    // fields are GONE rather than reworded — a record that still names a
    // resolved blocker as live is the unflagged drift AC-020 exists to prevent.
    expect(RISK_COMPLETION.verdict).toBe("complete")
    expect(RISK_COMPLETION).not.toHaveProperty("pendingScope")
    expect(RISK_COMPLETION).not.toHaveProperty("routeBlocker")
    expect(RISK_COMPLETION.d1Order).toBe(2)
  })

  it("does not name the deleted route blocker, and names the amendment instead", () => {
    // The direction that actually matters: after the amendment, nothing in this
    // record may still assert that 18 keys is the frozen count or that the
    // assertions stand in the way. Both were true when T7 wrote this and are
    // false now.
    const record = JSON.stringify(RISK_COMPLETION)
    expect(record).not.toMatch(/routeBlocker/)
    expect(record).not.toMatch(/freezes 18/)
    expect(record).not.toMatch(/route-unmounted/)
    expect(record).not.toMatch(/producer-pending/)
    // It must point at where the resolution is recorded.
    expect(RISK_COMPLETION.reason).toContain("0027")
  })

  it("no longer names T11 as pending, because T11 shipped its risk layer", () => {
    // The T7→T11 back-reference in code form, named by plan §4 as something
    // that must not survive. `RISK_LAYER_OWNER` is what feeds every
    // unavailability reason in the room, so it is what had to change.
    expect(RISK_LAYER_OWNER).not.toBe("WS-7 T11")
    expect(RISK_LAYER_OWNER).toBeTruthy()
    expect(JSON.stringify(RISK_COMPLETION)).not.toContain("WS-7 T11")
  })

  it("records the WS-8 boundary explicitly as none", () => {
    // A `null` here is a statement, not an omission: no scope in this room
    // belongs to WS-8, and the unbuilt capabilities are WS-7's own T11.
    expect(RISK_COMPLETION).toHaveProperty("ws8Handoff")
    expect(RISK_COMPLETION.ws8Handoff).toBeNull()
    expect(RISK_COMPLETION.reason).toContain(RISK_LAYER_OWNER)
  })
})
