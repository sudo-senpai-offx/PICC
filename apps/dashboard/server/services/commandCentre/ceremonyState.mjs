// WS-3 F1 ceremonyState — persistent per-venue-class ceremony store (R1). Honesty contract (ADR-0005): this store is a persistent PROJECTION of spendable ledger rows (each credit records ledgerSeq); sim/untagged rows are named denies (ceremony:deny:sim-row / ceremony:deny:untagged-class), never silent skips; enablement/platformVerification are written only by deliberate ceremony actions, never by the credit path.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { dayKeyOf } from "../u4faRisk.mjs"

const DATA_DIR =
  process.env.PICC_COMMAND_CENTRE_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const CEREMONY_FILE = join(DATA_DIR, "ceremony-state.json")

const canTouchDisk = () =>
  process.env.VITEST !== "true" || Boolean(process.env.PICC_COMMAND_CENTRE_DATA_DIR)

export const STREAK_LIMIT = 50
export const KNOWN_VENUE_CLASSES = ["ccxt-crypto", "hyperliquid-perps", "expertoption"]

const emptyClass = () => ({
  windowOpenedAt: null,
  lastCreditAt: null,
  spendableResolved: 0,
  byEngine: {},
  streak: [],
  tradingDays: []
})

const emptyStore = () => ({
  version: 1,
  classes: {},
  enablement: Object.fromEntries(KNOWN_VENUE_CLASSES.map((vk) => [vk, null])),
  platformVerification: { expertoption: null },
  assetClasses: {}
})

let ceremonyStoreHealth = { ok: true }
let creditedSeqs = {}
let denialLog = []
let store = boot()
let resolveWired = false

function boot() {
  if (!canTouchDisk() || !existsSync(CEREMONY_FILE)) return emptyStore()
  let data
  try {
    data = JSON.parse(readFileSync(CEREMONY_FILE, "utf8"))
  } catch {
    ceremonyStoreHealth = { ok: false, reason: "ceremony-state-store-unreadable" }
    return null
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.version !== 1) {
    const versionMismatch = data && typeof data === "object" && !Array.isArray(data) && data.version !== 1
    ceremonyStoreHealth = {
      ok: false,
      reason: versionMismatch ? "ceremony-state-store-version-mismatch" : "ceremony-state-store-unreadable"
    }
    return null
  }
  const root = emptyStore()
  if (data.classes && typeof data.classes === "object" && !Array.isArray(data.classes)) {
    for (const [vk, v] of Object.entries(data.classes)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue
      root.classes[vk] = {
        ...emptyClass(),
        ...v,
        byEngine: v.byEngine && typeof v.byEngine === "object" && !Array.isArray(v.byEngine) ? v.byEngine : {},
        streak: Array.isArray(v.streak) ? v.streak : [],
        tradingDays: Array.isArray(v.tradingDays) ? v.tradingDays : []
      }
    }
  }
  if (data.enablement && typeof data.enablement === "object" && !Array.isArray(data.enablement)) {
    root.enablement = { ...root.enablement, ...data.enablement }
  }
  if (data.platformVerification && typeof data.platformVerification === "object" && !Array.isArray(data.platformVerification)) {
    root.platformVerification = { ...root.platformVerification, ...data.platformVerification }
  }
  if (data.assetClasses && typeof data.assetClasses === "object" && !Array.isArray(data.assetClasses)) {
    root.assetClasses = data.assetClasses
  }
  return root
}

function persist() {
  if (!canTouchDisk() || ceremonyStoreHealth.ok !== true || !store) return
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(CEREMONY_FILE, JSON.stringify(store, null, 2), "utf8")
}

const seqOf = (row) => {
  if (!row) return null
  const id = Number(row.id)
  if (Number.isFinite(id) && id > 0) return id
  const ls = Number(row.ledgerSeq)
  if (Number.isFinite(ls) && ls > 0) return ls
  return null
}

const assetKeyOf = (row) => {
  if (row.assetId != null && String(row.assetId).length > 0) return String(row.assetId)
  if (row.asset != null && String(row.asset).length > 0) return String(row.asset)
  return null
}

function classifyRow(row, now) {
  const verdict = row && row.result
  if (verdict !== "hit" && verdict !== "miss" && verdict !== "push") {
    return { kind: "deny", seq: seqOf(row), reason: "ceremony:deny:not-decided", verdict: null }
  }
  if (row.provenance !== "real") {
    const reason = row.provenance === "sim" ? "ceremony:deny:sim-row" : "ceremony:deny:untagged-provenance"
    return { kind: "deny", seq: seqOf(row), reason, verdict }
  }
  const assetKey = assetKeyOf(row)
  const venueClass = assetKey == null ? null : store.assetClasses[assetKey]
  if (typeof venueClass !== "string" || venueClass.length === 0) {
    return { kind: "deny", seq: seqOf(row), reason: "ceremony:deny:untagged-class", verdict }
  }
  return {
    kind: "credit",
    seq: seqOf(row),
    verdict,
    venueClass,
    assetKey,
    engine: row.engine ?? "legacy",
    expiry: String(row.expirySec ?? "?"),
    winProb: row.winProb ?? null,
    entryTs: Number(row.entryTs)
  }
}

