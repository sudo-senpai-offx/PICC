// The ceremony-action gate (WS-7).
//
// WHY THIS FILE EXISTS. `unlockVenueClass()` in ceremonyState.mjs refuses every
// non-test caller with `ceremony:deny:ceremony-action-unreachable`, and gives the
// reason: "the gate/route modules own the unlock check". It was not missing ceremony
// logic — it was refusing to let an unaudited caller decide. This module is that
// owning gate. It is the ONLY caller permitted to pass `authorised: true`.
//
// THE RULE, deliberately narrow:
//
//     an enablement record is granted  <=>  the target rail is in SANDBOX MODE
//
// Not "the operator is allowed to", and not "the gate inputs look healthy". The rail
// being sandboxed is the whole safety property. `hyperliquid-perps` is testnet-first
// by construction — hyperliquidPerps.mjs refuses to build a mainnet instance unless
// PICC_CCXT_PERPS_MAINNET_ENABLED=1 AND the ceremony record agree — so a record
// minted here cannot put real funds behind a rail. Sandbox off => still
// `ceremony:deny:gate1-short`, byte-for-byte the refusal rendered before this file
// existed. Mainnet unlock remains the unshipped gate1-constitution work, and this
// module deliberately does not attempt it.
//
// The flag resolution mirrors ccxtOrdering.mjs `ccxtKeysForExchange` exactly: an
// explicit per-venue `PICC_CCXT_SANDBOX_<VENUE>="1"` wins, otherwise the global
// `PICC_CCXT_SANDBOX="1"` applies. Only the exact string "1" counts, so a typo or a
// blank value leaves the rail sandboxed=false and therefore locked.

import { KNOWN_VENUE_CLASSES, unlockVenueClass } from "./ceremonyState.mjs"

/** venue class -> the env var that sandboxes that rail. */
const SANDBOX_FLAG = Object.freeze({
  "hyperliquid-perps": "PICC_CCXT_SANDBOX_HYPERLIQUID",
  "ccxt-crypto": "PICC_CCXT_SANDBOX"
})

const GLOBAL_FLAG = "PICC_CCXT_SANDBOX"

/**
 * Is this rail in sandbox mode? Reported rather than asserted, so the route can tell
 * the operator WHICH flag to set instead of only that it refused.
 *
 * @returns {{ sandbox: boolean, varName: string|null, source: string|null }}
 */
export function sandboxStateFor(venueClass) {
  const varName = SANDBOX_FLAG[venueClass]
  if (!varName) return { sandbox: false, varName: null, source: null }
  // ccxt-crypto's sandbox flag IS the global flag — the same variable under two names.
  // Report it as "global" so an operator is never told to set a per-venue flag that
  // does not exist, and so the two never appear to be independent switches.
  const isGlobal = varName === GLOBAL_FLAG
  if (process.env[varName] === "1") return { sandbox: true, varName, source: isGlobal ? "global" : "venue" }
  if (!isGlobal && process.env[GLOBAL_FLAG] === "1") return { sandbox: true, varName: GLOBAL_FLAG, source: "global" }
  return { sandbox: false, varName, source: null }
}

/**
 * Grant the ceremony enablement record — the single audited door.
 *
 * Fails CLOSED in every case, with a named reason rather than a generic throw:
 *   - unknown venue class            -> ceremony:reject:unknown-venue-class
 *   - store unhealthy                -> ceremony state store: <reason>
 *   - rail not in sandbox mode       -> ceremony:deny:gate1-short (unchanged from today)
 *
 * @param {string} venueClass
 * @param {{ by?: string, now?: number }} [opts]
 * @returns {{ venueClass: string, record: object, sandboxVar: string }}
 */
export function authoriseUnlock(venueClass, { by = "operator", now = Date.now() } = {}) {
  if (typeof venueClass !== "string" || !KNOWN_VENUE_CLASSES.includes(venueClass)) {
    throw new Error(`ceremony:reject:unknown-venue-class (${venueClass})`)
  }

  const { sandbox, varName } = sandboxStateFor(venueClass)
  if (!sandbox) {
    // Same code the ceremony readout already renders. Nothing about the mainnet
    // position changes when this refuses — that is the point of reusing the code.
    throw new Error(
      `ceremony:deny:gate1-short (${varName ?? "sandbox flag"} is not "1" — ` +
        `this rail is not sandboxed, so no enablement record can be minted)`
    )
  }

  const record = unlockVenueClass(venueClass, by, { now, authorised: true })
  return { venueClass, record, sandboxVar: varName }
}