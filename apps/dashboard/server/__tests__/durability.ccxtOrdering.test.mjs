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

function multiLib(balances) {
  const lib = {}
  for (const [id, balance] of Object.entries(balances)) {
    const exchange = {
      async fetchBalance() {
        return { total: balance }
      },
      async fetchTicker() {
        throw new Error("fixture: no tickers needed for quote-only balance")
      }
    }
    lib[id] = function Ctor() {
      return exchange
    }
  }
  return lib
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

  it("lock: overlapping observations on distinct exchanges lose nothing", async () => {
    const N = 10
    const ids = Array.from({ length: N }, (_, i) => `ex${i}`)
    for (const id of ids) {
      process.env[`PICC_CCXT_APIKEY_${id.toUpperCase()}`] = `key-${id}`
      process.env[`PICC_CCXT_SECRET_${id.toUpperCase()}`] = `secret-${id}`
    }
    const balances = Object.fromEntries(ids.map((id, i) => [id, { USDT: 100 * (i + 1) }]))
    mod._setCcxtLibForTests(multiLib(balances))
    await Promise.all(ids.map((exchange) => mod.observeCcxtEquity({ exchange })))
    const onDisk = JSON.parse(await readFile(join(dir, "ccxt-equity.json"), "utf8"))
    // Every exchange present with its own snapshot — zero lost updates.
    for (let i = 0; i < N; i++) {
      expect(onDisk[`ex${i}`].equityUsd).toBe(100 * (i + 1))
    }

    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })

  it("lock: overlapping same-exchange observations serialize — second sees first's baseline", async () => {
    // Genuine async read-modify-write race: two observations overlap while
    // both fetches are deferred. Serialized, B's read sees A's write
    // (baseline kept, B not re-seeded). Interleaved, B reads pre-A state and
    // re-seeds, losing A's baseline — the lost update the mutex must prevent.
    const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)
    let releaseFirst
    let releaseSecond
    const gateFirst = new Promise((r) => { releaseFirst = r })
    const gateSecond = new Promise((r) => { releaseSecond = r })
    let calls = 0
    mod._setCcxtLibForTests({
      binance: function Ctor() {
        return {
          async fetchBalance() {
            calls += 1
            if (calls === 1) return gateFirst.then(() => ({ total: { USDT: 1000 } }))
            return gateSecond.then(() => ({ total: { USDT: 2000 } }))
          },
          async fetchTicker() {
            throw new Error("fixture: no tickers needed for quote-only balance")
          }
        }
      }
    })
    const pA = mod.observeCcxtEquity({ exchange: "binance", now: NOW })
    const pB = mod.observeCcxtEquity({ exchange: "binance", now: NOW })
    await new Promise((r) => setImmediate(r)) // both fetches in flight
    releaseSecond() // B's venue answers first …
    await new Promise((r) => setImmediate(r)) // … B's whole tail drains …
    releaseFirst() // … then A's venue answers
    const [rA, rB] = await Promise.all([pA, pB])

    expect(rA.ok).toBe(true)
    expect(rA.baselineSeeded).toBe(true)
    expect(rB.ok).toBe(true)
    // Serialized: B read A's committed baseline, so B did NOT re-seed.
    expect(rB.baselineSeeded).toBe(false)
    const onDisk = JSON.parse(await readFile(join(dir, "ccxt-equity.json"), "utf8"))
    expect(onDisk.binance.equityUsd).toBe(2000)
    expect(onDisk.binance.dayStartEquityUsd).toBe(1000)

    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })
})
