import { describe, expect, it } from "vitest"
import { automatorIssuesFrom, automatorTotals, jwtInfo } from "../services/automator.mjs"

function b64url(s) {
  return Buffer.from(s)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function makeJwt(expSec) {
  const header = b64url(JSON.stringify({ alg: "none" }))
  const payload = b64url(JSON.stringify({ sub: "test", exp: expSec }))
  return `${header}.${payload}.sig`
}

const NOW = Math.floor(Date.now() / 1000)
const DAY = 86_400

describe("jwtInfo", () => {
  it("decodes exp from a valid 3-segment JWT", () => {
    const info = jwtInfo(makeJwt(NOW + DAY))
    expect(info.valid).toBe(true)
    expect(info.exp).toBe(NOW + DAY)
    expect(info.daysLeft).toBeCloseTo(1, 1)
    expect(info.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("rejects tokens that are not 3-segment JWTs", () => {
    expect(jwtInfo("").valid).toBe(false)
    expect(jwtInfo("not.a.jwt").valid).toBe(false)
    expect(jwtInfo("abc.def").valid).toBe(false)
    expect(jwtInfo(123).valid).toBe(false)
  })

  it("reports negative daysLeft for an expired token", () => {
    const info = jwtInfo(makeJwt(NOW - DAY))
    expect(info.valid).toBe(true)
    expect(info.daysLeft).toBeLessThan(0)
  })
})

describe("automatorIssuesFrom", () => {
  const status = {
    providers: {
      pawns: { platform: "Pawns", configured: true, status: "error", error: "boom" },
      traffmonetizer: {
        platform: "Traffmonetizer",
        configured: true,
        status: "ok",
        balance: 12,
        payoutThreshold: 10,
        tokenExpiresInDays: 2
      },
      repocket: { platform: "Repocket", configured: true, status: "ok", balance: 1, payoutThreshold: 10, tokenExpiresInDays: 2 }
    }
  }
  const nodes = [
    { id: "honeygain", name: "Honeygain", detected: false },
    { id: "iproyal", name: "IPRoyal Pawns", detected: true },
    { id: "traffmonetizer", name: "Traffmonetizer", detected: false },
    { id: "repocket", name: "Repocket", detected: false }
  ]

  it("flags collector errors, payout-ready balances and expiring tokens", () => {
    const issues = automatorIssuesFrom(status, nodes)
    expect(issues.some((i) => i.severity === "danger" && i.topic === "collector" && i.message.includes("boom"))).toBe(true)
    expect(issues.some((i) => i.topic === "payout" && i.severity === "success")).toBe(true)
    expect(issues.some((i) => i.topic === "credential" && i.severity === "warn")).toBe(true)
  })

  it("cross-references configured providers against the node scan", () => {
    const issues = automatorIssuesFrom(status, nodes)
    expect(issues.some((i) => i.topic === "node" && i.platform === "IPRoyal Pawns" && i.severity === "success")).toBe(true)
    expect(issues.some((i) => i.topic === "node" && i.platform === "Traffmonetizer" && i.severity === "info")).toBe(true)
    expect(issues.some((i) => i.platform === "Honeygain")).toBe(false) // not configured -> ignored
  })

  it("is empty for a clean status", () => {
    const clean = {
      providers: {
        honeygain: { platform: "Honeygain", configured: true, status: "ok", balance: 2, payoutThreshold: 20, estimatedDaily: 0.1 }
      }
    }
    expect(automatorIssuesFrom(clean, [])).toEqual([])
  })
})

describe("automatorTotals", () => {
  it("counts configured, ready and detected nodes", () => {
    const status = {
      providers: {
        a: { configured: true, status: "ok", balance: 25, payoutThreshold: 20 },
        b: { configured: true, status: "ok", balance: 2, payoutThreshold: 20 },
        c: { configured: false, status: "not_configured" }
      },
      manual: [{ balance: 6, payoutThreshold: 5 }]
    }
    const nodes = [
      { detected: true },
      { detected: false },
      { detected: true }
    ]
    const totals = automatorTotals(status, nodes)
    expect(totals.configured).toBe(2)
    expect(totals.ready).toBe(2)
    expect(totals.nodesDetected).toBe(2)
    expect(totals.nodesTotal).toBe(3)
  })
})
