// @vitest-environment jsdom
// Profile-page styling lock: the Sign-out CTA must stay a real danger button
// (a raw <button> renders with zero chrome — the same missing-class bug family
// as the Command Centre). The rest of the page is mock-light so the assertion
// is about the rendered DOM, not the fetch plumbing.
import { describe, expect, it, vi, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { Profile } from "@/pages/Profile"

vi.mock("@/hooks/useAuth", () => ({
  useUser: () => ({ email: "tester@local.dev", name: "Tester", createdAt: "2026-01-01T00:00:00.000Z" })
}))

vi.mock("@/lib/auth", () => ({
  signOutLocal: vi.fn(async () => {})
}))

vi.mock("@/lib/api", () => ({
  getHealth: vi.fn(async () => null),
  getProfile: vi.fn(async () => ({ name: "Tester", links: [] })),
  saveProfileName: vi.fn(async (name: string) => ({ ok: true, name }))
}))

vi.mock("@/components/FinanceTracker", () => ({
  FinanceTracker: () => null
}))

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter>
        <Profile />
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

describe("Profile page styling", () => {
  afterEach(() => { vi.restoreAllMocks() })

  it("renders the identity card", () => {
    const m = mount()
    const headings = Array.from(m.host.querySelectorAll("h2")).map((h) => h.textContent)
    expect(headings).toContain("Identity")
    m.unmount()
  })

  it("the Sign out button carries the danger button styling (never a bare <button>)", () => {
    const m = mount()
    const btn = Array.from(m.host.querySelectorAll("button")).find((b) => b.textContent === "Sign out")
    expect(btn).toBeTruthy()
    expect(btn!.className.split(/\s+/)).toContain("btn")
    expect(btn!.className.split(/\s+/)).toContain("btn-danger")
    m.unmount()
  })
})