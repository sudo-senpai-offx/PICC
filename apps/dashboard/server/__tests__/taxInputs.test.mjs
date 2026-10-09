import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

// Task 4: inputs assembly — hermetic, fixture-driven. No store touches, no
// DATA_DIR redirects (pure deps injection), so no guard-inventory change.

let mod

beforeEach(async () => {
  vi.resetModules()
  mod = await import("../services/tax/inputs.mjs")
})

const ms = (iso) => new Date(iso).getTime()

const journal = () => [
  { id: "j-open", symbol: "BTC", side: "long", entryPrice: 50000, quantity: 1, entryTime: ms("2026-01-01T00:00:00Z"), status: "open", exitPrice: null, exitTime: null, tags: [] },
  { id: "j-close", symbol: "BTC", side: "long", entryPrice: 50000, quantity: 0.5, entryTime: ms("2026-01-05T00:00:00Z"), status: "closed", exitPrice: 60000, exitTime: ms("2026-02-10T00:00:00Z"), tags: [] },
  { id: "j-ob", kind: "opening-balance", symbol: "BTC", side: null, entryPrice: 48000, quantity: 0.25, entryTime: ms("2025-12-01T00:00:00Z"), status: "open", exitPrice: null, exitTime: null, tags: [] },
  // Opening balance closed via the existing close route: still acquisition-only.
  { id: "j-ob-closed", kind: "opening-balance", symbol: "BTC", side: null, entryPrice: 47000, quantity: 0.1, entryTime: ms("2025-12-15T00:00:00Z"), status: "closed", exitPrice: 60000, exitTime: ms("2026-02-11T00:00:00Z"), tags: [] },
  { id: "j-paper", symbol: "BTC", side: "long", entryPrice: 1, quantity: 5, entryTime: ms("2026-01-02T00:00:00Z"), status: "closed", exitPrice: 2, exitTime: ms("2026-02-12T00:00:00Z"), tags: ["paper"], venue: "paper" },
  { id: "j-testnet", symbol: "BTC", side: "long", entryPrice: 1, quantity: 5, entryTime: ms("2026-01-03T00:00:00Z"), status: "closed", exitPrice: 2, exitTime: ms("2026-02-13T00:00:00Z"), tags: ["testnet"], venue: "hyperliquid" },
  { id: "sw-acq", symbol: "ETH", side: "long", entryPrice: 3000, quantity: 2, entryTime: ms("2026-01-08T00:00:00Z"), status: "open", exitPrice: null, exitTime: null, tags: ["swap-1"] },
  { id: "sw-dis", symbol: "BTC", side: "long", entryPrice: 50000, quantity: 0.1, entryTime: ms("2026-01-09T00:00:00Z"), status: "closed", exitPrice: 59000, exitTime: ms("2026-02-14T00:00:00Z"), tags: ["swap-1"] },
  { id: "sw-lone", symbol: "BTC", side: "long", entryPrice: 50000, quantity: 0.1, entryTime: ms("2026-01-09T00:00:00Z"), status: "closed", exitPrice: 59000, exitTime: ms("2026-02-15T00:00:00Z"), tags: ["swap-orphan"] },
]

const baseDeps = () => ({
  journalEntries: journal(),
  liveCloses: [],
  fillCosts: [],
  transfers: [],
})

const range = { from: "2026-02-01T00:00:00Z", to: "2026-02-28T00:00:00Z" }

