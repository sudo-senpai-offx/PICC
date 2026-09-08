// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { AppShell } from "@/components/AppShell"

vi.mock("@/lib/auth", () => ({ signOutLocal: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: { user: "t" }, loading: false }) }))
vi.mock("@/components/TopBar", () => ({ TopBar: () => <div /> }))
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }))

function mount(node: React.ReactNode) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => { root.render(<>{node}</>) })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

// Exact-text lookup over leaf elements, mirroring @testing-library's
// getByText exact match so the same label assertions hold.
function getByText(target: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (el.children.length === 0 && el.textContent?.trim() === target) return el
  }
  return null
}

describe("AppShell nav", () => {
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    mounted = []
  })

  afterEach(() => {
    // Unmount before global teardown so a failing test never ghosts a live
    // AppShell into the next test's document.
    mounted.forEach((m) => m.unmount())
    mounted = []
  })

  it("shows Command, Suites, Account groups with the ministry entries", () => {
    mounted.push(mount(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell />
      </MemoryRouter>
    ))
    expect(getByText("Dashboard")).toBeTruthy()
    expect(getByText("Opportunities")).toBeTruthy()
    expect(getByText("Trading")).toBeTruthy()
    expect(getByText("Earnings")).toBeTruthy()
    expect(getByText("Intelligence for PICC")).toBeTruthy()
    expect(getByText("Settings")).toBeTruthy()
    expect(getByText("Profile")).toBeTruthy()
  })

  it("no longer shows removed pages (Simulator, Agents, Income)", () => {
    mounted.push(mount(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell />
      </MemoryRouter>
    ))
    expect(getByText("Simulator")).toBeNull()
    expect(getByText("Agents")).toBeNull()
    expect(getByText("Income")).toBeNull()
  })

  it("labels the Suites group", () => {
    mounted.push(mount(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell />
      </MemoryRouter>
    ))
    expect(getByText("Suites")).toBeTruthy()
  })
})
