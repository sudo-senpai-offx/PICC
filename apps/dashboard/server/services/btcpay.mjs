// BTCPay Server — self-hosted, open-source, no KYC, no bank account.
// Income-receiving flow: creates a store invoice for an arbitrary amount (fiat;
// BTCPay converts to crypto at checkout). The seller shares the checkout link and
// the buyer pays straight to the seller's node. No platform cut.
import { env } from "../config.mjs"

function baseUrl() {
  return env.btcpayUrl.replace(/\/+$/, "")
}

export function hasBtcpay() {
  return Boolean(env.btcpayUrl && env.btcpayApiKey && env.btcpayStoreId)
}

function authHeaders() {
  return {
    Authorization: `token ${env.btcpayApiKey}`,
    "BTCPay-API-Key": env.btcpayApiKey,
    "Content-Type": "application/json"
  }
}

export async function createBtcpayInvoice({ amount, currency = "USD", description = "PICC payment" }) {
  if (!hasBtcpay()) throw new Error("BTCPay Server not configured")
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) throw new Error("amount must be a positive number")
  const res = await fetch(
    `${baseUrl()}/api/v1/stores/${encodeURIComponent(env.btcpayStoreId)}/invoices`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        currency: String(currency).toUpperCase(),
        amount: String(value),
        metadata: { description: String(description) },
        checkout: {
          requiresRefundEmail: false,
          redirectAutomatically: false
        }
      })
    }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`btcpay invoice failed: ${res.status} ${data.message ?? ""}`)
  const checkoutLink = data.checkoutLink ?? data.url
  return { id: data.id, checkoutLink, url: checkoutLink }
}

/** Check an invoice's status on the BTCPay server (authoritative, no webhooks needed). */
export async function btcpayInvoiceStatus(invoiceId) {
  if (!hasBtcpay()) throw new Error("BTCPay Server not configured")
  const res = await fetch(
    `${baseUrl()}/api/v1/stores/${encodeURIComponent(env.btcpayStoreId)}/invoices/${encodeURIComponent(invoiceId)}`,
    { method: "GET", headers: authHeaders() }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`btcpay status failed: ${res.status} ${data.message ?? ""}`)
  return { status: data.status, amount: data.amount }
}

/**
 * Node reachability + sync status. `/api/v1/health` is public (no API key),
 * so this works even before BTCPAY_API_KEY is configured.
 */
export async function btcpayNodeHealth() {
  if (!env.btcpayUrl) return { configured: false, reachable: false, synchronized: null }
  try {
    const res = await fetch(`${baseUrl()}/api/v1/health`, { method: "GET", signal: AbortSignal.timeout(5000) })
    const data = await res.json().catch(() => ({}))
    return {
      configured: hasBtcpay(),
      reachable: res.ok,
      synchronized: res.ok ? Boolean(data.synchronized) : null
    }
  } catch {
    return { configured: hasBtcpay(), reachable: false, synchronized: null }
  }
}
