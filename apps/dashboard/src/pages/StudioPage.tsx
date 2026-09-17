// Browser studio page — subtle streaming + suite-linking manager
// (plan PICC_STUDIO_SIMPLIFICATION_AND_SOURCE_LANDING_v1.md, Part A).
// Manages the server's shared studio singleton: tab bar, address bar, nav
// controls, open/close, live stream state, and a suite-linking chip. The
// viewport slideshow and the fullscreen toggle are REMOVED (owner directive
// 2026-09-16): this page never renders frames and never writes a server
// setting — perfMode and session-capture settings are owned by Settings.tsx
// only. Frame events on the stream are received and ignored; the data plane
// (status/tabs/assist/error) commits at its own cadence.
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
  suite: { id: string; label: string } | null
}

const EMPTY_TABS: StudioTab[] = []

export function StudioPage({ compact = false }: Props) {
  const [status, setStatus] = useState<StudioStatus | null>(null)
  const [tabs, setTabs] = useState<StudioTab[]>(EMPTY_TABS)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [address, setAddress] = useState("")
  const [assist, setAssist] = useState<AssistState>({ siteName: null, hasSavedCredentials: null, suite: null })
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
      // Data plane only. Frame events are deliberately ignored: the viewport
      // slideshow is gone, so a frame payload must never cause a commit.
      if (e.type === "frame") return
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
          hasSavedCredentials: e.assist.hasSavedCredentials,
          suite: e.assist.suite ? { id: e.assist.suite.id, label: e.assist.suite.label } : null
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
    })
  }

  const onNewTab = () => {
    void browserTab({ action: "new" })
  }

  const open = status?.open === true
  // Live indicator is derived from OBSERVED stream state only: the browser is
  // open AND the stream reports at least one subscriber. Never fabricated.
  const live = open && typeof status?.subscriberCount === "number" && status.subscriberCount > 0

  if (error && !open) {
    return <div className="stack stack-lg"><p className="muted">{error}</p></div>
  }

  return (
    <div className={`studio-root stack ${compact ? "stack-compact" : "stack stack-lg"}`} data-testid="studio-page">
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
          <button className="studio-tab-new" data-testid="studio-new-tab" onClick={onNewTab} title="New tab" aria-label="New tab">+</button>
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

      <div className="studio-footer">
        <span data-testid="studio-site" className="muted small">
          {assist.siteName ? `Site: ${assist.siteName}` : "Site: —"}
        </span>
        <span data-testid="studio-vault" className="muted small">
          Vault: {assist.hasSavedCredentials === null ? "—" : assist.hasSavedCredentials ? "saved credentials" : "no saved credentials"}
        </span>
        <span data-testid="studio-live" className={`muted small ${live ? "studio-live-on" : ""}`}>
          {live ? "● live" : "● closed"}
        </span>
        {assist.suite ? (
          <a className="btn btn-ghost btn-sm studio-suite-link" data-testid="studio-suite-link" href={`/suites/${assist.suite.id}`}>
            Back to {assist.suite.label}
          </a>
        ) : null}
      </div>
    </div>
  )
}

export default StudioPage