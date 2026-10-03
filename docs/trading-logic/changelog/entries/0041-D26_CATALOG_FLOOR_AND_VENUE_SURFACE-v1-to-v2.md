# 0041 - D26_CATALOG_FLOOR_AND_VENUE_SURFACE v1 -> v2

Two owner rulings for the last implementation task before the WS-7 branch is
released. Ruling 1 amends the D26 seam check's second half from an equality that
could not be satisfied into an owner-approved **floor** with recorded provenance.
Ruling 2 removes the eight venue login rows that T7b left behind in
`browserStudio.mjs`'s `SITE_INDEX`.

rule: D26_CATALOG_FLOOR_AND_VENUE_SURFACE
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0041-D26_CATALOG_FLOOR_AND_VENUE_SURFACE-v1-to-v2.md)
date: 2026-10-03
approvalDate: 2026-10-03
historicalTradesAffected: none
source: >-
  Owner instruction for this task, given 2026-10-03. Ruling 1: amend D26 to a
  floor assertion. The claims half stays exactly as strong and
  `ws7RegulatoryClaimGuard.test.mjs` remains its enforcement point; the entries
  half becomes a floor pinned to the owner-approved post-T7b count, recorded with
  the reason, the date and the ruling, asserted equal to the live count, and with
  a "a surviving claim must still have a factual row" property so the floor cannot
  become a loophole. Ruling 2: remove `luno`, `mx-global`, `hata`, `sinegy`,
  `kinetic`, `funding-circle`, `selangor-kuasa` and `pitik` from
  `browserStudio.mjs`'s `SITE_INDEX`, chasing every reference first and keeping
  historical record. Underlying decisions: **D26** (claims deleted from eight
  catalog rows, records `0001`/`0006`), **D20/T7b** (13 catalog rows removed, 7
  sourced replacements added, 2026-09-30, commit `ab2148a`, record `0019`), and
  **D2/AC-005** (ExpertOption removal, record `0016`, which emptied
  `LOGIN_HINTS`). The `SITE_INDEX` residue was raised as spec observation 1 of
  record `0040` and this entry answers it. Owner is recorded as the literal
  `WS-7+`.

## v1 -> v2

v1 recorded `catalog.claims-gone-entries-stay` as a blocking failure because its
text could not be satisfied. v2 replaces that text with a floor whose provenance
is recorded, removes the eight login rows the catalog ruling had left behind, and
re-pins the guards to the new measured truth.

reason: >-
  `scripts/ws7-seam-guard.mjs` exited 1 on one blocking check, measured 1. Its
  claims half was green; its entries half demanded that eight named catalog rows
  still be declared in `streamCatalog.ts`. T7b removed them on 2026-09-30, and
  T7b's own commit message says that removal WAS the owner's answer to the
  separate question D26 had deliberately deferred. So the check was red because
  its TEXT described a decision the owner had already superseded, not because the
  catalog was wrong. A guard whose prose outlives the ruling it encodes is a
  guard that will be "fixed" by reverting an owner decision, which is the most
  expensive possible misreading of a red gate.

## Ruling 1 - the floor, and why 44

