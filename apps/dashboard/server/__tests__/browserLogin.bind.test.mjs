import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("../services/browserStudio.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, studioLogin: vi.fn() }
})

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

async function call(hApi, method, path, body, headers) {
  const res = makeRes()
  await hApi(makeReq(method, path, body, headers), res, path)
  return res
}

describe("Browser login — Google account rebind", () => {
  let dir
  let headers
  let handleApi
  let studioLogin
  let bs
  let profile

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-login-bind-"))
    process.env.PICC_AUTH_DATA_DIR = dir
    process.env.PICC_PROFILE_DATA_DIR = dir
    process.env.PICC_BROWSER_DATA_DIR = dir
    vi.resetModules()
    const token = randomBytes(16).toString("hex")
    writeFileSync(
      join(dir, "sessions.json"),
      JSON.stringify({ sessions: { [token]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 60_000 } } })
    )
    headers = { authorization: `Bearer ${token}` }
    ;({ handleApi } = await import("../handlers.mjs"))
    ;({ studioLogin } = await import("../services/browserStudio.mjs"))
    bs = await import("../services/browserStudio.mjs?case=bind-vault")
    profile = await import("../services/profile.mjs?case=bind-profile")
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.PICC_AUTH_DATA_DIR
    delete process.env.PICC_PROFILE_DATA_DIR
    delete process.env.PICC_BROWSER_DATA_DIR
  })

  it("rebinds the linked identity and vault username to the current Google session", async () => {
    await bs.saveSiteCredentials("google", { username: "old@account.com", password: "hunter2" })
    await profile.linkIdentity("u1", "google", { username: "old@account.com", password: "hunter2" })

    studioLogin.mockResolvedValue({
      ok: true,
      site: "google",
      mode: "google",
      steps: ["password"],
      submitted: true,
      error: null,
      loggedIn: true,
      account: "new@account.com",
      boundTo: "new@account.com"
    })

    const res = await call(handleApi, "POST", "/api/browser/login", { site: "google" }, headers)
    expect(res.status).toBe(200)
    expect(res.body.boundAccount).toBe("new@account.com")

    const p = await profile.getProfile("u1")
    expect(p.links.google.username).toBe("new@account.com")

    const creds = await bs.getSiteCredentials("google")
    expect(creds.username).toBe("new@account.com")
    expect(creds.password).toBe("hunter2") // stored password is preserved
  })

  it("leaves the link untouched when the session reports no new account", async () => {
    studioLogin.mockResolvedValue({
      ok: true,
      site: "google",
      mode: "google",
      steps: [],
      submitted: false,
      error: null,
      loggedIn: true,
      account: "old@account.com"
    })

    const res = await call(handleApi, "POST", "/api/browser/login", { site: "google" }, headers)
    expect(res.status).toBe(200)
    expect(res.body.boundAccount).toBeUndefined()
    const p = await profile.getProfile("u1")
    expect(p.links.google.username).toBe("new@account.com")
  })

  it("maps browser-closed failures to 409 like the rest of the browser routes", async () => {
    studioLogin.mockRejectedValue({ code: "BROWSER_CLOSED", message: "browser is not available — open the browser first" })
    const res = await call(handleApi, "POST", "/api/browser/login", { site: "google" }, headers)
    expect(res.status).toBe(409)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toContain("not available")
  })
})
