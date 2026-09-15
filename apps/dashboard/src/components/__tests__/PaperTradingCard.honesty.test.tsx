// @vitest-environment jsdom
// Regression for the 7 zero-PnL paper trades: the close input pre-filled the
// entry price, so a click-through Close recorded exit === entry (pnl 0) with
// no observed price behind it. The open form likewise defaulted entry to
// "1.0000". Both traps are removed:
//   - Open is disabled until the operator types a real (>0) entry price.
//   - Close is disabled until the operator types a real (>0) exit price.
import { describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

vi.mock("@/lib/auth", () => ({
  getStoredSession: () => ({ access_token: "t", user: { id: "u", name: "SP0 Observer", email: "sp0.observer@picc.local" } }),
  fetchMe: async () => ({ id: "u", name: "SP0 Observer", email: "sp0.observer@picc.local" }),
  signOutLocal: async () => {},
  setStoredSession: () => {},
  getToken: () => "t"
}))

import { PaperTradingCard } from "@/components/TradingSuite"

function mount(positions: unknown[], closed: unknown[]) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <PaperTradingCard
        positions={positions as never}
        closed={closed as never}
        refresh={() => {}}
      />
    )
  })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

const openPosition = { id: "p1", symbol: "EURUSD", side: "up", entry: 1.165, amount: 100, openedAt: "2026-08-10T13:20:03.092Z", status: "open" }

describe("PaperTradingCard price-entry honesty", () => {
  it("open button starts disabled — no silent 1.0000 default entry", () => {
    const { host, unmount } = mount([], [])
    const buttons = [...host.querySelectorAll("button")].map((b) => b.textContent ?? "")
    const open = buttons.find((t) => t.includes("Open paper position"))
    expect(open).toBeDefined()
    const openBtn = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Open paper position"))
    expect(openBtn?.hasAttribute("disabled")).toBe(true)
    unmount()
  })

  it("typing a real entry price enables the open button", () => {
    const { host, unmount } = mount([], [])
    const inputs = host.querySelectorAll("input")
    expect(inputs.length).toBeGreaterThanOrEqual(3)
    const entry = inputs[1] // symbol, entry, amount
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    setter?.call(entry, "1.1650")
    entry.dispatchEvent(new Event("input", { bubbles: true }))
    flushSync(() => {})
    const openBtn = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Open paper position"))
    expect(openBtn?.hasAttribute("disabled")).toBe(false)
    unmount()
  })

  it("close button starts disabled — no pre-filled exit = entry", () => {
    const { host, unmount } = mount([openPosition], [])
    const inputs = host.querySelectorAll("input")
    // The open form's fields come first; the exit input is the last one.
    const exit = inputs[inputs.length - 1]
    expect(exit.getAttribute("placeholder")).toBe("exit price")
    expect(exit.getAttribute("value")).toBe("")
    const closeBtn = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Close"))
    expect(closeBtn?.hasAttribute("disabled")).toBe(true)
    unmount()
  })

  it("typing an observed exit price enables the close button", () => {
    const { host, unmount } = mount([openPosition], [])
    const inputs = host.querySelectorAll("input")
    const exit = inputs[inputs.length - 1]
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    setter?.call(exit, "1.1700")
    exit.dispatchEvent(new Event("input", { bubbles: true }))
    flushSync(() => {})
    const closeBtn = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Close"))
    expect(closeBtn?.hasAttribute("disabled")).toBe(false)
    unmount()
  })

  it("zero PnL renders neutral — never green as a win", () => {
    const zero = { id: "c1", symbol: "EURUSD", side: "up", entry: 1.165, exit: 1.165, pnl: 0, amount: 100, openedAt: "2026-08-10T13:20:03.092Z", status: "closed", closedAt: "2026-08-10T13:20:04.938Z", holdingMs: 1846 }
    const { host, unmount } = mount([], [zero])
    const badge = [...host.querySelectorAll(".badge")].find((b) => b.textContent?.includes("0.00"))
    expect(badge).toBeDefined()
    expect(badge?.className).toContain("muted")
    expect(badge?.className).not.toContain("success")
    unmount()
  })
})