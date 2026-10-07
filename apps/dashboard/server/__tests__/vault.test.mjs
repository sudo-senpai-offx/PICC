// At-rest vault tests (F-02). Hermetic: every case writes into its own tmp
// data dir; the vault derives its key per-directory (env key or 0600 keyfile)
// and reads PICC_VAULT_KEY lazily, so env switches + resetVaultKey() are safe.
import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  decryptText,
  encryptText,
  readSecretJson,
  resetVaultKey,
  vaultKeySource,
  writeSecretJson
} from "../services/vault.mjs"

const dirs = []
function freshDir() {
  const d = mkdtempSync(join(tmpdir(), "picc-vault-"))
  dirs.push(d)
  return d
}

beforeAll(() => {
  delete process.env.PICC_VAULT_KEY // keyfile mode by default
})

afterAll(() => {
  delete process.env.PICC_VAULT_KEY
  resetVaultKey()
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe("vault env-key mode", () => {
  it("encrypts/decrypts and writes envelopes with no plaintext on disk", async () => {
    const dir = freshDir()
    process.env.PICC_VAULT_KEY = "unit-test-env-key-0123456789"
    resetVaultKey()
    try {
      expect(vaultKeySource()).toBe("env")
      const ct = await encryptText("super-secret-token", dir)
      expect(ct).not.toContain("super-secret-token")
      expect(await decryptText(ct, dir)).toBe("super-secret-token")

      const file = join(dir, "trading-credentials.json")
      await writeSecretJson(file, { expertoptionToken: "eo-token-abc", demo: true })
      const raw = readFileSync(file, "utf8")
      expect(raw).not.toContain("eo-token-abc")
      expect(raw).toContain('"pva1"')
      expect(await readSecretJson(file, null)).toEqual({ expertoptionToken: "eo-token-abc", demo: true })

      if (process.platform !== "win32") {
        expect(statSync(file).mode & 0o777).toBe(0o600)
      }
      expect(readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([])
    } finally {
      delete process.env.PICC_VAULT_KEY
      resetVaultKey()
    }
  })

  it("returns fallback (never throws) when a different key tries to read an envelope", async () => {
    const dir = freshDir()
    const file = join(dir, "venue-credentials.json")

    process.env.PICC_VAULT_KEY = "key-A-xxxxxxxxxxxxxxxx"
    resetVaultKey()
    await writeSecretJson(file, { ccxtExchanges: { binance: "k-1" } })

    // Switch keys (e.g. a config change or a foreign host reading the file):
    // decryption must fail CLOSED — fallback, never a throw or plaintext leak.
    process.env.PICC_VAULT_KEY = "key-B-yyyyyyyyyyyyyyyy"
    resetVaultKey()
    expect(await readSecretJson(file, {})).toEqual({})
  })

  it("returns fallback on a corrupted envelope too", async () => {
    const dir = freshDir()
    process.env.PICC_VAULT_KEY = "tamper-key-zzzzzzzzzzzzzz"
    resetVaultKey()
    try {
      const file = join(dir, "secrets.json")
      await writeSecretJson(file, { token: "t1" })
      const raw = JSON.parse(readFileSync(file, "utf8"))
      raw.pva1 = raw.pva1.slice(0, -4) + "AAAA" // corrupt ciphertext/tag
      writeFileSync(file, JSON.stringify(raw))
      expect(await readSecretJson(file, "FB")).toBe("FB")
    } finally {
      delete process.env.PICC_VAULT_KEY
      resetVaultKey()
    }
  })
})

describe("vault keyfile mode", () => {
  it("auto-generates a 0600 keyfile per data dir and round-trips", async () => {
    const dir = freshDir()
    expect(vaultKeySource()).toBe("keyfile")
    const file = join(dir, "trading-venue-tokens.json")
    await writeSecretJson(file, { expertoption: { token: "v-9" } })
    const keyRaw = readFileSync(join(dir, "picc-vault.key"), "utf8").trim()
    expect(keyRaw).toMatch(/^[0-9a-f]{64}$/)
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "picc-vault.key")).mode & 0o777).toBe(0o600)
    }
    expect(await readSecretJson(file, null)).toEqual({ expertoption: { token: "v-9" } })
  })
})

describe("vault legacy migration", () => {
  it("reads legacy plaintext JSON and converts on the next write", async () => {
    const dir = freshDir()
    const file = join(dir, "browser-credentials.json")
    writeFileSync(file, JSON.stringify({ expertoption: { username: "u", password: "pw-old-plain" } }))

    expect(await readSecretJson(file, null)).toEqual({ expertoption: { username: "u", password: "pw-old-plain" } })

    // A save encrypts the file (and the plaintext password disappears).
    await writeSecretJson(file, { expertoption: { username: "u", password: "pw-now-encrypted" } })
    const raw = readFileSync(file, "utf8")
    expect(raw).not.toContain("pw-now-encrypted")
    expect(await readSecretJson(file, null)).toEqual({ expertoption: { username: "u", password: "pw-now-encrypted" } })
  })
})

