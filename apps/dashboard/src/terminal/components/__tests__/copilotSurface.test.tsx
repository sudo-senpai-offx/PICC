// @vitest-environment jsdom
// WS-6 T3 — CopilotPanel + useTerminalSnapshot (RED, AC-014 / AC-007).
//
// AC-014: the copilot slot must display `copilot: remote`, model/timestamp when
// observed, cache age, and an explicit pending/stale/unavailable state. Remote
// text must never become a signal, risk input, score, sizing value, or
// execution authorization.
//
// AC-007 / T0: the snapshot hook must consume the EXISTING shared bus and must
// never open a second transport.
import { describe, expect, it, afterEach, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CopilotPanel } from "../CopilotPanel"
import { useTerminalSnapshot } from "../../hooks/useTerminalSnapshot"
import { copilotState } from "../../domain/copilot"

let mounted: Array<{ unmount: () => void }> = []

function render(node: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(node))
  mounted.push({
    unmount() {
      flushSync(() => root.unmount())
      document.body.removeChild(host)
    }
  })
  return host
}

afterEach(() => {
  mounted.forEach((m) => m.unmount())
  mounted = []
  vi.restoreAllMocks()
})

const NOW = 1_700_000_000_000

describe("CopilotPanel — provenance and states (AC-014)", () => {
  it("shows the remote provenance for a ready explanation", () => {
    const c = copilotState({ status: "ready", model: "m-1", generatedAt: NOW - 1_000, cacheExpiresAt: NOW + 10_000 })
    const host = render(<CopilotPanel copilot={c} now={NOW} />)
    expect(host.textContent).toContain("copilot: remote")
    expect(host.textContent).toContain("m-1")
  })

  it("shows cache age for a ready explanation", () => {
    const c = copilotState({ status: "ready", model: "m", generatedAt: NOW - 4_000, cacheExpiresAt: NOW + 1_000 })
    const host = render(<CopilotPanel copilot={c} now={NOW} />)
    expect(host.textContent).toMatch(/4s|4 s|4000ms|cache/i)
  })

  it("shows an explicit pending state rather than a spinner or a zero", () => {
    const c = copilotState({ status: "pending", model: null, generatedAt: null, cacheExpiresAt: null })
    const host = render(<CopilotPanel copilot={c} now={NOW} />)
    expect(host.textContent).toMatch(/pending/i)
    expect(host.textContent).toMatch(/awaiting/i)
  })

  it("shows an explicit stale state once the cache expires", () => {
    const c = copilotState({ status: "ready", model: "m", generatedAt: NOW - 120_000, cacheExpiresAt: NOW - 1 })
    const host = render(<CopilotPanel copilot={c} now={NOW} />)
    expect(host.textContent).toMatch(/stale/i)
  })

  it("shows unavailable with the operator's reason", () => {
    const c = copilotState({ status: "unavailable", model: null, generatedAt: null, cacheExpiresAt: null }, "provider timeout")
    const host = render(<CopilotPanel copilot={c} now={NOW} />)
    expect(host.textContent).toMatch(/unavailable/i)
    expect(host.textContent).toMatch(/timeout/i)
  })

  it("renders with no copilot explanation at all", () => {
    const host = render(<CopilotPanel copilot={null} now={NOW} />)
    expect(host.textContent).toMatch(/copilot: remote/i)
  })
})

describe("CopilotPanel — prohibited side effect (AC-014)", () => {
  it("renders no score, confidence, size, or execution control", () => {
    const c = copilotState({ status: "ready", model: "m", generatedAt: NOW, cacheExpiresAt: NOW + 1_000 })
    const host = render(<CopilotPanel copilot={c} now={NOW} />)
    for (const forbidden of ["score", "confidence", "position size", "execute", "notional"]) {
      expect(host.textContent?.toLowerCase(), `copilot panel must not render ${forbidden}`).not.toContain(forbidden)
    }
  })

  it("renders no button or link that could authorize an action", () => {
    const c = copilotState({ status: "ready", model: "m", generatedAt: NOW, cacheExpiresAt: NOW + 1_000 })
    const host = render(<CopilotPanel copilot={c} now={NOW} />)
    expect(host.querySelector("button")).toBeNull()
    expect(host.querySelector("a")).toBeNull()
  })

  it("exposes no numeric value element a caller could read as a decision input", () => {
    const c = copilotState({ status: "ready", model: "m", generatedAt: NOW, cacheExpiresAt: NOW + 1_000 })
    const host = render(<CopilotPanel copilot={c} now={NOW} />)
    expect(host.querySelector("[data-value]")).toBeNull()
    expect(host.querySelector("[data-metric]")).toBeNull()
  })
})

describe("useTerminalSnapshot — consumes the shared bus (AC-007, T0)", () => {
  function probe(onResult: (v: ReturnType<typeof useTerminalSnapshot>) => void) {
    function Probe() {
      onResult(useTerminalSnapshot())
      return null
    }
    render(<Probe />)
  }

  it("returns an unavailable availability when the bus is disconnected", () => {
    let result: ReturnType<typeof useTerminalSnapshot> | null = null
    probe((v) => {
      result = v
    })
    // The real bus starts disconnected in jsdom (no SSE), so the honest state
    // must be `unavailable`, never a fabricated `live` with zeroed data.
    expect(result!.availability.status).not.toBe("live")
  })

  it("never exposes a section as 0 or [] when nothing was observed", () => {
    let result: ReturnType<typeof useTerminalSnapshot> | null = null
    probe((v) => {
      result = v
    })
    for (const key of ["trading", "positions", "closed", "signals"] as const) {
      expect(result!.data[key]).toBeNull()
    }
  })

  it("returns a stable object shape regardless of bus state", () => {
    let result: ReturnType<typeof useTerminalSnapshot> | null = null
    probe((v) => {
      result = v
    })
    expect(result).toHaveProperty("availability")
    expect(result).toHaveProperty("data")
  })
})
