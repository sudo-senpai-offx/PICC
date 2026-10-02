# 0037 — Spec amendment: AC-7a venue freeze widened for WS-7 T17

rule: AC7A_VENUE_FREEZE_T17_AMENDMENT
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0037-AC7A_VENUE_FREEZE_T17_AMENDMENT-v1-to-v2.md)
date: 2026-10-02
historicalTradesAffected: none
source: >-
  WS-7 T17 at `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1345-1352`
  (Scope `:1346`, Files `:1348`, Acceptance `:1350`); D9 at `:166-173`; AC-036 at `:1058`;
  the WS-5 AC-7a venue freeze as enforced by
  `apps/dashboard/server/__tests__/ws5SeamGuard.test.mjs`; T2's own amendment record at
  spec `:1200-1214`; and the residual coverage cited in this record
  (`perpsSeamGuard.test.mjs:36,107-114`, `ws7SeamGuard.test.mjs:371,392`,
  `executionAbsenceScope.test.mjs`).
reason: >-
  The WS-5 AC-7a venue freeze forbade exactly what WS-7 T17 mandates, so T17 could not be
  implemented at all. T17's Files clause names `services/ccxtOrdering.mjs` as extend-don't-replace,
  and that file is one of the six frozen venue paths, which rejects any non-subtractive change to
  it. An extension is additive by construction. This amendment is the first widening of that
  freeze by value rather than a re-derivation of its semantics. It authorises exactly four named
  files, adds no wildcard, prefix, or directory entry, leaves every other venue path frozen with
  all of its checks intact, and states the one coverage loss it causes.

- **Date:** 2026-10-02
- **Owner:** WS-7+
- **Kind:** dated spec amendment — the mechanism AC-7a's own guard comment requires ("a new spec
  decision AND a deliberate edit there"), recorded at spec `:1354`
- **Supersedes:** nothing. This **widens** one invariant's exception set and rewords two
  assertions' text. It relaxes no check, lowers no threshold, and removes nothing.

## The contradiction

`apps/dashboard/server/__tests__/ws5SeamGuard.test.mjs` freezes the venue surface. Before this
amendment it pinned:

| Location | Pin |
|---|---|
| `:235` | the authorisation set is an exact ONE-entry list |
| `:708` | `WS7_T3_AUTHORIZED_VENUE_PATHS.has(path)` is false for `ccxtOrdering.mjs` — "must not be authorized" |
| `:738-745` | "grants no venue exception beyond the single WS-7 T3 decision" |
| `:734`, `:759-760` | anti-smuggling: the exception must never admit the whole `services/venues/` directory |

*(line numbers in the "before" column are pre-amendment; the "after" numbers are given inline below
and were read back from disk, not estimated.)*

WS-7 T17 mandates the opposite. Spec `:1348` says `ccxtOrdering.mjs` is to be **extended, do not
replace** — the exact file `:708` forbade authorising. The T17 agent reported the collision as
`5250 passed / 2 failed`, both failures being these two assertions.

## Why the later decision governs

The freeze is a WS-5 scope discipline, dated before T17. T17 is a later, explicit, task-level
instruction, and an order lifecycle it names cannot be built under a rule that predates it. The
later instruction governs — **but only because it is written down.** An unwritten widening would be
indistinguishable from the accidental erosion the freeze exists to prevent, which is why the grant
is dated, enumerated and reasoned rather than absorbed into the guard's predicate.

## Authorised set: before and after

**Before** — one entry, one decision:

| Set | Before |
|---|---|
| `WS7_T3_AUTHORIZED_VENUE_PATHS` | `services/venues/hyperliquidPerps.mjs` |

**After** — five entries, two separately-pinned decisions:

| Set | After |
|---|---|
| `WS7_T3_AUTHORIZED_VENUE_PATHS` (unchanged) | `services/venues/hyperliquidPerps.mjs` |
| `WS7_T17_AUTHORIZED_VENUE_PATHS` (new) | `services/ccxtOrdering.mjs` |
| | `services/venues/ccxtVenues.mjs` |
| | `services/venues/ccxtVenueLifecycle.mjs` |
| | `services/venues/ccxtLifecycleRails.mjs` |
| `WS7_AUTHORIZED_VENUE_PATHS` (new union) | all five — what the predicate consults |

