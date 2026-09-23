// WS-4 T1 — F2 leader-feed contract + registry (WS-4 R2.1/R2.2/AC-1). Mirrors
// venueAdapterContract.mjs:1-25: frozen CONTRACT_MEMBERS, validateLeaderFeed,
// a Map registry. Provenance (hip|csv|manual) is the first-class lane
// discriminator; HIP is a contract-verified stub (D8) whose fetches return the
// exact leader:deny:hip-not-wired reason.
import { describe, expect, test } from "vitest"

import {
  CONTRACT_MEMBERS,
  FEED_ROW_REQUIRED,
  HIP_NOT_WIRED,
  hipStub,
  leaderFeedFor,
  leaderFeedIds,
  registerLeaderFeed,
  validateFeedRows,
  validateLeaderFeed
} from "../services/copytrade/leaderFeedContract.mjs"

const csvFeed = (over = {}) => ({
  id: "csv-feed-1",
  label: "CSV import feed",
  provenance: "csv",
  fetchIdeas: async () => ({ feed: [], deny: null }),
  fetchPositions: async () => ({ positions: [], deny: null }),
  ...over
})

const manualFeed = (over = {}) => ({
  id: "manual-feed-1",
  label: "Manual lane",
  provenance: "manual",
  fetchIdeas: async () => ({ feed: [], deny: null }),
  fetchPositions: async () => ({ positions: [], deny: null }),
  ...over
})

const row = (over = {}) => ({
  id: "i1",
  at: "2026-09-28T14:30:00.000Z",
  asset: "BTC / USD",
  direction: "long",
  sizeUsd: 1000,
  entryPrice: 65000,
  exitPrice: 66000,
  closedAt: "2026-09-28T14:30:00.000Z",
  pnlAfterCosts: 120.5,
  feesUsd: 0,
  ts: Date.UTC(2026, 8, 28, 14, 30, 0),
  ...over
})

describe("leader feed contract (F2)", () => {
  test("CONTRACT_MEMBERS is frozen and pins provenance + fetch members; row contract pins the required CSV shape", () => {
    expect(Object.isFrozen(CONTRACT_MEMBERS)).toBe(true)
    expect(CONTRACT_MEMBERS.map(([m]) => m).sort()).toEqual([
      "fetchIdeas",
      "fetchPositions",
      "id",
      "label",
      "provenance"
    ])
    expect(Object.isFrozen(FEED_ROW_REQUIRED)).toBe(true)
    const fields = Object.fromEntries(FEED_ROW_REQUIRED)
    expect(fields.id).toBe("string")
    expect(fields.direction).toBe("string")
    expect(fields.feesUsd).toBe("number")
    expect(fields.ts).toBe("number")
  })

  test("validateLeaderFeed accepts a csv feed adapter", () => {
    const { ok, errors } = validateLeaderFeed(csvFeed())
    expect(ok).toBe(true)
    expect(errors).toEqual([])
  })

  test("validateLeaderFeed accepts a manual feed adapter", () => {
    expect(validateLeaderFeed(manualFeed()).ok).toBe(true)
  })

  test("validateLeaderFeed rejects an unknown provenance", () => {
    const { ok, errors } = validateLeaderFeed(csvFeed({ provenance: "banana" }))
    expect(ok).toBe(false)
    expect(errors.some((e) => e.code === "invalid-member" && /provenance/.test(e.message))).toBe(true)
    expect(validateLeaderFeed(csvFeed({ provenance: "" })).ok).toBe(false)
  })

  test("validateLeaderFeed rejects a non-object feed and missing members", () => {
    expect(validateLeaderFeed(null).ok).toBe(false)
    expect(validateLeaderFeed({ id: "x", label: "x", provenance: "csv" }).ok).toBe(false)
    const { errors } = validateLeaderFeed({ id: "x", label: "x", provenance: "csv" })
    expect(errors.map((e) => e.member).filter(Boolean)).toEqual(["fetchIdeas", "fetchPositions"])
  })

  test("registry: registerLeaderFeed throws on invalid/duplicate; leaderFeedFor resolves; leaderFeedIds lists sorted ids", () => {
    expect(() => registerLeaderFeed({ id: "bad", provenance: "csv" })).toThrow(/contract not satisfied/)
    const id = `csv-feed-${Date.now()}`
    registerLeaderFeed(csvFeed({ id }))
    expect(leaderFeedFor(id).id).toBe(id)
    expect(leaderFeedFor("nope")).toBeNull()
    expect(leaderFeedIds()).toEqual([...leaderFeedIds()].sort())
    expect(leaderFeedIds()).toContain(id)
    expect(() => registerLeaderFeed(csvFeed({ id }))).toThrow(/already registered/)
  })

  test("the HIP stub is contract-verified, provenance hip, and both fetches return the exact leader:deny:hip-not-wired reason", async () => {
    expect(Object.isFrozen(hipStub)).toBe(true)
    expect(validateLeaderFeed(hipStub).ok).toBe(true)
    expect(hipStub.provenance).toBe("hip")
    expect(leaderFeedFor("hip")).toBe(hipStub)
    const ideas = await hipStub.fetchIdeas("leader-x")
    expect(ideas).toEqual({ feed: [], deny: HIP_NOT_WIRED })
    expect(ideas.deny).toBe("leader:deny:hip-not-wired — endpoint contract unverified")
    const positions = await hipStub.fetchPositions("leader-x")
    expect(positions.deny).toBe("leader:deny:hip-not-wired — endpoint contract unverified")
  })

  test("validateFeedRows accepts a well-formed R2.1 row (nullable closedAt/exitPrice/pnlAfterCosts tolerated)", () => {
    expect(validateFeedRows([row()]).ok).toBe(true)
    expect(validateFeedRows([row({ exitPrice: null, closedAt: null, pnlAfterCosts: null })]).ok).toBe(true)
  })

  test("validateFeedRows rejects rows missing fields and bad directions", () => {
    expect(validateFeedRows("nope").ok).toBe(false)
    expect(validateFeedRows([{ id: "i1" }]).ok).toBe(false)
    expect(validateFeedRows([row({ direction: "naked" })]).ok).toBe(false)
    expect(validateFeedRows([row({ sizeUsd: "1000" })]).ok).toBe(false)
    const { errors } = validateFeedRows([row({ direction: "naked" })])
    expect(errors[0].code).toBe("invalid-field")
    expect(errors[0].field).toBe("direction")
  })
})