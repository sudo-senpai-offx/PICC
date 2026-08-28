import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { scanExtensionSources } from "../../../extension/scripts/check-boundary.mjs"

// Slice 7e — the collect/decide boundary (L1). The extension is the
// DATA-COLLECTION layer; it must never import or reference the dashboard's
// decision modules (modelMatrix / prediction / accuracyLedger) or anything
// under ../server. The build guard shares this scanner; here we assert both
// that the REAL source is clean and that the guard actually fails on a
// planted violation (so it cannot silently rot).

describe("extension collect/decide boundary (7e)", () => {
  it("the real extension source imports no decision/analysis modules", () => {
    const { ok, violations } = scanExtensionSources()
    expect(violations).toEqual([])
    expect(ok).toBe(true)
  })

  it("guard fails when a decision module import sneaks into the extension", () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-boundary-"))
    try {
      writeFileSync(
        join(dir, "bad.ts"),
        'import { computeModelMatrix } from "../../server/services/modelMatrix.mjs"\nexport const x = 1\n',
        "utf8"
      )
      writeFileSync(join(dir, "calls.ts"), "const w = recordModelOutcomes(votes, true)\n", "utf8")
      writeFileSync(join(dir, "ok.ts"), "import { extractBalance } from './selectors/expertoption'\n", "utf8")

      const { ok, violations } = scanExtensionSources(dir)
      expect(ok).toBe(false)
      expect(violations.length).toBeGreaterThanOrEqual(2)
      expect(violations.some((v) => v.includes("bad.ts"))).toBe(true)
      expect(violations.some((v) => v.includes("calls.ts"))).toBe(true)
      expect(violations.some((v) => v.includes("ok.ts"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})