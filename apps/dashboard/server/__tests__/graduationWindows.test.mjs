import { describe, expect, it } from "vitest"
import {
  REASONS,
  SOURCES,
  collectWindows,
  collectWindowsWithReasons
} from "../services/graduation/windows.mjs"
// THE ONE COMMENT LEXER, by import. This file used to declare its own, which is
// Finding 1 [HIGH] of the two-axis review (0043-TWO_AXIS_REVIEW_FINDINGS, :20):
// four hand-rolled lexers meant four chances for one to be quietly switched off,
// and two had already shipped a VACUOUS pass by blanking real code from the `//`
// of a URL string onward. `ws7TestStoreIsolation`'s `stripLineComment` is NOT a
// precedent here — it is a single-line trailing-comment helper with no block or
// string handling. `guard-primitives.mjs` is the string-aware implementation, and
// `sharedCommentLexer.test.mjs` is what proves every consumer resolves to this
// one binding.
import { stripComments } from "../scripts/guard-primitives.mjs"

// Graduation window collector — pure readout normalizer.
//
// Hermetic by construction: fixture rows in, plain values out. No store, no
// `process.env.PICC_*` redirect, no disk, no network, no clock (the module
// reads no wall clock, so there is nothing to make stale), and no import of a
// backtest/paper/live service. The one file-level read at the bottom is a
// STATIC source read proving the module contains no mutation, permit, ceremony
// or credential surface — the same proof shape costsPaperOverlay.test.mjs:117
// uses, and it touches nothing.
describe("collectWindows", () => {
  it("normalizes paper closes into window stats with provenance", () => {
    const out = collectWindows({
      backtests: [], paperCloses: [{ strategyTag: "breakout", pnlPct: 2.5, entryTime: "2026-09-01T00:00:00Z", exitTime: "2026-09-02T00:00:00Z" }], liveFills: [],
    })
    const w = out.find((x) => x.source === "paper")
    expect(w.strategyTag).toBe("breakout")
    expect(w.provenance).toBe("paper")
    expect(typeof w.returnPct).toBe("number")
  })

  it("insufficient data yields absence, not zeros", () => {
    const out = collectWindows({ backtests: [], paperCloses: [], liveFills: [] })
    expect(out).toEqual([])
  })

  // ---- Chronology -------------------------------------------------------
  // Task 3's "12 consecutive windows" predicate is only well-defined against a
  // chronology, so the ORDER of this output is behaviour, not cosmetics.
  it("returns windows sorted by windowStart ascending across all three sources", () => {
    const out = collectWindows({
      backtests: [
        { strategyTag: "trend", windowStart: "2026-01-10T00:00:00Z", windowEnd: "2026-02-10T00:00:00Z", returnPct: 1 },
        { strategyTag: "trend", windowStart: "2026-03-10T00:00:00Z", windowEnd: "2026-04-10T00:00:00Z", returnPct: 2 }
      ],
      paperCloses: [
        { strategyTag: "breakout", pnlPct: 3, entryTime: "2026-02-15T00:00:00Z", exitTime: "2026-02-16T00:00:00Z" }
      ],
      liveFills: [
        { strategyTag: "scalp", pnlPct: 4, entryTime: "2026-01-05T00:00:00Z", exitTime: "2026-01-06T00:00:00Z" }
      ]
    })
    // Canonical UTC ISO-8601, not the input strings: `toISOString()` is what makes
    // the sort an INSTANT comparison rather than a string one (see the next test).
    expect(out.map((w) => w.windowStart)).toEqual([
      "2026-01-05T00:00:00.000Z",
      "2026-01-10T00:00:00.000Z",
      "2026-02-15T00:00:00.000Z",
      "2026-03-10T00:00:00.000Z"
    ])
    expect(out.map((w) => w.source)).toEqual(["live", "backtest", "paper", "backtest"])
  })

  // Mixed-offset stamps are the reason the sort normalizes to UTC: compared as
  // raw strings these two would sort 02:00 before 01:00, which is backwards.
  it("sorts by instant, not by string, when inputs carry mixed UTC offsets", () => {
    const out = collectWindows({
      paperCloses: [
        // 2026-01-02T01:00Z, written as +08:00
        { strategyTag: "b", pnlPct: 1, entryTime: "2026-01-02T09:00:00+08:00", exitTime: "2026-01-02T10:00:00+08:00" },
        // 2026-01-01T02:00Z, written as Z
        { strategyTag: "a", pnlPct: 1, entryTime: "2026-01-01T02:00:00Z", exitTime: "2026-01-01T03:00:00Z" }
      ]
    })
    expect(out.map((w) => w.windowStart)).toEqual([
      "2026-01-01T02:00:00.000Z",
      "2026-01-02T01:00:00.000Z"
    ])
  })

  // ---- Exclusion, not defaulting ---------------------------------------
  it("excludes windows with missing or unparseable bounds instead of defaulting them", () => {
    const { windows, excluded } = collectWindowsWithReasons({
      paperCloses: [
        { strategyTag: "noStart", pnlPct: 1, exitTime: "2026-01-02T00:00:00Z" },
        { strategyTag: "noEnd", pnlPct: 1, entryTime: "2026-01-01T00:00:00Z" },
        { strategyTag: "junkStart", pnlPct: 1, entryTime: "not-a-date", exitTime: "2026-01-02T00:00:00Z" },
        { strategyTag: "junkEnd", pnlPct: 1, entryTime: "2026-01-01T00:00:00Z", exitTime: "nope" },
        { strategyTag: "inverted", pnlPct: 1, entryTime: "2026-02-02T00:00:00Z", exitTime: "2026-01-01T00:00:00Z" },
        { strategyTag: "good", pnlPct: 1, entryTime: "2026-01-01T00:00:00Z", exitTime: "2026-01-02T00:00:00Z" }
      ]
    })
    expect(windows.map((w) => w.strategyTag)).toEqual(["good"])
    expect(excluded.map((e) => e.reason)).toEqual([
      "windowStart:missing",
      "windowEnd:missing",
      "windowStart:unparseable",
      "windowEnd:unparseable",
      "window:end-before-start"
    ])
    for (const e of excluded) {
      expect(e.source).toBe("paper")
      expect(typeof e.index).toBe("number")
      expect(typeof e.reason).toBe("string")
    }
  })

  it("never invents a bound: no excluded row contributes a windowStart", () => {
    const { windows } = collectWindowsWithReasons({
      backtests: [{ strategyTag: "t", windowStart: null, windowEnd: null, returnPct: 1 }],
      liveFills: [{ strategyTag: "l", pnlPct: 1 }]
    })
    expect(windows).toEqual([])
  })

  // A DELIBERATE non-rule, pinned so it stays deliberate. A zero-length window
  // (end === start) is KEPT, while an inverted one is excluded. Nothing in the
  // evidence is fabricated either way: an instant with a measured return is a
  // real observation, and inventing a minimum duration for it would be the
  // normalizer deciding something only the evidence can decide. If Task 3 wants
  // a duration floor, that belongs in the gate, where it can be reported as a
  // rule rather than buried as a silent drop here.
  it("keeps a zero-length window but excludes an inverted one", () => {
    const { windows, excluded } = collectWindowsWithReasons({
      paperCloses: [
        { strategyTag: "instant", pnlPct: 1, entryTime: "2026-01-01T00:00:00Z", exitTime: "2026-01-01T00:00:00Z" }
      ],
      backtests: [
        { strategyTag: "inverted", windowStart: "2026-02-01T00:00:00Z", windowEnd: "2026-01-01T00:00:00Z" }
      ]
    })
    expect(windows.map((w) => w.strategyTag)).toEqual(["instant"])
    expect(excluded.map((e) => e.reason)).toEqual(["window:end-before-start"])
  })

  // ---- Absence vs measured zero ----------------------------------------
  // THE distinction the whole module exists to protect. A statistic that could
  // not be measured is null + a named reason; a statistic measured as zero is 0
  // and carries no such reason. Both are legal; conflating them is not.
  it("distinguishes an unmeasured statistic (null + reason) from a measured zero", () => {
    const [unmeasured, measuredZero] = collectWindows({
      paperCloses: [
        // No sharpe, no maxDd, no cost lines supplied at all.
        { strategyTag: "a", pnlPct: 1, entryTime: "2026-01-01T00:00:00Z", exitTime: "2026-01-02T00:00:00Z" },
        // Genuinely flat: return 0, sharpe 0, drawdown 0, all-zero cost lines.
        {
          strategyTag: "b",
          pnlPct: 0,
          sharpe: 0,
          maxDd: 0,
          entryTime: "2026-01-01T00:00:00Z",
          exitTime: "2026-01-02T00:00:00Z",
          costLines: [{ closeId: "c1", feeUsd: 0, spreadUsd: 0, slipUsd: 0, provenance: "modeled" }]
        }
      ]
    })
    expect(unmeasured.sharpe).toBe(null)
    expect(unmeasured.maxDd).toBe(null)
    expect(unmeasured.costDragUsd).toBe(null)
    expect(unmeasured.reasons).toContain(REASONS.SHARPE_UNMEASURED)
    expect(unmeasured.reasons).toContain(REASONS.MAX_DD_UNMEASURED)
    expect(unmeasured.reasons).toContain(REASONS.COST_DRAG_ABSENT)

    expect(measuredZero.returnPct).toBe(0)
    expect(measuredZero.sharpe).toBe(0)
    expect(measuredZero.maxDd).toBe(0)
    expect(measuredZero.costDragUsd).toBe(0)
    expect(measuredZero.reasons).toEqual([])
  })

  it("a caller can tell the two apart with a finite check alone", () => {
    const [w] = collectWindows({
      paperCloses: [{ strategyTag: "a", pnlPct: 0, entryTime: "2026-01-01T00:00:00Z", exitTime: "2026-01-02T00:00:00Z" }]
    })
    // Measured zero passes; an absent stat (sharpe) fails closed. This is the
    // gate arithmetic Task 3 will perform.
    expect(Number.isFinite(w.returnPct)).toBe(true)
    expect(Number.isFinite(w.sharpe)).toBe(false)
  })

  it("absent stats are never coerced from a missing return", () => {
    const [w] = collectWindows({
      backtests: [{ strategyTag: "t", windowStart: "2026-01-01T00:00:00Z", windowEnd: "2026-01-02T00:00:00Z" }]
    })
    expect(w.returnPct).toBe(null)
    expect(w.reasons).toContain(REASONS.RETURN_UNMEASURED)
  })

  // Q1 — an EMPTY STRING is absence, not a measured zero.
  //
  // `Number("")` is 0 and `Number("   ")` is 0, so a numeric field that arrived
  // as an empty string (a CSV import, a DB column read as text, a JSON field
  // typed `string`) used to become `returnPct: 0` with NO reason attached. That
  // window passes `Number.isFinite`, so Task 3's gate reads "measured zero" and
  // can argue the strategy OVER the floor, when the truth is "never measured".
  // The failure is silent and it lands at the one point in the pipeline where it
  // matters, so it is pinned here rather than left to a code-reading reviewer.
  it("treats an empty or whitespace-only numeric field as absence, never as a measured zero", () => {
    for (const absent of ["", " ", "   ", "\t", "\n", "\t\n", " \r\n "]) {
      const [w] = collectWindows({
        paperCloses: [
          {
            strategyTag: "b",
            pnlPct: absent,
            sharpe: "",
            maxDd: "  ",
            entryTime: "2026-01-01T00:00:00Z",
            exitTime: "2026-01-02T00:00:00Z"
          }
        ]
      })
      expect(w.returnPct, `pnlPct ${JSON.stringify(absent)} fabricated a measured zero`).toBe(null)
      expect(w.sharpe, `sharpe ${JSON.stringify(absent)} fabricated a measured zero`).toBe(null)
      expect(w.maxDd, `maxDd ${JSON.stringify(absent)} fabricated a measured zero`).toBe(null)
      expect(w.reasons, `pnlPct ${JSON.stringify(absent)} produced no RETURN reason`).toContain(
        REASONS.RETURN_UNMEASURED
      )
      // The load-bearing consequence, stated as the gate will meet it.
      expect(Number.isFinite(w.returnPct), "an absent return must FAIL CLOSED for Task 3").toBe(false)
    }
  })

  // The complement, and it must survive the fix: a REAL zero, however spelled,
  // is a measurement. `"0"` is a number someone wrote down, not an absence, and
  // collapsing it to null would be the opposite error — losing real evidence.
  it("still accepts a real zero however it is spelled", () => {
    for (const zero of [0, "0", 0.0, "0.00", "-0"]) {
      const [w] = collectWindows({
        paperCloses: [
          {
            strategyTag: "b",
            pnlPct: zero,
            sharpe: 0,
            maxDd: "0",
            entryTime: "2026-01-01T00:00:00Z",
            exitTime: "2026-01-02T00:00:00Z"
          }
        ]
      })
      // `===` rather than `toBe`, because `-0` is a real measured zero and
      // `toBe` uses Object.is, which distinguishes `-0` from `+0`.
      expect(w.returnPct === 0, `a real zero ${JSON.stringify(zero)} must survive as 0`).toBe(true)
      expect(w.sharpe === 0).toBe(true)
      expect(w.maxDd === 0).toBe(true)
      expect(Number.isFinite(w.returnPct)).toBe(true)
      expect(w.reasons).not.toContain(REASONS.RETURN_UNMEASURED)
    }
  })

  it("still accepts a non-zero numeric string and a real number", () => {
    const out = collectWindows({
      paperCloses: [
        { strategyTag: "s", pnlPct: "2.5", entryTime: "2026-01-01T00:00:00Z", exitTime: "2026-01-02T00:00:00Z" },
        { strategyTag: "n", pnlPct: -1.25, entryTime: "2026-01-01T00:00:00Z", exitTime: "2026-01-02T00:00:00Z" }
      ]
    })
    // Same start AND end, so the documented strategyTag tiebreak orders them:
    // "n" before "s". Asserting insertion order here would contradict the sort.
    expect(out.map((w) => w.returnPct)).toEqual([-1.25, 2.5])
    for (const w of out) expect(w.reasons).not.toContain(REASONS.RETURN_UNMEASURED)
  })

  // Q2 — cost lines present, but no leg anywhere was MEASURABLE.
  //
  // The header says "an absent cost leg is NOT a zero cost leg", but the code
  // only ever reasoned about a missing leg WITHIN a line. It never asked whether
  // any line yielded a readable measurement, so `costLines: [{}]` fell through
  // every `?? 0` and reported a confident `costDragUsd: 0` — the same
  // "we did not measure" vs "drag was zero" conflation as Q1, one field over.
  it("reports absence, not zero, when no cost leg anywhere is measurable", () => {
    for (const [label, costLines] of [
      ["empty line object", [{}]],
      ["two empty line objects", [{}, {}]],
      ["non-object entries", [null, "x", 42]],
      ["empty-string leg only", [{ feeUsd: "" }]],
      ["null leg only", [{ spreadUsd: null }]],
      ["whitespace leg only", [{ slipUsd: "   " }]]
    ]) {
      const [w] = collectWindows({
        paperCloses: [
          {
            strategyTag: "b",
            pnlPct: 1,
            entryTime: "2026-01-01T00:00:00Z",
            exitTime: "2026-01-02T00:00:00Z",
            costLines
          }
        ]
      })
      expect(w.costDragUsd, `${label} fabricated a measured zero drag`).toBe(null)
      expect(w.reasons, `${label} produced no COST_DRAG reason`).toContain(REASONS.COST_DRAG_ABSENT)
      expect(Number.isFinite(w.costDragUsd), `${label} must FAIL CLOSED for Task 3`).toBe(false)
    }
  })

  // The complement: a REAL measured zero drag is a measurement. Paper charges no
  // explicit fee, so an all-zero cost line is the legitimate zero-drag case the
  // module header promises to report — and it must not be collapsed into null,
  // which would discard real evidence about the absence of explicit costs.
  it("still reports a genuinely measured zero drag as 0", () => {
    const [w] = collectWindows({
      paperCloses: [
        {
          strategyTag: "b",
          pnlPct: 1,
          entryTime: "2026-01-01T00:00:00Z",
          exitTime: "2026-01-02T00:00:00Z",
          costLines: [{ closeId: "c1", feeUsd: 0, spreadUsd: 0, slipUsd: 0, provenance: "modeled" }]
        }
      ]
    })
    expect(w.costDragUsd).toBe(0)
    expect(Number.isFinite(w.costDragUsd)).toBe(true)
    expect(w.reasons).not.toContain(REASONS.COST_DRAG_ABSENT)
  })

  // A PARTIALLY readable pile is still a measurement: one legible leg is enough
  // to sum. Requiring every leg everywhere to be present would throw away real
  // drag measurements whenever one optional leg was absent, which is the
  // W3-02 `finiteOrZero` reading the module deliberately inherited.
  it("still sums a pile where only some legs are measurable", () => {
    const [w] = collectWindows({
      paperCloses: [
        {
          strategyTag: "b",
          pnlPct: 1,
          entryTime: "2026-01-01T00:00:00Z",
          exitTime: "2026-01-02T00:00:00Z",
          // First line has no legible leg; the second carries a real 15 spread.
          costLines: [{}, { closeId: "c2", spreadUsd: 15 }]
        }
      ]
    })
    expect(w.costDragUsd).toBe(15)
    expect(w.reasons).not.toContain(REASONS.COST_DRAG_ABSENT)
  })

  // ---- Cost drag from the W3-02 overlay shape ---------------------------
  it("sums W3-02 overlay cost lines into the window's costDragUsd", () => {
    const [w] = collectWindows({
      paperCloses: [
        {
          strategyTag: "breakout",
          pnlPct: 2.5,
          entryTime: "2026-09-01T00:00:00Z",
          exitTime: "2026-09-02T00:00:00Z",
          // The costs/paperOverlay.mjs `overlayForCloses` line shape verbatim.
          costLines: [
            { closeId: "c1", feeUsd: 0, spreadUsd: 15, slipUsd: 0, provenance: "modeled" },
            { closeId: "c2", feeUsd: 0.5, spreadUsd: 30, slipUsd: 1.5, provenance: "modeled" }
          ]
        }
      ]
    })
    // Line 1: 0 fee + 15 spread + 0 slip = 15. Line 2: 0.5 + 30 + 1.5 = 32.
    // Window total 47 — the same three legs `dragAdjustedEquity` accumulates.
    expect(w.costDragUsd).toBe(47)
    expect(w.reasons).not.toContain(REASONS.COST_DRAG_ABSENT)
  })

  it("leaves costDragUsd null when cost lines are absent, never zero", () => {
    const [w] = collectWindows({
      paperCloses: [{ strategyTag: "b", pnlPct: 5, entryTime: "2026-09-01T00:00:00Z", exitTime: "2026-09-02T00:00:00Z" }]
    })
    expect(w.costDragUsd).toBe(null)
    expect(w.reasons).toContain(REASONS.COST_DRAG_ABSENT)
  })

  // ---- Sources and provenance ------------------------------------------
  it("labels exactly three sources and defaults each to its own name", () => {
    const out = collectWindows({
      backtests: [{ strategyTag: "t", windowStart: "2026-01-01T00:00:00Z", windowEnd: "2026-01-02T00:00:00Z" }],
      paperCloses: [{ strategyTag: "p", pnlPct: 1, entryTime: "2026-01-01T00:00:00Z", exitTime: "2026-01-02T00:00:00Z" }],
      liveFills: [{ strategyTag: "l", pnlPct: 1, entryTime: "2026-01-01T00:00:00Z", exitTime: "2026-01-02T00:00:00Z" }]
    })
    expect(SOURCES).toEqual(["backtest", "paper", "live"])
    expect(new Set(out.map((w) => w.source))).toEqual(new Set(SOURCES))
    for (const w of out) expect(w.provenance).toBe(w.source)
  })

  it("honours a row's narrower provenance over the pile default", () => {
    const [w] = collectWindows({
      paperCloses: [
        {
          strategyTag: "b",
          pnlPct: 1,
          entryTime: "2026-09-01T00:00:00Z",
          exitTime: "2026-09-02T00:00:00Z",
          provenance: "paper-ledger"
        }
      ]
    })
    expect(w.source).toBe("paper")
    expect(w.provenance).toBe("paper-ledger")
  })

  it("live fills default to absent — an ephemeral source, never a fabrication", () => {
    expect(collectWindows({})).toEqual([])
    expect(collectWindows()).toEqual([])
    expect(collectWindows({ liveFills: null }).some((w) => w.source === "live")).toBe(false)
  })

  // ---- Purity -----------------------------------------------------------
  it("passes every input row through untouched (no input mutation)", () => {
    const input = {
      backtests: [{ strategyTag: "t", windowStart: "2026-01-01T00:00:00Z", windowEnd: "2026-01-02T00:00:00Z", returnPct: 1 }],
      paperCloses: [
        {
          strategyTag: "p",
          pnlPct: 2.5,
          entryTime: "2026-09-01T00:00:00Z",
          exitTime: "2026-09-02T00:00:00Z",
          costLines: [{ closeId: "c1", feeUsd: 0, spreadUsd: 15, slipUsd: 0, provenance: "modeled" }]
        }
      ],
      liveFills: []
    }
    const copy = JSON.parse(JSON.stringify(input))
    collectWindows(input)
    expect(input).toEqual(copy)
  })

  it("collectWindows is collectWindowsWithReasons' windows, exactly", () => {
    const input = {
      paperCloses: [{ strategyTag: "p", pnlPct: 1, entryTime: "2026-01-01T00:00:00Z", exitTime: "2026-01-02T00:00:00Z" }]
    }
    expect(collectWindows(input)).toEqual(collectWindowsWithReasons(input).windows)
  })
})

