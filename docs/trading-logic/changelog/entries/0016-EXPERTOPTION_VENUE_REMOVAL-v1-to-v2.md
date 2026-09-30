# 0016 - EXPERTOPTION_VENUE_REMOVAL v1 -> v2

Owner approval record and supersession entry for the removal of the untrusted
venue ExpertOption (WS-7 decision D2, WS-7 task T2).

rule: EXPERTOPTION_VENUE_REMOVAL
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0016-EXPERTOPTION_VENUE_REMOVAL-v1-to-v2.md)
date: 2026-09-29
approvalDate: 2026-09-26
historicalTradesAffected: none
source: >-
  WS-7 decision D2 and WS-7 task T2, `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1183-1192`
  (owner removal APPROVED 2026-09-26; landed 2026-09-29). Owner is recorded as
  the literal `WS-7+`. Master contract amended in
  `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md:29,37` (supersession
  annotation). The AC-7a seam-guard amendment is a separate owner decision,
  recorded in the T2 seam-guard decision record in the same spec and detailed
  under "Seam-guard amendment" below.

## Approval

The owner approved removal of ExpertOption on **2026-09-26**, after the full
inventory and blast radius were presented. This record is checked in and
**predates the first deletion** (2026-09-29), as WS-7 T2 acceptance requires.
The approval is not conditional on further owner input.

The approval basis was re-verified this session and still holds: the execution
paths were **already dead code**. `ensureSession` had 1 call site
(`autopilot.mjs:1191`) and `getDemoSession` had 3 (`brokers.mjs:42`,
`positionManager.mjs:61`, `trading.mjs:991`) — **4 call sites, 0
definitions** of either symbol anywhere in the server tree. The callers throw
and the throw is swallowed. Deleting the venue therefore removes a live capture
surface and dead execution, **not working order capability**.

## v1 -> v2

v1 treated ExpertOption as a venue awaiting re-engineering, blocked meanwhile
per the `executionAbsence` doctrine. v2 removes it outright. The change is
recorded rather than deleted because the reasoning — why an untrusted,
unregulated, unofficial-protocol venue was removed instead of deferred — is the
part a future reader needs.

reason: >-
  ExpertOption was an unofficial-protocol binary-options venue whose execution
  paths were dead code and whose connector was never robust. v1's plan
  ("re-engineer + ADR, blocked meanwhile") is superseded by removal. v1's
  "EO stays blocked" posture is not enough: the capture surface, the catalog
  row, the four endpoints and the browser-profile artifact were all still
  present and still claimed to be a supported venue. Removal deletes the
  capability rather than documenting that it is unusable.

## Measured blast radius

Measured from the working tree at removal time, not estimated:

- **11 files deleted** (3 production modules, 4 dedicated test files, 1 test
  helper, 1 extension selector, 2 liveEO-only test files):

  | Path | Kind |
  | :-- | :-- |
  | `apps/dashboard/server/services/expertoption.mjs` | production module (12 unofficial WS endpoints) |
  | `apps/dashboard/server/services/brokers/expertoption.mjs` | production adapter (`brokers/`) |
  | `apps/dashboard/server/services/liveEO.mjs` | production module (live WebSocket transport) |
  | `apps/extension-archived/src/selectors/expertoption.ts` | archived extension selector |
  | `apps/dashboard/server/__tests__/expertoption.test.mjs` | dedicated test |
  | `apps/dashboard/server/__tests__/expertoption.session.test.mjs` | dedicated test |
  | `apps/dashboard/server/__tests__/helpers/mockExpertOption.mjs` | test helper |
  | `apps/dashboard/server/__tests__/liveEO.test.mjs` | liveEO-only test |
  | `apps/dashboard/server/__tests__/liveEO.fetchThrottle.test.mjs` | liveEO-only test |
  | `apps/dashboard/server/__tests__/feedMode.test.mjs` | EO feed-mode test |
  | `apps/dashboard/server/__tests__/provenanceHeadless.test.mjs` | EO provenance test |

- **4 production exports removed** (each with its call sites): `ensureSession`,
  `getDemoSession`, `analyzeExpertOptionAsset`, `proAnalyzeExpertOption`, plus
  `captureExpertOptionSession` and `checkExpertOptionSessionLive` from
  `browserStudio.mjs`.
- **4 HTTP endpoints removed**: `/api/trading/analyze`,
  `/api/trading/pro/expertoption`, `/api/trading/feed-mode`,
  `/api/trading/demo`. The three siblings `/api/trading/demo/place`,
  `/api/trading/demo/analytics` and `/api/trading/demo/deals` are retained
  (non-EO paper-demo surfaces).
