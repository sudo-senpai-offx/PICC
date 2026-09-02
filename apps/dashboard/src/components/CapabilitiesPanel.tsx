import { useCallback, useEffect, useState } from "react"
import { Card, Badge, Button } from "@/components/ui"
import { getSystemCapabilities, type SystemCapabilitiesResult } from "@/lib/trading"
import { capabilitiesPanelModel, type CapabilitiesDisplay } from "@/lib/integrationPanels"

/**
 * Machine-level capabilities snapshot (spec T6).
 * Honesty: an absent extension sensor renders "sensor not found" (never a
 * claimed session); unconfigured notifier channels stay "off". The whole
 * panel is guarded by the signal-engine flag — when the engine is disabled
 * we say so instead of pretending it is live.
 */
export function CapabilitiesPanel() {
  const [model, setModel] = useState<CapabilitiesDisplay | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res: SystemCapabilitiesResult = await getSystemCapabilities()
      setModel(capabilitiesPanelModel(res))
    } catch (e) {
      setError(e instanceof Error ? e.message : "capabilities probe failed")
    }
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>System Capabilities</div>
        <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "3px 10px" }}>
          {loading ? "..." : "Probe"}
        </Button>
      </div>

      {error ? (
        <div style={{ fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      ) : !model ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Probing instance…</div>
      ) : !model.signalEngine ? (
        <div style={{ fontSize: 11, color: "#ffb86c", textAlign: "center", padding: 8 }}>
          Signal engine is disabled (PICC_SIGNAL_ENGINE=0) — capabilities hidden
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Runtime</div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{model.node} {model.platform}/{model.arch}</div>
            </div>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Uptime</div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{Math.floor(model.uptimeSec / 60)}m</div>
            </div>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Browser</div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{model.browserFound ? "found" : "not found"}</div>
            </div>
            <div style={{ padding: "4px 8px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Ext sensor</div>
              {/* Honesty: false => "not seen", never a claimed session */}
              <div style={{ fontSize: 12, fontWeight: 700, color: model.sensorSeen ? "#4ade80" : "var(--text-muted)" }}>
                {model.sensorSeen ? "seen" : "not found"}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Notification channels</div>
          <div className="row gap" style={{ flexWrap: "wrap", marginBottom: 4 }}>
            <Badge tone="success">in-app</Badge>
            <Badge tone={model.notifierChannels.webpush ? "success" : "muted"}>
              {model.notifierChannels.webpush ? "web-push" : "web-push off (VAPID unset)"}
            </Badge>
          </div>
        </>
      )}
    </Card>
  )
}