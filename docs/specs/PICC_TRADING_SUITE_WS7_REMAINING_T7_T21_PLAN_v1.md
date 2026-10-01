# PICC Trading Suite — WS-7 remaining work (T7 remainder → T21) — execution plan v1

**Date:** 2026-09-30 · **Kind:** execution plan · **Status:** `ACTIVE-DRAFT` · **Implements:**
`docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md` (referred to as **the spec**) ·
**Baseline read:** `master @ 857443e`, clean tree, 0 unpushed.

**Scope of this document.** A plan only. No application code, test, or spec was modified. Every
claim below is anchored to a `file:line` read during this planning session against `857443e`, or is
marked `UNVERIFIED`. The spec's 27 ratified decisions (D1–D27) are treated as settled and are not
re-derived; where the spec is internally inconsistent, this plan names the defect and routes it to the
owner rather than picking a winner.

---

## 0. Verified baseline

Measured this session, not inherited.

| Fact | Value | Anchor |
|---|---|---|
| HEAD | `857443e` "WS-7 T7: room instances 1-2 of 18 - Markets/COP-22, then Risk" | `git log` |
| Working tree | clean, 0 changed paths | `git status --porcelain` |
| Unpushed | 0 | `git status` |
| BS-1 (T0–T6) | complete, 7 commits from `b32affb` through `857443e` | `git log --oneline -6` |
| Unit floor | **4000 passed / 1 skipped / 0 failed** across 329 files (3946 floor + 11 entry 0020 + 26 Markets + 17 Risk) | `docs/trading-logic/changelog/entries/0021-T7_MARKETS_AND_RISK_ROOMS-v1-to-v2.md:250,259-261` |
| `npm audit --audit-level=high` | **exit 0**; 3 moderate advisories total | measured this session |
| Moderate advisories | `qs` (1 install, sole dependent `stripe` — verified), `@vitest/mocker`, and direct `vitest` | `package-lock.json` walk + `npm audit --json` |
| CI jobs | `secrets-scan`, `lint-and-typecheck` (ubuntu/ubuntu-arm/windows), `test` (same 3 OS), `smoke-trading`. **No Playwright leg** — `smoke-trading` runs `npm run smoke:trading`, not `test:e2e` | `.github/workflows/ci.yml:20,35,55,76,91` |
| Audit gate | `npm audit --audit-level=high` at `ci.yml:72` — the 3 moderates cannot fail it | `.github/workflows/ci.yml:71-72` |
| Route-auth tally | **217 sites = 122 gated + 95 allowlisted, 0 offenders**; allowlist 95 entries = **9 declared / 86 decision** | measured this session by running `ws7RouteAuthCoverageGuard.test.mjs` with `WS7_WRITE_ROUTE_INVENTORY` pointed outside the repo |
| Room keys | exactly **18 instances / 11 distinct keys** | `apps/dashboard/src/pages/MinistryShell.tsx:5-30`; mirrored `apps/dashboard/src/pages/ministry/MinistryRoom.tsx:18-49` |
| Ceremony producer | **EXISTS** — `services/commandCentre/ceremonyState.mjs` (23 refs; `ceremonyStoreHealth` at `:43`, refusal branches at `:165,186,202,239,303`) | `apps/dashboard/server/services/commandCentre/ceremonyState.mjs` |
| `terminal-perf` | **UNROOTED**, no failing run captured | `docs/runbooks/PICC_OPERABILITY_RUNBOOK.md:414-415` |

### 0.1 Three corrections to the briefing this plan was given

These are load-bearing and were verified, not assumed.

1. **`/api/trading/feed-mode` no longer exists.** The reviewer's highest-risk named route was
   removed in T2. `apps/dashboard/server/handlers.mjs:1435-1440` is a tombstone comment recording the
   removal; the next `if (path === ...)` is `/api/trading/realtime` at `:1442`. The removal is
   corroborated by `docs/trading-logic/changelog/entries/0016-EXPERTOPTION_VENUE_REMOVAL-v1-to-v2.md:79,296`.
   `getFeedMode`/`setFeedMode` have zero occurrences in `handlers.mjs`. **The named risk is closed.**