`streamCatalog.ts` held **50** rows immediately before T7b. T7b removed **13** and
added **7** sourced replacements, so the owner-approved post-T7b count is
`50 - 13 + 7 = 44`. The constant is not a bare integer: `D26_OWNER_APPROVED_CATALOG_FLOOR`
in `scripts/ws7-seam-probe.mjs` carries the arithmetic as a string, both id lists
(13 removed, 7 added), the source commit (`ab2148a`), the source record (this
directory's `0019-...`), the measurement date `2026-09-30`, the ruling date
`2026-10-03`, and a `supersedes` field naming what it replaced and why.

`ws7SeamGuard.test.mjs` does not take 44 on trust. It recomputes the arithmetic
from the two id lists, asserts the pin the probe used **is** the exported
constant, and asserts the live measured count equals the pin. So the pin cannot
drift from the repository without a red test.

### The three entries-side halves

| Half | Assertion | Failure it catches |
| :-- | :-- | :-- |
| B | `liveRowCount >= floor.count` | silent deletion of rows below the approved set - the failure mode the original equality existed to catch |
| C | `floor.count === liveRowCount` | a stale pin. Growth fails too, so the floor is not a ratchet |
| D | a removed venue is named in live product code only if its row exists again | a claim outliving the row that justified it |

Half D is the one that stops the floor being a loophole. A count floor says
nothing about WHICH rows survive: delete a row, add a different one, stay at 44,
and halves B and C stay green while a claim about the deleted venue is still
served. Half D closes that.

Half D is measured on comment-stripped source via this probe's own `code()`, and
`productionFiles()` excludes the detector files, `__tests__` and `*.test.*`. So a
removal record naming a venue is not a claim, and `hata` used as an arbitrary
fixture `venueId` in `venueIntegrity.test.ts` and `StatusBoundary.test.tsx` is not
a claim either. Both remain exactly as record `0019:93-99` left them.

### The floor was seen to fail

A floor that has never been seen to fail is not a floor. Raising
`D26_OWNER_APPROVED_CATALOG_FLOOR.count` to 45 in a scratch edit made the probe
report `liveRowCount 44` against a pin of 45:

```
FAIL blocking catalog.claims-gone-entries-stay   measured=1   at-most budget=0
     half: OK   no-regulatory-claim
     half: FAIL catalog-not-below-owner-approved-floor
     half: FAIL floor-pin-matches-live-count
     half: OK   no-claim-outlives-its-row
```

Both entries-side halves flipped, on their own, from a change that touched no
product code. The edit was reverted and the check returned to `measured=0`.

### Half D was also seen to fail, on real code

A synthetic probe edit proves the wiring; a live plant proves the measurement. A
live `luno` string was added to `opportunities.mjs` (a file inside
`productionFiles()`) and the gate run again:

```
FAIL blocking catalog.claims-gone-entries-stay   measured=1   at-most budget=0
     half: OK   no-regulatory-claim
     half: OK   catalog-not-below-owner-approved-floor
     half: OK   floor-pin-matches-live-count
     half: FAIL no-claim-outlives-its-row
```

Note what this shows. The floor halves stayed **green** - the catalog was still
44 rows - and only the claim-has-a-row half fired. That is precisely the
loophole a count floor opens on its own, and it is closed. The plant was removed
and `git diff` on `opportunities.mjs` is empty.

Half D also fired **unsought** during this task, on the real repository, naming
`prosper` and `peerberry` in `opportunities.mjs:45` before its scan was narrowed
to the ruling's scope. That is recorded under Residuals below rather than
suppressed.

## The claims half was not traded away

Half A is byte-identical: same four `REGULATORY_CLAIM_SHAPES`, same scan over
`productionFiles(tracked)`, same `stripped.match(...)` counting. Its shape names
are unchanged, which matters because `ws7RegulatoryClaimGuard.test.mjs` pins
ALLOWLIST occurrence counts against this file's text - changing a shape name would
have forced a count edit on the guard that owns the claims half, and that was
avoided rather than absorbed.

`ws7RegulatoryClaimGuard.test.mjs` was not edited at all. It remains the
enforcement point for the claims half and it is still 29 `it()` blocks. Its two
ALLOWLIST `reason` strings that described the probe's D26 vocabulary were left
alone as well; what they say - that a detector names the claim vocabulary and the
D26 row ids in order to assert their absence - is still true after this change.

The probe's half A is a *complementary* measurement, not a copy: four shapes
against the test's eleven-rule compositional vocabulary, existing so a claim
cannot hide in a paraphrase the narrower regex misses
(`scripts/ws7-seam-probe.mjs:320-326`). Both were green before and after.

## Ruling 2 - the eight login rows, and the full reference closure

`browserStudio.mjs` had a `SITE_INDEX` row for each of the eight. The closure was
worked out before deleting anything, by id **and** by host, then repo-wide with
`git grep`. The result is that each venue's closure was **exactly one row**:

| Venue | Line (was) | Closure found |
| :-- | --: | :-- |
| `luno` | 485 | the `SITE_INDEX` row only |
| `mx-global` | 486 | the `SITE_INDEX` row only |
| `hata` | 487 | the `SITE_INDEX` row only |
| `sinegy` | 488 | the `SITE_INDEX` row only |
| `kinetic` | 489 | the `SITE_INDEX` row only |
| `funding-circle` | 490 | the `SITE_INDEX` row only |
| `selangor-kuasa` | 491 | the `SITE_INDEX` row only |
| `pitik` | 492 | the `SITE_INDEX` row only |

This is a **smaller** closure than the `expertoption` removal had, and the
difference is worth recording rather than glossing. The previous task had to
remove a `SITE_TO_CONNECTOR` entry, a `loginPathway()` step, `LOGIN_HINTS`
entries, `PLATFORM_KINDS` entries, cooldown constants and an `isLiveStreamTab`
exemption. **None of those existed for any of these eight.** Verified, not assumed:

- `SITE_TO_CONNECTOR` (`:1739`) holds only `nft-royalties` and `defi-supply`.
- `LOGIN_HINTS` (`:3003`) is `{}` - D2/AC-005 already removed its only entry.
- `PLATFORM_KINDS` (`:534`) holds only `trading`-category venues; all eight were
  `crypto`/`p2p` and none appears.
- `EO_CAPTURE_COOLDOWN_MS` was removed by D2/AC-005; `isLiveStreamTab` was removed
  with it.
- No row of the eight had a `capture` transport, so nothing else referenced them.

`opportunities.mjs:45` also names two of the venues T7b removed (`prosper`,
`peerberry` - not among these eight). That file is **out of scope** for this
ruling: record `0019:88-90` placed it out of scope for the T7b decision and the
2026-10-03 ruling names `browserStudio`'s `SITE_INDEX`. It is left untouched and
is reported below as a residual for the owner.

### Per-venue login confidence, measured before and after

The task brief anticipated that these eight might each carry a `LOGIN_HINTS`
suppression whose loss would move confidence. **Measured, none of them did**, and
the reason is structural rather than lucky:

- `LOGIN_HINTS` is `{}`. D2/AC-005 removed its only entry (the `expertoption`
  `cookieAuth: false`), so `hint` was already `undefined` for every site in the
  tree.
- `hint = site?.id ? LOGIN_HINTS[site.id] : null` (`:3219`). With the row present
  `hint` was `undefined`; with it removed `hint` is `null`.
- `hint?.cookieAuth !== false` (`:3221`) is `true` in **both** cases, so the
  cookie branch is entered either way.
- `hintHits` (`:3222`) is `[]` in **both** cases, so the site-scoped
  **high**-confidence cookie branch at `:3223` was already unreachable for every
  site. This is why the loss is symmetric: no venue could reach `high` through a
  hint before, and none can now.

So for all eight, a bare `token` cookie reads as **medium** before and **medium**
after, `method: "cookie"`, `detail: "auth cookies: token"` - identical to a
still-recognised venue. Before-values were captured by running the real
`detectLoginState` against all eight hosts with a `token` cookie prior to the
edit; after-values are asserted per venue in `browserStudio.login.test.mjs`
against a control venue (`binance`) whose row survived, so "unchanged" has
something to be unchanged *from*.

| Venue | LOGIN_HINTS entry | Confidence before | Confidence after | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| `luno` | none | medium | medium | unchanged |
| `mx-global` | none | medium | medium | unchanged |
| `hata` | none | medium | medium | unchanged |
| `sinegy` | none | medium | medium | unchanged |
| `kinetic` | none | medium | medium | unchanged |
| `funding-circle` | none | medium | medium | unchanged |
| `selangor-kuasa` | none | medium | medium | unchanged |
| `pitik` | none | medium | medium | unchanged |

**No venue had a hint that raised confidence and no venue had one that lowered
it**, because none had a hint. No compensating rule is needed, and adding one
would have been inventing a rule to fix a problem that does not exist.

### What did change: site recognition, and the vault key for seven of eight

Two real behaviour changes, both asserted:

1. **Recognition.** `detectSite` returns the generic unknown-host profile for all
   eight. `site.id` is `null`, `category` is `"other"`, and the note reads
   "No PICC profile for this site yet." That is the intended effect of the ruling.
2. **The one-tap-login vault key.** `studioLogin` derives its credential key from
   `detected?.name` and lower-cases it (`:3575`, `:3577`). Credentials filed under
   a venue's display name are now looked up under the bare hostname. This is
   correct for a venue PICC no longer profiles, and it moves for **seven of the
   eight**:

| Venue | Key before | Key after | Moved |
| :-- | :-- | :-- | :-- |
| `luno` | `luno` | `luno.com` | yes |
| `mx-global` | `mx global` | `mxglobal.com.my` | yes |
| `hata` | `hata digital` | `hata.io` | yes |
| `sinegy` | `sinegy dax` | `sinegy.com` | yes |
| `kinetic` | `kinetic dax` | `kineticdax.com` | yes |
| `funding-circle` | `funding societies` | `fundingsocieties.com.my` | yes |
| `selangor-kuasa` | `selangor kuasa (sks)` | `selangorkuasa.com` | yes |
| `pitik` | `pitik.ai` | `pitik.ai` | **no** |

`pitik` is the exception and is asserted as its own case: its display name was
`Pitik.ai`, which lower-cases to exactly its own hostname `pitik.ai`. Its
one-tap login is genuinely unaffected. That coincidence is pinned by count, so a
future row that breaks it produces a red test rather than a silent change.

### Historical record kept, not deleted

- `browserStudio.mjs:485` - the removal is recorded in place, in the style of the
  `D2/AC-005` record above it, naming all eight and the ruling date.
- `docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md` - dated user-attributed
  operational history (2026-09-06, 2026-09-11) about Luno and Hata rails. Kept:
  it records what happened, and two of its hits are already reasoned ALLOWLIST
  entries in `ws7RegulatoryClaimGuard.test.mjs`.
- `docs/specs/*` - the WS-7 maturity spec still describes D26's original
  eight-row expectation at `:1160`. Left as the historical spec; this record is
  the supersession.
- `apps/dashboard/server/__tests__/ws7RegulatoryClaimGuard.test.mjs:830-1035` -
  ~30 deliberately claim-shaped probe strings (`"Luno is a recognised digital
  asset exchange."` and similar) that exist to prove the detector FIRES. Deleting
  them would gut the guard. Untouched.
- `infra/supabase/schema.sql:121` - a schema comment listing example platform
  values. Not production code under `productionFiles()`, and not live capability.

Every one of these is blanked by `stripComments()` before measurement, so none of
it is counted as residue. The removal record is why the removal is auditable.

## Verification measured on this change

- `npm run typecheck` - exit 0.
- `npm run test --workspace @picc/dashboard` - **5381 passed / 1 skipped / 0
  failed** (382 files: 381 passed, 1 skipped), run **three times** before commit
  and once after, identical every time. Floor was 5373; net **+8** tests.
- `node scripts/ws7-seam-guard.mjs` - `verdict pass; 0 failing check(s)`, exit 0,
  with all four D26 halves reading OK.
- `node scripts/cross-room-invariant-gate.mjs` - exit 0, `failing rooms: none`,
  over the real 22 rooms. (Invoked as `--facts-file` with facts produced by
  `collectRoomCompletionFacts()`; the gate refuses to run without facts, by
  design - a gate that cannot see the rooms cannot clear them.)
- `npm audit --audit-level=high` - exit 0; 3 moderate, **0 high / 0 critical**.
- `git diff --check` - exit 0, no whitespace errors.
- Exactly **one** tracked lockfile: `package-lock.json`.
- Nothing written under `apps/dashboard/server/data/` or `.playwright-tmp/`.
- No e2e run. Not pushed: the owner holds the single batch push, and a security
  review runs first.

### Line endings, and one self-reported slip

`.gitattributes` pins `*.mjs text eol=lf` precisely because several seam guards
read real files from disk and use `$`-anchored regexes, which cannot match on a
CRLF checkout. One edit in this task - to
`apps/dashboard/server/__tests__/browserStudio.test.mjs` - left that file with 370
CRLF terminators in the working tree, making it the only CRLF `.mjs` in the
repository. Git would have normalised it on commit (the blob diff was a clean
35/4 and `git diff --check` was already clean), so nothing incorrect would have
been committed, but a CRLF working-tree file is the exact defect
`.gitattributes` exists to prevent and it was left in place long enough to be
found and fixed rather than explained away. It was restored to LF and verified
byte-for-byte: 370 CRLF removed, 370 bytes removed, line count unchanged,
content identical modulo line terminators. The other three files with no trailing
newline (`ws7-seam-probe.mjs`, `ws7-seam-guard.mjs`, `ws7SeamGuard.test.mjs`) are
that way **at HEAD** and were left as found.

### Unit-floor delta, itemised

Net +8 (5373 -> 5381). The floor moved **up**, so nothing had to be rebased
downward.

| Change | Count |
| :-- | --: |
| Baseline (record 0040) | 5373 passed / 1 skipped |
| `ws7SeamGuard.test.mjs` - D26 describe block 5 -> 10 `it()`s: half A unchanged; floor+provenance, pin-equality and claim-has-a-row added; three mutation proofs added (claim reintroduced, rows deleted, catalog grown); the two original proofs kept | +5 |
| `browserStudio.test.mjs` - site detection split so the surviving venue and the eight removed venues are asserted separately | +1 |
| `browserStudio.login.test.mjs` - per-venue confidence-neutrality against a control venue, and the per-venue vault-key table including the `pitik` exception | +2 |
| **Total** | **5381 / 1 / 0** |

## Residuals for the owner - recorded, not acted on

1. **`opportunities.mjs:45` still names `prosper` and `peerberry`.** Both are
   T7b-removed catalog rows with no row today. It is `OPPORTUNITY_CATALOG`'s
   `d-p2p` entry, a bookkeeping suggestion already marked `verified: false` and
   `status: "needs_research"` - PICC's own opportunity vocabulary, not a claim
   about either vendor. It is out of scope for this ruling and was left alone.
   The seam probe **measures and reports** it as `widerSetResidual` without gating
   on it, so it is visible rather than hidden. Extending the ruling here is a
   one-constant change (`T7B_REMOVED_CATALOG_ROWS` in place of
   `D26_CATALOG_ROWS` in the half-D scan).
2. **`infra/supabase/schema.sql:121`** carries `'Luno', 'MX Global'` as example
   `staking_platform` values in a SQL comment. Historical, not live, and outside
   `productionFiles()`. Left.
3. **The fixture `venueId: "hata"`** in `venueIntegrity.test.ts:109,123` and
   `StatusBoundary.test.tsx:46,47,70` names a removed venue. Record `0019:93-99`
   deliberately left these, because `StatusBoundary.test.tsx` is an allowlisted
   file with a pinned occurrence count. Left, and half D correctly ignores them.
