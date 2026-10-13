# Pre-Mortem Planner — Design

**Date**: 2026-10-11
**Status**: proposed (owner approved design 2026-10-11; pending written-spec review)
**Author**: agent, with owner decisions recorded verbatim below
**Wave**: Wave 3, item W3-05 (fifth of W3-01…W3-10, one by one)

## 1. Purpose

An adversarial self-audit of PICC's own failure modes, in two halves that share
one catalog:

- **Verify claims.** For every failure mode whose catalog entry claims a guard
  covers it, check that the guard exists, is tracked, is registered in its own
  inventory, and can actually fail.
- **Find gaps.** For every failure mode with no guard claim, say so — named, with
  a severity, every run.

Advisory only. It moves no permit, unlocks nothing, blocks no build, and grants
no coverage it did not verify. It exists because this program shipped a guard
that looked like coverage and was not (GUARD-1, below), and because five
"pre-existing failure" claims in one session turned out to be our own
regressions.

## 2. Owner decisions (2026-10-11, binding)

1. **Backend-first; UI deferred.** W3-05 onward builds capability as pure
   services plus additive routes. UI surfaces wait for the planned frontend
   overhaul so nothing is built twice. Each item is judged on tested capability,
   not on screenshots.
2. **Both jobs, one module**: verify existing claims AND report the unguarded.
3. **Approach A plus a mutation tier.** Structural verification for every claim;
   mutation verification for the entries whose catalog `mutation` flag is set —
   the ones where "the guard exists" is not good enough. Membership is declared
   in the catalog and reviewed, never inferred at runtime.
4. **One catalog, two axes.** Capital-risk modes (money at risk) and
   shipping-risk modes (correctness at risk) share a catalog and never blur:
   each carries a `kind`, so a capital mode is never reported as covered by a
   passing test that means something else entirely.
5. **Code catalog with self-reported staleness.** The catalog is a code constant,
   reviewed and diffable, with no loader. Every mode carries either a guard
   `claim` or an explicit `acceptedUnclaimed` disposition with a named owner and
   a date — there is no third option, so silence can never read as coverage. The
   planner audits its own catalog first and reports dangling references as
   `stale-catalog-entry`.

## 3. Architecture

New `server/services/premortem/` boundary, mirroring the `graduation/` layout:

- `catalog.mjs` — the curated failure modes. Each entry: `id`, `kind`
  (`capital` | `shipping`), `severity`, `subsystem`, `summary`, `claim`
  (guard reference or `null`), `gap` (what the claim does NOT cover, or `null`),
  `acceptedUnclaimed` (owner + date, or `null`), `mutation` (boolean),
  `rationale`. Static, no I/O.

  **`severity`** is a three-level scale, and `kind` carries the meaning:
  `capital` severity is blast radius on money (`high` — capital at risk;
  `medium` — capital impaired but bounded; `low` — nuisance with no capital
  path). `shipping` severity is blast radius on correctness (`high` — a wrong
  thing can reach a user or a venue; `medium` — internal wrongness that a test
  catches; `low` — internal wrongness that nothing depends on). A capital mode
  and a shipping mode are never compared on one numeric scale, because they do
  not measure the same thing.

  **`subsystem`** is a repo-relative directory path that must exist on disk
  (e.g. `apps/dashboard/server/services/costs`). Free text would make the
  `stale-catalog-entry` verdict — "a subsystem that no longer exists" —
  unimplementable.

  **`claim`** is a repository-relative path to a tracked test file, optionally
  suffixed with a `describe`/`it` name after a `" :: "` separator:
  `"apps/dashboard/server/__tests__/sharedCommentLexer.test.mjs :: the shared comment lexer is one"`.
  The separator is explicit rather than a bare space because a repo-relative
  path may itself contain spaces. The suffix exists because two different
  failure modes can legitimately share one file; without it they are
  indistinguishable downstream. A resolver splits at the first `" :: "` and
  strips it before matching against the inventory. It must resolve to a file
  git tracks; anything else is `guard-missing` or `stale-catalog-entry`, never
  assumed.

  **`gap`** names what the claim does NOT cover. An entry carrying both a
  `claim` and a non-null `gap` is *partially* covered, and must never be
  reported as `verified`. A guard that exists is not the same as a failure mode
  that is closed — the first entry ever to need this was one whose guard
  half-covered a drift that was live at the time it was written.

  **`mutation`** is declared per entry, never inferred. The owner marks which
  claims earn mutation cost in review; the planner does not guess.
