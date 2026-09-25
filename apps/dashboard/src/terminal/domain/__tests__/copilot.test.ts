// WS-6 T3 — remote copilot state contract (RED, AC-014).
//
// The LLM cannot run on the owner-locked Atom/Snapdragon floor (D6), so every
// explanation is remote. AC-014 requires: the `copilot: remote` label, the
// model/timestamp when observed, cache age, and an explicit pending / stale /
// unavailable state. AC-014's prohibited side effect is the important one —
// remote text must NEVER become a signal, risk input, score, sizing value, or
// execution authorization.
import { describe, expect, it } from "vitest"
import {
  copilotState,
  describeCopilot,
  CACHE_TTL_MS,
  isAdmissibleAsSignal
} from "../copilot"

const NOW = 1_700_000_000_000

describe("copilot — provenance is always declared", () => {
  it("labels every state as remote", () => {
    for (const s of ["ready", "pending", "stale", "unavailable"] as const) {
      const c = copilotState({ status: s, model: null, generatedAt: null, cacheExpiresAt: null })
      expect(c.provenance).toBe("copilot: remote")
      // The provenance must be carried in the RENDERED label, not only in a
      // field a UI could forget to read.
      expect(describeCopilot(c).label).toContain("copilot: remote")
      expect(describeCopilot(c).label).toContain(s)
    }
  })
})

describe("copilot — state derivation", () => {
  it("reports cache age for a fresh ready response", () => {
    const c = copilotState({
      status: "ready",
      model: "some-model",
      generatedAt: NOW - 5_000,
      cacheExpiresAt: NOW + 55_000
    })
    const view = describeCopilot(c, NOW)
    expect(view.cacheAgeMs).toBe(5_000)
    expect(view.label).toMatch(/ready/i)
  })

  it("marks a ready response STALE once the cache TTL has passed", () => {
    const c = copilotState({
      status: "ready",
      model: "some-model",
      generatedAt: NOW - CACHE_TTL_MS - 1,
      cacheExpiresAt: NOW - 1
    })
    expect(describeCopilot(c, NOW).effectiveStatus).toBe("stale")
  })

  it("keeps a ready response live while inside the TTL", () => {
    const c = copilotState({ status: "ready", model: "m", generatedAt: NOW - 1, cacheExpiresAt: NOW + 1_000 })
    expect(describeCopilot(c, NOW).effectiveStatus).toBe("ready")
  })

  it("reports no cache age when nothing was generated", () => {
    const c = copilotState({ status: "pending", model: null, generatedAt: null, cacheExpiresAt: null })
    const view = describeCopilot(c, NOW)
    expect(view.cacheAgeMs).toBeNull()
    expect(view.model).toBeNull()
  })

  it("surfaces a provider failure as unavailable with the operator's reason", () => {
    const c = copilotState(
      { status: "unavailable", model: null, generatedAt: null, cacheExpiresAt: null },
      "provider timeout"
    )
    const view = describeCopilot(c, NOW)
    expect(view.effectiveStatus).toBe("unavailable")
    expect(view.reason).toMatch(/timeout/i)
  })

  it("falls back to a derived reason only when none was recorded", () => {
    const c = copilotState({ status: "pending", model: null, generatedAt: null, cacheExpiresAt: null })
    expect(describeCopilot(c, NOW).reason).toMatch(/awaiting/i)
  })
})

describe("copilot — the prohibited side effect (AC-014)", () => {
  it("is NEVER admissible as a signal, regardless of state", () => {
    for (const s of ["ready", "pending", "stale", "unavailable"] as const) {
      const c = copilotState({
        status: s,
        model: "m",
        generatedAt: NOW,
        cacheExpiresAt: NOW + 1_000
      })
      expect(isAdmissibleAsSignal(c), `${s} must never be admissible as a signal`).toBe(false)
    }
  })

  it("exposes no numeric value that could be read as a score or sizing input", () => {
    const c = copilotState({ status: "ready", model: "m", generatedAt: NOW, cacheExpiresAt: NOW + 1_000 })
    const view = describeCopilot(c, NOW)
    for (const forbidden of ["score", "confidence", "size", "notional", "delta", "expectancy"]) {
      expect(view, `copilot view must not expose ${forbidden}`).not.toHaveProperty(forbidden)
    }
  })

  it("is always flagged redacted", () => {
    const c = copilotState({ status: "ready", model: "m", generatedAt: NOW, cacheExpiresAt: NOW + 1_000 })
    expect(c.redacted).toBe(true)
  })
})
