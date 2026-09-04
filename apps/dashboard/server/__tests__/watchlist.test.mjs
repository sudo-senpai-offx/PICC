import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let dir = null
let mod = null

async function boot() {
  dir = await mkdtemp(join(tmpdir(), "picc-watchlist-"))
  process.env.PICC_WATCHLIST_DATA_DIR = dir
  vi.resetModules()
  mod = await import("../services/watchlist.mjs")
}

beforeEach(async () => {
  await boot()
})

afterEach(async () => {
  delete process.env.PICC_WATCHLIST_DATA_DIR
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe("watchlist CRUD (slice 5d coverage)", () => {
  test("create → list → get round trip with normalized symbols", () => {
    const wl = mod.createWatchlist({ name: "Crypto", symbols: ["btc-usd", "ETHUSD"] })
    expect(wl.id).toBeTruthy()
    expect(wl.symbols).toEqual(["BTC-USD", "ETHUSD"])
    expect(mod.listWatchlists()).toHaveLength(1)
    expect(mod.getWatchlist(wl.id).name).toBe("Crypto")
  })

  test("update renames and replaces symbols", () => {
    const wl = mod.createWatchlist({ name: "A", symbols: ["BTCUSD"] })
    const updated = mod.updateWatchlist(wl.id, { name: "B", symbols: ["ethusd"] })
    expect(updated.symbols).toEqual(["ETHUSD"])
    expect(mod.getWatchlist(wl.id).name).toBe("B")
    expect(mod.updateWatchlist("missing", { name: "X" })).toBeNull()
  })

  test("addToWatchlist dedupes; removeFromWatchlist filters", () => {
    const wl = mod.createWatchlist({ name: "A", symbols: ["BTCUSD"] })
    mod.addToWatchlist(wl.id, "btcusd") // duplicate → ignored
    mod.addToWatchlist(wl.id, "GOLD")
    expect(mod.getWatchlist(wl.id).symbols).toEqual(["BTCUSD", "GOLD"])
    mod.removeFromWatchlist(wl.id, "BTCUSD")
    expect(mod.getWatchlist(wl.id).symbols).toEqual(["GOLD"])
    expect(mod.addToWatchlist("missing", "X")).toBeNull()
  })

  test("delete removes the watchlist and reports false when absent", () => {
    const wl = mod.createWatchlist({ name: "A" })
    expect(mod.deleteWatchlist(wl.id)).toBe(true)
    expect(mod.listWatchlists()).toHaveLength(0)
    expect(mod.deleteWatchlist(wl.id)).toBe(false)
  })

  test("state persists to the data dir across reboots", async () => {
    const wl = mod.createWatchlist({ name: "Persist", symbols: ["AAPL"] })
    const keepDir = dir
    delete process.env.PICC_WATCHLIST_DATA_DIR
    vi.resetModules()
    process.env.PICC_WATCHLIST_DATA_DIR = keepDir
    const mod2 = await import("../services/watchlist.mjs")
    const reloaded = mod2.getWatchlist(wl.id)
    expect(reloaded.name).toBe("Persist")
    expect(reloaded.symbols).toEqual(["AAPL"])
  })
})
