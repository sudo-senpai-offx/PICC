import { getToken } from "./auth"

export interface TaxSelfTransferRow {
  date: string
  asset: string
  qty: string
}

export interface TaxCsvSummary {
  lotCount: number
  selfTransferCount: number
  selfTransferRows: TaxSelfTransferRow[]
}

// Same header construction as lib/wealth.ts: auth token when logged in.
function headers(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Download URL for GET /api/tax/lots. Absent bounds are omitted (all-time), never defaulted. */
export function buildTaxLotsUrl({ from, to }: { from?: string; to?: string }): string {
  const q = new URLSearchParams()
  if (from) q.set("from", from)
  if (to) q.set("to", to)
  const qs = q.toString()
  return qs ? `/api/tax/lots?${qs}` : "/api/tax/lots"
}

export async function fetchTaxLotsCsv({
  from,
  to
}: {
  from?: string
  to?: string
}): Promise<{ filename: string; text: string }> {
  const res = await fetch(buildTaxLotsUrl({ from, to }), { headers: headers() })
  if (!res.ok) {
    let reason = `tax lots GET failed: ${res.status}`
    try {
      const body = (await res.json()) as { reason?: unknown }
      if (typeof body?.reason === "string" && body.reason) reason = body.reason
    } catch {
      /* keep the status-shaped reason */
    }
    throw new Error(reason)
  }
  const text = await res.text()
  const disposition = res.headers.get("content-disposition") ?? ""
  const match = disposition.match(/filename="([^"]+)"/)
  return { filename: match?.[1] ?? "picc-tax-lots.csv", text }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/**
 * Count lot lines and surface the self-transfer-flagged ones so the room can
 * show the flags without a second endpoint. The first non-comment line is the
 * fixed header; everything after it is a lot row.
 */
export function summarizeTaxCsv(text: string): TaxCsvSummary {
  const lines = text.split("\n").filter((line) => line !== "" && !line.startsWith("#"))
  if (lines.length === 0) return { lotCount: 0, selfTransferCount: 0, selfTransferRows: [] }
  const header = splitCsvLine(lines[0])
  const dateI = header.indexOf("date")
  const assetI = header.indexOf("asset")
  const qtyI = header.indexOf("qty")
  const selfI = header.indexOf("selfTransfer")
  const selfTransferRows: TaxSelfTransferRow[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    if (selfI >= 0 && cells[selfI] === "true") {
      selfTransferRows.push({
        date: dateI >= 0 ? cells[dateI] : "",
        asset: assetI >= 0 ? cells[assetI] : "",
        qty: qtyI >= 0 ? cells[qtyI] : ""
      })
    }
  }
  return { lotCount: lines.length - 1, selfTransferCount: selfTransferRows.length, selfTransferRows }
}
