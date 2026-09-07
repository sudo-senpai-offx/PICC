// CashPilot collector honesty — the sole surviving collector after the
// bandwidth-suite removal. Pins the real normalization contract: alternate
// field names unwrap, missing change is null (never a fabricated 0), API
// failures throw honestly, and drifted envelope shapes degrade to [] rather
// than invented rows.
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fetchCashPilotSummary,
  fetchCashPilotDaily,
  fetchCashPilotBreakdown
} from "../services/collectors.mjs"

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: async () => JSON.stringify(body)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("CashPilot collector — summary", () => {
  it("normalizes the summary endpoint shape (total/today/month/change)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ total: 1240.5, today: 4.2, month: 88.1, change: 3.4 })
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchCashPilotSummary("https://cashpilot.local", "admin-key-1")

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://cashpilot.local/api/earnings/summary")
    expect(init.headers["X-API-Key"]).toBe("admin-key-1")
    expect(init.headers.Authorization).toBe("Bearer admin-key-1")
    expect(result).toMatchObject({ total: 1240.5, today: 4.2, month: 88.1, changePct: 3.4 })
  })

  it("falls back to alternate field names (lifetime/monthly/change_pct)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ lifetime: 100, monthly: 9, change_pct: -1.2 })))
    const result = await fetchCashPilotSummary("https://cashpilot.local", "")
    expect(result).toMatchObject({ total: 100, month: 9, changePct: -1.2 })
  })

  it("changePct is null when the API is silent (never a fabricated 0)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ total: 5 })))
    const result = await fetchCashPilotSummary("https://cashpilot.local", "k")
    expect(result.changePct).toBeNull()
  })
})

describe("CashPilot collector — anti-fabrication + auth", () => {
  it("throws honestly on a rejected key (401/403)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "forbidden" }, { status: 403 })))
    await expect(fetchCashPilotSummary("https://cashpilot.local", "bad")).rejects.toThrow("credentials rejected")
  })

  it("throws honestly on rate limiting (429)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { status: 429 })))
    await expect(fetchCashPilotDaily("https://cashpilot.local", "k")).rejects.toThrow("rate limited")
  })

  it("throws on an unknown HTTP error with the URL in the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "boom" }, { status: 502 })))
    await expect(fetchCashPilotBreakdown("https://cashpilot.local", "k")).rejects.toThrow("HTTP 502")
  })
})

describe("CashPilot collector — daily series", () => {
  it("normalizes a vanilla array and adds the ?days= window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([{ date: "2026-09-05", total: 1.1 }, { date: "2026-09-06", earnings: 2.2 }])
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await fetchCashPilotDaily("https://cashpilot.local", "k", 14)
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/earnings/daily?days=14")
    expect(result).toEqual([
      { date: "2026-09-05", usd: 1.1 },
      { date: "2026-09-06", usd: 2.2 }
    ])
  })

  it("unwraps { daily } / { series } envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ series: [{ day: "2026-09-01", amount: 3.3 }] })))
    const result = await fetchCashPilotDaily("https://cashpilot.local", "k")
    expect(result).toEqual([{ date: "2026-09-01", usd: 3.3 }])
  })

  it("returns an empty array (never a fabricated row) when the API shape drifts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "ok" })))
    const result = await fetchCashPilotDaily("https://cashpilot.local", "k")
    expect(result).toEqual([])
  })
})

describe("CashPilot collector — per-service breakdown", () => {
  it("normalizes service rows across the accepted envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      services: [
        { service: "expertoption", balance: 100, threshold: 10, total: 500 },
        { name: "opensea", earnings: 2, min_payout: 0.5, lifetime: 30 }
      ]
    })))
    const result = await fetchCashPilotBreakdown("https://cashpilot.local", "k")
    expect(result).toEqual([
      { service: "expertoption", balance: 100, threshold: 10, total: 500 },
      { service: "opensea", balance: 2, threshold: 0.5, total: 30 }
    ])
  })

  it("returns [] when the API returns an unexpected shape (no invented services)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ okay: true })))
    const result = await fetchCashPilotBreakdown("https://cashpilot.local", "k")
    expect(result).toEqual([])
  })
})