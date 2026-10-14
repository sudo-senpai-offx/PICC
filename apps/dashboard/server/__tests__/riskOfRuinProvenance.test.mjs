// UI-4 — the risk-of-ruin readout must say WHICH of its four inputs the caller
// supplied and which the server chose.
//
// WHY THIS FILE IS A SERVER TEST AND NOT A UI TEST. Every previous wave in this
// effort was frontend-only, and each one had to work around a defect the client
// could not see past. This is the opposite case: the client was never handed
// anything to be honest WITH. `handlers.mjs` read four numbers off the body,
// substituted four of its own for any that were missing, and `riskOfRuin` then
// substituted four MORE with `||` — which also treats an explicit `0` as absent.
// A caller that posted nothing received a precisely formatted
// `riskOfRuin`/`edge`/`unitsToRuin`/`kellyFraction` readout computed entirely
// from invented values, and not one field of the response said so.
//
// THE CONTRACT, IN THREE STATES AND NOT TWO, because "supplied or not" is not
// enough to render an honest sentence about a number:
//
//   supplied     — the caller's own value, used as given.
//   substituted  — the caller sent nothing (or something that is not a number),
//                  the server chose a value, and the response NAMES it and says
//                  where it came from: this instance's own accuracy ledger, or a
//                  server constant.
//   clamped      — a value WAS supplied, and it was outside the range this
//                  calculator supports, so a bound was applied and the bound is
//                  named. This is the state a caller can least afford to be
//                  surprised by: their 0% win rate came back as 1%.
//
// A CLAMPED INPUT CAN ALSO HAVE BEEN SUBSTITUTED — a ledger win rate of 0.4% is
// substituted from the ledger AND clamped up to the 1% floor. Both facts are
// carried, because reporting only one of them is a lie in the opposite
// direction. `state` names the one that changed the number; `supplied` and
// `substitute` carry the other.
//
// ONE SUBSTITUTION POINT, PROVEN HERE. `riskOfRuin` used to be one of two: the
// route substituted first and the function substituted again, at a different
// layer, with a different reason, and neither recorded it. The route now hands
// the function the caller's raw values plus the ledger-derived fallbacks LABELLED
// by their source, and the function is the only place a value can be replaced.
// `single substitution point` asserts that structurally rather than by trust.

import { beforeEach, describe, expect, it } from "vitest"

const INPUT_FIELDS = ["winRate", "avgPayout", "riskPct", "balance"]

/** The four inputs' provenance, in the order the UI renders them. */
function provenanceOf(result) {
  return Object.fromEntries(INPUT_FIELDS.map((f) => [f, result.provenance[f]]))
}

/** Every field that was NOT purely the caller's own in-range value. */
function notSupplied(result) {
  return INPUT_FIELDS.filter((f) => result.provenance[f].supplied !== true)
}

async function load() {
  return (await import("../services/trading.mjs")).riskOfRuin
}

