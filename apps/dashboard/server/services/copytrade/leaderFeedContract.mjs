// WS-4 F2 — leader-feed contract + registry (WS-4 R2.1/R2.2). Mirrors
// venueAdapterContract.mjs:1-25: a frozen CONTRACT_MEMBERS shape, validate
// helper, and a shared Map registry. provenance (hip|csv|manual) is a
// first-class lane discriminator. HIP is a contract-verified STUB (D8): its
// fetches always resolve to the exact leader:deny:hip-not-wired reason — the
// feed lane is registered but not wired to any live client.

export const CONTRACT_MEMBERS = Object.freeze([
  ["id", "string"],
  ["label", "string"],
  ["provenance", "string"],
  ["fetchIdeas", "function"],
  ["fetchPositions", "function"]
])

const PROVENANCES = Object.freeze(["hip", "csv", "manual"])

export const FEED_ROW_REQUIRED = Object.freeze([
  ["id", "string"],
  ["at", "string"],
  ["asset", "string"],
  ["direction", "string"],
  ["sizeUsd", "number"],
  ["entryPrice", "number"],
  ["feesUsd", "number"],
  ["ts", "number"]
])

const FEED_ROW_NULLABLE = Object.freeze(["exitPrice", "closedAt", "pnlAfterCosts"])
const DIRECTIONS = Object.freeze(["long", "short", "spread"])

export const HIP_NOT_WIRED = "leader:deny:hip-not-wired"

export const registry = new Map()

export function validateLeaderFeed(feed) {
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    return { ok: false, errors: [{ code: "adapter-not-object", message: "leader feed must be an object" }] }
  }
  const errors = []
  for (const [member, kind] of CONTRACT_MEMBERS) {
    const value = feed[member]
    if (value == null) {
      errors.push({ code: "missing-member", member, message: `leader feed missing member "${member}"` })
      continue
    }
    if (kind === "function" && typeof value !== "function") {
      errors.push({ code: "invalid-member", member, message: `leader feed member "${member}" must be a function` })
    } else if (kind === "string" && (typeof value !== "string" || value.trim() === "")) {
      errors.push({ code: "invalid-member", member, message: `leader feed member "${member}" must be a non-empty string` })
    }
  }
  if (typeof feed.provenance === "string" && !PROVENANCES.includes(feed.provenance)) {
    errors.push({
      code: "invalid-member",
      member: "provenance",
      message: `leader feed member "provenance" must be one of ${PROVENANCES.join("|")}, got "${feed.provenance}"`
    })
  } else if (feed.provenance != null && typeof feed.provenance !== "string") {
    errors.push({
      code: "invalid-member",
      member: "provenance",
      message: `leader feed member "provenance" must be one of ${PROVENANCES.join("|")}`
    })
  }
  return { ok: errors.length === 0, errors }
}

export function registerLeaderFeed(feed) {
  const { ok, errors } = validateLeaderFeed(feed)
  if (!ok) {
    throw new Error(`leader feed contract not satisfied — ${errors.map((e) => e.message).join("; ")}`)
  }
  const id = String(feed.id).trim()
  if (registry.has(id)) {
    throw new Error(`leader feed already registered for id "${id}"`)
  }
  registry.set(id, feed)
}

export function leaderFeedFor(id) {
  const key = String(id ?? "").trim()
  return registry.get(key) ?? null
}

export function leaderFeedIds() {
  return [...registry.keys()].sort()
}

export function validateFeedRows(rows) {
  if (!Array.isArray(rows)) {
    return { ok: false, errors: [{ code: "rows-not-array", message: "feed rows must be an array" }] }
  }
  const errors = []
  rows.forEach((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push({ code: "row-not-object", row: i, message: `feed row ${i} must be an object` })
      return
    }
    for (const [field, kind] of FEED_ROW_REQUIRED) {
      const value = row[field]
      if (value == null) {
        errors.push({ code: "missing-field", row: i, field, message: `feed row ${i} missing field "${field}"` })
      } else if (kind === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
        errors.push({ code: "invalid-field", row: i, field, message: `feed row ${i} field "${field}" must be a finite number` })
      } else if (kind === "string" && (typeof value !== "string" || value.trim() === "")) {
        errors.push({ code: "invalid-field", row: i, field, message: `feed row ${i} field "${field}" must be a non-empty string` })
      }
    }
    for (const field of FEED_ROW_NULLABLE) {
      const value = row[field]
      if (value != null && typeof value !== "number" && typeof value !== "string") {
        errors.push({ code: "invalid-field", row: i, field, message: `feed row ${i} field "${field}" must be a number|string|null` })
      }
    }
    if (row.direction != null && !DIRECTIONS.includes(row.direction)) {
      errors.push({
        code: "invalid-field",
        row: i,
        field: "direction",
        message: `feed row ${i} field "direction" must be one of ${DIRECTIONS.join("|")}, got "${row.direction}"`
      })
    }
  })
  return { ok: errors.length === 0, errors }
}

const idStub = (val) => Object.freeze({ id: "hip", label: "HIP feed (stub, D8)", provenance: "hip", fetchIdeas: async () => ({ feed: [], deny: val }), fetchPositions: async () => ({ positions: [], deny: val }) })

export const hipStub = idStub(HIP_NOT_WIRED)

registerLeaderFeed(hipStub)