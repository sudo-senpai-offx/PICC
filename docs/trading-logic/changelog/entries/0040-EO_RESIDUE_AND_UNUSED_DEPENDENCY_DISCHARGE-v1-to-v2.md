# 0040 - EO_RESIDUE_AND_UNUSED_DEPENDENCY_DISCHARGE v1 -> v2

Discharge of two of WS-7 T21's three blocking seam-guard findings
(`venue.expertoption-residue` and `deps.no-unused-dependency`), by removing
the residue they measured.

rule: EO_RESIDUE_AND_UNUSED_DEPENDENCY_DISCHARGE
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0040-EO_RESIDUE_AND_UNUSED_DEPENDENCY_DISCHARGE-v1-to-v2.md)
date: 2026-10-03
approvalDate: 2026-10-03
historicalTradesAffected: none
source: >-
  Owner instruction for this task, given 2026-10-03: clear TWO of the three red
  checks on WS-7's final seam guard — `venue.expertoption-residue` (measured 28,
  budget 0) and `deps.no-unused-dependency` (measured 1, budget 0) — leaving
  `catalog.claims-gone-entries-stay` (measured 1) untouched because it needs an
  owner ruling. WS-7 spec :1386 "no ExpertOption residue" and "no unused
  dependency" (`scripts/ws7-seam-guard.mjs:178,321`; :218, :764). Underlying
  decisions: **D2** (ExpertOption removal, approved 2026-09-26, landed
  2026-09-29, record `0016`) and **D20/T7b** (13 catalog rows removed, 7 sourced
  replacements added, 2026-09-30, record `0019`). Owner is recorded as the
  literal `WS-7+`.

## v1 -> v2

v1 recorded two findings as red rather than quietly greening them. v2 removes
the thing each finding measured, so the measured quantity reaches its budget and
the guard's own pins are re-pinned to the new truth.

reason: >-
  T21's seam guard exited 1 on three blocking checks. Two of them were not
  defects in the guard but unfinished work from D2: the ExpertOption venue was
  removed on 2026-09-29 while its credential field, connector row, site-registry
  row, scheduler gate and four client-side source branches were left behind, and
  `scripts/capture-eo-session.mjs` was left importing the `captureExpertOptionSession`
  T2 had deleted, so the module could not run. The third finding — that `plasmo`
  was declared in a manifest with no production importer — turned out to be a
  true reading of a dependency that nothing installs. The change is recorded
  rather than applied silently because the interesting part is the RULE used to
  decide what was residue and what was history, and because re-pinning a
  deliberately-red guard is exactly the move that can hide a regression.

## The residue/record rule, and the evidence it is the rule actually in force

**Rule.** An occurrence is **residue** if and only if it survives `stripComments()`
(`stripPythonComments` for `.py`) in a file enumerated by `productionFiles()`
from `git ls-files`. An occurrence that appears only inside a comment or a
docstring is **record**: it is blanked before measurement, so it is neither
counted nor deleted.

**The guard already implemented this rule correctly, so the guard's
discrimination was NOT changed.** That was verified, not assumed. `stripper`
proof run this task: every source line naming the removed venue was classified
KEPT (survives stripping → live code) or STRIP (removed → record). The
discriminating cases:

| File | Raw mentions | Measured | Why |
| :-- | --: | --: | :-- |
| `services/trading.mjs` | 10 | **0** | all ten are `// D2/AC-005 …` comments |
| `services/commandCentre/policyGraphCatalog.mjs` | 4 | **0** | all four are comments |
| `services/proanalysis.mjs` | 4 | **0** | all four are comments |
| `services/browserStudio.mjs` | 23 | **3** | three live literals; the other 20 are comments |

`trading.mjs:6-1033`, `policyGraphCatalog.mjs:23-84` and `proanalysis.mjs:47-824`
hold their entire mention set inside comments, which is why the task brief's raw
occurrence counts for those files did not correspond to the measured 28.

Two proofs that the rule still bites after this change (both run, both reverted):

1. **Residue bites.** Re-adding a live `expertoptionToken` read to
   `venueCredentials.mjs` `getCredentials` flipped the check to
   `FAIL measured=2` and named `venueCredentials.mjs :: expertoptionToken`. The
   plant was removed and the check returned to `pass measured=0`.
2. **Record does not bite.** With the same field named only inside a comment,
   the check reported `pass measured=0` while the string was physically present
   on disk. Residue and record are distinguished by stripping, and both halves
   of that distinction were exercised after the change.

## What was removed, and why each item was residue rather than record