describe("tax inputs assembly", () => {
  it("splits journal entries into acquisitions (entry side) and disposals (closed side, exitTime in range)", async () => {
    const out = await mod.collectInputs({ ...range, deps: baseDeps() })
    const acqIds = out.acquisitions.map((a) => a.id)
    const disIds = out.disposals.map((d) => d.id)
    expect(acqIds).toEqual(expect.arrayContaining(["j-open", "j-close", "j-ob", "sw-acq"]))
    expect(disIds).toEqual(expect.arrayContaining(["j-close", "sw-dis", "sw-lone"]))
    expect(disIds).not.toContain("j-open")
    // Row shape for the Task 1 matcher.
    expect(out.acquisitions.find((a) => a.id === "j-open")).toMatchObject({
      asset: "BTC", qty: 1, price: 50000, ccy: "USD", source: "journal-entry",
    })
    expect(out.disposals.find((d) => d.id === "j-close")).toMatchObject({
      asset: "BTC", qty: 0.5, price: 60000, ccy: "USD", source: "journal-close",
    })
  })

  it("paper and testnet records are excluded with reason counts", async () => {
    const out = await mod.collectInputs({ ...range, deps: baseDeps() })
    const allIds = [...out.acquisitions.map((a) => a.id), ...out.disposals.map((d) => d.id)]
    expect(allIds).not.toContain("j-paper")
    expect(allIds).not.toContain("j-testnet")
    expect(out.excludedPaper).toBe(1)
    expect(out.excludedTestnet).toBe(1)
  })

  it("opening-balance entries surface ONLY as acquisitions, never as disposals — even when closed", async () => {
    const out = await mod.collectInputs({ ...range, deps: baseDeps() })
    expect(out.acquisitions.map((a) => a.id)).toEqual(expect.arrayContaining(["j-ob", "j-ob-closed"]))
    expect(out.acquisitions.find((a) => a.id === "j-ob")).toMatchObject({ source: "opening-balance" })
    expect(out.disposals.map((d) => d.id)).not.toContain("j-ob")
    expect(out.disposals.map((d) => d.id)).not.toContain("j-ob-closed")
  })

  it("live closes become disposals with fee fields linked by close id", async () => {
    const out = await mod.collectInputs({
      ...range,
      deps: {
        ...baseDeps(),
        liveCloses: [
          { id: "live-1", symbol: "BTC", size: 0.2, exitPrice: 61000, closedAt: "2026-02-15T00:00:00Z", fee: 3, venue: "coinbase" },
          { id: "live-paper", symbol: "BTC", size: 1, exitPrice: 61000, closedAt: "2026-02-16T00:00:00Z", fee: 1, venue: "paper" },
        ],
      },
    })
    const live = out.disposals.find((d) => d.id === "live-1")
    expect(live).toMatchObject({ asset: "BTC", qty: 0.2, price: 61000, source: "live-close" })
    expect(out.costs.find((c) => c.closeId === "live-1")).toMatchObject({ feeUsd: 3, kind: "fee" })
    expect(out.disposals.map((d) => d.id)).not.toContain("live-paper")
    expect(out.excludedPaper).toBe(2) // journal paper + live paper
  })

  it("costs fills link by close/fill id; paper/testnet fills excluded", async () => {
    const out = await mod.collectInputs({
      ...range,
      deps: {
        ...baseDeps(),
        fillCosts: [
          { id: "c1", closeId: "j-close", amountUsd: 5, kind: "fee", venue: "coinbase" },
          { id: "c2", fillId: "j-open", amountUsd: 2, kind: "fee", venue: "coinbase" },
          { id: "c3", amountUsd: 9, kind: "fee", venue: "paper" },
          { id: "c4", amountUsd: 9, kind: "fee", venue: "hyperliquid" },
        ],
      },
    })
    expect(out.costs.find((c) => c.closeId === "j-close")).toMatchObject({ feeUsd: 5 })
    expect(out.costs.find((c) => c.fillId === "j-open")).toMatchObject({ feeUsd: 2 })
    expect(out.costs.some((c) => c.fillId === "c3" || c.closeId === "c3")).toBe(false)
    expect(out.excludedPaper).toBe(2) // journal paper + paper fill
    expect(out.excludedTestnet).toBe(2) // journal testnet + hyperliquid fill
  })

  it("swap halves pair by shared tag; unpaired halves keep the tag (matcher flags, assembly never drops)", async () => {
    const out = await mod.collectInputs({ ...range, deps: baseDeps() })
    expect(out.acquisitions.find((a) => a.id === "sw-acq").swapTag).toBe("swap-1")
    expect(out.disposals.find((d) => d.id === "sw-dis").swapTag).toBe("swap-1")
    expect(out.disposals.find((d) => d.id === "sw-lone").swapTag).toBe("swap-orphan")
  })

  it("disposals honor exitTime range; acquisitions carry full basis history unfiltered", async () => {
    const out = await mod.collectInputs({
      from: "2026-02-14T00:00:00Z",
      to: "2026-02-14T23:59:59Z",
      deps: baseDeps(),
    })
    expect(out.disposals.map((d) => d.id)).toEqual(["sw-dis"])
    expect(out.acquisitions.map((a) => a.id)).toEqual(expect.arrayContaining(["j-open", "j-ob"]))
  })

  it("wealth transfers map to self-transfer flags; rows stay listed", async () => {
    const out = await mod.collectInputs({
      ...range,
      deps: { ...baseDeps(), transfers: [{ ccy: "BTC", amount: 0.5, at: "2026-02-10T00:00:00Z" }] },
    })
    expect(out.selfTransfers).toEqual([{ asset: "BTC", qty: 0.5, at: "2026-02-10T00:00:00.000Z" }])
  })

  it("default read path is read-only: no live write or paper-history calls", async () => {
    const src = readFileSync(new URL("../services/tax/inputs.mjs", import.meta.url), "utf-8")
    for (const call of ["recordClose(", "recordReduction(", "trackOpen(", "paperHistory("]) {
      expect(src).not.toContain(call)
    }
  })

  it("hyperliquid venue follows the rail posture: testnet posture excludes with count", async () => {
    const hl = { id: "j-hl", symbol: "BTC", side: "long", entryPrice: 50000, quantity: 0.4, entryTime: ms("2026-01-04T00:00:00Z"), status: "closed", exitPrice: 60000, exitTime: ms("2026-02-11T00:00:00Z"), tags: [], venue: "hyperliquid" }
    const out = await mod.collectInputs({ ...range, deps: { ...baseDeps(), journalEntries: [...journal(), hl], perpsPosture: "testnet" } })
    const allIds = [...out.acquisitions.map((a) => a.id), ...out.disposals.map((d) => d.id)]
    expect(allIds).not.toContain("j-hl")
    expect(out.excludedTestnet).toBe(2) // fixture testnet + hyperliquid
  })

  it("simulated mainnet posture includes hyperliquid records as live", async () => {
    const hl = { id: "j-hl", symbol: "BTC", side: "long", entryPrice: 50000, quantity: 0.4, entryTime: ms("2026-01-04T00:00:00Z"), status: "closed", exitPrice: 60000, exitTime: ms("2026-02-11T00:00:00Z"), tags: [], venue: "hyperliquid" }
    const out = await mod.collectInputs({
      ...range,
      deps: {
        journalEntries: [hl],
        liveCloses: [],
        fillCosts: [{ id: "c-hl", closeId: "j-hl", amountUsd: 4, kind: "fee", venue: "hyperliquid" }],
        transfers: [],
        perpsPosture: "mainnet",
      },
    })
    expect(out.acquisitions.map((a) => a.id)).toContain("j-hl")
    expect(out.disposals.map((d) => d.id)).toContain("j-hl")
    expect(out.costs.find((c) => c.closeId === "j-hl")).toMatchObject({ feeUsd: 4 })
    expect(out.excludedTestnet).toBe(0)
    expect(out.excludedPaper).toBe(0)
  })
})

describe("resolvePerpsPosture", () => {
  it("sandbox env pins testnet posture", async () => {
    await expect(mod.resolvePerpsPosture({ env: { PICC_CCXT_SANDBOX_HYPERLIQUID: "1" } })).resolves.toBe("testnet")
    await expect(mod.resolvePerpsPosture({ env: { PICC_CCXT_SANDBOX: "1" } })).resolves.toBe("testnet")
  })

  it("no flags means rail-off (nothing live could have executed)", async () => {
    await expect(mod.resolvePerpsPosture({ env: {} })).resolves.toBe("rail-off")
  })

  it("mainnet request plus ceremony unlock resolves mainnet", async () => {
    await expect(
      mod.resolvePerpsPosture({ env: { PICC_CCXT_PERPS_MAINNET_ENABLED: "1" }, ceremonyUnlock: true }),
    ).resolves.toBe("mainnet")
  })

  it("mainnet request without the unlock stays rail-off", async () => {
    await expect(
      mod.resolvePerpsPosture({ env: { PICC_CCXT_PERPS_MAINNET_ENABLED: "1" }, ceremonyUnlock: false }),
    ).resolves.toBe("rail-off")
  })
})