- `inventory.mjs` — **derives** the real guard inventory by scanning tracked test
  files. No hardcoded consumer list: a hand-maintained list is precisely the
  defect this planner exists to catch, so the planner must not reproduce it.
  Never reads an untracked file — the vacuity that produced a green guard run
  on a file git could not see.
- `verify.mjs` — the planner. Diffs catalog against inventory; emits one verdict
  per mode plus a catalog self-audit. Pure.
- `mutate.mjs` — the mutation tier. Runs a claimed guard against a deliberately
  broken implementation and reports whether it actually bites. Opt-in; slow.

Plus one additive route, `GET /api/premortem/overview`, dynamic imports only.
No UI in this wave.

**Gating: `requireAuthStrict`, not the plain `requireAuth`.** The payload names
which safety guards in this system are broken and which failure modes have no
coverage at all — a map of the system's defensive holes, which is more sensitive
than any trading performance already served. The strict variant is the one this
repo reserves for credential- and venue-disclosing routes, and this belongs with
them. The cost is no first-user bootstrap convenience on this route, which is
the right trade for a readout that names missing coverage.

### Verdicts

| Verdict | Meaning |
|---|---|
| `verified` | Guard exists, is tracked, registered, and carries real assertions, and covers the whole failure mode |
| `partially-covered` | A claim exists and resolves, but the entry carries a `gap` — the guard does not cover the whole failure mode |
| `guard-missing` | The claim names a guard that does not exist — measured inside the inventory's declared scope. A claim naming a file type **outside** that scope is `stale-catalog-entry`, not this: the inventory never claimed to look there, so "missing" would assert an absence nobody measured |
| `guard-cannot-fail` | Registered, but its assertion shape is vacuous |
| `unclaimed` | A catalog mode with no guard claim — the gap-finding half. (Distinct from the `gap` FIELD, which marks a claim that does not cover the whole failure mode) |
| `unverified-manual` | A capital-risk mode whose guard is a human judgement, not a file |
| `stale-catalog-entry` | The catalog itself is unsound: a claim that no longer resolves, a subsystem that no longer exists, or a mode carrying neither a claim nor an `acceptedUnclaimed` disposition |

**Withdrawn: `guard-unregistered`.** It was designed to catch GUARD-1 — a guard that
exists but is absent from a hand-maintained consumer list. The derived inventory has no
such list, so the verdict had no data source and would have required reintroducing the
exact defect it exists to catch. The failure mode is still covered: SHIP-1 and SHIP-2 are
catalog entries whose claims point at `sharedCommentLexer.test.mjs`, both carry a `gap`,
and both therefore report `partially-covered` — which says precisely what
`guard-unregistered` was reaching for, and does it from evidence the planner actually has.

### The honest limit

`unverified-manual` is the most important verdict in the set and must never be
upgraded. A venue outage mid-position has no guard *file*; there is nothing to
verify. The planner reports it, names the specific thing a human must check, and
refuses to claim coverage it did not verify.

A planner that green-lit capital-risk modes by matching a loosely-related test
file would be worse than no planner: it manufactures false confidence in the one
place where the stakes are highest. The same rule that governs every readout in
this repo governs this one — **absence is never a pass**.

## 4. Honesty rules

1. **Never a fabricated verdict.** Every outcome is one of the seven above, or
   nothing is emitted. No default, no "probably fine".
2. **Never a fabricated guard.** `inventory.mjs` reports only guards it found in
   tracked files. A guard it cannot locate is `guard-missing`, never assumed.
3. **The planner audits itself first.** A pre-mortem that has silently drifted is
   worse than no pre-mortem, so catalog staleness is reported at the top of its
   own output, before any claim is evaluated. Staleness surfaces across two
   channels that together cover every catalog defect: `auditCatalog` — which
   deliberately takes no inventory, so it can only see the entry's own shape —
   reports a subsystem that no longer exists and a mode carrying neither a
   `claim` nor an `acceptedUnclaimed` disposition; and the `stale-catalog-entry`
   VERDICT, which resolves claims, reports a claim that no longer resolves. A
   defect may legitimately appear in both channels: they are independent views,
   and neither defers to the other.
4. **Structural verification is not biting.** Where mutation has not run, the
   output says so. "Guard present" and "guard bites" are different claims and are
   never collapsed.
