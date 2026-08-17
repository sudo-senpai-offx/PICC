import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
      if (evt === "end") cb()
    }
  }
}

function makeRes() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    },
    pipe() {}
  }
}

async function call(handleApi, method, path, body) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body), res, path)
  return res
}

let tmp
let handleApi

describe("Browser Studio — interaction endpoints", () => {
  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "picc-browser-interaction-"))
    process.env.PICC_AUTH_DATA_DIR = tmp
    process.env.PICC_BROWSER_DATA_DIR = tmp
    vi.resetModules()
    ;({ handleApi } = await import("../handlers.mjs"))
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it("rejects file uploads while the browser is closed (409)", async () => {
    const res = await call(handleApi, "POST", "/api/browser/upload", {
      id: 1,
      files: [{ name: "a.txt", type: "text/plain", data: Buffer.from("hello").toString("base64") }]
    })
    expect(res.status).toBe(409)
    expect(res.body.ok).toBe(false)
  })

  it("rejects clipboard copy while the browser is closed (409)", async () => {
    const res = await call(handleApi, "POST", "/api/browser/clipboard/copy", {})
    expect(res.status).toBe(409)
    expect(res.body.ok).toBe(false)
  })

  it("lists downloads even while the browser is closed (session registry)", async () => {
    const res = await call(handleApi, "GET", "/api/browser/downloads")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(Array.isArray(res.body.downloads)).toBe(true)
    expect(res.body.downloads).toEqual([])
  })

  it("streams a download file only for an existing id (404 / 409 without browser)", async () => {
    const res = await call(handleApi, "GET", "/api/browser/download/1")
    expect([404, 409]).toContain(res.status)
    expect(res.body.ok).toBe(false)
  })

  it("rejects unknown input types over the API", async () => {
    const res = await call(handleApi, "POST", "/api/browser/input", { type: "teleport", nx: 0.5, ny: 0.5 })
    expect([400, 409]).toContain(res.status)
  })

  it("accepts a larger upload body without choking on the 2 MB default", async () => {
    // 3 MB of base64 JSON — must reach the route (409 = browser closed) rather
    // than failing body parsing. Proves the upload route reads a bigger body.
    const big = { data: "a".repeat(3 * 1024 * 1024) }
    const res = await call(handleApi, "POST", "/api/browser/upload", {
      id: 2,
      files: [{ name: "big.bin", type: "application/octet-stream", ...big }]
    })
    expect(res.status).toBe(409)
  })
})
