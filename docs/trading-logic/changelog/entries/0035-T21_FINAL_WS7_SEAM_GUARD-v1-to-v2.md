# 0035 - T21_FINAL_WS7_SEAM_GUARD v1 -> v2

Execution record for WS-7 task T21: the final seam guard — the last of the three
gates in the bisect matrix (BS-4), and the gate that reads the other two's verdicts
rather than re-deriving them.

rule: T21_FINAL_WS7_SEAM_GUARD
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0035-T21_FINAL_WS7_SEAM_GUARD-v1-to-v2.md)
date: 2026-10-02
historicalTradesAffected: none
reason: >-
  AC-046 requires a gate that enumerates the twenty-one invariants the spec lists
  and fails on any of them, and AC-048 requires that a gate never seen to fail is
  not accepted as working. Neither is obtainable by asserting that a guard exists:
  the vocabulary has to be closed at twenty-one so a row cannot be dropped, every
  row has to be observed failing as a real process with a non-zero exit code, and
  the deliberate open items have to be visible without being allowed to move the
  verdict. So the decision function is a separate spawnable module over a
  measurement probe, and its own test drives the CLI as a subprocess.

  The gate is RED on this repository. That is the finding, not a defect in the gate:
  three of the twenty-one are genuinely unsatisfied, one of them because the spec
  contradicts itself (see below), and none of the three is papered over.
