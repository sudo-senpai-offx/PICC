// Durability: ceremonyState — crash-safe writes (tmp+rename) + per-file write lock.
//
// Torn-write mechanism: fault injection at the fs boundary (partial 8-byte
// write then throw, simulating a crash mid-write). Bare writeFileSync(target)
// leaves a truncated ceremony-state.json (RED); tmp+rename leaves the previous
// snapshot intact (GREEN).
//
// NOTE on failure semantics: persist() here has no swallow — a failed persist
// propagates to the caller (creditResolved/setAssetClasses/…). That behavior
// is preserved: the crashing call still throws, only the on-disk snapshot is
// protected. Hermetic: PICC_COMMAND_CENTRE_DATA_DIR redirect, dynamic imports,
// vi.resetModules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const ctl = vi.hoisted(() => ({ armed: false, suffix: "ceremony-state.json" }))

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

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0)
const row = (over) => ({
  id: 1,
  assetId: "142",
  asset: "EUR / USD",
  provenance: "real",
  result: "hit",
  engine: "legacy",
  expirySec: 60,
  winProb: 0.62,
  entryTs: NOW,
  ...over
})

let dir
let mod

beforeEach(async () => {
  dir = useIsolatedStoreDir("PICC_COMMAND_CENTRE_DATA_DIR", { prefix: "picc-durability-ceremony" })
  vi.resetModules()
  mod = await import("../services/commandCentre/ceremonyState.mjs")
})

afterEach(async () => {
  delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
  vi.resetModules()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe("ceremonyState durability", () => {
  it("torn write: previous snapshot survives a mid-write crash (call still throws, file intact)", async () => {
    mod.setAssetClasses({ 142: "ccxt-crypto" })
    expect(mod.creditResolved([row()], { now: NOW }).ok).toBe(true)
    const before = JSON.parse(await readFile(join(dir, "ceremony-state.json"), "utf8"))
    expect(before.classes["ccxt-crypto"].spendableResolved).toBe(1)

    ctl.armed = true
    // Failure semantics preserved: the crashing persist still throws …
    expect(() => mod.creditResolved([row({ id: 2 })], { now: NOW })).toThrow()
    // … but the previous snapshot survives intact.
    const after = JSON.parse(await readFile(join(dir, "ceremony-state.json"), "utf8"))
    expect(after).toEqual(before)
    expect(mod.storeHealth()).toEqual({ ok: true })

    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })

  it("lock: overlapping writers serialize with zero lost updates", async () => {
    mod.setAssetClasses({ 142: "ccxt-crypto" })
    const N = 20
    await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        mod.ceremonyState() // read
        await new Promise((r) => setImmediate(r)) // overlap window between read and write
        expect(mod.creditResolved([row({ id: 100 + i })], { now: NOW }).ok).toBe(true)
      })
    )
    const onDisk = JSON.parse(await readFile(join(dir, "ceremony-state.json"), "utf8"))
    // Every credit landed — no writer lost another's update.
    expect(onDisk.classes["ccxt-crypto"].spendableResolved).toBe(N)
    expect(onDisk.classes["ccxt-crypto"].streak).toHaveLength(N)

    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })
})
