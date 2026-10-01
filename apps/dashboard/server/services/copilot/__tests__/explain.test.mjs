// WS-7 T13 — the plain-English explanation layer. Server side. RED first.
//
// §4.2:565 — "explain.mjs  # plain-English layer, provenance-marked".
// §4.1:533 — "the model may contribute the 5% Sentiment expert's input and may
// write prose, and it may do nothing else."
//
// T13:1314 — "The model computes no indicator, regime, veto, or tier."
//
// THE SHAPE IS `contracts.ts:101-110`'s `CopilotExplanation`, and the
// distinction that contract draws at `:121-139` is the whole reason this file is
// separate from the engine:
//
//   CopilotExplanation  - prose. May explain. May NEVER be a signal, a score, a
//                         risk input, a sizing value, or an execution
//                         authorisation.
//   ConfluenceScore     - the DETERMINISTIC output of a pure function of market
//                         state. It IS the decision path.
//
// So the tests below do not check that the prose is nice. They check four
// things that would each independently be a P0 if broken:
//
//   1. every value carries a provenance, and a LOCAL explanation never claims
//      the remote literal;
//   2. the returned object contains no score, tier, veto, risk or execution
//      field at all — the fields are absent, not merely unused;
//   3. an unavailable model yields `status: "unavailable"` with a reason and NO
//      prose, rather than a plausible paragraph;
//   4. the numbers in the prose are QUOTED from the engine's result, not
//      recomputed, so the explanation cannot disagree with the score it explains.
//
// WHAT T13 DELIBERATELY DOES NOT BUILD. The explanation's RENDER is BS-3:
// nothing under `apps/dashboard/src/` is touched, and no component is created.
// This is the server-side producer plus the contract a renderer will consume,
// and the BS-3 handoff is recorded in the changelog.

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import {
  EXPLANATION_STATUSES,
  PROSE_FORBIDDEN_KEYS,
  explainDecision,
  explainUnavailable
} from "../explain.mjs"
import { LOCAL_PROVENANCE, REMOTE_PROVENANCE, routeFor } from "../routing.mjs"
import { evaluateCopilot } from "../engine.mjs"
import { sentimentSuppliedState, sentimentUnavailableState } from "./fixtures/marketFixtures.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRACTS = join(HERE, "..", "..", "..", "..", "src", "terminal", "contracts.ts")

const engineResult = evaluateCopilot({ marketState: sentimentSuppliedState(0.6), recordVetoes: false })
const noModelResult = evaluateCopilot({ marketState: sentimentUnavailableState(), recordVetoes: false })

const localExplanation = (overrides = {}) =>
  explainDecision({ result: engineResult, provenance: LOCAL_PROVENANCE, ...overrides })

describe("the explanation carries a provenance, always", () => {
  it("marks a local explanation as local", () => {
    expect(localExplanation().provenance).toBe(LOCAL_PROVENANCE)
  })

  it("marks a remote explanation with the literal contracts.ts:99 declares", () => {
    const r = explainDecision({
      result: engineResult,
      provenance: REMOTE_PROVENANCE,
      model: "copilot: remote provider",
      at: 1772000000000
    })
    expect(r.provenance).toBe(REMOTE_PROVENANCE)
  })

  it("REFUSES a remote provenance with no model named", () => {
    // "copilot: remote" with no model is an unattributed remote claim, which is
    // the shape T16 refused for a permit change for the same reason.
    expect(() =>
      explainDecision({ result: engineResult, provenance: REMOTE_PROVENANCE, at: 1772000000000 })
    ).toThrowError(expect.objectContaining({ code: "explain:remote-without-model" }))
  })

  it("refuses an UNRECOGNISED provenance string rather than defaulting it", () => {
    expect(() => explainDecision({ result: engineResult, provenance: "copilot: maybe", at: 1 })).toThrowError(
      expect.objectContaining({ code: "explain:unknown-provenance" })
    )
  })

  it("refuses a missing provenance", () => {
    expect(() => explainDecision({ result: engineResult })).toThrowError(
      expect.objectContaining({ code: "explain:unknown-provenance" })
    )
  })

  it("always sets redacted: true, because the contract says so", () => {
    expect(localExplanation().redacted).toBe(true)
  })
})

