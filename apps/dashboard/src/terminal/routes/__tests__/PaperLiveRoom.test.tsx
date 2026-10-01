// @vitest-environment jsdom
// WS-7 T9 room instance 6 of 22 (D1's order): Paper/Live.
//
// THIS FILE IS THE ROOM'S THREE LOAD-BEARING PROPERTIES, EACH WITH THE TEST THAT
// PROVES IT:
//
//   1. FAIL CLOSED (spec :1280 "must fail closed"). Any error, missing data,
//      unreadable store, or unresolved producer renders a state that CANNOT be
//      mistaken for permission — and, the subtler half, not a confident denial
//      either. Written first because an error path that renders "live" or
//      "permitted" is the worst defect in this branch.
//
//   2. NO UNAUTHORISED LIVE AFFORDANCE (spec :1278 "exposes no live toggle beyond
//      what the D19 outcome authorizes"). Proved by ENUMERATING the rendered
//      markup for every interactive element, not by checking a known-bad control
//      is absent — a negative control test passes just as well on a room that
//      rendered nothing at all.
//
//   3. INDEPENDENTLY REVERTIBLE (spec :1280). This room depends on no other room,
//      holds no shared state with one, and renders with no readouts at all.
//
// Plus the D27 completeness verdict, which must name its boundary.

import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"

import { PAPER_LIVE_INTERACTIVE_AFFORDANCES, PAPER_LIVE_VERDICTS, NO_LIVE_AFFORDANCE_REASON } from "../../domain/paperLive"
import { PAPER_LIVE_COMPLETION, PaperLiveRoom } from "../PaperLiveRoom"

/**
 * A module's CODE, with every comment's content blanked out.
 *
 * Needed because every file in this graph explains ITSELF in prose, and the words
 * used in that prose are the same words the static audits look for: this very file
 * says `setAutomationPermitted` while explaining that nothing calls it, and the
 * adapter's header says `credentials` while explaining that it never sets the
 * option. A scan that read comment text would either fail on the documentation or —
 * worse — be satisfied by it. That is the same class
 * `ws7RouteAuthCoverageGuard.test.mjs` documents for gate names appearing in
 * comments, and `roomBisect.test.tsx`'s reader already strips comments for the
 * same reason.
 */
const readCode = (relative: string) => {
  let inBlock = false
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
    .split("\n")
    .map((raw) => {
      let line = raw
      if (inBlock) {
        const close = line.indexOf("*/")
        if (close === -1) return ""
        line = line.slice(close + 2)
        inBlock = false
      }
      const open = line.indexOf("/*")
      if (open !== -1) {
        const close = line.indexOf("*/", open + 2)
        if (close === -1) {
          inBlock = true
          line = line.slice(0, open)
        } else {
          line = line.slice(0, open) + line.slice(close + 2)
        }
      }
      const at = line.indexOf("//")
      return at === -1 ? line : line.slice(0, at)
    })
    .join("\n")
}

/** Every element a reader could operate. `contentEditable` and `on*` included. */
const INTERACTIVE = /<(button|input|select|textarea|form|a\s[^>]*href)\b|contentEditable|onClick|onChange|onSubmit|role="(button|switch|checkbox|link|combobox|option|menuitem)"/gi

function interactiveElements(html: string): string[] {
  return html.match(INTERACTIVE) ?? []
}

/* ==========================================================================
   FIXTURES — shaped like the real producers, and deliberately overridable so a
   SINGLE conjunct can be satisfied while the others are not.
   ========================================================================== */

const permitReadout = (over: Record<string, unknown> = {}) => ({
  ok: true,
  version: "paper-live-permit/1.0.0",
  ladder: { rungs: ["paper", "demo", "live"], rule: "The ladder is strict and one-directional." },
  brokers: [
    {
      brokerId: "paper",
      automationPermitted: false,
      recordedFlag: false,
      provenanceResolves: false,
      permitChangedAt: null,
      permitChangedByAuthorityId: null,
      ceremonyUnlocked: false,
      changeCount: 0,
      verdictReason: "Not permitted, and never granted: the flag is at D5's false default."
    }
  ],
  residual: "A refused DECLINE leaves the recorded flag at its previous value.",
  absences: [{ what: "NO PRODUCTION AUTHORITY SET", detail: "No authority registry is wired." }],
  ...over
})