describe("UI-4: an input the caller did not supply is marked substituted, with the substitute named", () => {
  let riskOfRuin
  beforeEach(async () => {
    riskOfRuin = await load()
  })

  it("a call with NO arguments marks all four inputs substituted and names each substitute", async () => {
    // THE DEFECT, REPRODUCED AGAINST THE FIX. Before this change this call
    // returned a confident, fully formatted readout and `provenance` did not
    // exist at all; the four numbers below were the server's own invention with
    // nothing in the response to say so.
    const r = riskOfRuin()

    expect(notSupplied(r), "an empty call assumed every input").toEqual(INPUT_FIELDS)
    expect(r.provenance.assumedInputs).toEqual(INPUT_FIELDS)
    expect(r.provenance.clampedInputs).toEqual([])

    // THE SUBSTITUTE IS NAMED, NOT JUST FLAGGED, or the UI can only say
    // "assumed" and not "assumed 2% risk".
    expect(r.provenance.riskPct.substitute).toEqual({
      value: 2,
      source: "server-constant",
      reason: "caller sent no value"
    })
    expect(r.provenance.avgPayout.substitute.value).toBe(0.8)
    expect(r.provenance.winRate.substitute.value).toBe(50)
    expect(r.provenance.balance.substitute.value).toBe(1000)

    for (const field of INPUT_FIELDS) {
      expect(r.provenance[field].state, `${field} state`).toBe("substituted")
      expect(r.provenance[field].substitute, `${field} names its substitute`).not.toBeNull()
      expect(typeof r.provenance[field].substitute.reason).toBe("string")
      expect(r.provenance[field].substitute.reason.length).toBeGreaterThan(0)
    }
  })

  it("`inputs` is the ROUNDED echo of the values provenance says were used", async () => {
    // A record that names a substitute but computes from a different number would
    // be worse than no record: the UI would print a confident provenance sentence
    // beside a wrong number. `inputs` is the ROUNDED block the pre-existing
    // response already carried and is left alone; `provenance.<field>.used` is
    // the exact value the arithmetic ran on. The two differ BY ROUNDING, which is
    // why the check recomputes the rounding rather than comparing them.
    const r = riskOfRuin()
    expect(r.provenance.riskPct.used, "the substitute itself, in the caller's unit").toBe(2)
    expect(r.inputs.riskPct).toBe(Math.round((r.provenance.riskPct.used / 100) * 10000) / 100)
    expect(r.inputs.winRate).toBe(Math.round(r.provenance.winRate.used))
    expect(r.inputs.avgPayout).toBe(r.provenance.avgPayout.used)
    expect(r.inputs.balance).toBe(r.provenance.balance.used)
  })

  it("a value the caller POSTED is marked supplied, and NO input is called assumed", async () => {
    // THE SECOND DIRECTION, and the one that catches a client labelling
    // "assumed" over a number the user actually typed — which is its own
    // dishonesty, in the opposite direction from the defect being fixed.
    const r = riskOfRuin({ winRate: 55, avgPayout: 1, riskPct: 5, balance: 1000 })

    expect(r.provenance.assumedInputs, "nothing was assumed — everything was typed").toEqual([])
    expect(notSupplied(r)).toEqual([])
    expect(r.provenance.clampedInputs, "all four are in range, so none was clamped").toEqual([])
    for (const field of INPUT_FIELDS) {
      expect(r.provenance[field].state, `${field} state`).toBe("supplied")
      expect(r.provenance[field].supplied).toBe(true)
      expect(r.provenance[field].substitute, `${field} names no substitute`).toBeNull()
      expect(r.provenance[field].clamp, `${field} names no clamp`).toBeNull()
    }
  })

  it("an explicit null is NOT read as a zero — it is a substitution with its own reason", async () => {
    // THE MIRROR OF THE `||` DEFECT, AND IT IS STILL LIVE AFTER `||` IS FIXED.
    // The old route wrote `Number(body?.winRate)`, and `Number(null)` is `0`, so
    // a caller posting `{"winRate": null}` had its explicit null silently read as
    // a measured 0% win rate — a value that then got clamped to 1% and reported
    // as supplied. `null` is the absence of a number, not the number zero.
    const r = riskOfRuin({ winRate: null, avgPayout: 1, riskPct: 5, balance: 1000 })

    expect(r.provenance.winRate.supplied).toBe(false)
    expect(r.provenance.winRate.state).toBe("substituted")
    expect(r.provenance.winRate.substitute.reason).toMatch(/null/)
    expect(r.provenance.assumedInputs).toEqual(["winRate"])
    // And the three the caller really did send are untouched.
    expect(r.provenance.avgPayout.state).toBe("supplied")
  })

  it("an unparseable value is a substitution naming what arrived, not a silent zero", async () => {
    const r = riskOfRuin({ riskPct: "two percent", balance: 1000 })
    expect(r.provenance.riskPct.supplied).toBe(false)
    expect(r.provenance.riskPct.substitute.value).toBe(2)
    expect(r.provenance.riskPct.substitute.reason).toMatch(/two percent/)
    expect(r.provenance.riskPct.state).toBe("substituted")
  })

  it("an empty string is not a zero — it is the absence of a number", async () => {
    // `Number("")` is 0, so the old route read a blank form field as a measured
    // zero risk. The number a caller MEANT to send is not in a blank box.
    const r = riskOfRuin({ riskPct: "", balance: 1000 })
    expect(r.provenance.riskPct.supplied).toBe(false)
    expect(r.provenance.riskPct.substitute.reason).toMatch(/empty/)
  })

  it("a numeric STRING is still honoured — the route has always accepted one", async () => {
    // NOT A NEW RULE, A PRESERVED ONE. The old route ran everything through
    // `Number(...)`, so `{"riskPct": "5"}` was accepted. Narrowing that would
    // silently break a caller for a reason unrelated to this defect.
    const r = riskOfRuin({ riskPct: "5", balance: 1000 })
    expect(r.provenance.riskPct.supplied).toBe(true)
    expect(r.provenance.riskPct.state).toBe("supplied")
    expect(r.inputs.riskPct).toBe(5)
  })
})