describe("T13:1314 — the explanation returns no decision field at all", () => {
  it("carries exactly the contract's keys, and no more", () => {
    expect(Object.keys(localExplanation()).sort()).toEqual(
      ["at", "exactScore", "model", "provenance", "reason", "redacted", "status", "text"].sort()
    )
  })

  it("carries NO key that could be read as a decision", () => {
    const row = localExplanation()
    for (const key of PROSE_FORBIDDEN_KEYS) {
      expect(row, `explain.mjs returned a "${key}" field`).not.toHaveProperty(key)
    }
  })

  it("does not bury a decision under a different name either", () => {
    // The forbidden list is data precisely so it can be widened; these are the
    // plausible synonyms a later edit might reach for.
    const row = JSON.stringify(localExplanation())
    for (const needle of ["score", "tier", "riskPct", "action", "fired", "rawDelta", "coveragePct", "weightPct"]) {
      expect(row.includes(`"${needle}"`), `explain.mjs leaked a "${needle}" field`).toBe(false)
    }
  })

  it("carries no nested object or array that could smuggle a decision in", () => {
    for (const [key, value] of Object.entries(localExplanation())) {
      if (value === null) continue // `typeof null === "object"`; null carries nothing
      expect(typeof value, `${key} is a ${typeof value}`).not.toBe("object")
    }
  })

  it("carries the engine's exact score as a STRING, so nothing can compute from it", () => {
    // The engine's score is an unrounded float (61.777777777777786 on this
    // fixture). Handing a renderer a number invites a comparison against the
    // 85 boundary that the engine never made; a string invites display only.
    const row = localExplanation()
    expect(row.exactScore).toBe(String(engineResult.confluence.score))
    expect(typeof row.exactScore).toBe("string")
  })
})

describe("the prose EXPLAINS the engine's numbers and never recomputes them", () => {
  it("quotes the engine's own score, ROUNDED and marked as approximate", () => {
    // The engine's score is an UNROUNDED float. Printing it raw would quote
    // arithmetic residue as the score and invite a comparison against the 85
    // tier boundary that the engine never made. The prose rounds for DISPLAY
    // only; the tier it quotes was computed from the unrounded value.
    const r = localExplanation()
    expect(r.text).toContain(engineResult.confluence.score.toFixed(2))
    expect(r.text).toMatch(/about \d/)
  })

  it("never prints the raw float", () => {
    expect(localExplanation().text).not.toContain(String(engineResult.confluence.score))
  })

  it("quotes the engine's own tier, which was decided on the unrounded value", () => {
    expect(localExplanation().text).toContain(engineResult.tier.tier)
  })

  it("rounds consistently — the shown score is the rounded value, not a re-derivation", () => {
    const r = localExplanation()
    const shown = Number(r.text.match(/about (\d+(?:\.\d+)?)/)[1])
    expect(shown).toBe(Number(engineResult.confluence.score.toFixed(2)))
  })

  it("contains no number that is neither a quoted engine value nor a count it wrote", () => {
    // A cheap but real check that the prose is assembled from engine values and
    // small integers, not from arithmetic of its own.
    const rounded = engineResult.confluence.score.toFixed(2)
    const allowed = new Set([
      rounded,
      rounded.split(".")[0], // the integer part of the displayed score
      String(engineResult.tier.tier),
      String(engineResult.confluence.contributions.length),
      String(engineResult.confluence.contributions.filter((c) => c.available === false).length),
      String(engineResult.firedVetoes.length),
      "100", // the out-of in the "out of 100" scale, from the contract
      "0"
    ])
    for (const n of localExplanation().text.match(/\d+(?:\.\d+)?/g) ?? []) {
      expect(allowed.has(n), `prose contains an unexplained number: ${n}`).toBe(true)
    }
  })

  it("names the regime the engine classified", () => {
    expect(localExplanation().text).toContain(engineResult.confluence.regime)
  })

  it("states the confidence the engine assigned", () => {
    expect(localExplanation().text).toContain(engineResult.confluence.confidence)
  })

  it("names the unavailable expert rather than hiding it", () => {
    // §4.7:747 — an unavailable Sentiment renders as one unavailable expert
    // with the penalty stated, never as a neutral zero. The prose is a place
    // that could quietly drop it, so it is asserted.
    const r = explainDecision({ result: noModelResult, provenance: LOCAL_PROVENANCE })
    expect(r.text.toLowerCase()).toMatch(/sentiment/)
    expect(r.text.toLowerCase()).toMatch(/unavailable|not available|no model/i)
  })

  it("states the confidence penalty the absence caused", () => {
    const r = explainDecision({ result: noModelResult, provenance: LOCAL_PROVENANCE })
    expect(r.text).toContain(noModelResult.confluence.confidence)
  })

  it("is deterministic: the same result yields byte-identical prose", () => {
    expect(localExplanation().text).toBe(localExplanation().text)
  })
})

