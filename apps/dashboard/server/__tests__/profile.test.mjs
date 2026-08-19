import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { env } from "../config.mjs"

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

let dir
let m

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "picc-profile-"))
  process.env.PICC_PROFILE_DATA_DIR = dir
  process.env.PICC_AUTH_DATA_DIR = dir
  process.env.PICC_BROWSER_DATA_DIR = dir
  m = await import("../services/profile.mjs?case=profile-service")
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.PICC_PROFILE_DATA_DIR
  delete process.env.PICC_AUTH_DATA_DIR
  delete process.env.PICC_BROWSER_DATA_DIR
})

describe("Profile service — settings", () => {
  it("returns an empty profile before anything is saved", async () => {
    const p = await m.getProfile("u1")
    expect(p.ok).toBe(true)
    expect(p.name).toBe("")
    expect(p.links).toEqual({})
    expect(p.githubOauth).toEqual({ clientId: "", hasSecret: false })
  })

  it("saves and reads back the display name", async () => {
    expect((await m.updateProfileName("u1", "Alex Tan")).name).toBe("Alex Tan")
    expect((await m.getProfile("u1")).name).toBe("Alex Tan")
  })

  it("clamps name length", async () => {
    expect((await m.updateProfileName("u1", "x".repeat(500))).name.length).toBe(120)
  })
})

describe("Profile service — linked identities", () => {
  it("links, lists and unlinks a google account", async () => {
    expect((await m.linkIdentity("u1", "google", { username: "g@gmail.com" })).ok).toBe(true)
    expect((await m.getProfile("u1")).links.google.username).toBe("g@gmail.com")

    const un = await m.unlinkIdentity("u1", "google")
    expect(un.unlinked).toBe(true)
    expect((await m.getProfile("u1")).links.google).toBeUndefined()
  })

  it("unlink of a missing provider reports unlinked:false", async () => {
    expect((await m.unlinkIdentity("u1", "nope")).unlinked).toBe(false)
  })

  it("requires a username to link", async () => {
    expect((await m.linkIdentity("u1", "email", { username: "" })).ok).toBe(false)
  })
})

