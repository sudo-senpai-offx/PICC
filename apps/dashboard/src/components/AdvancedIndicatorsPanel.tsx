import { useEffect, useState, useCallback } from "react"
import { Card, Badge, Button } from "@/components/ui"
import { getAdvancedIndicators, type AdvancedIndicators, type IndicatorsResult } from "@/lib/trading"

function fmt(v: number | null, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toFixed(decimals)
}

function SignalBadge({ value }: { value: string }) {
  const lc = value.toLowerCase()
  const tone = lc.includes("bull") || lc.includes("up") || lc === "+1" ? "success"
    : lc.includes("bear") || lc.includes("down") || lc === "-1" ? "danger"
    : "muted"
  return <Badge tone={tone}>{value}</Badge>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{children}</span>
    </div>
  )
}

function Section({ title, children, color }: { title: string; children: React.ReactNode; color?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: color || "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, borderBottom: `1px solid ${color || "var(--accent)"}20`, paddingBottom: 2 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function VolumeProfileChart({ bins, poc, vah, val }: { bins: Array<{ price: number; volume: number }>; poc: { price: number; volume: number } | null; vah: number | null; val: number | null }) {
  if (!bins.length) return null
  const maxVol = Math.max(...bins.map(b => b.volume), 1)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 4 }}>
      {bins.slice(-12).map((b, i) => {
        const pct = (b.volume / maxVol) * 100
        const isPoc = poc && Math.abs(b.price - poc.price) < (bins[1]?.price - bins[0]?.price || 1)
        const isVAH = vah != null && b.price >= vah - 0.001 && b.price <= vah + 0.001
        const isVAL = val != null && b.price >= val - 0.001 && b.price <= val + 0.001
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9 }}>
            <span style={{ width: 48, textAlign: "right", color: isPoc ? "#ff6b6b" : isVAH || isVAL ? "#f59e0b" : "var(--text-muted)", fontWeight: isPoc ? 700 : 400 }}>
              {fmt(b.price, 4)}
            </span>
            <div style={{ flex: 1, height: 8, background: "var(--bg)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                width: `${Math.max(2, pct)}%`,
                height: "100%",
                background: isPoc ? "#ff6b6b" : isVAH || isVAL ? "#f59e0b" : "var(--accent)",
                borderRadius: 2,
                opacity: isPoc ? 1 : 0.6
              }} />
            </div>
            <span style={{ width: 32, color: "var(--text-muted)" }}>{Math.round(b.volume)}</span>
          </div>
        )
      })}
    </div>
  )
}

