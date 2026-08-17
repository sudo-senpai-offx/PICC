import { describe, expect, it } from "vitest"
import {
  CATALOG,
  BANDWIDTH_APPS,
  DEPIN_APPS,
  STORAGE_APPS,
  COMPUTE_APPS,
  CRYPTO_APPS,
  DEFI_APPS,
  NFT_APPS,
  P2P_APPS,
  AGENT_APPS,
  INTEREST_APPS,
  DIVIDEND_APPS,
  RENTAL_APPS,
  CONTENT_APPS
} from "../streamCatalog"

const GROUPS: Record<string, typeof CATALOG> = {
  bandwidth: BANDWIDTH_APPS,
  depin: DEPIN_APPS,
  storage: STORAGE_APPS,
  compute: COMPUTE_APPS,
  crypto: CRYPTO_APPS,
  defi: DEFI_APPS,
  nft: NFT_APPS,
  p2p: P2P_APPS,
  agent: AGENT_APPS,
  interest: INTEREST_APPS,
  dividend: DIVIDEND_APPS,
  rental: RENTAL_APPS,
  content: CONTENT_APPS
}

describe("stream catalog integrity", () => {
  it("has no duplicate ids across the whole catalog", () => {
    const ids = CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("exposes every entry exactly once through CATALOG", () => {
    const total = Object.values(GROUPS).reduce((acc, g) => acc + g.length, 0)
    expect(CATALOG.length).toBe(total)
  })

  it("marks every entry's category as a known catalog category", () => {
    const known = new Set([
      "bandwidth",
      "depin",
      "storage",
      "compute",
      "crypto",
      "nft",
      "p2p",
      "agent",
      "interest",
      "dividend",
      "rental",
      "content",
      "other"
    ])
    for (const e of CATALOG) {
      expect(known.has(e.category), `unknown category for ${e.id}: ${e.category}`).toBe(true)
    }
  })

  it("gives every entry a name, payout and a resolvable url", () => {
    for (const e of CATALOG) {
      expect(e.name.length, `${e.id} name`).toBeGreaterThan(0)
      expect(e.payout.length, `${e.id} payout`).toBeGreaterThan(0)
      expect(e.url, `${e.id} url`).toMatch(/^(https?:\/\/|\/)/)
    }
  })

  it("keeps category A (passive) entries resident/vps-free where money does the work", () => {
    const passive = [...INTEREST_APPS, ...DIVIDEND_APPS]
    for (const e of passive) {
      expect(e.vps, `${e.id} should not require a VPS`).toBe(false)
      expect(e.residential, `${e.id} should not require a residential IP`).toBe(false)
    }
  })
})
