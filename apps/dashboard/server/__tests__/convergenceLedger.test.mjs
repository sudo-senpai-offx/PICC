import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CONV_HORIZON_MS,
  CONV_MAX_PENDING_MS
} from "../services/convergenceLedger.mjs"
import {
  recordConvergence,
  flushConvergence,
  convergenceLedgerStats,
  convergenceLedgerHistory,
  resetConvergenceLedger,
  directionOfState
} from "../services/convergenceLedger.mjs"

// 9a acceptance (R12): record synthetic convergence decisions (state emitted at
// decision time + preset ladder), flush against deterministic exit prices, and
// assert the state × preset win-rate / realized-EV buckets EXACTLY equal the
// hand-computed values below. resolveResult/exitPriceFor come from the accuracy
// ledger so hits mean the same thing in both ledgers.

const T0 = 1_000_000_000_000 // fixed epoch for reproducibility

vi.mock("../services/brokers/index.mjs", () => ({
  getBrokerData: () => ({
    assets: [
      { id: "EURUSD", name: "EURUSD", periods: { 60: [{ close: 1.1 }] } },
      { id: "GBPUSD", name: "GBPUSD", periods: { 60: [{ close: 1.3 }] } },
      { id: "BTCUSD", name: "BTCUSD", periods: { 60: [{ close: 60100 }] } },
      { id: "GOLD", name: "GOLD", periods: { 60: [{ close: 2000 }] } }
    ]
  })
}))

beforeEach(() => resetConvergenceLedger())
afterEach(() => resetConvergenceLedger())