const brokerRegistry = (over: Record<string, unknown> = {}) => ({ ok: true, activeExecutor: "paper", ...over })

const overviewReadout = (over: Record<string, unknown> = {}) => ({
  ok: true,
  sites: [
    {
      site: "trading:ccxt",
      executionLeg: { leg: "proposals", consent: "per-action human consent (consentBy) — NOT an automation opt-in" },
      gates: [
        {
          gate: "per-site-opt-in",
          status: "not-decided",
          note: "automation opt-in is a DECISION, not an approval — none has ever been granted."
        },
        { gate: "envelope-within-ceiling", status: "pass", note: "concurrent ceiling observed." }
      ]
    }
  ],
  ...over
})

const ceremonyReadout = (over: Record<string, unknown> = {}) => ({
  ok: true,
  classes: [{ venueClass: "ccxt-crypto", enablement: null }]
  ,...over
})

const all = (over: Partial<Parameters<typeof PaperLiveRoom>[0]["readouts"]> = {}) => ({
  permit: permitReadout(),
  brokers: brokerRegistry(),
  overview: overviewReadout(),
  ceremony: ceremonyReadout(),
  ...over
})

const NONE = { permit: null, brokers: null, overview: null, ceremony: null }

const render = (readouts: Parameters<typeof PaperLiveRoom>[0]["readouts"]) =>
  renderToStaticMarkup(<PaperLiveRoom readouts={readouts} />)

afterEach(() => {
  // ALL FOUR, not just the first. The page-composition test mocks four modules and
  // unmocking one leaves three mocked for every later test in the file — which is
  // how a test that asserts on the boundary surface can start failing because of a
  // ledger panel somebody else's test replaced.
  for (const mod of ["@/components/TradingSuite", "@/components/LedgerPanel", "@/components/TradeJournalPanel", "@/components/RiskMetricsCard", "@/lib/trading"]) {
    vi.doUnmock(mod)
  }
  vi.resetModules()
})

/* ==========================================================================
   1. FAIL CLOSED
   ========================================================================== */

