import { describe, expect, it } from "vitest"
import {
  REASONS,
  SOURCES,
  collectWindows,
  collectWindowsWithReasons
} from "../services/graduation/windows.mjs"

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
  // The rule mirrors ws7TestStoreIsolation.test.mjs:447 (`stripLineComment`):
  // read CODE. Block comments are removed first, then line comments, so a `//`
  // inside a JSDoc block cannot be mistaken for the start of real code — the
  // same ordering concern that guard records.
  const codeOnly = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
      .join("\n")

  it("source contains no permit, ceremony, credential, store or I/O surface", async () => {
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const src = readFileSync(
      fileURLToPath(new URL("../services/graduation/windows.mjs", import.meta.url)),
      "utf8"
    )
    const code = codeOnly(src)
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

  // THE CONTROLS for the strip above. Without them, "strip comments" and
  // "strip everything" are indistinguishable: a broken stripper that deletes the
  // whole file would satisfy every assertion above.
  it("the strip removes comments but a planted violation in code still fires", () => {
    // The planted code lines use I/O tokens, deliberately NOT a `PICC_*`
    // variable. An earlier version of this control planted a fabricated
    // store-variable READ (a path-shaped PICC_ env name), and
    // ws7TestStoreIsolation.test.mjs failed on it — correctly: that guard
    // scans test files for path-shaped `PICC_` names, and a name no module
    // reads redirects nothing, which is precisely the round-4 defect it
    // exists to catch. The fixture was reproducing the very pattern the repo
    // forbids, so the control now plants the same class of violation without
    // minting a fake store variable. Note the detector reads raw LINES, so
    // even MENTIONING such a name in a comment is a finding — hence the
    // paraphrase rather than a quoted example.
    const planted = [
      '// the header says "no writes here"',
      '/** JSDoc: this module never flips a permit. */',
      'mkdirSync(dir)',
      'const stream = createWriteStream(path)'
    ]
    const code = codeOnly(planted.join("\n"))
    expect(code).not.toContain("//")
    expect(code).not.toContain("permit")
    for (const banned of ["mkdirSync", "createWriteStream"]) {
      expect(code, `a real code reference to ${banned} must survive the strip`).toContain(banned)
    }
  })

  it("the strip handles a line comment marker inside a block comment", () => {
    // Block comments are removed FIRST precisely so this cannot leave a `//`
    // behind that makes the line-comment pass eat the rest of the file. If the
    // order were reversed, `codeOnly` below would return "" and pass vacuously.
    const planted = ["/**\n * see http://example.com\n */", 'const x = 1'].join("\n")
    expect(codeOnly(planted)).toContain("const x = 1")
  })
})