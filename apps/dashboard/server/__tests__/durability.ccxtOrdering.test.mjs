// Durability: ccxtOrdering equity store — crash-safe writes (tmp+rename) + per-file lock.
//
// Torn-write mechanism: fault injection at the fs boundary (partial 8-byte
// write then throw, simulating a crash mid-write). Bare writeFileSync(target)
// leaves a truncated ccxt-equity.json (RED); tmp+rename leaves the previous
// snapshot intact (GREEN).
//
// NOTE on failure semantics: persistEquity() has no swallow — a failed persist
// propagates (observeCcxtEquity rejects). Preserved: the crashing observation
// still rejects, only the on-disk snapshot is protected. Venue calls use a
// fixture exchange via _setCcxtLibForTests (CI never touches a live venue).
// Hermetic: PICC_COMMAND_CENTRE_DATA_DIR redirect, dynamic imports,
// vi.resetModules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ctl = vi.hoisted(() => ({ armed: false, suffix: "ccxt-equity.json" }))

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    writeFileSync(file, data, options) {
      if (ctl.armed && typeof file === "string" && file.includes(ctl.suffix)) {
        ctl.armed = false
        try {
          real.writeFileSync(file, String(data).slice(0, 8), options)
        } catch {
          /* crash during the crash — target state is what matters */
        }
        throw new Error("injected crash mid-write")
      }
      return real.writeFileSync(file, data, options)
    }
  }
})

const BINANCE_KEYS = {
  PICC_CCXT_APIKEY_BINANCE: "key-binance",
  PICC_CCXT_SECRET_BINANCE: "secret-binance"
}

function fixtureLib(balance) {
  const exchange = {
    async fetchBalance() {
      return { total: balance }
    },
    async fetchTicker() {
      throw new Error("fixture: no tickers needed for quote-only balance")
    }
  }
  return {
    binance: function Ctor() {
      return exchange
    }
  }
}

let dir
let mod

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "picc-durability-equity-"))
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dir
  Object.assign(process.env, BINANCE_KEYS)
  vi.resetModules()
  mod = await import("../services/ccxtOrdering.mjs")
  mod._setCcxtLibForTests(fixtureLib({ USDT: 1000 }))
})

afterEach(async () => {
  try {
    mod._resetCcxtOrderingState()
  } catch {
    /* ignore */
  }
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("PICC_CCXT_")) delete process.env[k]
  }
  delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
  vi.resetModules()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe("ccxtOrdering equity durability", () => {
  it("torn write: previous snapshot survives a mid-write crash (observation still rejects)", async () => {
    const first = await mod.observeCcxtEquity({ exchange: "binance" })
    expect(first.ok).toBe(true)
    const before = JSON.parse(await readFile(join(dir, "ccxt-equity.json"), "utf8"))
    expect(before.binance.equityUsd).toBe(1000)

    ctl.armed = true
    // Failure semantics preserved: the crashing observation still rejects …
    await expect(mod.observeCcxtEquity({ exchange: "binance" })).rejects.toThrow(
      "injected crash mid-write"
    )
    // … but the previous snapshot survives intact.
    const after = JSON.parse(await readFile(join(dir, "ccxt-equity.json"), "utf8"))
    expect(after).toEqual(before)

    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })

  it("lock: burst observations serialize with no interleaved corruption", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () => mod.observeCcxtEquity({ exchange: "binance" }))
    )
    const onDisk = JSON.parse(await readFile(join(dir, "ccxt-equity.json"), "utf8"))
    expect(onDisk.binance.equityUsd).toBe(1000)
    expect(mod.ccxtEquityFreshness("binance")).not.toBeNull()

    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })
})
