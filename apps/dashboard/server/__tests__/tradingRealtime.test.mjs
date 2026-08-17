import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"

// Regression: /api/trading/realtime must use event names the client's SSE
// parser understands. The client matches `ready`/`stats`/`snapshot`/`decision`/
// `decisions`/`suite`; any other name falls through to `ready ok:Boolean(...)`
// and silently drops the payload (and previously faked a "stream failed").
vi.mock("../services/liveEO.mjs", () => ({
  subscribeLiveEO: vi.fn(() => () => {}),
  liveEOStats: vi.fn(() => ({ status: "idle" })),
  liveSnapshot: vi.fn(() => ({ status: "idle" }))
}))
vi.mock("../services/adaptiveConfluence.mjs", () => ({
  subscribeDecisions: vi.fn((cb) => {
    cb({ type: "decision", ts: 1, status: "connected", mode: "demo", account: null, viewed: [], decisions: [] })
    return () => {}
  }),
  getDecisions: vi.fn(async () => ({
    ts: 1,
    status: "connected",
    mode: "demo",
    account: null,
    viewed: [],
    decisions: [{ symbol: "EURUSD", verdict: "TRADE" }]
  })),
  observedPayouts: vi.fn(async () => [])
}))
vi.mock("../services/realtimeSuite.mjs", () => ({
  tradingSuiteSnapshot: vi.fn(async () => ({ ts: 2, ok: true })),
  bustRealtimeSuite: vi.fn()
}))

let dir
let token
let hApi

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "picc-realtime-sse-"))
  token = randomBytes(32).toString("hex")
  writeFileSync(join(dir, "users.json"), JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] }))
  writeFileSync(join(dir, "sessions.json"), JSON.stringify({ sessions: { [token]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 60_000 } } }))
  process.env.PICC_AUTH_DATA_DIR = dir
  vi.resetModules()
  const { handleApi } = await import("../handlers.mjs?realtime-sse-test")
  hApi = handleApi
})

afterAll(() => {
  delete process.env.PICC_AUTH_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

async function connect(token) {
  const chunks = []
  const res = {
    writeHead() {},
    write(c) {
      chunks.push(c)
      return true
    },
    end() {},
    on() {}
  }
  const req = {
    method: "GET",
    headers: { host: "localhost", authorization: "" },
    listeners: {},
    on(evt, cb) {
      this.listeners[evt] = cb
      if (evt === "end") queueMicrotask(() => cb())
    },
    emit(evt) {
      this.listeners[evt]?.()
    }
  }
  const pending = hApi(req, res, `/api/trading/realtime?token=${token}`)
  const frames = async (ms = 80) => {
    await new Promise((r) => setTimeout(r, ms))
    return chunks.join("")
  }
  return { req, pending, frames }
}

describe("trading realtime SSE event names", () => {
  it("emits ready/stats/decision/decisions/suite with parseable names", async () => {
    const { req, pending, frames } = await connect(token)
    const body = await frames(120)
    expect(body).toContain("event: ready")
    expect(body).toContain('"ok":true')
    expect(body).toContain("event: stats")
    expect(body).toContain("event: decision")
    expect(body).toContain("event: decisions")
    // decisions payload is a full decision snapshot, NOT `{ ok: false }`
    expect(body).toContain('"verdict":"TRADE"')
    // suite is emitted independently of the (slow) decisions fetch
    expect(body).toContain("event: suite")
    expect(body).toContain('"ok":true')
    req.emit("close")
    await pending
  })
})