- **1 catalog row removed**: `streamCatalog.ts:125`.
- **1 registry row removed**: `captureProfiles.mjs` 10 profiles -> 9.
- **Net tracked diff**: +1187 / -5779 lines across 45 files.
- **1 gitignored artifact destroyed**: 109 files / 7,292,828 bytes (see
  Destruction below). The spec's "698 files / ~101 MB" is **stale** and was not
  used.

## Non-EO callers verified before removal

The four call sites were re-checked and none reached a definition, so no
working capability depended on them:

| Call site | Symbol | Definition |
| :-- | :-- | :-- |
| `autopilot.mjs:1191` | `ensureSession()` | none |
| `brokers.mjs:42` | `getDemoSession()` | none |
| `positionManager.mjs:61` | `getDemoSession()` | none |
| `trading.mjs:991` | `getDemoSession()` | none |

## Broker loader finding

`brokers/loader.mjs` self-registers adapters by import side-effect. Removing
`import "./expertoption.mjs"` leaves **3 adapters** (`ccxtAdapter`,
`yahooAdapter`, `paperAdapter` — the only files in `brokers/` besides
`index.mjs` and `loader.mjs` itself). The registry is **self-registering, not
length-pinned**: no ordinal or count assertion existed or was added, so the
adapter set changed without weakening any predicate.

## Seam-guard amendment (`ws5SeamGuard.test.mjs`)

WS-7 T2 required an amendment to the AC-7a venue freeze, and the **shape** of
the amendment matters. Two options were rejected before one was chosen:

- **Rejected:** pinning every touched frozen path into
  `WS7_T3_AUTHORIZED_VENUE_PATHS`. This permanently grants *write* access to
  `captureProfiles.mjs` — a silent erosion of the freeze this workstream exists
  to prevent.
- **Rejected:** editing the freeze's value alone. The T2 removal touches
  **three** of the six frozen venue paths, not one.
- **Adopted (owner decision, option 3):** amend the freeze's **semantics**.

The amendment distinguishes *deletion* from *capability addition*, because
AC-7a freezes venue **capability** and a removal is its opposite:

1. **Deleted paths are exempt by existence.** A frozen path that no longer
   exists is not a violation, and its presence in the authorisation set would
   grant permission to edit a file that is gone. Existence is checked on disk,
   so re-creating either file immediately re-freezes it.
2. **Surviving paths must not gain capability.** A surviving frozen path is
   allowed only if its capability surface does not grow relative to the WS-5
   baseline (`d400c70`). The surface is the union of three signals, all
   comment-stripped: registry row `id`s, exported bindings, import specifiers.
   **Any** growth is a violation.
3. **The freeze's intent is intact.** The other three frozen paths
   (`ccxtOrdering.mjs`, `commandCentre/policyGraphCatalog.mjs`,
   `venues/venueAdapterContract.mjs`) are unchanged and still frozen; the
   owner did **not** authorise ongoing edits to `captureProfiles.mjs`.
4. **The authorisation set is pinned** to its exact true two-entry value and
   asserted, so it cannot be widened to make the suite green.

**What the discriminator does NOT cover**, stated plainly because a guard whose
comment overstates its own coverage is a known failure mode here: it is a
capability-SURFACE check, not a semantic-equivalence proof. It does not compare
function bodies, so a capability change hidden inside an already-exported
function is classified subtractive and allowed — a reviewer must catch that. It
does not detect a renamed id reusing an existing id string, nor a capability
reached through a computed or aliased specifier. It **fails closed**: an
unreadable or absent baseline, or an unreadable file, is treated as a violation.

Proof, planted in the guard itself so a future weakening fails there:

- the real T2 diff is classified **subtractive** (allowed);
- three planted additive edits to the same path — a new venue row, a new
  export, a new import — are each classified **additive** (frozen);
- a row whose `id` did not exist at baseline is **additive** even though the
  file is the post-T2 one;
- an added export is **additive** on each of the three untouched frozen paths.

## Destruction

Operator-run, after re-verification, on 2026-09-29.

- **Path (re-verified immediately before deletion):**
  `apps/dashboard/server/data/browser-profiles/expertoption`
- **Final path component:** exactly `expertoption`
- **Not a link:** `lstat.isSymbolicLink() = false`, `readlinkSync` threw as
  expected for a real directory, attributes = `Directory`, `LinkType` empty,
  `Target` empty
