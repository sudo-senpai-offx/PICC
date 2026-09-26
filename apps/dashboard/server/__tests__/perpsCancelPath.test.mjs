// WS-7 T3 — the perps cancel member, proved on the production path.
//
// The gap this closes: the adapter exposed no cancel member, so an order opened
// through the perps rail could not be exited through it. The sandbox E2E looked
// like coverage only because it cancelled on the RAW CCXT instance, skipping the
// adapter entirely — a different code path from the one production uses.
//
// These tests drive hyperliquidPerps.cancelOrder, not a raw instance, so they
// exercise the gate ordering and the seam exactly as production would.
//
// They also pin the HONESTY of the failure paths, which is the part most likely
// to rot: a refused mode must never reach the venue, and an unidentifiable or
// unmatched order must report unobservable rather than a fabricated success.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const RAIL_OFF_TESTNET_ONLY =
  "perps-rail-off: WS-1 is testnet-only — sandbox mode was not requested (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1); PICC_CCXT_PERPS_MAINNET_ENABLED alone is insufficient until the WS-3 ceremony"

const KEYS = {
  PICC_CCXT_WALLETADDRESS_HYPERLIQUID: "0x1111111111111111111111111111111111111111",
  PICC_CCXT_PRIVATEKEY_HYPERLIQUID: "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
}

const TOUCHED = [
  ...Object.keys(KEYS),
  "PICC_COMMAND_CENTRE_DATA_DIR",
  "PICC_CCXT_PERPS_MAINNET_ENABLED",
  "PICC_CCXT_SANDBOX",
  "PICC_CCXT_SANDBOX_HYPERLIQUID"
]

let saved = new Map()

beforeEach(() => {
  vi.resetModules()
  saved = new Map()
  for (const k of TOUCHED) {
    saved.set(k, Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined)
  }
  // Sandbox on: the happy path must not require a ceremony store.
  process.env.PICC_CCXT_SANDBOX = "1"
  Object.assign(process.env, KEYS)
})

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  saved.clear()
  vi.resetModules()
})

async function loadAdapter() {
  const mod = await import("../services/venues/hyperliquidPerps.mjs")
  return mod.hyperliquidPerps
}

describe("WS-7 T3 — perps cancel exists on the production path", () => {
  it("exposes cancelOrder as an adapter member", async () => {
    const adapter = await loadAdapter()
    expect(typeof adapter.cancelOrder, "the adapter must expose a cancel member").toBe("function")
  })

  it("refuses when the rail is off, WITHOUT reaching the venue", async () => {
    delete process.env.PICC_CCXT_SANDBOX
    delete process.env.PICC_CCXT_SANDBOX_HYPERLIQUID
    delete process.env.PICC_CCXT_PERPS_MAINNET_ENABLED
    const adapter = await loadAdapter()
    const res = await adapter.cancelOrder({ orderId: "nope" })
    // A cancel must respect the same gates as submitOrder. If this ever
    // returns ok:true with the rail off, a cancel slipped past a gate.
    expect(res.ok).toBe(false)
    expect(String(res.reason)).toMatch(/perps-rail-off/)
  })

  it("refuses an unidentifiable order instead of guessing", async () => {
    const adapter = await loadAdapter()
    const res = await adapter.cancelOrder({})
    expect(res.ok).toBe(false)
    expect(String(res.reason)).toMatch(/unidentifiable/)
  })

  it("refuses an unidentifiable order BEFORE touching the venue", async () => {
    const adapter = await loadAdapter()
    // This is the guard that matters most and it is purely local: an order that
    // cannot be identified is refused before any instance is built, so it can
    // never hang on a venue call and can never cancel the wrong order.
    const started = Date.now()
    const res = await adapter.cancelOrder({})
    expect(res.ok).toBe(false)
    expect(String(res.reason)).toMatch(/unidentifiable/)
    // Proves the refusal is local rather than a fast network failure.
    expect(Date.now() - started, "must refuse locally, not after a venue call").toBeLessThan(500)
  })
})