describe("UI-4: the ledger is a NAMED source, not an invisible fallback", () => {
  let riskOfRuin
  beforeEach(async () => {
    riskOfRuin = await load()
  })

  it("a ledger-sourced default is labelled with the ledger, and its own value is recorded", async () => {
    const r = riskOfRuin({
      defaults: { winRate: { value: 47.5, source: "signal-accuracy-ledger" } }
    })
    expect(r.provenance.winRate.supplied).toBe(false)
    expect(r.provenance.winRate.substitute.source).toBe("signal-accuracy-ledger")
    expect(r.provenance.winRate.substitute.value).toBe(47.5)
    // `used` is exact; `inputs` is the pre-existing ROUNDED echo, so it reads 48
    // for a ledger 47.5. That is rounding, not a disagreement, and it is why the
    // UI reads provenance rather than `inputs` when it says "assumed 47.5%".
    expect(r.provenance.winRate.used).toBe(47.5)
    expect(r.inputs.winRate).toBe(48)
    // The other three had no ledger to read, so they are server constants — a
    // DIFFERENT fact, and the response must not conflate the two.
    expect(r.provenance.balance.substitute.source).toBe("server-constant")
  })

  it("a ledger value that is then clamped carries BOTH facts, not one", async () => {
    // The two substitutions compose, and reporting either alone misleads: saying
    // only "clamped" hides that the operator's own ledger supplied the 0.4%, and
    // saying only "assumed" hides that the number the readout used is not the
    // number that was assumed.
    const r = riskOfRuin({
      defaults: { winRate: { value: 0.4, source: "signal-accuracy-ledger" } }
    })
    const wr = r.provenance.winRate
    expect(wr.state, "the clamp is what changed the number, so it is the headline state").toBe("clamped")
    expect(wr.supplied).toBe(false)
    expect(wr.substitute).toEqual({
      value: 0.4,
      source: "signal-accuracy-ledger",
      reason: "caller sent no value"
    })
    expect(wr.clamp).toMatchObject({ from: 0.4, to: 1 })
    expect(r.provenance.assumedInputs).toContain("winRate")
    expect(r.provenance.clampedInputs).toContain("winRate")
  })

  it("a supplied in-range value BEATS a ledger default — the caller always wins", async () => {
    const r = riskOfRuin({
      winRate: 61,
      defaults: { winRate: { value: 47.5, source: "signal-accuracy-ledger" } }
    })
    expect(r.inputs.winRate).toBe(61)
    expect(r.provenance.winRate.state).toBe("supplied")
    expect(r.provenance.winRate.substitute).toBeNull()
  })

  it("a ledger default of null is ignored rather than read as a zero", async () => {
    // `acc.winRate` can be null on a fresh instance, and `null ?? 50` in the old
    // route handled that — but only because the route wrote it explicitly. A
    // default map that accepted null would put the `Number(null) === 0` defect
    // back one layer down.
    const r = riskOfRuin({ defaults: { winRate: { value: null, source: "signal-accuracy-ledger" } } })
    expect(r.provenance.winRate.supplied).toBe(false)
    expect(r.provenance.winRate.substitute.source).toBe("server-constant")
    expect(r.inputs.winRate).toBe(50)
  })

  it("an UNLABELLED default is refused, and the labelled constant is used instead", async () => {
    // The record's completeness rests on every substitute naming its origin, so
    // an offer this function cannot attribute must not reach `provenance` as a
    // substitute with `source: undefined`. It is refused rather than passed
    // through, because the alternative is the same defect this task exists to
    // close, one level down: a number that arrived from nowhere and is reported
    // as though it did not.
    const unlabelled = riskOfRuin({ defaults: { winRate: { value: 47.5 } } })
    expect(unlabelled.provenance.winRate.substitute.source).toBe("server-constant")
    expect(unlabelled.provenance.winRate.substitute.value).toBe(50)
    expect(unlabelled.inputs.winRate).toBe(50)

    const emptySource = riskOfRuin({ defaults: { winRate: { value: 47.5, source: "" } } })
    expect(emptySource.provenance.winRate.substitute.source).toBe("server-constant")

    const nonStringSource = riskOfRuin({ defaults: { winRate: { value: 47.5, source: 7 } } })
    expect(nonStringSource.provenance.winRate.substitute.source).toBe("server-constant")
  })

  it("a well-formed labelled default IS honoured, so the guard above is not just a refusal", async () => {
    // The mirror of the test above, because a rule that refuses everything would
    // satisfy the one before it.
    const ok = riskOfRuin({ defaults: { winRate: { value: 47.5, source: "signal-accuracy-ledger" } } })
    expect(ok.provenance.winRate.substitute.source).toBe("signal-accuracy-ledger")
    expect(ok.provenance.winRate.used).toBe(47.5)
  })
})