- **Measured immediately before deletion:** **109 files, 7,292,828 bytes**
  (the spec's "698 files / ~101 MB" is stale and was not used)
- **Method:** per-file `unlinkSync` bottom-up, then `rmdirSync` on emptied
  directories only. No `rm -rf`, no `rmdir /s /q`, no `Remove-Item -Recurse
  -Force`. A link inside the tree could therefore only ever be unlinked as a
  link, never followed.
- **Result:** 109 files and 38 directories removed; target no longer exists.
- **Parent before:** `expertoption, opensea, probe-fp, repro2, studio`
- **Parent after:** `opensea, probe-fp, repro2, studio` — the four siblings
  survive.
- **Recovery:** the path is gitignored (`.gitignore:38`,
  `apps/dashboard/server/data/`) with **0 tracked paths**, so **git cannot
  restore it**. This destruction is irreversible. Any later capture starts from
  a fresh profile and requires a fresh manual login.

## D26 guard amendment (`ws7RegulatoryClaimGuard.test.mjs`) — deletion tolerance

`textFor()` read `join(REPO_ROOT, file)` with an **unguarded** `readFileSync`.
Its callers are the discovered `git ls-files` corpus (exists by construction) and
hand-pinned lists such as `INDEX_SENSE_FILES` (claims about files, which a venue
removal legitimately deletes). The two sets have different lifetimes, and the
unguarded read conflated them: deleting any one file from any pinned list threw
`ENOENT` and aborted the entire guard, so a single deletion silently disarmed all
29 tests across the whole corpus. That is a guard that weakens as the codebase
changes.

- **Change:** `existsSync` before the read, returning a `MISSING` sentinel rather
  than `""` so "absent" can never be confused with "present and empty";
  `haystacksFor` maps `MISSING` to zero haystacks, so a deleted file contributes
  zero matches. No predicate, regex, allowlist, or discovered-scope change; the
  guard still runs 29 tests.
- **Proof:** a planted nonexistent entry failed with
  `ENOENT ... scripts/__planted_nonexistent_entry.mjs` (1 failed / 28 passed);
  after the change the same plant passed 29/29; the plant was removed and the
  stale `scripts/list-watch-assets.mjs` entry dropped, and the guard then
  survived the real deletion of all six probe scripts at 29/29.
- **Teeth re-proved:** a real banned claim planted in `u4faConfig.mjs` still
  fails with `must stay clean of [standalone-dax-licensing]: expected 1 to be +0`.
- **Only one read site changed.** The six `ENTRIES_DIR` reads are driven by
  `readdirSync(ENTRIES_DIR)`, so their inputs cannot go stale and they were left
  alone.

## Import-resolution guard (`importResolutionGuard.test.mjs`)

The removal deleted `apps/extension-archived/src/selectors/expertoption.ts` and
left `capture.ts:14` importing it. The full dashboard suite was **green** while
that import pointed at a file that did not exist, because
`apps/extension-archived` is in neither the test nor the build graph. A guard
scoped to the file someone happened to remember would have missed the next one,
so the scope is the whole tracked tree, discovered from `git ls-files`.

- Reads specifiers from the **TypeScript AST**, not by regex. A regex produced 53
  false positives in three shapes: cache-busting specifiers
  (`../handlers.mjs?case=vault`), fixture source held in template literals
  (seam guards that build a fake module as a *string*), and — hiding among them —
  one genuinely broken import.
- `vi.mock(...)` specifiers count as dependencies, because vitest intercepts a
  mocked specifier and never loads the real module.
- **Real defect it caught:** `realtimeSuite.test.mjs` carried
  `vi.mock("../services/liveEO.mjs")` plus
  `await import("../services/liveEO.mjs")` for the deleted module and passed
  **8/8**. The green test could not see its own broken import; the guard did.
- **Teeth:** a planted `popup.tsx` import of `./selectors/expertoption` failed
  naming file, line and specifier; removing it returned the guard to green.
- **Coverage floor pinned** (>500 files, >1000 specifiers, and
  `extension-archived/src`, `server/` and `scripts/` all present) so a
  silently-empty sweep cannot pass.

## Client-call-path -> server-route guard (`clientRouteGuard.test.mjs`)

The removal deleted five routes and left **four** client call sites pointing at
them: `analyzeAsset` -> `/trading/analyze`, `proAnalyze` ->
`/trading/pro/expertoption`, `getBrokerDemoStatus` -> `/trading/demo`, and
`browserCaptureSession` -> `/browser/capture-session`. Two sat behind click
handlers and never fired on load; `getBrokerDemoStatus` was called on mount by
`AutopilotSuite` and produced live 404s on `/suites/trading/autopilot`, caught
**only** by the e2e assertion `expect(consoleErrors).toEqual([])`. The unit suite
was fully green. The import guard resolves *module* paths and the seam guard
inspects *venue files*, so neither could see an orphaned HTTP path. A red e2e is
not a guard: it runs last, it is slow, and it only covers pages someone thought
to visit.

- **Scope, stated so it is not overclaimed.** It checks one thing: a static,
  non-interpolated, root-relative string literal passed as the **first argument**
  to one of the client's own HTTP helpers (`get`, `post`, `put`, `patch`, `del`,
  `delete`, `request`). It deliberately does **not** check other string literals
  (router paths, assets, copy, CSS classes), template literals containing
  `${...}`, absolute or protocol-relative URLs, or non-`/`-prefixed paths. Flagging
  those is noise, and noise is how guards get switched off.
