// Pre-mortem planner - the verifier (W3-05, Task 3).
//
// HERMETIC BY INJECTION. Every fixture below is an object literal: a mode, an
// inventory, a subsystem list. Nothing here reads the repository tree, so "this
// guard does not exist" is expressible as an empty `guards` array with no
// filesystem in play - which is strictly stronger for the property being proved
// than a temp dir would be.
//
// A DEVIATION FROM THE BRIEF'S SNIPPET, RECORDED RATHER THAN DROPPED. The brief
// (written before commit a606a90) pins `guard-unregistered` into the verdict
// vocabulary. That verdict was WITHDRAWN - the derived inventory has no registry
// for it to check, and reinstating one would recreate the exact defect this
// feature exists to catch - and `partially-covered` was added in its place. The
// design spec's verdict table and this file's controller both carry the
// post-withdrawal set. This test pins the spec's seven, and the brief's
// one-line array is the thing that is stale.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { stripComments } from "../scripts/guard-primitives.mjs"
import { FAILURE_MODES } from "../services/premortem/catalog.mjs"
import { VERDICTS, auditCatalog, verifyAll, verifyMode } from "../services/premortem/verify.mjs"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const VERIFY_SOURCE = readFileSync(
  join(REPO_ROOT, "apps/dashboard/server/services/premortem/verify.mjs"),
  "utf8"
)
// Comments are blanked before EVERY scan of the module's source. This file names
// every one of the things it is forbidden to use — `process.env`, the clock, the
// filesystem — in its own prose, and a raw-text scan would fail on the guard
// that documents the guard. The shared lexer is used rather than a second one
// for exactly the reason catalog entry SHIP-1 exists.
const VERIFY_CODE = stripComments(VERIFY_SOURCE)

/** A shipping mode with a whole-file claim, overriding only what a test names. */
const shipping = (over = {}) => ({
  id: "SHIP-X",
  kind: "shipping",
  severity: "high",
  subsystem: "apps/dashboard/server",
  summary: "s",
  claim: "apps/dashboard/server/__tests__/g.test.mjs",
  gap: null,
  acceptedUnclaimed: null,
  mutation: false,
  rationale: "r",
  ...over
})

/** An inventory holding exactly one guard, built from an injected fixture. */
const withGuard = (over = {}) => ({
  guards: [
    {
      file: "apps/dashboard/server/__tests__/g.test.mjs",
      describes: [],
      unresolvedTitles: 0,
      asserts: 3,
      ...over
    }
  ],
  unreadable: []
})

