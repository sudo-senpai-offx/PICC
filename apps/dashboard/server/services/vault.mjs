// PICC at-rest secret vault — AES-256-GCM over node:crypto, zero runtime deps.
//
// The repo's non-negotiable rule says credentials live in a single ENCRYPTED
// store; until this module the "vault" claim was fiction — broker logins, EO
// session tokens, venue tokens and automator JWTs sat in plaintext JSON files
// under server/data. This module gives those files real at-rest encryption:
//
//   key resolution (first match, per data directory):
//     1. PICC_VAULT_KEY env value (length ≥ 8 — sha256-derived to 32B).
//        Preferred for deployments: keep it out of the data dir entirely.
//     2. Auto-generated 32-byte key at <dir-of-secret-file>/picc-vault.key,
//        mode 0600. The key is per-directory, so test tmp dirs stay hermetic
//        while every prod secret file under server/data shares one key.
//        Tradeoff documented: a full filesystem compromise reads key +
//        ciphertext together (env-key deployments avoid this).
//
//   file format (every secret file): { "pva1": "<ivB64>:<tagB64>:<ctB64>" }
//
//   migration: reads tolerate legacy plaintext JSON files (writes convert
//   them on the next save), so existing installs upgrade without data loss.
//
//   atomicity: tmp+rename writes at mode 0600, cleanup on failure.
//
// Secrets are NEVER logged and NEVER echoed by any caller — this module only
// ever round-trips values between a caller's memory and disk.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_DIR = fileURLToPath(new URL("../data", import.meta.url))
const MIN_ENV_KEY = 8

// dir -> resolved 32-byte key (cached per directory)
const keyCache = new Map()

function envKeyBytes() {
  const envKey = process.env.PICC_VAULT_KEY
  if (typeof envKey === "string" && envKey.length >= MIN_ENV_KEY) {
    return createHash("sha256").update(envKey).digest()
  }
  return null
}

async function keyFor(dir) {
  const resolvedDir = dir || DEFAULT_DIR
  const cached = keyCache.get(resolvedDir)
  if (cached) return cached
  const fromEnv = envKeyBytes()
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
  return envKeyBytes() ? "env" : "keyfile"
}

/** Test hook: drop cached keys so env/keyfile changes take effect. */
export function resetVaultKey() {
  keyCache.clear()
}

/**
 * Encrypt a UTF-8 string into "<ivB64>:<tagB64>:<ctB64>".
 * `dir` names the data directory whose key protects the payload.
 */
export async function encryptText(plain, dir = DEFAULT_DIR) {
  const k = await keyFor(dir)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", k, iv)
  const ct = Buffer.concat([cipher.update(String(plain ?? ""), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`
}

/** Decrypt a "<ivB64>:<tagB64>:<ctB64>" payload. Throws on tamper/format issues. */
export async function decryptText(payload, dir = DEFAULT_DIR) {
  const k = await keyFor(dir)
  const parts = String(payload ?? "").split(":")
  if (parts.length !== 3) throw new Error("vault: malformed payload")
  const iv = Buffer.from(parts[0], "base64")
  const tag = Buffer.from(parts[1], "base64")
  const ct = Buffer.from(parts[2], "base64")
  const decipher = createDecipheriv("aes-256-gcm", k, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
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
      return JSON.parse(await decryptText(obj.pva1, dir))
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
