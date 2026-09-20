import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method, url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    raw,
    on(evt, cb) { if (evt === "data" && raw != null) cb(raw); if (evt === "end") cb() }
  }
}
function makeRes() {
  return {
    status: null, body: null,
    writeHead(status) { this.status = status },
    end(body) { this.body = body ? JSON.parse(body) : null }
  }
}
async function call(handleApi, method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

describe("dispatch API", () => {
  let dir, handleApi, dispatch
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-dispatch-api-"))
    process.env.PICC_DISPATCH_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    dispatch = await import("../services/dispatch.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DISPATCH_DATA_DIR
    dispatch._resetDispatchForTest()
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("GET dispatch returns the empty inbox honestly", async () => {
    const res = await call(handleApi, "GET", "/api/trading/dispatch")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.unread).toBe(0)
    expect(res.body.entries).toEqual([])
  })

  it("GET dispatch returns pushed entries newest-first with unread", async () => {
    dispatch.pushDispatch({ title: "one", kind: "decision" })
    dispatch.pushDispatch({ title: "two", kind: "venue" })
    const res = await call(handleApi, "GET", "/api/trading/dispatch")
    expect(res.body.entries.map((e) => e.title)).toEqual(["two", "one"])
    expect(res.body.unread).toBe(2)
  })

  it("POST dispatch/read marks one entry and reports 200", async () => {
    const e = dispatch.pushDispatch({ title: "one", kind: "milestone" })
    const res = await call(handleApi, "POST", "/api/trading/dispatch/read", { id: e.id })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, id: e.id, read: true })
    expect(dispatch.unreadDispatchCount()).toBe(0)
  })

  it("POST dispatch/read with a missing id returns 404", async () => {
    const res = await call(handleApi, "POST", "/api/trading/dispatch/read", { id: "nope" })
    expect(res.status).toBe(404)
    expect(res.body.ok).toBe(false)
  })

  it("POST dispatch/read with an invalid body returns 400", async () => {
    const res = await call(handleApi, "POST", "/api/trading/dispatch/read", {})
    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
  })
})