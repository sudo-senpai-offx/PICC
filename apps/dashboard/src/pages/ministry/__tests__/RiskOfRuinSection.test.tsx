// @vitest-environment jsdom
// UI-4 — RiskOfRuinSection: the panel for the route that was reporting numbers
// it chose itself without saying so.
//
// THE CONTRACT UNDER TEST, IN FOUR PARTS:
//
//   1. NOTHING FETCHES ON MOUNT. The readout costs a ledger read plus an
//      arithmetic pass, and the room it lives in is an order-execution surface
//      (see CommandCentreRoom's own header), so a panel that fetched on arrival
//      would add a request to every visit of the room.
//   2. EVERY INPUT CARRIES ITS PROVENANCE IN ITS OWN BLOCK. This is the rule the
//      whole task exists for, and it is asserted STRUCTURALLY rather than by
//      looking at prose: the assumption text and the number must be inside the
//      SAME element. A panel that renders four confident numbers and one
//      footnote reading "some inputs were assumed" satisfies a text assertion and
//      satisfies no reader — the footnote is read after the numbers, or never.
//   3. THE GATE IS ON `state`, NEVER ON A VALUE. `used` is a number and a
//      substituted `avgPayout` of 0.8 is indistinguishable from a supplied 0.8,
//      so a panel gated on the number would label a typed 0.8 as assumed. Every
//      branch below reads `state` or tests for a key's presence.
//   4. A REFUSAL RENDERS AS A REFUSAL CARRYING ITS REASON, and clears any
//      previous readout — the same rule MarketAnalysisSection follows, for the
//      same reason: two answers under one label is how a stale success gets read
//      as the answer to a question that failed.
//
// `act()` IS NOT USED ANYWHERE IN THIS FILE — this harness is not configured for
// it, so it is a no-op that lets assertions run before React commits. Async loads
// settle on the repo's SHARED `waitForText` (`src/test-utils/waitForText.ts`),
// already imported by six sibling suites. No local copy, no `react-dom/test-utils`.
//
// EVERY MARKER BELOW IS NOW USED BY AT LEAST ONE `settleOn` CALL, and every one
// is FALSE AT MOUNT. Both halves are load-bearing and neither was true of this
// file before: a marker nothing waits on is a claim nobody checks, and a marker
// that is TRUE at mount settles the wait before anything committed, so every
// assertion written after it races the commit it was waiting for.
//
// The claim used to read "EVERY MARKER BELOW IS FALSE AT MOUNT" over a table
// where three of seven markers were never passed to `settleOn` at all, so it was
// unfalsifiable for them. Two of those three were false at mount and are now
// asserted (`measuredAt`, `measuredZero`). The third, `winRateRow`, was NOT — it
// has been DELETED rather than used, because "win rate" is the winRate field's
// own always-rendered `<label>`, so it is true at mount and would have settled
// every wait instantly.
//
// `waitForText` reads `container.textContent` only, so placeholder ATTRIBUTES
// are invisible to it. The mount-time text is exactly: the heading, the note,
// "Inputs", "run", the four field labels, and "not yet run." — which is why a
// digit is a usable marker and a field label is not.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { waitForText } from "@/test-utils/waitForText"
import { RiskOfRuinSection } from "../RiskOfRuinSection"
import { fetchRiskOfRuin } from "@/lib/riskOfRuin"
import type {
  RiskOfRuinInput,
  RiskOfRuinMeasured,
  RiskOfRuinProvenanceEntry,
  RiskOfRuinResponse
} from "@/lib/riskOfRuin"

// The section reuses `MeasuredAt` from the candle-calculator section (see its
// header for why) rather than writing a fourth copy, and that pulls two modules
// into this graph. Both are mocked so importing them costs no network and no
// module side effect; neither is what this file tests.
vi.mock("@/hooks/useCandleData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCandleData")>()),
  fetchCandles: vi.fn()
}))
vi.mock("@/lib/candleCalculators", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/candleCalculators")>()),
  fetchRegime: vi.fn(),
  fetchExpiry: vi.fn(),
  fetchAdaptiveStops: vi.fn()
}))