describe("verify", () => {
  it("pins every verdict in the vocabulary", () => {
    expect([...VERDICTS].sort()).toEqual([
      "guard-cannot-fail",
      "guard-missing",
      "partially-covered",
      "stale-catalog-entry",
      "unclaimed",
      "unverified-manual",
      "verified"
    ])
  })

  it("a claim naming a file the inventory does not hold is guard-missing", () => {
    const r = verifyMode({ mode: shipping(), inventory: { guards: [], unreadable: [] } })
    expect(r.verdict).toBe("guard-missing")
  })

  it("a capital-risk mode is unverified-manual even when a matching guard is present", () => {
    const mode = shipping({
      id: "CAP-1",
      kind: "capital",
      claim: "apps/dashboard/server/__tests__/g.test.mjs",
      acceptedUnclaimed: { owner: "platform owner", date: "2026-10-11", check: "read the exit path" }
    })
    const r = verifyMode({ mode, inventory: withGuard() })
    expect(r.verdict).toBe("unverified-manual")
    expect(r.manualCheck).toBe("read the exit path")
  })

  it("a mode with no claim and no disposition is stale, never unclaimed", () => {
    const mode = shipping({ claim: null, acceptedUnclaimed: null })
    expect(verifyMode({ mode, inventory: { guards: [], unreadable: [] } }).verdict).toBe("stale-catalog-entry")
  })

  it("reports a vanished subsystem as a catalog finding without touching the claim", () => {
    const mode = shipping({
      subsystem: "apps/dashboard/server/gone",
      claim: null,
      acceptedUnclaimed: { owner: "o", date: "d", check: "c" }
    })
    const findings = auditCatalog({ modes: [mode], knownSubsystems: ["apps/dashboard/server"] })
    expect(findings.map((f) => f.id)).toEqual(["SHIP-X"])
    expect(findings[0].verdict).toBe("stale-catalog-entry")
  })

  it("runs the self-audit before any claim and returns counts for every verdict", () => {
    const out = verifyAll({
      modes: [
        shipping({ id: "SHIP-A", claim: "apps/dashboard/server/__tests__/gone.test.mjs", subsystem: "vanished" }),
        shipping({ id: "SHIP-B" })
      ],
      inventory: withGuard(),
      knownSubsystems: ["apps/dashboard/server"]
    })
    expect(out.catalogFindings.length).toBeGreaterThan(0)
    expect(Object.keys(out.counts).sort()).toEqual([...VERDICTS].sort())
    expect(out.counts["guard-missing"]).toBe(1)
    expect(out.counts.verified).toBe(1)
  })

  it("a claim outside the inventory's declared scope is stale, never guard-missing", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/ws6-domain.test.ts" })
    const r = verifyMode({ mode, inventory: { guards: [], unreadable: [] } })
    expect(r.verdict).toBe("stale-catalog-entry")
  })

  it("reports the scope reason in evidence, not only in the verdict", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/ws6-domain.test.ts" })
    const r = verifyMode({ mode, inventory: { guards: [], unreadable: [] } })
    expect(r.evidence.reason).toBe("claim-outside-inventory-scope")
    expect(r.evidence.claimPath).toBe("apps/dashboard/server/__tests__/ws6-domain.test.ts")
  })

  it("a resolving claim with no gap is verified", () => {
    expect(verifyMode({ mode: shipping(), inventory: withGuard() }).verdict).toBe("verified")
  })

  it("a claim that resolves but declares a gap is partially-covered, never verified", () => {
    const mode = shipping({ gap: "the producer half is uncovered" })
    expect(verifyMode({ mode, inventory: withGuard() }).verdict).toBe("partially-covered")
  })

  it("a guard that resolved but asserts nothing is guard-cannot-fail", () => {
    const inv = withGuard({ asserts: 0 })
    expect(verifyMode({ mode: shipping(), inventory: inv }).verdict).toBe("guard-cannot-fail")
  })

  it("a claim with no suffix pointing at a resolving guard is verified", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/g.test.mjs" })
    const r = verifyMode({ mode, inventory: withGuard() })
    expect(r.verdict).toBe("verified")
    expect(r.evidence.claimTitle).toBeNull()
  })

  it("a suffixed claim whose title the guard declares is verified", () => {
    const mode = shipping({
      claim: "apps/dashboard/server/__tests__/g.test.mjs :: reconciles the two piles"
    })
    const inv = withGuard({ describes: ["reconciles the two piles"] })
    const r = verifyMode({ mode, inventory: inv })
    expect(r.verdict).toBe("verified")
    expect(r.evidence.claimTitle).toBe("reconciles the two piles")
  })

  it("a suffixed claim resolves a partial title, because the title may contain the separator", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/g.test.mjs :: one :: two" })
    const inv = withGuard({ describes: ["one :: two"] })
    expect(verifyMode({ mode, inventory: inv }).verdict).toBe("verified")
  })

  it("a gap never yields verified, even when the whole file is claimed", () => {
    const mode = shipping({ gap: "half the failure mode is uncovered" })
    const inv = withGuard({ describes: ["irrelevant"] })
    expect(verifyMode({ mode, inventory: inv }).verdict).toBe("partially-covered")
  })

  it("a suffixed claim whose title is absent, with nothing unread, is guard-missing", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/g.test.mjs :: a title that is gone" })
    const inv = withGuard({ describes: ["some other title"], unresolvedTitles: 0 })
    const r = verifyMode({ mode, inventory: inv })
    expect(r.verdict).toBe("guard-missing")
    expect(r.evidence.reason).toBe("claim-title-not-declared")
  })

  it("a title that cannot be disproven is unestablished, never reported absent", () => {
    const mode = shipping({ claim: "apps/dashboard/server/__tests__/g.test.mjs :: a title that is gone" })
    const inv = withGuard({ describes: ["some other title"], unresolvedTitles: 3 })
    const r = verifyMode({ mode, inventory: inv })
    expect(r.verdict).toBe("stale-catalog-entry")
    expect(r.evidence.unresolvedTitles).toBe(3)
  })

  it("no inventory content whatsoever can upgrade a capital mode", () => {
    // THE STRONG FORM OF RULING 1, BEYOND the controller's own test. That one
    // passes a MATCHING guard, which shows the verdict is not upgraded BY
    // evidence; this one shows it is decided before the inventory is consulted
    // AT ALL. The list below spans every shape the argument needs, and its
    // length is asserted below so this comment cannot drift away from it: a
    // guard matching by path with a thousand assertions, a two-guard inventory,
    // an unreadable-list one, an empty one, a missing one, a non-array one,
    // an object carrying neither field, a null one, an undefined one, and one
    // holding a guard whose own fields are malformed.
    const mode = shipping({
      id: "CAP-1",
      kind: "capital",
      claim: null,
      acceptedUnclaimed: { owner: "platform owner", date: "2026-10-11", check: "name the human who does" }
    })
    const hostileInventories = [
      withGuard({ asserts: 1000, describes: ["x"], unresolvedTitles: 0 }),
      {
        guards: [
          { file: "a.test.mjs", describes: ["x"], unresolvedTitles: 0, asserts: 1 },
          { file: "b.test.mjs", describes: ["y"], unresolvedTitles: 0, asserts: 1 }
        ],
        unreadable: []
      },
      { guards: [], unreadable: ["a.test.mjs", "b.test.mjs"] },
      { guards: [], unreadable: [] },
      {},
      { guards: "not an array", unreadable: null },
      null,
      undefined,
      { guards: [{ file: "a.test.mjs", asserts: "many", describes: null, unresolvedTitles: 0 }], unreadable: [] }
    ]
    expect(hostileInventories).toHaveLength(9)
    for (const inventory of hostileInventories) {
      const r = verifyMode({ mode, inventory })
      expect(r.verdict).toBe("unverified-manual")
      expect(r.manualCheck).toBe("name the human who does")
    }
  })

  it("a capital mode reporting verified or partially-covered is unreachable", () => {
    // Not a duplicate of the test above: that one pins the verdict for nine
    // inventory shapes. This one pins it against the OTHER verdicts a capital
    // mode could conceivably report, so a future edit cannot make a capital
    // mode silently downgrade into something a renderer would render as coverage.
    const mode = shipping({ id: "CAP-9", kind: "capital", claim: null, acceptedUnclaimed: { owner: "o", date: "d", check: "c" } })
    const verdicts = new Set()
    for (const claim of [null, "apps/dashboard/server/__tests__/g.test.mjs"]) {
      for (const gap of [null, "half uncovered"]) {
        for (const kind of ["capital", "shipping"]) {
          const r = verifyMode({
            mode: shipping({ id: "x", kind, claim, gap, acceptedUnclaimed: { owner: "o", date: "d", check: "c" } }),
            inventory: withGuard()
          })
          if (kind === "capital") verdicts.add(r.verdict)
        }
      }
    }
    expect([...verdicts]).toEqual(["unverified-manual"])
  })

  it("a capital mode whose disposition is absent still reports unverified-manual", () => {
    // There is nothing to verify and nothing to check off, which is the worst
    // case in the set. `unverified-manual` is still the honest verdict: `null`
    // manualCheck says no one has claimed the check, and it must NOT become
    // `stale-catalog-entry` — that verdict means the catalog entry is unsound,
    // and a capital entry without a disposition is a real catalog defect but is
    // ALSO capital, and the capital gate runs first by design.
    const mode = shipping({ id: "CAP-0", kind: "capital", claim: null, acceptedUnclaimed: null })
    const r = verifyMode({ mode, inventory: withGuard() })
    expect(r.verdict).toBe("unverified-manual")
    expect(r.manualCheck).toBeNull()
  })

  it("a capital verdict is decided without the inventory being read at all", () => {
    // The strongest available statement of ruling 1, and stronger than any
    // assertion on a verdict string: this inventory THROWS on every property
    // access. If `verifyMode` touched `inventory` even once before returning for
    // a capital mode, this test would throw rather than return a verdict. A
    // passing test is therefore positive evidence that no inventory content can
    // influence the verdict — not merely that the right string came back.
    const hostile = {
      get guards() {
        throw new Error("inventory was consulted")
      },
      get unreadable() {
        throw new Error("inventory was consulted")
      }
    }
    const mode = shipping({
      id: "CAP-1",
      kind: "capital",
      claim: "apps/dashboard/server/__tests__/g.test.mjs",
      acceptedUnclaimed: { owner: "platform owner", date: "2026-10-11", check: "prove the halt by hand" }
    })
    const r = verifyMode({ mode, inventory: hostile })
    expect(r.verdict).toBe("unverified-manual")
    expect(r.manualCheck).toBe("prove the halt by hand")
  })

  it("a shipping mode with a disposition and no claim is unclaimed, not unverified-manual", () => {
    const mode = shipping({
      claim: null,
      acceptedUnclaimed: { owner: "platform owner", date: "2026-10-11", check: "bisect to the commit" }
    })
    const r = verifyMode({ mode, inventory: withGuard() })
    expect(r.verdict).toBe("unclaimed")
    expect(r.manualCheck).toBe("bisect to the commit")
  })

  it("reads a missing inventory as no evidence, never as a green row", () => {
    // `inventory.mjs` reads a missing reader as NO EVIDENCE rather than
    // fabricating content, and the same asymmetry holds here: with no inventory
    // at all, a claim cannot be shown to resolve, so it does not resolve. The
    // failure direction is the pessimistic one — `guard-missing`, never
    // `verified` — which is the only safe direction for an input this module
    // does not control.
    const mode = shipping()
    for (const inventory of [undefined, null, {}, { guards: [] }, { unreadable: [] }]) {
      expect(verifyMode({ mode, inventory }).verdict).toBe("guard-missing")
    }
  })

  it("a guard the inventory tracked but could not read resolves no claim", () => {
    // `unreadable` is neither absence nor an assertion count of zero, and both
    // of the verdicts that could otherwise absorb it would be fabrications.
    const mode = shipping()
    const inv = { guards: [], unreadable: ["apps/dashboard/server/__tests__/g.test.mjs"] }
    const r = verifyMode({ mode, inventory: inv })
    expect(r.verdict).toBe("stale-catalog-entry")
    expect(r.evidence.reason).toBe("claim-guard-unreadable")
  })
})

