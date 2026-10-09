// Durability: copyCorpusStore — crash-safe writes (tmp+rename) + per-file write lock.
//
// Torn-write mechanism: fault injection at the fs boundary (partial 8-byte
// write then throw, simulating a crash mid-write). Bare writeFileSync(target)
// leaves a truncated copyCorpus.json (RED); tmp+rename leaves the previous
// snapshot intact (GREEN).
// Hermetic: PICC_COPYCORPUS_DATA_DIR redirect, dynamic imports, vi.resetModules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ctl = vi.hoisted(() => ({ armed: false, suffix: "copyCorpus.json" }))

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

let dir
let mod

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "picc-durability-corpus-"))
  process.env.PICC_COPYCORPUS_DATA_DIR = dir
  vi.resetModules()
  mod = await import("../services/copyCorpusStore.mjs")
})

afterEach(async () => {
  delete process.env.PICC_COPYCORPUS_DATA_DIR
  try {
    mod._resetCopyCorpusForTest()
  } catch {
    /* ignore */
  }
  vi.resetModules()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

const sample = (accountRef) => ({ venue: "hyperliquid", accountRef, regime: "trend" })

describe("copyCorpusStore durability", () => {
  it("torn write: previous snapshot survives a mid-write crash (best-effort swallow, no throw)", async () => {
    expect(mod.appendExternalSample(sample("a1")).ok).toBe(true)
    const before = JSON.parse(await readFile(join(dir, "copyCorpus.json"), "utf8"))
    expect(before).toHaveLength(1)

    ctl.armed = true
    // save() is best-effort swallow: the crash must not propagate …
    expect(mod.appendExternalSample(sample("a2")).ok).toBe(true)
    // … and the previous snapshot must survive intact.
    const after = JSON.parse(await readFile(join(dir, "copyCorpus.json"), "utf8"))
    expect(after).toEqual(before)

    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })

  it("lock: overlapping writers serialize with zero lost updates", async () => {
    const N = 20
    await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        mod.corpusCounts() // read
        await new Promise((r) => setImmediate(r)) // overlap window between read and write
        expect(mod.appendExternalSample(sample(`overlap-${i}`)).ok).toBe(true)
      })
    )
    const onDisk = JSON.parse(await readFile(join(dir, "copyCorpus.json"), "utf8"))
    expect(onDisk).toHaveLength(N)
    // Every distinct payload present — no writer lost another's update.
    expect(new Set(onDisk.map((r) => r.accountRef)).size).toBe(N)
    for (let i = 0; i < N; i++) {
      expect(onDisk.some((r) => r.accountRef === `overlap-${i}`)).toBe(true)
    }
    expect(mod.listExternal({ limit: 100 })).toHaveLength(N)

    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })
})
