import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..") // dashboard root (src/lib/__tests__ → src → lib → root)

/**
 * Phase K guard: the default suite must be broker-agnostic (R3). Any new
 * hard-coded "ExpertOption" wording in a user-facing component file is a
 * regression — EO wording is allowed only in the credential wire-format
 * field names (expertoptionToken / expertoptionDemo) and search keywords.
 */
const USER_FACING = [
  "components/TradingSuite.tsx",
  "components/TradeOrderForm.tsx",
  "components/LiveMarketBoard.tsx",
  "components/LiveDecisionsPanel.tsx",
  "components/TradingHud.tsx",
  "components/DockablePreview.tsx",
  "components/ConfluencePanel.tsx",
  "lib/suites.ts",
  "lib/settings.ts"
]

describe("broker-agnostic suite labels (Phase K R3)", () => {
  for (const rel of USER_FACING) {
    it(`${rel} has no hard-coded ExpertOption wording`, () => {
      const src = readFileSync(join(ROOT, "src", rel), "utf8")
      const hits = src.split("\n").filter((line) => /ExpertOption\b|Expert Option\b/.test(line))
      // Allow the wire-format field names used by the credentials API.
      const violations = hits.filter((line) => !/expertoptionToken|expertoptionDemo|expertoptionWsUrl/.test(line))
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
    })
  }
})