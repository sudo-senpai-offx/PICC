// B-EXE-4 grep-assert — pins the D4 "no auto-execution" boundary in the 10
// wired suite modules (D1/D2/D3 + D4 surfaces). Reads the REAL sources from
// disk (not a stub), so a reintroduced auto-order call anywhere in the suite
// path fails the gate.
//
// Mirrors extensionAbsence.test.mjs: the wiring direction was pinned to
// advisory-first (autopilot execution removed; paper orders reached ONLY via
// the human-approval trade gate in interventions.mjs) and this file pins the
// absence so a future re-introduction without owner approval is caught at the
// test gate.
//
// NOT pinned (legit words/tokens that share characters):
//   - `placeDemoTrade` WITHOUT an opening paren in autopilot.mjs:1382 — the
//     DEPRECATED comment explaining the removal, not a call site;
//   - walkthrough/guide prose mentioning "paper order", "demo order" (advisory
//     wording), "riskPerTradePct", "risk floor", "PAPER ONLY" — honesty
//     labels, not execution;
//   - `order` as a data key/shape field (tradeGate.order, pro vs live order
//     shapes) — the human-approval payload, never an auto-call.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// The ten wired suite modules (B-SPEC D1/D2/D3): every read that can drive a
// buy/sell decision on the dashboard. ZERO of them may open/close/place an
// order on their own — paper or real.
const SUITE_SOURCES = {
  "services/proanalysis.mjs": "../services/proanalysis.mjs",
  "services/adaptiveConfluence.mjs": "../services/adaptiveConfluence.mjs",
  "services/marketConvergence.mjs": "../services/marketConvergence.mjs",
  "services/mtfConvergence.mjs": "../services/mtfConvergence.mjs",
  "services/regimeEngine.mjs": "../services/regimeEngine.mjs",
  "services/indicators.mjs": "../services/indicators.mjs",
  "services/dataSources.mjs": "../services/dataSources.mjs",
  "services/expertoption.mjs": "../services/expertoption.mjs",
  "services/yahoo.mjs": "../services/yahoo.mjs",
  "services/autopilot.mjs": "../services/autopilot.mjs"
}

// A `(` after the token means a call site. autopilot.mjs:1382's removal
// comment writes the bare name without parens and must remain the ONLY
// occurrence — anything with an opening paren is an execution attempt.
const FORBIDDEN_CALLS = [
  /placeDemoTrade\s*\(/g,
  /openPaperTrade\s*\(/g,
  /closePaperTrade\s*\(/g,
  /\.placeOrder\s*\(/g,
  /\.createOrder\s*\(/g,
  /\.submitOrder\s*\(/g,
  /autoExecute\s*\(/g,
  /auto-execute\s*\(/g
]

// The paper-order call sites that ARE legal — exactly three seams, all of
// them human-driven: the interventions.mjs approval branch (T11 trade gate),
// the hand-rolled demo-open API in handlers.mjs, and the ledger definition in
// trading.mjs itself. Files outside this allow-list must contain zero calls.
const ALLOWED_CALL_SITES = {
  "services/interventions.mjs": "../services/interventions.mjs",
  "services/trading.mjs": "../services/trading.mjs",
  "handlers.mjs": "../handlers.mjs"
}

describe("D4 no-auto-execute pin — suite sources place no orders (B-EXE-4)", () => {
  it.each(Object.entries(SUITE_SOURCES))("%s contains zero order-call tokens", (label, rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    for (const re of FORBIDDEN_CALLS) {
      const hits = src.match(re) ?? []
      expect(hits, `${label} must not contain ${re} (got: ${hits.join(", ") || "none"})`).toEqual([])
    }
  })

  it("autopilot is advisory-only: `running: false` + the removal comment still hold", () => {
    const src = readFileSync(fileURLToPath(new URL("../services/autopilot.mjs", import.meta.url)), "utf8")
    expect(src).toMatch(/running:\s*false/) // the engine never claims to run
    expect(src).toContain("execution removed")
    expect(src).toContain("PICC is advisory-first")
    // placeDemoTrade appears ONLY in the removal comment (no call paren).
    const bare = (src.match(/placeDemoTrade/g) ?? []).length
    expect(bare).toBe(1)
    expect(src.match(/placeDemoTrade\s*\(/g) ?? []).toEqual([])
  })

  it("the only paper-order call sites are the human-approval seams", () => {
    for (const [label, rel] of Object.entries(ALLOWED_CALL_SITES)) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
      const openCalls = (src.match(/openPaperTrade\s*\(/g) ?? []).length
      expect(openCalls, `${label} must call openPaperTrade (human path) in this seam`).toBeGreaterThan(0)
      // Even the allowed seams never silently place on a timer: no bare
      // execute-only tokens (placeDemoTrade is banned everywhere).
      expect(src.match(/placeDemoTrade\s*\(/g) ?? []).toEqual([])
    }
  })

  it("the human-approval gate comment is intact in interventions.mjs", () => {
    const src = readFileSync(fileURLToPath(new URL("../services/interventions.mjs", import.meta.url)), "utf8")
    expect(src).toContain("approve reaches openPaperTrade")
  })
})