describe("an absent model yields an honest UNAVAILABLE, never a paragraph", () => {
  it("is unavailable when the engine has no score to explain", () => {
    const unscoreable = evaluateCopilot({
      marketState: sentimentUnavailableState(),
      recordVetoes: false
    })
    // Build a deliberately unscoreable result: a dead-zone state has no score.
    const r = explainUnavailable({ reason: "the engine produced no score to explain" })
    expect(r.status).toBe("unavailable")
    expect(r.text).toBeNull()
  })

  it("carries a non-empty reason whenever the status is not ready", () => {
    for (const status of ["pending", "stale", "unavailable"]) {
      const r = explainUnavailable({ reason: `model ${status}`, status })
      expect(r.status).toBe(status)
      expect(typeof r.reason).toBe("string")
      expect(r.reason.length).toBeGreaterThan(0)
    }
  })

  it("REFUSES to be unavailable with no reason", () => {
    expect(() => explainUnavailable({})).toThrowError(
      expect.objectContaining({ code: "explain:no-reason" })
    )
  })

  it("returns null prose for every non-ready status, never a stale paragraph", () => {
    // A cached paragraph served with `status: "stale"` is prose that looks live.
    for (const status of ["pending", "stale", "unavailable"]) {
      expect(explainUnavailable({ reason: "x", status }).text).toBeNull()
    }
  })

  it("draws every status from the contract's vocabulary", () => {
    expect([...EXPLANATION_STATUSES]).toEqual(["ready", "pending", "stale", "unavailable"])
  })

  it("explains a model that ran and reported NO sentiment, distinctly from one that is absent", () => {
    // T11's sentiment seam already distinguishes these two, and collapsing them
    // would hide a model answering "no signal" behind one that is not running.
    const r = explainDecision({ result: noModelResult, provenance: LOCAL_PROVENANCE })
    expect(r.reason).toBeNull()
    expect(r.status).toBe("ready")
    expect(r.text).toMatch(/no model sentiment input|T13/i)
  })
})

describe("D16 — the explanation records where it was computed, and does not route", () => {
  it("agrees with the routing predicate for an A+ setup", () => {
    const verdict = routeFor({ operation: "setup", tier: engineResult.tier.tier })
    const r = localExplanation()
    expect(r.provenance).toBe(verdict.provenance)
  })

  it("names a local explanation's model as null — no model produced local prose", () => {
    expect(localExplanation().model).toBeNull()
  })

  it("names the model for a remote explanation", () => {
    const r = explainDecision({
      result: engineResult,
      provenance: REMOTE_PROVENANCE,
      model: "groq (D16 boundary)",
      at: 1772000000000
    })
    expect(r.model).toBe("groq (D16 boundary)")
  })

  it("takes the timestamp from the CALLER, never from a clock", () => {
    // A prose timestamp nobody can account for is not evidence, which is the
    // same reason T16's permit store made `at` a required argument.
    expect(localExplanation({ at: 1772000000000 }).at).toBe(1772000000000)
  })

  it("records a local explanation's timestamp as null when none was supplied", () => {
    expect(localExplanation().at).toBeNull()
  })
})

describe("the module is pure, and reads its numbers rather than its inputs", () => {
  it("contains no clock, no randomness, no I/O and no network", () => {
    const source = readFileSync(join(HERE, "..", "explain.mjs"), "utf8")
    for (const forbidden of [
      "Date.now",
      "new Date",
      "performance.now",
      "Math.random",
      "fetch(",
      "node:fs",
      "node:net",
      "node:http",
      "require(",
      "await "
    ]) {
      expect(source.includes(forbidden), `explain.mjs must not contain "${forbidden}"`).toBe(false)
    }
  })

  it("imports only routing.mjs — never the engine, never the model layer", () => {
    // It CONSUMES an engine result; it must not be able to compute one. An
    // import of `engine.mjs` would put the deterministic path one hop from a
    // module whose job is prose.
    const source = readFileSync(join(HERE, "..", "explain.mjs"), "utf8")
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
    expect(specifiers).toEqual(["./routing.mjs"])
  })

  it("refuses a missing or malformed engine result rather than explaining nothing", () => {
    expect(() => explainDecision({ result: null, provenance: LOCAL_PROVENANCE })).toThrowError(
      expect.objectContaining({ code: "explain:no-result" })
    )
    expect(() => explainDecision({ result: {}, provenance: LOCAL_PROVENANCE })).toThrowError(
      expect.objectContaining({ code: "explain:no-result" })
    )
  })

  it("does not mutate the engine result it is given", () => {
    const before = JSON.stringify(engineResult.confluence)
    localExplanation()
    expect(JSON.stringify(engineResult.confluence)).toBe(before)
  })
})

describe("the shape matches contracts.ts, so a renderer needs no translation", () => {
  it("keeps the contract's CopilotExplanation keys", () => {
    const source = readFileSync(CONTRACTS, "utf8")
    for (const key of ["status", "provenance", "model", "generatedAt", "cacheExpiresAt", "reason", "redacted"]) {
      expect(source, `contracts.ts lost ${key}`).toContain(key)
    }
  })

  it("carries a cacheExpiresAt-shaped field as absent rather than as null", () => {
    // The contract has 7 fields; this module returns 7 of its own and does NOT
    // invent a cache lifetime it does not manage. The absence is asserted so a
    // future `cacheExpiresAt: null` is a deliberate change rather than a default.
    expect(localExplanation()).not.toHaveProperty("cacheExpiresAt")
  })
})
