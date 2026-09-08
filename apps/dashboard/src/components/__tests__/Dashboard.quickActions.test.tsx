// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { QUICK_ACTIONS } from "@/pages/Dashboard"

// Whole-branch review 2026-09-08: the Command Center landing advertised 7
// quick-actions that navigated to de-linked top-level pages (/simulator,
// /income, /agents) that have no routes in the ministry IA — every click
// silently bounced to "/" via the * catch-all. This pins the regression:
// quick-action destinations must be living ministry-IA routes.
const DE_LINKED_ROOTS = ["/simulator", "/income", "/agents", "/streams"]
// Every living top-level destination in the two-level IA (App.tsx).
const LIVING_ROUTES = ["/", "/opportunities", "/settings", "/profile", "/suites", "/suites/trading", "/suites/earnings", "/suites/intelligence"]

describe("Dashboard quick actions (ministry IA)", () => {
  it("never target a de-linked top-level page", () => {
    for (const action of QUICK_ACTIONS) {
      expect(DE_LINKED_ROOTS.some((root) => action.to === root || action.to.startsWith(`${root}?`))).toBe(false)
    }
  })

  it("every destination is a living route", () => {
    expect(QUICK_ACTIONS.length).toBeGreaterThan(0)
    for (const action of QUICK_ACTIONS) {
      expect(LIVING_ROUTES).toContain(action.to)
    }
  })
})