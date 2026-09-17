// B-PAP-4 two-bucket separation pins — the §5 honesty mandate: every shared
// money surface renders the two buckets (simulated paper PnL vs live-venue
// demo PnL) SEPARATELY and never a summed paper⊗venue number.
//
// Two layers, mirroring the repo's read-real-source convention:
//   1. Behavior pins: positionManager feeds separate paper/expertoption PnL
//      buckets into the aggregate; no merged `total` survives anywhere.
//   2. Source pins: the income summary must never import/read the paper
//      ledger, and the surfaces that DO read money stores each read exactly
//      one store (paper ledger XOR demo-deals file) — never both.
//
// Legit occurrences NOT pinned:
//   - `paperOverview`/`paperAnalytics` words, "Paper" card titles, "EO demo"
//     labels (surface naming, not merging);
//   - `todayPnl` in autopilot.mjs (its OWN demo-deals-only sum — a single
//     store, not a cross-store merge);
//   - `total` as a generic word ("totals", "totalSize", "totalNotional",
//     "totalEarned") — only the combinedTodayPnl `total:` merge is banned.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const SRC = {
  positionManager: fileURLToPath(new URL("../services/positionManager.mjs", import.meta.url)),
  incomeOverview: fileURLToPath(new URL("../handlers.mjs", import.meta.url)),
  paperAnalytics: fileURLToPath(new URL("../services/trading.mjs", import.meta.url)),
  demoAnalytics: fileURLToPath(new URL("../services/autopilot.mjs", import.meta.url)),
  accountMetrics: fileURLToPath(new URL("../services/accountMetrics.mjs", import.meta.url)),
  accuracyLedger: fileURLToPath(new URL("../services/accuracyLedger.mjs", import.meta.url))
}

describe("paper ⊗ venue separation — no merged money total anywhere (B-PAP-4)", () => {
  it("combinedTodayPnl keeps paper and expertoption as DISTINCT buckets", () => {
    const src = readFileSync(SRC.positionManager, "utf8")
    // Both buckets are built from their own store...
    expect(src).toMatch(/paper:\s*\{\s*pnl:\s*round2\(paperPnl\)/)
    expect(src).toMatch(/expertoption:\s*\{\s*pnl:\s*round2\(demoPnl\)/)
    // ...and the merged `total:` slice is deleted.
    const merge = (src.match(/total:\s*\{\s*pnl:\s*round2\(paperPnl\s*\+\s*demoPnl\)/) ?? []).length
    expect(merge).toBe(0)
    expect(src).toContain("B-PAP-2")
  })

  it("portfolioRiskCheck carries BOTH buckets — never a merged total", () => {
    const src = readFileSync(SRC.positionManager, "utf8")
    expect(src).toMatch(/todayPnl:\s*pnlToday\b/)
    const mergedRisk = (src.match(/todayPnl:\s*pnlToday\.total\b/) ?? []).length
    expect(mergedRisk).toBe(0)
  })

  it("the income summary never reads the paper ledger", () => {
    const src = readFileSync(SRC.incomeOverview, "utf8")
    // incomeSummaryFromServer region must stay purely snapshot/stream-driven.
    const region = src.slice(src.indexOf("function incomeSummaryFromServer"), src.indexOf("function incomeSummaryFromServer") + 4000)
    expect(region).toMatch(/getLatestSnapshots|snapshots/)
    expect(region).not.toMatch(/trading-ledger|openPaperTrade|combinedTodayPnl|positionManager|paperPnl/)
  })

  it("paper analytics read the paper ledger but NEVER the demo-deals file", () => {
    const src = readFileSync(SRC.paperAnalytics, "utf8")
    // The paper store must be read (it IS the surface's source)...
    expect(src).toMatch(/LEDGER_FILE/)
    // ...and the demo-deals store must not leak in.
    expect(src).not.toMatch(/DEMO_DEALS_FILE|trading-demo-deals|demoDealsFile/)
  })

  it("demo analytics read the demo-deals file but NEVER the paper ledger", () => {
    const src = readFileSync(SRC.demoAnalytics, "utf8")
    expect(src).toMatch(/demo-deals|DEMO_DEALS_FILE|deals/)
    expect(src).not.toMatch(/LEDGER_FILE|trading-ledger/)
    // autopilot's own todayPnl sums ONE store (demo deals) — allowed.
    expect(src).toMatch(/todayPnl/)
  })

  it("account metrics split demo vs real wallets as distinct fields", () => {
    const src = readFileSync(SRC.accountMetrics, "utf8")
    expect(src).toMatch(/demoWallet/)
    expect(src).toMatch(/realWallet/)
  })

  it("the decision ledger records outcomes, never paper-ledger money", () => {
    const src = readFileSync(SRC.accuracyLedger, "utf8")
    // It tracks hit/miss/push decision outcomes...
    expect(src).toMatch(/hit|miss|push/)
    // ...but must not read the paper ledger or record realized account PnL.
    // (Predicted `payout`/`winProb`/`ev` fields are decision inputs, not
    // account money; demo-deals reads are the single-store backtest.)
    expect(src).not.toMatch(/LEDGER_FILE|trading-ledger|openPaperTrade/)
    expect(src).not.toMatch(/\bpnl\b/)
  })
})