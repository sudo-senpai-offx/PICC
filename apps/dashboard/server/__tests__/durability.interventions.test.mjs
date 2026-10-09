// Durability: interventions workflows — crash-safe writes (tmp+rename) + per-file lock.
//
// Torn-write mechanism: fault injection at the fs boundary (partial 8-byte
// write then throw, simulating a crash mid-write). Each workflow is its own
// file under <DATA_DIR>/workflows/, so the crash is armed on the "workflows"
// path segment and assertions target the CRASHED file: bare
// writeFileSync(target) leaves a truncated <id>.json (RED); tmp+rename never
// creates the target and cleans the tmp (GREEN) while the previously saved
// workflow stays intact.
//
// NOTE on failure semantics: saveWorkflow() has no swallow — a failed save
// propagates to the caller. Preserved: the crashing call still throws.
// Hermetic: PICC_DATA_DIR redirect (absolute tmp dir), dynamic imports,
// vi.resetModules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const ctl = vi.hoisted(() => ({ armed: false, suffix: "workflows" }))

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

const steps = [{ kind: "goto", url: "https://example.com" }]

let dir
let mod

beforeEach(async () => {
  dir = useIsolatedStoreDir("PICC_DATA_DIR", { prefix: "picc-durability-workflows" })
  vi.resetModules()
  mod = await import("../services/interventions.mjs")
})

afterEach(async () => {
  delete process.env.PICC_DATA_DIR
  vi.resetModules()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe("interventions workflow durability", () => {
  it("torn write: crashed save leaves no truncated file; previous workflow intact (call still throws)", async () => {
    const first = mod.saveWorkflow({ id: "wf-good", name: "good", steps })
    const firstBytes = await readFile(join(dir, "workflows", `${first.id}.json`), "utf8")
    expect(JSON.parse(firstBytes).id).toBe("wf-good")

    ctl.armed = true
    // Failure semantics preserved: the crashing save still throws …
    expect(() => mod.saveWorkflow({ id: "wf-crashed", name: "crashed", steps })).toThrow(
      "injected crash mid-write"
    )
    // … the crashed target is never left truncated …
    const files = await readdir(join(dir, "workflows"))
    expect(files).not.toContain("wf-crashed.json")
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
    // … and the previously saved workflow survives intact.
    expect(await readFile(join(dir, "workflows", `${first.id}.json`), "utf8")).toBe(firstBytes)
    expect(mod.listWorkflows().some((w) => w.id === "wf-good")).toBe(true)
  })

  it("lock: overlapping saves serialize with zero lost updates", async () => {
    const N = 15
    await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        mod.listWorkflows() // read
        await new Promise((r) => setImmediate(r)) // overlap window between read and write
        mod.saveWorkflow({ id: `wf-overlap-${i}`, name: `overlap ${i}`, steps })
      })
    )
    const files = await readdir(join(dir, "workflows"))
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
    // Every distinct file present and whole — no save lost or interleaved.
    for (let i = 0; i < N; i++) {
      const parsed = JSON.parse(await readFile(join(dir, "workflows", `wf-overlap-${i}.json`), "utf8"))
      expect(parsed.id).toBe(`wf-overlap-${i}`)
      expect(parsed.name).toBe(`overlap ${i}`)
    }
    expect(mod.listWorkflows().filter((w) => w.id.startsWith("wf-overlap-"))).toHaveLength(N)
  })
})
