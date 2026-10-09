// Durability: alertEngine — crash-safe writes (tmp+rename) + per-file write lock.
//
// Torn-write mechanism: fault injection at the fs boundary. The mocked
// writeFileSync performs a PARTIAL write (8 bytes) then throws, faithfully
// simulating a crash mid-write. Bare writeFileSync(target) leaves a truncated
// alerts.json (RED); tmp+rename leaves the previous snapshot intact (GREEN).
// Hermetic: PICC_ALERTS_DATA_DIR redirect, dynamic imports, vi.resetModules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ctl = vi.hoisted(() => ({ armed: false, suffix: "alerts.json" }))

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
  dir = await mkdtemp(join(tmpdir(), "picc-durability-alerts-"))
  process.env.PICC_ALERTS_DATA_DIR = dir
  vi.resetModules()
  mod = await import("../services/alertEngine.mjs")
})

afterEach(async () => {
  delete process.env.PICC_ALERTS_DATA_DIR
  vi.resetModules()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

const seedAlert = () =>
  mod.createAlert({ userId: "u1", symbol: "BTCUSD", condition: "price_above", value: 100 })

describe("alertEngine durability", () => {
  it("torn write: previous snapshot survives a mid-write crash (best-effort swallow, no throw)", async () => {
    seedAlert()
    const before = JSON.parse(await readFile(join(dir, "alerts.json"), "utf8"))
    expect(before).toHaveLength(1)

    ctl.armed = true
    // saveAlerts is best-effort swallow: the crash must not propagate …
    mod.createAlert({ userId: "u1", symbol: "ETHUSD", condition: "price_above", value: 50 })
    // … and the previous snapshot must survive intact.
    const after = JSON.parse(await readFile(join(dir, "alerts.json"), "utf8"))
    expect(after).toEqual(before)

    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })

  it("lock: burst writes serialize with no interleaved corruption", async () => {
    const N = 20
    for (let i = 0; i < N; i++) {
      mod.createAlert({ userId: "u1", symbol: "BTCUSD", condition: "price_above", value: 100 + i })
    }
    const onDisk = JSON.parse(await readFile(join(dir, "alerts.json"), "utf8"))
    expect(onDisk).toHaveLength(N)
    expect(mod.listAlerts()).toHaveLength(N)

    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })
})
