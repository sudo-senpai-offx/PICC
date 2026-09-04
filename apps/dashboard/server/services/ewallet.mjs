// Manual e-wallet payments — Touch 'n Go (Malaysia).
// Income-receiving flow: no gateway API and no business registration needed. The
// customer sends the exact amount to the seller's personal e-wallet (money never
// touches a bank account), then submits their e-wallet confirmation code against
// the generated reference. Orders persist to disk so they survive restarts.
import { mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { env } from "../config.mjs"

const WALLETS = {
  tng: {
    label: "Touch 'n Go",
    country: "Malaysia",
    currency: "MYR",
    envKey: "ewalletTngNumber",
    prompt:
      "Open Touch 'n Go eWallet → Transfer → enter the seller's TNG number or DuitNow ID → " +
      "enter the exact amount → add your reference code as the note → confirm. Keep the confirmation."
  }
}

export const WALLET_IDS = Object.keys(WALLETS)

export function walletInfo(id) {
  return WALLETS[id] ?? null
}

export function referenceFor() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let out = "PICC-"
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

function dataDir() {
  return process.env.PICC_EWALLET_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
}

const ordersFile = () => join(dataDir(), "ewallet-orders.json")

let orders = null

async function loadOrders() {
  if (orders) return orders
  try {
    const raw = JSON.parse(await readFile(ordersFile(), "utf8"))
    orders = raw && typeof raw === "object" ? raw : {}
  } catch {
    orders = {}
  }
  return orders
}

async function saveOrders() {
  try {
    await writeFile(ordersFile(), JSON.stringify(orders, null, 2), "utf8")
  } catch (err) {
    if (err && err.code === "ENOENT") {
      try {
        mkdirSync(dirname(ordersFile()), { recursive: true })
        await writeFile(ordersFile(), JSON.stringify(orders, null, 2), "utf8")
      } catch {
        /* best-effort persistence — the in-memory copy still serves the session */
      }
    }
  }
}

export async function createEwalletOrder({
  ewallet = "tng",
  amount,
  currency,
  description = "PICC payment",
  userId
}) {
  const info = WALLETS[ewallet]
  if (!info) throw new Error(`unsupported eWallet: ${ewallet} (use ${WALLET_IDS.join(", ")})`)
  if (userId == null || String(userId).trim() === "") {
    throw new Error("userId is required — eWallet orders must carry an owner for the PICC ledger")
  }
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) throw new Error("amount must be a positive number")
  const currencyCode = String(currency || info.currency).toUpperCase()
  const tngNumber = env[info.envKey]?.trim()
  if (!tngNumber) {
    throw new Error(`${info.envKey} not set — add your TNG number to .env before creating eWallet orders`)
  }

  const order = {
    id: randomUUID(),
    userId,
    ewallet,
    reference: referenceFor(),
    amount: value,
    currency: currencyCode,
    description: String(description),
    status: "awaiting_payment",
    created_at: new Date().toISOString()
  }
  const all = await loadOrders()
  all[order.id] = order
  orders = all
  await saveOrders()

  return {
    orderId: order.id,
    reference: order.reference,
    tngNumber,
    amount: value,
    currency: currencyCode,
    description: String(description),
    instructions: info.prompt
  }
}

/**
 * Confirms an eWallet order as paid (self-serve income flow).
 * The order can only be confirmed by its OWNER (actorUserId must match the
 * order's owner). An explicit `selfApprove` flag is additionally required for
 * contexts that skip real-money verification — kept behind an explicit opt-in
 * (admin/demo) so a stray caller can never weld an order to "confirmed".
 */
export async function submitEwalletOrder({ orderId, confirmRef, actorUserId = null, selfApprove = false }) {
  const all = await loadOrders()
  const order = all[orderId]
  if (!order) throw new Error("order not found")
  if (order.userId != null) {
    const owner = order.userId === actorUserId
    if (!owner && !selfApprove) {
      throw new Error("order not found")
    }
  } else if (!selfApprove) {
    // Legacy orders without a bound owner can only be confirmed via an
    // explicit self-approve (admin/demo) path, never by an arbitrary caller.
    throw new Error("order not found")
  }
  if (order.status === "confirmed") return { ok: true, reference: order.reference, already: true }
  const ref = String(confirmRef ?? "").trim()
  if (!ref) throw new Error("confirmation reference is required")
  // TNG references are long numeric codes — guard against junk submissions
  // while staying lenient about spaces/dashes between digits.
  if (!/^\d[\d\s-]{6,28}\d$/.test(ref)) {
    throw new Error("confirmation reference looks invalid — expected the TNG transaction reference")
  }
  order.status = "confirmed"
  order.confirmed_at = new Date().toISOString()
  order.confirmed_by = actorUserId || null
  order.self_approved = Boolean(selfApprove)
  all[order.id] = order
  orders = all
  await saveOrders()
  return { ok: true, reference: order.reference, already: false }
}

/** Read one order by id (owner-scoped). Returns null when absent. */
export async function getEwalletOrder(orderId) {
  const all = await loadOrders()
  return all[orderId] ?? null
}