describe("WS-7 T9 — Paper/Live fails closed", () => {
  it("renders UNKNOWN with NO readouts at all, and never a derived denial", () => {
    // The starting state of every real session before the first response lands.
    // `unknown` and `no-live-affordance` are DIFFERENT states on purpose: the first
    // says the question could not be asked, the second says it was asked. A room
    // that collapsed them would let an outage read as a clean bill of health.
    const html = render(NONE)
    expect(html).toContain('data-paper-live-verdict="unknown"')
    expect(html).toContain('data-verdict-label="unknown"')
    expect(html).not.toContain('data-paper-live-verdict="no-live-affordance"')
    // And it names WHAT it could not obtain rather than showing empty tables. With
    // nothing obtained there are six: the ladder, the ladder rule, the current rung,
    // the per-broker permit state, the consent rails and the ceremony rails.
    expect(html).toContain('data-missing-count="6"')
    for (const item of [
      "the D6 ladder (from the permit readout)",
      "the current ladder rung (from the broker registry&#x27;s activeExecutor)",
      "the per-broker automationPermitted state (from the permit readout)",
      "the consent rails (from the command-centre gate set)",
      "the ceremony rails (from the WS-3 ceremony store)"
    ]) {
      expect(html, `the absent input must be NAMED: ${item}`).toContain(item)
    }
  })

  it("each of the FOUR producers failing independently yields UNKNOWN, never permission", () => {
    // Exhaustive over the four inputs. A projection that required three of four and
    // derived a verdict from three would pass a test that only dropped one.
    for (const drop of ["permit", "brokers", "overview", "ceremony"] as const) {
      const html = render(all({ [drop]: null }))
      expect(html, `dropping ${drop} must yield unknown`).toContain('data-paper-live-verdict="unknown"')
      expect(html, `dropping ${drop} must not yield a derived denial`).not.toContain('data-paper-live-verdict="no-live-affordance"')
      // And it must never contain a permissive token, in any casing.
      expect(html.toLowerCase()).not.toContain("permitted\":true")
    }
  })

  it("MALFORMED producers are treated as absent, not defaulted", () => {
    // A route that answers 200 with the wrong shape is not a licence to invent
    // values. Each case below would crash or silently default in a naive reader.
    const cases: [string, Parameters<typeof PaperLiveRoom>[0]["readouts"]][] = [
      ["a permit readout with no ladder", all({ permit: permitReadout({ ladder: null }) })],
      ["a permit readout whose ladder has no rungs", all({ permit: permitReadout({ ladder: { rungs: [], rule: "x" } }) })],
      ["a permit readout with a non-array brokers field", all({ permit: permitReadout({ brokers: { nope: true } }) })],
      ["a permit readout whose brokers are not objects", all({ permit: permitReadout({ brokers: ["ccxt", 7, null] }) })],
      ["a broker registry with no activeExecutor", all({ brokers: { ok: true } })],
      ["a broker registry with a non-string activeExecutor", all({ brokers: { ok: true, activeExecutor: 3 } })],
      ["an overview with no sites array", all({ overview: { ok: true, sites: "nope" } })],
      ["an overview with sites but no gates", all({ overview: { ok: true, sites: [{ site: "x" }] } })],
      ["a ceremony readout with no classes array", all({ ceremony: { ok: true } })],
      ["a ceremony readout whose classes are not objects", all({ ceremony: { ok: true, classes: [1, 2] } })]
    ]
    for (const [label, readouts] of cases) {
      const html = render(readouts)
      expect(html, `${label} must fail closed`).toContain('data-paper-live-verdict="unknown"')
    }
  })

it("two producers DISAGREEING about the rung is UNKNOWN, not a reconciled answer", () => {
    // The case a "best effort" reader gets wrong. The broker registry reports a
    // rung the ladder does not contain, so the two producers disagree about which
    // rung execution is on. Picking either one picks a winner in that disagreement,
    // and the losing rung is the unsafe one to guess — so neither is displayed.
    //
    // The fixture is deliberately `activeExecutor: "live"` against a ladder WITHOUT
    // `live`. A "live" executor against the full three-rung ladder is NOT a
    // disagreement — it agrees — and an earlier draft of this test used that shape
    // and asserted a disagreement that did not exist.
    const html = render(all({ permit: permitReadout({ ladder: { rungs: ["paper", "demo"], rule: "x" } }), brokers: brokerRegistry({ activeExecutor: "live" }) }))
    expect(html).toContain('data-paper-live-verdict="unknown"')
    expect(html).toContain('data-current-rung="none"')
    expect(html).toContain("disagree, so no current rung is displayed")
    // And the unsafe rung is nowhere in the output as a CURRENT one.
    expect(html).not.toContain('data-current="true"')
  })

  it("a rung of `live` that BOTH producers agree on still yields NO affordance", () => {
    // The state this room exists to get right, and the one a reader is most likely
    // to mistake for permission. The registry says `live`, the ladder contains it,
    // every producer was obtained — and the verdict is still "no live-trading
    // affordance", because the D5 permit and the AC-026 ceremony unlock are both
    // unmet. The word `live` appears in the output as a FACT, never as a grant.
    const html = render(all({ brokers: brokerRegistry({ activeExecutor: "live" }) }))
    expect(html).toContain('data-paper-live-verdict="no-live-affordance"')
    expect(html).toContain('data-current-rung="live"')
    expect(html).toContain('data-rung="live" data-current="true"')
    expect(html).toContain("no broker&#x27;s provenance-gated automationPermitted read is true (D5)")
    expect(html).toContain("no broker record carries a ceremony unlock (AC-026)")
    // And no permissive permission token anywhere.
    expect(html).not.toContain('data-permission="permitted"')
    expect(html).not.toContain('data-automation-permitted="true"')
  })

  it("the D6 conjunct reports the rung as a FACT and a yes/no, never a string in a boolean field", () => {
    // A defect this file's own fixtures caught: an earlier draft put the rung
    // string into `observed`, so the surface rendered a rung of `live` as
    // `observed-false` beside the value `live` — a self-contradicting row from a
    // wrongly-typed field. Asserted so the type cannot regress.
    const html = render(all({ brokers: brokerRegistry({ activeExecutor: "live" }) }))
    expect(html).toContain('data-requirement="D6" data-observed="observed-true" data-observed-value="true"')
    expect(html).toContain("fact: <span class=\"terminal-paper-live__observed-value\">live</span>")
    // No conjunct may render a non-boolean in its observed-value attribute.
    expect(html).not.toMatch(/data-observed-value="(paper|demo|live)"/)
  })

  it("a rung the ladder does not contain is not shown, even when every other input is fine", () => {
    // The DISAGREEMENT shape again, reached a second way: here the ladder is
    // MISSING a rung rather than the registry inventing one. `paper` is the value
    // the registry reports, so the ladder here deliberately omits it — a fixture
    // that omitted an unrelated rung would leave the two in agreement and assert
    // nothing.
    const html = render(all({ permit: permitReadout({ ladder: { rungs: ["demo", "live"], rule: "x" } }) }))
    expect(html).toContain('data-paper-live-verdict="unknown"')
    expect(html).not.toContain('data-current-rung="paper"')
    expect(html).toContain('data-current-rung="none"')
  })

  it("the DERIVED verdict still requires the permit AND ceremony AND the rung", () => {
    // The rule, proved with fixtures that satisfy ONE conjunct at a time. Without
    // this, a room could pass every test above by never deriving a verdict at all
    // — which is the same vacuous pass this repository keeps getting bitten by.
    const permitTrue = permitReadout({
      brokers: [
        {
          brokerId: "paper",
          automationPermitted: true,
          recordedFlag: true,
          provenanceResolves: true,
          permitChangedAt: 1_700_000_000_000,
          permitChangedByAuthorityId: "auth:ops",
          ceremonyUnlocked: false,
          changeCount: 1,
          verdictReason: "provenance-gated read is true"
        }
      ]
    })

    // (a) Permit granted, nothing else. AC-026: a permit must not substitute for a
    //     ceremony unlock — so this must STILL be no-affordance.
    const permitOnly = render(all({ permit: permitTrue }))
    expect(permitOnly).toContain('data-paper-live-verdict="no-live-affordance"')
    expect(permitOnly).toContain("no broker record carries a ceremony unlock (AC-026)")
    expect(permitOnly).toContain("the ceremony store holds no enablement record for any venue class (AC-026)")

    // (b) Permit AND ceremony unlocked, but no enablement RECORD in the store.
    const noRecord = render(
      all({ permit: permitReadout({ brokers: [{ ...permitTrue.brokers![0] as object, ceremonyUnlocked: true }] }) })
    )
    expect(noRecord).toContain('data-paper-live-verdict="no-live-affordance"')
    expect(noRecord).toContain("no enablement record for any venue class (AC-026)")

    // (c) Everything except the rung: an enablement record exists and a permit is
    //     granted, but the current rung is still `paper`, so D6 forbids it.
    const rungShort = render(
      all({
        permit: permitReadout({ brokers: [{ ...(permitTrue.brokers as any)[0], ceremonyUnlocked: true }] }),
        ceremony: ceremonyReadout({ classes: [{ venueClass: "ccxt-crypto", enablement: { unlocked: true, at: "T", by: "auth:ops" } }] })
      })
    )
    expect(rungShort).toContain('data-paper-live-verdict="no-live-affordance"')
    expect(rungShort).toContain("the current rung is paper, not live (D6)")

    // (d) EVERYTHING satisfied. Even then the room has no permissive verdict to
    //     fall into — it reports the facts and offers nothing. This is the test
    //     that proves the ceiling is the TYPE, not today's data.
    const allSatisfied = render(
      all({
        permit: permitReadout({ brokers: [{ ...(permitTrue.brokers as any)[0], ceremonyUnlocked: true }] }),
        ceremony: ceremonyReadout({ classes: [{ venueClass: "ccxt-crypto", enablement: { unlocked: true, at: "T", by: "auth:ops" } }] }),
        brokers: brokerRegistry({ activeExecutor: "live" })
      })
    )
    expect(allSatisfied).toContain('data-paper-live-verdict="no-live-affordance"')
    expect(allSatisfied).toContain("Every observed conjunct is satisfied. This room still exposes no live affordance")
  })

  it("the verdict vocabulary has NO permissive member, and that is enumerable", () => {
    // A type-level claim is not evidence. The vocabulary is data, and a permissive
    // member added later is a failing test.
    expect([...PAPER_LIVE_VERDICTS].sort()).toEqual(["no-live-affordance", "unknown"])
    for (const verdict of PAPER_LIVE_VERDICTS) {
      expect(verdict, `${verdict} must not read as permission`).not.toMatch(/permitted|armed|live-ok|available|enabled/i)
    }
    // And the completion record carries the same vocabulary, so a room and its
    // verdict record cannot disagree about what states exist.
    expect([...PAPER_LIVE_COMPLETION.verdicts].sort()).toEqual([...PAPER_LIVE_VERDICTS].sort())
    expect(PAPER_LIVE_COMPLETION.verdictVocabulary.permitted).toBe(false)
  })

  it("a bare-boolean record does NOT read as permitted, and the refusal is shown", () => {
    // T16's provenance gate, exercised through the room. The record's own flag is
    // true and the gated read is false; the room must render not-permitted AND
    // show the raw flag beside it, so the gate is visible rather than silent.
    const html = render(
      all({
        permit: permitReadout({
          brokers: [
            {
              brokerId: "ccxt",
              automationPermitted: false,
              recordedFlag: true,
              provenanceResolves: false,
              permitChangedAt: 1_700_000_000_000,
              permitChangedByAuthorityId: "auth:vanished",
              ceremonyUnlocked: false,
              changeCount: 1,
              verdictReason: "flag true but provenance-gated read does not"
            }
          ]
        })
      })
    )
    expect(html).toContain('data-broker="ccxt"')
    expect(html).toContain('data-automation-permitted="false"')
    expect(html).toContain('data-permission="not-permitted"')
    // The raw flag is shown AND labelled as the raw flag.
    expect(html).toContain('data-raw-flag="true"')
    expect(html).toContain('data-recorded-flag-label="raw"')
    // And the residual that explains the direction is on the page.
    expect(html).toContain('data-permit-residual="present"')
  })
})

