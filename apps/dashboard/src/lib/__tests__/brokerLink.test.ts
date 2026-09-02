// @vitest-environment jsdom
// T6 deep-link venue seam: catalog-verified tradeUrl + extension-bridge attempt
// with a new-tab fallback (REQ-9, Decision G). The dashboard side of the
// open-broker-tab command is pinned here; the extension-side handle is T8.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { openBrokerTab, validateVenueTradeUrl } from "@/lib/brokerLink"
import type { TradingVenue } from "@/lib/trading"

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

describe("openBrokerTab (T6, Decision G seam)", () => {
  let postSpy: ReturnType<typeof vi.fn>
  let openSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    // Record the call but keep dispatching to same-window listeners so a
    // (test-controlled) __piccCommandAck can still reach the bridge handler.
    postSpy = vi.fn((message: unknown, _targetOrigin?: string) => {
      window.dispatchEvent(new MessageEvent("message", { data: message, source: window, origin: window.location.origin }))
    })
    openSpy = vi.fn(() => null)
    vi.stubGlobal("postMessage", postSpy)
    vi.stubGlobal("open", openSpy)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("posts the open-broker-tab command and falls back to one new tab when unanswered", async () => {
    const p = openBrokerTab({ venueId: "expertoption", url: "https://app.expertoption.finance/" })
    expect(postSpy).toHaveBeenCalledWith(
      {
        __piccCommand: {
          action: "open-broker-tab",
          venueId: "expertoption",
          url: "https://app.expertoption.finance/"
        }
      },
      "*"
    )
    await vi.advanceTimersByTimeAsync(700)
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledWith("https://app.expertoption.finance/", "_blank", "noopener")
    expect(await p).toEqual({ attempt: true, fellBack: true })
  })

  it("does not fall back when the bridge acks a handled open", async () => {
    const p = openBrokerTab({ venueId: "expertoption", url: "https://app.expertoption.finance/" })
    window.postMessage({ __piccCommandAck: { venueId: "expertoption", ok: true } }, "*")
    expect(await p).toEqual({ attempt: true, fellBack: false })
    expect(openSpy).not.toHaveBeenCalled()
  })

  it("falls back when the bridge declines (ack ok:false)", async () => {
    const p = openBrokerTab({ venueId: "expertoption", url: "https://app.expertoption.finance/" })
    window.postMessage({ __piccCommandAck: { venueId: "expertoption", ok: false } }, "*")
    expect(await p).toEqual({ attempt: true, fellBack: true })
    expect(openSpy).toHaveBeenCalledTimes(1)
  })

  it("ignores acks for a different venue and never opens on an unverified url", async () => {
    const p = openBrokerTab({ venueId: "expertoption", url: "https://app.expertoption.finance/", waitMs: 50 })
    window.postMessage({ __piccCommandAck: { venueId: "binance", ok: true } }, "*")
    expect(postSpy).toHaveBeenNthCalledWith(
      1,
      { __piccCommand: { action: "open-broker-tab", venueId: "expertoption", url: "https://app.expertoption.finance/" } },
      "*"
    )
    await vi.advanceTimersByTimeAsync(50)
    await p
    expect(openSpy).toHaveBeenCalledTimes(1)
    const callsBeforeBad = postSpy.mock.calls.length // command + the ack above

    const bad = await openBrokerTab({ venueId: "expertoption", url: "not-a-verified-url" })
    expect(bad).toEqual({ attempt: false, fellBack: false })
    expect(postSpy.mock.calls.length).toBe(callsBeforeBad) // nothing posted for an unverified url
  })
})