import { useEffect, useMemo, useState } from "react"
import { Badge, Button, Card, Spinner } from "@/components/ui"
import type { GateBacktest, LedgerEntry, LedgerStats, ObservedPayouts, TradingLedger } from "@/lib/trading"
import { flushTradingLedger, getLedgerBacktest, getObservedPayouts, getTradingLedger } from "@/lib/trading"

const REFRESH_MS = 10_000

function fmtPct(n: number | null, d = 0): string {
  if (n == null) return "—"
  return `${(n * 100).toFixed(d)}%`
}

function fmtEv(n: number | null): string {
  if (n == null) return "—"
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%/stake`
}

function fmtPrice(n: number | null): string {
  if (n == null) return "—"
  return n.toLocaleString("en-US", { maximumFractionDigits: 5 })
}

function resultTone(result: LedgerEntry["result"]): "success" | "danger" | "muted" | "warn" {
  if (result === "hit") return "success"
  if (result === "miss") return "danger"
  if (result === "push") return "muted"
  return "warn"
}

function LedgerRow({ e }: { e: LedgerEntry }) {
  const dir = e.direction === "flat" ? "→" : e.direction === "up" ? "▲" : "▼"
  const label = e.status === "pending" ? "pending" : e.status === "unresolved" ? "unresolved" : (e.result ?? "—")
  return (
    <tr>
      <td>
        <strong>{e.asset}</strong> <span className="muted">{dir}{e.direction}</span>
      </td>
      <td>{e.expirySec}s</td>
      <td>{fmtPct(e.winProb, 0)}</td>
      <td>{fmtEv(e.ev)}</td>
      <td>
        {e.payout ?? "—"}%{" "}
        <em className="muted">{e.payoutSource === "observed" ? "(obs)" : e.payoutSource === "assumed" ? "(asm)" : ""}</em>
      </td>
      <td>{fmtPrice(e.entryPrice)}</td>
      <td>{fmtPrice(e.exitPrice)}</td>
      <td>
        <Badge tone={resultTone(e.result)}>{label}</Badge>
      </td>
    </tr>
  )
}

function StatsGrid({ stats }: { stats: LedgerStats }) {
  const stat = (label: string, value: string, sub?: string) => (
    <Card className="pad">
      <div className="stat-label muted">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="muted small">{sub}</div> : null}
    </Card>
  )
  return (
    <div className="grid grid-4">
      {stat("Tracked decisions", String(stats.total), `${stats.pending} pending · ${stats.unresolved} unresolved`)}
      {stat("Resolved", String(stats.resolved), `${stats.hits}W · ${stats.misses}L · ${stats.pushes}D`)}
      {stat(
        "Hit rate",
        stats.hitRate != null ? fmtPct(stats.hitRate, 0) : "—",
        stats.hitRate != null && stats.hitRate < 0.5 ? "below coin flip — stand aside" : "hits / (hits+misses)"
      )}
      {stat(
        "Edge (realized − predicted EV)",
        stats.edge != null ? (stats.edge >= 0 ? "+" : "") + (stats.edge * 100).toFixed(1) + "%" : "—",
        stats.edge != null && stats.edge < 0 ? "predicted edge not realized" : "vs predicted"
      )}
      {stat("Predicted EV", fmtEv(stats.predictedEv), "mean predicted edge/stake")}
      {stat("Realized EV", fmtEv(stats.realizedEv), "hit ⇒ payout, miss ⇒ −100%, push ⇒ 0")}
      {stat(
        "Win-prob calibration",
        Object.keys(stats.buckets).length ? "by bucket" : "—",
        "80%+ bucket should win ≥80%"
      )}
      {stat(
        "Expiry profile",
        Object.keys(stats.byExpiry).length ? "by expiry" : "—",
        "per-timeframe hit rate + EV"
      )}
    </div>
  )
}

function ObservedPayoutsLine({ observed }: { observed: ObservedPayouts | null }) {
  if (!observed) return null
  return (
    <p className="muted small">
      Observed payouts from demo deals: <strong>{observed.total}</strong> asset/expiry keys sampled from{" "}
      <strong>{observed.sampled}</strong> deals
      {observed.entries.length
        ? " — e.g. " + observed.entries.slice(0, 4).map(([k, p]) => `${k} → ${p}%`).join(", ")
        : ""}
      {observed.entries.length > 4 ? " …" : ""}
      . The engine uses these instead of the assumed schedule when present.
    </p>
  )
}

/** Equity curve + drawdown visualization from resolved ledger entries. */
function EquityCurveChart({ entries }: { entries: LedgerEntry[] }) {
  const resolved = useMemo(
    () => entries.filter((e) => e.result === "hit" || e.result === "miss" || e.result === "push"),
    [entries]
  )

  const { equity, drawdown, stats } = useMemo(() => {
    if (!resolved.length) return { equity: [] as { i: number; v: number }[], drawdown: [] as { i: number; v: number }[], peak: 0, stats: null as { totalReturn: number; maxDrawdown: number; peak: number } | null }
    let eq = 100
    let pk = 100
    const eqArr: { i: number; v: number }[] = [{ i: 0, v: eq }]
    const ddArr: { i: number; v: number }[] = [{ i: 0, v: 0 }]
    resolved.forEach((e, idx) => {
      const stake = 1
      if (e.result === "hit") eq += stake * ((e.payout ?? 80) / 100)
      else if (e.result === "miss") eq -= stake
      // pushes: flat segment (equity unchanged)
      pk = Math.max(pk, eq)
      const dd = pk > 0 ? ((pk - eq) / pk) * 100 : 0
      eqArr.push({ i: idx + 1, v: eq })
      ddArr.push({ i: idx + 1, v: dd })
    })
    return { equity: eqArr, drawdown: ddArr, peak: pk, stats: { totalReturn: eq - 100, maxDrawdown: Math.max(...ddArr.map((d: { i: number; v: number }) => d.v)), peak: pk } }
  }, [resolved])

  if (equity.length < 2) return <p className="muted small">Need at least 2 resolved entries to plot equity curve.</p>

  const W = 640
  const H = 100
  const lo = Math.min(...equity.map((p: { i: number; v: number }) => p.v), 0)
  const hi = Math.max(...equity.map((p: { i: number; v: number }) => p.v), 100)
  const span = Math.max(hi - lo, 0.01)
  const n = equity.length
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => H - ((v - lo) / span) * (H - 8) - 4

  const eqPts = equity.map((p: { i: number; v: number }) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")
  const eqFillPts = `0,${H} ` + eqPts + ` ${W},${H}`

  const ddHi = Math.max(...drawdown.map((d: { i: number; v: number }) => d.v), 1)
  const yDd = (v: number) => (v / ddHi) * (H - 8)
  const ddPts = drawdown.map((d: { i: number; v: number }) => `${x(d.i).toFixed(1)},${yDd(d.v).toFixed(1)}`).join(" ")
  const ddFillPts = `0,0 ` + ddPts + ` ${W},0`

  const returnColor = (stats?.totalReturn ?? 0) >= 0 ? "#4ade80" : "#ff6b6b"

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row gap" style={{ alignItems: "center" }}>
        <h4 className="small" style={{ margin: 0 }}>Equity curve</h4>
        {stats ? (
          <span className="muted small">
            return <strong style={{ color: returnColor }}>{stats.totalReturn >= 0 ? "+" : ""}{stats.totalReturn.toFixed(2)}%</strong>
            {" · "}max DD <strong className="danger-text">{stats.maxDrawdown.toFixed(1)}%</strong>
            {" · "}peak ${stats.peak.toFixed(2)}
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 2 }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }} preserveAspectRatio="none">
            <polygon points={eqFillPts} fill="rgba(74,222,128,0.08)" />
            <polyline points={eqPts} fill="none" stroke="#4ade80" strokeWidth="1.5" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }} preserveAspectRatio="none">
            <polygon points={ddFillPts} fill="rgba(255,107,107,0.12)" />
            <polyline points={ddPts} fill="none" stroke="#ff6b6b" strokeWidth="1.5" />
          </svg>
          <div className="muted small" style={{ textAlign: "center" }}>drawdown</div>
        </div>
      </div>
    </div>
  )
}

function BacktestSection({ stats, backtest }: { stats: LedgerStats; backtest: GateBacktest | null }) {
  const expiryKeys = Object.keys(stats.byExpiry).sort((a, b) => Number(a) - Number(b))
  const bucketKeys = Object.keys(stats.buckets)
  const demoByKey = new Map((backtest?.rows ?? []).map((r) => [r.key, r.demo]))
  const mergedKeys = [...new Set([...expiryKeys, ...Array.from(demoByKey.keys())])].sort((a, b) => Number(a) - Number(b))

  return (
    <div className="grid grid-2">
      <div className="card pad stack">
        <h4 className="small">Gate backtest — by expiry (engine vs demo deals)</h4>
        {mergedKeys.length === 0 ? (
          <p className="muted small">No resolved decisions yet — the engine auto-resolves entries a few seconds after expiry.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Expiry</th><th>Engine n</th><th>Eng hit rate</th><th>Eng real EV</th>
                  <th>Demo n</th><th>Demo win rate</th><th>Demo real EV</th>
                </tr>
              </thead>
              <tbody>
                {mergedKeys.map((k) => {
                  const b = stats.byExpiry[k]
                  const d = demoByKey.get(k)
                  if (!b && !d) return null
                  return (
                    <tr key={k}>
                      <td>{k}s</td>
                      <td>{b?.n ?? "—"}</td>
                      <td>{b?.hitRate != null ? fmtPct(b.hitRate, 0) : "—"}</td>
                      <td className={b?.realizedEv != null && b.realizedEv < 0 ? "danger-text" : ""}>
                        {b?.realizedEv != null ? fmtEv(b.realizedEv) : "—"}
                      </td>
                      <td>{d?.n ?? "—"}</td>
                      <td>{d?.winRate != null ? fmtPct(d.winRate, 0) : "—"}</td>
                      <td className={d?.realizedEv != null && d.realizedEv < 0 ? "danger-text" : ""}>
                        {d?.realizedEv != null ? fmtEv(d.realizedEv) : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Engine = this ledger's auto-resolved decisions. Demo = actual demo-account deals on the same timeframes —
          the honest check that predicted edge materializes on real (demo) outcomes.
        </p>
      </div>
      <div className="card pad stack">
        <h4 className="small">Gate backtest — by win-probability bucket</h4>
        {bucketKeys.length === 0 ? (
          <p className="muted small">No resolved decisions yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Bucket</th><th>n</th><th>Hits</th><th>Misses</th><th>Pushes</th><th>Hit rate</th></tr>
              </thead>
              <tbody>
                {bucketKeys.map((k) => {
                  const b = stats.buckets[k]
                  return (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>{b.n}</td>
                      <td>{b.hits}</td>
                      <td>{b.misses}</td>
                      <td>{b.pushes}</td>
                      <td>{b.hitRate != null ? fmtPct(b.hitRate, 0) : "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Calibration check: a bucket claiming 70–80% should actually win in that range — this is where the gate is
          validated against realized demo-deal outcomes, not backtested assumptions.
        </p>
      </div>
    </div>
  )
}

/**
 * Decision accuracy ledger: every TRADE verdict from the adaptive-confluence
 * engine, auto-resolved against the price observed after expiry. Shows realized
 * vs predicted EV, per-expiry and per-win-probability calibration, a comparison
 * against actual demo-deal outcomes, and the decision history. Display-only —
 * the ledger never places orders.
 */
export function LedgerPanel() {
  const [data, setData] = useState<TradingLedger | null>(null)
  const [backtest, setBacktest] = useState<GateBacktest | null>(null)
  const [observed, setObserved] = useState<ObservedPayouts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flushing, setFlushing] = useState(false)

  const load = async () => {
    const [l, b, o] = await Promise.allSettled([
      getTradingLedger(100),
      getLedgerBacktest(),
      getObservedPayouts(50)
    ])
    if (l.status === "fulfilled") setData(l.value)
    if (l.status === "rejected") setError((l.reason as Error).message)
    if (b.status === "fulfilled") setBacktest(b.value)
    if (o.status === "fulfilled") setObserved(o.value)
  }

  useEffect(() => {
    void load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  const flush = async () => {
    setFlushing(true)
    try {
      await flushTradingLedger()
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setFlushing(false)
    }
  }

  const stats = data?.stats ?? null
  const entries = data?.entries ?? []

  return (
    <Card className="pad stack">
      <div className="row-between">
        <div className="row">
          <strong>Decision accuracy ledger</strong>
          <Badge tone={data?.engine?.running ? "success" : "muted"}>
            {data?.engine?.running ? "auto-resolving" : "not running"}
          </Badge>
        </div>
        <div className="row gap">
          <span className="muted small">{data ? `updated ${new Date(data.entries?.[0]?.entryTs ?? Date.now()).toLocaleTimeString()}` : "loading…"}</span>
          <Button variant="secondary" className="btn-sm" disabled={flushing} onClick={() => void flush()}>
            {flushing ? "Resolving…" : "Resolve now"}
          </Button>
          <Button variant="ghost" className="btn-sm" onClick={() => void load()}>Refresh</Button>
        </div>
      </div>
      <p className="muted small">
        Every TRADE verdict is recorded with its predicted edge and entry price, then auto-resolved against the exit
        price after expiry (push tolerance ≈0.02%). Honest accuracy — no guessed outcomes.
      </p>
      {error ? <p className="danger-text">{error}</p> : null}
      {!stats ? (
        <Spinner label="Loading ledger…" />
      ) : (
        <>
          <ObservedPayoutsLine observed={observed} />
          <StatsGrid stats={stats} />
          <EquityCurveChart entries={entries} />
          <BacktestSection stats={stats} backtest={backtest} />
          <div className="stack">
            <h4 className="small">Decision history ({entries.length})</h4>
            {entries.length === 0 ? (
              <p className="muted small">No decisions yet — they appear once the engine issues a TRADE verdict with a live price.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Asset</th><th>Expiry</th><th>Win prob</th><th>EV</th><th>Payout</th>
                      <th>Entry</th><th>Exit</th><th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <LedgerRow key={e.id} e={e} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
