import { useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui"
import { fetchCandles, type Timeframe } from "@/hooks/useCandleData"
import type { CandleDatum } from "@/components/CandlestickChart"

// ── Slice C — multi-timeframe, smart-loaded past→present, interactive ───────
// A compact row of timeframes for the active chart asset. Each tin fetches its
// own close-history and draws a tiny sparkline oldest→newest (LEFT→RIGHT,
// exactly how the big chart lays time out). Clicking a tin moves the big chart
// to that timeframe via onSelect. A tin that can honestly fetch nothing shows
// that instead of inventing bars.

const TF_ROWS: { tf: Timeframe; label: string; windowSec: number; downsample: number }[] = [
  { tf: 60,    label: "1m",  windowSec: 86400,  downsample: 1 },   // 1 day of 1m
  { tf: 300,   label: "5m",  windowSec: 86400 * 3, downsample: 1 }, // 3 days of 5m
  { tf: 3600,  label: "1h",  windowSec: 86400 * 7, downsample: 1 }, // 1 week of 1h
  { tf: 14400, label: "4h",  windowSec: 86400 * 30, downsample: 4 },// ~1 mo of 4h
  { tf: 86400, label: "1D",  windowSec: 86400 * 180, downsample: 1 }// ~6 mo daily
]

function Sparkline({ data }: { data: CandleDatum[] }) {
  const [w, h] = [120, 40]
  const { path, up, flat } = useMemo(() => {
    if (data.length < 2) return { path: "", up: false, flat: true }
    const pad = 3
    const closes = data.map((c) => c.close)
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const span = max - min || 1
    const n = data.length
    const pts = closes.map((c, i) => [
      pad + ((i / (n - 1)) * (w - pad * 2)),
      pad + ((max - c) / span) * (h - pad * 2)
    ])
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")
    return { path: d, up: closes[n - 1] >= closes[0], flat: false }
  }, [data])
  if (flat) return null
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <path d={path} fill="none" stroke={up ? "#4ade80" : "#f87171"} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function MultiTimeframePanel({ assetId, onSelect, selected }: {
  assetId: string
  onSelect?: (tf: Timeframe) => void
  selected?: Timeframe
}) {
  const [series, setSeries] = useState<Record<number, CandleDatum[] | null | undefined>>({})

  useEffect(() => {
    let alive = true
    setSeries({})
    TF_ROWS.forEach((row) => {
      void (async () => {
        // "Smart-load past→present": request a window sized to the timeframe so
        // each tin covers a meaningful span. Daily/weekly/monthly fetch fewer bars
        // over a longer window (Yahoo EOD only — honest if it returns nothing).
        let count = Math.ceil(row.windowSec / row.tf)
        if (row.tf >= 86400) count = Math.min(count, 200)
        const res = await fetchCandles(assetId, row.tf, count).catch(() => null)
        if (!alive) return
        // Downsample very many candles so the tin stays readable/fast.
        let bars = res?.rows ?? null
        if (bars && bars.length > 300) {
          const step = Math.ceil(bars.length / 300)
          bars = bars.filter((_, i) => i % step === 0)
        }
        setSeries((prev) => ({ ...prev, [row.tf]: bars }))
      })()
    })
    return () => { alive = false }
  }, [assetId])

  return (
    <Card>
      <div className="row-between" style={{ alignItems: "center" }}>
        <h4 style={{ margin: 0 }}>Timeframes</h4>
        <span className="muted small">click a graph to open it in the chart · oldest → newest, left → right</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {TF_ROWS.map((row) => {
          const data = series[row.tf]
          const empty = data === null || (Array.isArray(data) && data.length === 0)
          const active = selected === row.tf
          return (
            <button
              key={row.tf}
              onClick={() => onSelect?.(row.tf)}
              title="Open this timeframe in the chart"
              style={{
                background: active ? "#23234a" : "#16162c",
                border: `1px solid ${active ? "#6d6dff" : "#2a2a4a"}`,
                borderRadius: 10,
                padding: "8px 10px",
                cursor: "pointer",
                color: "#eef0ff",
                minWidth: 92,
                textAlign: "left"
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{row.label}</div>
              {empty ? (
                <div className="muted small" style={{ fontSize: 10, color: "#8a8aa0" }}>no data</div>
              ) : Array.isArray(data) ? (
                <>
                  <Sparkline data={data} />
                  <div className="muted small" style={{ fontSize: 9, color: "#8a8aa0", marginTop: 2 }}>
                    {data.length} bars{row.tf >= 86400 ? " · EOD" : ""}
                  </div>
                </>
              ) : (
                <div className="muted small" style={{ fontSize: 10, color: "#8a8aa0" }}>…</div>
              )}
            </button>
          )
        })}
      </div>
    </Card>
  )
}