describe("UI-4: `0` is not absent — it is either honoured or reported as out of range", () => {
  let riskOfRuin
  beforeEach(async () => {
    riskOfRuin = await load()
  })

  /**
   * THE FOUR RULINGS, ONE TEST EACH. Before this change every one of these four
   * calls produced the SAME response as an empty call, because `||` cannot tell
   * a zero from a missing value. A caller asking "what if I risk nothing?" got
   * the answer to "what if you assume 2%?" and no field said otherwise.
   */
  it("winRate 0 is SUPPLIED, then clamped up to the 1% floor the calculator enforces", async () => {
    const r = riskOfRuin({ winRate: 0, avgPayout: 1, riskPct: 5, balance: 1000 })
    const wr = r.provenance.winRate
    // Supplied, NOT assumed: the caller sent it.
    expect(wr.supplied, "a zero the caller typed is not an assumption").toBe(true)
    expect(wr.substitute).toBeNull()
    // But out of range, and the range is named.
    expect(wr.state).toBe("clamped")
    expect(wr.clamp).toMatchObject({ from: 0, to: 1 })
    expect(wr.clamp.bound).toMatch(/win rate/i)
    expect(r.inputs.winRate).toBe(1)
  })

  it("riskPct 0 is SUPPLIED, then clamped to the floor — and says units-to-ruin is unbounded", async () => {
    // THE CASE THE BRIEF NAMES BY NAME. A risk fraction of zero has no finite
    // number of units to ruin: 1/0 is unbounded. The old `|| 2` quietly answered
    // a different question, and `Math.max(0.001, ...)` would have quietly
    // answered a third. So the response computes at the documented 0.1% floor
    // AND states in words that the honest answer is unbounded.
    const r = riskOfRuin({ winRate: 55, avgPayout: 1, riskPct: 0, balance: 1000 })
    const rp = r.provenance.riskPct
    expect(rp.supplied).toBe(true)
    expect(rp.state).toBe("clamped")
    expect(rp.clamp).toMatchObject({ from: 0, to: 0.1 })
    expect(
      rp.clamp.note,
      "the clamp must say WHY zero risk has no finite units-to-ruin, not just that a bound applied"
    ).toMatch(/unbounded|no finite/i)
    expect(r.provenance.assumedInputs, "a typed zero is not an assumption").not.toContain("riskPct")
  })

  it("avgPayout 0 is HONOURED as a real value — a trade that pays nothing still pays nothing", async () => {
    // The one zero here that is BOTH meaningful and computable, and the reason
    // the payout floor moved from 0.01 to 0. A 0.01x floor cannot express "this
    // trade returns nothing", and inventing 0.01 is the same defect as inventing
    // 0.8. Nothing downstream divides by it unguarded: `kellyFraction` already
    // carries an `ap > 0` guard, and `log(1 + 0)` is 0, not NaN.
    const r = riskOfRuin({ winRate: 55, avgPayout: 0, riskPct: 5, balance: 1000 })
    const ap = r.provenance.avgPayout
    expect(ap.supplied).toBe(true)
    expect(ap.state, "zero payout is in range and is used as given").toBe("supplied")
    expect(ap.clamp).toBeNull()
    expect(r.inputs.avgPayout).toBe(0)
    // And the arithmetic stays finite on the edge — a 0% return per win still
    // loses money overall, so ruin is certain, not undefined.
    expect(Number.isFinite(r.riskOfRuin)).toBe(true)
    expect(r.riskOfRuin).toBe(1)
    // `expectedGrowthPct` is a PRE-FORMATTED STRING ("-2.31%"), which is why the
    // edge case is a NaN — not a non-finite number — if anything below divides by
    // the payout unguarded.
    expect(r.expectedGrowthPct).not.toMatch(/NaN|Infinity/)
    expect(r.kellyFraction).toBe("0%")
  })

  it("balance 0 is SUPPLIED, then clamped up to the $1 floor", async () => {
    const r = riskOfRuin({ winRate: 55, avgPayout: 1, riskPct: 5, balance: 0 })
    const bal = r.provenance.balance
    expect(bal.supplied).toBe(true)
    expect(bal.state).toBe("clamped")
    expect(bal.clamp).toMatchObject({ from: 0, to: 1 })
    expect(r.inputs.balance).toBe(1)
  })

  it("a NEGATIVE payout is clamped to 0 and says so — it is not a market fact", async () => {
    const r = riskOfRuin({ winRate: 55, avgPayout: -0.5, riskPct: 5, balance: 1000 })
    const ap = r.provenance.avgPayout
    expect(ap.supplied).toBe(true)
    expect(ap.state).toBe("clamped")
    expect(ap.clamp).toMatchObject({ from: -0.5, to: 0 })
    expect(ap.clamp.bound).toMatch(/negative/i)
  })

  it("out-of-range values in BOTH directions are clamped, never substituted", async () => {
    // Every field sent, so `assumedInputs` is empty by CONSTRUCTION here and the
    // assertion is about clamping alone. Sending three of four would leave the
    // fourth legitimately assumed and the two would be indistinguishable.
    const high = riskOfRuin({ winRate: 140, avgPayout: 1, riskPct: 250, balance: 1000 })
    expect(high.provenance.winRate.state).toBe("clamped")
    expect(high.inputs.winRate).toBe(99)
    expect(high.provenance.riskPct.clamp).toMatchObject({ from: 250, to: 100 })
    expect(high.provenance.assumedInputs, "clamping is not assuming").toEqual([])
    expect(high.provenance.clampedInputs.sort()).toEqual(["riskPct", "winRate"])
  })
})

