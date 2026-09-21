import { beforeEach, describe, expect, it, vi } from "vitest"
import { validateVenueAdapter } from "../services/venues/venueAdapterContract.mjs"

export const venueFixtureAdapter = {
  id: "hyperliquid",
  label: "Hyperliquid perps (testnet)",
  markets: async () => [
    { symbol: "BTC/USDC:USDC", base: "BTC", quote: "USDC", type: "swap", minAmount: 0.001, minNotional: 5, isActive: true, fundingTickMs: 3_600_000 }
  ],
  submitOrder: async ({ symbol, side, amount, price, leverage, marginMode, reduceOnly, clientOrderId }) => ({
    ok: true,
    order: {
      id: "o-fixture-1",
      clientOrderId: clientOrderId ?? null,
      symbol,
      side,
      type: "limit",
      amount,
      price,
      status: "new",
      at: new Date().toISOString(),
      marginUsd: (amount * price) / leverage,
      leverage,
      marginMode,
      reduceOnly: Boolean(reduceOnly)
    }
  }),
  verifyFill: async ({ orderId }) =>
    orderId ? { ok: true, fill: { id: orderId, symbol: "BTC/USDC:USDC", side: "buy", filled: 0.001, average: 60_000, fee: null, status: "closed", at: new Date().toISOString() } } : null,
  observeEquity: async () => ({ ok: true, equityUsd: 1_234.56, currency: "USDC", at: new Date().toISOString() }),
  positionView: async () => [],
  observeFunding: async ({ symbol }) => ({ ok: true, rate: 0.0001, fundingIntervalHrs: 1, at: new Date().toISOString(), symbol }),
  riskModel: {
    leverageBandMin: 3,
    leverageBandMax: 5,
    marginPerPositionCapUsd: 10,
    isolatedOnly: true,
    maxOpenPositions: 1,
    fundingStaleMs: 7_200_000,
    testnetOnly: true
  }
}

const CONTRACT_MEMBERS = [
  "id",
  "label",
  "markets",
  "submitOrder",
  "verifyFill",
  "observeEquity",
  "positionView",
  "observeFunding",
  "riskModel"
]

function adapterWithout(adapter, ...members) {
  const removed = new Set(members)
  return Object.fromEntries(Object.entries(adapter).filter(([key]) => !removed.has(key)))
}

function missingNames(errors) {
  return errors.map((e) => (String(e.message).match(/"([^"]+)"/) ?? [])[1])
}

describe("venueAdapterContract — validateVenueAdapter", () => {
  it("accepts the full conforming fixture adapter", () => {
    expect(validateVenueAdapter(venueFixtureAdapter)).toEqual({ ok: true, errors: [] })
  })

  it.each(CONTRACT_MEMBERS)("rejects an adapter missing %s and names it in errors", (member) => {
    const result = validateVenueAdapter(adapterWithout(venueFixtureAdapter, member))
    expect(result.ok).toBe(false)
    expect(missingNames(result.errors)).toContain(member)
  })

  it("collects EVERY missing member at once — collect-all, not first-failure", () => {
    const result = validateVenueAdapter(adapterWithout(venueFixtureAdapter, "markets", "submitOrder", "riskModel"))
    expect(result.ok).toBe(false)
    expect(missingNames(result.errors)).toEqual(expect.arrayContaining(["markets", "submitOrder", "riskModel"]))
  })

  it("rejects a non-object adapter (null, missing, array, bare string)", () => {
    expect(validateVenueAdapter(null)).toEqual({ ok: false, errors: expect.any(Array) })
    expect(validateVenueAdapter(undefined).ok).toBe(false)
    expect(validateVenueAdapter([]).ok).toBe(false)
    expect(validateVenueAdapter("hyperliquid").ok).toBe(false)
  })

  it("rejects members of the wrong kind and names the member", () => {
    expect(validateVenueAdapter({ ...venueFixtureAdapter, submitOrder: "not a function" }).ok).toBe(false)
    expect(missingNames(validateVenueAdapter({ ...venueFixtureAdapter, submitOrder: 42 }).errors)).toContain("submitOrder")
    expect(missingNames(validateVenueAdapter({ ...venueFixtureAdapter, riskModel: [] }).errors)).toContain("riskModel")
    expect(missingNames(validateVenueAdapter({ ...venueFixtureAdapter, id: "" }).errors)).toContain("id")
    expect(missingNames(validateVenueAdapter({ ...venueFixtureAdapter, id: 42 }).errors)).toContain("id")
  })
})

describe("venueAdapterContract — registry", () => {
  let mod
  beforeEach(async () => {
    vi.resetModules()
    mod = await import("../services/venues/venueAdapterContract.mjs")
  })

  it("registerVenueAdapter accepts a conforming fixture adapter and venueAdapterFor returns it", () => {
    expect(() => mod.registerVenueAdapter(venueFixtureAdapter)).not.toThrow()
    expect(mod.venueAdapterFor("hyperliquid")).toBe(venueFixtureAdapter)
  })

  it("registerVenueAdapter throws on a duplicate id", () => {
    mod.registerVenueAdapter(venueFixtureAdapter)
    expect(() => mod.registerVenueAdapter({ ...venueFixtureAdapter, label: "Duplicate label" })).toThrow(/already registered/)
  })

  it("registerVenueAdapter throws when the adapter fails contract validation, naming the member", () => {
    expect(() => mod.registerVenueAdapter(adapterWithout(venueFixtureAdapter, "observeFunding"))).toThrow(/observeFunding/)
  })

  it("venueAdapterFor returns honest null for an unknown venue id — never a fabricated adapter", () => {
    expect(mod.venueAdapterFor("unknown")).toBeNull()
    expect(mod.venueAdapterFor("iqoption")).toBeNull()
    expect(mod.venueAdapterFor("")).toBeNull()
  })

  it("venueAdapterIds returns sorted ids regardless of registration order", () => {
    mod.registerVenueAdapter(venueFixtureAdapter)
    mod.registerVenueAdapter({ ...adapterWithout(venueFixtureAdapter, "id", "label"), id: "iqoption", label: "IQOption perps" })
    mod.registerVenueAdapter({ ...adapterWithout(venueFixtureAdapter, "id", "label"), id: "expertoption", label: "ExpertOption perps" })
    expect(mod.venueAdapterIds()).toEqual(["expertoption", "hyperliquid", "iqoption"])
  })
})