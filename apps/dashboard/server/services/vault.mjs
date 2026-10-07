// PICC at-rest secret vault — AES-256-GCM over node:crypto, zero runtime deps.
//
// The repo's non-negotiable rule says credentials live in a single ENCRYPTED
// store; until this module the "vault" claim was fiction — broker logins, EO
// session tokens, venue tokens and automator JWTs sat in plaintext JSON files
// under server/data. This module gives those files real at-rest encryption:
//
//   key resolution (first match, per data directory):
//     1. PICC_VAULT_KEY env value (length ≥ 8 — the floor mirrors the
//        auth.mjs:431 password rule; shorter values are REFUSED with a named
//        error instead of silently falling back to the keyfile). The env value
//        is scrypt-stretched (parameters mirroring auth.mjs:226 — scryptSync
//        defaults, N=16384 — 32-byte output for AES-256-GCM) with a fresh
//        16-byte salt per envelope (salt size mirrors auth.mjs:463).
//        Preferred for deployments: keep it out of the data dir entirely.
//     2. Auto-generated 32-byte key at <dir-of-secret-file>/picc-vault.key,
//        mode 0600. The key is per-directory, so test tmp dirs stay hermetic
//        while every prod secret file under server/data shares one key.
//        Tradeoff documented: a full filesystem compromise reads key +
//        ciphertext together (env-key deployments avoid this).
//
//   file format (every secret file): { "pva1": "<payload>" } where payload is
//   v2 "v2:<saltB64>:<ivB64>:<tagB64>:<ctB64>". The retired v1 payload
//   "<ivB64>:<tagB64>:<ctB64>" (single-SHA256 stretch in env mode, raw keyfile
//   bytes otherwise) stays READABLE but is never written again.
//
//   migration: reads tolerate legacy plaintext JSON files (writes convert
//   them on the next save) AND v1 envelopes (a successful v1 unlock
//   transparently re-encrypts the file under v2), so existing installs
//   upgrade without data loss.
//
//   atomicity: tmp+rename writes at mode 0600, cleanup on failure.
//
// Secrets are NEVER logged and NEVER echoed by any caller — this module only
// ever round-trips values between a caller's memory and disk.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_DIR = fileURLToPath(new URL("../data", import.meta.url))
const MIN_ENV_KEY = 8 // floor mirrors the auth.mjs:431 password rule

// KDF version marker tagging every newly written payload. v1 = the retired
// single-SHA256 stretch (unsalted); v2 = scrypt over the key material with the
// envelope's salt (cost parameters identical to the auth.mjs:226 precedent).
const KDF_VERSION = "v2"
const SCRYPT_KEYLEN = 32 // AES-256-GCM needs 32B (auth stores a 64B hash instead)
const SALT_BYTES = 16 // mirrors the auth.mjs:463 salt size

// dir -> key MATERIAL (env string or keyfile bytes, never a derived key: the
// scrypt stretch runs per payload with that payload's salt, so caching a
// derived key would reuse one salt's stretch for every payload).
const keyCache = new Map()

/** Raw key material for PICC_VAULT_KEY, or null when it is unset. */
function envKeyMaterial() {
  const envKey = process.env.PICC_VAULT_KEY
  if (envKey === undefined || envKey === "") return null // unset → keyfile mode
  if (envKey.length < MIN_ENV_KEY) {
    throw new Error(
      `vault: PICC_VAULT_KEY too short — minimum ${MIN_ENV_KEY} characters (refused; floor mirrors auth.mjs password rule)`
    )
  }
  return envKey
}

async function keyMaterialFor(dir) {
  const resolvedDir = dir || DEFAULT_DIR
  const cached = keyCache.get(resolvedDir)
  if (cached) return cached
  const fromEnv = envKeyMaterial() // throws the named refusal when set-but-short
  if (fromEnv) {
    keyCache.set(resolvedDir, fromEnv)
    return fromEnv
  }
  const keyFile = join(resolvedDir, "picc-vault.key")
  try {
    const existing = (await readFile(keyFile, "utf8")).trim()
    const k = Buffer.from(existing, "hex")
    keyCache.set(resolvedDir, k)
    return k
  } catch {
    const k = randomBytes(32)
    await mkdir(resolvedDir, { recursive: true }).catch(() => {})
    await writeFile(keyFile, k.toString("hex"), { encoding: "utf8", mode: 0o600 })
    await chmod(keyFile, 0o600).catch(() => {})
    keyCache.set(resolvedDir, k)
    return k
  }
}

