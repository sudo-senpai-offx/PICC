// WS-7 T17 — the four-venue registry for the CCXT full order lifecycle.
//
// D9:166-173 names the venue list as EXACTLY four: Kraken, Coinbase, Binance and
// Bybit, and AC-036:1058's verification is "assert the venue list equals exactly
// the four". So the count is a first-class export rather than `venues.length` at
// each use site: a fifth entry added to the array below changes the number every
// consumer reads, and `ccxtVenues.test.mjs` pins both the figure and the names.
//
// WHY THESE FOUR AND NOT THE CATALOG. D9's "Why" is that four prove the contract
// is venue-agnostic without spreading thinness across the catalog, and D9's
// "Consequence" is "A venue not in this list gets no lifecycle code." This file is
// therefore CLOSED: `ccxtLifecycleVenue` returns null for anything not listed, and
// every leg in `ccxtVenueLifecycle.mjs` refuses an unlisted id BEFORE the rails
// run. There is no "other exchanges may be added later" path in the code, only in
// the spec's word "later".
//
// PER-VENUE ADAPTER CONFIGURATION. Spec :1348 asks for "new per-venue adapter
// configuration". What each venue actually needs from PICC is narrow and is
// declared here once: the env-key suffix its credentials are read under (the seam
// already resolves `PICC_CCXT_APIKEY_<SUFFIX>` / `..._SECRET_<SUFFIX>` from an
// exchange id, so this is the SAME suffix it derives, carried explicitly so a
// mismatch between the two is visible rather than implicit), the ceremony venue
// class the rail reads, the market type the seam instance is built with, and the
// per-venue enablement bit.
//
// NO REGULATORY, LICENSING OR "AUTHORIZED" CLAIM APPEARS IN THIS FILE, about any
// venue, and none may be added. D26 deleted that claim class from the stream
// catalog under `ws7RegulatoryClaimGuard.test.mjs`, whose ALLOWLIST is an exact
// per-file occurrence count — so a claim written here would be caught, which is
// the intended behaviour rather than an inconvenience. What each venue IS, in the
// sense this repository can evidence from its own tree, is stated as `kind` and
// nothing more is asserted about it.
//
// ENABLEMENT IS PER-VENUE AND DEFAULTS CLOSED. Spec :1352's bisect is "One venue
// at a time; each is independently enable-able and revertible behind its ceremony
// gate." The bit is read from `PICC_CCXT_VENUE_ENABLED_<SUFFIX>` and defaults to
// `false`, so production is dark for all four and enabling one venue is a
// single-variable change that reverting one variable undoes. The bit is a
// NECESSARY conjunct of the ceremony gate and never a substitute for it: a venue
// with `enabled: true` and no ceremony unlock still fails closed, which is the
// direction that matters.

/**
 * D9/AC-036: the venue count is four, declared rather than derived.
 *
 * `ccxtVenues.test.mjs` asserts `CCXT_LIFECYCLE_VENUES.length === 4` AND the
 * exact name list, so a fifth entry fails on BOTH. A count-only assertion would
 * pass if a name were silently swapped; a name-only assertion would pass if an
 * entry were duplicated.
 */
export const CCXT_LIFECYCLE_VENUE_COUNT = 4

/**
 * The ceremony venue class every one of the four reads.
 *
 * `ceremonyState.mjs:21` declares `KNOWN_VENUE_CLASSES = ["ccxt-crypto",
 * "hyperliquid-perps"]`. `ccxt-crypto` is the class these venues were already
 * filed under, so this task adds NO venue class to that frozen list — adding four
 * would widen a store whose unknown-class path is a named deny
 * (`ceremonyState.mjs:123`), and widening it is not this task's to do. One class
 * for the crypto-spot rail is also the honest granularity: a ceremony unlock is a
 * statement about a rail, and the per-venue bit below is the finer grain.
 */
export const CCXT_CEREMONY_VENUE_CLASS = "ccxt-crypto"

/** What PICC can evidence about each venue from this repository's own tree. */
export const VENUE_KIND = Object.freeze({
  SPOT: "spot",
  DERIVATIVES: "derivatives"
})

const venue = (id, label, kind, note) =>
  Object.freeze({
    id,
    label,
    kind,
    /** Factual, in-tree-only. No status claim about the venue itself. */
    note,
    /** The env suffix the ordering seam derives from the exchange id. */
    envSuffix: id.toUpperCase(),
    ceremonyVenueClass: CCXT_CEREMONY_VENUE_CLASS,
    /** Every leg on this rail is spot; the perps rail is `hyperliquidPerps`. */
    defaultType: "spot",
    /** The four lifecycle legs, in the order the lifecycle walks them. */
    legs: Object.freeze(["place", "amend", "cancel", "close"])
  })

