import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("../services/browserStudio.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, studioIsOpen: vi.fn(), studioGoogleSession: vi.fn(), openStudio: vi.fn() }
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

describe("Profile — live Google session state", () => {
  let dir
  let headers
  let handleApi
  let studioIsOpen
  let studioGoogleSession
  let openStudio
  let bs
  let profile

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-ghostate-"))
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
    ;({ studioIsOpen, studioGoogleSession, openStudio } = await import("../services/browserStudio.mjs"))
    bs = await import("../services/browserStudio.mjs?case=ghostate-vault")
    profile = await import("../services/profile.mjs?case=ghostate-profile")
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.PICC_AUTH_DATA_DIR
    delete process.env.PICC_PROFILE_DATA_DIR
    delete process.env.PICC_BROWSER_DATA_DIR
  })

  it("reports the browser as closed without touching the link", async () => {
    studioIsOpen.mockReturnValue(false)

    const res = await call(handleApi, "POST", "/api/profile/google/state", {}, headers)
    expect(res.status).toBe(200)
    expect(res.body.available).toBe(false)
    expect(res.body.loggedIn).toBe(false)
    expect(res.body.boundAccount).toBeNull()
    expect(studioGoogleSession).not.toHaveBeenCalled()
  })

  it("rebinds the linked account when the live session differs", async () => {
    studioIsOpen.mockReturnValue(true)
    studioGoogleSession.mockResolvedValue({ ok: true, available: true, onGooglePage: true, method: "list", loggedIn: true, account: "live@account.com", url: "https://accounts.google.com", detail: "isLoginRequired=false, accounts=1" })

    await profile.linkIdentity("u1", "google", { username: "old@account.com", password: "hunter2" })
    await bs.saveSiteCredentials("google", { username: "old@account.com", password: "hunter2" })

    const res = await call(handleApi, "POST", "/api/profile/google/state", { navigate: true }, headers)
    expect(res.status).toBe(200)
    expect(res.body.boundAccount).toBe("live@account.com")
    expect(res.body.linkedAccount).toBe("live@account.com")
    expect(res.body.method).toBe("list")
    expect(res.body.detail).toContain("accounts=1")

    const p = await profile.getProfile("u1")
    expect(p.links.google.username).toBe("live@account.com")

    const creds = await bs.getSiteCredentials("google")
    expect(creds.username).toBe("live@account.com")
    expect(creds.password).toBe("hunter2") // stored password preserved
  })

  it("does not rebind when the session already matches the stored link", async () => {
    studioGoogleSession.mockResolvedValue({ ok: true, available: true, onGooglePage: true, method: "list", loggedIn: true, account: "live@account.com", url: "https://accounts.google.com" })

    const res = await call(handleApi, "POST", "/api/profile/google/state", {}, headers)
    expect(res.status).toBe(200)
    expect(res.body.boundAccount).toBeNull()
    expect(res.body.linkedAccount).toBe("live@account.com")
  })

  it("reports a signed-out session without rebinding", async () => {
    studioGoogleSession.mockResolvedValue({ ok: true, available: true, onGooglePage: true, method: "cookie", loggedIn: false, account: null, url: "https://accounts.google.com" })

    const res = await call(handleApi, "POST", "/api/profile/google/state", {}, headers)
    expect(res.status).toBe(200)
    expect(res.body.loggedIn).toBe(false)
    expect(res.body.method).toBe("cookie")
    expect(res.body.boundAccount).toBeNull()
  })

  it("a Sync with navigate:true auto-opens a closed browser before probing", async () => {
    studioIsOpen.mockReturnValueOnce(false).mockReturnValue(true)
    openStudio.mockResolvedValue({ ok: true, open: true })
    studioGoogleSession.mockResolvedValue({ ok: true, available: true, onGooglePage: true, method: "list", loggedIn: true, account: "live@account.com", url: "https://accounts.google.com" })

    const res = await call(handleApi, "POST", "/api/profile/google/state", { navigate: true }, headers)
    expect(openStudio).toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(res.body.loggedIn).toBe(true)
    expect(res.body.account).toBe("live@account.com")
  })
})