Measured 28 → 0. Corpus 409 → 408 files (the one deletion is the script below);
the corpus did not narrow, which is what rules out "passing by inspecting less".

| File | Was | Why residue |
| :-- | --: | :-- |
| `services/venueCredentials.mjs` | 7 | live `expertoptionToken` in the credential store's read + persist. T2 deleted its only writer (`captureExpertOptionSession`), so the field could be written by nothing but the UI and read by nothing at all. |
| `services/browserStudio.mjs` | 3 | live `SITE_INDEX` row, `SITE_TO_CONNECTOR` mapping, and the `site?.id === "expertoption"` login-account branch. Also removed, unmeasured but EO-only in code I was already editing: the `PLATFORM_KINDS` entry, the `LOGIN_HINTS` entry (the map is kept and now empty), the unreferenced `EO_CAPTURE_COOLDOWN_MS`, and `isLiveStreamTab` + its `freezeTab` exemption. |
| `services/packObservers.mjs` | 2 | live `creds.expertoptionToken` gate in `observeEoCapture`, plus the `running` branch it gated — unreachable without both a credential and a live transport, and `scheduler.mjs:352` already passed `liveStats = {}`, so neither existed in production. |
| `services/connectors.mjs` | 1 | live `registerConnector({slug:"expertoption"})` row whose `ws` transport was the `expertoption.mjs` client T2 deleted. |
| `services/scheduler.mjs` | 1 | live `gates.hasCredentials` on the `p1-1-eo-session-capture` run. **Omitted rather than passed `false`**, because `envelopeGate` tests `gates.hasCredentials !== true` (`packRunner.mjs:68`), so omission is behaviourally identical — the l-class step keeps stopping at the login gate. |
| `src/lib/trading.ts` | 3 | `TradingCredentials.expertoptionToken / expertoptionDemo / expertoptionWsUrl`. The server stopped reading, defaulting and writing all three when it removed the venue's only writer (`trading.mjs:92-104` `DEFAULT_CREDS`), so the interface had been declaring a shape no response carried. |
| `src/components/AutopilotSuite.tsx` | 5 | live reads of `raw.expertoptionToken` / `raw.expertoptionDemo` and the patch that wrote them, plus the session-token input and Demo-account toggle that fed them. The panel's `demo?.configured` guard already read a field `demoStatus()` stopped emitting (`autopilot.mjs:977-1008` returns no `configured`), so the panel was already vestigial. |
| `src/components/TradingChart.tsx` | 2 | live canonicalisation of the legacy `live`/`buffer` tags to the `"expertoption"` slug, and the `"ExpertOption"` label branch. |
| `src/components/SourceBadge.tsx` | 1 | live `"expertoption"` entry in the `isEo` slug list. |
| `src/components/DataSourcesPanel.tsx` | 1 | live `b.slug === "expertoption"` diagnosis branch, plus the `COVERAGE.expertoption` row. |
| `scripts/capture-eo-session.mjs` | 2 | **DELETED, not emptied** — see below. |

### The `capture-eo-session.mjs` case specifically

It was the sharpest instance of the finding and the only one that was not merely
dead text. It imported `captureExpertOptionSession` from
`apps/dashboard/server/services/browserStudio.mjs`, and T2 removed that export, so
the module could not run at all — its import could not resolve. Nothing else in
the tree referenced it. It is therefore **deleted** rather than left as a
commented-out husk: a file that cannot start is not history, it is a trap.

Recorded rather than assumed: `ws5SeamGuard.test.mjs` never froze this path, so
no venue-freeze authorisation was consumed. The `D2/AC-005: captureExpertOptionSession
is REMOVED` record inside `browserStudio.mjs` is untouched and is still asserted.

### What was deliberately NOT touched

- **The other 11 dead EO scripts** under `scripts/` (`eo-storage-dump.mjs`,
  `eolist-xhr.mjs`, `inspect-eo-assets.mjs`, `inspect-eo-page.mjs`,
  `inspect-eo-picker.mjs`, `probe-eo-list.mjs`, `probe-eo-url.mjs`,
  `sniff-eo-candles.mjs`, `sniff-eo-deep.mjs`, `sniff-eo-token.mjs`,
  `sniff-eo-ws.mjs`, `keep-studio-open.mjs`). They measure **0**: their only
  venue text is `studioGoto("https://app.expertoption.com/")`, a URL, and the
  vocabulary's `expertoption` token matches only the bare quoted literal
  `"expertoption"` / `'expertoption'`. They still run — `studioGoto` and friends
  survive — so they are dead *tooling for a removed venue*, not broken modules.
  Removing them is an owner call and gains no measured ground.
