// WS-4 F1 — follower store: honest persisted truth (broken store never reads as all-clear).
import { appendAudit } from "./auditTrail.mjs"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const DATA_DIR =
  process.env.PICC_COMMAND_CENTRE_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const LEADER_FILE = join(DATA_DIR, "leader-ideas.json")

const canTouchDisk = () =>
  process.env.VITEST !== "true" || Boolean(process.env.PICC_COMMAND_CENTRE_DATA_DIR)

const emptyStore = () => ({ version: 1, leaders: [] })

const UNVERIFIED = { value: "UNVERIFIED", at: null, by: null, evidence: null }

const DENY = {
  storeUnhealthy: "leader:deny:store-unhealthy",
  unknownLeader: "leader:deny:unknown-leader",
  notQualified: "leader:deny:not-qualified",
  missingId: "leader:deny:import-missing-id",
  invalidTrustValue: "leader:deny:invalid-trust-value",
  trustEvidenceRequired: "leader:deny:trust-evidence-required"
}

let store = emptyStore()
let health = { ok: true }

const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : null)

const clone = (x) => JSON.parse(JSON.stringify(x))

function sanitizeRecord(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || raw.id.length === 0) return null
  return {
    id: raw.id,
    label: typeof raw.label === "string" ? raw.label : raw.id,
    source:
      raw.source === "manual" || raw.source === "csv" || raw.source === "hip" ? raw.source : "csv",
    followedAt: typeof raw.followedAt === "string" ? raw.followedAt : null,
    lastPositionAt: typeof raw.lastPositionAt === "string" ? raw.lastPositionAt : null,
    platformTrust: {
      value:
        raw.platformTrust?.value === "VERIFIED" || raw.platformTrust?.value === "ADVERSARIAL"
          ? raw.platformTrust.value
          : "UNVERIFIED",
      at: typeof raw.platformTrust?.at === "string" ? raw.platformTrust.at : null,
      by: typeof raw.platformTrust?.by === "string" ? raw.platformTrust.by : null,
      evidence: typeof raw.platformTrust?.evidence === "string" ? raw.platformTrust.evidence : null
    },
    qualification: {
      verdict: raw.qualification?.verdict === "qualified" ? "qualified" : "denied",
      deny: typeof raw.qualification?.deny === "string" ? raw.qualification.deny : null
    },
    ideas: Array.isArray(raw.ideas) ? raw.ideas : [],
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  }
}

function loadFromDisk() {
  if (!canTouchDisk() || !existsSync(LEADER_FILE)) return { store: emptyStore(), health: { ok: true } }
  try {
    const parsed = JSON.parse(readFileSync(LEADER_FILE, "utf8"))
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      return {
        store: emptyStore(),
        health: { ok: false, reason: "leader-ideas-store-version-mismatch" }
      }
    }
    if (!Array.isArray(parsed.leaders)) {
      return { store: emptyStore(), health: { ok: false, reason: "leader-ideas-store-unreadable" } }
    }
    const leaders = parsed.leaders.map(sanitizeRecord)
    if (leaders.some((r) => r === null)) {
      return { store: emptyStore(), health: { ok: false, reason: "leader-ideas-store-unreadable" } }
    }
    return { store: { version: 1, leaders }, health: { ok: true } }
  } catch {
    return { store: emptyStore(), health: { ok: false, reason: "leader-ideas-store-unreadable" } }
  }
}

function persist() {
  if (!canTouchDisk() || health.ok !== true) return
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(LEADER_FILE, JSON.stringify(store, null, 2), "utf8")
}

export function storeHealth() {
  return { ...health }
}

export function leaderIdeas() {
  if (!health.ok) return null
  return clone(store)
}

export function listLeaders() {
  if (!health.ok) return []
  return clone(store.leaders)
}

export function findLeader(id) {
  if (!health.ok) return null
  const i = store.leaders.findIndex((r) => r.id === id)
  return i === -1 ? null : clone(store.leaders[i])
}

const deny = (code) => ({ ok: false, deny: code })

export function importLeaderRecord(record, { now = Date.now(), audit = appendAudit } = {}) {
  if (!health.ok) return deny(DENY.storeUnhealthy)
  const id = record?.id
  if (typeof id !== "string" || id.length === 0) return deny(DENY.missingId)
  const i = store.leaders.findIndex((r) => r.id === id)
  const existing = i === -1 ? null : store.leaders[i]
  const merged = {
    id,
    label: typeof record.label === "string" && record.label.length > 0 ? record.label : id,
    source:
      record.source === "manual" || record.source === "csv" || record.source === "hip" ? record.source : "csv",
    lastPositionAt: typeof record.lastPositionAt === "string" ? record.lastPositionAt : null,
    qualification: {
      verdict: record.qualification?.verdict === "qualified" ? "qualified" : "denied",
      deny:
        typeof record.qualification?.deny === "string" && record.qualification.deny.length > 0
          ? record.qualification.deny
          : null
    },
    platformTrust: existing ? { ...existing.platformTrust } : { ...UNVERIFIED },
    followedAt: existing && typeof existing.followedAt === "string" ? existing.followedAt : null,
    ideas: Array.isArray(record.ideas) ? clone(record.ideas) : [],
    updatedAt: iso(now)
  }
  if (i === -1) store.leaders.push(merged)
  else store.leaders[i] = merged
  persist()
  audit({
    kind: `leader:import:${id}`,
    data: { leaderId: id, label: merged.label, source: merged.source, qualification: merged.qualification }
  })
  return { ok: true, record: clone(merged) }
}

export function followLeader(id, { now = Date.now(), audit = appendAudit } = {}) {
  if (!health.ok) return deny(DENY.storeUnhealthy)
  const i = store.leaders.findIndex((r) => r.id === id)
  if (i === -1) return deny(DENY.unknownLeader)
  const rec = store.leaders[i]
  if (rec.qualification.verdict !== "qualified") return deny(DENY.notQualified)
  if (typeof rec.followedAt === "string") return { ok: true, record: clone(rec) }
  rec.followedAt = iso(now)
  rec.updatedAt = iso(now)
  persist()
  audit({ kind: `leader:follow:${id}`, data: { leaderId: id, at: rec.followedAt } })
  return { ok: true, record: clone(rec) }
}

export function setPlatformTrust(
  id,
  { value, by = "operator", evidence = "", now = Date.now(), audit = appendAudit } = {}
) {
  if (!health.ok) return deny(DENY.storeUnhealthy)
  const i = store.leaders.findIndex((r) => r.id === id)
  if (i === -1) return deny(DENY.unknownLeader)
  const rec = store.leaders[i]
  if (value !== "VERIFIED" && value !== "ADVERSARIAL" && value !== "UNVERIFIED") {
    return deny(DENY.invalidTrustValue)
  }
  if (value === "UNVERIFIED") return { ok: true, platformTrust: { ...rec.platformTrust } }
  if (typeof evidence !== "string" || evidence.length === 0) return deny(DENY.trustEvidenceRequired)
  const at = iso(now)
  rec.platformTrust = { value, at, by, evidence }
  rec.updatedAt = iso(now)
  persist()
  audit({ kind: `leader:trust:${id}`, data: { leaderId: id, value, by, evidence, at } })
  return { ok: true, platformTrust: { ...rec.platformTrust } }
}

export function resetLeaderIdeasState() {
  store = emptyStore()
  health = { ok: true }
  persist()
  return { ok: true }
}

{
  const loaded = loadFromDisk()
  store = loaded.store
  health = loaded.health
}