// The purity guard. `verify.mjs` must be reachable from a route as a pure
// function of injected data, so anything that reaches outside the module — a
// store, a network call, the filesystem, a clock, an environment variable — is a
// defect here even if the behaviour is correct on the day it is written. The
// check reads the module's own SOURCE rather than its behaviour, because a
// behavioural probe cannot tell "did not read the filesystem" from "read it and
// found nothing to change the answer".
describe("verify.mjs is a pure module", () => {
  const FORBIDDEN = [
    { pattern: /\bfrom\s+["']node:/, why: "no node builtin import" },
    { pattern: /\brequire\s*\(/, why: "no require" },
    { pattern: /\bprocess\s*\./, why: "no process access" },
    { pattern: /\bDate\s*\.\s*now\b|\bnew\s+Date\b/, why: "no clock read" },
    { pattern: /\bfetch\s*\(/, why: "no network" },
    { pattern: /\bfetchMocks?\b/, why: "no fetch mock" }
  ]

  for (const { pattern, why } of FORBIDDEN) {
    it(`declares no violation: ${why}`, () => {
      expect(VERIFY_CODE).not.toMatch(pattern)
    })
  }

  it("bites: the purity guard fails on a planted violation", () => {
    // A guard that has never been shown to fire is not a guard. The two samples
    // below are the shapes most likely to be added by a well-meaning future edit
    // — a clock read to decide staleness, and an env read to point the verifier
    // at a data directory — and the detectors are run over them directly so the
    // test proves the DETECTOR works rather than only that the module is clean.
    const plantedProcessEnv = 'export function verifyMode(){ const dir = process.env.PICC_DATA_DIR; return dir }'
    const plantedClock = 'export function verifyMode(){ const now = new Date(); return now.getTime() }'
    expect(plantedProcessEnv).toMatch(FORBIDDEN.find((f) => f.why === "no process access").pattern)
    expect(plantedClock).toMatch(FORBIDDEN.find((f) => f.why === "no clock read").pattern)
  })

  it("imports the claim splitter rather than reimplementing the separator split", () => {
    // SHIP-5 in miniature: two evidence piles drifting apart because each
    // re-implemented one predicate. A second `" :: "` split in this file would be
    // exactly that defect, and the fix is to assert its absence rather than to
    // trust that no future edit adds one. The check runs on the module's
    // comments-BLANKED source (via the one shared lexer, itself the subject of
    // catalog entry SHIP-1), because this file legitimately NAMES the separator
    // in prose and a raw-text scan would flag its own documentation.
    expect(VERIFY_SOURCE).toMatch(/from\s+["']\.\/inventory\.mjs["']/)
    const code = stripComments(VERIFY_SOURCE)
    expect(code).not.toContain("::")
    expect(code).not.toMatch(/\.split\(/)
    expect(code).not.toMatch(/indexOf\(/)
  })
})

describe("the self-audit is reported separately from the verdicts", () => {
  it("surfaces a vanished subsystem even when that mode's claim would verify", () => {
    // Ruling 3 made concrete: the audit does not SUPPRESS claim evaluation, it
    // reports alongside it and in its own array. A mode whose subsystem has
    // vanished but whose guard resolves is still a catalog defect AND still a
    // resolving claim, and a reader needs both facts rather than whichever the
    // implementation happened to keep.
    const mode = shipping({ id: "SHIP-Z", subsystem: "apps/dashboard/server/vanished" })
    const out = verifyAll({ modes: [mode], inventory: withGuard(), knownSubsystems: ["apps/dashboard/server"] })
    expect(out.catalogFindings.map((f) => f.id)).toEqual(["SHIP-Z"])
    expect(out.results[0].verdict).toBe("verified")
  })

  it("reports nothing from the audit when every subsystem is known", () => {
    const out = verifyAll({
      modes: [shipping()],
      inventory: withGuard(),
      knownSubsystems: ["apps/dashboard/server"]
    })
    expect(out.catalogFindings).toEqual([])
  })

  it("carries a zero count for every verdict nothing was reported under", () => {
    // A renderer iterating `counts` must be able to print "0 capital modes
    // verified" without inferring it from a missing key — a missing key reads
    // as "not measured", which is a different claim from "measured, none".
    const out = verifyAll({
      modes: [shipping()],
      inventory: withGuard(),
      knownSubsystems: ["apps/dashboard/server"]
    })
    for (const verdict of VERDICTS) {
      expect(out.counts).toHaveProperty(verdict)
      if (verdict !== "verified") expect(out.counts[verdict]).toBe(0)
    }
    expect(out.counts.verified).toBe(1)
  })
})

describe("verify.mjs against the real catalog", () => {
  // `catalog.mjs` is a code constant with no I/O, so importing it is not
  // pointing a test at the repository tree — the INVENTORY below is injected
  // and deliberately empty, so this proves the planner covers the real
  // catalog's shapes without reading a single file. It is the check that would
  // catch a new entry whose shape the verifier silently mishandles.
  it("places every one of the real entries on a verdict, and never green by default", () => {
    const out = verifyAll({
      modes: FAILURE_MODES,
      inventory: { guards: [], unreadable: [] },
      knownSubsystems: [...new Set(FAILURE_MODES.map((m) => m.subsystem))]
    })
    expect(out.results).toHaveLength(FAILURE_MODES.length)
    for (const r of out.results) expect(VERDICTS).toContain(r.verdict)

    const byId = Object.fromEntries(out.results.map((r) => [r.id, r]))
    expect(byId["CAP-1"].verdict).toBe("unverified-manual")
    expect(byId["CAP-3"].manualCheck).toContain("Prove the halt by hand")
    expect(byId["SHIP-4"].verdict).toBe("unclaimed")
    // SHIP-1/2/3 all carry a gap, so with no guard found they must NOT be
    // `verified`, and no capital entry may be anything but unverified-manual.
    expect(byId["SHIP-1"].verdict).toBe("guard-missing")
    expect(byId["SHIP-2"].verdict).toBe("guard-missing")
    for (const m of FAILURE_MODES.filter((x) => x.kind === "capital")) {
      expect(byId[m.id].verdict).toBe("unverified-manual")
    }
  })

  it("counts every entry exactly once", () => {
    const out = verifyAll({
      modes: FAILURE_MODES,
      inventory: { guards: [], unreadable: [] },
      knownSubsystems: [...new Set(FAILURE_MODES.map((m) => m.subsystem))]
    })
    const total = Object.values(out.counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(FAILURE_MODES.length)
  })
})