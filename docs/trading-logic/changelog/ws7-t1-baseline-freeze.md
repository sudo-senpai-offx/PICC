# WS-7 T1 — baseline freeze (pre-room-work measurement)

**Date:** 2026-09-26 · **Commit:** `09125f8` (T0) + this record · **Owner:** WS-7+

Purpose: T0 changed files, so any floor quoted from before WS-7 began is stale.
This record re-measures every gate and states each value as OBSERVED now, or
explicitly `UNMEASURED`. **Nothing here is inherited from a prior claim**, including
the WS-6 figures carried in `PICC.md`.

## Measured floor

| Gate | Command | Observed | Verdict |
| --- | --- | --- | --- |
| Typecheck | `npm run typecheck` | exit 0, no `error TS` | PASS |
| Unit/integration | `npx vitest run --maxWorkers=1` | **303 files, 3392 passed, 1 skipped**, exit 0 | PASS |
| E2E | `npm run test:e2e --workspace @picc/dashboard` | **5 passed** (2.2m), exit 0 | PASS |
| Audit chain | `verifyAudit()` | `ok: true, brokenAt: null` | PASS |
| Whitespace | `git diff --check` | clean, exit 0 | PASS |
| Security review | diff-scoped scan of `origin/master..HEAD` | 0 exploitable findings | PASS |
| Working tree | `git status --porcelain` | empty | CLEAN |

Test-count context: the floor rose 3133 (WS-5) → 3386 (WS-6) → **3392**. The
`303 files` figure counts `.mjs`/`.ts`/`.tsx` suites under `apps/dashboard`.

## Security review — what was actually checked

Scanned the full WS-7 diff (`origin/master..HEAD`, 6 files, +1793/−11) for
credential-shaped strings and dangerous process invocation:

| Pattern | Result |
| --- | --- |
| `PICC_CCXT_*= <value>` | 1 hit — **not a credential**; the env-var *name* `PICC_CCXT_PERPS_MAINNET_ENABLED=1` inside a PICC.md documentation table |
| `PRIVATE_KEY = <value>` | none |
| `sk-<20+>` | none |
| `Bearer <20+>` | none |
| `child_process` / `execSync` / `spawn(` | none |

The one new executable module, `server/scripts/absence-scope.mjs`, performs **no
network I/O, no subprocess execution, and reads no environment variable or
credential**. Its only IO is recursive `readFileSync`/`readdirSync` over the
server tree, which is what discovery requires.

Scope limit stated honestly: this is a **diff-scoped pattern review**, not a
full application penetration test. It does not cover runtime behaviour, the
previously-identified standing gaps (agents-service `allow_origins=["*"]` with a
plaintext LLM key; plaintext GitHub token in `profile.json`), or anything outside
this diff. Those are tracked as WS-7 tasks, not closed here.

## Defects resolved en route to this floor

Three pre-existing failures were fixed before the floor could be established. All
three were real, and none were introduced by WS-7.

1. **CRLF checkout broke source-pinning tests** (`51bef3a`). Six tests use
   `$`-anchored regexes against source read from disk. In JavaScript `$` anchors to
   end-of-**string**, not end-of-line, so a CRLF line `"...RAIL_OFF_TESTNET_ONLY
   =\r"` could never match `^const RAIL_OFF_TESTNET_ONLY =$`. Invisible in CI
   because the blob was always correct LF; deterministic on Windows because
   `core.autocrlf=true` and the repo had **no `.gitattributes` at all**. Fixed at
   the config layer, not by loosening an assertion.

2. **Registry-count guard was a stale literal** (`90c5d6c`).
   `ws3CeremonySeamGuard.test.mjs` pinned `"39 registry rows"` while the table held
   41 spec rows + 1 `notes/` row and the header counted 42 — three disagreeing
   numbers. Now **derived**: the guard parses the §10 table, excludes `notes/`
   per its own documented convention, and asserts the header matches. Teeth
   verified: header set to `99` fails with `expected 99 to be 41`.

3. **Cross-file env contamination** (diagnosed, then found to be a **false lead**).
   `ws3CeremonySeamGuard.test.mjs` deletes all `PICC_*` vars in `afterEach`. An
   env-snapshot/restore fix was written and **did not change the failure**, so it
   was reverted rather than kept as an unverified change. The real cause was (1).

## Explicitly UNMEASURED at this baseline

| Item | Status | Why |
| --- | --- | --- |
| Direct on-device ARM room-transition sample | **UNMEASURED** | Needs a promoted terminal room; the legacy suite surface has none. Budget B2 rests on a derived 7.18× ratio until T19 checks in the raw probe output. |
| PICC application peak RSS vs the 2 GB ceiling | **UNMEASURED** | Device total/free RAM is not application peak RSS. B10 has no verdict. |
| Perps production `cancel` path | **UNMEASURED** | The adapter has no `cancel` member; a cancel test exercises raw CCXT, not production. T3 adds the member. |
| Guard inventory for the CCXT spot rail | **PARTIALLY UNVERIFIED** | Only `CCXT_HARD_NOTIONAL_CAP_USD = 10` (`:52`) and day-loss (`:432`) were confirmed in source. Other asserted gates live at the calling layer and are re-verified in a later task before any live boundary is relied on. |
| AC-4c two-real-tab lock matrix | **UNMEASURED** | Requires two isolated real browser profiles; not automatable in this harness. |
| Blueprint v4.0 provenance | **UNVERIFIED** | Source document not in repo. |
| ARM64 architecture correctness | **CLOSED** | Real ARM64 execution measured: `android-arm64`, SM6225, Cortex-A53 (`0x801`), 7.18× x86 ratio, jitter p95 4.47ms, deterministic checksum match. |

## Bisect

Documentation-only. This record cannot change runtime behaviour, so it is safe to
revert in isolation.
