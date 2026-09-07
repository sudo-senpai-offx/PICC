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
