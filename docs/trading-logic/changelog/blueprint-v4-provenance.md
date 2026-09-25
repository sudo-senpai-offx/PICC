# Blueprint v4.0 — provenance record

```text
source:        owner-supplied "Master Blueprint v4.0"
provenance:    UNVERIFIED
received:      2026-09-25 (owner, in conversation)
checked_in:    false
manifest_path: docs/specs/PICC_TRADING_SUITE_WS6_TERMINAL_UI_REBUILD_v1.md (WS-6 decisions D1-D20 only)
```

## What `UNVERIFIED` means here

The Blueprint v4.0 document is **not present in this repository**. The WS-6
spec records the decisions the owner ratified from it (D1–D20), but the source
document itself has never been committed, checksummed, or read by an
implementation agent.

`provenance: UNVERIFIED` therefore states three things at once:

1. The decisions in the WS-6 spec are owner-authoritative. They are implemented.
2. The **document** they were derived from is not citable, diffable, or
   reproducible by a third party.
3. The statistics the blueprint contains (the SEC reference, the wallet-count
   and dollar-volume figures) have **never been verified** from this repository
   and are not load-bearing in any code path.

## What this blocks

Per WS-6 AC-015 and honesty note 4:

- No implementation may claim "the blueprint was migrated". Only "the owner-ratified
  decisions D1–D20 are implemented".
- T12 must carry this `UNVERIFIED` marker forward rather than closing AC-015 on a
  clean pass.
- If a later claim needs the blueprint's own text — for example to resolve an
  internal contradiction between two of its sections — that work is blocked until
  the document is checked in.

## Known internal tension (recorded, not resolved)

The blueprint is understood to demote binary trading in its Part 0 and Part 9
while a large share of its Parts 2, 4, and 8 remain binary mechanics. The owner
stated these tensions are intentional and explained, and that the blueprint is
strictly normative with bounded copilot latitude. This record captures the
tension so a future reader does not mistake it for an implementation defect —
and does not "fix" it unilaterally.

## How to close this record

Commit the source document (or a checksummed export of it), then set:

```text
provenance: VERIFIED
checked_in: true
manifest_path: <path to the committed document>
```

and add the checksum. Until then this file is the canonical statement of the
gap.
