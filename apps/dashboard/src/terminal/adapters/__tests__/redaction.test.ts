// WS-6 T3 — secret redaction (RED, AC-017 + AC-014).
//
// The terminal may render readiness/metadata, never secrets. WS-5 already found
// a real credential leak (a real Hyperliquid wallet key pair reaching the e2e
// server via the repo `.env`), so this is treated as a P0 boundary with an
// explicit deny-list rather than "render the fields we remember to skip".
import { describe, expect, it } from "vitest"
import { redactSecrets, containsSecretMaterial, REDACTED } from "../redaction"

describe("redaction — private key material", () => {
  it("redacts a raw 0x private key", () => {
    const key = "0x" + "a".repeat(64)
    const out = redactSecrets({ note: `key is ${key}` })
    expect(out.note).not.toContain(key)
    expect(out.note).not.toContain("aaaa")
    expect(out.note).toContain(REDACTED)
  })

  it("redacts a bare 64-hex private key without the 0x prefix", () => {
    const bare = "b".repeat(64)
    const out = redactSecrets({ note: bare })
    expect(out.note).not.toContain(bare)
  })

  it("redacts credential-shaped JSON values by key name", () => {
    const out = redactSecrets({
      apiKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      passphrase: "correct horse battery staple"
    })
    expect(out.apiKey).toBe(REDACTED)
    expect(out.secretKey).toBe(REDACTED)
    expect(out.passphrase).toBe(REDACTED)
  })

  it("redacts venue credential fields regardless of casing", () => {
    const out = redactSecrets({
      PICC_CCXT_PRIVATEKEY_HYPERLIQUID: "deadbeef",
      walletAddress: "0x1234567890abcdef1234567890abcdef12345678"
    })
    expect(Object.values(out).every((v) => v === REDACTED)).toBe(true)
  })
})

describe("redaction — nested and array payloads", () => {
  it("redacts nested objects", () => {
    const out = redactSecrets({ venue: { credentials: { privateKey: "supersecretvalue" } } })
    expect(JSON.stringify(out)).not.toContain("supersecretvalue")
  })

  it("redacts inside arrays of objects", () => {
    const out = redactSecrets({ venues: [{ apiKey: "leaky" }, { apiKey: "alsoleaky" }] })
    expect(JSON.stringify(out)).not.toContain("leaky")
  })

  it("walks deeply nested structures", () => {
    const out = redactSecrets({ a: { b: { c: { d: [{ secret: "deepvalue" }] } } } })
    expect(JSON.stringify(out)).not.toContain("deepvalue")
  })
})

describe("redaction — it must not destroy ordinary data", () => {
  it("leaves non-secret operational fields intact", () => {
    const out = redactSecrets({
      venueId: "hyperliquid",
      integrityStatus: "verified",
      freshnessMs: 250,
      ready: true,
      labels: ["a", "b"]
    })
    expect(out.venueId).toBe("hyperliquid")
    expect(out.integrityStatus).toBe("verified")
    expect(out.freshnessMs).toBe(250)
    expect(out.ready).toBe(true)
    expect(out.labels).toEqual(["a", "b"])
  })

  it("does not mutate the input object", () => {
    const input = { apiKey: "original" }
    redactSecrets(input)
    expect(input.apiKey).toBe("original")
  })

  it("preserves a venueId that merely looks numeric", () => {
    const out = redactSecrets({ venueId: "12345678" })
    expect(out.venueId).toBe("12345678")
  })
})

describe("secret detection — used by T12 guards", () => {
  it("detects secret material in a rendered string", () => {
    expect(containsSecretMaterial("0x" + "f".repeat(64))).toBe(true)
    expect(containsSecretMaterial("apiKey: hunter2secretvalue")).toBe(true)
  })

  it("does not false-positive on ordinary terminal copy", () => {
    expect(containsSecretMaterial("copilot: remote — no signed-trades feed")).toBe(false)
    expect(containsSecretMaterial("hyperliquid integrity verified")).toBe(false)
    expect(containsSecretMaterial("room command-centre reserved for WS-6")).toBe(false)
  })
})