T3's set is kept as its own binding rather than being folded into one list, so the guard's own
comment stays true and a reviewer can still answer "which decision authorised this file" by reading
two small sets instead of one growing one.

## Each path, and why

Two of T17's `Files`-clause items are prose rather than paths, so the resolution is recorded rather
than left implicit.

| T17 spec text | Authorised path | Reason |
|---|---|---|
| `:1348` "ccxtOrdering.mjs (extend, do not replace)" | `services/ccxtOrdering.mjs` | Named literally, and the exact path the pre-amendment pins forbade. T17's `:1346` scope requires the lifecycle to be built on the seam T3 amended. |
| `:1346` "the full lifecycle" + `:1348` "new per-venue adapter configuration" | `services/venues/ccxtVenues.mjs` | The per-venue adapter configuration the clause names; D9 `:166-173` fixes it at exactly four venues. |
| `:1348` "the ceremony/consent/risk integration points" | `services/venues/ccxtLifecycleRails.mjs` | The three integration points `:1350` requires honoured on every leg; one evaluator is what makes "every leg" provable. |
| `:1346` "the full lifecycle, four venues" | `services/venues/ccxtVenueLifecycle.mjs` | The lifecycle itself; holds no rail logic and no CCXT instance. |

The middle two mappings are this amendment's judgement, not the spec's words. Because nothing
outside the four is authorised, a wrong mapping is correctable without widening the grant.

## The two reworded assertions

Both remain **real equality assertions against the explicit set.** Neither was loosened to a
truthy check, because a truthy check here would permit any width at all.

Before, `:708`:

```
expect(WS7_T3_AUTHORIZED_VENUE_PATHS.has(path), `${path} must not be authorized`).toBe(false)
```

After, `:790`:

```
expect(WS7_AUTHORIZED_VENUE_PATHS.has(path), `${path} must not be authorized by the WS-7 T3 decision or the WS-7 T17 amendment`).toBe(false)
```

Before, `:738-745`:

```
it("grants no venue exception beyond the single WS-7 T3 decision", () => {
  ...
  expect([...WS7_T3_AUTHORIZED_VENUE_PATHS].sort()).toEqual([
    "apps/dashboard/server/services/venues/hyperliquidPerps.mjs"
  ])
```

After, `:859`, with the three equalities at `:871`, `:874` and `:880`:

```
it("grants no venue exception beyond the WS-7 T3 and WS-7 T17 decisions", () => {
  ...
  expect([...WS7_T3_AUTHORIZED_VENUE_PATHS].sort()).toEqual([
    "apps/dashboard/server/services/venues/hyperliquidPerps.mjs"
  ])
  expect([...WS7_T17_AUTHORIZED_VENUE_PATHS].sort()).toEqual([ /* four, literal */ ])
  expect([...WS7_AUTHORIZED_VENUE_PATHS].sort()).toEqual([ /* five, literal */ ])
```

Three equalities now where there was one: each decision's list, and their union. All three are
visible at a glance as literals.

## The anti-smuggling checks survive, and are stronger

`:734` and `:759-760` are unchanged in substance and **strengthened** in form.

The pre-amendment `:734` expressed "the directory is never authorised" as a single identity —
`every(p => !p.startsWith(VENUES) || p.endsWith("hyperliquidPerps.mjs"))` — which was only
expressible because T3's set held one entry. Under T17 it is replaced by the same invariant in
general form: the `venues/`-resident entries equal an explicit four-file list, and every authorised
entry is asserted to be a named `.mjs` file with no trailing slash and no glob character.

The pre-amendment `:759-760` loop kept verbatim, and its comment was overclaiming: `isVenuePath` is
satisfied by the `services/venues/` **prefix**, so it returns true for the directory itself and for
any file inside it. Under a one-entry set that gap was harmless. Widening the set would have turned
it into a hole, so the directory-shaped forms are now rejected explicitly, and the loop iterates the
union rather than one decision's set. Two further equalities were added: the `services/venues/`
directory itself is authorised by nothing, and a venue file no decision named is authorised by
nothing.

No check was removed and none was weakened.

## Residual coverage — stated, not implied