// The network client is mocked; the DISCRIMINATORS are not. A panel that gates on
// something other than the service's own branch label is the defect under test,
// and a fake discriminator would hide exactly that.
vi.mock("@/lib/riskOfRuin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/riskOfRuin")>()),
  fetchRiskOfRuin: vi.fn()
}))

const roeMock = vi.mocked(fetchRiskOfRuin)

// ---------------------------------------------------------------------
// Fixtures — each one is a shape the SERVER actually serves.
// ---------------------------------------------------------------------

/** One input, supplied and in range. The control every other fixture departs from. */
function supplied(used: number): RiskOfRuinProvenanceEntry {
  return { state: "supplied", supplied: true, used, substitute: null, clamp: null }
}

/** One input the caller never sent, with the substitute the server chose. */
function substituted(used: number, value = used, source = "server-constant"): RiskOfRuinProvenanceEntry {
  return {
    state: "substituted",
    supplied: false,
    used,
    substitute: { value, source, reason: "caller sent no value" },
    clamp: null
  }
}

/** One input the caller sent that was out of range. */
function clamped(
  from: number,
  to: number,
  bound: string,
  note?: string
): RiskOfRuinProvenanceEntry {
  return {
    state: "clamped",
    supplied: true,
    used: to,
    substitute: null,
    clamp: note === undefined ? { from, to, bound } : { from, to, bound, note }
  }
}

/** A well-formed served response, exactly as `riskOfRuin` builds one.
 *
 *  Typed `RiskOfRuinMeasured`, NOT the `RiskOfRuinResponse` union, because every
 *  payload this helper builds is `ok: true`. The narrower type is what lets a test
 *  read `.inputs` without a cast, and a fixture that declared the union would have
 *  to assert its way past a discriminant it already knows. */
function served(
  provenance: Record<RiskOfRuinInput, RiskOfRuinProvenanceEntry>,
  assumedInputs: RiskOfRuinInput[],
  clampedInputs: RiskOfRuinInput[] = []
): RiskOfRuinMeasured {
  return {
    ok: true,
    riskOfRuin: 0.0181,
    riskOfRuinPct: "1.81%",
    edge: "10%",
    unitsToRuin: 20,
    expectedGrowthPct: "2.31%",
    kellyFraction: "5%",
    halfKellyPct: "2.5%",
    inputs: { winRate: 55, avgPayout: 1, riskPct: 5, balance: 1000 },
    provenance: { ...provenance, assumedInputs, clampedInputs }
  }
}

const ALL_SUPPLIED = served(
  {
    winRate: supplied(55),
    avgPayout: supplied(1),
    riskPct: supplied(5),
    balance: supplied(1000)
  },
  []
)

const ALL_ASSUMED = served(
  {
    winRate: substituted(50),
    avgPayout: substituted(0.8),
    riskPct: substituted(2),
    balance: substituted(1000)
  },
  ["winRate", "avgPayout", "riskPct", "balance"]
)

/**
 * A SERVER WHOSE `inputs` BLOCK IS WIDER THAN THE PANEL'S FOUR ROWS.
 *
 * WHY THIS SHAPE EXISTS, stated plainly because the server does not produce it
 * today: `riskOfRuinProvenance.test.mjs:498` pins the served block to exactly
 * the four keys below, and nothing in this repo emits a fifth. The fixture is
 * the payload as it would arrive the moment that service grows an input — and
 * the panel's only defence against being wrong about that is that it does not
 * TYPE the count. The service is untyped `.mjs`, so nothing at the wire stops
 * the fifth key; the client's four-key interface is the only thing asserting
 * four, and a client assertion is not a guarantee a server change cannot break.
 *
 * The assertion below is cast rather than widened deliberately: the extra key is
 * a fact about the WIRE, not about `RiskOfRuinInputs`, and typing the fixture to
 * the interface would make the thing under test unreachable to a reader who
 * believes the interface.
 *
 * `edgePct` is a name that does not exist anywhere in this panel on purpose. It
 * has no `provenance` entry and no `<li>`, so a renderer that walked
 * `Object.keys(data.inputs)` to build its rows would produce a fifth row with no
 * number on it; the panel maps `FIELDS`, so it produces four.
 */
