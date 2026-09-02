// T7 / REQ-8: GET /api/signals/status — the advisory window snapshot the in-app
// countdown chip polls. Same source of truth as the push dispatch (signalEngine
// state machine); the countdown must never read a different clock than the
// engine that opened the window.
import { describe, expect, it } from "vitest"
import { handleApi } from "../handlers.mjs"

function makeReq(method, url, body) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json" },
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
    writeHead(status) { this.status = status },
    end(body) { this.body = body ? JSON.parse(body) : null }
  }
}

async function call(method, path, body) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body), res, path)
  return res
}

describe("GET /api/signals/status (T7 / REQ-8)", () => {
  it("exposes the engine snapshot over HTTP with per-asset state records", async () => {
    const res = await call("GET", "/api/signals/status")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.running).toBe("boolean")
    expect(typeof res.body.watched).toBe("number")
    expect(typeof res.body.states).toBe("object")
    // Every state record carries a `phase` (idle assets must NOT fabricate a
    // `since` — the chip only counts down observed windows).
    for (const rec of Object.values(res.body.states)) {
      expect(typeof rec.phase).toBe("string")
      if (rec.phase !== "alerted") expect("since" in rec).toBe(false)
    }
  })

  it("rejects non-GET methods (uniform 404, matching GET-only route convention)", async () => {
    const res = await call("POST", "/api/signals/status", {})
    expect(res.status).toBe(404)
  })
})