describe("Profile service — GitHub OAuth (PKCE)", () => {
  it("rejects begin before OAuth is configured", async () => {
    await expect(m.beginGithubOauth("u2", "http://localhost/callback")).rejects.toThrow("not configured")
  })

  it("saves the client id and keeps the secret masked", async () => {
    const saved = await m.saveGithubOauth("u2", { clientId: "Iv23", clientSecret: "shhh" })
    expect(saved.clientId).toBe("Iv23")
    expect(saved.hasSecret).toBe(true)
    const p = await m.getProfile("u2")
    expect(p.githubOauth.hasSecret).toBe(true)
    expect(JSON.stringify(p)).not.toContain("shhh")
  })

  it("saving an empty secret keeps the existing one", async () => {
    expect((await m.saveGithubOauth("u2", { clientId: "Iv23" })).hasSecret).toBe(true)
  })

  it("requires a client id", async () => {
    expect((await m.saveGithubOauth("u2", { clientId: "" })).ok).toBe(false)
  })

  it("builds an authorize URL with PKCE and state", async () => {
    const flow = await m.beginGithubOauth("u2", "http://localhost:5173/api/profile/github/callback")
    expect(flow.state).toBeTruthy()
    expect(flow.callbackUrl).toContain("/api/profile/github/callback")
    expect(flow.authorizeUrl).toContain("client_id=Iv23")
    expect(flow.authorizeUrl).toContain("code_challenge_method=S256")
    expect(flow.authorizeUrl).toContain("scope=read%3Auser+user%3Aemail")
  })

  it("rejects completion with an unknown/expired state", async () => {
    expect((await m.completeGithubOauth({ code: "x", state: "bogus" })).ok).toBe(false)
  })

  it("exchanges the code for a token and stores the linked GitHub user server-side", async () => {
    const fakeFetch = vi.fn((url) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return Promise.resolve({ json: () => Promise.resolve({ access_token: "tok-123" }) })
      }
      if (url === "https://api.github.com/user") {
        return Promise.resolve({ json: () => Promise.resolve({ login: "octocat", email: "octo@github.com" }) })
      }
      return Promise.resolve({ json: () => Promise.resolve([]) })
    })
    vi.stubGlobal("fetch", fakeFetch)

    const flow = await m.beginGithubOauth("u2", "http://localhost:5173/api/profile/github/callback")
    const done = await m.completeGithubOauth({ code: "the-code", state: flow.state })
    expect(done.ok).toBe(true)
    expect(done.username).toBe("octocat")

    // Token + email persist server-side (raw store) but are never leaked via getProfile.
    const p = await m.getProfile("u2")
    expect(p.links.github.username).toBe("octocat")
    expect(JSON.stringify(p)).not.toContain("tok-123")
    const raw = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8"))
    expect(raw.users.u2.links.github.email).toBe("octo@github.com")
    expect(raw.users.u2.links.github.token).toBe("tok-123")

    // The exchange used the state-bound code verifier + redirect_uri.
    const [, init] = fakeFetch.mock.calls.find(([u]) => u === "https://github.com/login/oauth/access_token")
    expect(init.body.get("code_verifier").length).toBe(43)
    expect(init.body.get("redirect_uri")).toContain("/api/profile/github/callback")
    expect(init.body.get("client_secret")).toBe("shhh")
    vi.unstubAllGlobals()
  })

  it("returns a helpful error when token exchange fails", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ json: () => Promise.resolve({ error: "bad_verification_code" }) }))
    const flow = await m.beginGithubOauth("u2", "http://localhost/callback")
    expect((await m.completeGithubOauth({ code: "nope", state: flow.state })).ok).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe("Profile HTTP endpoints", () => {
  let envSnap
  let hApi
  let token

  beforeAll(async () => {
    envSnap = { ...env }
    for (const k of Object.keys(envSnap)) env[k] = ""
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in tests"))))
    vi.resetModules()
    hApi = (await import("../handlers.mjs?case=profile-http")).handleApi
  })

  afterAll(() => {
    for (const k of Object.keys(envSnap)) env[k] = envSnap[k]
    vi.unstubAllGlobals()
  })

  it("signs up a user and round-trips profile settings", async () => {
    const signup = await call(hApi, "POST", "/api/auth/signup", {
      email: "pro@test.dev",
      password: "password123",
      name: "Tester"
    })
    expect(signup.status).toBe(200)
    token = signup.body.token
    const auth = { authorization: `Bearer ${token}` }

    let res = await call(hApi, "GET", "/api/profile", null, auth)
    expect(res.status).toBe(200)
    expect(res.body.links).toEqual({})

    res = await call(hApi, "POST", "/api/profile/name", { name: "Alex Tan" }, auth)
    expect(res.body.ok).toBe(true)
    expect(res.body.name).toBe("Alex Tan")

    res = await call(hApi, "GET", "/api/profile", null, auth)
    expect(res.body.name).toBe("Alex Tan")
  })

  it("requires authentication once users exist", async () => {
    const res = await call(hApi, "GET", "/api/profile")
    expect(res.status).toBe(401)
  })

  it("links a google account (storing the credential in the vault) and unlinks it", async () => {
    const auth = { authorization: `Bearer ${token}` }

    let res = await call(hApi, "POST", "/api/profile/link", { provider: "google", username: "g@gmail.com", password: "pw" }, auth)
    expect(res.status).toBe(200)
    expect(res.body.username).toBe("g@gmail.com")

    res = await call(hApi, "GET", "/api/profile", null, auth)
    expect(res.body.links.google.username).toBe("g@gmail.com")

    res = await call(hApi, "POST", "/api/profile/unlink", { provider: "google" }, auth)
    expect(res.body.unlinked).toBe(true)

    res = await call(hApi, "GET", "/api/profile", null, auth)
    expect(res.body.links.google).toBeUndefined()
  })

  it("rejects unknown providers and missing usernames", async () => {
    const auth = { authorization: `Bearer ${token}` }
    expect((await call(hApi, "POST", "/api/profile/link", { provider: "x", username: "a" }, auth)).status).toBe(400)
    expect((await call(hApi, "POST", "/api/profile/link", { provider: "email", username: "" }, auth)).status).toBe(400)
  })

  it("saves GitHub OAuth config and begins an OAuth flow with a same-origin callback", async () => {
    const auth = { authorization: `Bearer ${token}` }

    let res = await call(hApi, "POST", "/api/profile/github/oauth", { clientId: "Iv23", clientSecret: "shhh" }, auth)
    expect(res.status).toBe(200)
    expect(res.body.hasSecret).toBe(true)

    res = await call(hApi, "POST", "/api/profile/github/begin", {}, auth)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.authorizeUrl).toContain("code_challenge_method=S256")
    expect(res.body.callbackUrl).toBe("http://localhost:3000/api/profile/github/callback")

    res = await call(hApi, "POST", "/api/profile/github/oauth", { clientId: "" }, auth)
    expect(res.status).toBe(400)
  })

  it("renders an HTML result page for the OAuth callback (bad state)", async () => {
    const raw = {
      status: null,
      body: "",
      writeHead(s) {
        this.status = s
      },
      end(b) {
        this.body = b
      }
    }
    const path = "/api/profile/github/callback?code=x&state=nope"
    await hApi(makeReq("GET", path), raw, path)
    expect(raw.status).toBe(400)
    expect(raw.body).toContain("expired")
  })
})