function applyCredit(c, now) {
  store.classes[c.venueClass] ??= emptyClass()
  const cls = store.classes[c.venueClass]
  const atIso = new Date(now).toISOString()
  if (cls.windowOpenedAt == null) cls.windowOpenedAt = atIso
  cls.lastCreditAt = atIso
  cls.spendableResolved++
  const dayKey = Number.isFinite(c.entryTs) && c.entryTs > 0 ? dayKeyOf(c.entryTs) : dayKeyOf(now)
  if (!cls.tradingDays.includes(dayKey)) cls.tradingDays.push(dayKey)
  if (c.verdict === "hit" || c.verdict === "miss") {
    const engine = cls.byEngine[c.engine] ?? (cls.byEngine[c.engine] = {})
    const bucket = engine[c.expiry] ?? (engine[c.expiry] = { hits: 0, misses: 0, total: 0 })
    bucket.total++
    if (c.verdict === "hit") bucket.hits++
    else bucket.misses++
    cls.streak.push({ ledgerSeq: c.seq, ts: c.entryTs || now, dayKey, result: c.verdict, winProb: c.winProb })
    if (cls.streak.length > STREAK_LIMIT) cls.streak = cls.streak.slice(cls.streak.length - STREAK_LIMIT)
  }
  if (c.seq != null) {
    creditedSeqs[c.venueClass] ??= new Set()
    creditedSeqs[c.venueClass].add(c.seq)
  }
  return { ledgerSeq: c.seq, venueClass: c.venueClass, verdict: c.verdict, dayKey }
}

export function creditResolved(rows, { now = Date.now() } = {}) {
  if (ceremonyStoreHealth.ok !== true || !store) {
    return { ok: false, credited: [], denied: [], reason: ceremonyStoreHealth.reason }
  }
  const list = rows == null ? [] : Array.isArray(rows) ? rows : [rows]
  const out = { ok: true, credited: [], denied: [] }
  for (const row of list) {
    if (!row || typeof row !== "object") continue
    const c = classifyRow(row, now)
    if (c.kind === "credit") {
      out.credited.push(applyCredit(c, now))
    } else {
      out.denied.push({ seq: c.seq, reason: c.reason })
      denialLog.push({ at: new Date(now).toISOString(), seq: c.seq, reason: c.reason })
      if (denialLog.length > 100) denialLog = denialLog.slice(-100)
    }
  }
  persist()
  return out
}

export function unlockVenueClass(venueClass, by, { now = Date.now() } = {}) {
  if (ceremonyStoreHealth.ok !== true || !store) {
    throw new Error(`ceremony state store: ${ceremonyStoreHealth.reason} — refusing to mutate`)
  }
  if (process.env.VITEST !== "true") {
    throw new Error("ceremony:deny:ceremony-action-unreachable (no ceremony-action route is wired in production — the gate/route modules own the unlock check)")
  }
  if (typeof venueClass !== "string" || !KNOWN_VENUE_CLASSES.includes(venueClass)) {
    throw new Error(`ceremony:reject:unknown-venue-class (${venueClass})`)
  }
  const rec = { unlocked: true, at: new Date(now).toISOString(), by: by ?? "operator" }
  store.enablement[venueClass] = rec
  persist()
  return { ...rec }
}

export function setPlatformVerification(venueClass, record) {
  if (ceremonyStoreHealth.ok !== true || !store) {
    throw new Error(`ceremony state store: ${ceremonyStoreHealth.reason} — refusing to mutate`)
  }
  if (typeof venueClass !== "string" || !KNOWN_VENUE_CLASSES.includes(venueClass)) {
    throw new Error(`ceremony:reject:unknown-venue-class (${venueClass})`)
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("ceremony:reject:malformed-platform-verification")
  }
  if (record.verified !== true) {
    throw new Error("ceremony:reject:malformed-platform-verification (verified must be true)")
  }
  let payoutFloorPct = null
  let payoutUnderFloor = false
  if (record.payoutFloorPct != null) {
    const n = Number(record.payoutFloorPct)
    if (!Number.isFinite(n)) {
      throw new Error("ceremony:reject:malformed-platform-verification (payoutFloorPct must be a number)")
    }
    payoutFloorPct = n
    payoutUnderFloor = n < 85
  }
  const rec = {
    verified: true,
    at: record.at ?? new Date().toISOString(),
    by: record.by ?? null,
    regulator: record.regulator ?? null,
    payoutFloorPct,
    payoutUnderFloor,
    withdrawalTested: record.withdrawalTested ?? false
  }
  store.platformVerification[venueClass] = rec
  persist()
  return { ...rec }
}