describe("UI-4: one substitution point, and the pre-existing response is untouched", () => {
  let riskOfRuin
  beforeEach(async () => {
    riskOfRuin = await load()
  })

  it("every field a caller did not send is reported, and ONLY those", async () => {
    // A partial post: the set in `assumedInputs` is exactly the complement of the
    // set that arrived. Anything else is a record that cannot be trusted.
    const r = riskOfRuin({ winRate: 55, riskPct: 5 })
    expect(r.provenance.assumedInputs.sort()).toEqual(["avgPayout", "balance"])
    expect(Object.keys(provenanceOf(r)).sort()).toEqual([...INPUT_FIELDS].sort())
  })

  it("EVERY pre-existing response field is still present, with the same shape", async () => {
    // ADDITIVE ONLY. `auditRegressions.test.mjs:48-59` asserts the formula, and
    // this asserts that nothing that was already shipped was renamed or dropped
    // on the way to adding `provenance`.
    const r = riskOfRuin({ winRate: 55, avgPayout: 1, riskPct: 5, balance: 1000 })
    expect(Object.keys(r.inputs).sort()).toEqual(["avgPayout", "balance", "riskPct", "winRate"])
    for (const key of [
      "ok",
      "riskOfRuin",
      "riskOfRuinPct",
      "edge",
      "unitsToRuin",
      "expectedGrowthPct",
      "kellyFraction",
      "halfKellyPct"
    ]) {
      expect(r, `${key} must survive`).toHaveProperty(key)
    }
    expect(r.ok).toBe(true)
    expect(r.unitsToRuin).toBe(20)
  })

  it("the formula itself is unchanged for a fully-supplied in-range call", async () => {
    // The `auditRegressions` claim, restated here so a future edit to the
    // provenance machinery cannot quietly move the number while this file stays
    // green about the RECORD.
    const r = riskOfRuin({ winRate: 55, avgPayout: 1, riskPct: 5, balance: 1000 })
    const edge = 0.55 * 1 - 0.45
    expect(r.edge).toBe(Math.round(edge * 10000) / 100 + "%")
    expect(r.riskOfRuin).toBeCloseTo(Math.round(Math.pow((1 - edge) / (1 + edge), 20) * 10000) / 10000, 6)
  })

  it("the route is the ONLY caller that passes defaults, and it passes them LABELLED", async () => {
    // `single substitution point`, as a source check rather than a comment. The
    // two-layer shape was: the route picked a number, then the function picked
    // another. Now the route may only pass a `defaults` map whose every entry
    // names its `source`, so the layer that substitutes is always able to say
    // where the substitute came from.
    //
    // SCANNED ON THE COMMENT-STRIPPED VIEW, and deliberately. This check reasons
    // about CODE, and the route's own reasoning comment names the shapes it
    // removed — so reading raw source made a prose mention look like a live
    // substitution point. `stripComments` is the repo's shared lexer for exactly
    // this (`server/scripts/guard-primitives.mjs`, the same binding
    // ws7AuthBootstrapGateGuard uses), and measuring code rather than prose is
    // also what makes it impossible for a comment to SATISFY the check.
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const { stripComments } = await import("../scripts/guard-primitives.mjs")
    const src = stripComments(
      readFileSync(fileURLToPath(new URL("../handlers.mjs", import.meta.url)), "utf8")
    )
    const block = src.slice(src.indexOf('path === "/api/trading/risk-of-ruin"'))
    const route = block.slice(0, block.indexOf("\n  }\n"))

    expect(route, "the route block must be found").not.toBe("")
    // No arithmetic fallback survives in the route: `?? 50`, `?? 1000` and the
    // `Number(body?.x)` read are all second substitution points, and the third
    // is the `Number(null) === 0` trap that turns an explicit null into a
    // measured zero. The only `Number.isFinite` left is on the LEDGER value,
    // which decides whether the ledger had a usable answer to offer.
    expect(route).not.toMatch(/\?\?\s*50\b/)
    expect(route).not.toMatch(/\?\?\s*1000\b/)
    expect(route).not.toMatch(/Number\(\s*body/)
    expect(route).not.toMatch(/Number\(\s*sent\./)
    expect(route.match(/Number\.isFinite\(/g)?.length ?? 0).toBeGreaterThan(0)
    // Every defaults entry the route builds names where its value came from.
    const sources = [...route.matchAll(/source:\s*"([^"]+)"/g)].map((m) => m[1])
    expect(sources.length, "the route names at least the ledger source").toBeGreaterThan(0)
    for (const s of sources) expect(s, `source "${s}" must name a real origin`).toMatch(/ledger|constant/)
    // And it still hands the function the caller's OWN values untouched, which is
    // what makes the function the only thing that can replace one.
    for (const field of INPUT_FIELDS) {
      expect(route, `${field} must be forwarded by name`).toMatch(new RegExp(`${field}:\\s*sent\\.${field}`))
    }
  })
})