// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { CommandPalette } from "@/components/CommandPalette"

vi.mock("@/lib/api", () => ({
  openBrowser: vi.fn().mockResolvedValue({}),
  closeBrowser: vi.fn().mockResolvedValue({}),
  CATALOG: undefined
}))
vi.mock("@/lib/streamCatalog", () => ({ CATALOG: [] }))

function mountPalette() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter>
        <CommandPalette open onClose={() => {}} />
      </MemoryRouter>
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

// Repo-native typing: native value setter + input event (React 19 handling),
// then flushSync to commit the state update.
function typeQuery(m: { host: HTMLElement }, value: string) {
  const input = m.host.querySelector<HTMLInputElement>('input[role="combobox"]')
  if (!input) throw new Error("palette input not found")
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
  flushSync(() => {})
}

// Page rows ONLY: palette items whose group is exactly "Pages". Feature-toggle rows
// ("Disable feature: …") and the empty-state echo are deliberately out of scope — the
// contract is that dead pages are not navigable, not that their words never appear.
function pageRowLabels(): string[] {
  const labels: string[] = []
  for (const item of Array.from(document.querySelectorAll<HTMLElement>(".palette-item"))) {
    const group = item.querySelector(".palette-group")?.textContent?.trim()
    const label = item.querySelector(".palette-label")?.textContent?.trim()
    if (group === "Pages" && label) labels.push(label)
  }
  return labels
}

describe("CommandPalette pages", () => {
  it("searches a ministry page across the whole app", () => {
    const m = mountPalette()
    try {
      typeQuery(m, "earnings")
      expect(pageRowLabels()).toContain("Earnings")
    } finally {
      m.unmount()
    }
  })

  it("does not expose removed pages", () => {
    const m = mountPalette()
    try {
      typeQuery(m, "simulator")
      expect(pageRowLabels().filter((l) => /Simulator/i.test(l))).toEqual([])
      typeQuery(m, "agents")
      expect(pageRowLabels().filter((l) => /Agents/i.test(l))).toEqual([])
      typeQuery(m, "income")
      expect(pageRowLabels().filter((l) => /Income/i.test(l))).toEqual([])
    } finally {
      m.unmount()
    }
  })
})