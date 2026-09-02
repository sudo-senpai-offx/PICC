import { describe, expect, it, vi } from "vitest"
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

describe("POST /api/system/capabilities", () => {
  it("returns a machine-level capability snapshot", async () => {
    const res = await call("POST", "/api/system/capabilities")
    expect(res.status).toBe(200)
    const b = res.body
    expect(b.ok).toBe(true)

    // Machine identity — always present
    expect(typeof b.arch).toBe("string")
    expect(typeof b.platform).toBe("string")
    expect(typeof b.node).toBe("string")
    expect(typeof b.uptime).toBe("number")

    // Browser bridge — boolean, never throws
    expect(typeof b.browserFound).toBe("boolean")

    // Extension sensor — shape present even when no extension seen
    expect(b.extensionSensor).toBeDefined()
    expect(typeof b.extensionSensor.seen).toBe("boolean")

    // Notifier channels — shape present; inApp always true; exactly the three
    // shipping channels, no email row (T9 removed the email channel).
    expect(b.notifierChannels).toBeDefined()
    expect(b.notifierChannels.inApp).toBe(true)
    expect(typeof b.notifierChannels.webpush).toBe("boolean")
    expect(b.notifierChannels.email).toBeUndefined()

    // Signal engine — reflects env kill-switch
    expect(typeof b.signalEngine).toBe("boolean")
  })

  it("returns 404 for GET (POST-only endpoint)", async () => {
    const res = await call("GET", "/api/system/capabilities")
    expect(res.status).toBe(404)
  })
})
