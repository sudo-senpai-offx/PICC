import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "../config.mjs"
import {
  createBtcpayInvoice,
  btcpayInvoiceStatus,
  hasBtcpay
} from "../services/btcpay.mjs"

const KEYS = ["btcpayUrl", "btcpayApiKey", "btcpayStoreId"]

function snapshot() {
  const s = {}
  for (const k of KEYS) s[k] = env[k]
  return s
}

function restore(snap) {
  for (const k of KEYS) env[k] = snap[k]
}

/** Mock BTCPay that echoes the invoice metadata on status, as the real API does. */
function btcpayServer({ metadata = {}, status = "New" } = {}) {
  return vi.fn(async (url, init) => {
    if (url.endsWith("/invoices") && init?.method === "POST") {
      const body = JSON.parse(init.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "INV-1",
          checkoutLink: "https://btcpay.example/checkout/INV-1",
          url: "https://btcpay.example/checkout/INV-1",
          metadata: body.metadata
        })
      }
    }
    if (url.endsWith("/invoices/INV-1") && init?.method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "INV-1", status, amount: "19.00", metadata })
      }
    }
    throw new Error(`unexpected fetch: ${url} ${init?.method}`)
  })
}

describe("BTCPay service", () => {
  let saved
  beforeEach(() => {
    saved = snapshot()
    env.btcpayUrl = "https://btcpay.example"
    env.btcpayApiKey = "api-key"
    env.btcpayStoreId = "store-1"
  })
  afterEach(() => {
    restore(saved)
    vi.unstubAllGlobals()
  })

  it("reports configured/not configured correctly", () => {
    expect(hasBtcpay()).toBe(true)
    env.btcpayApiKey = ""
    expect(hasBtcpay()).toBe(false)
  })

  it("creates an invoice and returns the checkout link", async () => {
    vi.stubGlobal("fetch", btcpayServer())
    const result = await createBtcpayInvoice({ amount: 19, currency: "USD", description: "pro", userId: "u1", tier: "pro" })
    expect(result.id).toBe("INV-1")
    expect(result.checkoutLink).toBe("https://btcpay.example/checkout/INV-1")
  })

  it("embeds userId and tier into the invoice metadata (needed for the grant)", async () => {
    const fetchMock = btcpayServer()
    vi.stubGlobal("fetch", fetchMock)
    await createBtcpayInvoice({ amount: 49, tier: "business", userId: "u7" })
    const createCall = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")
    const body = JSON.parse(createCall[1].body)
    expect(body.metadata).toEqual({ description: "PICC payment", userId: "u7", tier: "business" })
    expect(body.amount).toBe("49")
  })

  it("returns a settled invoice together with the userId/tier it was created with", async () => {
    vi.stubGlobal("fetch", btcpayServer({ metadata: { userId: "u1", tier: "pro" }, status: "Settled" }))
    const info = await btcpayInvoiceStatus("INV-1")
    expect(info.status).toBe("Settled")
    expect(info.userId).toBe("u1")
    expect(info.tier).toBe("pro")
  })

  it("returns null userId/tier when metadata is absent (never fabricates a grant)", async () => {
    vi.stubGlobal("fetch", btcpayServer({ metadata: {}, status: "Settled" }))
    const info = await btcpayInvoiceStatus("INV-1")
    expect(info.status).toBe("Settled")
    expect(info.userId).toBeNull()
    expect(info.tier).toBeNull()
  })

  it("normalises an invalid tier in metadata to null", async () => {
    vi.stubGlobal("fetch", btcpayServer({ metadata: { userId: "u1", tier: "enterprise" }, status: "Settled" }))
    const info = await btcpayInvoiceStatus("INV-1")
    expect(info.status).toBe("Settled")
    expect(info.userId).toBe("u1")
    expect(info.tier).toBeNull()
  })
})