/**
 * D9:169 — the venue list. Exactly four, in the spec's order.
 *
 * `kind` records what this repository's OWN catalog says the id is, read from
 * `streamCatalog.ts` at the lines cited per venue below. It is deliberately NOT a
 * claim about what the venue offers in the world — only what this tree records.
 *
 * The first draft of this block filed Binance as `derivatives` and justified it by
 * citing `streamCatalog.ts:122,125` "as recording them as such". Line 122 is
 * Binance's row and it reads "Spot exchange."; only line 125, Bybit's, reads
 * "Derivatives exchange." So the citation was false for one of the two venues it
 * covered, and a false citation in a field whose whole purpose is to be checkable
 * against a named source is worse than no citation. `ccxtVenues.test.mjs` now reads
 * the catalog rows and asserts each `kind` against them, so the two cannot drift
 * apart again without a test failing.
 *
 * The bybit row is still `derivatives` while this rail places SPOT orders
 * (`defaultType: "spot"`, above). That is not a contradiction being papered over: a
 * venue can be catalogued for its derivatives surface and be traded spot on this
 * rail. The note says so, so nobody reads the row as a derivatives capability.
 */
export const CCXT_LIFECYCLE_VENUES = Object.freeze([
  venue("kraken", "Kraken", VENUE_KIND.SPOT, "Spot lifecycle rail. No stream-catalog row exists for this id; see T17's catalog finding."),
  venue("coinbase", "Coinbase", VENUE_KIND.SPOT, "Spot lifecycle rail. No stream-catalog row exists for this id; see T17's catalog finding."),
  venue("binance", "Binance", VENUE_KIND.SPOT, "Spot lifecycle rail. Catalogued `spot` at streamCatalog.ts:122 ('Spot exchange.'); this rail agrees with the catalog."),
  venue("bybit", "Bybit", VENUE_KIND.DERIVATIVES, "Spot lifecycle rail, and it places spot orders. Catalogued `derivatives` at streamCatalog.ts:125 ('Derivatives exchange.'); the rail is spot while the catalog row describes the venue's derivatives surface. No derivatives capability is claimed or used here.")
])

/**
 * Look one venue up by id. `null` for anything not on the list.
 *
 * Normalising to lower case before the lookup is what lets a caller pass the
 * catalog's `id` field verbatim. An unknown id is `null` rather than a
 * synthesised descriptor, so a fifth venue cannot be reached by spelling.
 */
export function ccxtLifecycleVenue(id) {
  const wanted = String(id ?? "").trim().toLowerCase()
  if (!wanted) return null
  return CCXT_LIFECYCLE_VENUES.find((v) => v.id === wanted) ?? null
}

/** The stable, reason-bearing code for an id that is not one of the four. */
export const VENUE_NOT_IN_THE_FOUR_CODE = "venue-rail:venue-not-in-the-four"

/**
 * Is this one venue independently enabled?
 *
 * Default `false`, so with no env set at all every venue is dark and the whole
 * lifecycle is unreachable. The variable name is derived from the venue's own
 * `envSuffix`, which is the suffix the ordering seam already reads that venue's
 * credentials under, so enabling a venue and configuring its credentials are two
 * different variables that cannot be confused for one another.
 *
 * Anything other than the exact string "1" reads as disabled: a truthy parse of
 * `"true"`/`"yes"`/`"0x1"` would make the closed state reachable by accident.
 */
export function ccxtVenueEnabled(venueId) {
  const v = ccxtLifecycleVenue(venueId)
  if (!v) return false
  return process.env[`PICC_CCXT_VENUE_ENABLED_${v.envSuffix}`] === "1"
}

/**
 * Every venue's enablement bit, for a governance surface.
 *
 * Reads the same variables as `ccxtVenueEnabled`, so the readout cannot disagree
 * with the rail. `unlock` is NOT read here: whether the ceremony class is
 * unlocked is the ceremony store's answer and is reported by
 * `ccxtLifecycleRails.mjs`, which is the only place a leg's ceremony state is
 * decided.
 */
export function ccxtVenueEnablementReadout() {
  return CCXT_LIFECYCLE_VENUES.map((v) => ({
    id: v.id,
    label: v.label,
    kind: v.kind,
    ceremonyVenueClass: v.ceremonyVenueClass,
    enabled: ccxtVenueEnabled(v.id),
    envVar: `PICC_CCXT_VENUE_ENABLED_${v.envSuffix}`
  }))
}