describe("convergence outcome ledger (9a)", () => {
  it("records directional states only and rejects state duplication (guard)", () => {
    const a = recordConvergence({ assetId: "EURUSD", asset: "EURUSD", state: "LONG BIAS", preset: "intraday", score5: 5, confidence: 90 })
    expect(a).not.toBeNull()
    expect(a.direction).toBe("up")
    // Same state × preset still pending -> NOT a new decision.
    expect(recordConvergence({ assetId: "EURUSD", state: "LONG BIAS", preset: "intraday", score5: 5 })).toBeNull()
    // A DIFFERENT state for the same asset is a new decision.
    expect(recordConvergence({ assetId: "EURUSD", state: "SHORT BIAS", preset: "intraday" })).not.toBeNull()
    // The same state under a different preset is also new.
    expect(recordConvergence({ assetId: "EURUSD", asset: "EURUSD", state: "LONG BIAS", preset: "position" })).not.toBeNull()
    // Undirected states are not price calls -> never recorded.
    expect(recordConvergence({ assetId: "EURUSD", state: "WAIT" })).toBeNull()
    expect(recordConvergence({ assetId: "EURUSD", state: "NO TRADE" })).toBeNull()
    expect(recordConvergence({ assetId: "EURUSD", state: "WATCH" })).toBeNull()
    // Sampled entry price at decision time (live 60s buffer, best-effort).
    const hist = convergenceLedgerHistory() // newest first
    const last = hist[0] // EURUSD LONG BIAS × position
    expect(last.entryPrice).toBe(1.1)
    expect(last.score5).toBe(null) // not supplied on the guard-test records
    expect(last.preset).toBe("position")
    expect(directionOfState("SHORT ONLY")).toBe("down")
    expect(directionOfState("WAIT")).toBeNull()
  })

  it("hand-computed state × preset win-rate + realized-EV buckets match exactly", () => {
    // entry price sourced from the mocked 60s buffer (above).
    const exits = {}
    const rec = (state, assetId, preset, exit, opts = {}) => {
      const e = recordConvergence({ assetId, asset: assetId, state, preset, score5: opts.score5, payoutPct: opts.payoutPct }, T0)
      exits[e.id] = exit
      return e
    }

    rec("LONG BIAS", "EURUSD", "intraday", 1.105, { score5: 5, payoutPct: 85 })   // up  @1.10 -> hit
    rec("SHORT ONLY", "EURUSD", "swing", 1.095, { score5: 4 })                    // down @1.10 -> hit
    rec("LONG WATCH", "EURUSD", "intraday", 1.1003, { score5: 3, payoutPct: 85 }) // up  @1.10 -> hit (moved 0.00027)
    rec("LONG BIAS", "GBPUSD", "position", 1.295, { score5: 5 })                  // up  @1.30 -> MISS (went down)
    rec("SHORT WATCH", "BTCUSD", "intraday", 60050, {})                           // down @60100 -> hit
    rec("SHORT BIAS", "BTCUSD", "intraday", 60000, { score5: 4, payoutPct: 85 })  // down @60100 -> hit
    rec("LONG ONLY", "GOLD", "swing", 1999.5, { score5: 4 })                      // up  @2000 -> MISS (moved 0.00025)
    rec("LONG BIAS", "EURUSD", "position", 1.106, { score5: 5 })                  // up  @1.10 -> hit

    const resolved = flushConvergence({ now: T0 + CONV_HORIZON_MS + 60_000, resolve: (e) => exits[e.id] })
    expect(resolved.length).toBe(8)

    const s = convergenceLedgerStats()
    // Totals: 6 hits, 2 misses, 0 pushes -> hit-rate 0.75.
    // EV (per unit staked): hits with payoutPct 85 contribute 0.85, others 1.0,
    // misses -1 -> (0.85+1+0.85+1+1+0.85 +(-1) +(-1)) / 8 = 3.55/8.
    expect(s.decided).toBe(8)
    expect(s.hits).toBe(6)
    expect(s.misses).toBe(2)
    expect(s.pushes).toBe(0)
    expect(s.hitRate).toBeCloseTo(0.75, 10)
    expect(s.realizedEv).toBeCloseTo(3.55 / 8, 10)

    // Per-state buckets.
    const lb = s.byState["LONG BIAS"]
    expect(lb).toMatchObject({ n: 3, hits: 2, misses: 1 })
    expect(lb.hitRate).toBeCloseTo(2 / 3, 10)
    expect(lb.realizedEv).toBeCloseTo((0.85 + 1 - 1) / 3, 10) // hits 1, 8 ; miss 4
    expect(s.byState["SHORT ONLY"]).toMatchObject({ n: 1, hits: 1, hitRate: 1, realizedEv: 1 })
    expect(s.byState["LONG WATCH"]).toMatchObject({ n: 1, hits: 1, hitRate: 1, realizedEv: 0.85 })
    expect(s.byState["SHORT WATCH"]).toMatchObject({ n: 1, hits: 1, hitRate: 1, realizedEv: 1 })
    expect(s.byState["SHORT BIAS"]).toMatchObject({ n: 1, hits: 1, hitRate: 1, realizedEv: 0.85 })
    expect(s.byState["LONG ONLY"]).toMatchObject({ n: 1, hits: 0, misses: 1, hitRate: 0, realizedEv: -1 })

    // Per-preset buckets.
    const intraday = s.byPreset["intraday"]
    expect(intraday).toMatchObject({ n: 4, hits: 4, misses: 0 })
    expect(intraday.hitRate).toBe(1)
    expect(intraday.realizedEv).toBeCloseTo((0.85 + 0.85 + 1 + 0.85) / 4, 10)
    const swing = s.byPreset["swing"]
    expect(swing).toMatchObject({ n: 2, hits: 1, misses: 1, hitRate: 0.5, realizedEv: 0 })
    const position = s.byPreset["position"]
    expect(position).toMatchObject({ n: 2, hits: 1, misses: 1, hitRate: 0.5, realizedEv: 0 })

    // State × preset composite buckets.
    const lbIntraday = s.byStatePreset["LONG BIAS × intraday"]
    expect(lbIntraday).toMatchObject({ n: 1, hits: 1, hitRate: 1, realizedEv: 0.85 })
    const lbPosition = s.byStatePreset["LONG BIAS × position"]
    expect(lbPosition).toMatchObject({ n: 2, hits: 1, misses: 1, hitRate: 0.5, realizedEv: 0 })
    expect(s.byStatePreset["LONG ONLY × swing"]).toMatchObject({ n: 1, hits: 0, misses: 1, hitRate: 0, realizedEv: -1 })
  })

  it("pushes are counted but never hit/miss; no exit data resolves to UNRESOLVED, never guessed", () => {
    const e1 = recordConvergence({ assetId: "EURUSD", state: "LONG BIAS", preset: "intraday" }, T0)
    // Moved 1.10005-1.1 = 0.00005/1.1 ~= 4.5e-5 < PUSH_TOL 0.0002 -> push.
    flushConvergence({ now: T0 + CONV_HORIZON_MS + 60_000, resolve: () => 1.10005 })
    let s = convergenceLedgerStats()
    expect(e1.status).toBe("resolved")
    expect(e1.result).toBe("push")
    expect(s.pushes).toBe(1)
    expect(s.hits).toBe(0)
    expect(s.misses).toBe(0)
    expect(s.hitRate).toBe(null) // decided but no hit/miss -> rate is undefined, not 0
    expect(s.realizedEv).toBe(0) // push is a round trip

    // No exit price at/after horizon -> stays pending (never resolved as a win/loss).
    const e2 = recordConvergence({ assetId: "GBPUSD", state: "SHORT ONLY", preset: "swing" }, T0)
    flushConvergence({ now: T0 + CONV_HORIZON_MS + 60_000, resolve: () => null })
    s = convergenceLedgerStats()
    expect(e2.status).toBe("pending")
    expect(s.pending).toBe(1)
    // Past the staleness cap with still no data -> UNRESOLVED (honest), still not bucketed.
    flushConvergence({ now: T0 + CONV_MAX_PENDING_MS + 1000, resolve: () => null })
    s = convergenceLedgerStats()
    expect(e2.status).toBe("unresolved")
    expect(s.unresolved).toBe(1)
    expect(s.decided).toBe(1) // only the push
    expect(s.hitRate).toBe(null)
  })
})