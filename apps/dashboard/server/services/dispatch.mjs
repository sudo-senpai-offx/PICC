// Dispatch inbox — the copilot's notification spine (PICC_COPILOT_REDESIGN_v1 §2).
// In-memory store + JSON persistence (PICC_DISPATCH_DATA_DIR), subscribe/emit like
// alertEngine. Additive service; nothing else imports it until the API layer lands.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.PICC_DISPATCH_DATA_DIR || join(__dirname, "..", "data")
const DISPATCH_FILE = join(DATA_DIR, "dispatch.json")
const MAX_INBOX = 500

let inbox = []
let listeners = new Set()

const KINDS = new Set(["decision", "milestone", "venue", "system"])
const SEVERITIES = new Set(["info", "warning", "critical"])

function load() {
  try {
    if (existsSync(DISPATCH_FILE)) inbox = JSON.parse(readFileSync(DISPATCH_FILE, "utf-8"))
  } catch { inbox = [] }
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(DISPATCH_FILE, JSON.stringify(inbox, null, 2))
  } catch { /* ignore */ }
}

load()

export function pushDispatch({ kind = "info", severity = "info", title = "", body = "", ref = null } = {}) {
  const entry = {
    id: `dispatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: KINDS.has(String(kind)) ? String(kind) : "info",
    severity: SEVERITIES.has(String(severity)) ? String(severity) : "info",
    title: String(title || ""),
    body: String(body || ""),
    ref: ref == null ? null : String(ref),
    ts: Date.now(),
    read: false
  }
  inbox.unshift(entry)
  if (inbox.length > MAX_INBOX) inbox.length = MAX_INBOX
  save()
  for (const cb of listeners) {
    try { cb(entry) } catch { /* one bad listener never kills the push */ }
  }
  return entry
}

export function listDispatch({ limit = 50, unreadOnly = false } = {}) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500)
  const rows = unreadOnly ? inbox.filter((e) => e.read === false) : inbox
  return rows.slice(0, n)
}

export function unreadDispatchCount() {
  return inbox.reduce((n, e) => n + (e.read === false ? 1 : 0), 0)
}

export function markDispatchRead(id) {
  const entry = inbox.find((e) => e.id === id)
  if (!entry) return false
  entry.read = true
  save()
  return true
}

export function onDispatch(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function _resetDispatchForTest() {
  inbox = []
  listeners = new Set()
}