function PivotTable({ pivots }: { pivots: NonNullable<AdvancedIndicators["pivots"]> }) {
  const { classic, camarilla, woodie } = pivots
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
      <div>
        <div style={{ fontSize: 9, fontWeight: 600, color: "#6c63ff", marginBottom: 3 }}>Classic</div>
        {Object.entries(classic).map(([k, v]) => (
          <Row key={k} label={k}><span style={{ color: k.startsWith("R") ? "#ff6b6b" : k.startsWith("S") ? "#4ade80" : "var(--text)" }}>{fmt(v, 5)}</span></Row>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 9, fontWeight: 600, color: "#f59e0b", marginBottom: 3 }}>Camarilla</div>
        {Object.entries(camarilla).map(([k, v]) => (
          <Row key={k} label={k}><span style={{ color: k.startsWith("R") ? "#ff6b6b" : "#4ade80" }}>{fmt(v, 5)}</span></Row>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 9, fontWeight: 600, color: "#22c55e", marginBottom: 3 }}>Woodie</div>
        {Object.entries(woodie).map(([k, v]) => (
          <Row key={k} label={k}><span style={{ color: k.startsWith("R") ? "#ff6b6b" : k.startsWith("S") ? "#4ade80" : "var(--text)" }}>{fmt(v, 5)}</span></Row>
        ))}
      </div>
    </div>
  )
}

export function AdvancedIndicatorsPanel({ assetId, timeframe }: { assetId: string; timeframe: string }) {
  const [data, setData] = useState<IndicatorsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"overview" | "ichimoku" | "fibonacci" | "pivots" | "volume" | "all">("overview")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getAdvancedIndicators(assetId, timeframe, 200)
      setData(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load indicators")
    } finally {
      setLoading(false)
    }
  }, [assetId, timeframe])

  useEffect(() => { refresh() }, [refresh])

  const ind = data?.indicators
  if (error) return <Card style={{ padding: 12, color: "var(--danger)", fontSize: 12 }}>{error}</Card>

  return (
    <Card style={{ padding: 12, maxHeight: 600, overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Advanced Indicators</div>
        <Button variant="ghost" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "2px 8px" }}>
          {loading ? "Loading..." : "Refresh"}
        </Button>
      </div>

      <div style={{ display: "flex", gap: 3, marginBottom: 8, flexWrap: "wrap" }}>
        {(["overview", "ichimoku", "fibonacci", "pivots", "volume", "all"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: "2px 8px", fontSize: 10, fontWeight: activeTab === tab ? 700 : 400,
            background: activeTab === tab ? "var(--accent)" : "var(--bg)",
            color: activeTab === tab ? "#fff" : "var(--text-muted)",
            border: "none", borderRadius: 4, cursor: "pointer", textTransform: "capitalize"
          }}>{tab}</button>
        ))}
      </div>

      {!ind ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>Loading indicator data...</div>
      ) : (
        <>
          {(activeTab === "overview" || activeTab === "all") && (
            <>
              <Section title="Ichimoku Cloud" color={ind.ichimoku.trend === "bullish" ? "#4ade80" : ind.ichimoku.trend === "bearish" ? "#ff6b6b" : "#f59e0b"}>
                <Row label="Tenkan-sen">{fmt(ind.ichimoku.tenkan, 5)}</Row>
                <Row label="Kijun-sen">{fmt(ind.ichimoku.kijun, 5)}</Row>
                <Row label="Senkou A">{fmt(ind.ichimoku.senkouA, 5)}</Row>
                <Row label="Senkou B">{fmt(ind.ichimoku.senkouB, 5)}</Row>
                <Row label="Chikou">{fmt(ind.ichimoku.chikou, 5)}</Row>
                <Row label="Cloud"><SignalBadge value={ind.ichimoku.trend} /></Row>
              </Section>
            </>
          )}

          {(activeTab === "overview" || activeTab === "fibonacci") && (
            <>
              <Section title="Fibonacci Levels" color="#a855f7">
                {ind.fibonacci.swingHigh && <Row label="Swing High">{fmt(ind.fibonacci.swingHigh, 5)}</Row>}
                {ind.fibonacci.swingLow && <Row label="Swing Low">{fmt(ind.fibonacci.swingLow, 5)}</Row>}
                <Row label="Trend"><SignalBadge value={ind.fibonacci.trend} /></Row>
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#4ade80", marginBottom: 2 }}>Retracements</div>
                  {ind.fibonacci.retracements.map(r => (
                    <Row key={r.label} label={r.label}>
                      <span style={{ color: r.ratio === 0.618 ? "#4ade80" : "var(--text)" }}>{fmt(r.price, 5)}</span>
                    </Row>
                  ))}
                </div>
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#ff6b6b", marginBottom: 2 }}>Extensions</div>
                  {ind.fibonacci.extensions.map(r => (
                    <Row key={r.label} label={r.label}>
                      <span style={{ color: r.ratio === 1.618 ? "#ff6b6b" : "var(--text)" }}>{fmt(r.price, 5)}</span>
                    </Row>
                  ))}
                </div>
              </Section>
            </>
          )}

          {(activeTab === "overview" || activeTab === "pivots") && ind.pivots && (
            <>
              <Section title="Pivot Points" color="#f59e0b">
                <PivotTable pivots={ind.pivots} />
              </Section>
            </>
          )}

          {(activeTab === "overview" || activeTab === "volume") && (
            <>
              <Section title="Volume Profile" color="#22c55e">
                {ind.volumeProfile.poc && <Row label="POC"><span style={{ color: "#ff6b6b", fontWeight: 700 }}>{fmt(ind.volumeProfile.poc.price, 5)}</span></Row>}
                {ind.volumeProfile.vah != null && <Row label="VAH">{fmt(ind.volumeProfile.vah, 5)}</Row>}
                {ind.volumeProfile.val != null && <Row label="VAL">{fmt(ind.volumeProfile.val, 5)}</Row>}
                <VolumeProfileChart bins={ind.volumeProfile.bins} poc={ind.volumeProfile.poc} vah={ind.volumeProfile.vah} val={ind.volumeProfile.val} />
              </Section>
            </>
          )}

          {(activeTab === "overview" || activeTab === "all") && (
            <>
              <Section title="Keltner Channels" color="#06b6d4">
                <Row label="Upper">{fmt(ind.keltner.upper, 5)}</Row>
                <Row label="Middle">{fmt(ind.keltner.middle, 5)}</Row>
                <Row label="Lower">{fmt(ind.keltner.lower, 5)}</Row>
                <Row label="Bandwidth">{ind.keltner.bandwidth != null ? `${fmt(ind.keltner.bandwidth)}%` : "—"}</Row>
              </Section>

              <Section title="Heikin-Ashi" color="#ec4899">
                {ind.heikinAshi ? (
                  <>
                    <Row label="Open">{fmt(ind.heikinAshi.open, 5)}</Row>
                    <Row label="High">{fmt(ind.heikinAshi.high, 5)}</Row>
                    <Row label="Low">{fmt(ind.heikinAshi.low, 5)}</Row>
                    <Row label="Close">{fmt(ind.heikinAshi.close, 5)}</Row>
                    <Row label="Direction">
                      <SignalBadge value={ind.heikinAshi.close > ind.heikinAshi.open ? "bullish" : "bearish"} />
                    </Row>
                  </>
                ) : <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No data</div>}
              </Section>
            </>
          )}

          {(activeTab === "all") && (
            <>
              <Section title="Core Indicators Summary" color="#6c63ff">
                <Row label="RSI(14)">{ind.rsi.value != null ? `${fmt(ind.rsi.value)} (${ind.rsi.read})` : "—"}</Row>
                <Row label="MACD">{ind.macd.hist != null ? `${fmt(ind.macd.hist)} (${ind.macd.cross})` : "—"}</Row>
                <Row label="Stoch %K/%D">{ind.stochastic.k != null ? `${fmt(ind.stochastic.k)} / ${fmt(ind.stochastic.d)} (${ind.stochastic.cross})` : "—"}</Row>
                <Row label="ADX">{ind.adx.adx != null ? `${fmt(ind.adx.adx)} (${ind.adx.read})` : "—"}</Row>
                <Row label="ATR(14)">{fmt(ind.atr.value, 4)}</Row>
                <Row label="EMA 20/50/200">{ind.ema.read}</Row>
                <Row label="Alligator">{ind.alligator.label}</Row>
                <Row label="Bollinger %B">{ind.bollinger.percentB != null ? fmt(ind.bollinger.percentB) : "—"}</Row>
                <Row label="PSAR">{ind.psar.trend}</Row>
                <Row label="Aroon">{ind.aroon.read}</Row>
                <Row label="LR R²">{fmt(ind.linearRegression.r2, 3)}</Row>
              </Section>
            </>
          )}
        </>
      )}
    </Card>
  )
}
