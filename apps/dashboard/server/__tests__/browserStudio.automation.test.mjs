import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    }
  }
}

async function call(handleApi, method, path, body) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body), res, path)
  return res
}

describe("Browser automation — pure helpers", () => {
  it("maps detected site ids to tuned connector slugs", async () => {
    const { siteToConnectorSlug } = await import("../services/browserStudio.mjs")
    expect(siteToConnectorSlug("honeygain")).toBe("honeygain")
    expect(siteToConnectorSlug("iproyal")).toBe("pawns")
    expect(siteToConnectorSlug("nft-royalties")).toBe("opensea")
    expect(siteToConnectorSlug("defi-supply")).toBe("aave")
    expect(siteToConnectorSlug("mysterium")).toBe("mysterium")
    expect(siteToConnectorSlug("packetstream")).toBeNull()
    expect(siteToConnectorSlug("")).toBeNull()
  })

  it("suggests payout threshold progress and flags when reached", async () => {
    const { automationSuggestions } = await import("../services/browserStudio.mjs")
    const site = { id: "honeygain", note: "1 credit = $0.001." }
    const near = automationSuggestions(site, { balance: 10, today: 1.25, lifetime: 42, payoutThreshold: 20, estimatedDaily: 1.5 })
    expect(near.join("\n")).toContain("Balance: $10.00")
    expect(near.join("\n")).toContain("50% of the $20.00 payout threshold.")
    expect(near.join("\n")).toContain("Earned today: $1.25")
    expect(near.join("\n")).toContain("Estimated daily: $1.50")
    expect(near.join("\n")).toContain("1 credit = $0.001.")

    const ready = automationSuggestions(site, { balance: 21, today: null, lifetime: null, payoutThreshold: 20, estimatedDaily: null })
    expect(ready.join("\n")).toContain("Payout threshold reached — you can withdraw.")
  })

  it("falls back when nothing is readable and still appends the site note", async () => {
    const { automationSuggestions } = await import("../services/browserStudio.mjs")
    const site = { id: "earnapp", note: "Desktop-only." }
    const out = automationSuggestions(site, { balance: null, today: null, lifetime: null, payoutThreshold: null, estimatedDaily: null })
    expect(out[0]).toContain("No readable figures yet")
    expect(out).toContain("Desktop-only.")
  })

  it("detects the mysterium canonical host for both TLDs", async () => {
    const { detectSite } = await import("../services/browserStudio.mjs")
    expect(detectSite("https://mystnodes.co").id).toBe("mysterium")
    expect(detectSite("https://mystnodes.com").id).toBe("mysterium")
  })
})

describe("Browser automation — API routes", () => {
  let handleApi
  let tmp

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "picc-browser-automation-"))
    process.env.PICC_AUTH_DATA_DIR = tmp
    process.env.PICC_BROWSER_DATA_DIR = tmp
    vi.resetModules()
    ;({ handleApi } = await import("../handlers.mjs"))
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it("returns 409 when automating a closed browser", async () => {
    const res = await call(handleApi, "POST", "/api/browser/automate")
    expect(res.status).toBe(409)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toContain("not open")
  })

  it("starts and stops the autonomous loop via the API", async () => {
    const started = await call(handleApi, "POST", "/api/browser/automate/start", { intervalMs: 5000 })
    expect(started.status).toBe(200)
    expect(started.body.ok).toBe(true)
    expect(started.body.running).toBe(true)
    expect(started.body.intervalMs).toBe(5000)
    // Loop is safe + read-only: it never launches the browser itself.
    expect(started.body.lastError).toBeNull()

    const status = await call(handleApi, "GET", "/api/browser/automate/status")
    expect(status.status).toBe(200)
    expect(status.body.running).toBe(true)

    const stopped = await call(handleApi, "POST", "/api/browser/automate/stop")
    expect(stopped.body.running).toBe(false)

    const after = await call(handleApi, "GET", "/api/browser/automate/status")
    expect(after.body.running).toBe(false)
  })

  it("clamps the loop interval to a sane minimum", async () => {
    const res = await call(handleApi, "POST", "/api/browser/automate/start", { intervalMs: 1 })
    expect(res.body.intervalMs).toBe(5000)
    await call(handleApi, "POST", "/api/browser/automate/stop")
  })
})