const FIFTH_INPUT: RiskOfRuinMeasured = {
  ...ALL_ASSUMED,
  inputs: { ...ALL_ASSUMED.inputs, edgePct: 12 } as RiskOfRuinMeasured["inputs"]
}

/** THE MIXED CASE, and the one a real operator meets: two typed, two assumed. */
const MIXED = served(
  {
    winRate: supplied(55),
    avgPayout: substituted(0.8),
    riskPct: clamped(0, 0.1, "risk per trade outside 0.1%-100%", "a risk fraction of zero or less has no finite number of units to ruin"),
    balance: substituted(1000, 1000, "signal-accuracy-ledger")
  },
  ["avgPayout", "balance"],
  ["riskPct"]
)

/** ASSUMED *AND* CLAMPED — the two compose, and reporting one alone misleads. */
const ASSUMED_AND_CLAMPED = served(
  {
    winRate: {
      state: "clamped",
      supplied: false,
      used: 1,
      substitute: { value: 0.4, source: "signal-accuracy-ledger", reason: "caller sent no value" },
      clamp: { from: 0.4, to: 1, bound: "win rate outside 1%-99%", note: "outside the range this calculator supports" }
    },
    avgPayout: supplied(1),
    riskPct: supplied(5),
    balance: supplied(1000)
  },
  ["winRate"],
  ["winRate"]
)

/** A MEASURED 0. The one value a `value ?? 0` anywhere would destroy. */
const MEASURED_ZERO_PAYOUT = served(
  {
    winRate: supplied(55),
    avgPayout: supplied(0),
    riskPct: supplied(5),
    balance: supplied(1000)
  },
  []
)

/**
 * The route's own refusal shape, exactly as the route writes it: `{ok: false, error}`
 * and nothing else. Deliberately NOT padded with nulls the server never sends —
 * a fixture that invented fields would let a renderer read a key that does not
 * exist and pass a test that proves nothing.
 */
const REFUSED: RiskOfRuinResponse = {
  ok: false,
  error: "the accuracy ledger is unreadable"
}

// ---------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  roeMock.mockReset()
  roeMock.mockResolvedValue(ALL_SUPPLIED)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  flushSync(() => root.unmount())
  container.remove()
})

const settle = (marker: string) => waitForText({ host: container }, marker)

// EVERY ENTRY IS FALSE AT MOUNT AND IS WAITED ON BY AT LEAST ONE TEST. See the
// header for why `winRateRow` was removed rather than used: "win rate" is a
// mount-time label, so it is true before anything is fetched.
const MARKERS = {
  result: "risk of ruin",
  summary: "input(s) were not supplied",
  refused: "refused",
  error: "risk of ruin unavailable",
  measuredAt: "fetched",
  measuredZero: "0"
} as const

const settleOn = (testId: keyof typeof MARKERS) => settle(MARKERS[testId])

const render = (element: React.ReactElement = <RiskOfRuinSection />) => {
  flushSync(() => root.render(element))
}

const id = (testId: string) => container.querySelector(`[data-testid="${testId}"]`)
const ids = (testId: string) => [...container.querySelectorAll(`[data-testid="${testId}"]`)]
const text = (testId: string) => id(testId)?.textContent ?? ""

