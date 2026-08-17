import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CATALOG } from "@/lib/streamCatalog"
import { closeBrowser, openBrowser } from "@/lib/api"
import { FEATURES, getFeatureFlags, isFeatureOn, setFeatureFlag } from "@/lib/settings"
import type { FeatureKey } from "@/lib/settings"

interface CmdItem {
  id: string
  icon: string
  label: string
  hint?: string
  group: string
  keywords?: string
  run: () => void
}

const NAV_PAGES: { path: string; label: string; icon: string; feature?: FeatureKey; keywords?: string }[] = [
  { path: "/", label: "Command Center", icon: "▦", keywords: "dashboard home overview" },
  { path: "/simulator", label: "Simulator", icon: "📊", feature: "simulator", keywords: "financial twin monte carlo prediction listing content" },
  { path: "/suites", label: "Suites", icon: "📈", feature: "trading", keywords: "markets prediction paper ledger demo autopilot expertoption signals watchlist" },
  { path: "/agents", label: "Agents", icon: "🤖", feature: "agents", keywords: "crewai research crew" },
  { path: "/opportunities", label: "Opportunities", icon: "🧭", feature: "opportunities", keywords: "research bounties workflows" },
  { path: "/income", label: "Income", icon: "💰", feature: "income", keywords: "payment links streams earnings catalog connectors automator" },
  { path: "/settings", label: "Settings", icon: "⚙️", keywords: "features toggles keys" },
  { path: "/profile", label: "Profile", icon: "👤", keywords: "account user" }
]

const BROWSER_URLS = CATALOG.filter((c) => /^https?:/.test(c.url))

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const flags = getFeatureFlags()

  useEffect(() => {
    if (open) {
      setQuery("")
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const items = useMemo<CmdItem[]>(() => {
    const list: CmdItem[] = []

    for (const p of NAV_PAGES) {
      if (p.feature && !isFeatureOn(p.feature)) continue
      list.push({
        id: `nav-${p.path}`,
        icon: p.icon,
        label: p.label,
        hint: "Go to page",
        group: "Pages",
        keywords: p.keywords,
        run: () => {
          onClose()
          navigate(p.path)
        }
      })
    }

    list.push(
      {
        id: "br-open",
        icon: "▶",
        label: "Open PICC browser",
        hint: "Launch the in-app browser",
        group: "Browser",
        run: () => {
          onClose()
          void openBrowser()
        }
      },
      {
        id: "br-close",
        icon: "■",
        label: "Close PICC browser",
        hint: "Shut the managed browser down",
        group: "Browser",
        run: () => {
          onClose()
          void closeBrowser()
        }
      }
    )

    for (const c of BROWSER_URLS) {
      list.push({
        id: `launch-${c.id}`,
        icon: "🔗",
        label: `Open ${c.name} in browser`,
        hint: c.category,
        group: "Income apps",
        keywords: c.name,
        run: () => {
          onClose()
          void openBrowser()
        }
      })
    }

    for (const [key, def] of Object.entries(FEATURES)) {
      const k = key as FeatureKey
      list.push({
        id: `feat-${k}`,
        icon: flags[k] ? "✓" : "○",
        label: `${flags[k] ? "Disable" : "Enable"} feature: ${def.label}`,
        hint: def.desc,
        group: "Feature toggles",
        keywords: def.label,
        run: () => {
          setFeatureFlag(k, !flags[k])
          onClose()
          window.location.reload()
        }
      })
    }

    return list
  }, [flags, navigate, onClose])

  const q = query.trim().toLowerCase()
  const matches = q
    ? items.filter((i) => {
        const hay = `${i.label} ${i.group} ${i.keywords ?? ""} ${i.hint ?? ""}`.toLowerCase()
        return q.split(/\s+/).every((part) => hay.includes(part))
      })
    : items

  const visible = matches.slice(0, 12)

  const runAt = (idx: number) => {
    const it = visible[idx]
    if (it) it.run()
  }

  if (!open) return null

  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true">
        <div className="palette-input-row">
          <span className="palette-caret">⌕</span>
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Type to navigate, launch an app, control the browser…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                onClose()
              } else if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, visible.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                runAt(active)
              }
            }}
          />
          <kbd className="palette-kbd">Esc</kbd>
        </div>
        <div className="palette-list">
          {visible.length === 0 ? (
            <div className="palette-empty muted">No matches for “{query}” — try a page, feature, or income app.</div>
          ) : (
            visible.map((it, idx) => (
              <button
                key={it.id}
                type="button"
                className={idx === active ? "palette-item active" : "palette-item"}
                onMouseEnter={() => setActive(idx)}
                onClick={() => runAt(idx)}
              >
                <span className="palette-icon">{it.icon}</span>
                <span className="palette-main">
                  <span className="palette-label">{it.label}</span>
                  {it.hint ? <span className="palette-hint muted">{it.hint}</span> : null}
                </span>
                <span className="palette-group">{it.group}</span>
              </button>
            ))
          )}
        </div>
        <div className="palette-footer muted">
          <kbd>↑</kbd> <kbd>↓</kbd> navigate · <kbd>↵</kbd> run · <kbd>Ctrl K</kbd> close
        </div>
      </div>
    </div>
  )
}
