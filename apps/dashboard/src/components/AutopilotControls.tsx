import { useCallback, useEffect, useState } from "react"
import { Badge, Button, Card, Field, Input, Select, Spinner } from "@/components/ui"
import { getAutopilotConfig, saveAutopilotConfig, startAutopilot, stopAutopilot, getExpertOptionDemoStatus } from "@/lib/trading"
import type { AutopilotConfig, ExpertOptionDemoStatus } from "@/lib/trading"

const REFRESH_MS = 10_000

export function AutopilotControls() {
  const [config, setConfig] = useState<AutopilotConfig | null>(null)
  const [status, setStatus] = useState<ExpertOptionDemoStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [cfgRes, stRes] = await Promise.allSettled([getAutopilotConfig(), getExpertOptionDemoStatus()])
      if (cfgRes.status === "fulfilled") setConfig(cfgRes.value.config)
      if (stRes.status === "fulfilled") setStatus(stRes.value)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const toggleAutopilot = async () => {
    if (!config) return
    setSaving(true)
    try {
      const res = config.enabled ? await stopAutopilot("manual") : await startAutopilot()
      setConfig(res.config)
    } catch {
      /* best effort */
    } finally {
      setSaving(false)
    }
  }

  const updateField = async (field: string, value: unknown) => {
    if (!config) return
    setSaving(true)
    try {
      const res = await saveAutopilotConfig({ [field]: value })
      setConfig(res.config)
    } catch {
      /* best effort */
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner label="Loading autopilot…" />

  const running = config?.enabled ?? false
  const connected = status?.connected ?? false

  return (
    <div>
      <Card className="pad" style={{ marginBottom: 12 }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <strong>Autopilot</strong>
            <Badge tone={running ? "success" : "muted"}>{running ? "RUNNING" : "STOPPED"}</Badge>
            <Badge tone={connected ? "success" : "danger"}>{connected ? "Connected" : "Disconnected"}</Badge>
          </div>
          <Button
            variant={running ? "danger" : "primary"}
            onClick={toggleAutopilot}
            disabled={saving || !status?.configured}
          >
            {saving ? "…" : running ? "Stop" : "Start"}
          </Button>
        </div>

        {!status?.configured && (
          <div className="muted small" style={{ padding: 8, background: "var(--bg)", borderRadius: 6 }}>
            Configure your ExpertOption token in Trading Suite settings first.
          </div>
        )}

        {status && status.configured && (
          <div className="muted small" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div>
              <div className="stat-label">Balance</div>
              <div className="stat-value">{status.balance != null ? `$${status.balance.toLocaleString()}` : "—"}</div>
            </div>
            <div>
              <div className="stat-label">Today P&L</div>
              <div className="stat-value" style={{ color: (status.todayPnl ?? 0) >= 0 ? "var(--success)" : "var(--danger)" }}>
                {status.todayPnl != null ? `${status.todayPnl >= 0 ? "+" : ""}$${status.todayPnl.toFixed(2)}` : "—"}
              </div>
            </div>
            <div>
              <div className="stat-label">Today Trades</div>
              <div className="stat-value">{status.todayTrades ?? 0}</div>
            </div>
          </div>
        )}
      </Card>

      {config && (
        <Card className="pad">
          <strong className="small" style={{ marginBottom: 8, display: "block" }}>Configuration</strong>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Asset">
              <Input
                value={config.assetId}
                onChange={(e) => updateField("assetId", e.target.value)}
                placeholder="BTCUSD"
              />
            </Field>
            <Field label="Duration (sec)">
              <Input
                type="number"
                value={config.duration}
                onChange={(e) => updateField("duration", Number(e.target.value) || 60)}
                min={15}
                max={3600}
              />
            </Field>
            <Field label="Min Confidence (%)">
              <Input
                type="number"
                value={config.minConfidence}
                onChange={(e) => updateField("minConfidence", Number(e.target.value) || 55)}
                min={40}
                max={95}
              />
            </Field>
            <Field label="Cooldown (min)">
              <Input
                type="number"
                value={Math.round(config.cooldownMs / 60000)}
                onChange={(e) => updateField("cooldownMs", (Number(e.target.value) || 15) * 60000)}
                min={1}
                max={120}
              />
            </Field>
            <Field label="Max Concurrent">
              <Input
                type="number"
                value={config.maxConcurrent}
                onChange={(e) => updateField("maxConcurrent", Number(e.target.value) || 3)}
                min={1}
                max={10}
              />
            </Field>
            <Field label="Daily Loss Limit (%)">
              <Input
                type="number"
                value={config.dailyLossLimitPct}
                onChange={(e) => updateField("dailyLossLimitPct", Number(e.target.value) || 10)}
                min={1}
                max={100}
              />
            </Field>
            <Field label="Max Daily Trades">
              <Input
                type="number"
                value={config.maxDailyTrades}
                onChange={(e) => updateField("maxDailyTrades", Number(e.target.value) || 0)}
                min={0}
                max={100}
              />
            </Field>
            <Field label="Timeframe (sec)">
              <Select
                value={config.timeframe}
                onChange={(e) => updateField("timeframe", Number(e.target.value))}
              >
                <option value={60}>60s</option>
                <option value={300}>5m</option>
                <option value={900}>15m</option>
              </Select>
            </Field>
          </div>
          <div className="row gap" style={{ marginTop: 10 }}>
            <label className="muted small" style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={config.aiGate}
                onChange={(e) => updateField("aiGate", e.target.checked)}
              />
              AI Gate
            </label>
            <label className="muted small" style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={config.proGate}
                onChange={(e) => updateField("proGate", e.target.checked)}
              />
              Pro Analysis Gate
            </label>
          </div>
          {config.stopReason && (
            <div className="muted small" style={{ marginTop: 8, padding: 6, background: "var(--bg)", borderRadius: 4 }}>
              Last stop reason: {config.stopReason}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