// The advisory ceiling, asserted on the SOURCE. A readout normalizer that grew
// a permit flip or a ceremony call would be invisible to every behavioural test
// above (they would still pass), so the claim is checked statically: this file
// reads no env, writes no file, opens no network, and imports no backtest,
// paper or live service — it takes plain arrays.
describe("graduation windows module — advisory-only boundary", () => {
  // Comments are stripped before the scan, and that is load-bearing rather than
  // cosmetic. This module's own documentation NAMES what it forbids — it says
  // "no `process.env`", "no permit flip", "unlocks nothing" — in BOTH comment
  // forms the repo uses (`//` headers and `/** … */` JSDoc above the exports).
  // A raw substring scan therefore flagged the module for its own prohibitions
  // and could never pass, which makes it a guard that cries wolf on the
  // documentation, and a guard like that gets deleted rather than believed.
  //
  // THE STRIPPER IS `guard-primitives.mjs`'s, BY IMPORT — this file declares
  // none. That is Finding 1 [HIGH] of the two-axis review
  // (`0043-TWO_AXIS_REVIEW_FINDINGS-v1-to-v2.md:20`): four independent lexers
  // were four chances for one to be switched off, and two already shipped a
  // vacuous pass. `ws7TestStoreIsolation`'s `stripLineComment` is NOT a
  // precedent here — it is a single-line trailing-comment helper with no block
  // or string handling, so citing it is how a fifth lexer gets written.
  //
  // STRING CONTENT IS DELIBERATELY PRESERVED by `stripComments` (only the LEXING
  // is string-aware), which is the contract the other guards' predicates rely on
  // and is asserted in `sharedCommentLexer.test.mjs`. It does not weaken the
  // scan below: windows.mjs has no string literal containing a banned token, so
  // "code only" and "code with string contents" give the same answer here — and
  // the assertion is about the module's code, which is the claim being made.

  it("source contains no permit, ceremony, credential, store or I/O surface", async () => {
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const src = readFileSync(
      fileURLToPath(new URL("../services/graduation/windows.mjs", import.meta.url)),
      "utf8"
    )
    const code = stripComments(src)
    for (const banned of [
      "process.env",
      "writeFile",
      "appendFile",
      "rmSync",
      "mkdirSync",
      "createWriteStream",
      "fetch(",
      "node:fs",
      "node:http",
      "unlock",
      "ceremony",
      "permit",
      "preauthorize",
      "DATABASE"
    ]) {
      expect(code, `the window collector must not reference ${banned}`).not.toContain(banned)
    }
    // It must also import nothing from an evidence service: the route adapts.
    expect(code).not.toMatch(/from\s+"\.\.\/(trading|technicalBacktest|hyperopt|prediction|costs)/)
  })

  // THE CONTROLS. Without them, "strip comments" and "strip everything" are
  // indistinguishable: a stripper that deleted the whole file would satisfy
  // every assertion above, which is exactly the vacuous-pass shape Finding 1
  // describes. These pin that the shared lexer still bites.
  it("the shared strip removes comments but a planted violation in code still fires", () => {
    // The planted code lines use I/O tokens, deliberately NOT a `PICC_*`
    // variable. An earlier version of this control planted a fabricated
    // store-variable READ (a path-shaped PICC_ env name), and
    // ws7TestStoreIsolation.test.mjs failed on it — correctly: that guard
    // scans test files for path-shaped `PICC_` names, and a name no module
    // reads redirects nothing, which is precisely the round-4 defect it
    // exists to catch. The fixture was reproducing the very pattern the repo
    // forbids, so the control plants the same class of violation without
    // minting a fake store variable. Note that detector reads raw LINES, so
    // even MENTIONING such a name in a comment is a finding — hence the
    // paraphrase rather than a quoted example.
    const planted = [
      '// the header says "no writes here"',
      "/** JSDoc: this module never flips a permit. */",
      "mkdirSync(dir)",
      "const stream = createWriteStream(path)"
    ].join("\n")
    const code = stripComments(planted)
    expect(code).not.toContain("//")
    expect(code).not.toContain("permit")
    for (const banned of ["mkdirSync", "createWriteStream"]) {
      expect(code, `a real code reference to ${banned} must survive the strip`).toContain(banned)
    }
  })

  // THE REGRESSION THE SHARED LEXER EXISTS TO PREVENT, re-pinned here because
  // THIS is now a consumer of it. A `//`-only stripper blanks the code after a
  // URL string on the same line, finds ZERO banned tokens, and passes vacuously
  // — which is how two of the four original lexers shipped. The assertion is
  // that the string and everything after it survive.
  it("the shared strip does not blank real code that follows a string literal", () => {
    const planted = 'const dir = "file:///tmp/store"; const keep = mkdirSync(dir)'
    const code = stripComments(planted)
    expect(code, "the code after a URL string was blanked — the scan would pass vacuously").toContain(
      "const keep = mkdirSync(dir)"
    )
  })

  // And the strip preserves LENGTH, so a finding reported against this view still
  // lines up with the file on disk.
  it("the shared strip preserves length and line count", () => {
    const src = ["/* block */", 'const u = "http://x.invalid" // trailing', "// whole line", "const end = 1"].join(
      "\n"
    )
    const code = stripComments(src)
    expect(code.length).toBe(src.length)
    expect(code.split("\n")).toHaveLength(src.split("\n").length)
  })

  // FINDING 2 — THE BLOCK-BEFORE-LINE ORDERING SHAPE, re-pinned here.
  //
  // This coverage was LOST when the local `codeOnly` was deleted: the fixture
  // that held the ordering was a test OF the local helper, so removing the
  // helper removed its pin. `sharedCommentLexer.test.mjs` does not plant this
  // shape either, so at the moment of this fix nothing held it.
  //
  // WHY IT MATTERS. A block comment may legitimately contain a `//` — this very
  // module's headers do, in prose like "see http://example.com". A stripper that
  // removed LINE comments first would see that inner `//`, blank everything from
  // there to the end of the line, and leave a fragment of `*/` behind. The
  // `*/` then becomes real code that no comment rule can reach, so every
  // subsequent line of the file is read as code rather than comment — and if
  // that fragment is the last thing on a line, the NEXT line's comment survives
  // unblanked and can satisfy a ban by naming the very token it forbids.
  //
  // The assertion is behavioural, not structural: block comments are removed
  // before line comments, so the inner `//` never becomes a comment opener and
  // the real code after the block survives.
  it("a `//` inside a block comment does not eat the code that follows the block", () => {
    const planted = [
      "/* see // note */",
      "const codeAfterBlock = mkdirSync(dir)",
      "/* end */",
      "const keep = 1"
    ].join("\n")
    const code = stripComments(planted)
    expect(code, "comment text leaked into the code view").not.toContain("note")
    expect(
      code,
      "a `//` inside the first block comment ate the second block's `*/`, so the pair merged and swallowed the real code between them — block comments must be removed BEFORE line comments"
    ).toContain("const codeAfterBlock = mkdirSync(dir)")
    expect(code).toContain("const keep = 1")
  })

  // THE CONTROL for the ordering claim above, because "the fixture happens to
  // work" is not the same as "the fixture would fail on the wrong implementation".
  // This is a deliberately LINE-FIRST stripper with no shared lexer underneath.
  // If the assertion above does not fail against it, the test is not pinning the
  // ordering at all and would pass against any stripper whatsoever.
  //
  // The mechanism it demonstrates, in one line of output: the inner `//` blanks
  // the first block's own `*/`, the two remaining `/*` then pair with the SECOND
  // block's `*/`, and one comment span swallows the real code in between.
  it("CONTROL: a line-first stripper FAILS that fixture, so the ordering is really pinned", () => {
    const lineFirst = (src) =>
      src
        .split("\n")
        .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
        .join("\n")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
    const planted = [
      "/* see // note */",
      "const codeAfterBlock = mkdirSync(dir)",
      "/* end */",
      "const keep = 1"
    ].join("\n")
    expect(
      lineFirst(planted),
      "the control must FAIL: if this line-first stripper also preserved the code, the fixture would not be pinning ordering at all"
    ).not.toContain("const codeAfterBlock = mkdirSync(dir)")
  })
})