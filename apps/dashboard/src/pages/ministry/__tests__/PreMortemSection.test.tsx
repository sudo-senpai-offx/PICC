// @vitest-environment jsdom
// W3-05 — PreMortemSection: the readout that answers "which failure modes would
// we catch, and which would we miss?".
//
// THE CONTRACT UNDER TEST IS THE COST DECISION AND THE TWO CHANNELS.
//
// The section must NOT fetch on mount. The route builds a disposable git
// worktree and runs real guard suites; that is what gives the mutation verdicts
// their meaning and it costs about eleven seconds. A test that only asserted the
// rendered output would pass against an auto-fetching component, so the
// no-fetch-on-mount property is asserted directly — it is the whole reason this
// screen has a button.
//
// The second property: `catalogFindings` and `results` are DIFFERENT channels
// that can each be half the catalog. The audit takes no inventory, so it
// structurally cannot see an unresolvable claim — that is `stale-catalog-entry`
// in `results`. A view built from either alone reads as confidently wrong, so
// both render, audit first.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { PreMortemSection } from "../PreMortemSection"
import * as premortemLib from "@/lib/premortem"
import type { PreMortemOverview } from "@/lib/premortem"

vi.mock("@/lib/premortem", () => ({
  fetchPremortemOverview: vi.fn()
}))

const mockedFetch = vi.mocked(premortemLib.fetchPremortemOverview)

/** One payload exactly as `GET /api/premortem/overview` serves it. */
function fixture(over: Partial<PreMortemOverview> = {}): PreMortemOverview {
  return {
    ok: true,
    advisory: true,
    catalogFindings: [],
    results: [
      {
        id: "SHIP-1",
        verdict: "partially-covered",
        evidence: { file: "a.test.mjs" },
        manualCheck: null
      },
      {
        id: "CAP-1",
        verdict: "unverified-manual",
        evidence: null,
        manualCheck: "ask the venue what their outage path is"
      }
    ],
    mutation: [
      { id: "SHIP-5", verdict: "bites", evidence: { reason: "guard-failed-on-broken-implementation", claimPath: "g.test.mjs", claimTitle: "t", failed: true } },
      { id: "SHIP-1", verdict: "not-run", evidence: { reason: "entry-not-marked-for-mutation", claimPath: null, claimTitle: null, failed: null } }
    ],
    counts: { "partially-covered": 1, "unverified-manual": 1 },
    ...over
  }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  mockedFetch.mockReset()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  flushSync(() => root.unmount())
  container.remove()
})

/**
 * Polling rather than `act`. The harness this file sits in is NOT configured for
 * `act(...)` — react-dom reports "the current testing environment is not
 * configured to support act" — so wrapping in it would be a no-op that let these
 * assertions run before React committed, and a test that cannot fail on a broken
 * component is worse than no test. This mirrors `GraduationSection.test.tsx`:
 * press, then poll the DOM until the state has actually landed.
 */
async function waitFor(check: () => boolean, what: string, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
    flushSync(() => {})
  }
  flushSync(() => {})
}

const render = () => {
  flushSync(() => root.render(<PreMortemSection />))
}

const clickRun = () => {
  const btn = container.querySelector<HTMLButtonElement>('[data-testid="premortem-run"]')
  if (!btn) throw new Error("run button not found")
  flushSync(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })))
}

