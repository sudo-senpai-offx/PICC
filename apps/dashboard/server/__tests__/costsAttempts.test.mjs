// Task 4: failed-attempt counter — seam instrumentation probe.
//
// Refusal through the seam (mocked keys-absent / rail-off) increments the day
// counter; gated happy paths (existing ccxtOrdering + perps suites) unchanged.
// Counter module is import-only state (no store dir); the seam edits are one
// countAttempt line per existing refusal return with messages/shapes untouched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const RAIL_OFF_EXACT =
  "perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)"

describe("costs attempts", () => {
  let dir
  let attempts
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-costs-attempts-"))
    process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
    vi.resetModules()
    attempts = await import("../services/costs/attempts.mjs")
    attempts._resetAttemptsForTest()
  })
  afterEach(() => {
    attempts._resetAttemptsForTest()
    delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("PICC_CCXT_")) delete process.env[k]
    }
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("counts refused and failed outcomes separately per venue", () => {
    expect(attempts.countAttempt({ venue: "binance", outcome: "refused", reason: "r1" }).ok).toBe(true)
    attempts.countAttempt({ venue: "binance", outcome: "failed", reason: "r2" })
    expect(attempts.attemptCounts().binance).toMatchObject({ refused: 1, failed: 1 })
  })

  it("rejects unknown outcomes without counting", () => {
    const r = attempts.countAttempt({ venue: "binance", outcome: "maybe", reason: "x" })
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe("string")
    expect(attempts.attemptCounts()).toEqual({})
  })

  it("a keys-absent cancel refusal increments the day counter with the pinned message", async () => {
    const seam = await import("../services/ccxtOrdering.mjs")
    seam._resetCcxtOrderingState()
    const res = await seam.cancelCcxtOrder({ exchange: "binance", symbol: "BTCUSDT", orderId: "o-1" })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/no BINANCE credentials configured/)
    expect(attempts.attemptCounts().binance).toMatchObject({ refused: 1 })
  })

  it("a perps submit rail-off refusal increments hyperliquid with the exact reason", async () => {
    const adapter = (await import("../services/venues/hyperliquidPerps.mjs")).hyperliquidPerps
    const res = await adapter.submitOrder({
      symbol: "DOGE/USDT:USDT",
      side: "buy",
      amount: 1,
      price: 0.2,
      leverage: 4,
      marginMode: "isolated"
    })
    expect(res).toEqual({ ok: false, reason: RAIL_OFF_EXACT })
    expect(attempts.attemptCounts().hyperliquid).toMatchObject({ refused: 1 })
  })
})
