// WS-3 T6 — ceremonyVenueUnlock.test.mjs (AC-6): the additive mainnet branch of
// hyperliquidPerps.mjs:modeOf (R8.1). An unlock is SIMULATED by writing a fixture
// ceremony-state.json, never a real ceremony flip (never unlockVenueClass); the
// refusal strings are asserted byte-identical and UNHEALTHY/absent stores read
// LOCKED. Proceed tests use a fixture ccxt library via the ordering seam — CI
// never talks to a live venue.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const RAIL_OFF_EXACT =
  "perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)"
const RAIL_OFF_TESTNET_ONLY =
  "perps-rail-off: WS-1 is testnet-only — sandbox mode was not requested (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1); PICC_CCXT_PERPS_MAINNET_ENABLED alone is insufficient until the WS-3 ceremony"

const HYPERLIQUID_KEYS = {
  PICC_CCXT_WALLETADDRESS_HYPERLIQUID: "0x1111111111111111111111111111111111111111",
  PICC_CCXT_PRIVATEKEY_HYPERLIQUID: "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
}

const UNLOCKED_PERPS = {
  "hyperliquid-perps": { unlocked: true, at: "2026-09-23T00:00:00.000Z", by: "test-fixture" }
}

function fixtureStore(enablement) {
  return JSON.stringify(
    {
      version: 1,
      classes: {},
      enablement,
      platformVerification: { expertoption: null },
      assetClasses: {}
    },
    null,
    2
  )
}

function makeExchange() {
  const calls = { loadMarkets: 0, setSandboxMode: 0 }
  const exchange = {
    id: "hyperliquid",
    calls,
    sandbox: false,
    setSandboxMode(v) {
      calls.setSandboxMode++
      exchange.sandbox = v
    },
    async loadMarkets() {
      calls.loadMarkets++
      return {
        "BTC/USDT:USDT": {
          symbol: "BTC/USDT:USDT",
          base: "BTC",
          quote: "USDT",
          type: "swap",
          active: true,
          limits: { amount: { min: 0.001 }, cost: { min: 5 } },
          info: { fundingIntervalMillis: 3_600_000 }
        }
      }
    }
  }
  return exchange
}

function libFor(ex) {
  return {
    hyperliquid: function Ctor() {
      return Object.create(ex)
    }
  }
}

let dir

beforeEach(() => {
  vi.resetModules()
  dir = mkdtempSync(join(tmpdir(), "picc-ceremony-venue-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  Object.assign(process.env, HYPERLIQUID_KEYS)
})

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("PICC_")) delete process.env[k]
  }
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

async function freshAdapter(seamFixture = false) {
  let ex = null
  if (seamFixture) {
    const seam = await import("../services/ccxtOrdering.mjs")
    seam._resetCcxtOrderingState()
    ex = makeExchange()
    seam._setCcxtLibForTests(libFor(ex))
  }
  const { hyperliquidPerps } = await import("../services/venues/hyperliquidPerps.mjs")
  return { adapter: hyperliquidPerps, ex }
}

describe("WS-3 ceremony venue unlock — hyperliquidPerps.mjs:modeOf additive mainnet branch", () => {
  it("env REQUEST alone with a LOCKED store ⇒ EXACT RAIL_OFF_TESTNET_ONLY (byte-identical)", async () => {
    writeFileSync(join(dir, "ceremony-state.json"), fixtureStore({ "hyperliquid-perps": null }))
    process.env.PICC_CCXT_PERPS_MAINNET_ENABLED = "1"
    const { adapter } = await freshAdapter()
    const res = await adapter.markets()
    expect(res).toEqual({ ok: false, reason: RAIL_OFF_TESTNET_ONLY })
  })

  it("env REQUEST alone with an ABSENT store record ⇒ reads LOCKED — same exact string, never a throw", async () => {
    process.env.PICC_CCXT_PERPS_MAINNET_ENABLED = "1"
    const { adapter } = await freshAdapter()
    const res = await adapter.markets()
    expect(res).toEqual({ ok: false, reason: RAIL_OFF_TESTNET_ONLY })
  })

  it("env absent (no request) ⇒ EXACT RAIL_OFF_EXACT — current behavior unchanged even with a store unlock", async () => {
    writeFileSync(join(dir, "ceremony-state.json"), fixtureStore(UNLOCKED_PERPS))
    const { adapter } = await freshAdapter()
    const res = await adapter.markets()
    expect(res).toEqual({ ok: false, reason: RAIL_OFF_EXACT })
  })

  it("env REQUEST + fixture store unlocked ⇒ mainnet proceeds AND the constructed instance honors the resolved mode (sandbox OFF)", async () => {
    writeFileSync(join(dir, "ceremony-state.json"), fixtureStore(UNLOCKED_PERPS))
    process.env.PICC_CCXT_PERPS_MAINNET_ENABLED = "1"
    const { adapter, ex } = await freshAdapter(true)
    const rows = await adapter.markets()
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].type).toBe("swap")
    expect(ex.calls.loadMarkets).toBe(1)
    // the swap instance targets mainnet: sandbox resolution off — no setSandboxMode(true)
    expect(ex.calls.setSandboxMode).toBe(0)
    expect(ex.sandbox).toBe(false)
  })

  it("sandbox flag present wins over BOTH env REQUEST and the store unlock (sandbox instance resolved)", async () => {
    writeFileSync(join(dir, "ceremony-state.json"), fixtureStore(UNLOCKED_PERPS))
    process.env.PICC_CCXT_PERPS_MAINNET_ENABLED = "1"
    process.env.PICC_CCXT_SANDBOX = "1"
    const { adapter, ex } = await freshAdapter(true)
    const rows = await adapter.markets()
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
    expect(ex.calls.setSandboxMode).toBe(1)
    expect(ex.sandbox).toBe(true)
  })

  it("UNHEALTHY store (unreadable fixture) ⇒ env REQUEST reads LOCKED — EXACT RAIL_OFF_TESTNET_ONLY", async () => {
    writeFileSync(join(dir, "ceremony-state.json"), "{not-json")
    process.env.PICC_CCXT_PERPS_MAINNET_ENABLED = "1"
    const { adapter } = await freshAdapter()
    const res = await adapter.markets()
    expect(res).toEqual({ ok: false, reason: RAIL_OFF_TESTNET_ONLY })
  })
})