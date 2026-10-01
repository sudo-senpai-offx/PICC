// WS-7 T13 — the D16 cloud-routing predicate. AC-040. PURE.
//
// D16:229-236 — "Only (a) A+ setups and (b) veto-boundary decisions route to a
// cloud provider (Groq/OpenRouter). Every other Copilot operation is local. A
// cloud response is never a deterministic input — it is an explanation, with
// provenance marking, and it can never change a score, a veto, or an
// execution. [...] Cloud calls are enumerated, budgeted, redacted, and marked
// `provenance: "copilot: remote"`. The routing predicate is a pure function with
// tests. AC-040."
//
// AC-040:1085-1091:
//   Scenario:  A non-A+, non-veto-boundary operation runs.
//   Action:    Evaluate the routing predicate.
//   Expected:  It runs locally and no cloud call is made; A+ setups and
//              veto-boundary decisions do route to cloud, with
//              `provenance: "copilot: remote"`.
//   Prohibited: A cloud response may never be a score, veto, or execution input,
//              and ROUTING MAY NOT FAIL OPEN TO CLOUD.
//   Verification: A pure-function test over the routing matrix; a provenance
//              assertion on every cloud-derived value.
//
// "FAIL CLOSED" IS THE WHOLE GAME HERE. A predicate whose unknown case defaults
// to `cloud` turns every future caller who passes a slightly-wrong descriptor
// into a remote decision system — which is the exact failure D16:234 names
// ("'Send it to the cloud' without a boundary turns a local decision system into
// a remote one whose behavior changes when a provider changes"). So EVERY input
// that is not positively recognised as (A+ setup | veto-boundary) routes local,
// including malformed input, an unknown operation, a missing tier, and `null`.
// The matrix test below evaluates every cell and computes the expected verdict
// from the rule independently of the implementation, so a change that widens the
// cloud set has to change this file to stay green.
//
// THE PROVENANCE LITERAL IS NOT FREE. `contracts.ts:99` types
// `CopilotProvenance` as the single-member union `"copilot: remote"`, and
// `ws6TerminalSeamGuard.test.mjs` regex-pins that literal into the file. A
// LOCAL explanation must therefore NOT carry it — otherwise a local rendering
// would be indistinguishable from a remote one, which is the confusion
// AC-014 calls a prohibited side effect. `REMOTE_PROVENANCE` is asserted equal
// to the literal here so the two cannot drift.

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

import {
  CLOUD_OPERATIONS,
  LOCAL_PROVENANCE,
  OPERATIONS,
  REMOTE_PROVENANCE,
  ROUTING_CODES,
  assertNotDeterministicInput,
  isCloudRoutable,
  routeFor
} from "../routing.mjs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRACTS = join(HERE, "..", "..", "..", "..", "src", "terminal", "contracts.ts")
const TIER_VOCABULARY = ["A+", "B", "ignore", null, "a-plus", "A"]

describe("D16 — the two operations that route to cloud, and no others", () => {
  it("routes an A+ SETUP to cloud", () => {
    const r = routeFor({ operation: "setup", tier: "A+" })
    expect(r.route).toBe("cloud")
    expect(r.provenance).toBe(REMOTE_PROVENANCE)
  })

  it("routes a VETO-BOUNDARY decision to cloud regardless of tier", () => {
    // D16 names the two cases with "and", not "or A+ and veto-boundary". A
    // veto-boundary decision is a decision ABOUT the boundary, so it exists
    // precisely when the score did not clear A+.
    for (const tier of ["A+", "B", "ignore", null]) {
      const r = routeFor({ operation: "veto-boundary", tier })
      expect(r.route, `tier ${String(tier)}`).toBe("cloud")
      expect(r.provenance).toBe(REMOTE_PROVENANCE)
    }
  })

  it("routes a B or ignore SETUP to local", () => {
    for (const tier of ["B", "ignore"]) {
      const r = routeFor({ operation: "setup", tier })
      expect(r.route, `tier ${tier}`).toBe("local")
      expect(r.provenance).toBe(LOCAL_PROVENANCE)
    }
  })

  it("routes every other operation to local", () => {
    for (const operation of OPERATIONS.filter((o) => !CLOUD_OPERATIONS.includes(o))) {
      const r = routeFor({ operation, tier: "A+" })
      expect(r.route, `${operation} must be local`).toBe("local")
    }
  })
})

