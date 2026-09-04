import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The store's DATA_DIR is fixed at import time, so every scenario boots a fresh
// module registry against its own temp dir — fully hermetic, no real data dir.
let dir = null

async function freshModule(reuseDir = null) {
  dir = reuseDir ?? (await mkdtemp(join(tmpdir(), "picc-localstore-")))
  process.env.PICC_DATA_DIR = dir
  vi.resetModules()
  return import("../services/localstore.mjs")
}

async function settle(ms = 150) {
  await new Promise((r) => setTimeout(r, ms))
}

/** Poll a file until `pred` matches its text (writes flush async — no fixed sleeps). */
async function waitForFile(path, pred, timeoutMs = 3000) {
  const start = Date.now()
  for (;;) {
    try {
      const txt = await readFile(path, "utf8")
      if (pred(txt)) return txt
    } catch {
      /* not yet written */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`file never matched predicate: ${path}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

beforeEach(async () => {
  dir = null
})

afterEach(async () => {
  delete process.env.PICC_DATA_DIR
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe("localStore (audit §5.7 hardening)", () => {
  test("persists on .write() and reloads across fresh imports", async () => {
    const { localStore } = await freshModule()
    const s = localStore("settings", { theme: "dark", wins: {} })
    s.data.theme = "light"
    s.data.wins.btc = 3
    s.write()

    // The write flushes asynchronously — wait until the file really shows it.
    await waitForFile(join(dir, "settings.json"), (t) => t.includes('"light"'))

    // Second process boot: SAME dir, fresh module registry → reads the file.
    const again = await freshModule(dir)
    const s2 = again.localStore("settings", { theme: "dark", wins: {} })
    await s2.ready
    expect(s2.data.theme).toBe("light")
    expect(s2.data.wins.btc).toBe(3)
  })

  test("a write issued BEFORE the initial load settles wins (no stale-file clobber)", async () => {
    // Pre-seed the file so the in-flight load has older contents to merge over.
    const d = await mkdtemp(join(tmpdir(), "picc-localstore-"))
    dir = d
    await writeFile(join(d, "early.json"), JSON.stringify({ v: "from-disk" }), "utf8")
    process.env.PICC_DATA_DIR = d
    vi.resetModules()
    const mod = await import("../services/localstore.mjs")
    const s = mod.localStore("early", { v: "default" })
    s.data.v = "from-caller" // caller acts before the async load resolves
    s.write()
    await settle()
    const raw = JSON.parse(await readFile(join(d, "early.json"), "utf8"))
    expect(raw.v).toBe("from-caller")
  })

  test("corrupt files fall back to defaults instead of crashing", async () => {
    const d = await mkdtemp(join(tmpdir(), "picc-localstore-"))
    dir = d
    await writeFile(join(d, "broken.json"), "{not json!!", "utf8")
    process.env.PICC_DATA_DIR = d
    vi.resetModules()
    const { localStore } = await import("../services/localstore.mjs")
    const s = localStore("broken", { a: 1 })
    await s.ready
    expect(s.data.a).toBe(1)
  })

  test("writes are atomic — no .tmp residue, final file is valid JSON of the last snapshot", async () => {
    const { localStore } = await freshModule()
    const s = localStore("counter", { n: 0 })
    let lastWrite
    for (let i = 1; i <= 5; i++) {
      s.data.n = i
      lastWrite = s.write() // burst the queue, then drain it — deterministic on Windows
    }
    await lastWrite
    const files = await readdir(dir)
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false)
    const raw = JSON.parse(await readFile(join(dir, "counter.json"), "utf8"))
    expect(raw.n).toBe(5)
  })

  test("rename EPERM (Windows destination lock) is retried — no residue, last snapshot wins", async () => {
    const d = await mkdtemp(join(tmpdir(), "picc-localstore-lock-"))
    dir = d
    process.env.PICC_DATA_DIR = d
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const real = await importOriginal()
      let fails = 2 // simulate a reader holding the destination open, then clearing
      return {
        ...real,
        rename: async (from, to) => {
          if (fails > 0) {
            fails--
            const e = new Error("EPERM: operation not permitted")
            e.code = "EPERM"
            throw e
          }
          return real.rename(from, to)
        }
      }
    })
    vi.resetModules()
    const { localStore } = await import("../services/localstore.mjs")
    const s = localStore("locked", { n: 0 })
    await s.ready
    s.data.n = 7
    s.write()
    await waitForFile(join(d, "locked.json"), (t) => t.includes('"n": 7'))
    const files = await readdir(d)
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false)
    const raw = JSON.parse(await readFile(join(d, "locked.json"), "utf8"))
    expect(raw.n).toBe(7)
    vi.doUnmock("node:fs/promises")
  })

  test("rename permanently locked → direct-write fallback — data is never silently lost", async () => {
    const d = await mkdtemp(join(tmpdir(), "picc-localstore-lock2-"))
    dir = d
    process.env.PICC_DATA_DIR = d
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const real = await importOriginal()
      return {
        ...real,
        rename: async () => {
          const e = new Error("EPERM: operation not permitted")
          e.code = "EPERM"
          throw e
        }
      }
    })
    vi.resetModules()
    const { localStore } = await import("../services/localstore.mjs")
    const s = localStore("alwayslocked", { n: 0 })
    await s.ready
    s.data.n = 9
    s.write()
    // Even with rename failing forever, the snapshot must still reach disk.
    await waitForFile(join(d, "alwayslocked.json"), (t) => t.includes('"n": 9'))
    const raw = JSON.parse(await readFile(join(d, "alwayslocked.json"), "utf8"))
    expect(raw.n).toBe(9)
    const files = await readdir(d)
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false)
    vi.doUnmock("node:fs/promises")
  })

  test("localStore instance is cached per name (same object, same data)", async () => {
    const { localStore } = await freshModule()
    const a = localStore("cache", { x: 1 })
    const b = localStore("cache", { x: 1 })
    expect(a).toBe(b)
    a.data.x = 42
    expect(b.data.x).toBe(42)
  })
})
