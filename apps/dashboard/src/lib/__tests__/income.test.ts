// @vitest-environment jsdom
// Task 10 — localStorage → server migration (no destructive-by-default rule).
import { describe, expect, it, vi, beforeEach } from "vitest"
import { migrateLocalStreams, listIncomeStreams, getIncomeOverview } from "../income"
import type { IncomeStream } from "../types"

function makeStream(overrides: Partial<IncomeStream> = {}): IncomeStream {
  return {
    id: "s-1",
    name: "Grass",
    platform: "getgrass.io",
    category: "bandwidth",
    status: "active",
    balance: 12.5,
    totalEarned: 90,
    payoutThreshold: 20,
    payoutMethod: "—",
    estimatedDaily: 0.4,
    ...overrides
  }
}

// The upsert POST path used by income.ts via localdata.upsertData.
const UPSERT_RE = /\/api\/data\/income_streams\/upsert/

beforeEach(() => {
  localStorage.clear()
})

describe("migrateLocalStreams (Task 10)", () => {
  it("migrates every local stream server-side, keeping its id, and clears local only on full success", async () => {
    const streams = [makeStream({ id: "abc" }), makeStream({ id: "def", platform: "honeygain", balance: 3 }) ]
    localStorage.setItem("picc.streams", JSON.stringify(streams))

    const posted: unknown[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (UPSERT_RE.test(url)) {
        const body = JSON.parse(String(init?.body ?? "{}")).row
        posted.push(body)
        return { ok: true, json: async () => ({ ok: true, row: body }) } as Response
      }
      return { ok: true, json: async () => ({ ok: true, rows: [] }) } as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await migrateLocalStreams()

    expect(res.migrated).toBe(2)
    expect(res.failed).toBe(0)
    expect(res.complete).toBe(true)
    // Both rows posted with their existing ids (idempotent upsert).
    expect(posted.map((p) => (p as { id: string }).id).sort()).toEqual(["abc", "def"])
    // Local copy cleared ONLY after every server write confirmed.
    expect(JSON.parse(localStorage.getItem("picc.streams")!)).toEqual([])
    // Migration is marked complete for a later no-op run.
    const second = await migrateLocalStreams()
    expect(second).toEqual({ migrated: 0, failed: 0, complete: true })
  })

  it("a forced server-down run leaves localStorage fully intact", async () => {
    const streams = [makeStream({ id: "abc" }), makeStream({ id: "def" })]
    localStorage.setItem("picc.streams", JSON.stringify(streams))

    const fetchMock = vi.fn(async () => { throw new Error("server unreachable") })
    vi.stubGlobal("fetch", fetchMock)

    const res = await migrateLocalStreams()

    expect(res.migrated).toBe(0)
    expect(res.failed).toBe(2)
    expect(res.complete).toBe(false)
    // No local data is destroyed — both streams still present.
    expect(JSON.parse(localStorage.getItem("picc.streams")!)).toEqual(streams)
    expect(localStorage.getItem("picc.incomeMigrationComplete")).toBeNull()
  })

  it("partial success clears only the confirmed rows and keeps the failures local", async () => {
    const streams = [makeStream({ id: "ok" }), makeStream({ id: "bad", platform: "honeygain" })]
    localStorage.setItem("picc.streams", JSON.stringify(streams))

    let calls = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      calls += 1
      const body = JSON.parse(String(init?.body ?? "{}")).row
      // Succeed for the first (ok) row; throw for the second (bad) row.
      if (calls === 1) return { ok: true, json: async () => ({ ok: true, row: body }) } as Response
      throw new Error("server unreachable")
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await migrateLocalStreams()

    // One upsert confirmed (ok), one failed (bad).
    expect(res.failed).toBe(1)
    expect(res.complete).toBe(false)
    const remaining = JSON.parse(localStorage.getItem("picc.streams")!) as IncomeStream[]
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe("bad")
    expect(localStorage.getItem("picc.incomeMigrationComplete")).toBeNull()
  })

  it("listIncomeStreams returns null when the server is unreachable (independence rule)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    expect(await listIncomeStreams()).toBeNull()
  })
})