export function setAssetClasses(map) {
  if (ceremonyStoreHealth.ok !== true || !store) {
    throw new Error(`ceremony state store: ${ceremonyStoreHealth.reason} — refusing to mutate`)
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new Error("ceremony:reject:malformed-asset-classes")
  }
  for (const [asset, venueClass] of Object.entries(map)) {
    if (typeof asset !== "string" || asset.length === 0) {
      throw new Error(`ceremony:reject:unknown-asset (${String(asset)})`)
    }
    if (typeof venueClass !== "string" || venueClass.length === 0) {
      throw new Error(`ceremony:reject:unknown-asset (${String(venueClass)})`)
    }
    if (!KNOWN_VENUE_CLASSES.includes(venueClass)) {
      throw new Error(`ceremony:reject:unknown-venue-class (${venueClass})`)
    }
  }
  store.assetClasses = { ...map }
  persist()
  return { ...store.assetClasses }
}

export function reconcileWithLedger(rows) {
  const report = { ok: true, seen: 0, credited: [], denied: [], mismatches: [], persistedOnly: [] }
  const liveSeqs = new Set()
  for (const row of rows == null ? [] : Array.isArray(rows) ? rows : [rows]) {
    if (!row || typeof row !== "object") continue
    report.seen++
    const c = classifyRow(row, Date.now())
    if (c.venueClass != null && c.seq != null) liveSeqs.add(c.seq)
    if (c.seq == null) continue
    if (c.kind === "credit") {
      if (creditedSeqs[c.venueClass]?.has(c.seq) === true) {
        report.credited.push({ ledgerSeq: c.seq, venueClass: c.venueClass, verdict: c.verdict })
      } else {
        report.mismatches.push({
          type: "expected-credit-missing",
          ledgerSeq: c.seq,
          venueClass: c.venueClass,
          verdict: c.verdict
        })
        report.ok = false
      }
    } else if (creditedSeqs[c.venueClass]?.has(c.seq) === true) {
      report.mismatches.push({
        type: "store-credit-inconsistent",
        ledgerSeq: c.seq,
        venueClass: c.venueClass ?? null,
        reason: c.reason
      })
      report.ok = false
    } else {
      report.denied.push({ ledgerSeq: c.seq, reason: c.reason })
    }
  }
  for (const [cls, seqs] of Object.entries(creditedSeqs)) {
    for (const s of seqs) {
      if (!liveSeqs.has(s)) report.persistedOnly.push({ ledgerSeq: s, venueClass: cls })
    }
  }
  return report
}

export function enablement() {
  if (ceremonyStoreHealth.ok !== true || !store) return { locked: true, reason: ceremonyStoreHealth.reason }
  const out = {}
  for (const vk of Object.keys(store.enablement ?? {})) {
    const rec = store.enablement[vk]
    out[vk] = rec ? { ...rec } : null
  }
  return out
}

export function enablementFor(venueClass) {
  if (ceremonyStoreHealth.ok !== true || !store) return { locked: true, reason: ceremonyStoreHealth.reason }
  const rec = store.enablement?.[venueClass]
  return rec ? { ...rec } : null
}

export function platformVerification() {
  if (ceremonyStoreHealth.ok !== true || !store) return { locked: true, reason: ceremonyStoreHealth.reason }
  const out = {}
  for (const vk of Object.keys(store.platformVerification ?? {})) {
    const rec = store.platformVerification[vk]
    out[vk] = rec ? { ...rec } : null
  }
  return out
}

export function assetClasses() {
  if (ceremonyStoreHealth.ok !== true || !store) return { locked: true, reason: ceremonyStoreHealth.reason }
  return { ...store.assetClasses }
}

export function classState(venueClass) {
  if (ceremonyStoreHealth.ok !== true || !store || !store.classes[venueClass]) return null
  return JSON.parse(JSON.stringify(store.classes[venueClass]))
}

export function ceremonyState() {
  if (!store) return null
  return JSON.parse(JSON.stringify(store))
}

export function storeHealth() {
  return { ...ceremonyStoreHealth }
}

export function recentDenials(n = 50) {
  return denialLog.slice(-n)
}

export function resolveConsumerWired() {
  return resolveWired
}

export function resetCeremonyState() {
  store = emptyStore()
  ceremonyStoreHealth = { ok: true }
  creditedSeqs = {}
  denialLog = []
  persist()
}

async function selfWireResolveConsumer() {
  try {
    const led = await import("../accuracyLedger.mjs")
    if (led && typeof led.registerResolveConsumer === "function") {
      led.registerResolveConsumer(({ entry, verdict }) => {
        creditResolved({ ...entry, result: verdict })
      })
      resolveWired = true
      return true
    }
  } catch {
    resolveWired = false
  }
  return false
}

void selfWireResolveConsumer()