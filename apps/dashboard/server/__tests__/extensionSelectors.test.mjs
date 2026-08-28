import { describe, expect, it } from "vitest"
import {
  EO_SELECTOR_SPEC_VERSION,
  findAnchorText,
  numberFromText,
  extractActiveAssetLabel,
  extractLivePrice,
  extractBalance,
  extractOpenPositions
} from "../../../extension/src/selectors/expertoption.ts"
import {
  assetKeyFromLabel,
  buildEOProfileFrame,
  buildEOTickFrame,
  captureExpertOptionPage
} from "../../../extension/src/capture.ts"
import { probeEOSession } from "../../../extension/src/session.ts"

/** Hand-rolled fake document — no jsdom. `querySelectorAll` ignores the tag
 *  selector and returns every registered element, exactly the surface the
 *  selectors use (text-content scanning). */
function fakeDoc(texts) {
  const elements = texts.map((textContent) => ({ textContent }))
  return {
    querySelectorAll() {
      return elements
    }
  }
}

describe("extension selectors (ExpertOption, mock DOM)", () => {
  it("finds the shortest text element containing an anchor, digit-preferred", () => {
    const doc = fakeDoc([
      "Balance",
      "Available balance $12.40",
      "Account Balance $12.40 out of $5,000.00",
      "No numbers here"
    ])
    expect(findAnchorText(doc, "Balance")).toBe("Available balance $12.40")
    expect(findAnchorText(doc, "Balance", { needNumber: false })).toBe("Balance")
  })

  it("extracts the instrument label and rejects price blobs", () => {
    const doc = fakeDoc([
      "Trade · EUR/USD",
      "1.09825",
      "12:30",
      "Some long paragraph that is over forty characters long and says nothing useful"
    ])
    expect(extractActiveAssetLabel(doc)).toBe("EUR/USD")
    expect(extractActiveAssetLabel(fakeDoc(["GOLD", "1.09825"]))).toBe("GOLD")
    expect(extractActiveAssetLabel(fakeDoc(["1.09825", "12:30", "42"]))).toBeNull()
  })

  it("keeps the US500 anchor despite its digit", () => {
    expect(extractActiveAssetLabel(fakeDoc(["US 500", "1.09825"]))).toBe("US 500")
  })

  it("reads a dot-decimal price blob and rejects clocks and locale decimal commas", () => {
    expect(extractLivePrice(fakeDoc(["1.09825", "Balance $10.00"]))).toBe(1.09825)
    expect(extractLivePrice(fakeDoc(["12:30", "Balance $10.00"]))).toBeNull()
    expect(extractLivePrice(fakeDoc(["1,09812", "Balance $10.00"]))).toBeNull()
    expect(extractLivePrice(fakeDoc(["64,213", "Balance $10.00"]))).toBe(64213)
  })

  it("parses the wallet balance with its currency", () => {
    const doc = fakeDoc([
      "Account Balance $10,000.50",
      "Available €2.00"
    ])
    expect(extractBalance(doc)).toEqual({ amount: 10000.5, currency: "USD" })
    expect(extractBalance(fakeDoc(["No balance shown yet"]))).toEqual({ amount: null, currency: null })
  })

  it("counts currency-led open positions rows", () => {
    const doc = fakeDoc([
      "Open deals",
      "$25.00 Trade · 15:30",
      "$10.00 Trade · 16:00",
      "EUR/USD · OTC"
    ])
    const { count, rows } = extractOpenPositions(doc)
    expect(count).toBe(2)
    expect(rows[0].amount).toBe(25)
    expect(rows[0].expiry).toBe("15:30")
    expect(extractOpenPositions(fakeDoc(["Nothing open"])).count).toBeNull()
  })

  it("normalizes page labels into buffer keys", () => {
    expect(assetKeyFromLabel("EUR/USD")).toBe("EURUSD")
    expect(assetKeyFromLabel("US 500")).toBe("US500")
    expect(assetKeyFromLabel("")).toBe("EURUSD")
  })

  it("parses numbers out of scraped labels (thousands separators dropped)", () => {
    expect(numberFromText("Total profit +1,234.56")).toBe(1234.56)
    expect(numberFromText("$ 25.00 Trade")).toBe(25)
    expect(numberFromText("no digits")).toBeNull()
  })
})

describe("extension capture frames (honest collectors)", () => {
  it("builds a profile frame only when a balance is readable", () => {
    expect(buildEOProfileFrame(fakeDoc(["Account Balance $10,000.50"]))).toEqual({
      action: "profile",
      message: { balance: 10000.5, currency: "USD", is_demo: 1 }
    })
    expect(buildEOProfileFrame(fakeDoc(["Nothing here"]))).toBeNull()
  })

  it("builds a tick frame only when asset label AND price are readable", () => {
    const frame = buildEOTickFrame(fakeDoc(["EUR/USD", "1.09825"]))
    expect(frame?.action).toBe("candles")
    expect(frame?.message?.assetId).toBe("EURUSD")
    expect(frame?.message?.name).toBe("EUR/USD")
    // Price without a label (or label without a price) is NOT a claim.
    expect(buildEOTickFrame(fakeDoc(["1.09825"]))).toBeNull()
    expect(buildEOTickFrame(fakeDoc(["EUR/USD"]))).toBeNull()
  })

  it("capture forwards every readable frame through onFrame and reports honestly", () => {
    const emitted = []
    const res = captureExpertOptionPage(fakeDoc(["EUR/USD", "1.09825", "Account Balance $10,000.50"]), {
      onFrame: (f) => emitted.push(f)
    })
    expect(res.captured).toBe(2)
    expect(emitted.map((f) => f.action).sort()).toEqual(["candles", "profile"])

    const empty = captureExpertOptionPage(fakeDoc(["Nothing readable here"]), { onFrame: () => undefined })
    expect(empty.captured).toBe(0)
    expect(empty.reason).toMatch(/not readable/)
  })

  it("session probe reports presence-only (no values in the extension env)", () => {
    const probe = probeEOSession()
    expect(probe.authenticated).toBe(false)
    expect(probe.channels).toEqual([])
  })

  it("selector spec is versioned so venue UI changes are auditable", () => {
    expect(EO_SELECTOR_SPEC_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
  })
})