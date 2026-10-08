// Wealth ledger store — legs registry + transfers + date-keyed snapshots.
//
// Day-one registry ships pre-seeded ABSENT (spec decision 15): never an empty
// state that could be mistaken for zero. Honest absence is the contract:
// absent legs are excluded with a reason, manual legs carry as-of and are
// never LIVE, snapshots overwrite by tz date (never duplicate).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.PICC_WEALTH_DATA_DIR || join(__dirname, "..", "..", "data")
const WEALTH_FILE = join(DATA_DIR, "wealth.json")

const LEG_STATUSES = new Set(["LIVE", "STALE", "ABSENT", "ENTERED"])

function snapshotTz() {
  return process.env.PICC_SNAPSHOT_TZ || "Asia/Singapore"
}

function tzDateFor(at) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: snapshotTz() }).format(new Date(at))
}

function seeds() {
  return [
    {
      id: "hyperliquid",
      kind: "hyperliquid",
      ccy: "USD",
      amount: null,
      observedAt: null,
      status: "ABSENT",
      reason: "hyperliquid-credentials-unset",
      fxSource: null,
      fxAt: null
    },
    {
      id: "ccxt-spot",
      kind: "ccxt-spot",
      ccy: "USD",
      amount: null,
      observedAt: null,
      status: "ABSENT",
      reason: "ccxt-keys-unset",
      fxSource: null,
      fxAt: null
    },
    {
      id: "btcpay",
      kind: "btcpay",
      ccy: "BTC",
      amount: null,
      observedAt: null,
      status: "ABSENT",
      reason: "btcpay-unconfigured",
      fxSource: null,
      fxAt: null
    },
    {
      id: "tng-manual",
      kind: "manual",
      ccy: "MYR",
      observedAt: null,
      status: "ABSENT",
      reason: "manual-unentered",
      fxSource: null,
      fxAt: null
    }
  ]
}

let legs = seeds()
let transfers = []
let snapshots = []

function load() {
  try {
    if (!existsSync(WEALTH_FILE)) return
    const doc = JSON.parse(readFileSync(WEALTH_FILE, "utf-8"))
    if (Array.isArray(doc.legs) && doc.legs.length > 0) legs = doc.legs
    if (Array.isArray(doc.transfers)) transfers = doc.transfers
    if (Array.isArray(doc.snapshots)) snapshots = doc.snapshots
  } catch { /* best-effort: keep seeded in-memory state */ }
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(WEALTH_FILE, JSON.stringify({ legs, transfers, snapshots }, null, 2))
  } catch { /* ignore */ }
}

load()

export function listLegs() {
  return legs.map((l) => ({ ...l }))
}

export function upsertLeg(leg) {
  if (!leg || typeof leg.id !== "string" || leg.id.length === 0) {
    return { ok: false, reason: "leg-id-required" }
  }
  if (leg.kind === "manual" && (leg.asOf === undefined || leg.asOf === null || leg.asOf === "")) {
    return { ok: false, reason: "manual-asof-required" }
  }
  const status = leg.status ?? (leg.kind === "manual" ? "ENTERED" : "ABSENT")
  if (!LEG_STATUSES.has(status)) {
    return { ok: false, reason: `invalid-leg-status:${leg.status}` }
  }
  const stored = {
    id: leg.id,
    kind: leg.kind,
    ccy: leg.ccy,
    amount: leg.amount,
    observedAt: leg.observedAt ?? null,
    status,
    reason: leg.reason ?? null,
    fxSource: leg.fxSource ?? null,
    fxAt: leg.fxAt ?? null
  }
  if (leg.asOf !== undefined) stored.asOf = leg.asOf
  const idx = legs.findIndex((l) => l.id === leg.id)
  if (idx === -1) legs.push(stored)
  else legs[idx] = { ...legs[idx], ...stored }
  save()
  return { ok: true, leg: { ...stored } }
}

export function listTransfers() {
  return transfers.map((t) => ({ ...t }))
}

export function addTransfer({ fromLeg, toLeg, ccy, amount, at, note = "" } = {}) {
  if (at === undefined || at === null || at === "") {
    return { ok: false, reason: "transfer-at-required" }
  }
  const transfer = {
    id: `xfer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    fromLeg,
    toLeg,
    ccy,
    amount: Number(amount),
    at: new Date(at).toISOString(),
    note: String(note)
  }
  transfers.push(transfer)
  save()
  return { ok: true, transfer: { ...transfer } }
}

export function addSnapshot({ at, totalUsd, incomplete, legStatus = [] } = {}) {
  const snapshot = {
    at: new Date(at).toISOString(),
    totalUsd,
    incomplete: Boolean(incomplete),
    legStatus: Array.isArray(legStatus) ? legStatus : [],
    tzDate: tzDateFor(at)
  }
  const idx = snapshots.findIndex((s) => s.tzDate === snapshot.tzDate)
  if (idx === -1) snapshots.push(snapshot)
  else snapshots[idx] = snapshot
  save()
  return { ...snapshot }
}

export function listSnapshots({ limit = 100 } = {}) {
  return [...snapshots]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
    .map((s) => ({ ...s }))
}

export function _resetWealthForTest() {
  legs = seeds()
  transfers = []
  snapshots = []
  save()
}