describe("AC-040 — the matrix, evaluated exhaustively and independently", () => {
  it("computes the expected verdict from the RULE, not from the implementation", () => {
    // The rule restated here rather than imported: an implementation that
    // widened the cloud set would agree with itself if the expectation came
    // from the same function.
    const expected = (operation, tier) =>
      operation === "veto-boundary" || (operation === "setup" && tier === "A+") ? "cloud" : "local"

    let cells = 0
    for (const operation of OPERATIONS) {
      for (const tier of TIER_VOCABULARY) {
        cells += 1
        expect(routeFor({ operation, tier }).route, `${operation} / ${String(tier)}`).toBe(expected(operation, tier))
      }
    }
    expect(cells).toBe(OPERATIONS.length * TIER_VOCABULARY.length)
  })

  it("routes cloud in exactly two shapes, and widening either one breaks this", () => {
    // The cloud set is pinned as (operation, tier-condition) rather than as a
    // count, because a count is satisfied by the wrong two operations.
    const cloudCells = TIER_VOCABULARY.flatMap((tier) =>
      OPERATIONS.filter((operation) => routeFor({ operation, tier }).route === "cloud").map((operation) => `${operation}@${String(tier)}`)
    )
    expect(cloudCells).toEqual([
      "setup@A+",
      "veto-boundary@A+",
      "veto-boundary@B",
      "veto-boundary@ignore",
      "veto-boundary@null",
      "veto-boundary@a-plus",
      "veto-boundary@A"
    ])
  })
})

describe("AC-040 — routing FAILS CLOSED, never open", () => {
  const malformed = [
    ["null", null],
    ["undefined", undefined],
    ["a string", "setup"],
    ["a number", 3],
    ["an empty object", {}],
    ["an unknown operation", { operation: "autoExecute", tier: "A+" }],
    ["an operation with different case", { operation: "SETUP", tier: "A+" }],
    ["a tier with whitespace", { operation: "setup", tier: " A+ " }],
    ["a non-string tier", { operation: "setup", tier: 85 }],
    ["a boolean tier", { operation: "setup", tier: true }],
    ["a null operation with an A+ tier", { operation: null, tier: "A+" }],
    ["an array", ["setup", "A+"]]
  ]

  for (const [label, input] of malformed) {
    it(`routes ${label} to LOCAL`, () => {
      const r = routeFor(input)
      expect(r.route).toBe("local")
      expect(r.provenance).toBe(LOCAL_PROVENANCE)
    })
  }

  it("refuses an unrecognised operation by NAME rather than defaulting it", () => {
    // The reason must be actionable: "unknown operation" tells the caller what
    // to fix, where a bare "local" tells them nothing.
    const r = routeFor({ operation: "autoExecute", tier: "A+" })
    expect(r.reason).toMatch(/autoExecute/)
    expect(r.reason).toMatch(/local/i)
  })

  it("marks every refused input as unrecognised rather than as a legitimate local run", () => {
    // Otherwise a typo'd operation is indistinguishable, in an audit, from a
    // deliberate local decision.
    expect(routeFor({ operation: "nope" }).recognised).toBe(false)
    expect(routeFor({ operation: "setup", tier: "B" }).recognised).toBe(true)
  })

  it("never returns an unknown route value", () => {
    for (const input of [null, {}, { operation: "x" }, { operation: "setup", tier: "A+" }]) {
      expect(["local", "cloud"]).toContain(routeFor(input).route)
    }
  })
})

