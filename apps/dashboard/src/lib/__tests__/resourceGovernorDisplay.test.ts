// G3 — PICC_RESOURCE_GOVERNOR_v1.md §7: display mapping honesty.
// "unobserved metrics render '—', never zero": an empty ledger must NOT
// render 0s as if they were observations, and missing row cells must not
// fabricate values.
import { describe, expect, it } from "vitest"
import {
  budgetSheet,
  featureBurnDown,
  governorBanner,
  ledgerTable,
  verdictSummary
} from "@/lib/resourceGovernorDisplay"
import type { ResourceOverview, ResourceLedgerRow } from "@/lib/api"

const row = (overrides: Partial<ResourceLedgerRow>): ResourceLedgerRow => ({
  created_at: "2026-09-13T04:40:02.283Z",
  feature: "news-digest",
  tier: "T1",
  verdict: "accepted",
  tokens: 200,
  latencyMs: 412,
  model: "llama3.2:3b",
  ...overrides
})

const empty = (): ResourceOverview => ({
  ok: true,
  enabled: false,
  budgets: { t0ConfidenceThreshold: 0.6, t1MaxTokens: 500, t2BurstPerHour: 6, maxLedgerEntriesPerDay: 1000 },
  verdicts: { accepted: 0, throttled: 0, failed: 0 },
  perTier: {
    T0: { calls: 0, tokens: 0, latencyMs: 0, verdicts: { accepted: 0, throttled: 0, failed: 0 } },
    T1: { calls: 0, tokens: 0, latencyMs: 0, verdicts: { accepted: 0, throttled: 0, failed: 0 } },
    T2: { calls: 0, tokens: 0, latencyMs: 0, verdicts: { accepted: 0, throttled: 0, failed: 0 } },
    T3: { calls: 0, tokens: 0, latencyMs: 0, verdicts: { accepted: 0, throttled: 0, failed: 0 } }
  },
  burst: { hour: "2026-09-13T04", T2: { callsThisHour: 0, limitPerHour: 6 } },
  ledger: { entriesToday: 0, capped: false, days: [] },
  rows: []
})

const populated = (rows: ResourceLedgerRow[]): ResourceOverview => {
  const p = empty()
  p.enabled = true
  p.ledger.entriesToday = rows.length
  p.rows = rows
  for (const r of rows) {
    const cell = p.perTier[r.tier] ?? p.perTier.T1
    cell.calls += 1
    cell.tokens += Number(r.tokens) || 0
    cell.latencyMs += Number(r.latencyMs) || 0
    if (r.verdict === "accepted") {
      p.verdicts.accepted += 1
      cell.verdicts.accepted += 1
    } else if (r.verdict === "throttled") {
      p.verdicts.throttled += 1
      cell.verdicts.throttled += 1
    }
  }
  return p
}

describe("resource governor display (G3)", () => {
  it("empty ledger renders '—' for every verdict counter — never fabricated 0s", () => {
    const v = verdictSummary(empty())
    expect(v).toEqual({ accepted: "—", throttled: "—", failed: "—" })
  })

  it("empty ledger renders '—' across the whole budget sheet", () => {
    const rows = budgetSheet(empty())
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.calls).toBe("—")
      expect(r.tokens).toBe("—")
      expect(r.avgLatencyMs).toBe("—")
      expect(r.verdicts).toBe("—")
    }
  })

  it("verdict counters show real counts once the ledger has entries", () => {
    const v = verdictSummary(populated([row({}), row({ verdict: "throttled", degraded: true })]))
    // ledger observed → real counts, including the observed zero failures
    expect(v).toEqual({ accepted: "1", throttled: "1", failed: "0" })
  })

  it("budget sheet shows observed numbers per tier, and keeps unobserved tiers at '—'", () => {
    const p = populated([row({ tier: "T1", tokens: 200, latencyMs: 412 })])
    const rows = budgetSheet(p)
    const t1 = rows.find((r) => r.tier === "T1")
    expect(t1?.calls).toBe("1")
    expect(t1?.tokens).toBe("200")
    expect(t1?.avgLatencyMs).toBe("412") // 412ms single call
    expect(t1?.verdicts).toBe("1·0·0")
    for (const r of rows.filter((r) => r.tier !== "T1")) {
      expect(r.calls).toBe("—")
    }
  })

  it("feature burn-down groups by feature, newest server order preserved for the table", () => {
    const p = populated([
      row({ feature: "news-digest", tier: "T1", tokens: 200, verdict: "accepted" }),
      row({ feature: "news-digest", tier: "T2", tokens: 1500, verdict: "throttled", degraded: true }),
      row({ feature: "signal", tier: "T1", tokens: 80, verdict: "accepted" })
    ])
    const burns = featureBurnDown(p)
    expect(burns).toHaveLength(2)
    expect(burns[0]).toMatchObject({ feature: "news-digest", calls: 2, accepted: 1, throttled: 1, tokens: 1700 })
    expect(burns[1]).toMatchObject({ feature: "signal", calls: 1, accepted: 1 })

    const table = ledgerTable(p)
    expect(table).toHaveLength(3)
    expect(table[0].feature).toBe("news-digest")
    expect(table[0].degraded).toBe(false) // first row is the accepted call
    expect(table[1].degraded).toBe(true) // throttled-overflow row carries the marker
    expect(table[0].createdAt).toBe("04:40:02Z")
  })

  it("missing row metrics render '—', never 0", () => {
    const p = populated([row({ tokens: undefined, latencyMs: undefined, model: undefined, feature: "" })])
    const [first] = ledgerTable(p)
    expect(first.tokens).toBe("—")
    expect(first.latencyMs).toBe("—")
    expect(first.model).toBe("—")
    expect(first.feature).toBe("—")
  })

  it("banner states the truth about the enforcement flag both ways", () => {
    expect(governorBanner(empty()).enabled).toBe(false)
    expect(governorBanner(populated([])).enabled).toBe(true)
    expect(governorBanner(empty()).text).toContain("Governor OFF")
    expect(governorBanner(populated([])).text).toContain("Governor ON")
  })
})