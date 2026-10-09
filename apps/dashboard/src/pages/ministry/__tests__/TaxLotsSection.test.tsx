// @vitest-environment jsdom
// Task 5 — TaxLotsSection: the wealth-room download section for the FIFO
// tax-lot CSV export.
//
// Mirrors the CostsSection test layout: jsdom render, mocked lib, waitFor
// polling. Ships inside the wealth room, unwired like its host — no
// INNER_NAV / MINISTRY_ROOMS key (WS-6 T0 freeze).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { TaxLotsSection } from "../TaxLotsSection"
import * as taxLib from "@/lib/tax"

vi.mock("@/lib/tax", async (importOriginal) => ({
  ...(await importOriginal<typeof taxLib>()),
  fetchTaxLotsCsv: vi.fn()
}))

const mockedFetch = vi.mocked(taxLib.fetchTaxLotsCsv)

const CSV = [
  "# PICC tax lots — report only, not tax advice. Verify with your accountant.",
  "# method: FIFO",
  "# generated: 2026-10-08T00:00:00.000Z",
  "date,asset,side,qty,price,ccy,feeUsd,proceedsUsd,basisUsd,gainUsd,method,provenance,selfTransfer,flags",
  "2026-02-10T00:00:00.000Z,BTC,sell,0.5,60000,USD,,30000,25000,5000,FIFO,journal-close,false,fee-unobserved",
  "2026-05-10T00:00:00.000Z,BTC,sell,0.5,62000,USD,,31000,25000,6000,FIFO,journal-close,true,fee-unobserved"
].join("\n")

async function waitFor(check: () => boolean, what: string, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`waitFor timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
  flushSync(() => {})
}

describe("TaxLotsSection", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockedFetch.mockResolvedValue({ filename: "picc-tax-lots-2026-10-08.csv", text: CSV })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    // jsdom has no download pipeline: stub the anchor click and the blob URL.
    clickSpy = vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    window.URL.createObjectURL = vi.fn(() => "blob:mock") as unknown as typeof URL.createObjectURL
    window.URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    vi.restoreAllMocks()
    flushSync(() => { root.unmount() })
    document.body.removeChild(host)
  })

  it("renders the report-only disclaimer, period picker, presets, and download", async () => {
    flushSync(() => { root.render(<TaxLotsSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='tax-disclaimer']"), "disclaimer")
    expect(host.querySelector("[data-testid='tax-disclaimer']")?.textContent).toContain(
      "report only, not tax advice"
    )
    expect(host.querySelector("[data-testid='tax-from']")).toBeTruthy()
    expect(host.querySelector("[data-testid='tax-to']")).toBeTruthy()
    expect(host.querySelector("[data-testid='tax-preset-my-year']")?.textContent).toContain("MY year")
    expect(host.querySelector("[data-testid='tax-alltime']")).toBeTruthy()
    expect(host.querySelector("[data-testid='tax-download']")).toBeTruthy()
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it("MY-year preset fills the current calendar year, all-time clears it", async () => {
    flushSync(() => { root.render(<TaxLotsSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='tax-preset-my-year']"), "preset button")
    const year = new Date().getFullYear()
    ;(host.querySelector("[data-testid='tax-preset-my-year']") as HTMLButtonElement).click()
    await waitFor(
      () => (host.querySelector("[data-testid='tax-from']") as HTMLInputElement)?.value === `${year}-01-01`,
      "preset from"
    )
    expect((host.querySelector("[data-testid='tax-to']") as HTMLInputElement)?.value).toBe(`${year}-12-31`)
    ;(host.querySelector("[data-testid='tax-alltime']") as HTMLButtonElement).click()
    await waitFor(
      () => (host.querySelector("[data-testid='tax-from']") as HTMLInputElement)?.value === "",
      "all-time clears from"
    )
    expect((host.querySelector("[data-testid='tax-to']") as HTMLInputElement)?.value).toBe("")
  })

  it("download passes the picked period and surfaces self-transfer flags", async () => {
    flushSync(() => { root.render(<TaxLotsSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='tax-download']"), "download button")
    const year = new Date().getFullYear()
    ;(host.querySelector("[data-testid='tax-preset-my-year']") as HTMLButtonElement).click()
    await waitFor(
      () => (host.querySelector("[data-testid='tax-from']") as HTMLInputElement)?.value === `${year}-01-01`,
      "preset from"
    )
    ;(host.querySelector("[data-testid='tax-download']") as HTMLButtonElement).click()
    await waitFor(() => mockedFetch.mock.calls.length >= 1, "lots fetch on download")
    expect(mockedFetch).toHaveBeenCalledWith({ from: `${year}-01-01`, to: `${year}-12-31` })
    expect(clickSpy).toHaveBeenCalled()
    await waitFor(() => !!host.querySelector("[data-testid='tax-summary']"), "summary")
    expect(host.querySelector("[data-testid='tax-summary']")?.textContent).toContain("2 lot lines")
    const flagged = host.querySelectorAll("[data-testid='tax-selftransfer-row']")
    expect(flagged).toHaveLength(1)
    expect(flagged[0]?.textContent).toContain("BTC")
    expect(flagged[0]?.textContent).toContain("self-transfer")
  })

  it("a refused period surfaces the route's named reason, never a silent default", async () => {
    mockedFetch.mockRejectedValue(new Error("tax:deny:invalid-from"))
    flushSync(() => { root.render(<TaxLotsSection />) })
    await waitFor(() => !!host.querySelector("[data-testid='tax-download']"), "download button")
    ;(host.querySelector("[data-testid='tax-download']") as HTMLButtonElement).click()
    await waitFor(() => !!host.querySelector("[data-testid='tax-error']"), "refusal reason")
    expect(host.querySelector("[data-testid='tax-error']")?.textContent).toContain("tax:deny:invalid-from")
  })
})
