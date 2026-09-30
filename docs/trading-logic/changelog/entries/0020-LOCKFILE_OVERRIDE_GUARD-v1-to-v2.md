# 0020 - LOCKFILE_OVERRIDE_GUARD v1 -> v2

Execution record for the follow-up to WS-7 task T7a: close the gap T7a itself
created, where `package.json`'s `overrides` block and the root
`package-lock.json` were verified by hand exactly once and nothing enforced
that they agree.

rule: LOCKFILE_OVERRIDE_GUARD
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0020-LOCKFILE_OVERRIDE_GUARD-v1-to-v2.md)
date: 2026-09-30
historicalTradesAffected: none
source: >-
  WS-7 task T7a (`3891bbb`, "WS-7 T7a: green the CI audit gate - pin undici to
  its fixed patch on both majors") and the finding reported alongside it, plus
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1260` (T7
  acceptance) and the repo-wide rule that a control verified once by hand and
  enforced by nothing is the defect shape this workstream exists to close.

## v1 -> v2

v1 shipped an `overrides` declaration and a matching lockfile with no
mechanical link between them. v2 makes the two halves answerable by the test
suite in both directions.

reason: >-
  T7a added `overrides: { "undici@7.29.0": "7.29.1", "undici@^8.9.0":
  "8.10.2" }` to the root manifest, then had to hand-edit six lines of
  `package-lock.json` because npm does not re-resolve an already-satisfied
  lockfile edge. The `overrides` block is therefore **silently inert** against a
  complete lockfile: `npm install`, `npm install --package-lock-only` and
  `npm update` all leave `undici` where the lockfile says it is. The patched
  versions are real; the *declaration* of why they are there is the only thing
  that makes them auditable, and nothing checked that it still existed or
  still matched.

  Two concrete failure shapes were open, and neither was detected by any
  existing test, script, or CI step:

  - **Declared but not satisfied (direction 1).** A future edit reverts one
    `package-lock.json` version to the vulnerable patch. `package.json` still
    reads `7.29.1`, so the manifest still looks correct; the audit gate is a
    separate command that a unit run does not invoke; and the test suite is
    green. The security fix silently stops being installed while every visible
    declaration still claims it is.
  - **Satisfied but not declared (direction 2, the mirror).** A reviewer
    deletes the `overrides` block, or a merge resolves `package.json` in favour
    of a branch that never had it. The lockfile keeps its hand-edited patched
    versions, and because npm will not re-resolve a satisfied edge, nothing
    puts them back. The patched version becomes a folklore number with no
    recorded intent, and the first lockfile regeneration reverts it to the
    vulnerable version with no diff anywhere that explains why.

## What the guard does

`apps/dashboard/server/__tests__/ws7LockfileOverrideGuard.test.mjs`, 11 tests,
placed in the existing `ws7*` guard family in
`apps/dashboard/server/__tests__/` and therefore collected by
`npm run test --workspace @picc/dashboard`, which is what CI's `test` job runs
(`.github/workflows/ci.yml`, `npm test` at the repository root). No CI or
script change was needed, and none was made: the file is collected because it
sits inside the existing suite, not because anything was reconfigured to
collect it.

| Layer | Assertion | Failure it prevents |
| --- | --- | --- |
| declaration | `package.json`'s `overrides` keys equal a pinned, transcribed set, with the exact pinned values | direction 2, and a drifted or silently edited set |
| declaration | the pinned set is checked against a **derived** read of both files, so deleting the block *and* the transcription together still fails | direction 2 with the transcription edited in the same commit |
| declaration | no override pins a version to itself | an inert override that reads as a remediation in review |
| declaration | every override stays inside the major it replaces | a tree-wide `undici@8` that silently breaks `ccxt`'s exact `7.29.0` pin |
| declaration | `name@range` splits on the LAST `@` | a future scoped override mis-parsed, which would make the guard fail on a healthy tree |
| lockfile | every `node_modules/<name>` path of an overridden package resolves to a version some override permits | direction 1 |
| lockfile | at least one such path exists | a declaration describing a package that is not in the tree; a version-comparison loop over zero paths would pass |
| lockfile | every major present in the lockfile is named by an override | a "simplification" to one version per package, which is legitimate today only because two overrides name the two majors |
| lockfile | the discovered scan set is real, and the exact-suffix path scan does not sweep in `node_modules/undici-types` | a guard that passes because it found nothing |
| integrity | every override-governed entry has an `https` registry tarball URL and a length-and-padding-correct SRI hash | a hand-edit that truncates a hash, drops the algorithm prefix, strips the padding, or adds whitespace |

### Why the expected set is transcribed rather than derived

`PINNED_OVERRIDES` is a hard-coded copy of the T7a decision. A derived
expectation would compare `package.json` with itself and could never fail. The
transcription is the third independent source of truth beside the manifest and
the lockfile, and it is the same pattern `ws5SeamGuard.test.mjs` uses for its
authorised-path set: pinned to its exact true value and asserted, so it cannot
be widened to make a suite green.

### The derived mirror check, and the realistic bad edit it covers

The declaration layer has two assertions on purpose. The first compares
`package.json` against the transcription; the second reads the versions the
lockfile actually ships and asks the manifest to account for each one. The
second exists because the realistic bad edit is to delete the `overrides` block
**and** the pinned table in the same commit "to keep them in sync", after which
the first assertion compares `{}` with `{}` and passes. The second cannot be
satisfied that way.

Its scope is deliberately narrow: only the packages this guard governs. A
version nobody declared an override for is normal for the other 259 lockfile
entries, most of which have no override at all, so a repo-wide
"every version is declared" rule would be wrong rather than strict.

## Decision: the integrity check is IN this guard, scoped to the override-governed entries

The question put to this record was whether an integrity-hash well-formedness
check belongs in the same guard or is scope creep. **It belongs, and it is
scoped to the override-governed entries rather than the whole lockfile.**

The class is real. T7a rewrote `version`, `resolved` and `integrity` by hand on
two lockfile entries, and a version-equality check cannot distinguish a
correctly edited entry from one whose `integrity` is truncated, carries the
wrong algorithm prefix, has its base64 padding stripped, or picked up
whitespace. Those two entries are exactly the ones the next maintainer will
re-edit by hand.

Two scopes were considered:

- **Repo-wide.** Measured on the current tree: 261 non-root entries, 259 with
  `integrity`, all `sha512`; the 2 without are the workspace entries
  (`apps/dashboard` and the `link: true` `node_modules/@picc/dashboard`). A
  repo-wide sweep is therefore green today, but it has to encode exceptions it
  cannot enumerate in advance - a git dependency carries `sha1-`, and
  `file:`/`link:` entries carry no `integrity` at all. A sweep whose exception
  list is guesswork goes red on the next legitimate dependency shape and gets
  deleted, which is the worse outcome.
- **Override-governed entries only.** Needs no exception list, cannot go red on
  a healthy tree, and covers precisely the entries that were hand-edited.
  **Chosen.**

Two limits are stated in the guard rather than left implicit. It does not
recompute the hash - nothing offline can, that requires the tarball - so it
proves the entry is *shaped* like an npm registry entry, not that the bytes
behind it are right; detecting a wrong-but-well-formed hash is `npm ci`'s job
and is unchanged. And the shape check was itself found to be too weak while
being written: the first version validated the base64 alphabet only, and the
guard's own probe test caught a 44-character truncation of a `sha512-` string
passing. The check now validates total payload length and padding placement per
digest size, which is what makes the truncation a failure.

## Teeth proven both ways

Both mutations were applied to the real tracked files with the exact-match
editor, run, and restored byte-for-byte (`git diff` empty afterwards; verified).

**(a) Declared but not satisfied — the silent-inert case.** `node_modules/undici`
hand-set back to `7.29.0` (and its `resolved` URL to the 7.29.0 tarball), with
`package.json` untouched. Result: **exit 1**, 1 failed / 9 passed, and the
failure named the defect:

```text
AssertionError: every lockfile path of an overridden package must match a
declared override: expected [ ] to deeply equal []
+ "node_modules/undici is 7.29.0; package.json permits only 7.29.1 or 8.10.2"
```

Worth recording: the integrity layer correctly stayed **silent** on this
mutation. The `integrity` string left behind was the 7.29.1 hash and the
`resolved` URL was a well-formed registry URL for 7.29.0 - both are
structurally fine, and only the version check could see the problem. The two
layers are orthogonal, and this is the concrete demonstration of why the
integrity check is not a substitute for the version check.

**(b) Satisfied but not declared — the mirror.** The `overrides` block deleted
from `package.json`, lockfile left at `7.29.1`/`8.10.2`. Result: **exit 1**,
2 failed / 9 passed, and both mirror assertions fired:

```text
AssertionError: package.json's `overrides` keys must equal the guard's pinned
set exactly ...: expected [] to deeply equal [ 'undici@7.29.0', 'undici@^8.9.0' ]

AssertionError: every lockfile version this guard governs must be declared by an
override: expected [ ] to deeply equal []
+ "node_modules/jsdom/node_modules/undici ships 8.10.2, which no override in
   package.json declares. The lockfile carries a version nothing explains; npm
   will not re-resolve a satisfied edge, so nothing puts it back."
```

## Net effect

- `apps/dashboard/server/__tests__/ws7LockfileOverrideGuard.test.mjs` — new,
  11 tests.
- `package.json` — unchanged (`overrides` block verified byte-identical after
  both proof mutations).
- `package-lock.json` — unchanged (both `undici` entries verified byte-identical
  after the proof mutation).
- `.github/workflows/ci.yml` — unchanged; the guard runs because CI's `test`
  job runs the dashboard vitest suite the file already belongs to.
- `apps/dashboard/package.json` — unchanged; `testTimeout` not raised.

No existing test or assertion was weakened, skipped, deleted, or re-pinned. No
guard value moved.
