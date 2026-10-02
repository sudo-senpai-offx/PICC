// WS-7 T17 — the four-venue registry.
//
// AC-036:1058's verification clause is "assert the venue list equals exactly the
// four", and D9:173's consequence is "A venue not in this list gets no lifecycle
// code." Both are properties of a LIST, so they are tested against the list and
// against the lookup that reaches it — a count assertion alone would pass if a
// name were swapped, and a name assertion alone would pass if an entry were
// duplicated.

import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  CCXT_CEREMONY_VENUE_CLASS,
  CCXT_LIFECYCLE_VENUE_COUNT,
  CCXT_LIFECYCLE_VENUES,
  VENUE_NOT_IN_THE_FOUR_CODE,
  ccxtLifecycleVenue,
  ccxtVenueEnabled,
  ccxtVenueEnablementReadout
} from "../services/venues/ccxtVenues.mjs"

const CATALOG = fileURLToPath(new URL("../../src/lib/streamCatalog.ts", import.meta.url))
const SEAM = fileURLToPath(new URL("../services/ccxtOrdering.mjs", import.meta.url))
const CEREMONY_STORE = fileURLToPath(new URL("../services/commandCentre/ceremonyState.mjs", import.meta.url))

const clearEnableEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PICC_CCXT_VENUE_ENABLED_")) delete process.env[key]
  }
}

describe("T17 — the venue list is EXACTLY four, and a fifth cannot be added quietly", () => {
  it("the count is four, declared rather than derived from array length", () => {
    // Both halves asserted: the exported figure is what consumers read, and it
    // has to agree with the array. If they ever disagree, the figure is the lie.
    expect(CCXT_LIFECYCLE_VENUE_COUNT).toBe(4)
    expect(CCXT_LIFECYCLE_VENUES).toHaveLength(4)
    expect(CCXT_LIFECYCLE_VENUE_COUNT).toBe(CCXT_LIFECYCLE_VENUES.length)
  })

  it("the four are Kraken, Coinbase, Binance and Bybit, in the spec's order", () => {
    expect(CCXT_LIFECYCLE_VENUES.map((v) => v.id)).toEqual(["kraken", "coinbase", "binance", "bybit"])
  })

  it("ids are unique and the array is frozen, so neither can drift at runtime", () => {
    const ids = CCXT_LIFECYCLE_VENUES.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.isFrozen(CCXT_LIFECYCLE_VENUES)).toBe(true)
    for (const v of CCXT_LIFECYCLE_VENUES) expect(Object.isFrozen(v)).toBe(true)
  })

  it("every venue declares the same four legs, the same market type and one ceremony class", () => {
    for (const v of CCXT_LIFECYCLE_VENUES) {
      expect([...v.legs]).toEqual(["place", "amend", "cancel", "close"])
      expect(v.defaultType).toBe("spot")
      expect(v.ceremonyVenueClass).toBe(CCXT_CEREMONY_VENUE_CLASS)
      expect(v.envSuffix).toBe(v.id.toUpperCase())
    }
  })

  it("an unlisted id resolves to null, never to a synthesised descriptor", () => {
    for (const id of ["hyperliquid", "okx", "kucoin", "etoro", "plus500", "", "   ", null, undefined, 42]) {
      expect(ccxtLifecycleVenue(id), `${JSON.stringify(id)} must not resolve to a venue`).toBeNull()
    }
    // A near-miss on a real id is also null — the lookup is exact after
    // normalisation, not prefix-based.
    expect(ccxtLifecycleVenue("kraken2")).toBeNull()
    expect(ccxtLifecycleVenue("kraken ").id).toBe("kraken")
  })

  it("the not-in-the-four code is a stable, greppable string", () => {
    expect(VENUE_NOT_IN_THE_FOUR_CODE).toBe("venue-rail:venue-not-in-the-four")
    expect(VENUE_NOT_IN_THE_FOUR_CODE).toContain(":")
  })
})