describe("PreMortemSection", () => {
  it("DOES NOT fetch on mount — the run is opt-in because the route costs ~11s", () => {
    render()
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="premortem-idle"]')).not.toBeNull()
  })

  it("fetches only when the button is pressed, then renders the readout", async () => {
    mockedFetch.mockResolvedValue(fixture())
    render()
    clickRun()
    await waitFor(
      () => container.querySelector('[data-testid="premortem-results"]') !== null,
      "results region"
    )
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    const text = container.textContent ?? ""
    expect(text).toContain("SHIP-1")
    expect(text).toContain("partially-covered")
  })

  it("stamps the result with the time it was measured, so it cannot read as current", async () => {
    mockedFetch.mockResolvedValue(fixture())
    render()
    clickRun()
    await waitFor(
      () => container.querySelector('[data-testid="premortem-measured-at"]') !== null,
      "measured-at stamp"
    )
    expect(container.querySelector('[data-testid="premortem-measured-at"]')?.textContent).toContain(
      "measured"
    )
  })

  it("renders BOTH channels: the audit is its own region, not folded into results", async () => {
    mockedFetch.mockResolvedValue(
      fixture({
        catalogFindings: [{ id: "SHIP-3", reason: "mode-has-no-disposition", kind: "shipping" }]
      })
    )
    render()
    clickRun()
    await waitFor(
      () => container.querySelector('[data-testid="premortem-audit"]') !== null,
      "audit region"
    )

    const audit = container.querySelector('[data-testid="premortem-audit"]')
    const results = container.querySelector('[data-testid="premortem-results"]')
    expect(audit).not.toBeNull()
    expect(results).not.toBeNull()

    // The finding appears in the audit region, and the audit is not empty.
    expect(audit?.textContent).toContain("SHIP-3")
    expect(audit?.textContent).toContain("mode-has-no-disposition")
  })

  it("reports a clean audit as clean rather than rendering an empty list", async () => {
    mockedFetch.mockResolvedValue(fixture())
    render()
    clickRun()
    await waitFor(
      () => container.querySelector('[data-testid="premortem-audit-clean"]') !== null,
      "clean-audit state"
    )
    expect(container.querySelector('[data-testid="premortem-audit-clean"]')).not.toBeNull()
  })

  it("shows the human check for an unverified-manual verdict", async () => {
    mockedFetch.mockResolvedValue(fixture())
    render()
    clickRun()
    await waitFor(
      () => container.querySelector('[data-testid="premortem-manual"]') !== null,
      "manual-check line"
    )
    expect(container.textContent).toContain("ask the venue what their outage path is")
  })

  it("distinguishes bites from does-not-bite from not-run, and names the not-run reason", async () => {
    mockedFetch.mockResolvedValue(
      fixture({
        mutation: [
          {
            id: "SHIP-5",
            verdict: "bites",
            evidence: {
              reason: "guard-failed-on-broken-implementation",
              claimPath: "g.test.mjs",
              claimTitle: "t",
              failed: true
            }
          },
          {
            id: "SHIP-6",
            verdict: "does-not-bite",
            evidence: {
              reason: "guard-passed-on-broken-implementation",
              claimPath: "g2.test.mjs",
              claimTitle: "t2",
              failed: false
            }
          },
          {
            id: "SHIP-1",
            verdict: "not-run",
            evidence: {
              reason: "entry-not-marked-for-mutation",
              claimPath: null,
              claimTitle: null,
              failed: null
            }
          }
        ]
      })
    )
    render()
    clickRun()
    await waitFor(
      () => container.querySelectorAll('[data-testid="premortem-mutation-row"]').length === 3,
      "three mutation rows"
    )
    const text = Array.from(
      container.querySelectorAll('[data-testid="premortem-mutation-row"]')
    )
      .map((r) => r.textContent ?? "")
      .join(" ")
    expect(text).toContain("bites")
    expect(text).toContain("does-not-bite")
    expect(text).toContain("not-run")
    expect(text).toContain("entry-not-marked-for-mutation")
  })

  it("surfaces a failure as a refusal and renders no readout at all", async () => {
    mockedFetch.mockRejectedValue(new Error("pre-mortem overview GET failed: 401"))
    render()
    clickRun()
    await waitFor(
      () => container.querySelector('[data-testid="premortem-error"]') !== null,
      "error state"
    )
    expect(container.querySelector('[data-testid="premortem-results"]')).toBeNull()
  })

  it("offers a re-run once a measurement exists", async () => {
    mockedFetch.mockResolvedValue(fixture())
    render()
    clickRun()
    await waitFor(
      () =>
        container.querySelector('[data-testid="premortem-run"]')?.textContent?.includes("re-run") ??
        false,
      "re-run label"
    )
    expect(container.querySelector('[data-testid="premortem-run"]')?.textContent).toContain("re-run")
  })
})