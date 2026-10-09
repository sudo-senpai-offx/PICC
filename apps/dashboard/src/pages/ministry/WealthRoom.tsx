import { useEffect, useState } from "react"
import { fetchWealthOverview, postWealthTransfer } from "@/lib/wealth"
import type { WealthOverview } from "@/lib/wealth"
import { CostsSection } from "./CostsSection"
import { TaxLotsSection } from "./TaxLotsSection"

/**
 * Wealth room — the cross-venue net-worth ledger surface (W3-01 Task 9).
 *
 * Honest absence is the contract, mirrored from the API: absent legs render
 * with their reason (never as zero), the total carries its incomplete banner
 * whenever any in-scope leg is not LIVE, and the paper section is a SEPARATE
 * panel that is never summed into the total.
 *
 * TRANSFER SUGGESTIONS ARE LABELED "INFERRED DIRECTION". Phase 2 candidates
 * come from burst-matched sightings (same currency, amounts within 1%, close
 * in time), and for bare sightings the earlier one reads as the source — a
 * heuristic, not an observation. Nothing confirms itself: each candidate
 * renders a Confirm button that POSTs one explicit transfer.
 *
 * NOT registered in INNER_NAV / MINISTRY_ROOMS: the WS-6 T0 room-key contract
 * is frozen, and wiring a new key needs a spec amendment. The room ships
 * tested but unwired (see the Task 9 report).
 */
export function WealthRoom() {
  const [overview, setOverview] = useState<WealthOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ fromLeg: "", toLeg: "", ccy: "USD", amount: "", at: "", note: "" })
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    let alive = true
    fetchWealthOverview()
      .then((o) => { if (alive) setOverview(o) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  async function reload() {
    try {
      setOverview(await fetchWealthOverview())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function confirmSuggestion(fromLeg: string, toLeg: string, ccy: string, amount: number, at: string) {
    setPosting(true)
    try {
      await postWealthTransfer({ fromLeg, toLeg, ccy, amount, at, note: "confirmed suggestion" })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPosting(false)
    }
  }

  async function submitManual() {
    setPosting(true)
    try {
      await postWealthTransfer({
        fromLeg: form.fromLeg,
        toLeg: form.toLeg,
        ccy: form.ccy,
        amount: Number(form.amount),
        at: form.at,
        note: form.note
      })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="stack">
      <header data-room="wealth">
        <h2>Wealth</h2>
        <p className="muted small">Cross-venue net worth — real-money legs with provenance, paper kept separate.</p>
      </header>

      {error ? (
        <div className="panel muted">
          <p>wealth unavailable — {error}</p>
          <p className="muted small">no total is shown rather than a stale one.</p>
        </div>
      ) : null}

      {!overview && !error ? <p className="muted small">loading wealth…</p> : null}

      {overview ? (
        <>
          <div className="panel" data-testid="wealth-total">
            <strong>Total: {overview.totalUsd === null ? "— (no convertible legs)" : `USD ${overview.totalUsd}`}</strong>
            {overview.incomplete ? (
              <p className="muted small">Partial total — at least one leg is not LIVE, so this is a floor, not a sum.</p>
            ) : null}
          </div>

          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {overview.legs.map((leg) => (
              <li key={leg.id} className="panel" data-status={leg.status}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{leg.id}</strong>
                  <span className="muted small">{leg.status}</span>
                </div>
                <div className="muted small">
                  {leg.ccy ?? "?"} {leg.amount === null ? "—" : leg.amount}
                  {" · "}
                  {leg.usd === null ? "excluded" : `USD ${leg.usd}`}
                  {leg.fxSource ? ` via ${leg.fxSource}` : ""}
                </div>
                {leg.reason ? <div className="muted small">{leg.reason}</div> : null}
              </li>
            ))}
          </ul>

          {overview.suggestions.length > 0 ? (
            <div className="panel">
              <strong>Possible transfers (inferred direction)</strong>
              <p className="muted small">
                Burst-matched sightings — the earlier leg reads as the source, which is a heuristic.
                Confirm explicitly or ignore; nothing here moves money by itself.
              </p>
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {overview.suggestions.map((s, i) => (
                  <li key={`${s.fromLeg}-${s.toLeg}-${i}`}>
                    <span className="muted small">
                      {s.fromLeg} → {s.toLeg} · {s.ccy} {s.amount} · inferred direction
                    </span>{" "}
                    <button
                      className="btn"
                      data-testid={`confirm-${s.fromLeg}-${s.toLeg}`}
                      disabled={posting}
                      onClick={() => { void confirmSuggestion(s.fromLeg, s.toLeg, s.ccy, s.amount, s.at) }}
                    >
                      Confirm
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="panel">
            <strong>Log a transfer (manual entry)</strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <input data-testid="xfer-from" placeholder="from leg" value={form.fromLeg} onChange={(e) => setForm({ ...form, fromLeg: e.target.value })} />
              <input data-testid="xfer-to" placeholder="to leg" value={form.toLeg} onChange={(e) => setForm({ ...form, toLeg: e.target.value })} />
              <input data-testid="xfer-ccy" placeholder="ccy" value={form.ccy} onChange={(e) => setForm({ ...form, ccy: e.target.value })} />
              <input data-testid="xfer-amount" placeholder="amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              <input data-testid="xfer-at" placeholder="as of (date)" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />
              <input data-testid="xfer-note" placeholder="note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <button className="btn" data-testid="xfer-submit" disabled={posting} onClick={() => { void submitManual() }}>
                Log transfer
              </button>
            </div>
          </div>

          {overview.transfers.length > 0 ? (
            <div className="panel">
              <strong>Transfer log</strong>
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {overview.transfers.map((t) => (
                  <li key={t.id} className="muted small">
                    {t.fromLeg} → {t.toLeg} · {t.ccy} {t.amount} · {t.at}
                    {t.note ? ` · ${t.note}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="panel" data-testid="wealth-paper">
            <strong>Paper (separate — never summed)</strong>
            <div className="muted small">
              equity {overview.paper.equity === null ? "—" : overview.paper.equity}
              {" · "}cash {overview.paper.cash === null ? "—" : overview.paper.cash}
              {" · "}committed {overview.paper.committed === null ? "—" : overview.paper.committed}
              {" · "}open {overview.paper.open === null ? "—" : overview.paper.open}
              {" · "}closed {overview.paper.closed === null ? "—" : overview.paper.closed}
            </div>
            <a className="muted small" href="/suites/trading/paper">open the paper room</a>
          </div>

          {overview.snapshots.length > 0 ? (
            <div className="panel">
              <strong>Daily snapshots</strong>
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {overview.snapshots.map((s) => (
                  <li key={s.tzDate} className="muted small">
                    {s.tzDate}: {s.totalUsd === null ? "—" : `USD ${s.totalUsd}`}
                    {s.incomplete ? " (partial)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <CostsSection />

          <TaxLotsSection />
        </>
      ) : null}
    </div>
  )
}
