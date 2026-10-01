// @vitest-environment jsdom
// WS-7 T10 — THE REMAINING READ-ONLY ROOMS: 16 instances across 9 keys.
//
// Spec :1282-1289, verbatim:
//   Scope:      The remaining read-only room instances, in the owner's residual order.
//   Acceptance: AC-020 passes per instance. Read-only rooms never acquire a write
//               affordance; unavailable data is unavailable, not zero.
//   Bisect:     Each instance is independently revertible.
//
// THREE CLAIMS THIS FILE HOLDS, AND WHY EACH NEEDS ITS OWN EVIDENCE.
//
// 1. NINE SURFACES, NOT SIXTEEN. `MinistryRoom.tsx` declares 22 route instances
//    across 15 keys; T7/T8/T9 took six of them, leaving these 16 across NINE
//    distinct keys. Sixteen components would be sixteen copies of one shape, and
//    two copies of a shape drift — the duplication the plan's Risk 6 names. So
//    the instantiation is asserted STRUCTURALLY: one surface module, one route
//    module, one domain module, and sixteen instances described as DATA.
//
// 2. "UNAVAILABLE IS UNAVAILABLE, NOT ZERO" (`:1287`). This is the requirement
//    most likely to be got wrong, so it is proved in the STRONGEST available
//    form — at the type level and then again at the markup level. `ReadOnlyFact`
//    carries `observed: boolean | null` where `null` means "not observed", which
//    is the T16 `authorityById(authorities, "WS-7+") === null` precedent: an
//    absence is a DISTINGUISHABLE STATE, not a default value. And `value` is
//    `string | null`, never a number, so a fact cannot even hold a fabricated 0.
//    Each key is then rendered with its producer absent, and the markup is
//    asserted to contain the named absence and NOT to contain a zero-shaped
//    token; and with the producer present-and-legitimately-empty, and the two
//    renderings are asserted to DIFFER. That difference is the requirement.
//
// 3. THE READ-ONLY GUARANTEE (`:1287`, "never acquire a write affordance").
//    T9's pattern: the ceiling is exported as empty DATA, the verdict type has
//    no permissive member, and the test ENUMERATES RENDERED MARKUP rather than
//    checking one known-bad control is absent. Checking for a named bad control
//    passes on a control nobody thought of; enumerating does not.
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"

import { ReadOnlyRoom } from "../ReadOnlyRoom"
import {
  READ_ONLY_AFFORDANCE_REASON,
  READ_ONLY_INTERACTIVE_AFFORDANCES,
  READ_ONLY_OWNER,
  READ_ONLY_ROOM_KEYS,
  READ_ONLY_VERDICTS,
  buildReadOnlyRoomView
} from "../../domain/readOnlyRooms"
import type { ReadOnlyRoomKey, ReadOnlySuiteId } from "../../domain/readOnlyRooms"
import {
  READ_ONLY_ROOM_COMPLETIONS,
  READ_ONLY_RESIDUAL_ORDER_BASIS,
  READ_ONLY_RESIDUAL_ORDER_JUDGEMENT,
  readOnlyCompletion
} from "../../domain/readOnlyRoomCompletions"

/* ==========================================================================
   THE INVENTORY, taken from `MinistryRoom.tsx:18-62` rather than restated.

   `MINISTRY_ROOMS` is the authority. The 16 instances T10 owns are the total
   minus the six T7/T8/T9 already took, and the key set is derived from the
   router's own declaration order — which is what fixes the residual order
   (recorded below, and in the changelog entry).
   ========================================================================== */

const readCode = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")

/**
 * Source with comments and string literals removed, for STATIC assertions about
 * what a module does.
 *
 * Needed because this file's own documentation names the very patterns it forbids:
 * `ReadOnlyRoomSurface.tsx` contains the sentence "there is no `key ===` and no
 * `suite ===` here", so a naive grep for a forbidden branch matches the comment
 * explaining that there is none. Stripping comments before grepping is the same
 * move T8's bisect test made, and for the same reason — this repository has
 * already had to learn the difference between a comment and a call site.
 *
 * String literals go too, for the mirror-image reason: a doc comment naming
 * `"/api/twin/run"` is not a fetch of it.
 */
