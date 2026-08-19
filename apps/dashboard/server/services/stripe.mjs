// Stripe billing (test/live keys). Server-side only.
// - POST /api/stripe/checkout -> Subscription checkout session
// - POST /api/stripe/portal   -> customer billing portal session
// - POST /api/stripe/webhook  -> keeps profiles.subscription_* in sync
import { env } from "../config.mjs"

let clientPromise = null

async function stripe() {
  if (!env.stripeSecretKey) throw new Error("STRIPE_SECRET_KEY not configured")
  if (!clientPromise) {
    const { default: Stripe } = await import("stripe")
    clientPromise = new Stripe(env.stripeSecretKey)
  }
  return clientPromise
}

export async function createCheckoutSession({ priceId, userId, tier = "pro", successUrl, cancelUrl }) {
  const s = await stripe()
  return s.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    metadata: { userId, tier },
    subscription_data: { metadata: { userId, tier } },
    success_url: successUrl,
    cancel_url: cancelUrl
  })
}

export async function createPortalSession(customerId) {
  const s = await stripe()
  return s.billingPortal.sessions.create({
    customer: customerId,
    return_url: process.env.PICC_APP_URL ?? "http://localhost:5173/profile"
  })
}

export async function constructWebhookEvent(rawBody, signature) {
  const s = await stripe()
  if (!env.stripeWebhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not configured")
  return s.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret)
}

export function hasStripe() {
  return Boolean(env.stripeSecretKey)
}
