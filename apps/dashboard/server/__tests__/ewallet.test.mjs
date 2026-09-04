import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { env } from "../config.mjs"
import { createEwalletOrder, submitEwalletOrder, getEwalletOrder, walletInfo, referenceFor, WALLET_IDS } from "../services/ewallet.mjs"

const TMP = mkdtempSync(join(tmpdir(), "picc-ewallet-"))
process.env.PICC_EWALLET_DATA_DIR = TMP

describe("manual e-wallet income orders", () => {
  let saved
  beforeEach(() => {
    saved = env.ewalletTngNumber
    env.ewalletTngNumber = "60112004264"
  })
  afterEach(() => {
    env.ewalletTngNumber = saved
    vi.unstubAllGlobals()
  })
  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  it("exposes only the supported wallets", () => {
    expect(WALLET_IDS).toEqual(["tng"])
    expect(walletInfo("tng").country).toBe("Malaysia")
    expect(walletInfo("gcash")).toBeNull()
    expect(walletInfo("grabpay")).toBeNull()
  })

  it("generates readable reference codes", () => {
    const ref = referenceFor()
    expect(ref).toMatch(/^PICC-[A-Z2-9]{8}$/)
  })

  it("creates a Touch 'n Go order for an arbitrary amount", async () => {
    const o = await createEwalletOrder({ ewallet: "tng", amount: 25, currency: "MYR", description: "Digital product", userId: "u1" })
    expect(o.orderId).toMatch(/^[0-9a-f-]{36}$/)
    expect(o.reference).toMatch(/^PICC-/)
    expect(o.amount).toBe(25)
    expect(o.currency).toBe("MYR")
    expect(o.description).toBe("Digital product")
    expect(o.tngNumber).toBe("60112004264")
    expect(o.instructions).toContain("Touch 'n Go")
  })

  it("defaults currency to MYR for TNG", async () => {
    const o = await createEwalletOrder({ ewallet: "tng", amount: 10, userId: "u1" })
    expect(o.currency).toBe("MYR")
    expect(o.description).toBe("PICC payment")
  })

  it("rejects unsupported wallets, invalid amounts, and a missing owner", async () => {
    await expect(createEwalletOrder({ ewallet: "grab", amount: 10, userId: "u1" })).rejects.toThrow("unsupported eWallet")
    await expect(createEwalletOrder({ ewallet: "tng", amount: 0, userId: "u1" })).rejects.toThrow("amount must be")
    await expect(createEwalletOrder({ ewallet: "tng", amount: -5, userId: "u1" })).rejects.toThrow("amount must be")
    await expect(createEwalletOrder({ ewallet: "tng", amount: 5 })).rejects.toThrow(
      "userId is required — eWallet orders must carry an owner"
    )
  })

  it("fails loudly instead of inventing a TNG number when none is configured", async () => {
    env.ewalletTngNumber = ""
    await expect(createEwalletOrder({ ewallet: "tng", amount: 5, userId: "u1" })).rejects.toThrow(/ewalletTngNumber not set/)
  })

  it("submitting without a confirmation reference is rejected", async () => {
    const o = await createEwalletOrder({ ewallet: "tng", amount: 5, userId: "u1" })
    await expect(submitEwalletOrder({ orderId: o.orderId, confirmRef: "  ", actorUserId: "u1" })).rejects.toThrow(
      "confirmation reference is required"
    )
  })

  it("rejects junk that cannot be a TNG transaction reference", async () => {
    const o = await createEwalletOrder({ ewallet: "tng", amount: 5, userId: "u1" })
    await expect(submitEwalletOrder({ orderId: o.orderId, confirmRef: "XYZ123", actorUserId: "u1" })).rejects.toThrow(
      "confirmation reference looks invalid"
    )
  })

  it("submitting confirms the order once (idempotent) when it is the OWNER", async () => {
    const o = await createEwalletOrder({ ewallet: "tng", amount: 5, userId: "u1" })
    const r = await submitEwalletOrder({ orderId: o.orderId, confirmRef: "1004829384756123", actorUserId: "u1" })
    expect(r.ok).toBe(true)
    expect(r.reference).toBe(o.reference)
    const again = await submitEwalletOrder({ orderId: o.orderId, confirmRef: "1004829384756123", actorUserId: "u1" })
    expect(again.already).toBe(true)
  })

  it("rejects a NON-OWNER confirming an order (no self-approve) — Fix 6", async () => {
    const o = await createEwalletOrder({ ewallet: "tng", amount: 5, userId: "u1" })
    await expect(
      submitEwalletOrder({ orderId: o.orderId, confirmRef: "1004829384756123", actorUserId: "attacker" })
    ).rejects.toThrow("order not found")
    await expect(
      submitEwalletOrder({ orderId: o.orderId, confirmRef: "1004829384756123", actorUserId: null, selfApprove: false })
    ).rejects.toThrow("order not found")
  })

  it("allows cross-owner confirmation ONLY behind an explicit self-approve (admin/demo) flag — Fix 6", async () => {
    const o = await createEwalletOrder({ ewallet: "tng", amount: 5, userId: "u1" })
    const r = await submitEwalletOrder({
      orderId: o.orderId,
      confirmRef: "1004829384756123",
      actorUserId: "admin",
      selfApprove: true
    })
    expect(r.ok).toBe(true)
    // The confirmed order records who approved it and that it was self-approved.
    const stored = await getEwalletOrder(o.orderId)
    expect(stored).not.toBeNull()
    expect(stored.status).toBe("confirmed")
    expect(stored.confirmed_by).toBe("admin")
    expect(stored.self_approved).toBe(true)
  })

  it("binds the order to its owner (createEwalletOrder stores userId) — Fix 6", async () => {
    const o = await createEwalletOrder({ ewallet: "tng", amount: 5, userId: "u-owner" })
    const stored = await getEwalletOrder(o.orderId)
    expect(stored).not.toBeNull()
    expect(stored.userId).toBe("u-owner")
  })

  it("rejects submitting an unknown order", async () => {
    await expect(
      submitEwalletOrder({ orderId: "does-not-exist", confirmRef: "1004829384756123", actorUserId: "u1" })
    ).rejects.toThrow("order not found")
  })

  it("survives a module reload (orders persist to disk)", async () => {
    const o = await createEwalletOrder({ ewallet: "tng", amount: 15, userId: "u1" })
    vi.resetModules()
    const fresh = await import("../services/ewallet.mjs")
    const r = await fresh.submitEwalletOrder({ orderId: o.orderId, confirmRef: "8847302910564829", actorUserId: "u1" })
    expect(r.ok).toBe(true)
    expect(r.reference).toBe(o.reference)
  })
})
