/**
 * WS-6 T3 — secret redaction (AC-017, AC-014).
 *
 * The terminal may render readiness and metadata; it may never render a secret.
 * WS-5 shipped a real credential leak — a live Hyperliquid wallet key pair
 * reached the e2e server because the repo `.env` was loaded into the test env —
 * so this is a P0 boundary expressed as an explicit deny-list rather than
 * "remember to skip the fields we know about".
 *
 * The rule is deny-by-default on credential-shaped KEYS plus a value-pattern
 * sweep for raw key material, applied recursively. Non-secret operational fields
 * (venueId, integrityStatus, freshnessMs, cache timestamps) must survive intact,
 * so this deliberately avoids over-broad substrings such as a bare "token"
 * that would also redact a legitimate `cacheExpiresAt`.
 */

export const REDACTED = "[redacted]"

const DENY_EXACT = new Set([
  "apikey",
  "apisecret",
  "secretkey",
  "clientsecret",
  "secret",
  "privatekey",
  "privatekeys",
  "passphrase",
  "mnemonic",
  "seed",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "bearer",
  "credentials",
  "walletaddress"
])

/** Substrings that identify a credential key even when wrapped in a prefix. */
const DENY_CONTAINS = ["privatekey", "walletaddress", "mnemonic", "passphrase", "secretkey", "apikey"]

/** Raw key material: 0x-prefixed and bare 64-hex private keys. */
const RAW_KEY = /0x[0-9a-fA-F]{64}|(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function isSecretKey(key: string): boolean {
  const n = normalizeKey(key)
  if (DENY_EXACT.has(n)) return true
  return DENY_CONTAINS.some((token) => n.includes(token))
}

/** Replaces raw key material inside an otherwise non-secret string. */
function scrubString(value: string): string {
  return value.replace(RAW_KEY, REDACTED)
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubString(value)
  if (value == null || typeof value !== "object") return value
  // Guard against cycles: a status payload must never hang the renderer.
  if (seen.has(value as object)) return REDACTED
  seen.add(value as object)

  if (Array.isArray(value)) return value.map((v) => walk(v, seen))

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? REDACTED : walk(v, seen)
  }
  return out
}

/**
 * Returns a redacted COPY. The input is never mutated, so a caller cannot
 * accidentally render the original by holding a stale reference.
 */
export function redactSecrets<T>(input: T): T {
  return walk(input, new WeakSet()) as T
}

const SECRET_TEXT = /0x[0-9a-fA-F]{64}|(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/
const SECRET_ASSIGNMENT =
  /\b(api[-_ ]?key|secret[-_ ]?key|private[-_ ]?key|passphrase|mnemonic|password|access[-_ ]?token|refresh[-_ ]?token)\b\s*[:=]/i

/**
 * True when a rendered string still carries secret material. Used by the T12
 * guard to assert no terminal output or cache entry contains a secret.
 */
export function containsSecretMaterial(text: string): boolean {
  if (SECRET_TEXT.test(text)) return true
  return SECRET_ASSIGNMENT.test(text)
}
