// WS-5 T3 startup health is read-only; unavailable values stay unobserved.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { appendAudit } from "./auditTrail.mjs"
import { readSecretJson } from "../vault.mjs"
import { ccxtKeyedExchangeIds } from "../ccxtOrdering.mjs"

const TRADING_DATA_DIR = process.env.PICC_TRADING_DATA_DIR || fileURLToPath(new URL("../../data", import.meta.url))
const VENUE_DATA_DIR = process.env.PICC_AUTOMATOR_DATA_DIR || fileURLToPath(new URL("../../data", import.meta.url))
const STORE_FILES = [
  { name: "trading-credentials.json", file: join(TRADING_DATA_DIR, "trading-credentials.json") },
  { name: "venue-credentials.json", file: join(VENUE_DATA_DIR, "venue-credentials.json") }
]
const DAY_MS = 86_400_000
const DEFAULT_CCXT_VENUE = "HYPERLIQUID"
const UNREADABLE = Symbol("startup-health-unreadable")

const CCXT_NO_PAIR_REFUSAL = (exchange) => {
  const suffix = String(exchange ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
  return `ccxt ordering seam: no ${suffix} credentials configured — set either PICC_CCXT_APIKEY_${suffix} + PICC_CCXT_SECRET_${suffix} (CEX-style) or PICC_CCXT_WALLETADDRESS_${suffix} + PICC_CCXT_PRIVATEKEY_${suffix} (Hyperliquid-style) — the execution leg is inoperable without them`
}

const PERPS_RAIL_OFF =
  "perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)"

const check = (id, severity, deny, detail) => ({ id, severity, deny, detail })

const nowMsOf = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime()
  return Date.now()
}

const isoOf = (value) => new Date(nowMsOf(value)).toISOString()

async function readStore(file) {
  const present = existsSync(file)
  let value
  try {
    value = await readSecretJson(file, UNREADABLE)
  } catch {
    return { present, readable: false, value: null }
  }
  if (value === UNREADABLE) return { present, readable: false, value: null }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { present, readable: false, value: null }
  return { present, readable: true, value }
}

function credentialStoresCheck(stores) {
  const unreadable = STORE_FILES.find((entry, index) => stores[index].present && !stores[index].readable)
  if (unreadable) {
    return check(
      "credential-stores",
      "error",
      `suite:deny:credential-store-unreadable (${unreadable.name})`,
      "credential store could not be decrypted"
    )
  }
  const missing = STORE_FILES.filter((entry, index) => !stores[index].present).map((entry) => entry.name)
  if (missing.length > 0) {
    return check("credential-stores", "warning", null, `credential stores unconfigured: ${missing.join(", ")}`)
  }
  return check("credential-stores", "ok", null, "credential stores decryptable")
}

function expiryTtl() {
  const raw = process.env.PICC_CRED_EXPIRY_DAYS_EXPERTOPTION
  if (raw === undefined || String(raw).trim() === "") return { skipped: true }
  const days = Number(raw)
  if (!Number.isFinite(days) || days <= 0) return { invalid: true }
  return { days }
}

function expertoptionCheck(store, now) {
  if (!store.present) {
    return check("expertoption-expiry", "warning", null, "ExpertOption token unobserved: trading credential store unconfigured")
  }
  if (!store.readable) {
    return check("expertoption-expiry", "warning", null, "ExpertOption token unobserved: trading credential store unreadable")
  }
  const token = typeof store.value?.expertoptionToken === "string" ? store.value.expertoptionToken.trim() : ""
  if (!token) return check("expertoption-expiry", "ok", null, "ExpertOption token not configured")
  const ttl = expiryTtl()
  if (ttl.skipped) {
    return check(
      "expertoption-expiry",
      "warning",
      null,
      "ExpertOption expiry check skipped: PICC_CRED_EXPIRY_DAYS_EXPERTOPTION absent (token ****)"
    )
  }
  if (ttl.invalid) {
    return check(
      "expertoption-expiry",
      "warning",
      null,
      "ExpertOption expiry check skipped: PICC_CRED_EXPIRY_DAYS_EXPERTOPTION is invalid (token ****)"
    )
  }
  const capturedAt = Date.parse(String(store.value?.expertoptionTokenCapturedAt ?? ""))
  if (!Number.isFinite(capturedAt)) {
    return check(
      "expertoption-expiry",
      "warning",
      "suite:deny:credential-capture-date-missing (expertoption, rotation record absent — re-capture to record it)",
      "ExpertOption token present as **** but capture date is unobserved"
    )
  }
  // Compare timestamps, not a floored day count: `Math.floor(ageDays)` reported a token that is
  // 30 days and 1 hour old as "age 30" and therefore `ok` under a 30-day TTL. D6 defines expiry as
  // `capturedAt + TTL`, so compare directly and only floor for the human-readable string.
  const ageMs = now - capturedAt
  const ageDays = Math.floor(ageMs / DAY_MS)
  if (now > capturedAt + ttl.days * DAY_MS) {
    return check(
      "expertoption-expiry",
      "error",
      `suite:deny:credential-expired (expertoption, age ${ageDays} days exceeds ${ttl.days})`,
      "ExpertOption token is past the configured rotation window (token ****)"
    )
  }
  return check(
    "expertoption-expiry",
    "ok",
    null,
    `ExpertOption token age ${ageDays} days; configured TTL ${ttl.days} days (token ****)`
  )
}