source: >-
  WS-7 task T21 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1381-1388`,
  acceptance criterion **AC-046** and **AC-048** (`:1148-1160`), decision **D27**
  (`:365-372`), the bisect matrix row **BS-4** (`:1399`), the twenty-one-check list
  at **`:1386`**, the honesty notes at **`:1476`** and **`:1513`**, the risk-control
  table rows "Rooms stall at reserved" (`:1450`) and "Venues / adapters are not
  flat" (`:1455`), and T19's gate discipline in entry `0033`
  (`docs/trading-logic/changelog/entries/0033-T19_PERFORMANCE_MEMORY_ARM_TIER-v1-to-v2.md`)
  with T20's scoped-room discipline in entry `0034`
  (`docs/trading-logic/changelog/entries/0034-T20_CROSS_ROOM_INVARIANT_GATE-v1-to-v2.md`).

- **Task:** WS-7 T21 — the final seam guard (AC-046 / AC-048, spec `:1381-1388`)
- **Branch state at close:** unlanded; no push performed
- **Registry status:** `ACTIVE-DRAFT` — **unchanged**, and T21 may not change it
- **Verdict:** **the gate is RED on this repository, by measurement, and that is the finding.**

---

## 1. What was built

| File | Role |
| :-- | :-- |
| `scripts/ws7-seam-probe.mjs` | measures every artefact; writes no judgement |
| `scripts/ws7-seam-guard.mjs` | the closed 21-row decision function + CLI |
| `apps/dashboard/server/__tests__/ws7SeamGuard.test.mjs` | 70 tests, including the guard's own `--fail-branch` processes |

Run it with `node scripts/ws7-seam-guard.mjs`. Exit **1** today.

## 2. The twenty-one, each with its verdict

Measured live against this tree. `budget` is the numeric threshold the measurement is
compared against; no row asserts its own outcome.

| # | check | kind | verdict | measured | budget |
| --: | :-- | :-- | :-- | --: | :-- |
| 1 | `absence.discovered-scope-complete` | blocking | pass | 0 | at-most 0 |
| 2 | `venue.expertoption-residue` | blocking | **FAIL** | **28** | at-most 0 |
| 3 | `perps.cancel-member-present` | blocking | pass | 0 | at-most 0 |
| 4 | `agents.no-wildcard-cors` | blocking | pass | 0 | at-most 0 |
| 5 | `secrets.no-plaintext-key` | blocking | pass | 0 | at-most 0 |
| 6 | `model.no-pickle-load-path` | blocking | pass | 0 | at-most 0 |
| 7 | `engine.weight-sum-exactly-100` | blocking | pass | 0 | at-most 0 |
| 8 | `engine.tier-boundary-single-authority` | blocking | pass | 0 | at-most 0 |
| 9 | `engine.veto-inspectable` | blocking | pass | 0 | at-most 0 |
| 10 | `authority.separation-of-duties` | blocking | pass | 0 | at-most 0 |
| 11 | `retention.classes-declared` | blocking | pass | 0 | at-most 0 |
| 12 | `ram.gate-exists-and-last-result` | evidence | pass | 9 | at-least 9 |
| 13 | `arm.probe-artifact-present` | evidence | pass | 8 | at-least 8 |
| 14 | `budget.every-row-verdicted` | evidence | pass | 12 | at-least 12 |
| 15 | `deps.no-unused-dependency` | blocking | **FAIL** | **1** | at-most 0 |
| 16 | `perps.cancelOrder-blocked-and-seam-exposed` | blocking | pass | 0 | at-most 0 |
| 17 | `catalog.claims-gone-entries-stay` | blocking | **FAIL** | **1** | at-most 0 |
| 18 | `lockfile.single-and-no-pnpm` | blocking | pass | 0 | at-most 0 |
| 19 | `docs.camouflage-policy-linked` | blocking | pass | 0 | at-most 0 |
| 20 | `docs.typing-invariant-states-boundary` | blocking | pass | 0 | at-most 0 |
| 21 | `rooms.completeness-verdict-declared` | blocking | pass | 0 | at-most 0 |

**18 pass · 3 FAIL · exit 1.** The split is 15 checks from spec `:1386` plus the six
added by the 2026-09-26 round (D22, D23, D24, D25, D26, D27), and the test asserts
that arithmetic so a row cannot be quietly dropped.

Seventeen rows are owned by a named existing guard (recorded in `ownedBy`); four are
T21's own — `venue.expertoption-residue`, `deps.no-unused-dependency`,
`docs.camouflage-policy-linked`, `docs.typing-invariant-states-boundary` — and are
named rather than anonymously borrowed.

## 3. The three blocking findings

### 3.1 `venue.expertoption-residue` — 28 identifiers across 11 files

ExpertOption was removed in T2, but 28 occurrences of its identifier vocabulary
survive in **comment-stripped** production code. One is not cosmetic:

`scripts/capture-eo-session.mjs` **imports `captureExpertOptionSession`, which T2
deleted.** That script cannot run. It is dead code that a reader would reasonably
assume is live.

The other ten files (`browserStudio.mjs`, `connectors.mjs`, `packObservers.mjs`,
`scheduler.mjs`, `venueCredentials.mjs`, `AutopilotSuite.tsx`, `DataSourcesPanel.tsx`,
`SourceBadge.tsx`, `TradingChart.tsx`, `trading.ts`) carry the identifier in strings
and labels only.

**Owner decision required:** delete the capture script and re-label the rest, or
record that the labels are deliberate historical vocabulary. T21 did not choose.

### 3.2 `deps.no-unused-dependency` — 1

`apps/extension-archived/package.json` declares `plasmo ^0.90.0` with no importer
anywhere in the tree.

**Owner decision required:** drop the declaration, or record why an archived
extension keeps it.

### 3.3 `catalog.claims-gone-entries-stay` — 1 (**the conjunction fails on its second half**)

D26 reads "*unverifiable third-party regulatory claims are **deleted** — entries stay,
claims go*". Measured as a conjunction:

| half | result |
| :-- | :-- |
| `no-regulatory-claim` | **OK** — no unverifiable claim survives |
| `d26-catalog-entries-still-present` | **FAIL** — **0 of 8** rows present |

The eight rows (`luno`, `mx-global`, `hata`, `sinegy`, `kinetic`, `funding-circle`,
`selangor-kuasa`, `pitik`) were removed by **T7b**, under D20 record `0019`. So D26's
first half is satisfied and its second half is **unsatisfiable as written** — the
later decision contradicts the earlier one.

A guard checking only "*no claims*" would pass today. That is precisely why the row is
a conjunction, and T21 proves it: flipping either half independently turns the check
red, and a claims-only variant is asserted to be green on this tree.

**This is a specification contradiction, not an implementation defect.** It cannot be
made green without an owner ruling: either D26 is amended to say the entries were
removed, or the eight rows are restored.

## 4. The two conjunctions, proven both halves

**D23** (`perps.cancelOrder-blocked-and-seam-exposed`) — passes both halves:
`"cancelOrder"` is **still** in `ccxtConnector.mjs`'s `READ_ONLY_BLOCKED` for
non-seam modules, **and** the sanctioned `hyperliquidPerps` seam exposes the gated
member. The adapter really has the member (`hyperliquidPerps.mjs:567`, exported at
`:618`) and really gates it through `modeOf()` — measured from a live module import,
not asserted. Flipping either half turns it red.

**D26** — see §3.3.

## 5. A gate never seen to fail is unverified

All twenty-one checks are observed failing as real processes:
`node scripts/ws7-seam-guard.mjs --fail-branch <id>` is spawned once per check and its
**exit code** is read. Each exits non-zero. `--checks` prints all 21 ids;
`--open-item-branch` exits **0**, proving open items cannot move the exit code.

## 6. Honest incompleteness is surfaced, not hidden

Seven open items are printed with counts. None can change the verdict.

| item | count | classification |
| :-- | --: | :-- |
| `route-auth-verdicts-deferred` | 62/74 | DELIBERATELY DEFERRED |
| `rooms-honestly-incomplete` | 2/18 | HONEST INCOMPLETENESS |
| `changelog-handoffs-open` | **28/34** | CARRIED FORWARD |
| `budget-rows-not-passing` | 9/12 | RECORDED NON-PASS |
| `write-affordances-in-read-only-room` | 2 | OWNER DECISION — surfaced, not removed |
| `ws7-tasks-without-a-commit` | 3/21 | OPEN TASK (T14, T17, T18) |
| `ci-workflow-whitelist-deviation` | 1 | OWNER DECISION — answered, amendment not taken |

Non-passing budgets, by id: **B1 BREACH, B2 WITHDRAWN_UNMEASURED, B3 BREACH,
B4/B7/B8 UNMEASURED, B9/B11 UNVERIFIED, B12 PARTIAL_VERIFICATION.** Nothing became
a pass to make this list shorter.

### 6.1 A counting error of T21's own, found and recorded

The handoff count first read **26**. That was wrong: it counted the *phrase*
`STILL OPEN`, and entries 0030 and 0031 mention it in prose. Counting **table rows**
gives the real figure.

The count is also **self-referential**, deliberately: writing this entry's own handoff
table (§11) adds six open rows to the number the gate reports. That is correct — a
guard that excluded its own entry would understate the work it had just created — so
the count moves and the test moves with it.

| source | rows | open |
| --: | --: | --: |
| entry 0028 | 14 | 11 |
| entry 0032 | 14 | 11 |
| entry 0035 (this one) | 6 | 6 |
| **total** | **34** | **28** |

The owner stated **15** open handoffs. That reconciles to neither 28 nor 34, and no
reading of the tables yields 15. The measured 28 is reported; **the owner's 15 is not
silently replaced** — reconciling it requires a ruling on which rows are in scope
(e.g. only handoffs whose owner is a WS-7 task rather than a named downstream owner).
Recorded as `0035-4`.

## 7. The five owed items

| owed item | disposition |
| :-- | :-- |
| T14/T17/T18 unlanded | **NOT LANDED**, measured from `git log --format=%s --all`: a task with no commit subject naming `WS-7 <task>` has not landed. Surfaced as an open item, not worked around. |
| T20's stale room count (7 vs measured) | **CORRECTED**. Actual figure was **18**, not 7. All 18 corrected 18→22 in the spec; `STALE_INSTANCE_COUNT_IN_SPEC` keeps T20's 7-site record *and* adds the measured 18-site list. T20's gate was strengthened, not relaxed. |
| `0032` affordance count | **CORRECTED** "seven" → **twelve** (twenty-five affordances). D20 guard still green. |
| T19 artifact / 2 GB gate | **CORRECTED in `PICC.md`**: the ARM artifact **is** checked in and B10 **is** measured (`ram-ceiling-gate.json`, peak 372.1 MB vs a 2048 MB ceiling, `pass`, 17 samples). Both stale claims are quoted-and-corrected, not erased. |
| `contracts.ts` D25 citation | **CORRECTED** to cite `src/terminal/domain/copilot.ts:84` and re-export `src/terminal/index.ts:81`. |

## 8. CI question, answered

`.github/workflows/ci.yml` already runs `npm test` in the test job, and runs T13's
`node scripts/model-digest-gate.mjs --fetch` standalone — so a standalone
plain-`.mjs` gate job for this guard is feasible and has precedent.

**No workflow was edited.** `.github/workflows/**` is outside spec §0.3(d)'s file-touch
whitelist, and entry `0025` leaves that amendment with the owner. Recorded as
`ci-workflow-whitelist-deviation`.

## 9. Spec and registry contradictions found — recorded, not silently rewritten

1. **D26** — "entries stay" vs T7b's removal of all eight. §3.3. Unsatisfiable as written.
2. **B2** — `budget-verdicts.json` and `PICC.md` record D21 **withdrawing** the
   ~1800 ms ARM figure as unsound, but spec `:1368` and AC-045 (`:1125`) still assert
   B2 "ratified at ~1800". The withdrawal governs; the stale prose is left in place and
   flagged, because rewriting an acceptance criterion to match an outcome is the
   reviewer's call, not the implementer's.
3. **§10 row count** — T21 recounted the registry twice and got it wrong both times.
   It first counted **41** by skipping the bolded `PICC_V3_2_LAYERED_ENGINE_REBUILD_v1`
   row, then "corrected" the heading to **42** by including the `notes/` path row.
   `ws3CeremonySeamGuard.test.mjs` failed loudly and named the rule it had always
   used: table rows, minus header, separator, and the one `notes/` row — which is a
   note, not a registry spec. **The heading's original `41 registry rows` was
   correct all along.** T21 adopted WS-3's existing documented rule instead of
   proposing a second, competing definition: when two guards disagree about how to
   count the same table, the second author is wrong, not the first rule. The
   double error is recorded in `PICC.md` and in the test that now pins 41 on
   WS-3's rule.
4. **Guardrail 1's perps bullet** still described the pre-T3 adapter as having no
   `cancel` member. Corrected, with the prior wording quoted.

Both counts are now pinned by tests that measure them independently of the code under
test, and the `§10` count follows WS-3's existing rule rather than a new one, so neither
the `19`-vs-`17` owner count, the `26`-vs-`28` handoff count, nor the `41`-vs-`42` row
count can drift again.

## 10. Ship readiness

**NOT READY.** The gate is red on three measured findings, two of which need an owner
ruling that is not implementer's to make (D26's contradiction; the `plasmo`
declaration and the dead capture script). T14, T17 and T18 have never landed, so WS-7
cannot be called complete regardless of the gate. T21 made no registry change and
pushed nothing.

## 11. Handoffs added by this entry

| id | obligation | status | owner |
| :-- | :-- | :-- | :-- |
| 0035-1 | Rule on D26: amend "entries stay", or restore the eight catalog rows | **STILL OPEN** | spec owner |
| 0035-2 | Resolve the 28 ExpertOption residues, starting with the unrunnable `capture-eo-session.mjs` | **STILL OPEN** | WS-7 T21 owner |
| 0035-3 | Drop or justify `plasmo` in `apps/extension-archived/package.json` | **STILL OPEN** | WS-7 T21 owner |
| 0035-4 | Reconcile 22 measured open handoffs with the stated 15 | **STILL OPEN** | changelog owner |
| 0035-5 | Amend §0.3(d) or authorise a CI job for this gate | **STILL OPEN** | spec owner |
| 0035-6 | Reconcile spec `:1368` / AC-045 with D21's withdrawal of B2 | **STILL OPEN** | spec owner |