describe("vault scrypt KDF (v2 envelopes)", () => {
  it("writes version-tagged envelopes with a fresh salt per encrypt", async () => {
    const dir = freshDir()
    process.env.PICC_VAULT_KEY = "unit-test-env-key-0123456789"
    resetVaultKey()
    try {
      const a = await encryptText("same-plaintext", dir)
      const b = await encryptText("same-plaintext", dir)
      for (const ct of [a, b]) {
        const parts = ct.split(":")
        expect(parts).toHaveLength(5)
        expect(parts[0]).toBe("v2")
      }
      expect(a).not.toBe(b) // fresh salt (+iv) per encrypt
      expect(a).not.toContain("same-plaintext")
      expect(await decryptText(a, dir)).toBe("same-plaintext")
      expect(await decryptText(b, dir)).toBe("same-plaintext")
    } finally {
      delete process.env.PICC_VAULT_KEY
      resetVaultKey()
    }
  })

  it("refuses a short PICC_VAULT_KEY with a named reason", async () => {
    const dir = freshDir()
    process.env.PICC_VAULT_KEY = "short"
    resetVaultKey()
    try {
      await expect(encryptText("x", dir)).rejects.toThrow(/PICC_VAULT_KEY.*too short/i)
      expect(() => vaultKeySource()).toThrow(/PICC_VAULT_KEY.*too short/i)
    } finally {
      delete process.env.PICC_VAULT_KEY
      resetVaultKey()
    }
  })

  it("wrong key still fails closed on v2 envelopes", async () => {
    const dir = freshDir()
    const file = join(dir, "venue-credentials.json")
    process.env.PICC_VAULT_KEY = "key-A-xxxxxxxxxxxxxxxx"
    resetVaultKey()
    const ct = await encryptText("s3cr3t", dir)
    await writeSecretJson(file, { token: "s3cr3t" })

    process.env.PICC_VAULT_KEY = "key-B-yyyyyyyyyyyyyyyy"
    resetVaultKey()
    try {
      await expect(decryptText(ct, dir)).rejects.toThrow()
      expect(await readSecretJson(file, {})).toEqual({})
    } finally {
      delete process.env.PICC_VAULT_KEY
      resetVaultKey()
    }
  })

  it("old single-SHA256 env-key envelopes still unlock AND transparently upgrade to v2", async () => {
    // Fixture built with the RETIRED derivation (single SHA256, 3-part payload)
    // so this test proves the old code path stays readable after the KDF change.
    const { createCipheriv, createHash, randomBytes } = await import("node:crypto")
    const dir = freshDir()
    const KEY = "legacy-key-0123456789abcdef"
    process.env.PICC_VAULT_KEY = KEY
    resetVaultKey()
    try {
      const k = createHash("sha256").update(KEY).digest()
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", k, iv)
      const ct = Buffer.concat([cipher.update(JSON.stringify({ token: "legacy-t1" }), "utf8"), cipher.final()])
      const oldPayload = `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`
      expect(oldPayload.split(":")).toHaveLength(3)
      const file = join(dir, "legacy.json")
      writeFileSync(file, JSON.stringify({ pva1: oldPayload }))

      // Old fixture unlocks ...
      expect(await readSecretJson(file, null)).toEqual({ token: "legacy-t1" })
      // ... AND the file was transparently re-encrypted under v2.
      const upgraded = JSON.parse(readFileSync(file, "utf8"))
      expect(upgraded.pva1.split(":")[0]).toBe("v2")
      expect(readFileSync(file, "utf8")).not.toContain("legacy-t1")
      // Upgraded envelope still reads back.
      expect(await readSecretJson(file, null)).toEqual({ token: "legacy-t1" })
    } finally {
      delete process.env.PICC_VAULT_KEY
      resetVaultKey()
    }
  })

  it("old keyfile-mode envelopes (raw key bytes) still unlock AND upgrade to v2", async () => {
    const { createCipheriv, randomBytes } = await import("node:crypto")
    const dir = freshDir()
    const keyHex = randomBytes(32).toString("hex")
    writeFileSync(join(dir, "picc-vault.key"), keyHex)
    resetVaultKey()
    try {
      const k = Buffer.from(keyHex, "hex")
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", k, iv)
      const ct = Buffer.concat([cipher.update(JSON.stringify({ token: "legacy-kf" }), "utf8"), cipher.final()])
      const oldPayload = `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`
      const file = join(dir, "legacy-kf.json")
      writeFileSync(file, JSON.stringify({ pva1: oldPayload }))

      expect(await readSecretJson(file, null)).toEqual({ token: "legacy-kf" })
      const upgraded = JSON.parse(readFileSync(file, "utf8"))
      expect(upgraded.pva1.split(":")[0]).toBe("v2")
      expect(await readSecretJson(file, null)).toEqual({ token: "legacy-kf" })
    } finally {
      resetVaultKey()
    }
  })
})