function ccxtPairCheck() {
  const ids = ccxtKeyedExchangeIds()
  if (ids.length === 0) {
    return check("ccxt-pair-completeness", "warning", CCXT_NO_PAIR_REFUSAL(DEFAULT_CCXT_VENUE), "no CCXT credential pair configured")
  }
  const incomplete = []
  for (const id of ids) {
    const suffix = String(id).trim().toUpperCase().replace(/[^A-Z0-9]/g, "_")
    const apiKey = process.env[`PICC_CCXT_APIKEY_${suffix}`]
    const secret = process.env[`PICC_CCXT_SECRET_${suffix}`]
    const walletAddress = process.env[`PICC_CCXT_WALLETADDRESS_${suffix}`]
    const privateKey = process.env[`PICC_CCXT_PRIVATEKEY_${suffix}`]
    if (apiKey && !secret) {
      incomplete.push({ suffix, missing: `PICC_CCXT_SECRET_${suffix}` })
    }
    if (walletAddress && !privateKey) {
      incomplete.push({ suffix, missing: `PICC_CCXT_PRIVATEKEY_${suffix}` })
    }
  }
  if (incomplete.length > 0) {
    const first = incomplete[0]
    return check(
      "ccxt-pair-completeness",
      "warning",
      `suite:deny:credential-pair-incomplete (${first.suffix}: ${first.missing})`,
      `incomplete CCXT credential pair: ${incomplete.map((item) => `${item.suffix} missing ${item.missing}`).join("; ")}`
    )
  }
  return check(
    "ccxt-pair-completeness",
    "ok",
    null,
    `CCXT credential pairs complete for ${ids.map((id) => String(id).trim().toUpperCase().replace(/[^A-Z0-9]/g, "_")).join(", ")}`
  )
}

function perpsRailCheck() {
  const sandbox =
    process.env.PICC_CCXT_SANDBOX_HYPERLIQUID === "1" || process.env.PICC_CCXT_SANDBOX === "1"
  const mainnet = process.env.PICC_CCXT_PERPS_MAINNET_ENABLED === "1"
  if (!sandbox && !mainnet) return check("perps-rail-mode", "warning", PERPS_RAIL_OFF, "sandbox and mainnet flags are both off")
  if (sandbox) return check("perps-rail-mode", "ok", null, "sandbox/testnet mode enabled")
  return check("perps-rail-mode", "ok", null, "mainnet flag enabled; ceremony authorization remains required")
}

export async function buildStartupHealthChecks({ now = Date.now() } = {}) {
  const timestamp = nowMsOf(now)
  const stores = await Promise.all(STORE_FILES.map((entry) => readStore(entry.file)))
  return [
    credentialStoresCheck(stores),
    expertoptionCheck(stores[0], timestamp),
    ccxtPairCheck(),
    perpsRailCheck()
  ]
}

export const buildStartupHealth = buildStartupHealthChecks

let state = { version: 1, result: null }
let bootPromise = null

function cloneResult(result) {
  return result ? JSON.parse(JSON.stringify(result)) : null
}

export async function runStartupHealth({ now = Date.now() } = {}) {
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    const timestamp = nowMsOf(now)
    const checks = await buildStartupHealthChecks({ now: timestamp })
    const at = isoOf(timestamp)
    const result = { ok: !checks.some((entry) => entry.severity === "error"), at, checks, generatedAt: isoOf(timestamp) }
    // This module is read-only and ADVISORY (D5/D6): it must never be able to stop the server from
    // booting. An unwritable/full/invalid command-centre audit dir would otherwise turn a health
    // report into a hard boot gate, so a failed audit append is logged and swallowed — the readout
    // result is still cached and still served.
    try {
      appendAudit({
        site: "command-centre",
        kind: "audit:startup-health",
        data: { ok: result.ok, at: result.at, checks: result.checks, generatedAt: result.generatedAt }
      })
    } catch (error) {
      console.warn("[picc] startup-health audit append failed (readout still served):", error?.message ?? error)
    }
    state = { version: 1, result }
    return cloneResult(result)
  })()
  try {
    return await bootPromise
  } catch (error) {
    bootPromise = null
    throw error
  }
}

export function getStartupHealth() {
  return cloneResult(state.result)
}