describe("T17 — per-venue enablement is independent, defaults closed, and reverts by one variable", () => {
  it("with nothing set, every venue is disabled", () => {
    clearEnableEnv()
    for (const v of CCXT_LIFECYCLE_VENUES) expect(ccxtVenueEnabled(v.id)).toBe(false)
  })

  it("one variable enables exactly one venue — the bisect at spec :1352", () => {
    clearEnableEnv()
    process.env.PICC_CCXT_VENUE_ENABLED_BINANCE = "1"
    try {
      expect(ccxtVenueEnabled("binance")).toBe(true)
      expect(ccxtVenueEnabled("kraken")).toBe(false)
      expect(ccxtVenueEnabled("coinbase")).toBe(false)
      expect(ccxtVenueEnabled("bybit")).toBe(false)
      const readout = Object.fromEntries(ccxtVenueEnablementReadout().map((r) => [r.id, r.enabled]))
      expect(readout).toEqual({ kraken: false, coinbase: false, binance: true, bybit: false })
    } finally {
      clearEnableEnv()
    }
  })

  it("reverting is the same variable removed — no second source of truth to forget", () => {
    clearEnableEnv()
    process.env.PICC_CCXT_VENUE_ENABLED_BYBIT = "1"
    expect(ccxtVenueEnabled("bybit")).toBe(true)
    delete process.env.PICC_CCXT_VENUE_ENABLED_BYBIT
    expect(ccxtVenueEnabled("bybit")).toBe(false)
  })

  it("only the exact string \"1\" enables. A truthy parse would make the closed state reachable by accident", () => {
    clearEnableEnv()
    for (const value of ["true", "TRUE", "yes", "on", "0x1", " 1", "1 ", ""]) {
      process.env.PICC_CCXT_VENUE_ENABLED_KRAKEN = value
      expect(ccxtVenueEnabled("kraken"), `"${value}" must not enable a venue`).toBe(false)
    }
    process.env.PICC_CCXT_VENUE_ENABLED_KRAKEN = "1"
    expect(ccxtVenueEnabled("kraken")).toBe(true)
    clearEnableEnv()
  })

  it("the readout names the variable that governs each venue, so an operator is not left guessing", () => {
    clearEnableEnv()
    const readout = ccxtVenueEnablementReadout()
    expect(readout).toHaveLength(4)
    for (const row of readout) {
      expect(row.envVar).toBe(`PICC_CCXT_VENUE_ENABLED_${row.id.toUpperCase()}`)
      expect(row.ceremonyVenueClass).toBe(CCXT_CEREMONY_VENUE_CLASS)
      expect(Object.prototype.hasOwnProperty.call(row, "unlock")).toBe(false)
    }
  })
})

