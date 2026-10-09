import { useState } from "react"
import { fetchTaxLotsCsv, summarizeTaxCsv } from "@/lib/tax"
import type { TaxCsvSummary } from "@/lib/tax"

/**
 * Tax-lots download section — the report-only FIFO export surface (Task 5).
 *
 * Ships INSIDE the wealth room (spec decision 5: wealth-room download section)
 * and stays unwired like its host: the WS-6 T0 room-key contract is frozen, so
 * no INNER_NAV / MINISTRY_ROOMS key is added here.
 *
 * Honest absence is the contract, mirrored from the API: an empty period reads
 * as its reason (never a zero), invalid dates are refused by the route with a
 * named reason (never defaulted silently), and self-transfer-flagged lots stay
 * listed — the flags are shown beside the download, not filtered away.
 */
export function TaxLotsSection() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<TaxCsvSummary | null>(null)

  function presetMyYear() {
    const year = new Date().getFullYear()
    setFrom(`${year}-01-01`)
    setTo(`${year}-12-31`)
  }

  function allTime() {
    setFrom("")
    setTo("")
  }

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const { filename, text } = await fetchTaxLotsCsv({
        from: from || undefined,
        to: to || undefined
      })
      const blob = new Blob([text], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setSummary(summarizeTaxCsv(text))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel" data-testid="tax-section">
      <strong>Tax lots (CSV export)</strong>
      <p className="muted small" data-testid="tax-disclaimer">
        PICC tax lots — report only, not tax advice. Verify with your accountant.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
        <label className="muted small">
          from{" "}
          <input
            data-testid="tax-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="muted small">
          to{" "}
          <input data-testid="tax-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn" data-testid="tax-preset-my-year" disabled={busy} onClick={presetMyYear}>
          MY year
        </button>
        <button className="btn" data-testid="tax-alltime" disabled={busy} onClick={allTime}>
          All-time
        </button>
        <button className="btn" data-testid="tax-download" disabled={busy} onClick={() => { void download() }}>
          Download CSV
        </button>
      </div>

      {error ? (
        <p className="muted small" data-testid="tax-error">
          tax lots unavailable — {error}
        </p>
      ) : null}

      {summary ? (
        <div className="muted small" data-testid="tax-summary">
          {summary.lotCount} lot lines
          {summary.selfTransferCount > 0 ? (
            <>
              {" · "}
              {summary.selfTransferCount} flagged self-transfer{summary.selfTransferCount === 1 ? "" : "s"}:
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {summary.selfTransferRows.map((row, i) => (
                  <li key={`${row.date}-${row.asset}-${i}`} data-testid="tax-selftransfer-row">
                    {row.date} · {row.asset} {row.qty} · self-transfer
                  </li>
                ))}
              </ul>
            </>
          ) : (
            " · no self-transfer flags"
          )}
        </div>
      ) : null}
    </div>
  )
}