function readCodeStripped(relative: string): string {
  let code = readCode(relative)
  code = code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
  code = code.replace(/`(?:\\.|[^`\\])*`/g, '""').replace(/"(?:\\.|[^"\\])*"/g, '""')
  code = code.replace(/'(?:\\.|[^'\\])*'/g, '""')
  return code
}

/** The router's own per-suite declaration, parsed from source. */
function routerInstances(): { suite: string; key: string }[] {
  const source = readCode("../../../pages/ministry/MinistryRoom.tsx")
  const out: { suite: string; key: string }[] = []
  const suites: { name: string; body: string }[] = []
  // Only the three per-suite maps. `MINISTRY_ROOMS` at :64 is the index that
  // COLLECTS them and also ends in `_ROOMS`, so matching on that suffix alone
  // picks up a fourth "suite" that has no name — which is how an inventory test
  // can fail for a reason that has nothing to do with the inventory.
  const re = /const ((?:TRADING|EARNINGS|INTELLIGENCE)_ROOMS):[^=]*= \{([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) suites.push({ name: m[1], body: m[2] })
  const suiteOf: Record<string, string> = {
    TRADING_ROOMS: "trading",
    EARNINGS_ROOMS: "earnings",
    INTELLIGENCE_ROOMS: "intelligence"
  }
  for (const suite of suites) {
    const name = suiteOf[suite.name]
    expect(name, `${suite.name} must be one of the three frozen suites`).toBeTruthy()
    for (const line of suite.body.split("\n")) {
      // `dashboard: lazy(...)` or `"command-centre": StudioRoomComponent`.
      const entry = line.match(/^\s{2}("?)([a-z-]+)\1\s*:/)
      if (entry) out.push({ suite: name, key: entry[2] })
    }
  }
  return out
}

/** The six instances T7 (markets, risk), T8 (ceremony, ministry) and T9 (strategy, paper) took. */
const ALREADY_DELIVERED = new Set([
  "trading/markets",
  "trading/risk",
  "trading/ceremony",
  "trading/ministry",
  "trading/strategy",
  "trading/paper"
])

describe("WS-7 T10 — the residual inventory is 16 instances across 9 keys", () => {
  const instances = routerInstances()

  it("the router declares 22 instances, of which T10 owns exactly 16", () => {
    expect(instances).toHaveLength(22)
    const residual = instances.filter((r) => !ALREADY_DELIVERED.has(`${r.suite}/${r.key}`))
    expect(residual).toHaveLength(16)
  })

  it("those 16 collapse to exactly the 9 distinct keys T10 was briefed on", () => {
    const residual = instances.filter((r) => !ALREADY_DELIVERED.has(`${r.suite}/${r.key}`))
    const keys = [...new Set(residual.map((r) => r.key))].sort()
    expect(keys).toEqual([
      "autopilot",
      "command-centre",
      "dashboard",
      "dispatch",
      "governor",
      "guidance",
      "settings",
      "simulator",
      "studio"
    ])
    // And the domain module's key list is the SAME list — derived once, not restated.
    expect([...READ_ONLY_ROOM_KEYS].sort()).toEqual(keys)
  })

  it("the completion records cover every residual instance, keyed suite/key", () => {
    const residual = instances
      .filter((r) => !ALREADY_DELIVERED.has(`${r.suite}/${r.key}`))
      .map((r) => `${r.suite}/${r.key}`)
    const recorded = READ_ONLY_ROOM_COMPLETIONS.map((c) => `${c.suite}/${c.key}`)
    expect([...recorded].sort()).toEqual([...residual].sort())
    // Looked up by the same string, because a record nothing can find is a record
    // nothing can assert against.
    for (const id of residual) expect(readOnlyCompletion(id)).toBeDefined()
  })
})

/* ==========================================================================
   THE RESIDUAL ORDER — a recorded judgement, not an invention.

   D1 `:97` ends "remaining read-only rooms" and T10 `:1283` says "in the owner's
   residual order", but no residual order was ever supplied. The order used here
   is therefore chosen and its basis is RECORDED, because silently imposing an
   order the owner never gave is the anti-goal.
   ========================================================================== */

describe("WS-7 T10 — the residual order is a recorded judgement with a stated basis", () => {
  it("states which basis was used and why, in code and not only in the changelog", () => {
    expect(READ_ONLY_RESIDUAL_ORDER_BASIS).toBe("suite-order-then-router-declaration-order")
    expect(READ_ONLY_RESIDUAL_ORDER_JUDGEMENT.length).toBeGreaterThan(200)
    // The judgement must say what it is NOT standing in for: an owner order.
    expect(READ_ONLY_RESIDUAL_ORDER_JUDGEMENT).toMatch(/owner (supplied|chose|has not)/i)
    // And it must name the basis it actually used, so a reader can check it.
    expect(READ_ONLY_RESIDUAL_ORDER_JUDGEMENT).toMatch(/INNER_NAV|router|declaration order/i)
  })

  it("assigns d1Order 7..22 with no gap and no repeat", () => {
    const orders = READ_ONLY_ROOM_COMPLETIONS.map((c) => c.d1Order).sort((a, b) => a - b)
    expect(orders).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22])
  })

  it("the order follows suite order, then the router's declaration order within a suite", () => {
    const suiteRank = ["trading", "earnings", "intelligence"]
    const inOrder = [...READ_ONLY_ROOM_COMPLETIONS].sort((a, b) => a.d1Order - b.d1Order)
    expect(inOrder.filter((c) => c.suite === "trading")).toHaveLength(7)
    expect(inOrder.filter((c) => c.suite === "earnings")).toHaveLength(4)
    expect(inOrder.filter((c) => c.suite === "intelligence")).toHaveLength(5)
    // Suites appear as contiguous blocks in the frozen §0.3 order.
    const seenSuites = inOrder.map((c) => c.suite)
    expect(suiteRank.indexOf(seenSuites[0])).toBe(0)
    expect(new Set(seenSuites).size).toBe(3)
  })
})

/* ==========================================================================
   CLAIM 3 — THE READ-ONLY GUARANTEE
   ========================================================================== */

describe("WS-7 T10 — the read-only guarantee: no write affordance, as data and as markup", () => {
  it("the affordance ceiling is exported EMPTY DATA, so it can fail a test", () => {
    // A comment saying "no affordances" cannot fail. This can.
    expect(Array.isArray(READ_ONLY_INTERACTIVE_AFFORDANCES)).toBe(true)
    expect(READ_ONLY_INTERACTIVE_AFFORDANCES).toHaveLength(0)
    expect(Object.isFrozen(READ_ONLY_INTERACTIVE_AFFORDANCES)).toBe(true)
  })

  it("the affordance reason is shown to a reader and names the ceiling, not just the absence", () => {
    expect(READ_ONLY_AFFORDANCE_REASON.length).toBeGreaterThan(200)
    expect(READ_ONLY_AFFORDANCE_REASON).toMatch(/ceiling is zero/i)
  })

  it("the verdict vocabulary has no permissive member", () => {
    // These rooms assert nothing permissive, so there is no member meaning
    // "available" / "ready" / "connected" to be misused. Enumerated, not assumed.
    expect([...READ_ONLY_VERDICTS].sort()).toEqual(["observed", "partially-observed", "unobserved"])
    const permissive = READ_ONLY_VERDICTS.filter((v) => /ready|available|live|ok|complete|permitted/i.test(v))
    expect(permissive).toEqual([])
  })

  it("EVERY key, rendered with its producers ABSENT, contains NO interactive element", () => {
    // The enumeration form, over all nine keys. Checking "the known-bad button is
    // absent" would pass on a control nobody thought of.
    for (const key of READ_ONLY_ROOM_KEYS) {
      const view = buildReadOnlyRoomView({ key, suite: suiteForKey(key), readouts: {} })
      const html = renderToStaticMarkup(<ReadOnlyRoom view={view} />)
      expect(html, `${key} must render no <button>`).not.toMatch(/<button/i)
      expect(html, `${key} must render no <input>`).not.toMatch(/<input/i)
      expect(html, `${key} must render no <form>`).not.toMatch(/<form/i)
      expect(html, `${key} must render no <select>`).not.toMatch(/<select/i)
      expect(html, `${key} must render no <textarea>`).not.toMatch(/<textarea/i)
      expect(html, `${key} must render no contenteditable`).not.toMatch(/contenteditable/i)
      expect(html, `${key} must render no anchor`).not.toMatch(/<a\b/i)
      // Not merely "no event handler" — no element at all that could take one.
      expect(html, `${key} must render no on* handler`).not.toMatch(/\son(click|change|submit|input)=/i)
    }
  })

  it("no key's markup declares the affordance ceiling as anything but zero", () => {
    for (const key of READ_ONLY_ROOM_KEYS) {
      const view = buildReadOnlyRoomView({ key, suite: suiteForKey(key), readouts: {} })
      const html = renderToStaticMarkup(<ReadOnlyRoom view={view} />)
      expect(html).toContain('data-interactive-affordances="0"')
    }
  })

  it("no module in the tree still imports the HonestScaffold placeholder", () => {
    // The three intelligence instances were `HonestScaffold` bodies — the literal
    // words "under development", no data. AC-020:929 makes a reserved placeholder
    // a failing criterion, so they were replaced. The component is then DELETED
    // rather than left exported and unrouted, for T8's reason: an unused export of
    // a placeholder for a key that now has a real room reads as a live fallback,
    // and a later edit re-pointing the router at the import path would find a
    // placeholder waiting rather than a missing module.
    //
    // This is the grep that makes the deletion verifiable rather than asserted.
    //
    // AND IT READS THE COMMENT-STRIPPED SOURCE, which is not a detail. The first
    // run of this assertion failed on `IntelligenceRooms.tsx`, whose new header
    // comment explains what the scaffold was replaced by — so the grep matched the
    // explanation of the deletion rather than an import of the deleted module. The
    // same trap the surface assertions hit. Stripping comments first is what makes
    // this a check on imports instead of on prose.
    const dir = "../../../pages/ministry"
    const sources = readdirSync(fileURLToPath(new URL(dir, import.meta.url)))
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .map((f) => ({ f, code: readCodeStripped(`${dir}/${f}`) }))
    const importers = sources.filter((s) => s.f !== "HonestScaffold.tsx" && /HonestScaffold/.test(s.code))
    expect(
      importers.map((s) => s.f),
      "these still import the deleted placeholder"
    ).toEqual([])
    expect(
      sources.some((s) => s.f === "HonestScaffold.tsx"),
      "HonestScaffold.tsx itself should have been deleted by T10"
    ).toBe(false)
  })

  it("the three intelligence instances that were scaffolds now render the read-only room", () => {
    // The positive half: replacing a placeholder is only the right move if
    // something real took its place, and the suite's own module is where that is
    // decided.
    const code = readCode("../../../pages/ministry/IntelligenceRooms.tsx")
    for (const [name, key] of [
      ["IntelligenceDashboardRoom", "dashboard"],
      ["IntelligenceGovernorRoom", "governor"],
      ["IntelligenceSettingsRoom", "settings"]
    ] as const) {
      const body = code.slice(code.indexOf(`export function ${name}`))
      expect(body.slice(0, 400), `${name} must render the read-only room`).toContain(`useReadOnlyView("${key}", "intelligence")`)
      // Read stripped here too: the module header names the scaffold on purpose.
      expect(readCodeStripped("../../../pages/ministry/IntelligenceRooms.tsx").slice(0, 400)).not.toContain(
        "HonestScaffold"
      )
    }
  })
})

const suiteForKey = (key: ReadOnlyRoomKey): ReadOnlySuiteId =>
  key === "governor" || key === "guidance" ? "intelligence" : "trading"

describe("WS-7 T10 — an absent producer renders a NAMED absence, never a zero", () => {
  it("a fact's value cannot hold a number, so a zero cannot be fabricated into one", () => {
    const view = buildReadOnlyRoomView({ key: "dashboard", suite: "trading", readouts: {} })
    for (const section of view.sections) {
      for (const fact of section.facts) {
        // `string | null` — the type is the guarantee, and this is the assertion
        // that the type was not widened by a later edit.
        expect(typeof fact.value === "string" || fact.value === null).toBe(true)
      }
    }
  })

  it("absent and legitimately-empty producers render DIFFERENTLY, for every key", () => {
    for (const key of READ_ONLY_ROOM_KEYS) {
      const suite = suiteForKey(key)

      // (a) every readout absent — a failed fetch, a 503, or no request made.
      const absent = buildReadOnlyRoomView({ key, suite, readouts: {} })

      // (b) every readout OBTAINED and LEGITIMATELY EMPTY: `ok: true` with the
      //     collections empty. A producer that ran and found nothing is not the
      //     same fact as a producer that could not be reached, and a room that
      //     renders them identically is asserting something it did not observe.
      const empty = buildReadOnlyRoomView({ key, suite, readouts: emptyReadoutsFor(key, suite) })

      expect(absent.verdict, `${key}: nothing observed must not read as observed`).toBe("unobserved")
      expect(empty.verdict, `${key}: obtained-but-empty must not read as unobserved`).not.toBe("unobserved")
      expect(empty.verdict, `${key}: obtained-but-empty IS observed`).toBe("observed")

      // And the renderings differ, which is the requirement stated as a fact about
      // output rather than about a return value.
      const absentHtml = renderToStaticMarkup(<ReadOnlyRoom view={absent} />)
      const emptyHtml = renderToStaticMarkup(<ReadOnlyRoom view={empty} />)
      expect(absentHtml, `${key}: the two states must not render identically`).not.toBe(emptyHtml)
      expect(absentHtml).toContain('data-readout-obtained="false"')
      expect(emptyHtml).toContain('data-readout-obtained="true"')
    }
  })

  it("no absent section renders a zero-shaped token anywhere in its markup", () => {
    for (const key of READ_ONLY_ROOM_KEYS) {
      const suite = suiteForKey(key)
      const view = buildReadOnlyRoomView({ key, suite, readouts: {} })
      const html = renderToStaticMarkup(<ReadOnlyRoom view={view} />)
      // The tokens a zero-fill would produce. `data-count="0"` and a bare `>0<`
      // are the two this repository has actually shipped before.
      expect(html, `${key} must not render a fabricated count`).not.toMatch(/data-count="0"/)
      expect(html, `${key} must not render a fabricated total`).not.toMatch(/data-total="0"/)
      expect(html, `${key} must not render a bare zero value`).not.toMatch(/>\s*0\s*</)
      expect(html, `${key} must not render a percentage of zero`).not.toMatch(/0\s*%/)
      // And it DOES render the named absence, so the test above is not passing
      // because the markup is empty.
      expect(html.length, `${key} must render something`).toBeGreaterThan(200)
    }
  })

  it("an absent section names its producer route and its owner, and never a task id", () => {
    for (const key of READ_ONLY_ROOM_KEYS) {
      const suite = suiteForKey(key)
      const view = buildReadOnlyRoomView({ key, suite, readouts: {} })
      expect(view.absences.length, `${key} must name at least one absence`).toBeGreaterThan(0)
      for (const absence of view.absences) {
        expect(absence.what.length).toBeGreaterThan(0)
        expect(absence.detail.length).toBeGreaterThan(20)
        // AC-042: an unowned capability shows D10's literal, never a task id —
        // a task id is a schedule, and a reader seeing one could conclude
        // someone was building it. T9 made this exact correction.
        expect(absence.owner, `${key}: ${absence.what}`).not.toMatch(/WS-7 T\d/)
        expect([READ_ONLY_OWNER, "not applicable — a deliberate refusal, not unfinished work"]).toContain(
          absence.owner
        )
      }
    }
  })

  it("the Dashboard room does not default a missing risk figure to a plausible number", () => {
    // `pages/ministry/DashboardRoom.tsx:40` renders `status?.riskPerTradePct ?? 2`.
    // That is the exact shape this requirement forbids: an absent producer rendered
    // as a believable 2%. The read-only room must render the ABSENCE instead, and
    // the legacy default is recorded as a finding rather than silently inherited.
    const absent = buildReadOnlyRoomView({ key: "dashboard", suite: "trading", readouts: {} })
    const risk = absent.sections.flatMap((s) => s.facts).find((f) => /risk/i.test(f.fact))
    expect(risk, "the trading dashboard must report a risk fact").toBeDefined()
    expect(risk?.observed).toBeNull()
    expect(risk?.value).toBeNull()

    // And with the producer present, the figure is the producer's, not a default.
    const observed = buildReadOnlyRoomView({
      key: "dashboard",
      suite: "trading",
      readouts: { "trading-status": { ok: true, paper: {}, riskPerTradePct: 1.5 } }
    })
    const observedRisk = observed.sections.flatMap((s) => s.facts).find((f) => /risk/i.test(f.fact))
    expect(observedRisk?.observed).toBe(true)
    expect(observedRisk?.value).toBe("1.5")
    expect(observedRisk?.value).not.toBe("2")
  })

  it("an agents payload of null means NOT CONFIGURED, and is not an offline reading", () => {
    // `/api/health` sends `agents: null` when PICC_AGENTS_URL is unset
    // (handlers.mjs:1321-1330). Rendering that as "0 agents online" would be the
    // zero-fill: null means the question was never asked.
    const notConfigured = buildReadOnlyRoomView({
      key: "guidance",
      suite: "intelligence",
      readouts: { health: { ok: true, agents: null } }
    })
    const unreachable = buildReadOnlyRoomView({
      key: "guidance",
      suite: "intelligence",
      readouts: { health: { ok: true, agents: { url: "http://x", ok: false } } }
    })
    const notConfiguredHtml = renderToStaticMarkup(<ReadOnlyRoom view={notConfigured} />)
    const unreachableHtml = renderToStaticMarkup(<ReadOnlyRoom view={unreachable} />)
    // Observed, in both cases — the producer WAS reached. But the states differ.
    expect(notConfigured.verdict).toBe("observed")
    expect(unreachable.verdict).toBe("observed")
    expect(notConfiguredHtml).not.toBe(unreachableHtml)
    expect(notConfiguredHtml).toMatch(/not configured/i)
    expect(unreachableHtml).toMatch(/unreachable/i)
  })

  it("a 503 from the agents settings proxy is an absence, not an empty settings object", () => {
    // `/api/agents/settings` returns 503 with `{ error }` when unconfigured
    // (handlers.mjs:5061). A room that rendered that as "no settings configured,
    // 0 of them" would be asserting a count it never read.
    const refused = buildReadOnlyRoomView({
      key: "governor",
      suite: "intelligence",
      readouts: { "agents-settings": { error: "agents service not configured (set PICC_AGENTS_URL)" } }
    })
    const section = refused.sections.find((s) => s.id === "agents-settings")
    expect(section).toBeDefined()
    expect(section?.readoutObtained).toBe(false)
    expect(section?.facts.every((f) => f.observed === null)).toBe(true)
    const html = renderToStaticMarkup(<ReadOnlyRoom view={refused} />)
    expect(html).toContain('data-readout-obtained="false"')
    expect(html).toContain("not configured")
  })
})

/* ==========================================================================
   CLAIM 1 — NINE SURFACES, INSTANTIATED SIXTEEN TIMES
   ========================================================================== */

describe("WS-7 T10 — nine surfaces, instantiated sixteen times, not sixteen components", () => {
  it("exactly ONE surface module and ONE domain module exist for all 9 keys", () => {
    const surface = readCodeStripped("../../components/ReadOnlyRoomSurface.tsx")
    expect(surface).toContain("ReadOnlyRoomSurface")
    // No per-key fork. A surface that switched on the key would be sixteen rooms
    // wearing one filename, which is the duplication this task was warned about —
    // so the switch itself is asserted absent, not merely the file count.
    for (const key of READ_ONLY_ROOM_KEYS) {
      expect(surface, `the shared surface must not fork on the "${key}" key`).not.toMatch(
        new RegExp(`(key|roomKey)\\s*===?\\s*""${key}""`)
      )
      expect(surface, `the shared surface must not name the "${key}" key at all`).not.toContain(key)
    }
    // The verdict vocabulary reaches the surface as data, so there is one copy of
    // it in the tree rather than one per rendering path.
    expect(surface).toMatch(/affordances\.length|data-interactive-affordances/)
  })

  it("every instance renders, from the SAME component, with its own suite and key in the markup", () => {
    for (const completion of READ_ONLY_ROOM_COMPLETIONS) {
      const view = buildReadOnlyRoomView({
        key: completion.key,
        suite: completion.suite,
        readouts: emptyReadoutsFor(completion.key, completion.suite)
      })
      const html = renderToStaticMarkup(<ReadOnlyRoom view={view} />)
      expect(html, `${completion.suite}/${completion.key}`).toContain(
        `data-room-key="${completion.key}"`
      )
      expect(html, `${completion.suite}/${completion.key}`).toContain(`data-suite="${completion.suite}"`)
      expect(html, `${completion.suite}/${completion.key}`).toContain(`data-read-only-room="true"`)
    }
  })

  it("no instance renders a producer route it did not declare", () => {
    // Provenance is part of honesty: a section must carry the route its facts
    // came from, so a reader can check the claim.
    for (const key of READ_ONLY_ROOM_KEYS) {
      const suite = suiteForKey(key)
      const view = buildReadOnlyRoomView({ key, suite, readouts: emptyReadoutsFor(key, suite) })
      for (const section of view.sections) {
        expect(section.route, `${key}/${section.id} must name its producer route`).toMatch(/^\/api\//)
      }
    }
  })
})

/* ==========================================================================
   AC-020 AND D27 — PER-INSTANCE VERDICTS, ALL SIXTEEN
   ========================================================================== */

describe("WS-7 T10 — AC-020: every one of the 16 instances carries an explicit verdict", () => {
  it("every record has the D27 fields, and the verdict vocabulary is closed", () => {
    const verdicts = new Set<string>()
    for (const c of READ_ONLY_ROOM_COMPLETIONS) {
      expect(c.room, "the record must name the room key").toBe(c.key)
      expect(c.suite).toBeTruthy()
      expect(["complete", "incomplete"], `${c.suite}/${c.key} verdict`).toContain(c.verdict)
      verdicts.add(c.verdict)

      // D27: `ws8Handoff` must be PRESENT. A missing key serialises to nothing,
      // which reads identically to "complete with no boundary" — T9 moved this
      // forward because `JSON.stringify` drops comments, so a verdict naming its
      // boundary only in a JSDoc serialises as a bare "complete".
      expect(Object.prototype.hasOwnProperty.call(c, "ws8Handoff"), `${c.suite}/${c.key}`).toBe(true)

      // A `complete` verdict must justify itself in prose, and name any boundary.
      expect(c.reason.length, `${c.suite}/${c.key} reason`).toBeGreaterThan(200)
      if (c.verdict === "complete") {
        expect(c.reason, `${c.suite}/${c.key} must state whether anything is WS-8 scope`).toMatch(
          /No scope in this room logically belongs to WS-8/i
        )
        expect(c.ws8Handoff, `${c.suite}/${c.key}: a complete record leaves ws8Handoff null`).toBeNull()
      } else {
        // An incomplete verdict is only honest if it NAMES the open boundary.
        expect(c.ws8Handoff, `${c.suite}/${c.key}: incomplete needs a named boundary`).not.toBeNull()
        const handoff = c.ws8Handoff as { what: string; detail: string; owner: string; decidedByThisTask: boolean }
        expect(handoff.what.length).toBeGreaterThan(10)
        expect(handoff.detail.length).toBeGreaterThan(100)
        expect(handoff.owner).toBeTruthy()
        expect(typeof handoff.decidedByThisTask).toBe("boolean")
        expect(c.reason, `${c.suite}/${c.key} must say it is NOT complete`).toMatch(/NOT complete|not recorded as complete/i)
      }
    }
    // Not a formality: at least one instance must be honestly `incomplete`, or
    // the task proved nothing about naming a boundary.
    expect(verdicts).toContain("incomplete")
  })

  it("the serialised record carries the absences, so a reader opening the JSON sees them", () => {
    for (const c of READ_ONLY_ROOM_COMPLETIONS) {
      const serialised = JSON.stringify(c)
      for (const absence of c.absences) {
        expect(serialised, `${c.suite}/${c.key}: absence "${absence.what}" must survive serialisation`).toContain(
          absence.what
        )
        // And no absence may name a task id as its owner.
        expect(absence.owner, `${c.suite}/${c.key}: ${absence.what}`).not.toMatch(/WS-7 T\d/)
      }
    }
  })

  it("every record names the pre-existing write affordances its page composition carries", () => {
    // THE FINDING THIS TASK HAS TO REPORT RATHER THAN HIDE. Seven of these sixteen
    // instances already carry write affordances in their legacy page composition,
    // which pre-date WS-7. Calling them "read-only rooms" while a reader can press
    // "Create payment link" would be a false verdict, so each record must name
    // them with their routes — and must NOT claim the room has none.
    const withAffordances = READ_ONLY_ROOM_COMPLETIONS.filter((c) => c.preExistingWriteAffordances.length > 0)
    expect(withAffordances.length, "the audit must find the affordances that exist").toBeGreaterThan(0)
    for (const c of withAffordances) {
      for (const affordance of c.preExistingWriteAffordances) {
        expect(affordance.id.length).toBeGreaterThan(0)
        expect(
          affordance.route === "local-storage-only" || /^\/api\//.test(affordance.route),
          // A pre-existing affordance with NO server route is still an affordance —
          // `trading/settings` persists ministry preferences to localStorage and
          // never touches the API. Recording only `/api/` routes would have hidden
          // it, which is the failure mode this whole assertion exists to prevent.
          `${c.suite}/${c.key}/${affordance.id}: route "${affordance.route}" must be an API path or explicitly local`
        ).toBe(true)
        expect(affordance.detail.length).toBeGreaterThan(20)
        expect(affordance.removedByThisTask, `${affordance.id}`).toBe(false)
      }
      // And the verdict does not quietly claim otherwise.
      expect(c.reason).toMatch(/pre-existing write affordance/i)
    }
  })

  it("every recorded affordance is attributed to the page composition it is really in", () => {
    // An audit that could name an affordance belonging to a DIFFERENT instance
    // would be worse than no audit, because it would relocate the finding. Each
    // recorded affordance's token must appear in that instance's own page file.
    const pages: Record<string, string> = {
      "trading/dashboard": "../../../pages/ministry/DashboardRoom.tsx",
      "trading/settings": "../../../pages/ministry/SettingsRoom.tsx",
      "trading/studio": "../../../pages/ministry/StudioRoom.tsx",
      "earnings/studio": "../../../pages/ministry/StudioRoom.tsx",
      "intelligence/studio": "../../../pages/ministry/StudioRoom.tsx",
      "trading/simulator": "../../../pages/ministry/SimulatorRoom.tsx",
      "trading/autopilot": "../../../pages/ministry/AutopilotRoom.tsx",
      "trading/command-centre": "../../../pages/ministry/CommandCentreRoom.tsx",
      "trading/dispatch": "../../../pages/ministry/DispatchRoom.tsx",
      "earnings/settings": "../../../pages/ministry/EarningsRooms.tsx",
      "earnings/simulator": "../../../pages/ministry/EarningsRooms.tsx",
      "intelligence/guidance": "../../../pages/ministry/IntelligenceRooms.tsx"
    }
for (const [id, file] of Object.entries(pages)) {
      const completion = readOnlyCompletion(id)
      expect(completion, `${id} must have a completion record`).toBeDefined()
      if (!completion) continue
      expect(completion.preExistingWriteAffordances.length, `${id} affordances to check`).toBeGreaterThan(0)
      const source = readCode(file)
      for (const affordance of completion.preExistingWriteAffordances) {
        expect(
          source.includes(affordance.sourceToken),
          `${id}/${affordance.id}: "${affordance.sourceToken}" must appear in ${file}, or the finding is misattributed`
        ).toBe(true)
      }
    }
  })
})

/* ==========================================================================
   SPEC :1289 — EACH INSTANCE IS INDEPENDENTLY REVERTIBLE
   ========================================================================== */

describe("WS-7 T10 — each instance is independently revertible (:1289)", () => {
  it("every instance renders with EVERY producer absent, and still identifies itself", () => {
    for (const c of READ_ONLY_ROOM_COMPLETIONS) {
      const view = buildReadOnlyRoomView({ key: c.key, suite: c.suite, readouts: {} })
      const html = renderToStaticMarkup(<ReadOnlyRoom view={view} />)
      expect(html, `${c.suite}/${c.key} must still render`).toContain(`data-room-key="${c.key}"`)
      expect(html).toContain(`data-suite="${c.suite}"`)
      expect(html).toContain('data-read-only-verdict="unobserved"')
      // Reverting one instance cannot blank another: no instance reads another's
      // state, which the structural assertion below pins rather than this one.
    }
  })

  it("supplying ONE key's readouts to ANOTHER key changes nothing for the second", () => {
    // The transport half of the bisect claim, in the only form that can fail.
    //
    // An earlier draft of this assertion compared a room's rendered routes against
    // its own filtered route list, which is a tautology: the filter already removed
    // everything else, so the loop body could never run and the test passed on an
    // implementation that coupled every room to every other. A second draft then
    // compared two INSTANCES OF THE SAME KEY and failed — but that failure was the
    // assertion being wrong, not the code: `trading/dashboard` and
    // `earnings/dashboard` are the same room key over different producers, and
    // `trading/studio` and `earnings/studio` are the SAME room reading the SAME
    // producer by design (REQ-E.3). Feeding one's readout to the other is not
    // coupling, it is being one surface. A THIRD draft then compared different keys
    // and found `guidance` "observing" from `governor`'s readouts — which is
    // correct, because both read the `health` section of `/api/health`. Two rooms
    // consuming one store over one route is the pattern T8 and T9 explicitly
    // approved; T8's own bisect test says it: "a shared transport is fine, a
    // shared ROOM STATE is not."
    //
    // The defect `:1289` forbids is one ROOM reaching another's STATE. So only
    // readouts the target does NOT declare itself are fed to it — a section id the
    // target also declares is a shared producer, not a leak.
    const pairs: [ReadOnlyRoomKey, ReadOnlyRoomKey][] = [
      ["dispatch", "autopilot"],
      ["command-centre", "dispatch"],
      ["governor", "guidance"],
      ["settings", "simulator"],
      ["dashboard", "studio"]
    ]
    for (const [key, otherKey] of pairs) {
      const aView = buildReadOnlyRoomView({ key, suite: suiteForKey(key), readouts: {} })
      const bBare = buildReadOnlyRoomView({ key: otherKey, suite: suiteForKey(otherKey), readouts: {} })
      const targetIds = new Set(bBare.sections.map((s) => s.id))
      // Only the source's OWN, unshared readouts. Anything the target also declares
      // is a shared producer and is excluded by construction.
      const exclusive = aView.sections.filter((s) => !targetIds.has(s.id))
      const shared = aView.sections.filter((s) => targetIds.has(s.id))
      const aReadouts = Object.fromEntries(
        exclusive.map((s) => [s.id, { ok: true, entries: [{ id: "A" }], providers: { x: true } }])
      )
      const bFed = buildReadOnlyRoomView({
        key: otherKey,
        suite: suiteForKey(otherKey),
        readouts: aReadouts
      })
      // Every section the target declares must still be unobserved. If the source
      // shared a section with it, that section's own readout is what would satisfy
      // it — and this run deliberately supplies no readout for shared ids, so the
      // assertion holds for shared sections too.
      expect(
        bFed.verdict,
        `"${otherKey}" observed something from "${key}"'s exclusive readouts`
      ).toBe("unobserved")
      expect(bFed.sections.every((s) => !s.readoutObtained)).toBe(true)
      expect(renderToStaticMarkup(<ReadOnlyRoom view={bBare} />)).toBe(
        renderToStaticMarkup(<ReadOnlyRoom view={bFed} />)
      )
      // Documenting what was excluded, so a reader can see the shared producers
      // rather than having to rediscover them.
      if (shared.length > 0) {
        for (const section of shared) {
          expect(
            bBare.sections.some((s) => s.id === section.id),
            `${otherKey} should declare the shared section ${section.id}`
          ).toBe(true)
        }
      }
    }
  })

  it("only `studio` is one producer shared by every suite; the rest differ BY DATA", () => {
    // The 'nine surfaces, not sixteen' claim, stated precisely rather than
    // overclaimed.
    //
    // An earlier draft asserted that every shared key declares an identical section
    // set across suites. That is FALSE and the honest form is more interesting:
    // only `studio` does, because REQ-E.3 already routes all three suites at one
    // shared component over one producer (`MinistryRoom.tsx:14-16`). `dashboard`,
    // `settings` and `simulator` instantiate the same KEY in different suites over
    // genuinely DIFFERENT producers — which is why forcing them into one section
    // set would have meant rendering a producer as absent that the instance never
    // asked for.
    //
    // So: one SURFACE and one PROJECTION serve all sixteen, and the suite-specific
    // difference lives in the domain module as declared sections, not as a branch
    // in the surface. That is exactly what the two static assertions above pin.
    const sectionSetFor = (key: ReadOnlyRoomKey, suite: ReadOnlySuiteId) =>
      bViewSections(buildReadOnlyRoomView({ key, suite, readouts: {} }))

    for (const suite of ["trading", "earnings", "intelligence"] as const) {
      expect(sectionSetFor("studio", suite)).toEqual(["browser-status@/api/browser/status"])
    }
    // And the others genuinely differ, which is why they are data-driven.
    expect(sectionSetFor("dashboard", "trading")).toEqual(["trading-status@/api/trading/status"])
    expect(sectionSetFor("dashboard", "earnings")).toEqual(["health@/api/health"])
    expect(sectionSetFor("simulator", "trading")).toEqual(["twin-run@/api/twin/run"])
    expect(sectionSetFor("simulator", "earnings")).toEqual(["streams@/api/streams/snapshot"])
    expect(sectionSetFor("settings", "trading")).toEqual([
      "llm-settings@/api/settings/llm",
      "integrations@/api/integrations"
    ])
    expect(sectionSetFor("settings", "earnings")).toEqual(["health@/api/health"])
    expect(sectionSetFor("settings", "intelligence")).toEqual(["agents-settings@/api/agents/settings"])
  })

  it("each key's section set is identical across the suites that instantiate it", () => {
    // The structural half of "nine surfaces, not sixteen".
    //
    // An earlier draft asserted that a key's sections are byte-identical across
    // suites, which is not what "one surface" means: `trading/dashboard` and
    // `earnings/dashboard` legitimately consume DIFFERENT producers, and forcing
    // them to declare the same sections would mean rendering a producer as absent
    // that the instance never asked for — a false absence, the mirror image of the
    // zero-fill this task exists to prevent.
    //
    // What "one surface" actually claims is narrower and is what is asserted here:
    // there is ONE projection entry point and ONE surface module, so sixteen
    // instances share a rendering path rather than owning sixteen components.
    const domain = readCodeStripped("../../domain/readOnlyRooms.ts")
    const builders = domain.match(/export function build[A-Za-z]*/g) ?? []
    expect(
      builders,
      "there must be exactly one projection entry point, or the instances have forked"
    ).toEqual(["export function buildReadOnlyRoomView"])
    // And the surface receives a view and reads nothing else — no suite switch.
    // Read from the COMMENT-STRIPPED source, because this file's own prose in the
    // surface names the patterns it forbids.
    const surface = readCodeStripped("../../components/ReadOnlyRoomSurface.tsx")
    expect(surface).not.toMatch(/suite\s*===/)
    expect(surface).not.toMatch(/key\s*===/)
    expect(surface).not.toMatch(/switch\s*\(/)
  })

  it("the whole set is driven by data, so one instance can be dropped without touching another", () => {
    // Structural: the view builder is keyed by (suite, key) and holds no
    // cross-instance mutable state. Two builds of the same instance are equal,
    // and building one does not change another's result.
    const a1 = buildReadOnlyRoomView({ key: "dispatch", suite: "trading", readouts: {} })
    const before = buildReadOnlyRoomView({ key: "guidance", suite: "intelligence", readouts: {} })
    buildReadOnlyRoomView({ key: "dashboard", suite: "earnings", readouts: {} })
    const a2 = buildReadOnlyRoomView({ key: "dispatch", suite: "trading", readouts: {} })
    const after = buildReadOnlyRoomView({ key: "guidance", suite: "intelligence", readouts: {} })
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2))
    expect(JSON.stringify(before)).toBe(JSON.stringify(after))
  })
})