describe("T17 — the registry adds NO venue class to WS-3's frozen ceremony list", () => {
  it("the ceremony store's known classes are exactly what it declared before T17", () => {
    const src = readFileSync(CEREMONY_STORE, "utf8")
    const match = /export const KNOWN_VENUE_CLASSES = \[([^\]]*)\]/.exec(src)
    expect(match, "KNOWN_VENUE_CLASSES must still be a literal array this test can read").not.toBeNull()
    const classes = match[1]
      .split(",")
      .map((s) => s.replace(/["'\s]/g, ""))
      .filter(Boolean)
    // A fifth class here would widen a store whose unknown-class path is a NAMED
    // deny (ceremonyState.mjs:123). Widening it is not this task's to do, and one
    // class for the crypto-spot rail is the honest granularity: the per-venue bit
    // in ccxtVenues.mjs is the finer grain.
    expect(classes).toEqual(["ccxt-crypto", "hyperliquid-perps"])
    expect(classes).toContain(CCXT_CEREMONY_VENUE_CLASS)
  })
})

describe("T17 — the catalog consistency check, reported rather than assumed", () => {
  it("streamCatalog.ts is where the check reads from, so a missing file fails loudly", () => {
    expect(existsSync(CATALOG)).toBe(true)
  })

  it("the per-venue catalog PRESENCE set is pinned to exactly what the tree holds today", () => {
    // T17 measured this rather than assuming it, and the measurement is the
    // deliverable: two of the four venues have a stream-catalog row and two do
    // not. The absent ones are recorded in ccxtVenues.mjs's own `note`, and NO row
    // was invented for them — D26's discipline is that the catalog states what
    // PICC can evidence, and a row added to make a test tidy would be a claim
    // PICC cannot source.
    //
    // Pinning the exact set means a later task that adds a Kraken row has to move
    // this pin deliberately, at the same place it has to justify the new row.
    const src = readFileSync(CATALOG, "utf8")
    const ids = CCXT_LIFECYCLE_VENUES.map((v) => v.id)
    const present = ids.filter((id) => new RegExp(`\\{ id: "${id}"`).test(src))
    const absent = ids.filter((id) => !present.includes(id))
    expect(present).toEqual(["binance", "bybit"])
    expect(absent).toEqual(["kraken", "coinbase"])
  })

  it("every catalog row that DOES exist for a lifecycle venue carries a factual note and no status claim", () => {
    // D26 deleted the licensing/KYC claim class from this catalog under
    // ws7RegulatoryClaimGuard.test.mjs. This asserts the narrower, per-venue
    // version: the two rows T17 depends on say what the entry IS and nothing about
    // what it is licensed or authorised to do. The guard still scans the whole tree;
    // this is the check that names which rows T17 read.
    const src = readFileSync(CATALOG, "utf8")
    for (const id of ["binance", "bybit"]) {
      const line = src.split(/\r?\n/).find((l) => l.includes(`{ id: "${id}"`))
      expect(line, `${id} must have a catalog row`).toBeDefined()
      expect(line).toMatch(/note: "/)
      for (const word of ["licensed", "licence", "license", "registered", "registration", "authorised", "authorized", "regulated", "accredited", "chartered", "supervised", "recognised", "recognized", "approved", "KYC"]) {
        expect(line.toLowerCase(), `${id}'s catalog note must not contain "${word}"`).not.toContain(word.toLowerCase())
      }
    }
  })

  it("no venue descriptor asserts a regulatory, licensing or authorized status", () => {
    // The scan is over the DATA a surface would render, not over the module's
    // source. ccxtVenues.mjs's header names the claim class in order to forbid it,
    // and scanning source text for those words would flag the prohibition — the
    // same defect `absence-scope.mjs:33-42` documents when it stores its patterns
    // as strings so its own scanner does not count itself. The claim would live in
    // a descriptor's `note`, `label` or `kind`; that is what is checked here, and
    // `ws7RegulatoryClaimGuard.test.mjs` independently scans the whole tracked tree.
    const rendered = JSON.stringify(CCXT_LIFECYCLE_VENUES).toLowerCase()
    for (const word of ["licensed", "licence", "license", "authorised", "authorized", "regulated", "accredited", "chartered", "supervised", "recognised", "recognized", "kyc"]) {
      expect(rendered, `no venue descriptor may contain "${word}"`).not.toContain(word)
    }
    // And the only descriptive claim is `kind`, which the tree can evidence.
    for (const v of CCXT_LIFECYCLE_VENUES) {
      expect(["spot", "derivatives"]).toContain(v.kind)
      expect(v.note.length).toBeGreaterThan(0)
    }
  })

  it("every `kind` is DERIVED FROM the catalog row, not merely drawn from a vocabulary", () => {
    // THE GAP THIS CLOSES. The assertion above — `expect(["spot","derivatives"])
    // .toContain(v.kind)` — is a VOCABULARY check. It passes for a kind that is
    // well-formed and wrong, which is exactly how the registry shipped Binance as
    // `derivatives` while justifying it by citing `streamCatalog.ts:122,125`: line
    // 122 is Binance's row and it reads "Spot exchange." Only line 125, Bybit's,
    // says "Derivatives exchange." The claim was checkable against a named source
    // and it was checked against nothing.
    //
    // So the kind is now read back OUT of the catalog and compared. A venue whose
    // row says "Spot exchange" must be filed `spot`, whatever the registry would
    // prefer, and the two ids cannot silently diverge again.
    const src = readFileSync(CATALOG, "utf8")
    const rowKind = (id) => {
      const line = src.split(/\r?\n/).find((l) => l.includes(`{ id: "${id}"`))
      if (line === undefined) return null
      const note = (line.match(/note:\s*"([^"]*)"/) ?? [])[1] ?? ""
      if (/derivatives exchange/i.test(note)) return "derivatives"
      if (/spot exchange/i.test(note)) return "spot"
      return "unclassified"
    }

    // The two rows that exist, pinned by hand as well as derived, so a change to
    // the catalog that flips a venue's classification fails HERE first.
    expect(rowKind("binance")).toBe("spot")
    expect(rowKind("bybit")).toBe("derivatives")

    for (const v of CCXT_LIFECYCLE_VENUES) {
      const fromCatalog = rowKind(v.id)
      if (fromCatalog === null) {
        // No row: `kind` cannot be evidenced, so it must not be asserted as if it
        // could. Spot is the rail this lifecycle actually places on.
        expect(v.kind, `${v.id} has no catalog row, so its kind must be the rail's own 'spot'`).toBe("spot")
        continue
      }
      expect(fromCatalog, `${v.id}'s catalog note is not classifiable - fix the note or the registry`).not.toBe("unclassified")
      expect(v.kind, `${v.id}: registry says '${v.kind}' but the catalog row says '${fromCatalog}'`).toBe(fromCatalog)
    }
  })
})

describe("T17 — the registry does not reintroduce a row WS-7 T7b removed", () => {
  it("none of the four lifecycle venues is one of the 13 rows T7b removed under D20 record 0019", () => {
    // The removed ids are READ from the record's own tables rather than restated
    // here, so this test cannot quietly pass against a list it no longer matches.
    // D26 removed the CLAIMS; T7b (record 0019) removed the ROWS. Both matter
    // here: a lifecycle venue drawn from the removed set would be reintroducing a
    // row a later owner decision deleted.
    const recordPath = fileURLToPath(new URL("../../../../docs/trading-logic/changelog/entries/0019-CATALOG_VENUE_REMOVAL-v1-to-v2.md", import.meta.url))
    expect(existsSync(recordPath), "the T7b removal record must exist — it is the audit trail this claim rests on").toBe(true)
    // The record holds TWO row tables — 13 removed and 7 added — and they share a
    // `| Row id |` first column. Parsing every table would compare the lifecycle
    // venues against the REPLACEMENT rows too, which is a different claim. So the
    // removed table is selected by its own header ("Note text deleted from the
    // row") and read to the first blank line, which is what makes this test
    // self-updating against the record rather than a restatement of it.
    const lines = readFileSync(recordPath, "utf8").split(/\r?\n/)
    const headerAt = lines.findIndex((l) => /^\|\s*Row id\s*\|.*Note text deleted from the row\s*\|/.test(l))
    expect(headerAt, "the removal record must carry a table of deleted row notes").toBeGreaterThan(-1)
    const removed = []
    for (const line of lines.slice(headerAt + 2)) {
      if (line.trim() === "") break
      const m = /^\|\s*([a-z0-9][a-z0-9-]*)\s*\|/.exec(line)
      if (m) removed.push(m[1])
    }
    expect(removed.length, "the record's removed-row table must hold exactly the 13 rows T7b removed").toBe(13)
    for (const v of CCXT_LIFECYCLE_VENUES) {
      expect(removed, `${v.id} must not be one of the rows T7b removed`).not.toContain(v.id)
    }
  })

  it("the four lifecycle venues are all present in the CURRENT catalog file or recorded as absent", () => {
    // 8 of the 13 removals were p2p-lending and 5 were exchange; the surviving
    // exchange rows include two of T17's four. The other two have no row, and
    // ccxtVenues.mjs says so in each one's `note` rather than inventing an entry.
    const src = readFileSync(CATALOG, "utf8")
    for (const v of CCXT_LIFECYCLE_VENUES) {
      const inCatalog = src.includes(`{ id: "${v.id}"`)
      if (!inCatalog) {
        expect(v.note, `${v.id} has no catalog row, so its registry note must say so`).toMatch(/No stream-catalog row/)
      }
    }
  })
})

describe("T17 — the registry agrees with the seam it configures", () => {
  it("each venue's envSuffix is the suffix the ordering seam derives from the exchange id", () => {
    // If these diverged, enabling a venue would read a different variable than
    // the one the readout names, and a credential pair would be configured under a
    // suffix nothing reports. The seam's own derivation is re-implemented here
    // from its source rather than trusted, so the test fails if either side moves.
    const seam = readFileSync(SEAM, "utf8")
    expect(seam).toMatch(/function envKey\(exchangeId\)[\s\S]{0,220}?\.toUpperCase\(\)/)
    expect(seam).toMatch(/\.replace\(\/\[\^A-Z0-9\]\/g, "_"\)/)
    for (const v of CCXT_LIFECYCLE_VENUES) {
      expect(v.envSuffix).toBe(v.id.toUpperCase())
    }
  })

  it("the credential variables a venue needs are the ones the seam documents, per venue", () => {
    // Sanity on the configuration each venue inherits: the CEX-style pair the seam
    // reads for all four of these ids. No secret is read, written or named here —
    // only the variable NAMES the seam already documents in its own header.
    const seam = readFileSync(SEAM, "utf8")
    expect(seam).toContain("PICC_CCXT_APIKEY_<EX>")
    expect(seam).toContain("PICC_CCXT_SECRET_<EX>")
    for (const v of CCXT_LIFECYCLE_VENUES) {
      expect(`PICC_CCXT_APIKEY_${v.envSuffix}`).toMatch(/^PICC_CCXT_APIKEY_[A-Z]+$/)
      expect(`PICC_CCXT_SECRET_${v.envSuffix}`).toMatch(/^PICC_CCXT_SECRET_[A-Z]+$/)
    }
  })
})