/* ==========================================================================
   2. THE AFFORDANCE AUDIT — every interactive control, enumerated
   ========================================================================== */

describe("WS-7 T9 — the Paper/Live affordance audit", () => {
  it("the boundary surface renders ZERO interactive elements, on EVERY input shape", () => {
    // Enumerated from the RENDERED MARKUP, over three shapes: nothing obtained, a
    // complete set, and a set whose one broker is fully permitted and
    // ceremony-unlocked. A negative control ("the live toggle is absent") would
    // pass identically on a room that rendered nothing, so this counts instead.
    const htmls = [
      render(NONE),
      render(all()),
      render(
        all({
          permit: permitReadout({
            brokers: [
              {
                brokerId: "ccxt",
                automationPermitted: true,
                recordedFlag: true,
                provenanceResolves: true,
                permitChangedAt: 1_700_000_000_000,
                permitChangedByAuthorityId: "auth:ops",
                ceremonyUnlocked: true,
                changeCount: 1,
                verdictReason: "provenance-gated read is true"
              }
            ]
          }),
          ceremony: ceremonyReadout({ classes: [{ venueClass: "ccxt-crypto", enablement: { unlocked: true, at: "T", by: "auth:ops" } }] }),
          brokers: brokerRegistry({ activeExecutor: "live" })
        })
      )
    ]
    expect(htmls.length).toBe(3)
    for (const html of htmls) {
      const found = interactiveElements(html)
      expect(found, `the Paper/Live surface must render no interactive element; found ${JSON.stringify(found)}`).toEqual([])
    }
  })

  it("the exported affordance enumeration is EMPTY, and that is why the ceiling is zero", () => {
    // Data rather than a comment, so a control added later cannot pass by also
    // editing the prose. The CEILING is D19's outcome, not T9's judgement.
    expect(PAPER_LIVE_INTERACTIVE_AFFORDANCES).toEqual([])
    expect(NO_LIVE_AFFORDANCE_REASON).toMatch(/D19/)
    expect(NO_LIVE_AFFORDANCE_REASON).toMatch(/ceiling is zero/i)
  })

  it("the reason names D19's RECORDED residual, not a paraphrase of the decision", () => {
    // D19's outcome is outcome (B) with an explicit residual at spec :266: "the
    // ceremony unlock has never been granted, so 'gated' is not 'live'". The
    // OUTCOME is the bound, so the room must cite the residual rather than the
    // decision's existence.
    expect(NO_LIVE_AFFORDANCE_REASON).toMatch(/outcome \(B\)/)
    expect(NO_LIVE_AFFORDANCE_REASON).toMatch(/ceremony unlock has never been granted/)
    expect(NO_LIVE_AFFORDANCE_REASON).toMatch(/ceremony:deny:ceremony-action-unreachable/)
    // And it must not claim the rails are absent, which would re-introduce the very
    // false claim D19 corrected.
    expect(NO_LIVE_AFFORDANCE_REASON).not.toMatch(/no (live|venue) (rail|order) exists/i)
  })

  it("the whole `paper` ROOM puts every interactive control inside the ledger region", async () => {
    // The audit the brief asks for, over the real page. The four ledger components
    // are mocked to render a BUTTON each, so the assertion is not vacuous: if the
    // region split did not discriminate, buttons would land outside the ledger
    // region and this fails. The real components' controls are pre-existing and
    // T9 neither added, removed nor rewired any of them.
    vi.doMock("@/components/TradingSuite", () => ({ PaperTradingCard: () => <button type="button">paper trade</button> }))
    vi.doMock("@/components/LedgerPanel", () => ({ LedgerPanel: () => <button type="button">flush</button> }))
    vi.doMock("@/components/TradeJournalPanel", () => ({ TradeJournalPanel: () => <button type="button">journal</button> }))
    vi.doMock("@/components/RiskMetricsCard", () => ({ RiskMetricsCard: () => <button type="button">risk</button> }))
    vi.doMock("@/lib/trading", () => ({
      getPaperPositions: async () => ({ positions: [] }),
      getPaperHistory: async () => ({ closed: [] })
    }))
    vi.resetModules()

    const { PaperRoom } = await import("../../../pages/ministry/PaperRoom")
    const markup = renderToStaticMarkup(<PaperRoom />)

    const boundaryAt = markup.indexOf('data-paper-region="boundary"')
    const ledgerAt = markup.indexOf('data-paper-region="ledger"')
    expect(boundaryAt, "the page must mark the boundary region").toBeGreaterThan(-1)
    expect(ledgerAt, "the page must mark the ledger region, after the boundary").toBeGreaterThan(boundaryAt)

    // Everything up to the ledger marker is the half T9 owns.
    const boundarySlice = markup.slice(0, ledgerAt)
    expect(
      interactiveElements(boundarySlice),
      "the boundary half of the room must contribute no interactive control"
    ).toEqual([])

    // And the controls that DO exist are all in the ledger half.
    const ledgerSlice = markup.slice(ledgerAt)
    expect(interactiveElements(ledgerSlice).length, "the mocked ledger controls are present").toBeGreaterThan(0)

    // The boundary half renders the required four things even inside the page.
    expect(boundarySlice).toContain("D6 escalation ladder")
    expect(boundarySlice).toContain("automationPermitted, per broker record (D5)")
    expect(boundarySlice).toContain("Consent rails")
    expect(boundarySlice).toContain("Ceremony rails")
  })

  it("no module in this room's rendering graph calls a live-enabling endpoint", () => {
    // The static half of the audit, over the FULL graph — room, projection,
    // surface, adapter and the page caller. A room that rendered no control but
    // fetched a mutating endpoint would be a live path with a read-only face.
    const graph = [
      "../PaperLiveRoom.tsx",
      "../../domain/paperLive.ts",
      "../../components/PaperLiveSurface.tsx",
      "../../adapters/governanceReading.ts",
      "../../../pages/ministry/PaperRoom.tsx"
    ]
    // CALL SHAPES, not bare tokens. `PaperLiveRoom.tsx`'s own absence record NAMES
    // `setAutomationPermitted` in a description string while explaining that nothing
    // calls it, and this file says the same in prose; a bare-token scan would fail on
    // the documentation and a scan satisfied by documentation is worse than none.
    const forbidden = [
      "/command-centre/orders/execute",
      "/command-centre/orders/verify",
      "/command-centre/perps/execute",
      "/command-centre/perps/close",
      "/trading/copilot",
      "setAutomationPermitted(",
      "unlockVenueClass(",
      'method: "POST"',
      'method: "PUT"',
      'method: "DELETE"'
    ]
    for (const file of graph) {
      const code = readCode(file)
      for (const needle of forbidden) {
        expect(code, `${file} must not reach ${needle}`).not.toContain(needle)
      }
    }
  })

it("the adapter reaches exactly the four producers, three of them PRE-EXISTING routes", () => {
    // T8's precedent, asserted: Ceremony consumed the route that already existed and
    // shipped zero server files. Three of this room's four reads are reuses, and the
    // FOURTH — the permit — is the only new one. The complementary server-side
    // assertion (that no duplicate route was added over the ceremony or overview
    // store) lives in `server/__tests__/paperLivePermitRoute.test.mjs`, where
    // `handlers.mjs` is read with a path this harness does not have to guess.
    const adapter = readCode("../../adapters/governanceReading.ts")
    expect(adapter).toContain("/trading/paper-live/permits")
    expect(adapter).toContain("/trading/brokers")
    expect(adapter).toContain("/command-centre/overview")
    expect(adapter).toContain("/command-centre/ceremony")
  })

  it("the adapter forwards NO credential to any origin", () => {
    // `ws6SafetySeamGuard.test.mjs:136-138` pins this for the terminal tree; the
    // guard is right for that reason and the fix belongs here, as T8 recorded.
    const adapter = readCode("../../adapters/governanceReading.ts")
    expect(adapter).not.toMatch(/credentials/i)
  })
})