- **The `p1-1-eo-session-capture` pack step.** The step id is not vocabulary, the
  step is a declared member of `packOneDefinition()`, and it is the canonical
  registry fixture across six test files (`packRegistry`, `packRegistryApi`,
  `packRunner`, `packObservers`, `rateLimitClientIdentity`,
  `PackRegistryStrip.test.tsx`). It survives; only its credential gate is gone.
- **`streamCatalog.ts`** — T7b's outcome (13 rows removed, 7 added) is untouched.
- **EO-labelled UI copy** the guard does not measure, e.g. `"EO studio"` /
  `"EO buffer"` label strings in `SourceBadge.tsx` and the `loginPathway()` steps
  in `packObservers.mjs` that still name the venue's app tab. Recorded as
  remaining EO text for the owner.
- **The AC-7a venue freeze.** None of the 13 files is in
  `VENUE_PATHS` (`ws5SeamGuard.test.mjs:155-164`), so the freeze neither
  authorised nor constrained this change; `ws5SeamGuard` passes unchanged.

## Finding 2 — `plasmo`, and why the dependency was removed rather than the guard taught

`apps/extension-archived` is **dead, and tracked as dead**, on five independent
pieces of evidence:

1. `README.md:25` lists it as "**Archived** — Plasmo skeleton, no trading
   features" with the technology column reading "Plasmo (**unused, historical**)".
2. `PICC.md:130` — "the extension era was removed end-to-end (D1);
   `apps/extension-archived/` is the retired Plasmo skeleton"; `PICC.md:730`
   ("F1 | Plasmo duplicate tree | archived"), `PICC.md:198-199`, `PICC.md:993-995`
   agree.
3. It is **not an npm workspace**: `package.json` declares
   `workspaces: ["apps/dashboard"]`, so `npm install`, `npm run build`,
   `npm run typecheck` and `npm run test` never touch it.
4. `plasmo` is **absent from `package-lock.json`** and **absent from
   `node_modules/plasmo`**. It is not installed, therefore it is not a dependency
   of this repository.
5. `importResolutionGuard.test.mjs:7` states it is "not in the dashboard's test
   or build graph" — the guard's own header, written before this task.

So the dependency was unused, and the honest fix was to remove the **declaration**.
The alternative — teaching the guard that an archived-but-tracked workspace counts
as an importer — was rejected for two reasons. First, it would widen
`productionFiles()`, which is shared with the residue check, changing what a
different guard inspects to fix this one. Second, and more importantly, it would
have made the check pass by asserting a falsehood: the archived app's `dev`,
`build` and `package` scripts invoke `./node_modules/plasmo/bin/index.mjs`, and
plasmo cannot be installed from this repository, so those scripts were already
unrunnable and remain so. A guard that reports a live importer for a package
nothing can install is a guard that has stopped measuring.

**Stated consequence:** `apps/extension-archived/package.json` no longer declares
the package its own (unrunnable) scripts name. That inconsistency is the honest
end state for an archived skeleton, and it is recorded here rather than papered
over by re-adding the declaration. The tree itself is **retained** — it is
tracked history, `importResolutionGuard.test.mjs:324` pins
`apps/extension-archived/src` as present, and `ws7RegulatoryClaimGuard` allowlists
`apps/extension-archived/src/content.tsx` with a pinned occurrence count.

## Guard re-pin — and why the pins were made stronger, not weaker

`ws7SeamGuard.test.mjs` pinned the findings deliberately red. Discharging them
means re-pinning to the new measured truth, **not** deleting the assertions. The
`describe` block is renamed from "produces THREE blocking findings" to "produces
ONE", and:

- the failing-id list is now exactly `["catalog.claims-gone-entries-stay"]`;
- `venue.expertoption-residue` asserts `measured === 0` **and** `verdict === "pass"`
  **and** an empty hit list **and** `filesScanned > 300`, **and** — the part that
  makes the zero mean something — that each of the ten files it used to name is
  still inside `productionFiles()`' corpus;
- `capture-eo-session.mjs` is asserted **absent from disk**, while
  `browserStudio.mjs` is still asserted to lack the export and to still carry the
  `D2/AC-005` removal record;
- `deps.no-unused-dependency` asserts `measured === 0`, `unused === []`, and
  that the archived manifest is **still read** (its two surviving runtime deps
  appear in the declared set under its own path) rather than skipped;
- the D26 finding is untouched.