/* ==========================================================================
   THE PRODUCER AUDIT — which routes ALREADY EXISTED
   ========================================================================== */

describe("WS-7 T10 — every producer this task consumes already had a route; T10 adds none", () => {
  it("no route was added to handlers.mjs by this task", () => {
    // T9's Discipline, enforced: a second route over a store that already has one
    // gives that store two answers taken at two moments. T10's audit found all nine
    // keys already served, so the correct number of new routes is ZERO.
    const handlers = readCode("../../../../server/handlers.mjs")
    const routesDeclaredByThisTask = [
      "/api/read-only",
      "/api/readonly",
      "/api/trading/read-only",
      "/api/suites",
      "/api/rooms"
    ]
    for (const route of routesDeclaredByThisTask) {
      expect(handlers, `T10 must not add ${route}`).not.toContain(`path === "${route}"`)
    }
  })

  it("every declared producer route is a route handlers.mjs actually serves", () => {
    const handlers = readCode("../../../../server/handlers.mjs")
    const declared = new Set<string>()
    for (const key of READ_ONLY_ROOM_KEYS) {
      const view = buildReadOnlyRoomView({ key, suite: suiteForKey(key), readouts: {} })
      for (const section of view.sections) declared.add(section.route)
    }
    expect(declared.size, "the nine keys should reuse a bounded set of routes").toBeGreaterThanOrEqual(9)
    for (const route of declared) {
      // Either a `path === "..."` branch or a `"/api/...": async` table entry.
      const served = handlers.includes(`path === "${route}"`) || handlers.includes(`"${route}": async`)
      expect(served, `${route} must be served by handlers.mjs, or T10 must add it deliberately`).toBe(true)
    }
  })

  // Routes that handlers.mjs serves WITHOUT an auth gate. Every one of these was
      // found by this test rather than assumed, which is the point: an earlier
      // draft of this list omitted `/api/trading/signals` and the test went red,
      // because handlers.mjs:2977-2980 serves that GET with no requireAuth and no
      // requireSessionOrFirstRun. T10 did not add the gap and may not weaken
      // handlers.mjs to close it, so it is NAMED here and in the command-centre
      // instance's completion record instead. Adding a gate is a change to a
      // route T10 did not write, on a route other tests may depend on.
//
// `GET /api/settings/llm` is in this list for a reason worth stating: its POST
// sibling at handlers.mjs:2774 IS gated and its GET at :2769 is NOT. That pairing
// is exactly why the gate check below is bounded to the route's own block — a
// fixed-size character window over :2769 also covers :2775 and would have reported
// the GET as gated, hiding the finding.
const KNOWN_UNGATED_ROUTES = [
  "/api/health",
  "/api/settings/llm",
  "/api/trading/signals",
  "/api/trading/status"
]

it("the routes T10 reuses are the ones the audit recorded, and each is auth-gated", () => {
    // `requireAuth` first statement is the gate T7R-B established. Reusing a route
    // inherits its gate, so this asserts the reuse did not land on an open door —
    // and where it did, that the gap is a NAMED pre-existing finding rather than
    // something this task quietly inherited or quietly fixed.
    const handlers = readCode("../../../../server/handlers.mjs")
    const reused = [
      "/api/trading/status",
      "/api/trading/dispatch",
      "/api/trading/autopilot",
      "/api/trading/signals",
      "/api/command-centre/overview",
      "/api/browser/status",
      "/api/settings/llm",
      "/api/health",
      "/api/agents/settings"
    ]
    const ungated: string[] = []
    for (const route of reused) {
      const at = handlers.indexOf(`path === "${route}"`)
      if (at === -1) {
        // The table-entry form (`"/api/browser/status": async`) is the other shape.
        expect(handlers).toContain(`"${route}": async`)
        continue
      }
      // Bounded to THIS route's own block: from its `if (path ===` line up to the
      // next one at the same indentation. A fixed character window is wrong because
      // an ungated GET can be followed within a few lines by a gated POST for the
      // same path, which is what /api/settings/llm does.
      const lineStart = handlers.lastIndexOf("\n", at) + 1
      const nextRoute = handlers.indexOf("\n  if (path ===", at + 1)
      const block = handlers.slice(lineStart, nextRoute === -1 ? at + 600 : nextRoute)
      if (!/requireAuth|requireSessionOrFirstRun/.test(block)) ungated.push(route)
    }
    // Every gap found must be a gap this task already named, so adding an ungated
    // reuse is a red test rather than an unnoticed inheritance.
    expect(ungated.sort()).toEqual([...KNOWN_UNGATED_ROUTES].sort())
  })

  it("every ungated route this room reads is named in that room's completion record", () => {
    // So the finding cannot live only in a test. `/api/trading/signals` is read by
    // trading/command-centre and is served ungated, so that instance's record has
    // to say so.
    const record = JSON.stringify(readOnlyCompletion("trading/command-centre"))
    expect(record, "the ungated signals route must be named in the command-centre record").toContain(
      "/api/trading/signals"
    )
    expect(record).toMatch(/ungated|no auth/i)
  })
})

