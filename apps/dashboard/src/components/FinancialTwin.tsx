import { useState } from "react"
import { Button, Card, Field, Input, Select, Spinner, Badge, Toggle } from "./ui"
import { runFinancialTwin, logAgentAction, SOURCE_LABELS } from "@/lib/api"
import { formatCurrency, formatPercent } from "@/lib/monteCarlo"
import { appendData } from "@/lib/localdata"
import { useUser, useAuth } from "@/hooks/useAuth"
import type {
  AssetClassKind,
  FinancialTwinParams,
  FinancialTwinResult,
  RiskTolerance
} from "@/lib/types"

const ASSET_OPTIONS: { value: AssetClassKind; label: string }[] = [
  { value: "stock", label: "Stock / ETF" },
  { value: "index", label: "Global index fund" },
  { value: "reit", label: "REIT" },
  { value: "bonds", label: "Bonds" },
  { value: "crypto", label: "Crypto" }
]

const TICKER_PLACEHOLDERS: Record<AssetClassKind, string> = {
  stock: "VOO, VTI, SCHD…",
  index: "VT, ACWI, EFA…",
  reit: "VNQ, O, SPG…",
  bonds: "BND, AGG, TLT…",
  crypto: "BTC-USD, ETH-USD…"
}

function Sparkline({ closes }: { closes: number[] }) {
  if (closes.length < 2) return null
  const w = 640
  const h = 120
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const span = max - min || 1
  const pts = closes
    .map((v, i) => {
      const x = (i / (closes.length - 1)) * w
      const y = h - ((v - min) / span) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sparkline" aria-label="Historical price">
      <polyline points={pts} fill="none" stroke="#6c63ff" strokeWidth="2" />
    </svg>
  )
}

function reportText(res: FinancialTwinResult, capital: number): string {
  const p = res.projection
  return [
    "PICC — Financial Twin Projection Report",
    "=====================================",
    `Asset: ${res.ticker}${res.name ? ` (${res.name})` : ""}   Source: ${SOURCE_LABELS[res.source]?.label ?? res.source}`,
    `Capital: ${formatCurrency(capital)}`,
    ...(res.lastPrice != null ? [`Last price: ${res.currency ?? "USD"} ${res.lastPrice}`] : []),
    ...(res.annualizedVol != null ? [`Realized volatility: ${formatPercent(res.annualizedVol)}`] : []),
    ...(res.dividendYield != null ? [`Trailing dividend yield: ${formatPercent(res.dividendYield, 2)}`] : []),
    "",
    "Projected outcomes (nominal)",
    `  P5  (expected shortfall): ${formatCurrency(p.p5)}`,
    `  P10 (pessimistic):        ${formatCurrency(p.p10)}`,
    `  Median:                   ${formatCurrency(p.medianEnd)}`,
    `  P90 (optimistic):         ${formatCurrency(p.p90)}`,
    `  Total contributed:        ${formatCurrency(p.totalContributions)}`,
    `  Median profit:            ${formatCurrency(p.medianProfit)}`,
    `  Win rate:                 ${formatPercent(p.winRate, 0)}`,
    `  Median max drawdown:      ${formatPercent(p.maxDrawdownP50, 0)}`,
    `  Annualized return:        ${formatPercent(p.annualizedReturn)}`,
    "",
    "Inflation-adjusted outcomes",
    `  P10: ${formatCurrency(p.p10Real)} · Median: ${formatCurrency(p.medianEndReal)} · P90: ${formatCurrency(p.p90Real)}`,
    `  Annualized real return:   ${formatPercent(p.annualizedRealReturn)}`,
    `  Horizon: ${p.horizonYears} years · ${p.simulatedPaths} simulated paths`,
    "",
    `Recommended allocation: ${Object.entries(p.allocation)
      .map(([k, v]) => `${k} ${formatPercent(v, 0)}`)
      .join(", ")}`,
    "",
    "Disclaimer: educational simulation only. Not investment advice. ",
    "No transaction was executed or will be executed by PICC."
  ].join("\n")
}

function projectionRows(a: FinancialTwinResult, b: FinancialTwinResult | null) {
  const cells = (res: FinancialTwinResult) => {
    const p = res.projection
    return [
      formatCurrency(p.p5),
      formatCurrency(p.p10),
      formatCurrency(p.medianEnd),
      formatCurrency(p.p90),
      formatPercent(p.winRate, 0),
      formatPercent(p.maxDrawdownP50, 0),
      formatPercent(p.annualizedReturn),
      formatCurrency(p.totalContributions)
    ]
  }
  const labels = [
    "P5 (shortfall)",
    "P10 (pessimistic)",
    "Median",
    "P90 (optimistic)",
    "Win rate",
    "Median max drawdown",
    "Annualized return",
    "Total contributed"
  ]
  return labels.map((label, i) => ({ label, a: cells(a)[i], b: b ? cells(b)[i] : null }))
}

export function FinancialTwin() {
  const user = useUser()
  const { session } = useAuth()
  const [params, setParams] = useState<FinancialTwinParams>({
    ticker: "VOO",
    assetClass: "stock",
    capital: 10000,
    riskTolerance: "moderate",
    horizonYears: 10,
    simulations: 10000,
    monthlyContribution: 0,
    inflationRate: 0.025,
    inflationAdjustContributions: false
  })
  const [result, setResult] = useState<FinancialTwinResult | null>(null)
  const [compareOn, setCompareOn] = useState(false)
  const [compareTicker, setCompareTicker] = useState("VTI")
  const [compareResult, setCompareResult] = useState<FinancialTwinResult | null>(null)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof FinancialTwinParams>(k: K, v: FinancialTwinParams[K]) =>
    setParams((p) => ({ ...p, [k]: v }))

  const runOne = async (p: FinancialTwinParams): Promise<FinancialTwinResult> => {
    const res = await runFinancialTwin(p, user?.id, session?.access_token)
    return res
  }

  const run = async () => {
    setBusy(true)
    try {
      const base = { ...params }
      const tasks = [runOne(base)]
      if (compareOn && compareTicker.trim()) {
        tasks.push(runOne({ ...base, ticker: compareTicker.trim().toUpperCase() }))
      }
      const [a, b] = await Promise.all(tasks)
      setResult(a)
      setCompareResult(b ?? null)
      await logAgentAction(user?.id, "Financial Twin", "simulate", base, a.projection)
      if (user) {
        await appendData("simulations", {
          user_id: user.id,
          type: base.assetClass,
          name: `${base.ticker} ${base.horizonYears}y projection`,
          parameters: base,
          results: a.projection
        }).catch(() => undefined)
      }
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    if (!result) return
    const blob = new Blob([reportText(result, params.capital)], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `picc-${result.ticker}-projection.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const p = result?.projection

  return (
    <div className="stack">
      <Card>
        <form
          className="grid-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          <Field label="Ticker / Fund" hint="Simulations only, no trades">
            <Input
              value={params.ticker}
              placeholder={TICKER_PLACEHOLDERS[params.assetClass]}
              onChange={(e) => set("ticker", e.target.value.toUpperCase())}
              required
            />
          </Field>
          <Field label="Asset class">
            <Select
              value={params.assetClass}
              onChange={(e) => set("assetClass", e.target.value as AssetClassKind)}
            >
              {ASSET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starting capital (USD)">
            <Input
              type="number"
              min={0}
              step={100}
              value={params.capital}
              onChange={(e) => set("capital", Math.max(0, Number(e.target.value)))}
              required
            />
          </Field>
          <Field label="Monthly contribution (USD)" hint="Optional DCA — 0 for a one-time lump sum">
            <Input
              type="number"
              min={0}
              step={50}
              value={params.monthlyContribution}
              onChange={(e) => set("monthlyContribution", Math.max(0, Number(e.target.value)))}
            />
          </Field>
          <Field label="Risk tolerance">
            <Select
              value={params.riskTolerance}
              onChange={(e) => set("riskTolerance", e.target.value as RiskTolerance)}
            >
              <option value="conservative">Conservative</option>
              <option value="moderate">Moderate</option>
              <option value="aggressive">Aggressive</option>
            </Select>
          </Field>
          <Field label="Horizon (years)">
            <Input
              type="number"
              min={1}
              max={40}
              value={params.horizonYears}
              onChange={(e) => set("horizonYears", Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Simulation paths">
            <Input
              type="number"
              min={100}
              max={50000}
              step={100}
              value={params.simulations}
              onChange={(e) => set("simulations", Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Inflation assumption (annual %)" hint="Used for inflation-adjusted outcomes">
            <Input
              type="number"
              min={0}
              max={15}
              step={0.5}
              value={(params.inflationRate ?? 0.025) * 100}
              onChange={(e) => set("inflationRate", Math.max(0, Math.min(0.15, Number(e.target.value) / 100)))}
            />
          </Field>

          <div className="field">
            <span className="field-label">Contribution schedule</span>
            <label className="row" style={{ gap: 8 }}>
              <Toggle
                checked={params.inflationAdjustContributions ?? false}
                onChange={(v) => set("inflationAdjustContributions", v)}
                label="Contributions grow with inflation"
              />
              <span className="small muted">Contributions grow with inflation over time</span>
            </label>
          </div>

          <div className="field">
            <span className="field-label">Compare mode</span>
            <label className="row" style={{ gap: 8 }}>
              <Toggle checked={compareOn} onChange={setCompareOn} label="Compare with another ticker" />
              <span className="small muted">Run two tickers side by side</span>
            </label>
          </div>

          {compareOn ? (
            <Field label="Compare ticker / fund">
              <Input
                value={compareTicker}
                placeholder="VTI, QQQ, BND…"
                onChange={(e) => setCompareTicker(e.target.value.toUpperCase())}
              />
            </Field>
          ) : null}

          <div className="span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Running simulation…" : compareOn ? "Run Monte Carlo Comparison" : "Run Monte Carlo Simulation"}
            </Button>
          </div>
        </form>
      </Card>

      {busy ? <Spinner label="Simulating paths…" /> : null}

      {p ? (
        <>
          <Card className="stack">
            <div className="row space-between">
              <h2 className="h2">
                Projection — {result?.ticker}
                <Badge tone={result?.source && SOURCE_LABELS[result.source]?.real ? "success" : "muted"}>
                  {result?.source ? (SOURCE_LABELS[result.source]?.label ?? result.source) : "engine"}
                </Badge>
              </h2>
              <Button variant="secondary" onClick={download}>
                ⬇ Download report
              </Button>
            </div>

            <div className="grid-3">
              <div className="stat">
                <span className="metric-label">P5 · expected shortfall</span>
                <span className="metric-value">{formatCurrency(p.p5)}</span>
              </div>
              <div className="stat">
                <span className="metric-label">P10 · pessimistic</span>
                <span className="metric-value">{formatCurrency(p.p10)}</span>
              </div>
              <div className="stat">
                <span className="metric-label">Median outcome</span>
                <span className="metric-value accent">{formatCurrency(p.medianEnd)}</span>
              </div>
            </div>

            <div className="grid-3">
              <div className="stat">
                <span className="metric-label">P90 · optimistic</span>
                <span className="metric-value">{formatCurrency(p.p90)}</span>
              </div>
              <div className="stat">
                <span className="metric-label">Win rate</span>
                <span className="metric-value">{formatPercent(p.winRate, 0)}</span>
              </div>
              <div className="stat">
                <span className="metric-label">Median max drawdown</span>
                <span className="metric-value">{formatPercent(p.maxDrawdownP50, 0)}</span>
              </div>
            </div>

            <div className="grid-3">
              <div className="stat">
                <span className="metric-label">Total contributed</span>
                <span className="metric-value">{formatCurrency(p.totalContributions)}</span>
              </div>
              <div className="stat">
                <span className="metric-label">Median profit</span>
                <span className="metric-value">{formatCurrency(p.medianProfit)}</span>
              </div>
              <div className="stat">
                <span className="metric-label">Annualized return</span>
                <span className="metric-value">{formatPercent(p.annualizedReturn)}</span>
              </div>
            </div>

            <div className="grid-3">
              <div className="stat">
                <span className="metric-label">Median · inflation-adjusted</span>
                <span className="metric-value">{formatCurrency(p.medianEndReal)}</span>
              </div>
              <div className="stat">
                <span className="metric-label">Real annualized return</span>
                <span className="metric-value">{formatPercent(p.annualizedRealReturn)}</span>
              </div>
              <div className="stat">
                <span className="metric-label">Suggested allocation</span>
                <span className="metric-value small">
                  {Object.entries(p.allocation)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `${k} ${formatPercent(v, 0)}`)
                    .join(" · ")}
                </span>
              </div>
            </div>

            {result?.lastPrice != null ? (
              <div className="grid-3">
                <div className="stat">
                  <span className="metric-label">Last price</span>
                  <span className="metric-value">
                    {result.currency ?? "USD"} {result.lastPrice}
                    {result.name ? <span className="muted small"> · {result.name}</span> : null}
                  </span>
                </div>
                <div className="stat">
                  <span className="metric-label">Realized volatility (5y)</span>
                  <span className="metric-value">{formatPercent(result.annualizedVol ?? 0)}</span>
                </div>
                <div className="stat">
                  <span className="metric-label">Realized drift (5y)</span>
                  <span className="metric-value">{formatPercent(result.annualizedDrift ?? 0)}</span>
                </div>
              </div>
            ) : null}

            {result?.dividendYield != null ? (
              <div className="grid-3">
                <div className="stat">
                  <span className="metric-label">Trailing dividend yield</span>
                  <span className="metric-value">{formatPercent(result.dividendYield, 2)}</span>
                </div>
                <div className="stat">
                  <span className="metric-label">Est. dividend income / yr</span>
                  <span className="metric-value">{formatCurrency(result.annualDividendEstimate ?? 0)}</span>
                </div>
                <div className="stat">
                  <span className="metric-label">Yield over horizon</span>
                  <span className="metric-value small">
                    ~{formatCurrency((result.annualDividendEstimate ?? 0) * p.horizonYears)}
                  </span>
                </div>
              </div>
            ) : null}

            {result?.historical ? (
              <div>
                <span className="metric-label">5-year price history ({result.ticker})</span>
                <Sparkline closes={result.historical.closes} />
              </div>
            ) : null}

            <p className="muted">{result?.notes}</p>
            <p className="muted small">
              Nothing was bought or sold. Use this as a planning aid — any purchase happens manually on
              your own brokerage.
            </p>
          </Card>

          {compareOn && compareResult ? (
            <Card className="stack">
              <h2 className="h2">
                Comparison — {result?.ticker} vs {compareResult.ticker}
              </h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>{result?.ticker}</th>
                      <th>{compareResult.ticker}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectionRows(result as FinancialTwinResult, compareResult).map((r) => (
                      <tr key={r.label}>
                        <td>{r.label}</td>
                        <td>{r.a}</td>
                        <td>{r.b ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                Compare uses identical capital, contributions, risk, and horizon for both tickers.
              </p>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
