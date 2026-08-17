import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

let tmp
let handleApi
let createAccount

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
    }
  }
}

async function call(method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-creds-"))
  process.env.PICC_AUTOMATOR_DATA_DIR = tmp
  process.env.PICC_AUTH_DATA_DIR = tmp
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_DATA_DIR = tmp
  vi.resetModules()
  ;({ handleApi } = await import("../handlers.mjs"))
  ;({ createAccount } = await import("../services/auth.mjs"))
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe("credentials endpoints", () => {
  it("never echoes stored automator secrets when saving", async () => {
    const res = await call("POST", "/api/automator/credentials", {
      honeygainToken: "sekret-token",
      pawnsPassword: "hunter2",
      pollIntervalMinutes: 30
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.honeygainToken).not.toBe("sekret-token")
    expect(res.body.pawnsPassword).not.toBe("hunter2")
    expect(res.body.pollIntervalMinutes).toBe(30)
    const saved = JSON.parse(readFileSync(join(tmp, "automator-credentials.json"), "utf8"))
    expect(saved.honeygainToken).toBe("sekret-token")
    expect(saved.pawnsPassword).toBe("hunter2")
  })

  it("masks automator secrets on GET", async () => {
    const res = await call("GET", "/api/automator/credentials")
    expect(res.status).toBe(200)
    expect(res.body.honeygainToken).not.toBe("sekret-token")
    expect(res.body.pawnsPassword).not.toBe("hunter2")
  })

  it("keeps existing automator tokens when a blank field is saved", async () => {
    await call("POST", "/api/automator/credentials", { honeygainToken: "keep-me" })
    const res = await call("POST", "/api/automator/credentials", { pollIntervalMinutes: 10 })
    expect(res.status).toBe(200)
    const saved = JSON.parse(readFileSync(join(tmp, "automator-credentials.json"), "utf8"))
    expect(saved.honeygainToken).toBe("keep-me")
    expect(saved.pollIntervalMinutes).toBe(10)
  })

  it("never echoes trading secrets when saving", async () => {
    const res = await call("POST", "/api/trading/credentials", { expertoptionToken: "eo-tok", riskPerTradePct: 5 })
    expect(res.status).toBe(200)
    expect(res.body.expertoptionToken).not.toBe("eo-tok")
    expect(res.body.riskPerTradePct).toBe(5)
  })

  it("requires auth on credentials once an account exists", async () => {
    const acct = await createAccount({ email: "a@b.com", password: "password123", name: "Test" })
    expect(acct.token).toBeTruthy()

    const noAuth = await call("GET", "/api/automator/credentials")
    expect(noAuth.status).toBe(401)

    const authed = await call("GET", "/api/automator/credentials", undefined, {
      authorization: `Bearer ${acct.token}`
    })
    expect(authed.status).toBe(200)
  })
})

describe("data store row isolation", () => {
  it("only exposes rows owned by the requesting user", async () => {
    const a = await createAccount({ email: "a@x.com", password: "password123", name: "A" })
    const b = await createAccount({ email: "b@x.com", password: "password123", name: "B" })
    const authA = { authorization: `Bearer ${a.token}` }
    const authB = { authorization: `Bearer ${b.token}` }

    const created = await call("POST", "/api/data/simulations", { note: "secret-for-A" }, authA)
    expect(created.status).toBe(200)
    const id = created.body.row.id
    expect(created.body.row.user_id).toBe(a.user.id)

    const asA = await call("GET", "/api/data/simulations", undefined, authA)
    expect(asA.status).toBe(200)
    expect(asA.body.rows.map((r) => r.id)).toContain(id)

    const asB = await call("GET", "/api/data/simulations", undefined, authB)
    expect(asB.status).toBe(200)
    expect(asB.body.rows.map((r) => r.id)).not.toContain(id)

    const removeAsB = await call("POST", "/api/data/simulations/remove", { id }, authB)
    expect(removeAsB.status).toBe(404)

    const removeAsA = await call("POST", "/api/data/simulations/remove", { id }, authA)
    expect(removeAsA.status).toBe(200)
    expect(removeAsA.body.removed).toBe(true)
  })
})
