// Phase C patch 1 — webui surface migration.
// Suites.tsx: remove ALL overlay-preview frontend; keep expand-to-manage only.
// TradingSuite.tsx: add SignalNotificationsCard into AutopilotSuite (advisory prefs).
import { readFileSync, writeFileSync } from "node:fs"

function patch(p, fn) {
  let s = readFileSync(p, "utf8").replace(/\r\n/g, "\n")
  const out = fn(s)
  if (out === s) throw new Error("no-op: " + p)
  writeFileSync(p, out)
  console.log("patched", p)
}

patch("src/pages/Suites.tsx", (s) => {
  // Imports gone with the preview frontend.
  s = s.replace(/import { OverlaySettingsPanel } from "@\/components\/OverlaySettingsPanel"\n/, "")
  s = s.replace(/import { DockablePreview } from "@\/components\/DockablePreview"\n/, "")

  // Remove the whole DashboardOverlay component (from its comment/definition to the Suites export).
  const a = s.indexOf("function DashboardOverlay(")
  const b = s.indexOf("export function Suites()")
  if (a < 0 || b < 0 || b <= a) throw new Error("DashboardOverlay bounds not found")
  s = s.slice(0, a) + s.slice(b)

  // State + handler for overlay.
  s = s.replace(/  const \[overlaySuite, setOverlaySuite\] = useState<string \| null>\(null\)\n/, "")
  s = s.replace(/\n  const toggleSuiteOverlay = useCallback\(\(suiteId: string\) => \{\n    setOverlaySuite\(\(prev\) => \(prev === suiteId \? null : suiteId\)\)\n  \}, \[\]\)/, "")

  // Header overlay badge + kbd hint block.
  s = s.replace(/[^\n]*Overlay: \{SUITE_META\[overlaySuite\][^\n]*\n/, "")
  s = s.replace(/[^\n]*No overlay active[^\n]*\n/, "")
  s = s.replace(/[^\n]*kbd style=\{\{ fontSize: 10 \}\}[^\n]*\n/, "")

  // Per-card overlay button.
  s = s.replace(/          const isOverlayActive = overlaySuite === suite\.id\n/, "")
  s = s.replace(/\n                <button\n                  className=\{\`btn btn-sm \$\{isOverlayActive \? "btn-secondary" : "btn-primary"\}\`\n                  onClick=\{\(e\) => \{ e\.stopPropagation\(\); toggleSuiteOverlay\(suite\.id\) \}\}\n                  title=\{isOverlayActive \? "Hide overlay" : "Show overlay for this suite"\}\n                >\n                  \{isOverlayActive \? "✕ Hide Overlay" : "🎯 Show Overlay"\}\n                <\/button>/, "")
  // Simplify the click-to-manage row back to text only.
  s = s.replace('<div className="row gap" style={{ marginTop: 10, alignItems: "center", justifyContent: "space-between" }}>', '<div style={{ marginTop: 10 }}>')
  s = s.replace(/<\/button>\n              <\/div>\n            <\/Card>/, "</Card>", )

  // Bottom mount point.
  s = s.replace(/\n      \{overlaySuite \? <DashboardOverlay suiteId=\{overlaySuite\} onClose=\{\(\) => setOverlaySuite\(null\)\} \/> : null\}/, "")
  return s
})

// ── AutopilotSuite gains the advisory notifications card ────────────────────
patch("src/components/TradingSuite.tsx", (s) => {
  // Register the card right under ReadinessPanel inside AutopilotSuite.
  const anchor = "      <ReadinessPanel />"
  if (!s.includes(anchor)) throw new Error("readiness anchor missing")
  s = s.replace(anchor, `${anchor}

      <SignalNotificationsCard />`)

  // Append the component definition before ToggleRow helper.
  const trowAnchor = "function ToggleRow("
  if (!s.includes(trowAnchor)) throw new Error("ToggleRow anchor missing")
  const comp = `/** Advisory notification preferences — channels, thresholds, test send. */
export function SignalNotificationsCard() {
  const [status, setStatus] = useState<{ ok: boolean; prefs: { minConfidence: number; leadMinutes: number; windowMinutes: number; channels: Record<string, boolean> }; subscriptions: number; channels: Array<{ name: string; configured: boolean; userEnabled: boolean }> } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ minConfidence: number; leadMinutes: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await request<{ ok: boolean; prefs: any; subscriptions: number; channels: any[] }>("/notifications/status")
      setStatus(r)
      setDraft({ minConfidence: r.prefs.minConfidence, leadMinutes: r.prefs.leadMinutes })
    } catch { setStatus(null) }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft) return
    try {
      await post("/notifications/prefs", draft)
      setMsg("Notification preferences saved.")
      await load()
    } catch (e) { setMsg((e as Error).message) }
  }

  const testSend = async () => {
    try {
      await post("/notifications/test", {})
      setMsg("Test dispatched — check bell/email/push.")
    } catch (e) { setMsg((e as Error).message) }
  }

  const toggleChannel = async (name: string, enabled: boolean) => {
    try {
      await post("/notifications/prefs", { channels: { [name]: enabled } })
      await load()
    } catch (e) { setMsg((e as Error).message) }
  }

  return (
    <Card className="pad stack">
      <h3>Advisory alerts</h3>
      <p className="muted small">
        The Signal Engine watches your scoped assets and notifies you ahead of ideal buy/sell windows.
        Execution is removed — you act on your platform; PICC watches and tells you.
      </p>
      {!status ? (
        <Spinner label="Loading notification settings…" />
      ) : (
        <>
          <div className="grid grid-2">
            <Field label="Min consensus confidence %">
              <Input type="number" min={30} max={95} value={draft?.minConfidence ?? status.prefs.minConfidence}
                onChange={(e) => setDraft((d) => ({ ...(d ?? { leadMinutes: status.prefs.leadMinutes }), minConfidence: Number(e.target.value) }))} />
            </Field>
            <Field label="Lead time (minutes)">
              <Input type="number" min={0} max={60} value={draft?.leadMinutes ?? status.prefs.leadMinutes}
                onChange={(e) => setDraft((d) => ({ ...(d ?? { minConfidence: status.prefs.minConfidence }), leadMinutes: Number(e.target.value) }))} />
            </Field>
          </div>
          <div className="stack">
            {(status.channels ?? []).map((c) => (
              <div key={c.name} className="row-between">
                <span className="field-label">
                  {c.name}{c.configured ? "" : " (not configured — set env keys)"}
                </span>
                <ToggleRow label="" checked={c.userEnabled} onChange={() => void toggleChannel(c.name, !c.userEnabled)} />
              </div>
            ))}
          </div>
          <div className="row gap">
            <Button variant="primary" onClick={save}>Save preferences</Button>
            <Button variant="secondary" onClick={testSend}>Send test</Button>
          </div>
          {msg ? <p className="muted small">{msg}</p> : null}
        </>
      )}
    </Card>
  )
}

${trowAnchor}`
  return s.replace(trowAnchor, comp)
})
console.log("done")