`ccxtOrdering.mjs` is no longer capability-subtracted by this guard; it left the `stillFrozen` list,
and nothing here now rejects an addition to it. That is the one coverage loss this amendment causes,
and it is the honest price of implementing T17 at all. Its authorising decision is pinned explicitly
in both directions so it cannot drift silently. What still covers that file:

- `perpsSeamGuard.test.mjs:36,107-114` pins `ccxtConnector`'s `READ_ONLY_BLOCKED` tokens, and
  `ws7SeamGuard.test.mjs:371,392` pins that `cancelOrder` is **still** in that blocklist. The
  read-only surface is asserted in two places, not one.
- `executionAbsenceScope.test.mjs` discovers order-capable modules and fails the build on an
  unreviewed one.
- The two frozen venue paths T17 did **not** name keep every check, including the additive-export
  plant and the body-edit plant.
- **Forthcoming, not yet existing:** the T17 rails matrix (`ccxtVenueLifecycle.rails.test.mjs`) is a
  follow-on task's deliverable and is what will pin the ceremony gate, the consent payload lock and
  the risk rails on every leg. Cited as forthcoming deliberately — counting it as coverage today
  would be a false claim about this repo's state.

## A commit-subject trap this amendment walked into

`scripts/ws7-seam-probe.mjs:1203-1207` measures a task as **landed** when a commit subject names both
the workstream and the task token (`ws7-seam-probe.mjs`'s `ws7-tasks-without-a-commit` item, asserted
exactly at `ws7SeamGuard.test.mjs:533`). This record's first commit subject was
`WS-7 T17 amendment: ...` — which matched, so the probe began reporting T17 as landed while its
implementation was still staged and uncommitted. `ws7SeamGuard.test.mjs` went red with
`expected [ 'T18' ] to deeply equal [ 'T17', 'T18' ]`.

The guard was right and the subject was wrong: an amendment that *authorises* T17 is not T17 landing.
The subject was changed to one that names no task token. **The rule for whoever follows: do not put a
bare `Tn` token in a `WS-7` commit subject unless that commit actually lands that task.** Naming it in
the changelog body or the spec is safe — only the commit subject is read.

## One collateral edit, and why it was unavoidable

`apps/dashboard/server/__tests__/crossRoomInvariantGate.test.mjs:1000` pinned the **absolute line
number** of honesty note 18 in the spec as `1476`. The T17 decision record is inserted at spec
`:1354`, which is *above* the honesty notes, so it pushed them down 25 lines and the pin failed with
`expected 1501 to be 1476`. The pin was updated to `1501`.

Nothing was relaxed. `toHaveLength(2)` — the real assertion — is unchanged, the count of lines
matching `\b18\b` is still exactly two, and the content match `/^18\. \*\*No credentials/` on the next
line is unchanged. Only a positional locator moved, and a comment now says so. The alternative was
to file the decision record outside T17's own section to dodge a line number, which would have hidden
the record from the place a reviewer looks for it — T2's own record sits at spec `:1200`, inside its
task section, for the same reason.

## Verification

- `npm run typecheck` clean.
- `npm run test --workspace @picc/dashboard` green: **the two collision failures are resolved**.
  The guard file alone: `17 passed`.
- The guard still bites, proven by planting two unauthorized venue edits that this amendment does
  **not** name — an appended additive export in `services/venues/venueAdapterContract.mjs`, and a
  brand-new `services/venues/zzUnauthorizedProbeVenue.mjs`. Both were rejected and both appeared in
  the `unauthorized` list, while the four authorised paths did not. Both probes were reverted.
- The new assertions were shown to fire on their own: adding `services/venues/` to the authorised
  union fails both width pins; and when the three equality pins were mutated to *accept* that entry,
  the per-entry directory check still rejected it, so the loop is not merely redundant.
- Spec remained CRLF throughout (1547/1547, zero bare LF), no BOM, zero `U+FFFD`. This entry is LF.
- `git diff --check` clean. Nothing under `server/data/`, `.playwright-tmp/`, or any lockfile.

## Not done here

T17's implementation is **not** in this record's commit. The guard is amended first, on its own, so
the freeze is never widened as a side-effect of adding the capability it forbids — which is the
precise failure mode the freeze exists to catch.