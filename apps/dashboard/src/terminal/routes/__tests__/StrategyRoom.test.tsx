// @vitest-environment jsdom
// WS-7 T9 room instance 5 of 22 (D1's order): Strategy.
//
// THIS FILE RECORDS A FINDING RATHER THAN A BUILD, AND THE FINDING IS THE
// POINT OF IT.
//
// T9's acceptance line (:1278) is "AC-020 passes for both", and unlike Markets,
// Risk, Ceremony and Ministry — whose acceptance lines each NAME their content —
// it names NO Strategy content anywhere in this spec. Combined with the verified
// absence of any Strategy producer in the tree, that means there is nothing in the
// spec to scope a Strategy surface FROM and nothing in the repository to scope it
// AGAINST. So this room is NOT built, and the tests below hold that decision in
// place rather than letting it quietly become a plausible-looking panel.
//
// WHAT IS ASSERTED HERE, AND WHY EACH ONE MATTERS:
//
//   1. THE PRODUCER ABSENCE IS A VERIFIED FACT, not an assumption. Enumerated
//      against the tree, so the claim can be re-checked and will fail if a
//      producer ever appears without this record being revisited.
//   2. THE ROOM RENDERS AN EXPLICIT, OWNED ABSENCE — no number, no score, no
//      control — which is the honesty contract, not a placeholder.
//   3. THE VERDICT IS `incomplete`, NOT `complete`. AC-020:929 prohibits declaring
//      a room COMPLETE while it "has no reserved placeholder that could be
//      trivially filled later", and this room's rendering IS one.
//   4. THE OWNER IS D10's `WS-7+` LITERAL, not a task id. A task id is a schedule;
//      no human owns this capability.

import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { renderToStaticMarkup } from "react-dom/server"
import {
  STRATEGY_COMPLETION,
  STRATEGY_RESERVATION,
  STRATEGY_RESERVED_REASON,
  StrategyRoom
} from "../../../pages/ministry/reservedRooms"

/**
 * The repository root, resolved from git rather than assumed.
 *
 * The pathspecs below are REPO-ROOT relative, and the harness runs with the
 * workspace directory as cwd — so an earlier draft that passed
 * `apps/dashboard/server/services` found nothing and failed as "command failed"
 * rather than as a finding. Resolving the root makes the enumeration work from
 * any cwd.
 */
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()

/**
 * `git grep` with no match EXITS NON-ZERO, so `execFileSync` throws on the very
 * result these tests are looking for. An earlier draft let that throw escape and
 * the failure surfaced as an exception rather than as "nothing matched", which is
 * the wrong signal for a check whose whole job is to notice an absence.
 */
function gitGrep(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).toString()
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout
    if (typeof stdout === "string") return stdout
    return ""
  }
}