2. **The route tally is 217/122/95/0 with 86 decision items, not 222/123/99/0 with 90.** The figures in
   the briefing match stale prose inside the guard at
   `apps/dashboard/server/__tests__/ws7RouteAuthCoverageGuard.test.mjs:2329` ("108 offenders across the
   222 sites"). That comment predates T2's route removals and is now wrong. Measured: 86 pending
   verdicts, not 90. The guard's own tally vocabulary is at `:2818-2839` and its printer at `:2843-2847`.

3. **Only the Risk room is unmounted. Markets has a URL.** `MarketsRoom` is routed at
   `apps/dashboard/src/pages/ministry/MarketsRoom.tsx` (registered as the `markets` key at
   `MinistryRoom.tsx:20`) and composes the T7 Copilot surface at `:55` with `confluence={null}`.
   Risk is the only committed room with no route. Markets' verdict is
   `surface-complete, producer-pending` (`terminal/routes/MarketsRoom.tsx:102`); Risk's is
   `surface-complete, producer-pending, route-unmounted` (`terminal/routes/RiskRoom.tsx:99`) — a third
   clause the briefing did not carry.

### 0.2 One spec defect the owner must correct (not corrected here)

**D21 was superseded, and three downstream locations still assert the withdrawn figure.**

`PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:277-308` is a `D21-SUPERSESSION` dated 2026-09-26
that **withdraws** the ~1800 ms ARM ratification with no substitute, on two stated grounds (a CPU-only
ratio cannot transfer to a render-dominated path; the 250 ms input was a max-of-5-warming-samples
figure, not a percentile). The original D21 survives at `:309-316` as the superseded record.
`§4.6` B2 at `:723` is **current** and reads `WITHDRAWN - NO DEFENSIBLE FIGURE`.

Three locations are **stale** and still say "ratified at ~1800 ms":

- **AC-045** at `:1125-1131` — "The ARM room-transition budget is **ratified at ~1800 ms p95**".
- **T19's acceptance line** at `:1368` — "**B2's budget is already ratified at ~1800 ms by D21**".
- **§9 ship gate** at `:1495` — "the ARM tier ratified at ~1800 ms with 250 ms retained as x86-only".

This plan implements T19 to the **supersession**, because that is the later and explicitly
superseding record, and because `:307` states the only closure is the direct on-device sample. The
three stale locations are a spec-text correction for the owner; see §7.

---

## 1. Requirements

Each is user-visible or gate-visible and checkable.

- **R-1** Every task in §3 lands as its own commit with the AC-046 floor green at that commit (spec
  `:250-254`, D18). No red floor is deferred.
- **R-2** Ordering follows the bisect matrix at spec `:1394-1401`, which is authoritative over task
  numbering. BS-1 → BS-2 → BS-3 → BS-4.
- **R-3** Each of the 18 frozen room instances reaches an AC-020 completeness verdict with an explicit
  D27 WS-8 flag, in D1's order, one room at a time (spec `:925-931`, `:365-372`).
- **R-4** No room acquires a write affordance it did not have; unavailable data renders unavailable
  (spec `:1287`, `:743-747`).
- **R-5** The Risk room becomes reachable at a URL, and both T7 rooms' completion records stop
  claiming pending scope that no longer exists.
- **R-6** The 86 pending route-auth verdicts are ruled on by the owner and the allowlist carries no
  `owner:"decision"` entry at T21.
- **R-7** Every budget in `§4.6` carries a verdict, with B1/B3 still visible as `BREACH`, and the 2 GB
  gate has been observed failing at least once (AC-043, AC-044).
- **R-8** The batch push happens once, at T21 (D3, AC-048).

---

## 2. Design — the seam being cut

Three seams carry this plan.

**The engine/consumer seam.** T7 already built the **consumer** half of the Copilot contract and it is
not a stub. `apps/dashboard/src/terminal/domain/copilotDecision.ts` contains the tier derivation:
`bandOf` at `:122-127` implements AC-023 exactly (`>=85` → A+, `>=70` → B, no rounding, `null` →
`ignore`/`hold`/`0%` rather than a fabricated `0`), and `tierFor` at `:145-179` applies the veto
override **before** the permission check, so a fired veto cannot be re-enabled by a broker's
`automationPermitted` flag. `describeConfluence` at `:223-296` completes contributions to all six
experts, rejects a wrong weight rather than correcting it, and requires an `unavailableReason` when
`available === false` — AC-030's render side. `EXPERT_WEIGHT_SUM` at `:61` re-asserts the sum of 100
independently of the engine.

What does **not** exist is the **producer**: regime classifier, the six experts' deterministic inputs,
the confluence computation, the six veto evaluations, four boosters, and the risk layer. T11 builds
the producer. T11 must **not** re-implement `bandOf`/`tierFor` on the server: the server needs its own
authoritative copy because it is the execution path, and a second copy of an AC-023 boundary is exactly
the "two sources of truth that drift" failure this repo already guards against at
`copilotDecision.ts:46-50`. **Design decision this plan makes:** the server engine is authoritative
for `ExecutionTier`; the client `bandOf` remains a rendering projection; and both are pinned equal by
one shared boundary-table test that reads the same fixture. This reopens no decision — D5, D6, AC-023
and AC-024 keep exactly one meaning — and it needs a spec-text addition at `§4.2` to say which copy
authorises execution. See §7.

**The route-table seam.** `INNER_NAV` (`MinistryShell.tsx:5-30`) and `MINISTRY_ROOMS`
(`MinistryRoom.tsx:18-49`) are a hand-maintained pair, and
`src/terminal/components/__tests__/TerminalShell.test.tsx:45-59` pins them equal in both directions.
Adding any room key means editing both, which is why Risk is blocked.

**The verdicts seam.** The route-auth allowlist's `owner` field is the encoding of an owner decision
(`ws7RouteAuthCoverageGuard.test.mjs:878-882`: `"decision"` = "NOT YET RULED ON BY THE OWNER"), and
each of the 86 entries already carries a per-route `RECOMMENDATION` in its `reason` (verified at
`:908-944`). The mechanical discharge is a task; the ruling is the owner's.

### 2.1 Constraints on every task

- **File-touch whitelist** is spec `:73` (d). Anything outside that union needs a dated spec amendment.
  The WS-6 §0.3 amendment in §3.6 is itself such an amendment.
- **`contracts.ts` is regex-pinned, not line-pinned.** `ws6TerminalSeamGuard.test.mjs:42,46,50,54`
  assert four content regexes against the whole file: `/sizingEligible:\s*false/`,
  `/requiredCount:\s*500/`, `/"copilot: remote"/`,
  `/ExecutionMode\s*=\s*"paper"\s*\|\s*"reserved"/`. T11/T12 may extend the file freely; those four
  must keep matching. All four are in the WS-6-authored region above line 121 and are untouched by T7.
- **`ws5SeamGuard`'s authorised venue set is pinned to its exact two-entry value** and may not be
  widened (spec `:1212`). T17 adds four venue adapters and must read that guard first.
- **Never fabricate a default.** A field that cannot be observed is `null`/`unavailable` with a named
  owner, never `0` (spec `:674`, `:745-747`).

---

## 3. Ordered task list

Numbering is mine; spec task IDs and spec line refs are authoritative. Dependencies name the
predecessor task in this plan.

### BS-1 · Safety ground — **COMPLETE, no action**

T0–T6, spec `:1396`. Landed at `857443e`. **This unblocks all of BS-2 and BS-3.** Specifically, T6's
single-lockfile decision (D24) is the precondition for every install in T13, T14, and T17 — the spec
places it first for exactly this reason (`:1250`). Verified: `apps/dashboard/pnpm-lock.yaml` and
`pnpm-workspace.yaml` are gone and `package.json` carries no `packageManager` field.

### BS-2 · Copilot core (spec `:1397`) — *must not touch: room visuals, venue lifecycle*

| # | Task | Spec | ACs | Depends on |
|---|---|---|---|---|
| 1 | T11 Deterministic Copilot engine | `:1291-1298` | AC-021, AC-022, AC-023, AC-030 | BS-1 |
| 2 | T12 Three conflict resolutions C1/C2/C3 | `:1300-1307` | AC-027, AC-028, AC-029 | T11 |
| 3 | T13 Model layer, supply chain, routing | `:1309-1316` | AC-031, AC-032, AC-040 | T11 |
| 4 | T15 Retention and veto storage | `:1327-1334` | AC-033, AC-034 | T11 |
| 5 | T16 Authority model + separation of duties | `:1336-1343` | AC-035 | BS-1 |

**T14 is deliberately not here.** Its number (1318-1325) sits between T13 and T15, but the matrix
places it in BS-3 (`:1398`) because it adds a section to the Settings room, which T10 completes first.
Numbering does not override the matrix.

#### 3.1 T11 — what must be true for acceptance

Not a restatement of AC-021/022/023/030; the checkable conditions.

1. **A `ConfluenceScore` is produced from market state alone.** `apps/dashboard/server/services/copilot/`
   exists per spec `:539-566` with `regime.mjs`, six `experts/*.mjs`, `confluence.mjs`, `tiers.mjs`,
   six `vetoes/*.mjs`, `vetoIndex.mjs`, `routing.mjs`, `retention.mjs`, `explain.mjs`.
2. **Weight sum is exactly 100, asserted from the engine's own table.** The engine must export its
   weight table and a test asserts the sum is `100` — not `>= 100`, not `100 ± ε`. The client already
   asserts its copy at `copilotDecision.ts:61`; the engine's own assertion is a **separate** test, and
   a third assertion must prove the two tables are element-wise equal, or the spec's §4.4 weights have
   two homes.
3. **Determinism:** 100 evaluations of one frozen market state produce byte-identical
   `ConfluenceScore` including `engineVersion`, with the model layer mocked to **throw**. `computedAt`
   is the only permitted time input (AC-021's prohibited side effect names wall-clock nondeterminism
   explicitly).
4. **Tier boundaries are a table test over `{69, 70, 84, 85, 86}`** and additionally over
   `{84.4, 84.5, 84.9}` asserting each stays `B` (AC-023 prohibits rounding a value between 84 and 85
   into A+). The server table and `copilotDecision.ts:122-127` must produce identical tiers for every
   case — this is the shared-fixture test from §2.
5. **A fired veto forces `hold` and `riskPct: 0` for a would-be A+ with `automationPermitted: true`.**
   Ordering is the contract: veto before permission (`copilotDecision.ts:129-144` documents why). The
   server copy must assert the same order, and a test must prove that flipping the order fails.
6. **Veto records are retrievable, not booleans.** A `VetoOutcome` written by a firing veto is
   readable back with `ruleId`, `inputs`, `suppressed`, `evaluatedAt`, `ruleVersion` intact. Assert
   this against the `vetoIndex.mjs` store, not against a returned object — D7's whole point is that
   the record survives the call.
7. **Honest degradation.** With Sentiment forced unavailable, the engine returns all six
   `contributions` with `sentiment.available === false` and a non-empty `unavailableReason`, and
   **does not renormalize**: the test must assert the other five weights are still 20/20/20/15/20 and
   that no 95% re-scaling occurred. A score may be returned with a stated penalty or be `null`;
   a `0` contribution for Sentiment is a failure.
8. **B5/B6 have a first measurement.** B5 (confluence ≤100 ms p95) and B6 (vetoes ≤25 ms p95) are
   `UNMEASURED` (`:726-727`) and the engine is the only thing that can produce them. Measure over a
   pinned fixture set, record raw samples into `apps/dashboard/perf/`, and report a verdict. If the
   engine is too slow, the verdict is `BREACH` — **do not** defer it to T19. T19 records verdicts
   (`:1368`); T11 owns producing the number.
9. **The risk layer's two missing capabilities exist**, because Risk's `RISK_COMPLETION.pendingScope`
   names T11 for exactly these (`terminal/routes/RiskRoom.tsx:100`): the 2% **daily** drawdown
   disable and the 3-strike 24h key lock. `riskLayer.ts:141-150` and `:204-206` record precisely what
   may **not** be substituted — `v32Copilot.SESSION_HALT_FLOOR_PCT` (a −2% *session* halt) and
   `u4faRisk`'s −5% *daily* limit are near-misses, and wiring either under the spec's label is the
   fabrication. Tests must assert the real counter and lock store exist and that the daily figure
   (not the session figure) is the disable's input, per `riskLayer.ts:131-137`.
10. **The WS-7 T11 back-reference is recorded** in T11's changelog entry, naming both T7 completion
    records it discharges by name and line. This is what makes the T7 reconciliation traceable in
    §4 rather than a claim.

#### 3.2 T12 — what must be true

- **C1 (AC-027):** a 7-candle fixture. Boosters 1 **and** 2 both fire → ADX penalty disabled and
  `Trend_Score` = max on candles 1–5; candle 6 shows the override expired. A second fixture with only
  Booster1 firing asserts the ADX penalty is **not** disabled — AC-027's prohibited side effect names
  the single-booster case explicitly.
- **C2 (AC-028):** three cases, three verdicts — wick beyond 1.5× ATR but close inside → soft stop
  alerts, no hard stop; close beyond 1.5× ATR → hard stop; close below the 50 EMA → hard stop. The
  C2 stop semantics reach `RiskRoom`'s surface (spec `:1303`) **as a component change only**; see the
  note below.
- **C3 (AC-029):** a weight snapshot across three states. `regime === "hypertrend"` → `macroBias`
  `weightPct` is `0`; the remaining five weights are **not** rescaled to sum 100 (AC-029's prohibited
  side effect forbids renormalizing in a way that hides the change); on regime exit the 20% returns.
- **Each rule is versioned and independently revertible**, and a C1-vs-C2 collision resolves through
  an explicit precedence recorded in `conflictOverrides`, not by module ordering (spec `:1307`).
- **The Risk-room surface change does not require the Risk room to be mounted.** T12 is in BS-2,
  whose "must not touch" column (`:1397`) reads *room visuals*. Editing
  `terminal/routes/RiskRoom.tsx` to add the two-tier stop is a component change, not a route-table
  change; the room is exercised in tests with props and needs no URL. **This is stated because a
  reader could reasonably conclude T12 needs the §3.6 amendment first. It does not**, and pulling the
  amendment into BS-2 would violate the matrix's must-not-touch.

#### 3.3 T13 — what must be true

- `scripts/model-digest-gate.mjs` exists and fails the build (not a warning) on: a missing pinned
  digest, a digest mismatch, and a pickle-family artifact (AC-032).
- **Format detection is content-based, not extension-based.** A `.dat` file whose bytes are a pickle
  is rejected. A `.safetensors` file whose bytes are a pickle is rejected. A test plants all three.
- **The import boundary is guarded (AC-031).** No module reachable from the deterministic decision
  path imports the model layer, except `experts/sentiment.mjs`. Assert this structurally, by walking
  the import graph from `confluence.mjs`/`tiers.mjs`/`vetoes/*`, not by grepping for a filename.
- **A garbage-stub determinism test:** replace the model with a stub returning nonsense for
  indicator-shaped values; the engine's `ConfluenceScore` must be byte-identical to the no-model run
  except for the Sentiment contribution's `rawDelta`/`unavailableReason`.
- **The routing predicate is pure** and its matrix is table-tested: A+ setups and veto-boundary
  decisions → cloud with `provenance: "copilot: remote"`; everything else → local; and **routing fails
  closed**, never open (AC-040's prohibited side effect).
- **ARM64 availability of ONNX Runtime / llama.cpp is measured or explicitly `UNVERIFIED`** (spec
  `:1314`, `:759-760`, D14). This is a real, currently-open hardware question and it is a T13 release
  gate. If it cannot be resolved on an x86 host, the row says `UNVERIFIED` and D15's gate is the only
  thing standing between an unverified native module and the 2 GB ceiling.
- B11 stays `UNVERIFIED` (`:732`, honesty note 6 at `:1464`). Do not record vendor claims as measured.

#### 3.4 T15 — what must be true

- Three retention classes routed, and the routing is the thing under test (AC-033).
- **A negative test per mutating method on a permanent class** (AC-034): update and delete are both
  refused. "No admin or migration path may mutate a permanent class" means the *absence* of the path
  is asserted, so the test must fail if a mutating method is ever added.
- **The 90-day transform is one-way and recorded.** The test advances time past 90 days, runs the
  purge, and asserts a cutover record exists. AC-033's prohibited side effect — the transform must
  not be reversible by re-deriving deleted raw data — needs a positive assertion that the raw rows
  are gone *and* that no code path can reconstruct them from the aggregate.
- **Dry-run against a fixture** (spec `:1334`) and no write to real `server/data/`.
- T11 writes veto records; T15 makes them permanent. **T15 must land after T11** or the store T15
  protects does not exist.

#### 3.5 T16 — what must be true

- `Authority = { id, title, scope[], canApprove[] }` exists and the collision detector is a **pure
  function** testable with fixtures (spec `:1343`).
- AC-035's two halves both tested: an authority in `canApprove` for a room it also built → hard
  failure naming **both** the authority and the room; and a compliant pair passes. "May not be a
  convention or a UI-only warning" means the detector is called from the persistence path, not only
  from the Ministry room's render.
- **Every `automationPermitted` change records the approving authority** (spec `:1341`, D5). Assert
  `permitChangedByAuthorityId` is non-null on a change event and that a change with no authority is
  refused — the field defaults to `null` and must never be written `null` by a successful change.
- The Ministry room consumes the detector. T16 lands in BS-2 but the Ministry **room** is T8 in
  BS-3, so T16 delivers the model and detector; T8 delivers the surface. That split is already the
  spec's (T8's file line at `:1267` says the authority model "is consumed here, not built here").

### BS-3 · Breadth (spec `:1398`) — *must not touch: safety seams, budget verdicts, the absence guard*

| # | Task | Spec | ACs | Depends on |
|---|---|---|---|---|
| 6 | **T7R-A** WS-6 §0.3 amendment → **22 instances / 15 keys** (owner-ruled 2026-09-30) | §3.6 below | AC-020 (partial) | BS-2 complete |
| 7 | **T7R-B** T7 reconciliation: mount Risk, wire both rooms, flip both verdicts | §4 below | AC-020, AC-041 | T7R-A, T11 |
| 8 | T8 Ceremony, then Ministry | `:1264-1271` | AC-020 | T7R-A (keys authorised) |
| 9 | T9 Strategy, then Paper/Live | `:1273-1280` | AC-020 | T8, T16 |
| 10 | T10 Remaining read-only rooms — **16 instances** | `:1282-1289` | AC-020 | T9 |
| 11 | T14 Notifications | `:1318-1325` | AC-037 | T10 (Settings room) |
| 12 | T17 CCXT four-venue lifecycle | `:1345-1352` | AC-036 | BS-2 |
| 13 | T18 Data sources | `:1354-1361` | AC-038, AC-039 | T11 |

#### 3.6 T7R-A — the WS-6 §0.3 amendment, and where it lands

**Placement: the first action of BS-3, before T7's records are touched.** Three reasons, and the
second is decisive.

1. **It is a spec amendment, not a WS-7 task.** WS-6 §0.3 is
   `docs/specs/PICC_TRADING_SUITE_WS6_TERMINAL_UI_REBUILD_v1.md:68-72` ("**Room keys (frozen).**
   `MinistryShell.tsx:5-29` defines three suites and 18 room keys"). Changing it requires a dated
   amendment plus a D20 supersession record (spec `:268-275`), which is the shape every other
   spec-level correction in WS-7 took (entries 0016-0021). It is its own commit so the amendment and
   the code it authorises are separable.
2. **The bisect matrix forbids it earlier.** BS-2's "must not touch" column reads *Room visuals*
   (`:1397`), and `INNER_NAV`/`MINISTRY_ROOMS` are the room route table. Amending the count during
   BS-2 would edit exactly what BS-2 is forbidden to touch. BS-1 is closed. **BS-3 is the first slice
   permitted to touch it.**
3. **It must precede T7's re-flagging, not follow it.** The Risk room's `routeBlocker` string
   (`terminal/routes/RiskRoom.tsx:101-102`) names the two assertions as the blocker. Once the
   amendment exists, that string and `verdict` are stale, and a record that names a resolved blocker
   as live is the unflagged-drift defect AC-020 exists to prevent. T7R-A and T7R-B are therefore one
   logical change in two commits, with no room work between them.

**What the amendment does. — OWNER RULED 2026-09-30: 22, not 19.** The owner was first asked
for 19 (Risk only) on a reading that came from T7's per-room verdicts rather than the route table.
Checking `INNER_NAV` against D1's order at `:97` shows **four** of the six rooms D1 names — Risk,
Ceremony, Ministry, Strategy — have no key at all; only `markets` and `paper` do. The count is
therefore 18 + 4 = **22 instances / 15 distinct keys**, and T10's remainder is **16** (22 total, minus
the 6 rooms T7–T9 cover). An earlier draft of this line said 12; that was wrong — 12 is what the
never-taken 19-room branch would have produced. See §5's resolution note and the BS-3 task table.

The amendment therefore authorises **four** new ministry room keys — `risk`, `ceremony`,
`ministry`, `strategy` — and records that the count moved from 18/11 to 22/15 by owner decision,
dated, with every assertion it moves named. It also annotates, without weakening, WS-6 R2.3 at
`:345` ("Navigation preserves the existing ministry room keys") — that line is a **second** WS-6
statement the amendment must touch, and it is easy to miss because the room's own comment at
`RiskRoom.tsx:36-42` names only the two test files.

**Suite assignment — a defensible default the owner may override.** §4.2's room block at
`:514-522` names all four rooms but assigns no suite, and the frozen assertions pin per-suite
ordered lists, so the choice is not cosmetic. All four go in **`trading`** on the reading that
`:524-530` draws every one of them on the Copilot→execution path (`SCORE --> MKT`, `TIERS --> LIVE`,
`EXEC --> LIVE`) and that Risk, Ceremony and Strategy are trade-execution concerns; Ministry is the
weaker case, since separation-of-duties is a governance concern that could sit in `intelligence`
instead. **Consequence if wrong:** the `trading` ordered-list pin at `:165-177` moves differently
and `MinistryRoom.tsx:18-49`'s suite grouping changes — a mechanical edit, not a redesign. This
resolves at T7R-A, not before, because BS-2 must not touch room visuals (`:1397`).

**The two assertions that move** (both frozen characterisation tests, both moved to their new true
value — not deleted, not weakened):

| Assertion | Current | New true value | What it is |
|---|---|---|---|
| `src/pages/__tests__/ministryRooms.test.tsx:165-177` | trading keys = 9, exact ordered list | trading keys = **13**, the four new keys inserted at their D1 order positions | exact ordered list pin |
| `src/pages/__tests__/ministryRooms.test.tsx:193-196` | cross-suite total `toBe(18)` | `toBe(22)` | count pin |

D1's order at `:97` gives the insertion positions: `markets` → `risk` → `ceremony` → `ministry` →
`strategy` → `paper`. `markets` is entry 2 of 9, `paper` is entry 3, so the four land between them:
`dashboard, markets, risk, ceremony, ministry, strategy, paper, autopilot, command-centre, dispatch,
simulator, studio, settings` = 13. `earnings` (4) and `intelligence` (5) are **unchanged** under the
`trading` default above; if Ministry is moved to `intelligence`, `trading` becomes 12 and
`intelligence` becomes 6, and both ordered-list pins move.

`src/terminal/components/__tests__/TerminalShell.test.tsx:45-59` needs **no** value change — it is a
*parity* guard (INNER_NAV set equals MINISTRY_ROOMS set; both totals equal) and it passes unchanged
once `risk` is added to both surfaces. The Risk room's comment lists it among "the frozen assertions"
to move; that is accurate about it being a constraint but inaccurate about it needing a value edit.
**The amendment must therefore require all three files to be consistent, and only two of them carry
a number.**

**Conditions for acceptance.**

- `MinistryShell.tsx` `INNER_NAV.trading` gains `{ to: "risk" }`, `{ to: "ceremony" }`,
  `{ to: "ministry" }`, `{ to: "strategy" }`; `MinistryRoom.tsx` `TRADING_ROOMS` gains the four lazy
  imports. All in the same commit as the assertion moves, or the parity guard at
  `TerminalShell.test.tsx:50` fails — which is the guard working.
- `:193-196` reads `22`, and a test asserts the new count is `22` **and** that all four keys are
  present, so the number is not a free-floating literal.
- The amendment record names: the prior value 18/11, the new value **22/15**, the date, the owner, the
  two assertions whose values moved, the third that needed no value change, and the explicit
  statement that this is an authorised widening and not a relaxation of a safety invariant.
- `ministryRooms.test.tsx:157-158`'s own header says a failure "must be reverted or the spec
  amended". **This amendment is that authorisation**, and the record should quote the header.

**✅ Resolved 2026-09-30 — this is written once, at 22, not landed at 19 and widened.** An earlier
draft of this plan scoped T7R-A to 19 and flagged that a ruling for Ceremony/Ministry/Strategy would
make that scope wrong. The owner ruled for all four keys, so the amendment is authored at 22/15 in a
single dated record. There is no 19-room intermediate to land, and therefore no window in which a
completion record names a resolved blocker as live.

### BS-4 · Evidence & release (spec `:1399`) — *must not touch: fabricated defaults, silent passes, early `SHIPPED`*

| # | Task | Spec | ACs | Depends on |
|---|---|---|---|---|
| 14 | T20R Route-auth verdict discharge | §3.8 below | — (guard-consistency) | **owner verdicts** |
| 15 | T19 Performance, memory, ARM tier | `:1363-1370` | AC-043, AC-044, AC-045 | T18, T13 |
| 16 | T20 Cross-room invariant gate | `:1372-1379` | AC-047 | all rooms |
| 17 | T21 Final seam guard, registry, push | `:1381-1388` | AC-046, AC-048 | T19, T20, T20R |

T20R is placed **before** T19 because verdicts that add a gate are behaviour changes to
`handlers.mjs`, and the cross-room gate and T19's budget sweep should both run against the final route
table. T21 is last unconditionally (`:1388`).

#### 3.7 T19 — what must be true, given the flake is unresolved

T19 owns AC-043/044/045 and the B1–B12 verdicts. The `terminal-perf` flake is **UNROOTED** and T19
tries to ratify numbers from the very spec that flakes. This is the plan's single largest honesty
hazard, and the per-task conditions are built around it.

1. **The flake is resolved or formally accepted before any number is ratified.** Not after. Three
   mechanisms are already disproven and must not be re-proposed: `/me` calls, store faults, and "a
   429ing endpoint gates the marker" (the runbook's own evidence table at `:394-399` exonerates the
   store and `/me`). One mechanism is standing: a swallowed click — instrumented, 8 runs, 0 captured.
   Four standing candidates are unrooted: the lazy `MinistryRoom` chunk, main-thread work from ~76
   responses/iteration, the swallowed click, and load. **Condition:** T19 records, in writing, which
   of these it eliminated with evidence and which remain standing. A T19 that ratifies B1 without
   that record has produced a number whose provenance is unestablished.
