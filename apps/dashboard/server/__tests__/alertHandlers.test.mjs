import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// 8c acceptance at the HTTP surface: POST /api/trading/alerts creates a
// convergence_above alert (with the optional state band), and GET lists it.
// The alert is deleted afterwards so the dev alert store stays untouched,
// and the store is redirected to a tmp dir so parallel workers stay hermetic.

let handleApi
let listAlerts
let deleteAlert
let tmp

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-alerthandler-"))
  process.env.PICC_ALERTS_DATA_DIR = tmp
  const handlers = await import("../handlers.mjs")
  const eng = await import("../services/alertEngine.mjs")
  handleApi = handlers.handleApi
  listAlerts = eng.listAlerts
  deleteAlert = eng.deleteAlert
})

afterAll(async () => {
  delete process.env.PICC_ALERTS_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

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

let createdId = null

afterAll(() => {
  if (createdId) deleteAlert(createdId)
})

describe("convergence_above alert via /api/trading/alerts (8c)", () => {
  it("creates and lists a convergence_above alert with its state band", async () => {
    const res = await call("POST", "/api/trading/alerts", {
      symbol: "EURUSD",
      condition: "convergence_above",
      value: 3,
      band: ["LONG BIAS", "SHORT BIAS"],
      recurring: true
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.alert.condition).toBe("convergence_above")
    expect(res.body.alert.value).toBe(3)
    expect(res.body.alert.band).toEqual(["LONG BIAS", "SHORT BIAS"])
    expect(res.body.alert.status).toBe("armed")
    createdId = res.body.alert.id

    const listed = await call("GET", "/api/trading/alerts")
    expect(listed.status).toBe(200)
    expect(listed.body.ok).toBe(true)
    const found = listed.body.alerts.find((a) => a.id === createdId)
    expect(found).toBeDefined()
    expect(found.condition).toBe("convergence_above")
    expect(found.band).toEqual(["LONG BIAS", "SHORT BIAS"])
  })

  it("rejects invalid conditions via the shared validator", async () => {
    const before = listAlerts().length
    const res = await call("POST", "/api/trading/alerts", {
      symbol: "EURUSD",
      condition: "not_a_condition",
      value: 3
    })
    expect(res.status).toBe(400)
    expect(listAlerts().length).toBe(before)
  })
})