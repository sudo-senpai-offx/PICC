// Embedded browser studio page (spec PICC_EMBEDDED_BROWSER_STUDIO_v1.md, Phase A).
// Renders the live shared Chromium screencast (SSE frames) with a tab bar,
// address bar, nav controls and open/close. One browser for every suite — this
// page is only a viewport over the server's studio singleton; it never opens a
// second browser or a separate window.
import { useEffect, useRef, useState } from "react"
import {
  browserGoto,
  browserNav,
  browserTab,
  closeBrowser,
  getBrowserStatus,
  openBrowser,
  streamBrowser
} from "@/lib/api"
import type { StudioStreamEvent, StudioStatus, StudioTab } from "@/lib/api"

interface Props {
  /** When rendered inside a ministry room, surface a compact variant. */
  compact?: boolean
}

interface AssistState {
  siteName: string | null
  hasSavedCredentials: boolean | null
}

const EMPTY_TABS: StudioTab[] = []

export function StudioPage({ compact = false }: Props) {
  const [status, setStatus] = useState<StudioStatus | null>(null)
  const [tabs, setTabs] = useState<StudioTab[]>(EMPTY_TABS)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [frame, setFrame] = useState<{ data: string; width: number; height: number } | null>(null)
  const [address, setAddress] = useState("")
  const [assist, setAssist] = useState<AssistState>({ siteName: null, hasSavedCredentials: null })
  const [error, setError] = useState<string | null>(null)
  const openingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    getBrowserStatus()
      .then((s) => {
        if (cancelled) return
        setStatus(s)
        setTabs(s.tabs ?? EMPTY_TABS)
        setActiveTabId(s.activeTabId ?? null)
        setAddress(s.currentUrl ?? "")
        if (!s.open && !openingRef.current) {
          openingRef.current = true
          void openBrowser().then((opened) => {
            if (!cancelled) setStatus(opened)
          })
        }
      })
      .catch(() => {
        if (!cancelled) setError("Browser status unavailable — is the server running?")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const stream = streamBrowser((e: StudioStreamEvent) => {
      if (e.type === "frame" && e.data) {
        const vp = e.vp ?? { width: 1440, height: 900 }
        setFrame({ data: e.data, width: vp.width, height: vp.height })
        return
      }
      if (e.type === "status" && e.status) {
        setStatus(e.status)
        setAddress((prev) => e.status?.currentUrl ?? prev)
        return
      }
      if (e.type === "tabs" && e.tabs) {
        setTabs(e.tabs)
        setActiveTabId(e.activeTabId ?? null)
        const active = e.tabs.find((t) => t.id === e.activeTabId)
        if (active) setAddress(active.url)
        return
      }
      if (e.type === "assist" && e.assist) {
        setAssist({
          siteName: e.assist.site?.name ?? null,
          hasSavedCredentials: e.assist.hasSavedCredentials
        })
        return
      }
      if (e.type === "error") {
        setError(e.error ?? "Browser stream error")
      }
    })
    return () => stream.close()
  }, [])

  const onGoto = () => {
    const url = address.trim()
    if (!url) return
    void browserGoto(url)
  }

  const onNav = (action: "back" | "forward" | "reload") => {
    void browserNav(action)
  }

  const onSwitchTab = (id: number) => {
    void browserTab({ action: "switch", id })
  }

  const onCloseTab = (id: number) => {
    void browserTab({ action: "close", id })
  }

  const onOpen = () => {
    openingRef.current = true
    void openBrowser().then((s) => setStatus(s))
  }

  const onClose = () => {
    void closeBrowser().then((s) => {
      setStatus(s)
      setTabs([])
      setFrame(null)
    })
  }

  const open = status?.open === true

  if (error && !open) {
    return <div className="stack stack-lg"><p className="muted">{error}</p></div>
  }

  return (
    <div className={`stack ${compact ? "stack-compact" : "stack stack-lg"}`} data-testid="studio-page">
      <div className="studio-toolbar">
        <div className="studio-tabs" role="tablist" data-testid="studio-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              data-testid="studio-tab"
              data-tab-id={t.id}
              className={`studio-tab ${t.id === activeTabId ? "active" : ""}`}
              onClick={() => onSwitchTab(t.id)}
              title={t.url}
            >
              <span className="studio-tab-title">{t.title || t.url || "New tab"}</span>
              <span
                role="button"
                data-testid="studio-tab-close"
                className="studio-tab-close"
                onClick={(ev) => {
                  ev.stopPropagation()
                  onCloseTab(t.id)
                }}
                title="Close tab"
              >
                ×
              </span>
            </button>
          ))}
          {tabs.length === 0 ? <span className="muted small">No tabs — open a link from any suite, or type an address below.</span> : null}
        </div>
        <div className="studio-controls">
          <button className="btn btn-ghost btn-sm" data-testid="studio-back" onClick={() => onNav("back")} title="Back">←</button>
          <button className="btn btn-ghost btn-sm" data-testid="studio-forward" onClick={() => onNav("forward")} title="Forward">→</button>
          <button className="btn btn-ghost btn-sm" data-testid="studio-reload" onClick={() => onNav("reload")} title="Reload">⟳</button>
          <input
            className="input studio-address"
            data-testid="studio-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onGoto() }}
            placeholder="https://…"
            aria-label="Address"
          />
          <button className="btn btn-sm" data-testid="studio-goto" onClick={onGoto}>Go</button>
          {open ? (
            <button className="btn btn-ghost btn-sm" data-testid="studio-close-browser" onClick={onClose} title="Close the shared browser">Close</button>
          ) : (
            <button className="btn btn-sm" data-testid="studio-open-browser" onClick={onOpen} title="Start the shared browser">Open browser</button>
          )}
        </div>
      </div>

      {open ? (
        <div className="studio-viewport">
          {frame ? (
            <img
              data-testid="studio-frame"
              src={`data:image/jpeg;base64,${frame.data}`}
              alt="PICC browser screencast"
              style={{ width: frame.width, height: frame.height, maxWidth: "100%", maxHeight: "100%" }}
            />
          ) : (
            <div className="studio-placeholder">
              <p className="muted">Waiting for the screencast…</p>
              {tabs.length === 0 ? <p className="muted small">Tip: click an external link in any suite, or type a URL above — it opens here in the shared browser.</p> : null}
            </div>
          )}
        </div>
      ) : (
        <div className="studio-viewport">
          <div className="studio-placeholder">
            <p className="muted">The shared PICC browser is closed.</p>
            <button className="btn btn-sm" onClick={onOpen} data-testid="studio-open-browser">Open browser</button>
          </div>
        </div>
      )}

      <div className="studio-footer">
        <span data-testid="studio-site" className="muted small">
          {assist.siteName ? `Site: ${assist.siteName}` : "Site: —"}
        </span>
        <span data-testid="studio-vault" className="muted small">
          Vault: {assist.hasSavedCredentials === null ? "—" : assist.hasSavedCredentials ? "saved credentials" : "no saved credentials"}
        </span>
        <span className="muted small">{open ? `Browser: open${status?.headless ? " (headless)" : ""}` : "Browser: closed"}</span>
      </div>
    </div>
  )
}

export default StudioPage