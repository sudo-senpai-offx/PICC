import { beforeEach, describe, expect, it, vi } from "vitest"

// Wave 0 Task 3 — paperAdapter honesty: an unobservable ledger cash balance
// is null with a named reason, never a 0 that would read as "zero balance".
// Hermetic: trading.mjs (the ledger reader) is mocked at the module seam so
// no real ledger is touched; the registry + adapter are imported fresh per
// test after resetModules.

let mockCash = 10000

vi.mock("../services/trading.mjs", () => ({
  paperOverview: async () => ({ cash: mockCash })
}))

async function paperBroker() {
  vi.resetModules()
  const { getBroker } = await import("../services/brokers/index.mjs")
  await import("../services/brokers/paperAdapter.mjs")
  return getBroker("paper")
}

describe("paperAdapter null-not-zero (Wave 0 Task 3)", () => {
  beforeEach(() => {
    mockCash = 10000
  })

  it("passes observed cash through with a null reason", async () => {
    const state = await (await paperBroker()).getAccountState()
    expect(state).toMatchObject({ balance: 10000, demo: true, real: false, currency: "USD" })
    expect(state.reason).toBeNull()
  })

  it("maps unobservable cash (undefined) to null with a named reason", async () => {
    mockCash = undefined
    const state = await (await paperBroker()).getAccountState()
    expect(state.balance).toBeNull()
    expect(state.reason).toMatch(/balance-unobservable/)
  })

  it("maps NaN cash to null with a named reason", async () => {
    mockCash = NaN
    const state = await (await paperBroker()).getAccountState()
    expect(state.balance).toBeNull()
    expect(state.reason).toMatch(/balance-unobservable/)
  })

  it("keeps a genuine zero balance as 0 (observed, not absent)", async () => {
    mockCash = 0
    const state = await (await paperBroker()).getAccountState()
    expect(state.balance).toBe(0)
    expect(state.reason).toBeNull()
  })
})
