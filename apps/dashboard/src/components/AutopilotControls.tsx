import { useCallback, useEffect, useRef, useState } from "react"
import { Badge, Button, Card, Field, Input, Select, Spinner } from "@/components/ui"
import {
  getAutopilotConfig,
  saveAutopilotConfig,
  startAutopilot,
  stopAutopilot,
  getExpertOptionDemoStatus,
  getAutopilotDecisions,
  whyAutopilot,
} from "@/lib/trading"
import type { AutopilotConfig, ExpertOptionDemoStatus, AutopilotDecisionsResult, AutopilotWhyResult } from "@/lib/trading"

const REFRESH_MS = 10_000
const SAVE_DEBOUNCE_MS = 600

export function AutopilotControls() {
  const [config, setConfig] = useState<AutopilotConfig | null>(null)
  const [status, setStatus] = useState<ExpertOptionDemoStatus | null>(null)
  const [decisions, setDecisions] = useState<AutopilotDecisionsResult | null>(null)
  const [why, setWhy] = useState<AutopilotWhyResult | null>(null)
  const [whyLoading, setWhyLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPatchRef = useRef<Record<string, unknown>>({})
  const saveSeqRef = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const [cfgRes, stRes, decRes] = await Promise.allSettled([
        getAutopilotConfig(),
        getExpertOptionDemoStatus(),
        getAutopilotDecisions(50),
      ])
      if (cfgRes.status === "fulfilled") setConfig(cfgRes.value.config)
      if (stRes.status === "fulfilled") setStatus(stRes.value)
      if (decRes.status === "fulfilled") setDecisions(decRes.value)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  // Best-effort flush of unsaved edits on unmount.
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const patch = pendingPatchRef.current
    pendingPatchRef.current = {}
    if (Object.keys(patch).length > 0) {
      void saveAutopilotConfig(patch).catch(() => { /* unmounting — nothing to surface */ })
    }
  }, [])

  const toggleAutopilot = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      const res = config.enabled ? await stopAutopilot("manual") : await startAutopilot()
      setConfig(res.config)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle autopilot")
    } finally {
      setSaving(false)
    }
  }

  const updateField = (field: string, value: unknown) => {
    if (!config) return
    setError(null)
    // Optimistic local update so inputs stay responsive while typing.
    setConfig({ ...config, [field]: value } as AutopilotConfig)
    // Coalesce edits and save once the user pauses (a POST per keystroke raced
    // with itself and flooded the server).
    pendingPatchRef.current = { ...pendingPatchRef.current, [field]: value }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const patch = pendingPatchRef.current
      pendingPatchRef.current = {}
      void flushSave(patch)
    }, SAVE_DEBOUNCE_MS)
  }

  const flushSave = async (patch: Record<string, unknown>) => {
    if (Object.keys(patch).length === 0) return
    const seq = ++saveSeqRef.current
    setSaving(true)
    try {
      const res = await saveAutopilotConfig(patch as Partial<AutopilotConfig>)
      if (seq !== saveSeqRef.current) return // a newer save superseded this one
      setConfig(res.config)
    } catch (e) {
      if (seq === saveSeqRef.current) {
        setError(e instanceof Error ? e.message : "Failed to save configuration")
      }
    } finally {
      if (seq === saveSeqRef.current) setSaving(false)
    }
  }

  const runWhy = async () => {
    setWhyLoading(true)
    setError(null)
    try {
      const res = await whyAutopilot(config?.assetId)
      setWhy(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dry-run failed")
    } finally {
      setWhyLoading(false)
    }
  }

  if (loading) return <Spinner label="Loading autopilot…" />

  const running = config?.enabled ?? false
  const connected = status?.connected ?? false
  const sessionLive = status?.sessionLive
  const lastDecision = status?.autopilot?.lastDecision ?? null

  return (
    <div>
      <Card className="pad" style={{ marginBottom: 12 }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong>Autopilot</strong>
            <Badge tone={running ? "success" : "muted"}>{running ? "RUNNING" : "STOPPED"}</Badge>
            <Badge tone={connected ? "success" : "danger"}>{connected ? "Connected" : "Disconnected"}</Badge>
            {sessionLive != null && (
              <Badge tone={sessionLive ? "success" : "warn"}>
                {sessionLive ? "Tab live" : "No live tab"}
              </Badge>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Button variant="ghost" onClick={runWhy} disabled={whyLoading || !status?.configured} title="Evaluate the full gate chain against current data — places nothing">
              {whyLoading ? "…" : "Why?"}
            </Button>
            <Button
              variant={running ? "danger" : "primary"}
              onClick={toggleAutopilot}
              disabled={saving || !status?.configured}
            >
              {saving ? "…" : running ? "Stop" : "Start"}
            </Button>
          </div>
        </div>

        {/* Phase 14 — the actual answer to "why didn't it trade just now" */}
        {lastDecision && (
          <div className="small" style={{ padding: 8, background: "var(--bg)", borderRadius: 6, marginBottom: 8 }}>
            <span className="muted">Last decision: </span>
            <span style={{ color: /tick error|failed|stale/i.test(lastDecision) ? "var(--danger)" : "var(--text)" }}>
              {lastDecision}
            </span>
          </div>
        )}

        {!status?.configured && (
          <div className="muted small" style={{ padding: 8, background: "var(--bg)", borderRadius: 6 }}>
            Configure your ExpertOption token in Trading Suite settings first.
          </div>
        )}

        {why && (
          <div className="small" style={{ padding: 10, background: "var(--bg)", borderRadius: 6, marginBottom: 8 }}>
            <div style={{ marginBottom: 6 }}>
              <strong>Dry run ({why.assetId}):</strong>{" "}
              <span style={{ color: why.wouldTrade ? "var(--success)" : "var(--warning)" }}>
                {why.wouldTrade ? `WOULD TRADE ${why.direction} @ ${why.confidence}%` : "WOULD SKIP"}
              </span>{" "}
              — {why.reason}
            </div>
            {why.gates && why.gates.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 4 }}>
                {why.gates.map((g) => (
                  <div key={g.name} title={g.detail ?? undefined}>
                    <span style={{ color: g.pass ? "var(--success)" : "var(--danger)" }}>{g.pass ? "✓" : "✗"}</span>{" "}
                    {g.name}
                    {g.detail ? <span className="muted"> — {g.detail}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {decisions && decisions.decisions.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <button
              className="muted small"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
              onClick={() => setShowHistory((v) => !v)}
            >
              Decision log ({decisions.window.trades} trades / {decisions.window.skips} skips) {showHistory ? "▾" : "▸"}
            </button>
            {showHistory && (
              <div style={{ marginTop: 6, maxHeight: 180, overflowY: "auto", fontSize: 11 }}>
                {Object.entries(decisions.tally).length > 0 && (
                  <div className="muted" style={{ marginBottom: 4 }}>
                    Skip reasons:{" "}
                    {Object.entries(decisions.tally)
                      .sort((a, b) => b[1] - a[1])
                      .map(([gate, n]) => `${gate} ×${n}`)
                      .join(" · ")}
                  </div>
                )}
                {decisions.decisions.map((d, i) => (
                  <div key={`${d.at}-${i}`} style={{ display: "flex", gap: 6, padding: "2px 0", borderTop: "1px solid var(--border)" }}>
                    <span className="muted" style={{ minWidth: 64 }}>{new Date(d.at).toLocaleTimeString()}</span>
                    <span>{d.reason}</span>
                  </div>
                ))}
              </div>
            )}
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
          {error && (
            <div className="small" style={{ marginBottom: 8, padding: 6, background: "var(--bg)", borderRadius: 4, color: "var(--danger)" }}>
              {error}
            </div>
          )}
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
