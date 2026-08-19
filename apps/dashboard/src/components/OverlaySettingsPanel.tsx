import { useCallback, useEffect, useState } from "react"
import { Card } from "@/components/ui"
import {
  getBrowserPreferences,
  saveBrowserPreference,
  getSuitePresets,
  saveSuitePreset,
} from "@/lib/api"
import {
  FEATURE_LABELS,
  SUITE_DOCKABLES,
  getSuiteDefaultSettings,
  type OverlayFeatures,
  type OverlaySettings,
} from "@/lib/overlaySettings"

interface OverlaySettingsPanelProps {
  site: string
  /** "suite-default" = editing the default preset for a suite type
   *  "per-site" = editing per-site override (default) */
  mode?: "suite-default" | "per-site"
  /** Suite id — required when mode is "suite-default" */
  suiteId?: string
}

/**
 * Comprehensive overlay settings panel — fine-grained controls for
 * position, size, opacity, collapse, per-dockable toggles, and per-feature toggles.
 *
 * Two modes:
 * - suite-default: edits the default preset stored under "suites.{suiteId}" in browser-preferences
 * - per-site: edits per-site override stored under "{site}" in browser-preferences
 */
export function OverlaySettingsPanel({ site, mode = "per-site", suiteId }: OverlaySettingsPanelProps) {
  const effectiveSuiteId = suiteId || site.replace("__suite_default__", "")
  const [settings, setSettings] = useState<OverlaySettings>(() => getSuiteDefaultSettings(effectiveSuiteId))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (mode === "suite-default") {
          const { presets } = await getSuitePresets()
          const existing = presets[effectiveSuiteId] as Partial<OverlaySettings> | undefined
          if (existing && !cancelled) {
            setSettings((prev) => mergeSettings(prev, existing))
          }
        } else {
          const { prefs } = await getBrowserPreferences()
          const existing = prefs[site]?.overlaySettings as Partial<OverlaySettings> | undefined
          if (existing && !cancelled) {
            setSettings((prev) => mergeSettings(prev, existing))
          }
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [site, mode, effectiveSuiteId])

  const save = useCallback(async (next: OverlaySettings) => {
    setSaving(true)
    setMsg(null)
    try {
      if (mode === "suite-default") {
        await saveSuitePreset(effectiveSuiteId, next)
        setMsg("Default preset saved.")
      } else {
        await saveBrowserPreference(site, { overlay: next.enabled, overlaySettings: next })
        setMsg("Per-site settings saved.")
      }
    } catch (err) {
      setMsg(`Error: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [site, mode, effectiveSuiteId])

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

  const updateDockable = (id: string, enabled: boolean) => {
    const next = { ...settings, dockables: { ...settings.dockables, [id]: enabled } }
    setSettings(next)
    save(next)
  }

  if (loading) {
    return <Card><p className="muted small">Loading overlay settings…</p></Card>
  }

  const dockableConfigs = SUITE_DOCKABLES[effectiveSuiteId] || SUITE_DOCKABLES.generic

  return (
    <Card>
      <div className="row gap" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>
          {mode === "suite-default" ? "Default Preset" : `Per-Site Settings — ${site}`}
        </h3>
        {saving ? <span className="muted small">Saving…</span> : null}
        {msg ? <span className="muted small">{msg}</span> : null}
      </div>

      <p className="muted small" style={{ margin: "0 0 16px" }}>
        {mode === "suite-default"
          ? "These settings apply as the default to all sites of this suite type. Individual sites can override via per-site customization."
          : `Custom overlay settings for this specific site. Overrides the default ${effectiveSuiteId} preset.`}
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
                min={20}
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

          {/* Per-dockable toggles */}
          {dockableConfigs.length > 0 && (
            <fieldset style={{ border: "1px solid var(--border, #333)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <legend style={{ padding: "0 6px", color: "var(--text-muted, #999)", fontSize: 12 }}>
                Dockable Panels
              </legend>
              <p className="muted small" style={{ margin: "0 0 10px" }}>
                Toggle which dockable panels appear in the overlay. Drag to reposition, resize from bottom-right corner.
              </p>
              <div className="stack" style={{ gap: 6 }}>
                {dockableConfigs.map((d) => (
                  <label
                    key={d.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: settings.dockables[d.id] !== false ? "var(--accent-bg, #6c63ff10)" : "transparent",
                      border: `1px solid ${settings.dockables[d.id] !== false ? "var(--accent, #6c63ff)" : "var(--border, #333)"}`,
                      cursor: "pointer",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={settings.dockables[d.id] !== false}
                      onChange={(e) => updateDockable(d.id, e.target.checked)}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontSize: 16 }}>{d.icon}</span>
                    <div>
                      <strong style={{ fontSize: 13 }}>{d.title}</strong>
                      <p className="muted small" style={{ margin: "2px 0 0", fontSize: 11 }}>
                        Default: {d.defaultSize.width}×{d.defaultSize.height} · {d.defaultPosition}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

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
                onClick={() => update(getSuiteDefaultSettings(effectiveSuiteId))}
              >
                Reset to Default
              </button>
            </div>
          </fieldset>
        </>
      ) : (
        <p className="muted small" style={{ marginTop: 8 }}>
          The overlay is disabled{mode === "suite-default" ? " for this suite type" : ` for ${site}`}. Enable it above to configure PICC interventions.
        </p>
      )}
    </Card>
  )
}

/** Deep-merge overlay settings, preserving nested structure */
function mergeSettings(base: OverlaySettings, patch: Partial<OverlaySettings>): OverlaySettings {
  return {
    ...base,
    ...patch,
    position: { ...base.position, ...(patch.position || {}) },
    size: { ...base.size, ...(patch.size || {}) },
    features: { ...base.features, ...(patch.features || {}) },
    dockables: { ...base.dockables, ...(patch.dockables || {}) },
    dockableLayout: { ...base.dockableLayout, ...(patch.dockableLayout || {}) },
  }
}