function click(testId: string) {
  const btn = id(testId)
  if (!btn) throw new Error(`${testId} not found`)
  flushSync(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
}

/** The inputs are uncontrolled, so the value is simply set before the click. */
function type(testId: string, value: string) {
  const input = id(testId)
  if (!input) throw new Error(`${testId} not found`)
  ;(input as HTMLInputElement).value = value
}

/** Type all four fields. An empty string means "send nothing". */
function fill(values: Partial<Record<RiskOfRuinInput, string>>) {
  for (const [field, value] of Object.entries(values)) {
    type(`roe-field-${field}`, value as string)
  }
  click("roe-run")
}

// ---------------------------------------------------------------------
// 1. Nothing fetches on mount
// ---------------------------------------------------------------------

describe("RiskOfRuinSection fetches nothing on mount", () => {
  it("renders an idle panel and makes no request", () => {
    render()
    expect(roeMock).not.toHaveBeenCalled()
    expect(id("roe-idle")).not.toBeNull()
    expect(id("roe-result")).toBeNull()
  })
})

// ---------------------------------------------------------------------
// 2 + 3. PROVENANCE, IN THE SAME BLOCK AS THE NUMBER
// ---------------------------------------------------------------------

describe("RiskOfRuinSection renders each input's provenance beside its own number", () => {
  it("an all-assumed response marks every row assumed and names the substitute", async () => {
    roeMock.mockResolvedValue(ALL_ASSUMED)
    render()
    fill({ winRate: "", avgPayout: "", riskPct: "", balance: "" })
    await settleOn("result")

    for (const field of ["winRate", "avgPayout", "riskPct", "balance"] as RiskOfRuinInput[]) {
      const row = text(`roe-input-${field}`)
      expect(row, `${field} must say it was assumed`).toContain("assumed")
      // AND IT MUST NAME WHAT WAS ASSUMED, or the row says "assumed" and the
      // reader still does not know which number is on screen.
      expect(row, `${field} must name the substitute value`).not.toMatch(/assumed\s*$/)
      expect(row, `${field} must carry the server's reason`).toContain("caller sent no value")
    }
    // THE STRUCTURAL CLAIM: the number and its assumption share one element, so
    // there is no version of this panel where the number is legible and the
    // caveat is somewhere else on the page.
    const riskRow = id("roe-input-riskPct")
    expect(riskRow?.textContent).toContain("2")
    expect(riskRow?.textContent).toContain("assumed")
  })

  it("an all-supplied response marks NOTHING assumed — the direction that catches a false 'assumed'", async () => {
    // THE SECOND DIRECTION. A panel that labels "assumed" over a value the user
    // typed is its own dishonesty, in the opposite direction from the defect this
    // whole task fixes, and it is invisible unless a supplied response is
    // rendered and inspected.
    roeMock.mockResolvedValue(ALL_SUPPLIED)
    render()
    fill({ winRate: "55", avgPayout: "1", riskPct: "5", balance: "1000" })
    await settleOn("result")

    for (const field of ["winRate", "avgPayout", "riskPct", "balance"] as RiskOfRuinInput[]) {
      expect(text(`roe-input-${field}`), `${field} must not be called assumed`).not.toContain("assumed")
      expect(text(`roe-input-${field}`), `${field} must read as supplied`).toContain("supplied")
    }
    // And the summary counts the server's own list, not the panel's guess.
    expect(text("roe-summary")).toContain("0")
    expect(text("roe-summary")).toContain("4")
  })

  it("a clamped row says clamped, names both ends and the bound — in the same block", async () => {
    roeMock.mockResolvedValue(MIXED)
    render()
    fill({ riskPct: "0" })
    await settleOn("result")

    const row = text("roe-input-riskPct")
    expect(row).toContain("clamped")
    expect(row).toContain("0")
    expect(row).toContain("0.1")
    expect(row).toContain("risk per trade outside 0.1%-100%")
    // A typed zero is not an assumption, so this row must NOT also claim to be.
    expect(row, "a number the user typed is not an assumption").not.toContain("assumed")
  })

  it("an input that was BOTH assumed and clamped says both, not one of them", async () => {
    roeMock.mockResolvedValue(ASSUMED_AND_CLAMPED)
    render()
    fill({})
    await settleOn("result")

    const row = text("roe-input-winRate")
    expect(row, "the assumption must survive alongside the clamp").toContain("assumed")
    expect(row).toContain("clamped")
    // And the substitute it assumed is the LEDGER's 0.4, not the 1 that was used
    // — a reader who is told only "clamped to 1" would think 1 was the recorded
    // win rate.
    expect(row).toContain("0.4")
    expect(row).toContain("signal-accuracy-ledger")
  })

  it("a ledger-sourced assumption says so in words, not as a bare flag", async () => {
    roeMock.mockResolvedValue(MIXED)
    render()
    fill({})
    await settleOn("result")
    const row = text("roe-input-balance")
    expect(row).toContain("signal-accuracy-ledger")
    expect(row).toContain("caller sent no value")
  })

  it("a MEASURED payout of 0 prints as 0 and stays 'supplied' — never 'absent'", async () => {
    // THE `| null` CONVENTION, ON THE ONE FIELD WHERE A 0 IS A REAL ANSWER. A
    // `value ?? 0` or a truthiness gate anywhere between here and the DOM would
    // turn this into either a blank row or a fabricated substitute — and the
    // server spent a clamp record deciding this zero is in range.
    roeMock.mockResolvedValue(MEASURED_ZERO_PAYOUT)
    render()
    fill({ avgPayout: "0" })
    // SETTLED ON THE ZERO ITSELF, not on the generic result marker. Nothing at
    // mount contains a digit — the placeholder `blank = 0.8` is an ATTRIBUTE and
    // `waitForText` reads `textContent` only — so "0" cannot arrive before the
    // readout commits, which is exactly what this test is about.
    await settleOn("measuredZero")

    const row = text("roe-input-avgPayout")
    expect(row).toContain("supplied")
    expect(row).not.toContain("absent")
    expect(row).not.toContain("assumed")
    expect(row).not.toContain("undefined")
    // And it is the zero itself on the page, with its unit, not a blank cell.
    // Asserted as the literal the row renders rather than as a regex over prose:
    // `\b0\b` cannot match "0x" — the two characters are both word characters —
    // so the obvious assertion silently passes on a row that printed nothing.
    expect(row).toContain("avg payout 0x")
  })

  it("the summary counts what the server said, and names which inputs", async () => {
    roeMock.mockResolvedValue(MIXED)
    render()
    fill({})
    await settleOn("result")

    const summary = text("roe-summary")
    // 2 assumed, 1 clamped, 4 inputs — all from the payload's own lists, so a
    // panel that counted values instead would report something different.
    expect(summary).toContain("2")
    expect(summary).toContain("avgPayout")
    expect(summary).toContain("balance")
    expect(summary).toContain("clamped")
    expect(summary).toContain("riskPct")
  })
})

// ---------------------------------------------------------------------
// 5. The renders the provenance summary does NOT stand in for
// ---------------------------------------------------------------------

describe("RiskOfRuinSection renders the two things its summary cannot replace", () => {
  // BOTH OF THESE WERE UNBOUND. Deleting the whole `roe-echo` paragraph AND the
  // `<MeasuredAt>` render from the section left every test in this file green,
  // which means the suite had no opinion about either. They are asserted here
  // because they carry information nothing else on the panel does: the stamp
  // says WHEN the answer was computed, and the echo is the rounded block the
  // server has always returned, which the per-input rows deliberately do NOT
  // replace — they carry the exact `used` values instead.

  it("a measured readout carries the staleness stamp, bound to that answer", async () => {
    roeMock.mockResolvedValue(ALL_SUPPLIED)
    render()
    fill({ winRate: "55", avgPayout: "1", riskPct: "5", balance: "1000" })
    await settleOn("measuredAt")

    expect(id("roe-measured-at"), "a readout with no age is a number with no date").not.toBeNull()
    expect(text("roe-measured-at")).toContain("fetched")
  })

  it("the server's rounded echo stays visible beside the exact per-input values", async () => {
    // THE TWO NUMBERS DIFFER BY ROUNDING and the panel has to show both, or a
    // reader comparing them has no statement of which is which. A ledger 47.5%
    // reads 48 in `inputs` and 47.5 in the row; neither alone is the whole fact.
    roeMock.mockResolvedValue(ALL_ASSUMED)
    render()
    fill({})
    await settleOn("summary")

    const echo = text("roe-echo")
    expect(echo, "the echo is the server's own rounded block, not a re-derivation").toContain(
      "win rate 55"
    )
    expect(echo).toContain("avg payout 1")
    expect(echo).toContain("risk per trade 5")
    expect(echo).toContain("balance 1000")
  })

  // THE OLD TEST, AND WHY IT CERTIFIED NOTHING. It read
  //
  //     expect(summary).toContain(`4 of ${Object.keys(inputs).length} input(s) …`)
  //
  // over a fixture the line above had already pinned to four keys. So the
  // expectation was built from the same expression the component uses AND from
  // the one number that made a literal indistinguishable from a derivation: a
  // hardcoded `of {4}` and `of {Object.keys(data.inputs).length}` rendered the
  // identical string. A test named "comes from the server's own block, not a
  // literal" that passes when the literal is restored certifies nothing; this is
  // the `volatilityModel` "conservative default" pattern, one level up.
  //
  // THE FIX IS A FIXTURE WHERE THE TWO WIDTHS DIFFER. `FIFTH_INPUT` is a
  // five-key server block, so the panel's four `FIELDS` rows and the payload's
  // width are not the same number and cannot both be right. The expectation
  // below is a hand-written literal, so it cannot be recomputed from whatever
  // expression the component happens to use.
  it("the summary denominator is the server block's own width, which this fixture makes differ from the row count", async () => {
    roeMock.mockResolvedValue(FIFTH_INPUT)
    render()
    fill({})
    await settleOn("summary")

    const summary = text("roe-summary")
    expect(
      Object.keys(FIFTH_INPUT.inputs),
      "the fixture's own server block is five wide, or this test proves nothing"
    ).toHaveLength(5)
    // HAND-WRITTEN, not derived from anything the component computes. Four of
    // the server's five inputs were assumed; the fifth is a key this panel has no
    // row for. A literal `of {4}` renders "4 of 4" and fails here; so does
    // `FIELDS.length`, which would read the panel's row count instead of the
    // payload's.
    expect(summary).toContain("4 of 5 input(s) were not supplied")
    // AND the panel still renders four ROWS — it maps `FIELDS`, so a payload key
    // with no row does not become a row with no provenance sentence beside it.
    expect(ids("roe-input-winRate")).toHaveLength(1)
    expect(ids("roe-input-balance")).toHaveLength(1)
  })

  // THE ECHO'S LEAD-IN COUNT, WHICH WAS THE WORD "four" IN A STRING LITERAL.
  //
  // Two lines above this one in the same describe, the same commit derived the
  // SUMMARY's count from the payload and said why: it was "the one figure that
  // could quietly become false the day a fifth input was added". This sentence
  // stayed a literal, and it is a claim about how many values the paragraph
  // lists — so a literal in it is the identical defect one line down.
  //
  // THE ASSERTION IS SELF-CONSISTENCY, NOT A PINNED NUMBER, because that is the
  // property that can actually fail: the stated width is read back OUT of the
  // rendered sentence and compared with the number of values that sentence is
  // followed by. Those are two different derivations — one from the string, one
  // from the rendered output — so neither `four`, `five`, nor a dropped count
  // can pass it.
  it("the echo states how many values it lists, and lists that many", async () => {
    roeMock.mockResolvedValue(FIFTH_INPUT)
    render()
    fill({})
    await settleOn("summary")

    const echo = text("roe-echo")
    // Digits, not a word. `rounded echo of the four inputs:` cannot satisfy this
    // pattern, which is the point: a spelled-out count is a count nothing in the
    // payload can check.
    const stated = /rounded echo of the (\d+) inputs:/.exec(echo)
    expect(
      stated,
      `the echo must state its own width in digits; rendered as ${JSON.stringify(echo)}`
    ).not.toBeNull()

    const listed = (echo.split("inputs:")[1] ?? "").trim().split(" · ").filter(Boolean)
    // The stated width is the number of values actually rendered after it. A
    // literal "four" beside four values survives this only by accident; a literal
    // that drifts does not, and neither does deriving the count from the server's
    // block (five) when the paragraph lists four.
    expect(listed, "the stated width must equal the number of values listed").toHaveLength(
      Number(stated![1])
    )
    // Which four: the panel's rows, not the payload's keys. `edgePct` is in the
    // server block and has no row, so counting the payload here would state five
    // over four values.
    expect(listed).toEqual(["win rate 55", "avg payout 1", "risk per trade 5", "balance 1000"])
  })
})

// ---------------------------------------------------------------------
// 6. Refusals
// ---------------------------------------------------------------------

describe("RiskOfRuinSection renders a refusal as a refusal", () => {
  it("a thrown refusal shows the server's words and no readout", async () => {
    roeMock.mockRejectedValue(new Error("401 authentication required"))
    render()
    fill({})
    await settleOn("error")

    expect(text("roe-error")).toContain("401 authentication required")
    expect(id("roe-result"), "a refusal must leave no readout to misread").toBeNull()
  })

  it("a 200 carrying ok:false renders as a refusal, not as an empty panel", async () => {
    // The route's own refusal shape. A client that branches only on `res.ok`
    // renders this as an empty success, which reads as "nothing to report".
    roeMock.mockResolvedValue(REFUSED)
    render()
    fill({})
    await settleOn("refused")

    expect(text("roe-refused")).toContain("the accuracy ledger is unreadable")
    expect(id("roe-result")).toBeNull()
    expect(id("roe-refused-note")).not.toBeNull()
  })

  it("a refusal CLEARS a previous readout rather than sitting beside it", async () => {
    // A second question that failed must not leave the first question's answer
    // standing under the new label.
    roeMock.mockResolvedValueOnce(ALL_SUPPLIED).mockRejectedValueOnce(new Error("502 ledger unreachable"))
    render()
    fill({ winRate: "55" })
    await settleOn("result")
    expect(id("roe-result")).not.toBeNull()

    click("roe-run")
    await settleOn("error")
    expect(id("roe-result"), "the earlier answer must not survive the refusal").toBeNull()
    expect(text("roe-error")).toContain("502 ledger unreachable")
  })
})

// ---------------------------------------------------------------------
// What is actually sent
// ---------------------------------------------------------------------

describe("RiskOfRuinSection sends what the operator typed, and nothing else", () => {
  it("four typed values are sent as four numbers", async () => {
    render()
    fill({ winRate: "55", avgPayout: "1", riskPct: "5", balance: "1000" })
    await settleOn("result")

    expect(roeMock).toHaveBeenCalledTimes(1)
    expect(roeMock.mock.calls[0][0]).toEqual({ winRate: 55, avgPayout: 1, riskPct: 5, balance: 1000 })
  })

  it("a BLANK field is sent as nothing at all, which is what makes the server assume", async () => {
    // The empty-post direction has to be REACHABLE FROM THE PANEL, or the panel
    // could never be shown the response the whole task is about. A blank input
    // must therefore stay absent from the body rather than becoming 0 — `0` is a
    // number the operator did not type, and sending it would be the panel
    // committing the very substitution the server now discloses.
    render()
    fill({ winRate: "55", avgPayout: "", riskPct: "", balance: "" })
    await settleOn("result")

    const sent = roeMock.mock.calls[0][0]
    expect(sent).toEqual({ winRate: 55 })
    expect("avgPayout" in sent, "a blank avgPayout must be absent, not 0").toBe(false)
    expect("riskPct" in sent, "a blank riskPct must be absent, not 0").toBe(false)
  })

  it("an explicit 0 IS sent, as a 0 — the panel must not drop a typed zero", async () => {
    render()
    fill({ riskPct: "0" })
    await settleOn("result")
    expect(roeMock.mock.calls[0][0]).toEqual({ riskPct: 0 })
  })

  it("a field the operator never touched is absent, so all four are assumed", async () => {
    render()
    fill({})
    await settleOn("result")
    expect(roeMock.mock.calls[0][0]).toEqual({})
  })

  it("a non-numeric field is refused BEFORE anything is sent, by name", async () => {
    // Same rule MarketAnalysisSection's order-flow panel follows: a refusal raised
    // client-side beats sending a typo and watching the server substitute for it.
    render()
    type("roe-field-riskPct", "two percent")
    click("roe-run")
    await settleOn("error")

    expect(roeMock, "nothing may be sent when the input is unusable").not.toHaveBeenCalled()
    expect(text("roe-error")).toContain("two percent")
  })
})