- **Stated bound:** the route set is harvested from `handlers.mjs`, so a route
  registered in another module would read as missing. The honest claim is
  therefore narrow — every static first-argument path passed to the client's HTTP
  helpers resolves to a route registered in `handlers.mjs`.
- Comments are stripped before harvesting. Without that, the
  `D2/AC-005: the X route is REMOVED` comments kept the deleted paths in the set
  and the guard reported zero orphans while three were live.
- **Teeth:** a planted `request("/trading/definitely-not-a-route")` failed naming
  `trading.ts -> /api/trading/definitely-not-a-route`; removing it returned the
  guard to green.
- **It earned its place immediately:** on first run it found a fourth live orphan
  I had missed — the now-uncalled `getBrokerDemoStatus` wrapper still requesting
  `/trading/demo`. The e2e had already gone green because the *caller* was
  removed, so the wrapper would otherwise have sat there indefinitely as a latent
  404 for the next caller.

## Unit floor rebase: 4025 -> 3946

The floor was **4025** passed / 1 skipped. The final post-removal measured count
is **3946** passed / 1 skipped, and the floor is rebased to the measured count.
(The count moved from 3943 to 3946 during this task purely because
`clientRouteGuard.test.mjs` was added, contributing 3 tests. The floor tracks the
measured number, not a number frozen before the last guard was written.)

**Justification.** The delta is tests whose subject no longer exists, not lost
coverage. The floor's purpose is catching regressions in what remains; pinning it
to a number that counts deleted modules would make it impossible to satisfy
honestly and would invite manufacturing assertions to close the gap.

**Per-file audit of what was removed and why.** Declaration counts at `HEAD`:

| Deleted test file | Declarations | Reason |
| --- | --- | --- |
| `__tests__/expertoption.test.mjs` | 38 | subject `services/expertoption.mjs` deleted |
| `__tests__/liveEO.test.mjs` | 12 | subject `services/liveEO.mjs` deleted |
| `__tests__/expertoption.session.test.mjs` | 11 | EO session transport deleted |
| `__tests__/feedMode.test.mjs` | 10 | feed-mode route + live-LEG health deleted |
| `__tests__/provenanceHeadless.test.mjs` | 4 | EO provenance headless path deleted |
| `__tests__/liveEO.fetchThrottle.test.mjs` | 3 | liveEO fetch throttle deleted |
| `__tests__/helpers/mockExpertOption.mjs` | 0 | test helper for a deleted module |
| **subtotal** | **78** | |

Modified test files with a non-zero declaration delta: `marketConvergence` 9->4,
`phases1216` 12->7, `startupHealth` 13->11, `ceremonyGates` 20->19,
`proanalysis` 20->19, `accountMetrics` 28->27 (**net -4**), against gains in
`ws5SeamGuard` 16->21, `browserStudio.login` 17->19, `extensionAbsence` 0->1,
`captureContracts` 6->7, `commandCentre.modeEngine` 24->25,
`commandCentre.sidecar` 46->47. Thirty further modified test files had no change
in declaration count.

**Why 4025 + 78 - 4 = 4099 is NOT the floor.** That sum is a *declaration* count
and it is not the same quantity as vitest's runtime tally: an `it.each` block is
one declaration that expands to many runtime tests, and helpers/wrappers are
counted once. The authoritative number is what vitest reports, so the floor is
the measured **3946**. Recording the proxy alongside it is the point — the
difference is the reconciliation, not a discrepancy to be explained away.

## Corrections to earlier statements in this task

- An earlier report cited `handlers.mjs:1651` as evidence that `reconnectTriggered`
  was absent from the API response. The line exists and does mention
  `reconnectTriggered`, but it is a **comment**, not API evidence, and it says
  nothing about `liveLeg`. The claim is **withdrawn**; the deletion of
  `reconnectTriggered` and `liveLeg` rests solely on a repo-wide search of 835
  tracked files, which found no consumer outside the producer, the test
  assertions, and prose.
- An earlier report cited "14 assertion sites". The precise figures at that point
  were **16** test sites — **14** asserting the field was present-and-false and
  **2** (`credentials.test.mjs:89,94`) asserting it was already absent. After
  conversion the 14 became 15 absence assertions, because paired
  `reconnectTriggered` + `liveLeg` lines became one `not.toHaveProperty` pair per
  report. The two pre-existing absence assertions were kept, not deleted.