describe("D16 — a cloud response is never a deterministic input", () => {
  it("marks a cloud decision non-deterministic", () => {
    expect(routeFor({ operation: "setup", tier: "A+" }).deterministic).toBe(false)
    expect(routeFor({ operation: "setup", tier: "B" }).deterministic).toBe(true)
  })

  it("carries the three things D16 says a cloud result may never be", () => {
    // Named explicitly on the verdict so a caller that destructures the route
    // has to acknowledge them, rather than discovering them by convention.
    const r = routeFor({ operation: "setup", tier: "A+" })
    expect(r.neverDeterministicInputFor).toEqual(["score", "veto", "execution"])
  })

  it("THROWS when a cloud-derived value is offered as a score, veto or execution input", () => {
    const cloud = { ...routeFor({ operation: "setup", tier: "A+" }), text: "A+ on the daily 400 EMA" }
    for (const slot of ["score", "veto", "execution"]) {
      expect(() => assertNotDeterministicInput(cloud, slot), slot).toThrowError(
        expect.objectContaining({ code: ROUTING_CODES.remoteNotDeterministic })
      )
    }
  })

  it("allows a LOCAL value into the same slots", () => {
    const local = { ...routeFor({ operation: "setup", tier: "B" }), score: 72 }
    for (const slot of ["score", "veto", "execution"]) {
      expect(() => assertNotDeterministicInput(local, slot), slot).not.toThrow()
    }
  })

  it("refuses an unknown slot by name", () => {
    const local = { ...routeFor({ operation: "setup", tier: "B" }) }
    expect(() => assertNotDeterministicInput(local, "regime")).toThrowError(
      expect.objectContaining({ code: ROUTING_CODES.unknownSlot })
    )
  })

  it("is decidable from the provenance ALONE, so a stripped value is still caught", () => {
    // A caller who rebuilds the object and forgets `route` must not get past.
    const stripped = { provenance: REMOTE_PROVENANCE }
    expect(() => assertNotDeterministicInput(stripped, "score")).toThrow()
  })

  it("exposes a boolean form for a call site that only needs the answer", () => {
    expect(isCloudRoutable({ operation: "setup", tier: "A+" })).toBe(true)
    expect(isCloudRoutable({ operation: "setup", tier: "B" })).toBe(false)
    expect(isCloudRoutable(null)).toBe(false)
  })
})

describe("the provenance literals are the ones the rest of the repo pins", () => {
  it("uses the exact string contracts.ts:99 declares", () => {
    expect(REMOTE_PROVENANCE).toBe("copilot: remote")
  })

  it("is still literally present in contracts.ts, so the WS-6 seam guard keeps matching", () => {
    const source = readFileSync(CONTRACTS, "utf8")
    expect(source).toMatch(/"copilot: remote"/)
  })

  it("uses a DISTINCT literal for local, so local and remote cannot be confused", () => {
    expect(LOCAL_PROVENANCE).toBe("copilot: local")
    expect(LOCAL_PROVENANCE).not.toBe(REMOTE_PROVENANCE)
  })

  it("never returns the remote literal for a local route", () => {
    for (const operation of OPERATIONS) {
      for (const tier of ["A+", "B", "ignore", null]) {
        const r = routeFor({ operation, tier })
        if (r.route === "local") expect(r.provenance).not.toBe(REMOTE_PROVENANCE)
      }
    }
  })
})

describe("D16:234 — the predicate is pure, asserted against its own source", () => {
  it("contains no clock, no randomness, no I/O and no network", () => {
    const source = readFileSync(join(HERE, "..", "routing.mjs"), "utf8")
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
      expect(source.includes(forbidden), `routing.mjs must not contain "${forbidden}"`).toBe(false)
    }
  })

  it("imports nothing at all", () => {
    const source = readFileSync(join(HERE, "..", "routing.mjs"), "utf8")
    const imports = [...source.matchAll(/^\s*import\s[^\n]*from\s/gm)]
    expect(imports).toHaveLength(0)
  })

  it("returns the same verdict for the same input, 100 times", () => {
    const input = { operation: "setup", tier: "A+" }
    const first = JSON.stringify(routeFor(input))
    for (let i = 0; i < 100; i += 1) {
      expect(JSON.stringify(routeFor(input))).toBe(first)
    }
  })

  it("does not mutate the descriptor it is given", () => {
    const input = { operation: "setup", tier: "A+" }
    const before = JSON.stringify(input)
    routeFor(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
