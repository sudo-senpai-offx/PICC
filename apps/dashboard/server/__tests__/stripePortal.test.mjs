import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { env } from "../config.mjs"

// Force the local (non-Supabase) billing path by making admin null, and mock
// the Stripe service so no real SDK/network call occurs. We assert WHICH
// customer createPortalSession sees — the IDOR fix must use the user's OWN.
const portalCalls = []
vi.mock("../services/stripe.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    hasStripe: () => Boolean(env.stripeSecretKey),
    createPortalSession: vi.fn(async (customerId) => {
      portalCalls.push(customerId)
      return { url: `https://billing.stripe.com/${encodeURIComponent(customerId)}` }
    })
  }
})
vi.mock("../services/supabase.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, admin: null }
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

async function call(method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

let handleApi
let token

describe("Stripe customer portal — ownership (IDOR) fix", () => {
  let dir

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-stripeportal-"))
    process.env.PICC_AUTH_DATA_DIR = dir
    process.env.PICC_PROFILE_DATA_DIR = dir
    process.env.PICC_DATA_DIR = dir
    token = randomBytes(16).toString("hex")
    writeFileSync(
      join(dir, "sessions.json"),
      JSON.stringify({ sessions: { [token]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 60_000 } } })
    )
    writeFileSync(
      join(dir, "billing.json"),
      JSON.stringify([
        { id: "b1", user_id: "u1", subscription_status: "active", subscription_tier: "pro", stripe_customer_id: "cus_u1_own", updated_at: new Date().toISOString() }
      ])
    )
    env.stripeSecretKey = "sk_test_dummy"
    vi.resetModules()
    ;({ handleApi } = await import("../handlers.mjs"))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.PICC_AUTH_DATA_DIR
    delete process.env.PICC_PROFILE_DATA_DIR
    delete process.env.PICC_DATA_DIR
    env.stripeSecretKey = ""
    vi.resetModules()
  })

  it("opens the portal for the authenticated user's OWN customer, ignoring a spoofed customerId in the body", async () => {
    portalCalls.length = 0
    const res = await call(
      "POST",
      "/api/stripe/portal",
      { customerId: "cus_victim" },
      { authorization: `Bearer ${token}` }
    )
    expect(res.status).toBe(200)
    expect(res.body.url).toContain("cus_u1_own")
    expect(portalCalls).toEqual(["cus_u1_own"])
  })

  it("returns 400 when the user has no Stripe customer on file", async () => {
    portalCalls.length = 0
    writeFileSync(join(dir, "billing.json"), JSON.stringify([
      { id: "b2", user_id: "u1", subscription_status: "active", subscription_tier: "pro", stripe_customer_id: null }
    ]))
    const res = await call(
      "POST",
      "/api/stripe/portal",
      { customerId: "cus_anything" },
      { authorization: `Bearer ${token}` }
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("no Stripe customer")
    expect(portalCalls).toEqual([])
  })
})