2. **Never ratify from a single run.** The run-1/run-2 spread on an *identical tree* was cold FCP
   3024 ms vs 796 ms — a 3.8× swing (entry 0021 `:286-289`). Condition: report a spread over
   **N ≥ 5** runs with per-run raw samples, and state the spread as the finding. One run is a
   measurement of the machine, not of the code.
3. **Read the artifact that survives failure.** `terminal-perf-manifest.json` is written once at the
   end of the test body and **does not survive a failing run**; the transition-evidence file is
   written in an `afterEach` and does (runbook `:385-389`). Condition: T19's evidence collection reads
   the transition-evidence file as primary. This is also why runs 3/A/B produced no no-mount FCP
   figure at all (entry 0021 `:290-294`) — a fact T19 must not re-create.
4. **A known flake may not be silently retried into a pass.** If T19 re-runs terminal-perf until green
   and reports the green run, that is a fabricated pass. Condition: every run is reported, including
   failures, with the same discipline entry 0021 `:270-276` used.
5. **The RAM gate must be observed firing, not only passing** (AC-043's prohibited side effect is
   verbatim: "A gate that has never been observed failing is not accepted as working"). Condition:
   exercise both branches in CI and record the measured peak in the manifest.
6. **B2 implements D21-SUPERSESSION, not AC-045's stale text.** No ARM figure is substituted. The
   manifest's verdict vocabulary must be **extended** so B2's state is representable without reading
   as `pass` (spec `:739`). Since the supersession withdrew the figure, B2's honest state is
   "withdrawn — no defensible figure — direct on-device sample outstanding", and a manifest test must
   reject any `pass` on B2 while no ARM sample exists, and must reject any re-introduced ~1800 ms.
