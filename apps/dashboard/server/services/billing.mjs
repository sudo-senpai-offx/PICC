// Local-only subscription billing sync (Supabase removed per D8 — keep everything local).
// Persistence routes through localstore.mjs JSON tables (server/data/billing.json).
import { listRows, upsertRow } from "./localstore.mjs"

/** Keep a profile's subscription fields in sync from a billing event. */
export async function syncSubscription({ userId, status, tier, stripeCustomerId }) {
  if (!userId) return { applied: false, reason: "userId missing" }
  const existing = (await listRows("billing")).find((b) => b.user_id === userId)
  const row = await upsertRow("billing", {
    id: existing?.id,
    user_id: userId,
    subscription_status: status,
    subscription_tier: tier,
    stripe_customer_id: stripeCustomerId,
    updated_at: new Date().toISOString()
  })
  return { applied: true, local: true, row }
}