describe("WS-7 T9 — Strategy: the producer absence, verified rather than assumed", () => {
  it("there is NO strategy route in handlers.mjs", () => {
    // The decisive half. A route is the only way a room can be fed, so its absence
    // is the absence of the room's producer. Discovered by scanning, not by
    // trusting a line number, so a route added later turns this red.
    const src = execFileSync("git", ["show", "HEAD:apps/dashboard/server/handlers.mjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 28
    })
    const routes = src.match(/path === "\/api\/[^"]*"/g) ?? []
    const strategy = routes.filter((r) => /strateg/i.test(r))
    expect(strategy, `handlers.mjs must expose no strategy route; found ${JSON.stringify(strategy)}`).toEqual([])
  })

  it("strategy code DOES exist — five named strategies, and that corrects a first draft", () => {
    // T9's FIRST DRAFT of this record said "there is no strategy producer in this
    // tree", and this test is what caught it being false. Recording the correction
    // as an assertion rather than a memory is the point: a finding that was wrong
    // once will be wrong again if nothing holds it.
    //
    // Each of the five returns a confluence-shaped `{ score, signal, reason }`.
    const exported = gitGrep([
      "grep",
      "-n",
      "-E",
      "^export function strategy[A-Za-z]*\\(",
      "--",
      "apps/dashboard/server/services/marketIntel.mjs"
    ])
    const symbols = [...exported.matchAll(/export function (strategy[A-Za-z]*)\(/g)].map((m) => m[1]).sort()
    expect(symbols, "the five named strategies must still be exported; a change here means the finding must be revisited").toEqual([
      "strategyEdge",
      "strategyMtf",
      "strategyPhase",
      "strategyRR",
      "strategyVolume"
    ])
  })

  it("and they have ZERO production callers — definitions and their own test only", () => {
    // The claim that actually matters, and it is narrower than "there is no
    // strategy code". These are ORPHANED EXPORTS WITH TESTS, not a served
    // surface. Scoped to `apps/dashboard/server` — the SERVER tree — because T9's
    // own completion record names the five symbols while explaining that they have
    // no caller, and a record that documents a finding is not a caller of it. An
    // earlier draft of this test scanned all of `apps/dashboard` and therefore
    // counted `reservedRooms.tsx`, which would have made the assertion about the
    // wrong tree.
    const symbols = ["strategyMtf", "strategyPhase", "strategyVolume", "strategyRR", "strategyEdge"]
    const referencing = new Set()
    for (const symbol of symbols) {
      const hits = gitGrep(["grep", "-l", symbol, "--", "apps/dashboard/server"])
      for (const line of hits.split("\n").filter(Boolean)) referencing.add(line.trim())
    }
    expect(
      [...referencing].sort(),
      `within the server tree only the definitions and the strategies' own test may reference them; found ${JSON.stringify([...referencing].sort())}`
    ).toEqual([
      "apps/dashboard/server/__tests__/marketIntel.test.mjs",
      "apps/dashboard/server/services/marketIntel.mjs"
    ])
  })

  it("no ROUTE serves them, so nothing could hand a room their output", () => {
    const src = execFileSync("git", ["show", "HEAD:apps/dashboard/server/handlers.mjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 28
    })
    const routes = (src.match(/path === "\/api\/[^"]*"/g) ?? []).filter((r) => /strateg/i.test(r))
    expect(routes, `handlers.mjs must expose no strategy route; found ${JSON.stringify(routes)}`).toEqual([])
  })

  it("no server file is NAMED strategy, and the one room-key mention is a REPORTED subject", () => {
    const named = execFileSync("git", ["ls-files", "apps/dashboard/server"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => /strateg/i.test(f))
    expect(named, `no server file may be NAMED strategy; found ${JSON.stringify(named)}`).toEqual([])

    // `governance.mjs` lists `strategy` because it reports on all 15 frozen room keys
    // — being a REPORTED SUBJECT is not being SERVED. This is the same distinction
    // T8's own bisect test draws for the ceremony room key.
    const governance = execFileSync("git", ["show", "HEAD:apps/dashboard/server/services/authority/governance.mjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 28
    })
    expect(governance, "strategy appears in the frozen room-key list").toMatch(/^\s*"strategy",$/m)
    expect(governance).not.toMatch(/path ===/)
    expect(governance).not.toMatch(/strategyRoom|strategyLive/)
  })

  it("the room renders an EXPLICIT absence with an owner and no fabricated content", () => {
    const html = renderToStaticMarkup(<StrategyRoom />)

    // The reserved state, with its owner.
    expect(html).toContain('data-room-key="strategy"')
    expect(html).toContain("Strategy")
    expect(html).toContain(STRATEGY_RESERVATION)
    expect(html).toContain("reserved")

    // NO number, no score, no chart, no control. A reserved surface that showed a
    // figure would be a fabricated figure; one that showed a button would be an
    // affordance for an unimplemented capability.
    expect(html).not.toMatch(/<button|<input|<select|<form|<canvas|<svg/)
    expect(html).not.toMatch(/\d+(\.\d+)?%/)
  })

  it("the owner is D10's RESERVATION, not a task id", () => {
    // R7.4 requires `WS-7+` for an unowned capability, and D10:175-182 reserves
    // that literal so nothing invents an owner. T9 changed this from `WS-7 T9`: a
    // task id is a schedule, and a reader seeing one could reasonably conclude
    // somebody was building the room. T9 finished and did not, because there is
    // nothing to build against.
    expect(STRATEGY_RESERVATION).toBe("WS-7+")
    expect(STRATEGY_COMPLETION.absences.every((a) => !/^WS-7 T\d$/.test(a.owner)), "no absence may name a task as its owner").toBe(true)
    expect(JSON.stringify(STRATEGY_COMPLETION), "the verdict must serialise the reservation, not a task id").not.toContain("WS-7 T9")
  })

  it("the reason names the REFUSAL and the ORPHANS, not merely an absence", () => {
    // "There is no producer" reads like unfinished work, and it would be false. What
    // T9 actually found is five orphaned strategies it declined to adopt, and a
    // reader deciding whether to accept that needs the reasoning.
    expect(STRATEGY_RESERVED_REASON).toMatch(/strategyMtf/)
    expect(STRATEGY_RESERVED_REASON).toMatch(/ZERO production callers/i)
    expect(STRATEGY_RESERVED_REASON).toMatch(/creating a production caller for an orphan/i)
    expect(STRATEGY_RESERVED_REASON).toMatch(/second copy of the Copilot surface/i)
    expect(STRATEGY_RESERVED_REASON).toMatch(/nothing is known about this room/i)
    // And it must NOT claim there is no strategy code — that was T9's first draft and
    // it was false.
    expect(STRATEGY_RESERVED_REASON).not.toMatch(/no strategy producer (exists|to build against)/i)
  })
})

describe("WS-7 T9 — Strategy: the D27 verdict", () => {
  it("is `incomplete`, because a reserved placeholder is the rendering", () => {
    // AC-020:929 — "It may not be declared COMPLETE with a reserved block a later
    // task was expected to fill". Claiming `complete` here would be the unflagged
    // trim in its purest form: the room looks routed and says nothing.
    expect(STRATEGY_COMPLETION.verdict).toBe("incomplete")
    expect(STRATEGY_COMPLETION.room).toBe("strategy")
    expect(STRATEGY_COMPLETION.d1Order).toBe(5)
  })

  it("carries a NAMED open boundary rather than a `null` that claims it was answered", () => {
    // D27's requirement is that the boundary be a stated, reviewable thing. A
    // `null` here would assert the WS-8 question was asked and answered; it was
    // not, because this spec does not determine it.
    const handoff = STRATEGY_COMPLETION.ws8Handoff
    expect(handoff).not.toBeNull()
    expect(handoff.what).toMatch(/WS-8/)
    expect(handoff.detail.length, "the boundary needs a written reason").toBeGreaterThan(80)
    expect(handoff.owner).toBe("owner decision")
    // And it must be explicit that this task did NOT settle it.
    expect(handoff.decidedByThisTask).toBe(false)
    expect(handoff.detail).toMatch(/names NO Strategy content/)
  })

  it("names every absence with a reason, an owner, and a WS-8 answer", () => {
    for (const absence of STRATEGY_COMPLETION.absences) {
      expect(absence.what.length).toBeGreaterThan(0)
      expect(absence.detail.length, `${absence.what} needs a written reason`).toBeGreaterThan(80)
      expect(absence.owner.length).toBeGreaterThan(0)
      // `null` is a legitimate answer here and is DIFFERENT from `false`: the room
      // genuinely does not know whether these belong to WS-8, and recording `false`
      // would claim it had decided.
      expect(absence).toHaveProperty("isWs8Scope")
      expect([true, false, null]).toContain(absence.isWs8Scope)
    }
    const whats = STRATEGY_COMPLETION.absences.map((a) => a.what)
    expect(whats).toContain("NO ROUTED STRATEGY PRODUCER, AND FIVE ORPHANED EXPORTS THAT ARE NOT ONE")
  })

  it("serialises its boundary — a verdict whose caveats live only in a JSDoc is a bare verdict", () => {
    // The reason AC-020's verification clause is "assert the completion record
    // contains an explicit completeness verdict": `JSON.stringify` drops comments,
    // so a boundary documented only in prose disappears from the record.
    const serialised = JSON.stringify(STRATEGY_COMPLETION)
    expect(serialised).toContain("NO ROUTED STRATEGY PRODUCER")
    expect(serialised).toContain("incomplete")
    expect(serialised).toContain("owner decision")
    expect(STRATEGY_COMPLETION.reason).toMatch(/NOT complete/)
  })
})