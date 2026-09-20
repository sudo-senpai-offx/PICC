// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { SoakBay } from "../SoakBay"
import type { V32RegisterSnapshot } from "@/lib/v32"

let mockSnapshot: { ts: number; v32: V32RegisterSnapshot | null } | null = null
let mockConnected = true

vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({ snapshot: mockSnapshot, live: null, connected: mockConnected, error: null })
}))

const SOAK: V32RegisterSnapshot = {
  ok: true, enabled: false, mode: "shadow", at: 1000,
  assets: [], assetCount: 0,
  soak: { resolved: 0, breakeven: null, reason: "v3.2 lane off — soak digits require a powered toggle" },
  flipGate: { flip: false, legacyExpectancy: null, candidateExpectancy: null, legacyTrades: 0, candidateTrades: 0, reason: "no decided rows for one engine — soak not comparable" },
  watch: { total: 3, buffered: 1, reason: null },
  decisions: { resolved: 18, total: 100 },
  breakeven: null,
  uptime: { seconds: null, reason: "v3.2 lane off — uptime requires a powered toggle" },
  explain: []
}

function mount(host: HTMLDivElement) {
  const root = createRoot(host)
  flushSync(() => { root.render(<SoakBay />) })
  return () => { flushSync(() => { root.unmount() }) }
}

describe("SoakBay", () => {
  afterEach(() => { vi.clearAllMocks(); mockSnapshot = null; mockConnected = true })

  it("renders the design's soak digits with honest labels (not zeros)", () => {
    mockSnapshot = { ts: Date.now(), v32: SOAK }
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = mount(host)
    const text = host.textContent ?? ""
    expect(text).toContain("Soak")
    expect(text).toContain("shadow")
    expect(text).toContain("3 watched")   // total watch set
    expect(text).toContain("1 buffered") // ≥40 × 1m
    expect(text).toContain("18 / 100")   // decisions resolved/total
    expect(text).toContain("v3.2 lane off")
    unmount(); document.body.removeChild(host)
  })

  it("marks stale visibly stale instead of interpolating", () => {
    mockSnapshot = { ts: Date.now() - 60_000, v32: SOAK }
    mockConnected = false
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = mount(host)
    expect(host.textContent ?? "").toContain("stale")
    unmount(); document.body.removeChild(host)
  })

  it("renders the vault empty state when the section is absent", () => {
    mockSnapshot = { ts: Date.now(), v32: null }
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = mount(host)
    expect(host.textContent ?? "").toContain("awaiting live buffers")
    unmount(); document.body.removeChild(host)
  })

  it("shows powered digits when the lane is live", () => {
    mockSnapshot = {
      ts: Date.now(),
      v32: { ...SOAK, enabled: true, mode: "powered", breakeven: 0.213, uptime: { seconds: 1100, reason: null }, flipGate: { ...SOAK.flipGate, flip: false, legacyExpectancy: 0.2, candidateExpectancy: 0.213, legacyTrades: 150, candidateTrades: 18, reason: "candidate under 100 paper trades" } }
    }
    const host = document.createElement("div")
    document.body.appendChild(host)
    const unmount = mount(host)
    const text = host.textContent ?? ""
    expect(text).toContain("powered")
    expect(text).toContain("breakeven")
    expect(text).toContain("18m")
    unmount(); document.body.removeChild(host)
  })
})