// WS-4 F4 — CSV/JSON importer (WS-4 R3.2 / R3.3). Parse → validate rows against
// the R2.1 shape → reject feeds that do not account costs (they can never
// qualify) → run qualification → write the store + audit leader:import:{id}.
// An import NEVER sets platformTrust and NEVER marks anything followed; unknown
// asset ids and malformed rows are named denies, never silent skips. The 64 MB
// payload cap is enforced at the route (readBodyMax), not here.

import { validateFeedRows } from "./leaderFeedContract.mjs"
import { qualifyLeader } from "./leaderQualification.mjs"
import { importLeaderRecord } from "../commandCentre/leaderIdeasState.mjs"

const slugId = (label) => {
  const slug = String(label ?? "feed")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `leader-${slug.length > 0 ? slug : "feed"}`
}

const lastPositionAtOf = (rows) => {
  let max = -Infinity
  for (const r of rows) {
    const raw = r.closedAt ?? r.at ?? r.ts
    const t = raw == null ? Number.NaN : new Date(raw).getTime()
    if (Number.isFinite(t) && t > max) max = t
  }
  return Number.isFinite(max) ? new Date(max).toISOString() : null
}

export function importLeaderFeed({ label, source = "csv", leaderId, rows }, { now = Date.now(), audit } = {}) {
  if (!Array.isArray(rows)) return { ok: false, deny: "leader:deny:malformed-feed" }
  if (rows.length === 0) return { ok: false, deny: "leader:deny:empty-feed" }

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    if (!r || typeof r !== "object" || r.feesUsd == null || r.pnlAfterCosts == null) {
      return { ok: false, deny: "leader:deny:costs-unaccounted" }
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    const asset = rows[i].asset
    if (typeof asset !== "string" || asset.trim() === "") {
      return { ok: false, deny: "leader:deny:unknown-asset" }
    }
  }

  const shape = validateFeedRows(rows)
  if (!shape.ok) return { ok: false, deny: "leader:deny:malformed-row" }

  const qualification = qualifyLeader(rows)
  const id =
    leaderId && String(leaderId).trim().length > 0 ? String(leaderId).trim() : slugId(label)

  const stored = importLeaderRecord(
    {
      id,
      label: typeof label === "string" && label.length > 0 ? label : id,
      source,
      qualification,
      ideas: rows,
      lastPositionAt: lastPositionAtOf(rows)
    },
    { now, audit }
  )
  if (!stored.ok) return { ok: false, deny: stored.deny }
  return { ok: true, leaderId: id, qualification }
}