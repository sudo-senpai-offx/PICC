import { useCallback, useEffect, useState } from "react"
import { Card } from "@/components/ui"
import { getBrowserPreferences, saveBrowserPreference } from "@/lib/api"
import {
  DEFAULT_OVERLAY_SETTINGS,
  FEATURE_LABELS,
  type OverlayFeatures,
  type OverlaySettings,
} from "@/lib/overlaySettings"

/**
 * Comprehensive overlay settings panel — fine-grained controls for
 * position, size, opacity, collapse, and per-feature toggles.
 *
 * Can be embedded in the stream page or in the settings page.
 */
export function OverlaySettingsPanel({ site }: { site: string }) {
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getBrowserPreferences()
      .then(({ prefs }) => {
        if (cancelled) return
        const existing = prefs[site]?.overlaySettings
        if (existing) {
          setSettings((prev) => ({
            ...prev,
            ...existing,
            position: { ...prev.position, ...existing.position },
            size: { ...prev.size, ...existing.size },
            features: { ...prev.features, ...existing.features },
          }))
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [site])

  const save = useCallback(async (next: OverlaySettings) => {
    setSaving(true)
    setMsg(null)
    try {
      await saveBrowserPreference(site, { overlay: next.enabled, overlaySettings: next })
      setMsg("Overlay settings saved.")
    } catch (err) {
      setMsg(`Error: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [site])

  const update = (patch: Partial<OverlaySettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    save(next)
  }

  const updateFeature = (key: keyof OverlayFeatures, val: boolean) => {
    const next = { ...settings, features: { ...settings.features, [key]: val } }
    setSettings(next)
    save(next)
  }

  if (loading) {
    return <Card><p className="muted small">Loading overlay settings…</p></Card>
  }

  return (
    <Card>
      <h3 style={{ margin: "0 0 12px" }}>Overlay Settings</h3>
      <p className="muted small" style={{ margin: "0 0 16px" }}>
        Configure the PICC overlay that appears inside the headed browser window.
        Drag the header to reposition, resize from the bottom-right corner.
      </p>

      {/* Master toggle */}
      <div className="row gap" style={{ alignItems: "center", marginBottom: 16 }}>
        <label className="toggle-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            style={{ width: 18, height: 18 }}
          />
          <span><strong>Overlay enabled</strong></span>
        </label>
        {saving ? <span className="muted small">Saving…</span> : null}
        {msg ? <span className="muted small">{msg}</span> : null}
      </div>

      {settings.enabled ? (
        <>
          {/* Position */}
          <fieldset style={{ border: "1px solid var(--border, #333)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <legend style={{ padding: "0 6px", color: "var(--text-muted, #999)", fontSize: 12 }}>Position & Size</legend>
            <div className="grid-2" style={{ gap: 8 }}>
              <label className="muted small">
                X offset (px)
                <input
                  type="number"
                  className="input"
                  value={settings.position.x}
                  min={0}
                  onChange={(e) => update({ position: { ...settings.position, x: Number(e.target.value) } })}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </label>
              <label className="muted small">
                Y offset (px)
                <input
                  type="number"
                  className="input"
                  value={settings.position.y}
                  min={0}
                  onChange={(e) => update({ position: { ...settings.position, y: Number(e.target.value) } })}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </label>
              <label className="muted small">
                Width (px)
                <input
                  type="number"
                  className="input"
                  value={settings.size.width}
                  min={200}
                  max={1200}
                  onChange={(e) => update({ size: { ...settings.size, width: Number(e.target.value) } })}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </label>
              <label className="muted small">
                Max height (px)
                <input
                  type="number"
                  className="input"
                  value={settings.size.height}
                  min={100}
                  max={900}
                  onChange={(e) => update({ size: { ...settings.size, height: Number(e.target.value) } })}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </label>
            </div>
          </fieldset>

          {/* Opacity */}
          <fieldset style={{ border: "1px solid var(--border, #333)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <legend style={{ padding: "0 6px", color: "var(--text-muted, #999)", fontSize: 12 }}>Appearance</legend>
            <label className="muted small" style={{ display: "block" }}>
              Opacity: {Math.round(settings.opacity * 100)}%
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(settings.opacity * 100)}
                onChange={(e) => update({ opacity: Number(e.target.value) / 100 })}
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <div className="row gap" style={{ marginTop: 8, alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={settings.collapsed}
                  onChange={(e) => update({ collapsed: e.target.checked })}
                  style={{ width: 16, height: 16 }}
                />
                <span className="muted small">Start collapsed</span>
              </label>
            </div>
          </fieldset>

          {/* Feature toggles */}
          <fieldset style={{ border: "1px solid var(--border, #333)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <legend style={{ padding: "0 6px", color: "var(--text-muted, #999)", fontSize: 12 }}>
              PICC Intervention Features
            </legend>
            <p className="muted small" style={{ margin: "0 0 10px" }}>
              When the overlay is active, PICC can provide the following interventions
              on the page. Toggle each independently.
            </p>
            <div className="stack" style={{ gap: 8 }}>
              {(Object.entries(FEATURE_LABELS) as [keyof OverlayFeatures, typeof FEATURE_LABELS[keyof OverlayFeatures]][]).map(
                ([key, def]) => (
                  <label
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: settings.features[key] ? "var(--accent-bg, #6c63ff10)" : "transparent",
                      border: `1px solid ${settings.features[key] ? "var(--accent, #6c63ff)" : "var(--border, #333)"}`,
                      cursor: "pointer",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={settings.features[key]}
                      onChange={(e) => updateFeature(key, e.target.checked)}
                      style={{ width: 16, height: 16, marginTop: 2 }}
                    />
                    <div>
                      <span style={{ fontSize: 14 }}>{def.icon} <strong>{def.label}</strong></span>
                      <p className="muted small" style={{ margin: "2px 0 0", fontSize: 12 }}>{def.desc}</p>
                    </div>
                  </label>
                )
              )}
            </div>
          </fieldset>

          {/* Quick preset */}
          <fieldset style={{ border: "1px solid var(--border, #333)", borderRadius: 8, padding: 12 }}>
            <legend style={{ padding: "0 6px", color: "var(--text-muted, #999)", fontSize: 12 }}>Quick Preset</legend>
            <div className="row gap" style={{ flexWrap: "wrap", gap: 6 }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => update({
                  ...DEFAULT_OVERLAY_SETTINGS,
                  enabled: true,
                  features: { assistance: true, decisionSupport: true, automation: false, autopilot: false, analysis: true, ai: true },
                })}
              >
                Reset to Default
              </button>
            </div>
          </fieldset>
        </>
      ) : (
        <p className="muted small" style={{ marginTop: 8 }}>
          The overlay is disabled for this site. Enable it above to configure PICC interventions.
        </p>
      )}
    </Card>
  )
}