/** Where the active key comes from (env wins everywhere). */
export function vaultKeySource() {
  return envKeyMaterial() ? "env" : "keyfile"
}

/** Test hook: drop cached keys so env/keyfile changes take effect. */
export function resetVaultKey() {
  keyCache.clear()
}

/** v2 stretch: scrypt over the key material with the envelope's salt. */
function deriveV2(material, salt) {
  return scryptSync(material, salt, SCRYPT_KEYLEN)
}

/**
 * Retired v1 stretch — READ ONLY, kept so pre-upgrade envelopes still unlock.
 * Env mode hashed the env value with a single unsalted SHA256; keyfile mode
 * used the raw keyfile bytes. Never used for writes.
 */
function deriveV1(material) {
  return typeof material === "string" ? createHash("sha256").update(material).digest() : material
}

function gcmDecrypt(key, ivB64, tagB64, ctB64) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8")
}

/**
 * Decrypt a payload string. v2-tagged payloads use the scrypt KDF; untagged
 * 3-part payloads fall back to the retired v1 stretch (reported via
 * `viaOldKdf` so the reader can transparently re-encrypt). Anything else is
 * malformed — same error as before.
 */
async function decryptPayload(payload, dir) {
  const parts = String(payload ?? "").split(":")
  const material = await keyMaterialFor(dir)
  if (parts[0] === KDF_VERSION && parts.length === 5) {
    return { text: gcmDecrypt(deriveV2(material, Buffer.from(parts[1], "base64")), parts[2], parts[3], parts[4]), viaOldKdf: false }
  }
  if (parts.length === 3) {
    return { text: gcmDecrypt(deriveV1(material), parts[0], parts[1], parts[2]), viaOldKdf: true }
  }
  throw new Error("vault: malformed payload")
}

/**
 * Encrypt a UTF-8 string into "v2:<saltB64>:<ivB64>:<tagB64>:<ctB64>".
 * `dir` names the data directory whose key protects the payload.
 */
export async function encryptText(plain, dir = DEFAULT_DIR) {
  const material = await keyMaterialFor(dir)
  const salt = randomBytes(SALT_BYTES)
  const key = deriveV2(material, salt)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([cipher.update(String(plain ?? ""), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${KDF_VERSION}:${salt.toString("base64")}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`
}

/** Decrypt a v2 payload (or a retired v1 payload via the old-KDF fallback). Throws on tamper/format issues. */
export async function decryptText(payload, dir = DEFAULT_DIR) {
  return (await decryptPayload(payload, dir)).text
}

/**
 * Read a JSON secret file. Accepts the pva1 envelope (decrypts) OR legacy
 * plaintext JSON (migration-on-read). Missing/unreadable/tampered files
 * return `fallback` — never throw into callers that treat files as optional.
 */
export async function readSecretJson(file, fallback = null) {
  const dir = dirname(file)
  let raw
  try {
    raw = await readFile(file, "utf8")
  } catch {
    return fallback
  }
  try {
    const obj = JSON.parse(raw.trim())
    if (obj && typeof obj === "object" && typeof obj.pva1 === "string") {
      try {
        const { text, viaOldKdf } = await decryptPayload(obj.pva1, dir)
        if (viaOldKdf) {
          // Owner-approved auto-upgrade: a successful v1 unlock transparently
          // re-encrypts the file under v2. Best-effort — a failed rewrite must
          // never break the read contract, so the old envelope is kept.
          try {
            await writeSecretJson(file, JSON.parse(text))
          } catch {
            // keep the old envelope; the value itself already unlocked fine
          }
        }
        return JSON.parse(text)
      } catch {
        return fallback
      }
    }
    return obj // legacy plaintext JSON
  } catch {
    return fallback
  }
}

/**
 * Write a JSON secret file as an encrypted envelope: tmp+rename, mode 0600,
 * tmp cleanup on failure. Throws on failure so callers can decide policy.
 */
export async function writeSecretJson(file, value) {
  const dir = dirname(file)
  await mkdir(dir, { recursive: true }).catch(() => {})
  const payload = await encryptText(JSON.stringify(value), dir)
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await writeFile(tmp, JSON.stringify({ pva1: payload }), { encoding: "utf8", mode: 0o600 })
    await rename(tmp, file)
    await chmod(file, 0o600).catch(() => {})
    return true
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}
