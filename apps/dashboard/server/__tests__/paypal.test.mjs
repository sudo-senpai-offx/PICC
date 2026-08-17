import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "../config.mjs"
import {
  createPayPalOrder,
  capturePayPalOrder,
  hasPayPal,
  priceForTier
} from "../services/paypal.mjs"

const KEYS = ["paypalClientId", "paypalClientSecret", "paypalMode", "supabaseUrl", "supabaseServiceKey"]

function snapshot() {
  const s = {}
  for (const k of KEYS) s[k] = env[k]
  return s
}

function restore(snap) {
  for (const k of KEYS) env[k] = snap[k]
}

function paypalOk(response) {
  return vi.fn(async (url, init) => {
    if (url.endsWith("/v1/oauth2/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "test-token" }) }
    }
    if (url.endsWith("/v2/checkout/orders") && init.method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "ORDER-1",
          links: [{ rel: "approve", href: "https://paypal.com/approve/ORDER-1" }]
        })
      }
    }
    if (url.endsWith("/capture") && init.method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => response
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function captureResponse(overrides = {}) {
  return {
    status: "COMPLETED",
    purchase_units: [
      {
        custom_id: JSON.stringify({ tier: "pro", userId: "u1" }),
        payments: { captures: [{ id: "CAP-1", amount: { value: "19.00", currency_code: "USD" } }] }
      }
    ],
    payer: { email_address: "buyer@example.com" },
    ...overrides
  }
}

describe("PayPal Checkout service", () => {
  let saved
  beforeEach(() => {
    saved = snapshot()
    env.paypalClientId = "client-id"
    env.paypalClientSecret = "client-secret"
    env.paypalMode = "sandbox"
    env.supabaseUrl = env.supabaseServiceKey = ""
  })
  afterEach(() => {
    restore(saved)
    vi.unstubAllGlobals()
  })

  it("reports configured/not configured correctly", () => {
    expect(hasPayPal()).toBe(true)
    env.paypalClientSecret = ""
    expect(hasPayPal()).toBe(false)
    expect(priceForTier("pro")).toEqual({ value: "19.00", currency: "USD" })
    expect(priceForTier("enterprise")).toBeNull()
  })

  it("creates an order and returns the approval URL", async () => {
    vi.stubGlobal("fetch", paypalOk(captureResponse()))
    const result = await createPayPalOrder({ tier: "pro", userId: "u1" })
    expect(result.orderId).toBe("ORDER-1")
    expect(result.url).toBe("https://paypal.com/approve/ORDER-1")
  })

  it("sends amount, currency and custom_id on the create call", async () => {
    const fetchMock = paypalOk(captureResponse())
    vi.stubGlobal("fetch", fetchMock)
    await createPayPalOrder({ tier: "business", userId: "u7" })
    const createCall = fetchMock.mock.calls.find(([u, i]) => u.endsWith("/v2/checkout/orders") && i?.method === "POST")
    const body = JSON.parse(createCall[1].body)
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "49.00" })
    expect(JSON.parse(body.purchase_units[0].custom_id)).toEqual({ tier: "business", userId: "u7" })
    expect(body.application_context.user_action).toBe("PAY_NOW")
  })

  it("captures an order we created and returns the granted tier", async () => {
    vi.stubGlobal("fetch", paypalOk(captureResponse()))
    await createPayPalOrder({ tier: "pro", userId: "u1" })
    const result = await capturePayPalOrder("ORDER-1")
    expect(result.tier).toBe("pro")
    expect(result.userId).toBe("u1")
    expect(result.captureId).toBe("CAP-1")
    expect(result.payerEmail).toBe("buyer@example.com")
  })

  it("rejects capturing an order it never created", async () => {
    vi.stubGlobal("fetch", paypalOk(captureResponse()))
    await expect(capturePayPalOrder("ORDER-STRANGER")).rejects.toThrow("unknown paypal order")
  })

  it("rejects a capture whose amount does not match the tier price", async () => {
    vi.stubGlobal("fetch", paypalOk(captureResponse({ purchase_units: [{ payments: { captures: [{ amount: { value: "1.00" } }] } }] })))
    await createPayPalOrder({ tier: "pro", userId: "u1" })
    await expect(capturePayPalOrder("ORDER-1")).rejects.toThrow("amount/tier mismatch")
  })

  it("throws when capture is not completed", async () => {
    vi.stubGlobal("fetch", paypalOk(captureResponse({ status: "PAYER_ACTION_REQUIRED" })))
    await createPayPalOrder({ tier: "pro", userId: "u1" })
    await expect(capturePayPalOrder("ORDER-1")).rejects.toThrow("not completed")
  })
})
