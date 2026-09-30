# 0017 - ONE_LOCKFILE_NPM_ONLY v1 -> v2

Execution record for WS-7 task T6: resolve the two-lockfile split so the
repository has exactly one package-manager source of truth (WS-7 decision D24,
AC-018, AC-019).

rule: ONE_LOCKFILE_NPM_ONLY
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0017-ONE_LOCKFILE_NPM_ONLY-v1-to-v2.md)
date: 2026-09-29
approvalDate: 2026-09-26
historicalTradesAffected: none
source: >-
  WS-7 decision D24 and WS-7 task T6,
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1237-1244`
  (owner decision TAKEN 2026-09-26; executed 2026-09-29). Owner is recorded as
  the literal `WS-7+`. The decision is not a branch point: it is a deletion plus
  a single-file truth.

## v1 -> v2

v1 left two tracked lockfiles that disagreed, with the disagreement load-bearing.
v2 leaves exactly one.

reason: >-
  `apps/dashboard/pnpm-lock.yaml` described a dependency set the project does not
  have. It contained **zero** references to `ccxt`, `playwright`, or `web-push` —
  the live-execution, browser, and push dependencies — while declaring
  `@supabase/supabase-js` as an importer dependency that no longer appears in
  `apps/dashboard/package.json`. A reader who trusted it would conclude the live
  dependencies were absent. CI already consumed the root `package-lock.json`, so
  the pnpm file was not merely stale but actively misleading.

## What was deleted

Two files, not one. The spec's T6 file list names only
`apps/dashboard/pnpm-lock.yaml`.

| Path | In spec's file list | Deleted |
| --- | --- | --- |
| `apps/dashboard/pnpm-lock.yaml` | yes | yes |
| `apps/dashboard/pnpm-workspace.yaml` | **no** | yes |

`apps/dashboard/pnpm-workspace.yaml` was found during execution. It is a
two-line pnpm-only file:

```yaml
allowBuilds:
  esbuild: set this to true or false
