// PICC dashboard stream snapshot — plain-JSON persistence for the stream
// registrations the Income page tracks (platforms without a server-side
// collector, kept as a snapshot the dashboard writes and re-reads).
//
// Successor of the removed bandwidth automator module's snapshot helpers:
// same file path and shape, no bandwidth coupling. Rows without an explicit
// category still default to the "bandwidth" stream-category label (the shared
// taxonomy), preserving imported data behavior.
import { mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DATA_DIR = process.env.PICC_AUTOMATOR_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const SNAPSHOT_FILE = join(DATA_DIR, "streams-snapshot.json")

// Wave 0 Task 3 — the Copilot `finiteOrNull` vocabulary, mirrored locally:
// a finite number, or null. Absent stays null; genuine 0 stays 0.
const finiteOrNull = (v) => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function getSnapshot() {
  let saved = {}
  try {
    saved = JSON.parse(await readFile(SNAPSHOT_FILE, "utf8"))
  } catch {
    /* missing/unreadable → empty snapshot */
  }
  return {
    streams: Array.isArray(saved.streams) ? saved.streams : [],
    earnings: Array.isArray(saved.earnings) ? saved.earnings : [],
    updatedAt: saved.updatedAt ?? null
  }
}

export async function saveSnapshot(body) {
  const streams = Array.isArray(body?.streams)
    ? body.streams.slice(0, 500).map((s) => {
        // Wave 0 Task 3 — an unreported numeric is null with a named reason,
        // never a 0 that would read as "measured zero balance". The dashboard
        // coerces nulls for display at its own boundary (income.ts
        // normalizeStreamRow, documented there); the store stays honest.
        const absent = []
        const balance = finiteOrNull(s?.balance)
        if (balance == null) absent.push("balance-unobservable: stream reports no balance; no 0 substituted")
        const totalEarned = finiteOrNull(s?.totalEarned)
        if (totalEarned == null) absent.push("totalEarned-unobservable: stream reports no lifetime earnings; no 0 substituted")
        const payoutThreshold = finiteOrNull(s?.payoutThreshold)
        if (payoutThreshold == null) absent.push("payoutThreshold-unobservable: stream reports no payout threshold; no 0 substituted")
        const estimatedDaily = finiteOrNull(s?.estimatedDaily)
        if (estimatedDaily == null) absent.push("estimatedDaily-unobservable: stream reports no daily estimate; no 0 substituted")
        return {
          id: String(s?.id ?? ""),
          name: String(s?.name ?? "Unnamed"),
          platform: String(s?.platform ?? s?.name ?? ""),
          category: String(s?.category ?? "bandwidth"),
          status: String(s?.status ?? "active"),
          balance,
          totalEarned,
          payoutThreshold,
          estimatedDaily,
          reason: absent.length ? absent.join("; ") : null,
          url: String(s?.url ?? ""),
          lastCollected: s?.lastCollected ?? null
        }
      })
    : []
  const earnings = Array.isArray(body?.earnings) ? body.earnings.slice(0, 2000) : []
  const updatedAt = new Date().toISOString()
  try {
    await writeFile(SNAPSHOT_FILE, JSON.stringify({ streams, earnings, updatedAt }, null, 2), "utf8")
  } catch (err) {
    if (err && err.code === "ENOENT") {
      mkdirSync(dirname(SNAPSHOT_FILE), { recursive: true })
      await writeFile(SNAPSHOT_FILE, JSON.stringify({ streams, earnings, updatedAt }, null, 2), "utf8")
    } else {
      throw err
    }
  }
  return { ok: true, streams: streams.length, updatedAt }
}