To make that last claim assertable, `ws7-seam-probe.mjs` now also surfaces
`detail.dependencies.declared` alongside `declaredRuntime` and `unused`. This is
purely **additive** — no predicate, regex, allowlist or measured value changed,
and `declaredRuntime` still reports the same number the check compares against.

## Verification measured on this change

- `npm run typecheck` — exit 0.
- `npm run test --workspace @picc/dashboard` — **5373 passed / 1 skipped / 0
  failed** (382 files: 381 passed, 1 skipped), run **three times**, identical
  every time. Floor was 5371; net **+2** tests.
- `node scripts/ws7-seam-guard.mjs` — `verdict fail; 1 failing check(s)`, exit 1.
  The single failure is `catalog.claims-gone-entries-stay`, **measured 1**,
  unchanged, and its `no-regulatory-claim` half still `OK`. Both discharged
  checks read `pass … measured=0 at-most budget=0`.
- `npm audit --audit-level=high` — exit 0; 3 moderate, **0 high / 0 critical**.
- `git diff --check` — exit 0, no whitespace errors.
- Exactly **one** tracked lockfile: `package-lock.json`. No `pnpm-lock.yaml`, no
  `pnpm-workspace.yaml`, and no `package.json` field re-implying pnpm.
- Nothing under `apps/dashboard/server/data/` or `.playwright-tmp/`.
- `ws7SeamGuard.test.mjs`, `ws5SeamGuard.test.mjs`, `ws7TestStoreIsolation.test.mjs`,
  `importResolutionGuard.test.mjs` and `ws7RegulatoryClaimGuard.test.mjs` — 150/150,
  so the store-isolation and import-resolution guards are green on the committed
  tree rather than only in the working copy.
- No e2e run.

### Unit-floor delta, itemised

Net +2 (5371 → 5373). The floor moved **up**, so nothing had to be rebased
downward, but the individual changes are recorded because a count that moved
needs its reasons visible:

| Change | Count |
| :-- | --: |
| Baseline (T21) | 5371 passed / 1 skipped |
| `autodetect.test.mjs` — added "no longer matches the removed venue's origin" | +1 |
| `registry.generalization.test.mjs` — added "no expertoption row survives" | +1 |
| `connectors.test.mjs` — enumeration test split EO from the surviving list (same test) | 0 |
| `packObservers.test.mjs` — 4 "running"-state tests replaced by 2 assertions (one terminal-state, one degraded-cleared regression) | −2 |
| `ws7SeamGuard.test.mjs` — finding block restructured 6 → 6 `it()`s | 0 |
| Six other EO-subject tests re-pointed at surviving venues (`iqoption`, `aave`, `binance`) | 0 |
| **Total** | **5373 / 1 / 0** |

## Spec observations for the owner — recorded, not acted on

1. **`browserStudio.mjs`'s `SITE_INDEX` is a second venue catalog that T7b
   deliberately left alone.** Record `0019` removed 13 rows from
   `streamCatalog.ts` and states at :87-92 that `browserStudio.mjs:485-492`
   "also name some of these venues … they are out of scope for this decision and
   were left untouched." Those rows are **still there** — `luno`, `mx-global`,
   `hata`, `sinegy`, `kinetic`, `funding-circle`, `selangor-kuasa`, `pitik` — so
   the browser-studio catalog still lists eight venues the owner removed from the
   income catalog. This entry removed only the `expertoption` row from it, because
   that is what D2 requires and what the guard measures. **The remaining eight are
   untouched and need an owner ruling.**
2. **The residue vocabulary is narrower than "ExpertOption".** It pins three
   shapes: credential fields, venue functions, and the bare quoted slug literal
   `"expertoption"`. A venue **URL** (`https://app.expertoption.com/`) is
   deliberately not one of them. That is why 11 dead EO scripts measure 0, and why
   EO-labelled UI copy remains. Widening the vocabulary is an owner decision: it
   would change what the check inspects for every future run.
3. **`capture-eo-session.mjs`'s deletion is the only removal whose absence is now
   asserted by a guard.** The other removals are asserted as counts. If the owner
   wants the site-row and connector-row removals individually pinned, that is a
   small addition and is not done here.
4. **Line endings.** `.gitattributes` pins `*.mjs`/`*.ts`/`*.tsx` to `eol=lf`, and
   `core.autocrlf` is `true`, so `git diff --check` prints "CRLF will be replaced
   by LF" for every touched `.mjs` on a Windows checkout. That is the repository's
   own normalisation doing its job, not whitespace damage; `git diff --check`
   exits 0 and `--stat` shows only the intended lines.
