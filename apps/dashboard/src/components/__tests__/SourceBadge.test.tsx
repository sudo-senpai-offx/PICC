// @vitest-environment jsdom
// T11 (slice 6 reskin) — the shared honesty-first source badge. The old chart
// badges claimed "EO live" for EVERY EO-buffered series regardless of
// freshness, and "EO headless live" implied live liveness for a headless feed.
// SourceBadge must say exactly what the server tags say and NEVER emit the
// substring "EO live" / "EO headless live":
//   • studio/headless provenance → EO + a real freshness status
//     ("active" / "stale" / "stream offline")
//   • EO buffer + Yahoo daily → their real, degraded labels
//   • unknown/generic slug → muted slug — a ccxt/broker feed is not EO
import { describe, expect, it } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { SourceBadge, type SourceBadgeProps } from "@/components/SourceBadge"

function mount(el: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(el) })
  return {
    host,
    text: () => host.textContent ?? "",
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

function badge(overrides: Partial<SourceBadgeProps> = {}, defaults: SourceBadgeProps = { servedSource: "expertoption", feed: null }) {
  return mount(<SourceBadge {...defaults} {...overrides} />)
}

describe("SourceBadge (T11 — never claims 'EO live')", () => {
  it("no source and source 'none' render nothing", () => {
    const a = badge({ servedSource: null })
    expect(a.text()).toBe("")
    const b = badge({ servedSource: "none" })
    expect(b.text()).toBe("")
    a.unmount(); b.unmount()
  })

  it("studio provenance with a fresh series → 'EO studio · active'", () => {
    const b = badge({ servedSource: "expertoption", feed: "studio", stale: false })
    const t = b.text()
    expect(t).toContain("EO studio")
    expect(t).toContain("active")
    expect(t).not.toContain("stale")
    expect(t).not.toContain("offline")
    b.unmount()
  })

  it("studio provenance with a stale series → 'EO studio · stale'", () => {
    const b = badge({ servedSource: "expertoption", feed: "studio", stale: true })
    expect(b.text()).toContain("EO studio")
    expect(b.text()).toContain("stale")
    b.unmount()
  })

  it("studio provenance with a dead stream → 'EO studio · stream offline'", () => {
    const b = badge({ servedSource: "expertoption", feed: "studio", stale: false, streamError: true })
    const t = b.text()
    expect(t).toContain("EO studio")
    expect(t).toContain("stream offline")
    expect(t).not.toContain("active")
    b.unmount()
  })

  it("headless provenance is labeled 'headless' and NEVER 'EO headless live'", () => {
    for (const stale of [false, true]) {
      const b = badge({ servedSource: "expertoption", feed: "headless", stale })
      const t = b.text()
      expect(t).toContain("EO headless")
      expect(t).not.toContain("EO headless live")
      expect(t).not.toContain("EO live")
      b.unmount()
    }
  })

  it("EO buffer is its real degraded label, not a live claim", () => {
    const b = badge({ servedSource: "buffer", feed: null })
    const t = b.text()
    expect(t).toContain("EO buffer")
    expect(t).not.toContain("live")
    expect(t).not.toContain("active")
    b.unmount()
  })

  it("a stale EO buffer adds ' · stale'", () => {
    const b = badge({ servedSource: "buffer", feed: null, stale: true })
    expect(b.text()).toContain("EO buffer · stale")
    b.unmount()
  })

  it("yahoo and yahoo-daily stay 'Yahoo daily · delayed'", () => {
    for (const servedSource of ["yahoo", "yahoo-daily"]) {
      const b = badge({ servedSource, feed: servedSource })
      expect(b.text()).toContain("Yahoo daily")
      expect(b.text()).toContain("delayed")
      b.unmount()
    }
  })

  it("EO without provenance is 'EO · active' / 'EO · stale' / 'EO · stream offline'", () => {
    const fresh = badge({ servedSource: "expertoption", feed: null, stale: false })
    expect(fresh.text()).toContain("EO · active")
    expect(fresh.text()).not.toContain("stale")
    fresh.unmount()
    const stale = badge({ servedSource: "expertoption", feed: null, stale: true })
    expect(stale.text()).toContain("EO · stale")
    stale.unmount()
    const down = badge({ servedSource: "expertoption", feed: null, streamError: true })
    expect(down.text()).toContain("EO · stream offline")
    down.unmount()
  })

  it("an unknown/generic slug renders muted with no EO claim", () => {
    const b = badge({ servedSource: "ccxt", feed: "ccxt" })
    const t = b.text()
    expect(t).toContain("ccxt")
    expect(t).not.toContain("EO")
    expect(t).not.toContain("live")
    b.unmount()
    const stale = badge({ servedSource: "ccxt", feed: "ccxt", stale: true })
    expect(stale.text()).toContain("ccxt · stale")
    stale.unmount()
  })

  it("never emits the exact strings 'EO live' or 'EO headless live' across all states", () => {
    const cases: SourceBadgeProps[] = [
      { servedSource: "live", feed: null },
      { servedSource: "live", feed: "studio", stale: false },
      { servedSource: "live", feed: "headless", stale: false },
      { servedSource: "buffer", feed: null, stale: true },
      { servedSource: "expertoption", feed: "studio", stale: false },
      { servedSource: "expertoption", feed: "headless", stale: false },
      { servedSource: "expertoption", feed: null, stale: false },
      { servedSource: "expertoption", feed: "studio", stale: false, streamError: true }
    ]
    for (const c of cases) {
      const b = badge(c)
      const t = b.text()
      expect(t, JSON.stringify(c)).not.toContain("EO live")
      expect(t, JSON.stringify(c)).not.toContain("EO headless live")
      expect(t, JSON.stringify(c)).not.toMatch(/headless live/)
      b.unmount()
    }
  })
})