```

It is a pnpm-specific config, not a lockfile, so it does not violate AC-019's
"exactly one lockfile" count on its own. It was deleted anyway, for the reason
AC-018 states directly: *"`package.json` may not carry a `packageManager` or
workspace field that re-implies pnpm."* A pnpm workspace declaration sitting
beside an npm workspace root re-implies pnpm just as effectively, and it would
have survived T6 as the last pnpm artifact in the tree. Leaving it would have
made the deletion half-applied.

Nothing referenced it. A tree-wide search for `pnpm-workspace`, `allowBuilds`,
and `pnpm` across all tracked files found no consumer.

## AC-018 — clean-clone `npm ci` reproduces the tree

Measured, not asserted. Method: `git clone --no-hardlinks` of `d01debd` to a path
outside the repository (`--no-hardlinks` used deliberately; no `git worktree`, no
junction, no symlink, and no recursive delete was issued against any path). The
two T6 deletions were mirrored in the clone with `git rm`, then `npm ci` was run
in the clone with **no** pre-existing `node_modules`.

`npm ci` exit code: **0**.

The three named dependencies were then checked three ways — present on disk with
a readable `package.json`, and pinned by an explicit `node_modules/<name>` entry
in the **root** `package-lock.json` (an explicit entry is what distinguishes
"resolved from the lockfile" from "incidentally present"):

| Package | Installed | Version | Root-lock entry | Declared in |
| --- | --- | --- | --- | --- |
| `ccxt` | yes | 4.5.75 | `node_modules/ccxt` | `apps/dashboard` dependencies |
| `playwright-core` | yes | 1.63.0 | `node_modules/playwright-core` | `apps/dashboard` dependencies |
| `@playwright/test` | yes | 1.63.0 | `node_modules/@playwright/test` | `apps/dashboard` devDependencies |
| `web-push` | yes | 3.6.7 | `node_modules/web-push` | `apps/dashboard` dependencies |
| `playwright` (transitive) | yes | 1.63.0 | `node_modules/playwright` | transitive |

`ccxt@4.5.75` additionally appears in the `npm ci` output's install-script
notice, which is independent corroboration that npm resolved and unpacked it.

`ccxt`, `playwright`, and `web-push` are the three the spec names; `playwright`
itself and both `@playwright/*` packages are recorded so the playwright surface
is covered completely rather than by a single representative name.

The root lockfile is `lockfileVersion: 3`, `picc@0.1.0`, with 262
`node_modules/...` entries.

**Functional reproduction**, not merely installation: `npm run typecheck` in the
clean clone exited **0**.

## AC-019 — exactly one lockfile is tracked

`git ls-files`, filtered to canonical package-manager lockfile names
(`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`,
`bun.lock`, `bun.lockb`, `deno.lock`, `shrinkwrap.yaml`):

```text
package-lock.json
```

**Count: 1.**

A deliberately broader sweep — any tracked path ending in `lock.json`,
`lock.yaml`, `lock.yml`, `.lock`, `.lockb`, or containing `shrinkwrap` — returns
the same single path. A separate sweep for any tracked path containing `pnpm`
returns **none**.

A note on method, because the naive check is misleading here: filtering
`git ls-files` on the substring `lock` alone returns **ten** paths, because
seven of them are source files whose names merely contain the word
(`UnlockCeremony.tsx`, `dangerousActionLock.ts`, `contractLocks.test.mjs`,
`ceremonyVenueUnlock.test.mjs`, `consentPayloadLock.test.mjs`,
`UnlockCeremony.test.tsx`, `dangerousActionLock.test.ts`) plus one spec document.
None is a lockfile. The canonical-name filter is the correct test, and both were
run so the distinction is visible rather than assumed.

## `package.json` carries no field re-implying pnpm

Both workspace manifests were read in full and searched for `packageManager`,
`pnpm`, `volta`, `resolutions`, `overrides`, and `engines`:

- `package.json` (root) — no `packageManager`, no pnpm field. `engines.node:
  ">=22"` only.
- `apps/dashboard/package.json` — no `packageManager`, no pnpm field.

Neither manifest carries a `packageManager` field at all, so no package manager
is asserted by metadata; the absence of `packageManager` is itself the strongest
form of "npm only" here, since a `packageManager: "pnpm@..."` field would be the
usual re-implication.

No `.npmrc`, no `pnpm-workspace.yaml`, and no pnpm-specific config existed
outside the two deleted files.

## `.gitattributes` — decision: already present, minimal, and correct; no change

The spec's T6 acceptance says "Decide whether to add `.gitattributes`." The
decision is **not to add one**, because one already exists, is already minimal,
and already carries the rationale that makes it defensible.

`.gitattributes` at the repository root contains exactly two rules:

```gitattributes
* text=auto

*.mjs text eol=lf
*.js  text eol=lf
*.ts  text eol=lf
*.tsx text eol=lf
```

Its existing comment documents a real, deterministic, platform-dependent failure
that these rules fix: several seam guards read real source from disk and assert
with `$`-anchored regexes, and in JavaScript `$` matches end-of-**string**, not
end-of-**line**. On a CRLF checkout every line ends in `\r`, so
`/^const FOO =$/` cannot match a byte-correct file. The named instance is
`ws3CeremonySeamGuard.test.mjs:255`. The blob in git was always LF; only the
working tree differed, which is why the failure was invisible in CI.

The rules are deliberately conservative: `text=auto` normalises text and leaves
binaries alone, and only the four extensions the source-pinning guards actually
read are pinned. Shell and Markdown are left to `text=auto` precisely so the file
does not create a large whitespace-only diff in unrelated files.

**Adding anything further would be an unrequested reformat, so nothing was
added.** Two specific expansions were considered and rejected:

- Pinning `*.json text eol=lf` or `*.md text eol=lf` would normalise 28 tracked
  files that are currently CRLF in the working tree, producing whole-file diffs
  in files this task was not asked to touch — including
  `package-lock.json` itself (3736 CRLF lines) and the WS-7 spec document.
- Adding `* text=auto eol=lf` globally would do the same to 153 tracked files.

### Finding recorded, not fixed: the working tree is not renormalized

A byte-level audit of all 814 tracked non-binary files found **153** containing
CRLF. Of those, **125 are files the existing `eol=lf` rules already pin**
(`.mjs`, `.js`, `.ts`, `.tsx`) — for example
`apps/dashboard/server/__tests__/handlers.test.mjs` at 602 CRLF / 0 LF, and
`apps/dashboard/server/services/ccxtOrdering.mjs` at 500 CRLF / 0 LF.

This is a **stale working tree**, not a repository defect: these files were
checked out before `.gitattributes` was added, and `core.autocrlf` is `true`, so
the working tree was never re-normalized after the rules landed. The blobs in
git are LF. A `git add --renormalize .` plus re-checkout would settle it.

**It was deliberately left alone.** It is pre-existing, it is invisible to CI,
and fixing it means rewriting 125 files this task was not asked to touch. It is
recorded here because it is a live fragility: the seam guards are green today
only because the specific files they read happen to have been rewritten with LF
by later edits (for example `captureProfiles.mjs`, rewritten by T2). A future
re-checkout that normalized *some* files and not others could surface the exact
`$`-anchor failure the rules were written to prevent. That is a follow-up, not a
T6 change.

Note that the spec's own premise at `:28` — "There is **no `.gitattributes`** in
the repository" — is **stale**. The file exists. The decision T6 asks for was
therefore already taken and implemented; this record confirms it rather than
revisiting it.

## n8n workflows and CI: checked, and clean

The spec's T6 file list names "the 3 n8n workflow files" and "CI workflow config".
Both were checked for lockfile-implying references — `pnpm`, `npm ci`,
`npm install`, `--frozen-lockfile`, `packageManager`, `store-dir`, `yarn`,
`node_modules`.

**n8n: clean.** A search across all 11 tracked files in `infra/n8n/`
(10 workflow JSONs, `docker-compose.yml`, `README.md`) for every one of those
patterns returned **zero** matches. There is no `pnpm/action-setup`, no
`npm ci --no-save`, no `--frozen-lockfile`, and no pnpm store path in any n8n
file. Nothing needed correcting.

**CI: clean, and already root-locked.** `.github/workflows/ci.yml` contains
three `npm ci` invocations (lines 49, 70, 87), each in a job whose
`actions/setup-node` step sets `cache: npm` with
`cache-dependency-path: package-lock.json`. All three jobs run at the repository
root; none descends into `apps/dashboard`. No pnpm reference exists. The file's
own comment at lines 9–14 already records the D24 truth, including that older
revisions ran `npm ci` inside `apps/dashboard` against a lockfile that does not
exist and therefore could never install. **No CI edit was required.**

### Correction to the spec's own count: 7 n8n workflows carry Supabase nodes, not 3

The spec's finding at `:1462` states the audit "reports 24 in `pnpm-lock.yaml`
and Supabase nodes in 3 n8n workflows", and T6's file list inherits "the 3 n8n
workflow files". Measured: **7** of the 10 tracked workflow JSONs reference
`supabase`, each with exactly one `n8n-nodes-base.*supabase*` node —
`picc-content-studio.json`, `picc-depin-aggregator.json`,
`picc-income-aggregator.json`, `picc-listing-optimizer.json`, `picc-simulator.json`,
`picc-staking-monitor.json`, `picc-trading-signal.json`.

The "3" is stale. This is recorded, not acted on: **no n8n workflow was
modified.** T6's scope names the "dead Supabase surface", but the Supabase nodes
in these workflows are runtime n8n node references governed by
`infra/n8n/docker-compose.yml` and the n8n instance's own credentials, not
package-manager state. Removing them would change workflow behaviour, which is
outside a lockfile task, and the spec itself declines to pre-judge which
Supabase references are load-bearing (`:1462`). Resolving them is T6's stated
scope but is a separate piece of work from the lockfile decision this record
closes; it is flagged rather than silently absorbed.

## Bisect note: no dependency was installed on this branch

The spec's T6 bisect note states the lockfile decision "precedes any new
dependency install (T13/T14/T17)", and warns that installing against an
unresolved lockfile set compounds the split.

Verified against the branch base `c407964` (47 local commits ahead of
`origin/master`): across `c407964..HEAD`, the only manifest touched is
`apps/dashboard/package.json`, and its entire diff is:

```diff
-        "test": "vitest run --maxWorkers=1",
+        "test": "vitest run",
```

**No dependency was added, removed, or version-changed anywhere on this branch,
and `package-lock.json` was not modified at all.** Therefore no dependency exists
that is absent from the root lockfile, and the ordering constraint T6 exists to
enforce was never violated.

The dropped `--maxWorkers=1` is a test-parallelism change, not a dependency
change, and is recorded here only because it is the sole manifest delta on the
branch.

## `.pnpm-store/` entries deliberately left in place

`.gitignore:3` and `.dockerignore:3` both contain `.pnpm-store/`, a pnpm store
path — the one pnpm-implying reference outside the two deleted files.

**They were not removed.** `ws7TestStoreIsolation.test.mjs:1171` cites
`.gitignore:38` by **line number** in its explanatory comment, and `.gitignore:38`
is `apps/dashboard/server/data/`. `.pnpm-store/` is at line 3, so deleting it
would shift that entry to line 37 and make a line-pinned citation inside the
test-store-isolation guard stale. That guard is explicitly out of scope for
edits, and its comment is load-bearing documentation of a real CI-breaking bug.

The cost of leaving them is nil for AC-018/AC-019: an ignore entry for a
directory that will never exist under npm cannot "claim authority" over a
lockfile, which is what those two criteria forbid. The trade is a stale-looking
comment line number against touching a protected guard. Recommended as a
follow-up that updates the guard's comment in the same change, not done here.

## Net effect

- `apps/dashboard/pnpm-lock.yaml` — deleted (was in the spec's file list).
- `apps/dashboard/pnpm-workspace.yaml` — deleted (found during execution; was
  not in the spec's file list).
- `package.json`, `apps/dashboard/package.json`, `package-lock.json` — unchanged.
- `.github/workflows/ci.yml`, all `infra/n8n/` files — unchanged; already correct.
- `.gitattributes` — unchanged; already present, minimal, and justified.
- `.gitignore`, `.dockerignore` — unchanged; see above for the line-pinned
  reason.

AC-018 and AC-019 pass. The D24 goal — one source of truth, stated once — is met.