/* ==========================================================================
   3. INDEPENDENTLY REVERTIBLE + the D27 verdict
   ========================================================================== */

describe("WS-7 T9 — the bisect line and the D27 verdict", () => {
  it("renders its own output with NO readouts, so it degrades on its own", () => {
    // The other half of "independently revertible": a room that could not render at
    // all would satisfy independence trivially.
    const html = render(NONE)
    expect(html).toContain('data-room-key="paper"')
    expect(html).toContain('data-paper-live-verdict="unknown"')
    expect(html).toContain('data-live-affordance="none"')
  })

  it("imports no other room, and no Strategy module", () => {
    const graph = [
      "../PaperLiveRoom.tsx",
      "../../domain/paperLive.ts",
      "../../components/PaperLiveSurface.tsx",
      "../../../pages/ministry/PaperRoom.tsx"
    ]
    for (const file of graph) {
      const code = readCode(file)
      expect(code, `${file} must not import the Strategy room`).not.toMatch(/StrategyRoom/)
      expect(code, `${file} must not import a Strategy projection`).not.toMatch(/strategyLive|strategyRoom/)
      // Nor the Ministry room's readout: fetching it would couple the rooms at the
      // transport seam, which both rooms' bisect lines forbid.
      expect(code, `${file} must not fetch the Ministry readout`).not.toMatch(/fetchMinistryGovernance|\/trading\/ministry/)
    }
  })

  it("the D27 verdict is present, and names its boundary rather than claiming a bare complete", () => {
    // `JSON.stringify` serialises the DATA fields only, so a verdict that named its
    // boundary solely in a JSDoc would serialise to a bare "complete" — which is
    // the unflagged trim AC-020 prohibits.
    const serialised = JSON.stringify(PAPER_LIVE_COMPLETION)
    expect(PAPER_LIVE_COMPLETION.room).toBe("paper")
    expect(PAPER_LIVE_COMPLETION.d1Order).toBe(6)
    expect(PAPER_LIVE_COMPLETION.verdict).toBe("complete")
    expect(PAPER_LIVE_COMPLETION.absences.length).toBeGreaterThan(0)
    for (const absence of PAPER_LIVE_COMPLETION.absences) {
      expect(absence.what.length).toBeGreaterThan(0)
      expect(absence.detail.length, `${absence.what} needs a written reason`).toBeGreaterThan(40)
      expect(absence.owner.length).toBeGreaterThan(0)
      expect(absence, `${absence.what} must state whether it is WS-8 scope`).toHaveProperty("isWs8Scope")
    }
    // A COMPLETE verdict with an UNNAMED boundary is the anti-goal, so the absences
    // must be IN the serialised form.
    expect(serialised).toContain("NO PRODUCTION AUTHORITY SET")
    expect(serialised).toContain("NO CEREMONY-UNLOCK PRODUCER")
    expect(serialised).toContain("NO BUILD REGISTRY")
    // And `ws8Handoff: null` is only defensible WITH that reasoning present.
    expect(PAPER_LIVE_COMPLETION.ws8Handoff).toBeNull()
    expect(PAPER_LIVE_COMPLETION.reason).toMatch(/No scope in this room logically belongs to WS-8/)
  })

  it("records the ladder as DISPLAYED, so the acceptance is met rather than asserted", () => {
    // The four things T9's acceptance line names, all rendered from real producers.
    const html = render(all())
    expect(html).toContain("D6 escalation ladder")
    expect(html).toContain('data-rung="paper"')
    expect(html).toContain('data-rung="demo"')
    expect(html).toContain('data-rung="live"')
    expect(html).toContain('data-current="true"')
    expect(html).toContain("automationPermitted, per broker record (D5)")
    expect(html).toContain("per-site-opt-in")
    // The producer's own consent note, verbatim rather than paraphrased.
    expect(html).toContain("per-action human consent (consentBy) — NOT an automation opt-in")
    expect(html).toContain("automation opt-in is a DECISION, not an approval — none has ever been granted.")
    // And the ceremony rail, reported as a RECORD and never as "unlocked".
    expect(html).toContain('data-rail-status="no-enablement-record"')
    expect(html).not.toContain('data-rail-status="unlocked"')
  })

  it("reports a ceremony enablement RECORD without calling the venue unlocked", () => {
    // R1.4's sharpest form: the room reports the record and refuses the word,
    // because "unlocked" is a claim the room is not entitled to make.
    const html = render(all({ ceremony: ceremonyReadout({ classes: [{ venueClass: "ccxt-crypto", enablement: { unlocked: true, at: "T", by: "auth:ops" } }] }) }))
    expect(html).toContain('data-rail-status="enablement-recorded"')
    expect(html).toContain("An enablement record exists")
    expect(html).not.toContain(">unlocked<")
  })
})