describe("getIncomeOverview (Task 12 §4 shape)", () => {
  it("returns keyed snapshots + grouped holdings + server summary on success", async () => {
    const OVERVIEW_RE = /\/api\/income\/overview/
    const fetchMock = vi.fn(async (url: string) => {
      if (OVERVIEW_RE.test(url)) {
        return {
          ok: true,
          json: async () => ({
            snapshots: {
              grass: { provider: "grass", lifetime: 30, today: 1.2, status: "ok" }
            },
            streams: [
              { id: "a", name: "Grass", platform: "getgrass.io", status: "active", balance: 5, payoutThreshold: 10, estimatedDaily: 1.2 }
            ],
            holdings: { nft: [{ id: "n1", name: "BAPE" }], depin: [], financial: [], transactions: [] },
            summary: { monthly: null, lifetime: 30, today: 1.2, activeCount: 1, projectedAnnual: 438, cashoutReady: [], daily: [] }
          })
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await getIncomeOverview()

    expect(res.source).toBe("server")
    // snapshots remain keyed by provider slug (§4), not a flat array.
    expect(res.snapshots.grass.status).toBe("ok")
    expect(res.snapshots.grass.lifetime).toBe(30)
    // holdings arrive grouped by table.
    expect(res.holdings.nft[0].name).toBe("BAPE")
    expect(res.holdings.transactions).toEqual([])
    // streams are normalized into the full IncomeStream shape.
    expect(res.streams).toHaveLength(1)
    expect(res.streams[0].name).toBe("Grass")
    // the server's null monthly coerces to 0 for the UI; lifetime preserved.
    expect(res.summary.lifetime).toBe(30)
    expect(res.summary.monthly).toBe(0)
  })

  it("falls back to local streams when the server is unreachable (independence rule)", async () => {
    localStorage.setItem("picc.streams", JSON.stringify([makeStream({ id: "abc" })]))
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))

    const res = await getIncomeOverview()

    expect(res.source).toBe("local")
    expect(res.snapshots).toEqual({})
    expect(res.holdings.nft).toEqual([])
    expect(res.holdings.depin).toEqual([])
    expect(res.streams).toHaveLength(1)
    expect(res.streams[0].name).toBe("Grass")
  })
})

describe("migration call-sites (Task 10)", () => {
  const LIST_RE = /\/api\/data\/income_streams$/
  const OVERVIEW_RE = /\/api\/income\/overview/
  const UPSERT_RE = /\/api\/data\/income_streams\/upsert/

  // A fetch double that behaves like the real localstore surface: upserts land
  // in an in-memory server table that the list/overview reads then serve.
  function serverHarness() {
    const serverRows: unknown[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (UPSERT_RE.test(u)) {
        const body = JSON.parse(String(init?.body ?? "{}")).row
        serverRows.push(body)
        return { ok: true, json: async () => ({ ok: true, row: body }) } as Response
      }
      if (LIST_RE.test(u)) {
        return { ok: true, json: async () => ({ ok: true, rows: serverRows }) } as Response
      }
      if (OVERVIEW_RE.test(u)) {
        return {
          ok: true,
          json: async () => ({
            snapshots: { grass: { provider: "grass", lifetime: 30, today: 1.2, status: "ok" } },
            streams: serverRows,
            holdings: { nft: [], depin: [], financial: [], transactions: [] },
            summary: { monthly: null, lifetime: 30, today: 1.2, activeCount: 1, projectedAnnual: 438, cashoutReady: [], daily: [] }
          })
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    return { fetchMock, serverRows }
  }

  it("listIncomeStreams is a migration call-site: local streams land server-side on the first read", async () => {
    localStorage.setItem("picc.streams", JSON.stringify([makeStream({ id: "abc" }), makeStream({ id: "def", platform: "honeygain" })]))
    const h = serverHarness()

    const rows = await listIncomeStreams()

    expect(rows).toHaveLength(2)
    expect(h.serverRows.map((r) => (r as { id: string }).id).sort()).toEqual(["abc", "def"])
    // Every row confirmed server-side → local copy cleared, migration marked done.
    expect(JSON.parse(localStorage.getItem("picc.streams")!)).toEqual([])
    expect(localStorage.getItem("picc.incomeMigrationComplete")).toBe("1")
  })

  it("getIncomeOverview migrates before reading the server overview (boot call-site)", async () => {
    localStorage.setItem("picc.streams", JSON.stringify([makeStream({ id: "abc" })]))
    const h = serverHarness()

    const res = await getIncomeOverview()

    expect(res.source).toBe("server")
    expect(h.serverRows).toHaveLength(1)
    expect((h.serverRows[0] as { id: string }).id).toBe("abc")
    expect(res.snapshots.grass.status).toBe("ok")
    expect(JSON.parse(localStorage.getItem("picc.streams")!)).toEqual([])
    expect(localStorage.getItem("picc.incomeMigrationComplete")).toBe("1")
  })
})
