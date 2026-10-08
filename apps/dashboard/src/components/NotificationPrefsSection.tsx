import { useEffect, useState } from "react"
import { getNotificationPrefs, saveNotificationPrefs } from "@/lib/api"
import type { NotificationChannels, NotificationPrefs } from "@/lib/api"

export type WebPushPermission = "granted" | "denied" | "default" | "unsupported"

/** The browser's answer, narrowed once so the rest stays unit-testable. */
export function webPushPermission(): WebPushPermission {
  if (typeof Notification === "undefined") return "unsupported"
  const p = Notification.permission
  return p === "granted" || p === "denied" || p === "default" ? p : "unsupported"
}

const CHANNEL_META: { key: keyof NotificationChannels; label: string; desc: string }[] = [
  { key: "inApp", label: "In-app", desc: "Bell notification inside PICC. Always available." },
  { key: "webpush", label: "Web push", desc: "Browser push notification on this device." },
  { key: "telegram", label: "Telegram", desc: "Bot message when Telegram is configured on the server." },
  { key: "webhook", label: "Webhook", desc: "HTTP POST when a webhook URL is configured on the server." }
]

function prefsToState(p: NotificationPrefs) {
  return {
    minConfidence: p.minConfidence,
    leadMinutes: p.leadMinutes,
    windowMinutes: p.windowMinutes,
    channels: { ...p.channels }
  }
}

export function NotificationPrefsSection() {
  const [prefs, setPrefs] = useState<ReturnType<typeof prefsToState> | null>(null)
  const [permission, setPermission] = useState<WebPushPermission>(() => webPushPermission())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    getNotificationPrefs().then((r) => setPrefs(prefsToState(r.prefs))).catch(() => {})
  }, [])

  const onToggleChannel = async (key: keyof NotificationChannels, next: boolean) => {
    if (key !== "webpush" || !next) {
      setPrefs((p) => (p ? { ...p, channels: { ...p.channels, [key]: next } } : p))
      return
    }
    // Enabling web push goes through the browser permission first.
    const current = webPushPermission()
    if (current === "granted") {
      setPrefs((p) => (p ? { ...p, channels: { ...p.channels, webpush: true } } : p))
      return
    }
    if (current === "unsupported" || current === "denied") return // disabled anyway; guard only
    try {
      const result = await Notification.requestPermission()
      if (result === "granted") {
        setPermission("granted")
        setNote(null)
        setPrefs((p) => (p ? { ...p, channels: { ...p.channels, webpush: true } } : p))
      } else {
        setPermission(result === "denied" ? "denied" : "default")
        setNote("Permission was not granted — the toggle stays off.")
      }
    } catch {
      setNote("Permission was not granted — the toggle stays off.")
    }
  }

  const save = async () => {
    if (!prefs) return
    setBusy(true)
    setNote(null)
    try {
      const saved = await saveNotificationPrefs({
        minConfidence: prefs.minConfidence,
        leadMinutes: prefs.leadMinutes,
        windowMinutes: prefs.windowMinutes,
        channels: prefs.channels
      })
      setPrefs(prefsToState(saved.prefs))
      setNote("Notification settings saved — they take effect on the next alert.")
    } catch (err) {
      setNote(`Failed to save: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  // Honest rendering: the webpush checkbox is ON only when the server wants it
  // AND the browser granted permission. A denied browser renders OFF + disabled
  // with the reason — never a checked toggle that cannot deliver.
  const webpushChecked = (prefs?.channels.webpush ?? false) && permission === "granted"
  const webpushDisabled = busy || permission === "denied" || permission === "unsupported"

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Notifications</h2>
      <p className="muted">
        Which channels PICC may use for advisory alerts, and the confidence / timing
        thresholds that trigger them.
      </p>
      {!prefs ? (
        <p className="muted small">Loading notification settings…</p>
      ) : (
        <div className="stack">
          {CHANNEL_META.map(({ key, label, desc }) =>
            key === "webpush" ? (
              <div key={key}>
                <label className="row" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={webpushChecked}
                    disabled={webpushDisabled}
                    onChange={(e) => void onToggleChannel("webpush", e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <strong>{label}</strong>
                    <span className="muted"> — {desc}</span>
                  </span>
                </label>
                {permission === "denied" && (
                  <p className="muted small" style={{ margin: "4px 0 0 24px" }}>
                    Browser notifications are blocked for this site — allow them in the
                    browser&apos;s site settings. The toggle stays off until then.
                  </p>
                )}
                {permission === "default" && (
                  <p className="muted small" style={{ margin: "4px 0 0 24px" }}>
                    Enabling will ask the browser for permission first.
                  </p>
                )}
                {permission === "unsupported" && (
                  <p className="muted small" style={{ margin: "4px 0 0 24px" }}>
                    This browser does not support the Notifications API — web push stays off.
                  </p>
                )}
              </div>
            ) : (
              <label key={key} className="row" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={prefs.channels[key]}
                  disabled={busy}
                  onChange={(e) => void onToggleChannel(key, e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>{label}</strong>
                  <span className="muted"> — {desc}</span>
                </span>
              </label>
            )
          )}

          <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
            <label style={{ flex: "1 1 160px" }}>
              Minimum confidence
              <input
                className="input"
                type="number"
                aria-label="Minimum confidence"
                min={30}
                max={95}
                value={prefs.minConfidence}
                disabled={busy}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) setPrefs((p) => (p ? { ...p, minConfidence: v } : p))
                }}
              />
            </label>
            <label style={{ flex: "1 1 160px" }}>
              Lead minutes
              <input
                className="input"
                type="number"
                aria-label="Lead minutes"
                min={0}
                max={60}
                value={prefs.leadMinutes}
                disabled={busy}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) setPrefs((p) => (p ? { ...p, leadMinutes: v } : p))
                }}
              />
            </label>
            <label style={{ flex: "1 1 160px" }}>
              Window minutes
              <input
                className="input"
                type="number"
                aria-label="Window minutes"
                min={1}
                max={240}
                value={prefs.windowMinutes}
                disabled={busy}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) setPrefs((p) => (p ? { ...p, windowMinutes: v } : p))
                }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save notification settings"}
            </button>
          </div>
          {note && <p className="muted">{note}</p>}
        </div>
      )}
    </div>
  )
}
