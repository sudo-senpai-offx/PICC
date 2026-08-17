// Server-side Supabase access.
// - `admin` uses the service-role key (bypasses RLS) for Stripe webhook sync.
import { createClient } from "@supabase/supabase-js"
import { env } from "../config.mjs"
import { listRows, appendRow } from "./localstore.mjs"

export const admin =
  env.supabaseUrl && env.supabaseServiceKey
    ? createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } })
    : null

const anonClient =
  env.supabaseUrl && (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY)
    ? createClient(env.supabaseUrl, process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY)
    : null

/** Keep a profile's subscription fields in sync from a billing event. */
export async function syncSubscription({ userId, status, tier, stripeCustomerId }) {
  if (!userId) return { applied: false, reason: "userId missing" }

  // Local mode: persist the subscription to the JSON billing store.
  if (!admin || !env.supabaseUrl || !env.supabaseServiceKey) {
    const existing = (await listRows("billing")).find((b) => b.user_id === userId)
    const row = await appendRow("billing", {
      id: existing?.id,
      user_id: userId,
      subscription_status: status,
      subscription_tier: tier,
      stripe_customer_id: stripeCustomerId,
      updated_at: new Date().toISOString()
    })
    return { applied: true, local: true, row }
  }

  const { error } = await admin.from("profiles").update({
    subscription_status: status,
    subscription_tier: tier,
    stripe_customer_id: stripeCustomerId
  })
  if (error) return { applied: false, reason: error.message }
  return { applied: true }
}