5. **Silence is not coverage.** Every catalog mode carries either a `claim` or an
   `acceptedUnclaimed` disposition (owner + date). Neither present is
   `stale-catalog-entry` — **for every kind, capital included.** The capital gate's
   unconditionality (rule 6) protects a mode that is otherwise well-formed; it does
   not rescue a mode the catalog itself has left malformed. A malformed mode is a
   catalog defect, and the self-audit reports it independently of the verdict.
6. **No unverified upgrade, ever.** `unverified-manual` cannot become `verified`
   because a related test file passes. This is asserted by test, not by review. Its
   unconditionality is scoped to **inventory content**: once the mode is known
   well-formed, no other kind pre-empts it.
7. **A guard is not a closed failure mode.** An entry whose claim resolves but
   which declares a `gap` reports `partially-covered`. A passing guard never
   upgrades a partial claim to `verified`.

## 5. Testing

Pure-function tests per module, hermetic, injected data.

- `inventory.mjs` — real fixtures with tracked and untracked files, proving it never
  reads an untracked file, and that a hand-maintained list is not consulted. Injected
  fixtures are the binding form: "git cannot see this file" is expressible as `[]` with
  no git process and no filesystem in play, which is strictly stronger than a temp dir
  for the property being proved. A file the reader cannot resolve, or a non-function
  reader, is `unreadable` — never a guard asserting nothing.
- `verify.mjs` — a matrix test pinning all seven verdicts, including that
  `unverified-manual` survives any inventory contents.
- `mutate.mjs` — every verdict reachable and nothing outside the trio; `bites` unreachable by
  default, from a malformed runner result, and from a throwing runner. One guard built to pass
  vacuously (the tier must catch it) and one that genuinely bites (the tier must not
  false-positive) — but `mutate.mjs` is forbidden from running anything, so both are exercised
  through an **injected** runner whose result the module treats as a measurement. A genuine
  vacuous guard cannot be reached at that altitude; proving the tier catches one against a real
  guard is the **route task's** obligation, and without a real `runGuard` the tier can only ever
  return its two pessimisms.
- Route — the `graduationApi.test.mjs` pattern: `requireAuthStrict` first, no state
  mutation, additive only, dynamic imports only. It supplies the real `runGuard`, and must
  demonstrate at least one entry reporting `bites` and one reporting `does-not-bite`.
- Every file importing `stripComments` from `guard-primitives.mjs` registers itself in
  `VITEST_CONSUMERS`. This has been missed three times in this repo; the omission is silent
  because the guard's `describe` title interpolates the array's length, so a green board keeps
  reporting the old count.

Every new hand-rolled test file is staged before the isolation guard runs;
`ws7TestStoreIsolation` enumerates tracked files via `git ls-files` and passes
vacuously on untracked ones.

## 6. Initial catalog

Seeded from failure modes this program actually hit, not hypotheticals.

**Shipping-risk** — a guard that cannot fail (GUARD-1, live now); a
hand-maintained guard inventory that omits a consumer (GUARD-1's root cause); a
spec asserting record fields that do not exist (`entryTime` / `exitTime` /
`pnlPct`, shipped into a plan before anyone checked); "pre-existing failure"
claims that were our own regressions (five in one session); two evidence piles
drifting apart because each re-implemented one predicate; a source with no bar
silently vetoing a gate forever.

**Capital-risk** — venue outage mid-position; cost model understating real drag;
circuit fails to halt; regime change against a fitted model; credential expiry
between check and use. All ship `unverified-manual` with the specific check a
human must perform.

## 7. Non-goals

- **No UI.** Deferred to the frontend overhaul by owner decision.
- **No CI gate.** This is an advisory readout. Making it blocking is a later
  decision, and it depends on the catalog being trustworthy first — a gate built
  on an unverified catalog blocks on false confidence.
- **No spec-table extraction.** Parsing the prose "Risk | Failure mode | Guard"
  tables out of the 35 files under `docs/specs/` would make a code feature
  depend on prose staying accurate. Rejected: it is backwards, brittle, and is
  the drift class this feature exists to detect.
- **No mutation-everything.** Mutation runs only where the catalog's `mutation`
  flag says so. A guard too awkward to mutate falls back to structural and says
  so in its output.
- **No LLM in the loop.** Verdicts are deterministic and reproducible. Nothing
  here asks a model to guess whether a guard is adequate.