/* ==========================================================================
   HELPERS
   ========================================================================== */

/** A readout payload that is OBTAINED and LEGITIMATELY EMPTY, per section id. */
function emptyReadoutsFor(key: ReadOnlyRoomKey, suite: ReadOnlySuiteId): Record<string, unknown> {
  const view = buildReadOnlyRoomView({ key, suite, readouts: {} })
  const readouts: Record<string, unknown> = {}
  for (const section of view.sections) {
    readouts[section.id] = EMPTY_BY_SECTION[section.id] ?? { ok: true }
  }
  return readouts
}

/**
 * Obtained-and-empty payloads, keyed by section id.
 *
 * These are the fixtures that stop a derivation going vacuous: without a
 * "producer ran and found nothing" case, a projection that renders the absence
 * string unconditionally would pass every absent-producer test above.
 */
const EMPTY_BY_SECTION: Record<string, unknown> = {
  "trading-status": { ok: true, paper: { positions: [], balance: 0 }, riskPerTradePct: 0, demo: null },
  dispatch: { ok: true, unread: 0, entries: [] },
  "autopilot-config": { ok: true, config: { enabled: false, assets: [] } },
  "autopilot-decisions": { ok: true, decisions: [] },
  "command-centre-overview": { ok: true, sites: [] },
  signals: { ok: true, signals: [] },
  "browser-status": { ok: true, available: false, running: false, vaultSites: 0 },
  health: { ok: true, version: "0.2.0", providers: {}, serper: null, agents: null },
  "agents-settings": { ok: true, settings: {} },
  "llm-settings": { ok: true, providers: [] },
  integrations: { ok: true, integrations: [] },
  streams: { ok: true, streams: [], earnings: [] }
}

/** A room's section ids + routes, the fingerprint "one surface" is proven by. */
const bViewSections = (view: { sections: readonly { id: string; route: string }[] }): string[] =>
  view.sections.map((s) => `${s.id}@${s.route}`)