7. **B1 and B3 stay visible as `BREACH`** (AC-044's verification names both). B1's newest measured
   value at 6× is p50 2437 ms / p95 4933 ms (entry 0021 `:310-314`) — materially worse than the 2139
   ms the spec records at `:722`. T19 records the current figure; it does not soften it, and it does
   not use the supersession to explain it away.
8. **The ARM probe output is checked in**, graduating B9/B12 from owner-supplied to evidence
   (`:741`, honesty note 25 at `:1487`).

#### 3.8 T20R — the 86 route verdicts

- **This task cannot start until the owner rules.** It is the clearest instance of "a task blocked on
  an owner decision" in the plan, and the plan does not assume an outcome.
- What it does when unblocked: apply the verdicts, then flip each ruled entry's `owner` from
  `"decision"` to a value meaning *ruled*, keeping the per-route `reason` and its `RECOMMENDATION`
  text so the ruling is auditable against what was recommended. The guard's
  `allowlistDecisionItems` counter (`:2831`) becomes `0`, and a new assertion pins that.
- **Do not delete entries to reach zero.** The allowlist is self-policing against exactly that
  (`:30-35`): an entry whose route can no longer be found is a stale excusing a different one. Removal
  is legitimate only for a route that no longer exists, and that removal is a `handlers.mjs` change
  requiring the floor.
- **The named high-risk item is already closed** (§0.1 item 1) — record that in the task so the owner
  is not asked to rule on a route that is gone.
- If the owner's verdicts land **after** T21, T21's seam guard (`:1386`) does not currently check
  route auth, so T21 would still be reachable. The plan therefore adds route-auth completeness to
  T21's check list as a **conditional**: required if the verdicts are in, reported as outstanding if
  not. It does not fabricate a pass either way.

---

## 4. The T7 reconciliation

**T7 must be revisited — not merely re-flagged, and not superseded.**

- **Not superseded:** T7's work is not replaced by anything. Its two room surfaces, its 43 tests, and
  its two domain modules remain the implementation. A supersession record would assert a replacement
  that does not exist.
- **Not merely re-flagged:** re-flagging restates a verdict. The point is to *discharge* the flags.
- **Revisited:** `MARKETS_COMPLETION` and `RISK_COMPLETION` are amended in place by T7R-B, with a
  D20-shaped changelog entry naming what changed and why.

**Exactly what must happen, per room, when T11 lands.**

### Markets / COP-22 (`terminal/routes/MarketsRoom.tsx`)

| Flag clause | Discharged by | What must change |
|---|---|---|
| `producer-pending` (`:102`) | T11 (BS-2) builds the engine | **T11 alone does not close this.** The room is composed with `confluence={null}` at `pages/ministry/MarketsRoom.tsx:55`, so with the engine present but unwired the room still renders the unavailable state. `MarketsRoom.tsx:37-40` states this explicitly: "Fetching the engine's output when it exists is a wiring change in the adapter layer, not a change to this room." |
| wiring | **T7R-B** | `pages/ministry/MarketsRoom.tsx:55` passes a real reading, not `null`. The reading comes from an adapter, not a fetch inside the room. |
| `verdict` (`:102`) | **T7R-B** | becomes a complete verdict, and `pendingScope` (`:103`) is removed. The D27 `ws8Handoff: null` (`:104`) stays `null` and its reason is re-stated against the now-built engine. |
| `MARKETS_NO_READING_REASON` (`:58-59`) | **T7R-B** | names `WS-7 T11` as a *pending* task. Once T11 has run, this string is false and must not still be displayed as a current reason. |

### Risk (`terminal/routes/RiskRoom.tsx`)

| Flag clause | Discharged by | What must change |
|---|---|---|
| `producer-pending` (`:99`) | T11 risk layer | the 2% daily drawdown disable and the 3-strike 24h key lock exist and are wired to `DrawdownObservation.dailyDrawdownPct` and `ThreeStrikeObservation.strikes` |
| `route-unmounted` (`:99`) | **T7R-A** (amendment) + **T7R-B** (mount) | `risk` is in `INNER_NAV` and `TRADING_ROOMS`; the room has a URL |
| `routeBlocker` (`:101-102`) | **T7R-B** | deleted, not reworded — the blocker is resolved, and a record naming a resolved blocker as live is the drift AC-020 prevents |
| `verdict` (`:99`) | **T7R-B** | becomes a complete verdict; `pendingScope` (`:100`) removed |
| `RISK_LAYER_OWNER` (`domain/riskLayer.ts:53`) | **T7R-B** | this constant is the literal string `"WS-7 T11"` and feeds every unavailability reason in the room. It is the T7→T11 back-reference in code form, and it must not still name a completed task as the owner of an absence. |

**Ordering constraint:** T7R-B depends on **both** T11 and T7R-A. T11 alone leaves Markets unwired and
Risk unrouted; T7R-A alone mounts a room whose two of three capabilities still do not exist. Both
gates must be green before T7R-B.

**Downstream records that must also be corrected** (each is a place the T7 state is written down, and
each goes stale independently):

- `docs/trading-logic/changelog/entries/0021-T7_MARKETS_AND_RISK_ROOMS-v1-to-v2.md` — the two
  "Room completion record" sections (`:94`, `:164`). Add a T7R-B entry; do not rewrite 0021, which is
  the historical record of what T7 did.
- `PICC.md:556` (the WS-7 registry row) — **already stale before T7R-B.** It reads "**T0–T4 have
  landed** … T5 in progress", but T5, T6, and T7 have all landed through `857443e`. T21 owns the
  registry, but the row is wrong now and a reader gets a false picture of the workstream.
- `MARKETS_COMPLETION` / `RISK_COMPLETION` tests — `MarketsRoom.test.tsx` and `RiskRoom.test.tsx`
  assert the verdicts; `RiskRoom.test.tsx:185` already asserts `routeBlocker` contains
  `ministryRooms.test.tsx`, so that assertion must be inverted or removed, not left passing against a
  deleted field.

---

## 5. Room inventory — 18 verified

Read from `MinistryShell.tsx:5-30` (nav) and `MinistryRoom.tsx:18-49` (routes), cross-checked against
`ministryRooms.test.tsx:165-196`. **18 instances, 11 distinct keys, 3 suites.** No guessing.

| # | Suite | Key | Route target | Task | State at `857443e` |
|---|---|---|---|---|---|
| 1 | trading | `dashboard` | `ministry/DashboardRoom.tsx` | T10 | legacy surface, no WS-7 terminal room |
| 2 | trading | `markets` | `ministry/MarketsRoom.tsx` → composes `terminal/routes/MarketsRoom.tsx:55` | **T7 r1** | **surface-complete, producer-pending**; mounted, has URL |
| 3 | trading | `paper` | `ministry/PaperRoom.tsx` | T9 (Paper/Live) | legacy surface, unstarted |
| 4 | trading | `autopilot` | `ministry/AutopilotRoom.tsx` | T10 | legacy surface, unstarted |
| 5 | trading | `command-centre` | `ministry/CommandCentreRoom.tsx` | T10 — **or T9 Strategy? (open)** | legacy surface, unstarted |
| 6 | trading | `dispatch` | `ministry/DispatchRoom.tsx` | T10 | legacy surface, unstarted |
| 7 | trading | `simulator` | `ministry/SimulatorRoom.tsx` | T10 | legacy surface, unstarted |
| 8 | trading | `studio` | `ministry/StudioRoom.tsx` | T10 | legacy surface, unstarted |
| 9 | trading | `settings` | `ministry/SettingsRoom.tsx` | T10, then **T14** | legacy surface, unstarted |
| 10 | earnings | `dashboard` | `ministry/EarningsRooms.tsx` | T10 | unstarted |
| 11 | earnings | `simulator` | `ministry/EarningsRooms.tsx` | T10 | unstarted |
| 12 | earnings | `studio` | `ministry/StudioRoom.tsx` | T10 | unstarted |
| 13 | earnings | `settings` | `ministry/EarningsRooms.tsx` | T10 | unstarted |
| 14 | intelligence | `dashboard` | `ministry/IntelligenceRooms.tsx` | T10 | unstarted |
| 15 | intelligence | `governor` | `ministry/IntelligenceRooms.tsx` | T10 | unstarted |
| 16 | intelligence | `guidance` | `ministry/IntelligenceRooms.tsx` | T10 | unstarted |
| 17 | intelligence | `studio` | `ministry/StudioRoom.tsx` | T10 | unstarted |
| 18 | intelligence | `settings` | `ministry/IntelligenceRooms.tsx` | T10 | unstarted |

**Plus four rooms the spec names that have no key in the frozen 18:**

| Room | Task | Key in `INNER_NAV`? | Producer exists? |
|---|---|---|---|
| Risk | T7 r2 | **no** (committed, unmounted) | partial — ATR real, 2 of 3 missing |
| Ceremony | T8 | **no** | **yes** — `commandCentre/ceremonyState.mjs` |
| Ministry | T8 | **no** | no — T16 lands in BS-2, ahead of it |
| Strategy | T9 | **no** | unverified |

### 5.1 The room arithmetic does not close — owner's call

T7–T9 name **6** rooms. Only **2** of them (`markets`, `paper`) bind to an existing frozen key. The
other **4** — Risk, Ceremony, Ministry, Strategy — have no key.

- **✅ RESOLVED 2026-09-30 — the owner ruled for all four new keys.** The total is **22 instances /
  15 distinct keys**. T7–T9 cover 2 of the original 18 (`markets`, `paper`) plus the 4 new ones, so
  **T10's "remaining read-only rooms" is 16, not 12.** The alternative that would have produced 19/12
  — Risk alone taking a key, with Ceremony/Ministry/Strategy mapping onto existing keys — was **not**
  chosen, and no room is being mapped onto a pre-existing key by name similarity.
- All four land in **`trading`** by default (§3.6's suite note). The owner's ruling settled the
  *count*; it did not name a suite per room, so the default is stated as such and is a one-line
  change per room if the owner places any of them elsewhere.
- `command-centre` was considered as a plausible home for Strategy on naming grounds and **rejected**:
  inferring a room's identity from a similar word is the quiet invention D10 and AC-042 exist to
  prevent.

**On the "6 of 7 rooms are producer-pending" figure:** not verified, and the verified picture is more
precise. The spec names **6** rooms across T7–T9 (T10 is a bulk of 12 or 16 unnamed instances, not a
7th named room). Of the 6, **3 have verified-missing producers** (Markets → T11; Risk → T11 risk layer;
Ministry → T16), **1 has a verified-existing producer** (Ceremony → `ceremonyState.mjs`), and 2 are
unverified (Strategy; Paper/Live, whose T0 boundary exists but whose T11 tiers and T16 flag do not).
The producer-pending flag is therefore **not** a uniform pattern, and a plan that assumed it was would
over-flag Ceremony.

---

## 6. Risks

| # | Risk | Why it bites | Guard / mitigation | Test |
|---|---|---|---|---|
| 1 | **Unresolved `terminal-perf` flake meets T19's ratification** | T19 must produce B1's verdict from a spec that flakes ~1-in-3 on an unchanged tree (runbook `:414`). Three mechanisms already disproven; one standing (swallowed click, 8 runs, 0 captured). The manifest does not survive a failing run (`:388`), so a flake destroys the evidence. | T19 may not ratify from a single run; N ≥ 5 with the spread reported; transition-evidence file is primary evidence; every run reported including failures; flake disposition recorded in writing before any number is ratified | T19's own run log; the existing 5-run table in entry 0021 `:270-276` is the format to copy |
| 2 | **86 pending route verdicts** | A declared-public allowlist with 86 unruled entries is a live security surface. The reviewer-named worst case is already gone (§0.1), so the residual risk is lower than briefed but not zero — e.g. `/api/trading/status` and `/api/trading/health` disclose engine configuration unauthenticated (guard `:917-931`). | T20R, before T19 and T20; entries may not be deleted to reach zero; T21 reports the counter conditionally | `ws7RouteAuthCoverageGuard.test.mjs` `allowlistDecisionItems` → 0 |
| 3 | **Producer-pending flag across rooms** | A pattern that looks uniform but is not. Ceremony's producer exists; treating all rooms as producer-pending would over-flag it, and under-flagging Markets/Risk/Ministry would be an unflagged trim (AC-020). | Per-room verdicts carried in code (`*_COMPLETION`), not prose; §5's per-room producer column; T7R-B discharges by name | `MarketsRoom.test.tsx`, `RiskRoom.test.tsx`; `RiskRoom.test.tsx:185` |
| 4 | **P1 cannot honestly precede a P0 it depends on** | The pattern is already instantiated: T7 (P1) committed rooms whose producers are T11 (P0). Markets is P1 work rendering a P0's absence. | The bisect matrix already fixes this — BS-2 (P0) before BS-3 (P1) — and §3.6's placement of the amendment in BS-3 is chosen so the P1 room work never needs a P0 it lacks. **Residual:** T7 is already committed out of order and only T7R-B closes it | AC-041 order check; the `*_COMPLETION` flags |
| 5 | **A P0 task silently depends on an owner decision** | T20R cannot start. T8/T9 may not be able to route. T19's ARM sample needs the physical device. | Each is named as blocked in §3 with no assumed outcome; the blocked task cannot be marked complete by a substitute | the task's own acceptance |
| 6 | **Two copies of the AC-023 tier boundary** | T11 needs a server-side `ExecutionTier`; the client already has `bandOf`/`tierFor`. Two copies of a safety boundary drift. | §2: server authoritative, client is a projection, one shared fixture test proves equality; spec text addition requested | the shared boundary-table test |
| 7 | **Room-scope trimming to reach "done"** | D27's exact failure mode. 16+ rooms of legacy surfaces invite shaving the hardest edge. | Per-room D27 verdict in code; AC-020 rejects a COMPLETE with an unnamed boundary; T20/T21 assert the verdict exists | `*_COMPLETION`; T21's D27 check (`:1386`) |
| 8 | ~~**The amendment is landed at 19 and then widened twice**~~ — **CLOSED 2026-09-30** | The owner ruled all four keys, so the count is settled at 22/15 and the amendment is authored once at the correct number. The failure mode is no longer reachable. | §3.6's resolution note; the amendment is one commit at 22/15 | the amendment record's stated count vs `INNER_NAV` |
| 9 | **`terminal/` grows a second contract home** | T11–T16 will add server modules; the client already owns `contracts.ts` and `ws6TerminalSeamGuard` pins it by regex. Two type definitions of `ConfluenceScore` drift. | One shape definition, imported by both; the four pinned regexes must keep matching | `ws6TerminalSeamGuard.test.mjs:42,46,50,54` |
| 10 | **The 3 moderate advisories become 4** | T13/T14/T17 install into an npm-only lockfile (T6 done). `qs`'s sole dependent is `stripe` (verified), so it is not a trading-rail dependency. | `--audit-level=high` is the gate and cannot be met by a moderate; T21's "no unused dependency" check (`:1386`) and AC-018's exactly-one-lockfile assertion cover the risk | `ci.yml:71-72`; AC-018 |
| 11 | **Spec text says "ratified at ~1800 ms" in three places** | An implementer following AC-045 (`:1125`) or T19's acceptance (`:1368`) literally would re-introduce a figure D21 withdrew. | §0.2 names all three; this plan implements the supersession; T19's manifest test rejects a `pass` on B2 and any re-introduced figure | T19's manifest schema test |
| 12 | **e2e is not gating in CI** | No Playwright leg (`.github/workflows/ci.yml`). AC-046's floor includes e2e; CI does not enforce it, so e2e regressions land silently. | T21 is the last place this can be fixed. **Recommend** a Playwright leg be added as part of T19 or T20 — but note that with the flake unresolved, adding it would make CI red intermittently, so it must land **after** risk 1 is dispositioned. `UNVERIFIED`: whether the owner wants this | — |

---

## 7. What this plan does NOT decide — needs the owner

1. ~~**The room-key mapping for Ceremony, Ministry, and Strategy (blocking T8 and T9).**~~ —
   **ANSWERED 2026-09-30: all four take new keys; 22 instances / 15 distinct keys; T10's remainder
   is 16.** No longer blocks T8/T9. The **per-room suite** (all four defaulting to `trading`) is the
   residual, and it is a mechanical edit rather than a design question — see §3.6.
   wrong number.
2. **The 86 route-auth verdicts.** Owner's by construction (`ws7RouteAuthCoverageGuard.test.mjs:880-882`).
   Each entry already carries a per-route recommendation. The named worst case is already removed.
3. **The three stale "ratified at ~1800 ms" locations** — AC-045 (`:1125-1131`), T19's acceptance line
   (`:1368`), and §9's ship gate (`:1495`) — versus D21-SUPERSESSION (`:277-308`) and §4.6's current
   B2 row (`:723`). This plan implements the supersession and does not edit the spec. The owner should
   correct the three stale locations so the next implementer does not read AC-045 and re-introduce a
   withdrawn figure.
4. **Which `ExecutionTier` copy authorises execution** (server vs client). §2 proposes the server as
   authoritative and needs a `§4.2` sentence saying so. It reopens no decision, but it is a spec-text
   addition and the execution path's authority is not something a plan should leave implicit.
5. **Whether a Playwright leg enters CI** (risk 12), and if so whether it lands before or after the
   flake is dispositioned.
6. **The physical ARM device run for B2's direct sample.** No x86 proxy can produce it. T19 cannot
   close B2 without the device, and the supersession deliberately left no substitute.
7. **Whether the `PICC.md:556` registry row is corrected now or at T21.** It is already stale (says
   T5 in progress at `857443e`). This plan defers it to T21 per spec `:1384`, but the owner may want it
   corrected immediately.

---

## 8. Non-goals

- Not implementing anything. No code, test, spec, or changelog was written.
- Not re-deriving D1–D27. Every decision is treated as settled; §0.2 and §7 route *inconsistencies* to
  the owner rather than resolving them.
- Not re-litigating BS-1. T0–T6 are verified complete and this plan starts at BS-2.
- Not fixing B1 or B3. Both stay visible `BREACH`; no task in WS-7 closes them (spec `:737`).
- Not adding a Playwright leg (risk 12 is a recommendation, not a task).
- Not ruling on the 86 routes, and not assuming any verdict.
- Not resolving the `terminal-perf` flake. T19 owns the attempt and must record its disposition
  honestly either way.
- Not touching real `server/data/`.

---

## 9. Honesty notes

1. **Nothing was implemented.** This document is the only artifact. No application file, test, spec,
   or changelog was modified; the tree is clean at `857443e` and 0 unpushed, verified before and
   after.
2. **The baseline was re-measured, not inherited.** The unit floor (4000/1/0), the audit exit code,
   the route tally, the room inventory, and the CI job list were measured or read this session. The
   floor figure comes from entry 0021 `:250` rather than a fresh full-suite run; a fresh run is T19's
   or T21's obligation, not this plan's.
3. **Three briefing figures were corrected against the code** (§0.1): the `feed-mode` route's
   existence, the route tally (217/122/95/86, not 222/123/99/90), and Markets' mounted state. Each
   correction names its anchor. The route-tally correction means the pending-verdict count is **86,
   not 90**.
4. **The "6 of 7 rooms producer-pending" figure is not verified** and the verified picture is in §5.
   One of the six named rooms (Ceremony) has a producer that exists, which the pattern would
   over-flag.
5. **`UNVERIFIED` items carried forward:** the T19 flake mechanism list beyond what
   `PICC_OPERABILITY_RUNBOOK.md:394-415` records (the "4 proposed / 3 disproven / 1 standing, 8 runs,
   0 captured" detail is owner-reported and I did not locate a checked-in record of it); the Strategy
   room's producer; whether the owner wants a Playwright CI leg; and ARM64 availability of ONNX
   Runtime / llama.cpp.
6. **The room arithmetic does not close** (§5.1) and this plan does not paper over it. The gap is
   named, the two possible totals are stated, and the decision is routed to the owner as §7 item 1.
7. **Three spec locations are stale against D21's supersession** (§0.2). The plan implements the
   supersession and edits nothing.
8. **The route-auth guard's own comment at `:2329` is stale** ("222 sites"). The measured value is
   217. This is a comment, not an assertion, so it does not fail anything — but it is exactly the
   kind of number that gets quoted onward, and it should be corrected when the verdicts are applied.
9. **No credentials, tokens, or account numbers appear in this document.** No value is quoted from a
   `.env`, a vault, or a real profile.
