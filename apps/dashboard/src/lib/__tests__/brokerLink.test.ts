// @vitest-environment jsdom
// T6 deep-link venue seam: catalog-verified tradeUrl + Browser Studio RPC
// with a window-open fallback (REQ-9, Decision G).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { openBrokerTab, validateVenueTradeUrl } from "@/lib/brokerLink"
import type { TradingVenue } from "@/lib/trading"

vi.mock("@/lib/api", () => ({
  browserTab: vi.fn(async () => ({ tabs: [], activeId: null }))
}))

const venues: TradingVenue[] = [
  { id: "expertoption", name: "ExpertOption", url: "https://expertoption.com", note: "", platformKind: "binary", tradeUrl: "https://app.expertoption.finance/", linkMode: "venue" },
  { id: "binance", name: "Binance", url: "https://www.binance.com", note: "", platformKind: "exchange", tradeUrl: "https://www.binance.com/en/trade/BTCUSDT", linkMode: "asset" },
  { id: "badlink", name: "BadLink", url: "https://badlink.example", note: "", platformKind: null, tradeUrl: "javascript:alert(1)", linkMode: "venue" }
]

describe("validateVenueTradeUrl (T6 / REQ-9)", () => {
  it("returns only an https tradeUrl of a known venue", () => {
    expect(validateVenueTradeUrl("expertoption", venues)).toBe("https://app.expertoption.finance/")
    expect(validateVenueTradeUrl("binance", venues)).toBe("https://www.binance.com/en/trade/BTCUSDT")
  })

  it("rejects unknown venue ids, non-https tradeUrls and missing rows", () => {
    expect(validateVenueTradeUrl("honeygain", venues)).toBeNull()
    expect(validateVenueTradeUrl("badlink", venues)).toBeNull()
    expect(validateVenueTradeUrl("expertoption", [])).toBeNull()
    expect(validateVenueTradeUrl("expertoption", [{ ...venues[0], tradeUrl: null }])).toBeNull()
  })
})

describe("openBrokerTab (T6, Decision G seam — studio RPC + window.open fallback)", () => {
  let browserTabSpy: ReturnType<typeof vi.fn>
  let openSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    browserTabSpy = vi.mocked((await import("@/lib/api")).browserTab)
    browserTabSpy.mockResolvedValue({ tabs: [], activeId: null })
    openSpy = vi.fn(() => null)
    vi.stubGlobal("open", openSpy)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("opens the venue via browserTab RPC and does not fall back when successful", async () => {
    const result = await openBrokerTab({ venueId: "expertoption", url: "https://app.expertoption.finance/" })
    expect(browserTabSpy).toHaveBeenCalledWith({ action: "open", url: "https://app.expertoption.finance/" })
    expect(result).toEqual({ attempt: true, fellBack: false })
    expect(openSpy).not.toHaveBeenCalled()
  })

  it("falls back to window.open when browserTab throws (studio closed)", async () => {
    browserTabSpy.mockRejectedValueOnce(new Error("browser studio is not open"))
    const result = await openBrokerTab({ venueId: "expertoption", url: "https://app.expertoption.finance/" })
    expect(result).toEqual({ attempt: true, fellBack: true })
    expect(openSpy).toHaveBeenCalledWith("https://app.expertoption.finance/", "_blank", "noopener")
  })

  it("rejects non-https urls without calling any bridge", async () => {
    const result = await openBrokerTab({ venueId: "expertoption", url: "http://insecure.example/" })
    expect(result).toEqual({ attempt: false, fellBack: false })
    expect(browserTabSpy).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })
})
