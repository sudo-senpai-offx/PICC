import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rmSync } from "node:fs"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

// Wave 0 Task 3 — streamSnapshot honesty: absent numerics persist as null
// with a named reason, never as fabricated 0. Hermetic: the snapshot file
// path is fixed at module load from PICC_AUTOMATOR_DATA_DIR, so the module
// is imported FRESH per test with the env pointed at a tmp dir (the same
// resetModules pattern as paperOverviewApi.test.mjs).

describe("streamSnapshot null-not-zero (Wave 0 Task 3)", () => {
  let dir
  let getSnapshot
  let saveSnapshot

  beforeEach(async () => {
    dir = useIsolatedStoreDir("PICC_AUTOMATOR_DATA_DIR", { prefix: "picc-stream-snapshot" })
    vi.resetModules()
    ;({ getSnapshot, saveSnapshot } = await import("../services/streamSnapshot.mjs"))
  })

  afterEach(() => {
    delete process.env.PICC_AUTOMATOR_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("persists absent numerics as null with a named reason, never 0", async () => {
    await saveSnapshot({
      streams: [{ id: "s1", name: "Grass", platform: "getgrass.io" }],
      earnings: []
    })
    const snap = await getSnapshot()
    expect(snap.streams).toHaveLength(1)
    const row = snap.streams[0]
    expect(row.balance).toBeNull()
    expect(row.totalEarned).toBeNull()
    expect(row.payoutThreshold).toBeNull()
    expect(row.estimatedDaily).toBeNull()
    expect(row.reason).toMatch(/balance-unobservable/)
    expect(row.reason).toMatch(/totalEarned-unobservable/)
    expect(row.reason).toMatch(/payoutThreshold-unobservable/)
    expect(row.reason).toMatch(/estimatedDaily-unobservable/)
  })

  it("keeps observed values byte-identical, including genuine 0, with null reason", async () => {
    await saveSnapshot({
      streams: [{
        id: "s2", name: "Paid", platform: "x.io", category: "bandwidth",
        status: "active", balance: 5.5, totalEarned: 0, payoutThreshold: 10,
        estimatedDaily: 1.2, url: "https://x.io", lastCollected: "2026-01-01"
      }],
      earnings: [{ streamId: "s2", amount: 1 }]
    })
    const snap = await getSnapshot()
    const row = snap.streams[0]
    expect(row).toMatchObject({
      balance: 5.5, totalEarned: 0, payoutThreshold: 10, estimatedDaily: 1.2, reason: null
    })
    expect(snap.earnings).toHaveLength(1)
  })

  it("treats NaN and junk legs as absent too", async () => {
    await saveSnapshot({
      streams: [{ id: "s3", balance: NaN, totalEarned: "junk", payoutThreshold: null, estimatedDaily: undefined }],
      earnings: []
    })
    const row = (await getSnapshot()).streams[0]
    expect(row.balance).toBeNull()
    expect(row.totalEarned).toBeNull()
    expect(row.reason).toMatch(/balance-unobservable/)
  })
})
