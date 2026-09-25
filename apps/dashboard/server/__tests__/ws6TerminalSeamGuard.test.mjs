// WS-6 T12 — final seam guard (AC-019 / AC-020).
//
// T12 is ALWAYS LAST. It is the consolidated gate: it asserts that the artifacts
// the other slices produced still exist and still hold, so a later edit cannot
// quietly remove a boundary that was already earned.
//
// It deliberately does not re-implement the detailed guards. Those live in
// ws5SeamGuard, ws6SafetySeamGuard, orderFlowHonestySeamGuard, sseCoalescing,
// and the terminal domain suites. This file checks that each of those is still
// present and green, plus the two release artifacts (performance evidence and
// blueprint provenance) that only exist once T10/T9 have run.
import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(at(rel), "utf8")

const GUARDS = [
  "ws5SeamGuard.test.mjs",
  "ws6SafetySeamGuard.test.mjs",
  "orderFlowHonestySeamGuard.test.mjs",
  "ws6-domain.test.ts"
]
const PERF_MANIFEST = at("../../perf/terminal-perf-manifest.json")
const BLUEPRINT = at("../../../../docs/trading-logic/changelog/blueprint-v4-provenance.md")

describe("AC-019 — every earned guard is still present", () => {
  for (const guard of GUARDS) {
    it(`keeps ${guard}`, () => {
      expect(existsSync(at(`./${guard}`)), `${guard} must remain in the floor`).toBe(true)
    })
  }

  it("keeps the terminal public entry point", () => {
    expect(existsSync(at("../../src/terminal/index.ts"))).toBe(true)
  })
})

describe("AC-020 — locked decisions are still encoded in code", () => {
  it("keeps procedureDrillScore permanently non-sizing-eligible (D13)", () => {
    expect(read("../../src/terminal/contracts.ts")).toMatch(/sizingEligible:\s*false/)
  })

  it("keeps the 500-sample expectancy floor literal (D9)", () => {
    expect(read("../../src/terminal/contracts.ts")).toMatch(/requiredCount:\s*500/)
  })

  it("keeps the copilot provenance literal (D6)", () => {
    expect(read("../../src/terminal/contracts.ts")).toMatch(/"copilot: remote"/)
  })

  it("keeps the paper-only execution mode (D12)", () => {
    expect(read("../../src/terminal/contracts.ts")).toMatch(/ExecutionMode\s*=\s*"paper"\s*\|\s*"reserved"/)
  })

  it("keeps the five-part sample key (D8)", () => {
    const src = read("../../src/terminal/domain/sampleKeys.ts")
    for (const part of ["setup", "market", "timeframe", "dataFidelity", "regimeClass"]) {
      expect(src).toContain(part)
    }
  })

  it("keeps the Dead Zone an absolute override in session routing (D10)", () => {
    const src = read("../../src/terminal/domain/sessionRouting.ts")
    // Compare within the FUNCTION BODY only: the route name also appears in the
    // imported type union near the top of the file, which would make a
    // whole-file index comparison meaningless.
    const body = src.slice(src.indexOf("export function routeSession"))
    expect(body).toMatch(/no_trade/)
    const deadZoneAt = body.indexOf("dead zone")
    const overlapAt = body.indexOf("London/NY overlap")
    const afternoonAt = body.indexOf("NY afternoon")
    expect(deadZoneAt, "the dead-zone rule must exist in the router").toBeGreaterThan(-1)
    // The dead zone is an absolute override and must be evaluated FIRST.
    expect(deadZoneAt).toBeLessThan(overlapAt)
    expect(deadZoneAt).toBeLessThan(afternoonAt)
  })

  it("keeps the D3 1280x800 viewport floor in the perf harness", () => {
    expect(read("../../e2e/terminal-perf.spec.ts")).toMatch(/1280,\s*height:\s*800/)
  })

  it("keeps the AC-002 horizontal-scroll assertion in the harness", () => {
    const spec = read("../../e2e/terminal-perf.spec.ts")
    expect(spec, "AC-002 requires a real-browser no-horizontal-scroll assertion").toMatch(/scrollWidth/)
    expect(spec).toMatch(/1280x800 \(D3\)|1280,\s*height:\s*800/)
  })

  it("bundles the terminal stylesheet so terminal-* classes are actually styled", () => {
    expect(existsSync(at("../../src/terminal/styles/terminal.css"))).toBe(true)
    expect(read("../../src/terminal/index.ts"), "an unimported stylesheet is dead code").toMatch(
      /import\s+["']\.\/styles\/terminal\.css["']/
    )
  })

  it("keeps the reduced-motion CSS contract", () => {
    const css = read("../../src/terminal/styles/terminal.css")
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    expect(css, "reduced motion must actually neutralise transitions").toMatch(/transition-duration:\s*0/)
  })
})

describe("AC-018 — performance evidence exists and is honestly labelled", () => {
  it("has a checked-in throttled-proxy manifest", () => {
    expect(existsSync(PERF_MANIFEST)).toBe(true)
  })

  it("labels the evidence as a proxy, never as a target device", () => {
    const m = JSON.parse(readFileSync(PERF_MANIFEST, "utf8"))
    expect(m.evidenceKind).toBe("throttled-proxy")
    expect(m.disclaimer).toMatch(/ARM64 architecture correctness remains UNVERIFIED/i)
    for (const record of m.records) {
      expect(record.label).toBe("throttled-proxy (x86, CPU-limited)")
      expect(record.targetDeviceClaim).toMatch(/UNVERIFIED/)
    }
  })

  it("gives every declared budget an explicit verdict OR an explicit unmeasured marker", () => {
    const m = JSON.parse(readFileSync(PERF_MANIFEST, "utf8"))
    for (const key of Object.keys(m.budgets)) {
      const base = key.split("@")[0]
      const hasVerdict = m.budgetVerdicts.some((v) => v.metric.startsWith(base))
      const declaredUnmeasured = m.unmeasuredBudgets?.some((u) => u.budget === key || u.budget.startsWith(base))
      expect(hasVerdict || declaredUnmeasured, `${key} has neither a measured verdict nor an explicit unmeasured marker`).toBe(true)
    }
  })

  it("never records an unmeasured budget as if it passed", () => {
    const m = JSON.parse(readFileSync(PERF_MANIFEST, "utf8"))
    for (const u of m.unmeasuredBudgets ?? []) {
      expect(u.verdict, "an unmeasured budget must never read as a pass").toBe("UNMEASURED")
      expect(u.reason, "an unmeasured budget must say why").toBeTruthy()
    }
  })

  it("keeps any measured budget breach visible rather than suppressing it", () => {
    const m = JSON.parse(readFileSync(PERF_MANIFEST, "utf8"))
    for (const breach of m.breaches) {
      expect(breach.verdict).toBe("BREACH")
      expect(breach.note, "a breach must carry an owner note").toBeTruthy()
    }
  })
})

describe("AC-015 — blueprint provenance is explicit", () => {
  it("has a provenance record marked VERIFIED or UNVERIFIED", () => {
    expect(existsSync(BLUEPRINT)).toBe(true)
    const text = readFileSync(BLUEPRINT, "utf8")
    expect(/provenance:\s*(UNVERIFIED|VERIFIED)/.test(text)).toBe(true)
  })
})
