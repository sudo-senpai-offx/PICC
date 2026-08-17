// PayPal Checkout (Orders v2) — server-side capture.
// Works with a personal/individual PayPal account: no business entity or
// bank verification needed to receive payments. Server-side only.
// - POST /v2/checkout/orders            -> approval URL the user is sent to
// - POST /v2/checkout/orders/:id/capture -> we capture only orders we created
import { env } from "../config.mjs"
import { admin } from "./supabase.mjs"

const BASE = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com"
}

const TIER_PRICES = {
  pro: { value: "19.00", currency: "USD" },
  business: { value: "49.00", currency: "USD" }
}

let tokenPromise = null
const pendingOrders = new Map() // paypalOrderId -> { tier, userId }

function baseUrl() {
  return BASE[env.paypalMode] ?? BASE.live
}

export function hasPayPal() {
  return Boolean(env.paypalClientId && env.paypalClientSecret)
}

export function priceForTier(tier) {
  return TIER_PRICES[tier] ?? null
}

async function accessToken() {
  if (!hasPayPal()) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not configured")
  if (tokenPromise) return tokenPromise
  tokenPromise = (async () => {
    const body = new URLSearchParams({ grant_type: "client_credentials" }).toString()
    const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.paypalClientId}:${env.paypalClientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "Accept-Language": "en_US"
      },
      body
    })
    if (!res.ok) throw new Error(`paypal auth failed: ${res.status}`)
    const data = await res.json()
    return data.access_token
  })()
  tokenPromise.catch(() => {
    tokenPromise = null
  })
  return tokenPromise
}

async function persist({ provider, userId, tier, amount, currency, reference }) {
  if (!admin || !env.supabaseUrl || !env.supabaseServiceKey) return
  await admin.from("payment_orders").insert({
    user_id: userId,
    provider,
    tier,
    amount,
    currency,
    reference,
    status: "awaiting_payment",
    meta: {}
  })
}

export async function createPayPalOrder({ tier = "pro", userId, returnUrl, cancelUrl }) {
  const price = priceForTier(tier)
  if (!price) throw new Error(`unknown tier: ${tier}`)
  const token = await accessToken()
  const res = await fetch(`${baseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: JSON.stringify({ tier, userId }),
          description: `PICC ${tier} plan`,
          amount: { currency_code: price.currency, value: price.value }
        }
      ],
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING"
      }
    })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`paypal create order failed: ${res.status} ${data.message ?? ""}`)
  const approve = (data.links ?? []).find((l) => l.rel === "approve")
  if (!approve?.href) throw new Error("paypal order returned no approval link")
  pendingOrders.set(data.id, { tier, userId })
  await persist({ provider: "paypal", userId, tier, amount: Number(price.value), currency: price.currency, reference: data.id })
  return { orderId: data.id, url: approve.href }
}

async function loadPayPalOrder(orderId) {
  if (!admin || !env.supabaseUrl || !env.supabaseServiceKey) return null
  const { data, error } = await admin
    .from("payment_orders")
    .select("tier, user_id")
    .eq("provider", "paypal")
    .eq("reference", orderId)
    .maybeSingle()
  if (error || !data) return null
  return { tier: data.tier, userId: data.user_id }
}

/** Capture an order the user approved on PayPal. Returns the granted tier. */
export async function capturePayPalOrder(orderId) {
  const expected = pendingOrders.get(orderId) ?? (await loadPayPalOrder(orderId))
  if (!expected) throw new Error("unknown paypal order (create it via /api/paypal/create-order first)")
  const token = await accessToken()
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`paypal capture failed: ${res.status} ${data.message ?? ""}`)
  if (data.status !== "COMPLETED") throw new Error(`paypal order not completed (status: ${data.status})`)
  const unit = data.purchase_units?.[0] ?? {}
  const capture = unit.payments?.captures?.[0] ?? {}
  let custom = {}
  try {
    custom = JSON.parse(unit.custom_id ?? "{}")
  } catch {
    /* ignore malformed custom_id */
  }
  const price = priceForTier(expected.tier)
  const valueMatch = capture.amount?.value === price?.value
  const tierMatch = custom.tier === expected.tier
  if (!valueMatch || !tierMatch) throw new Error("paypal capture amount/tier mismatch")
  pendingOrders.delete(orderId)
  if (admin && env.supabaseUrl && env.supabaseServiceKey) {
    await admin
      .from("payment_orders")
      .update({ status: "granted", confirm_ref: capture.id, meta: { capture_id: capture.id, payer_email: data.payer?.email_address } })
      .eq("provider", "paypal")
      .eq("reference", orderId)
  }
  return {
    tier: expected.tier,
    userId: expected.userId,
    captureId: capture.id,
    payerEmail: data.payer?.email_address,
    amount: capture.amount?.value,
    currency: capture.amount?.currency_code
  }
}
