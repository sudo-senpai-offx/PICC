# 0031 - T9_STRATEGY_AND_PAPER_LIVE_ROOMS v1 -> v2

Execution record for WS-7 task T9: D1's room instances 5 and 6 of 22,
Strategy and Paper/Live.

rule: T9_STRATEGY_AND_PAPER_LIVE_ROOMS
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0031-T9_STRATEGY_AND_PAPER_LIVE_ROOMS-v1-to-v2.md)
date: 2026-10-01
historicalTradesAffected: none
reason: >-
  T9's acceptance line (spec :1278) requires the Paper/Live room to display the
  D6 ladder, the current rung, `automationPermitted` state and the
  ceremony/consent rails, and to expose no live toggle beyond what the D19 outcome
  authorises. Three of those four producers already had gated routes; the fourth
  did not, because T16 shipped the permit store with no caller and recorded that
  wiring as BS-3 handoff #4. This change builds that wiring and the room, and
  discharges the handoff.

  The Strategy half is a FINDING rather than a build, and the finding corrected
  itself once during the task. T9's first draft recorded "there is no Strategy
  producer in this tree"; a test in this change caught that being false —
  `services/marketIntel.mjs` exports five named strategies. What is actually true
  is narrower and is what this record states: they have zero production callers
  and no route, and this spec names no Strategy content that would say whether
  they are the room's intended producer. The correction is recorded here rather
  than quietly edited away, because a finding that was wrong once will be wrong
  again if nothing holds it.
source: >-
  WS-7 task T9 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1273-1280`,
  decision D19 (`:256-266`) and its outcome (B), decision D6 (`:139-146`),
  D5 (`:130-137`), D10 (`:175-182`), D12 (`:193-200`), D20 (`:268-275`),
  D27 (`:365-372`), requirement R1.4 (`:384`), R7.1/R7.2/R7.4/R7.5
  (`:417-421`), acceptance criteria AC-020 (`:925-931`), AC-024 (`:957-963`),
  AC-025 (`:965-971`) and AC-026 (`:973-979`), the core data shapes at §4.3
  (`:624-640`, with `ExecutionTier.rung` at `:630` and `BrokerRecord` at
  `:634-640`), the freeze invariants at §0.3 (`:73`), and the T0 decision
  record `0010-PAPER_ONLY_ORDER_PATH_CLAIM` together with the amended claim at
  `PICC.md:28-48`. Sibling records: 0024 (T16 authority model and permit store,
  whose handoff #4 this change discharges), 0030 (T8 Ceremony and Ministry, whose
  `MINISTRY_COMPLETION.absences` named the permit FLAG's display as T9's).

## What this change is NOT, stated first because it is the most consequential part

**This room does not enable anything.** It renders state and has no write path at
all. The surface contains no `<button>`, no `<input>`, no `<select>`, no `<a>`,
no `onClick`, no `role="button"` and no `contentEditable` — not "no control that
advances execution", which is what the acceptance asks for, but no interactive
primitive whatsoever. `PaperLiveRoom.test.tsx` proves that from the RENDERED
MARKUP across three input shapes, so adding a control turns the test red even if
the exported affordance enumeration is edited to match.

**No live toggle, and the ceiling is zero rather than incidental.** D19 resolved
as outcome (B): the product documentation was amended to describe the gated rails
that actually exist. The bound T9 honoured is the outcome, not D19's existence,
and the outcome's own recorded residual at `:266` is the load-bearing text — "the
ceremony unlock has never been granted, so 'gated' is not 'live'". An amended
claim describing rails that exist is not an authorisation to offer a control that
advances execution to them. Two further facts close it independently: D6 makes
crossing a rung "a human act with its own ceremony" and no ceremony-action route
exists, because `ceremonyState.mjs:189-191` refuses `unlockVenueClass` outside a
test run with `ceremony:deny:ceremony-action-unreachable`; and D5 gates the permit
write path on a recorded approving authority in BOTH directions, which is the
fail-open direction.

**The verdict type has no permissive member.** `PaperLiveVerdict` is exactly
`"no-live-affordance" | "unknown"`, exported as data (`PAPER_LIVE_VERDICTS`) and
enumerated in a test. There is deliberately no third state meaning "live is
available", because a readout with such a member, rendered next to a rung labelled
`live`, is a rendering defect waiting for the day every conjunct happens to line
up.

## Fail closed, in both directions

The obvious failure is rendering permission on an error. The subtler one is
rendering a **confident denial** on an error: if the permit store is unreadable,
"not permitted" is an assertion about the world that nothing observed. So a
missing, malformed, faulted or disagreeing input yields `unknown`, never
`no-live-affordance`, and the two are deliberately distinguishable states. This is
`PICC.md:63-64`'s `absent -> null` applied to the room's headline.

The test is exhaustive rather than sampled: four inputs dropped one at a time, ten
malformed shapes, the two-producer disagreement, and — the case that keeps the
derivation from being vacuous — fixtures satisfying ONE conjunct at a time. A
permit granted with no ceremony unlock still reads as no-affordance (AC-026); a
permit and a ceremony unlock with no enablement record still reads as
no-affordance; everything except the rung still reads as no-affordance; and even
when EVERY conjunct is satisfied the room reports the facts and offers nothing,
which is what proves the ceiling is the type rather than today's data.

A `live` rung that both producers agree on is called out separately, because it is
the state a reader is most likely to mistake for permission: the word `live`
renders as a FACT with its own provenance sentence, the verdict is still
"no live-trading affordance", and the unmet conjuncts are named.

## The permit wiring — T16 entry 0024 handoff #4, discharged

`services/authority/paperLivePermit.mjs` seeds T16's store with the broker records
that really exist and reads them back through T16's **provenance-gated**
`isAutomationPermitted`. Two of T16's properties are preserved and both are load-
bearing:

- `isAutomationPermitted` needs a true flag AND a resolving approver, so a bare-
  boolean record does not read as permission. The readout emits the gated read as
  `automationPermitted` and the record's own boolean beside it as `recordedFlag`,
  so the gate is VISIBLE rather than implicit, and the room labels the raw flag as
  the raw flag.
- An unattributed change is refused in BOTH directions, because
  `permitChangedByAuthorityId` is a single field rather than a log.

**T16's residual is carried, not hidden.** Entry 0024 records that refusing an
unattributed DECLINE is fail-open, so a decline refused by a colliding authority
leaves the recorded flag `true`. `PERMIT_RESIDUAL` puts that in words in the
payload and the surface renders it next to the table where a reader deciding to
trust the table will see it. The provenance gate mitigates the residual; it does
not eliminate it, and this room does not pretend otherwise.

**What the store reads when it is empty.** There is no production authority set in
this tree, so `setAutomationPermitted` refuses on every call, so no permit can be
granted, so all three brokers read `false` at D5's default with both provenance
fields `null` and zero change events. That causal chain is stated in the readout's
own `verdictReason` per row and in the `absences` array, rather than left as three
undifferentiated `false` values a reader cannot interpret.

## Producers: three reused, one new, zero duplicates

T8 shipped zero server files because Ceremony's producer already had a route. The
same check was run first here, and it changed the shape of the task.

- the ladder and the permit -> `GET /api/trading/paper-live/permits`, NEW and the
  only new route;
- the current rung -> `GET /api/trading/brokers` (`handlers.mjs:4120`), pre-existing,
  whose `activeExecutor` at `brokers.mjs:95` is the real producer and whose own
  comment records that it is unconditionally `"paper"` because D2/AC-005 removed
  the only other executor;
- the consent rails -> `GET /api/command-centre/overview` (`handlers.mjs:1779`),
  pre-existing, whose per-site gates carry the producer's own note that
  "automation opt-in is a DECISION, not an approval — none has ever been granted";
- the ceremony rails -> `GET /api/command-centre/ceremony` (`handlers.mjs:1868`),
  pre-existing and the same route T8's Ceremony room consumes.

**Why the permit route is new rather than a reuse of the Ministry readout.** That
route already reads the permit store, so the cheaper move was to have this room
read its `permits` block. Three reasons it was rejected, all recorded at the route:
that readout's store holds ZERO brokers by construction and
`ministryGovernanceRoute.test.mjs:244-252` pins `brokers` `[]`, `changeCount` 0 and
a `/no broker record is wired/i` reason, so it cannot answer the broker-permission
question; reading it would couple two rooms at the transport seam, which both rooms'
bisect lines forbid; and two routes over one store give that store two answers
taken at two moments, which is the defect T8 declined to create for the ceremony
store. A test asserts exactly one route per store for all four, so a future
duplicate turns red.

**The broker-id list is duplicated, and cannot rot quietly.**
`PAPER_LIVE_BROKER_IDS` repeats the slugs `services/brokers.mjs` registers rather
than importing `listBrokers()`, which is async and probes real credentials. A test
CALLS `listBrokers()` under isolated stores, discovers the slugs it actually
produces, and asserts the two sets are equal — so a fourth broker added there
fails the test rather than going unreported and unrepresented.

**`/api/trading/brokers` is gated with `requireSessionOrFirstRun`, not
`requireAuth`** (`handlers.mjs:4137`), which is the weaker gate and admits an
anonymous caller on an install with an empty user store — the same bootstrap class
T8 recorded. T9 does not choose that gate and cannot change it, so it is recorded
as a named dependency risk on the room's rung source rather than glossed, and the
room's fail-closed verdict does not rest on it alone.

## What the Strategy room is, and what it is not

**Verdict: `incomplete`, and it is not recorded as complete.** AC-020:929
prohibits declaring a room COMPLETE while it "has no reserved placeholder that
could be trivially filled later", and this room's rendering is one. Claiming
`complete` would be the unflagged trim in its purest form — the room looks routed
and says nothing.

**The finding, in its corrected form.** Five named trading strategies exist in
`services/marketIntel.mjs` — `strategyMtf` (`:87`), `strategyPhase` (`:131`),
`strategyVolume` (`:145`), `strategyRR` (`:181`) and `strategyEdge` (`:200`) — each
returning a confluence-shaped `{ score, signal, reason }`. They are NOT this room's
producer for two verifiable reasons: nothing in `apps/dashboard/server` outside
their own definitions and their own test file references them, so they have ZERO
production callers; and no `handlers.mjs` route path matches `/strateg/`, so nothing
can serve them to a room. They are orphaned exports with tests.

**Why no panel was built on them.** Adopting them would mean CREATING a production
caller for an orphan — a product decision about what the room should assert, which
this spec gives T9 no basis to make, since T9's acceptance line names no Strategy
content anywhere. And each returns the same shape T7's Markets/COP-22 room already
renders through T11's engine, so a Strategy room showing them would be a second
copy of the Copilot surface: a room that looks complete and is not, which is D27's
named failure and the WS-6 outcome.

**The owner was corrected to D10's literal.** The reserved body displayed `WS-7 T9`
as its owner. R7.4 requires `WS-7+` for any unowned capability and D10:175-182
reserves that literal so no owner is invented; a task id is a schedule, not an
owner, and a reader seeing one could reasonably conclude somebody was building the
room. T9 finished and did not, because there is nothing to build against, so the
owner is now the reservation.

**`ws8Handoff` is a NAMED OPEN BOUNDARY, not `null`.** Writing `null` would claim
the WS-8 question was asked and answered. It was not: this spec names no Strategy
content, so whether a Strategy producer is WS-7 or WS-8 scope is not derivable from
it, and choosing would mean inventing scope. D27 requires the boundary be stated and
reviewable; this states it, with `decidedByThisTask: false`.

## Handoff ledger

Entry 0024 (T16) recorded four BS-3 handoffs. Discharged only what this diff
actually lands:

1. **The Ministry room's render** — DISCHARGED by T8 (`1fd792b`), not by this
   change.
2. **The `ministry` room key** — DISCHARGED by `e9c8137`, not by this change.
3. **The build registry has no producer** — **STILL OPEN.** Nothing emits
   `construct`/`deploy`/`promote`, because no room is attributed to a named
   authority and T16's own `UNKNOWN_AUTHORITY_CODE` refuses exactly that. T9 became
   another CONSUMER, not a producer, for the same reason T8 did. Remaining work and
   its owner: T21's seam guard consumes it; producing it needs the owner to name
   real authorities and say who builds what.
4. **No caller of the permit store** — **DISCHARGED HERE.** The store is seeded with
   real broker records by `paperLivePermit.mjs`, read through its provenance-gated
   accessors, and surfaced by `GET /api/trading/paper-live/permits` and by the
   Paper/Live room's `automationPermitted` column. `MINISTRY_COMPLETION.absences` in
   T8's room recorded this as T9's; it is now done.

**Still-open items this change creates or inherits, named:**

- `BrokerRecord.ceremonyUnlocked` (spec §4.3:639) has NO PRODUCER.
  `createBrokerRecord` accepts it as an input (`brokerAutomationPermit.mjs:85`,
  `:110`) so it looks wired, but nothing in `apps/dashboard` ever passes it as
  `true`, so it is permanently `false`. Reported rather than omitted, because an
  omitted field could be read as an unmet check that was never run. Owner: an owner
  decision plus a deliberate ceremony action.
- There is no ladder STORE, and that is correct rather than missing: D6 is
  implemented by its absence. T11 carries `rung` through with no writing branch
  (`tiers.mjs:81-83`) and `ceremonyState.mjs:189-191` refuses the unlock seam
  outside a test run. Recorded in `PAPER_LIVE_COMPLETION.absences` so a later reader
  does not read the absent store as unfinished work.
- No production authority set, and no build registry — both owner decisions, both
  recorded rather than defaulted.

## The three properties, and the shape of each test

1. **Fail closed** — `PaperLiveRoom.test.tsx`, the fail-closed `describe`. Four
   inputs dropped one at a time, ten malformed shapes, the disagreement case, and
   the single-conjunct fixtures. Proves a state that cannot be mistaken for
   permission, and cannot be mistaken for a verified denial either.
2. **No unauthorised live affordance** — the affordance-audit `describe`. The
   enumeration is exported as empty DATA and asserted empty; the rendered markup is
   enumerated for every interactive element across three input shapes; the whole
   `paper` page is rendered with its four pre-existing ledger components MOCKED to
   render buttons, so the assertion that every interactive control lies inside
   `data-paper-region="ledger"` and none inside `data-paper-region="boundary"` is
   not vacuous; and a static scan over the full rendering graph finds no
   live-enabling endpoint and no mutating method. A test additionally asserts
   exactly one route per store, which is the T8 precedent held.
3. **Independently revertible** — T9's own `describe` in `roomBisect.test.tsx`.
   Both directions are proved by making the sibling UNLOADABLE with a factory that
   throws, plus a static check over each room's full graph, plus the transport
   half: the Strategy room opens no transport at all, which is the strongest
   available statement that it depends on nothing.

## Files

Added:

- `apps/dashboard/server/services/authority/paperLivePermit.mjs`
- `apps/dashboard/server/__tests__/paperLivePermitRoute.test.mjs`
- `apps/dashboard/src/terminal/domain/paperLive.ts`
- `apps/dashboard/src/terminal/components/PaperLiveSurface.tsx`
- `apps/dashboard/src/terminal/routes/PaperLiveRoom.tsx`
- `apps/dashboard/src/terminal/routes/__tests__/PaperLiveRoom.test.tsx`
- `apps/dashboard/src/terminal/routes/__tests__/StrategyRoom.test.tsx`

Edited:

- `apps/dashboard/server/handlers.mjs` — ONE route block, +46 lines, ONE dynamic
  import. Pin accounting: handlers.mjs 6,177 -> 6,223 lines; comment-stripped
  dynamic imports 82 -> 83; statics UNCHANGED at 72; `verifyUser()` call sites
  UNCHANGED at 36; `verifyTokenStrict(` UNCHANGED at 1; `resolveHasUsers(`
  UNCHANGED at 1. Each pin MOVED TO ITS NEW TRUE VALUE with the accounting beside
  it in `ws7AuthBootstrapGateGuard.test.mjs`; no guard was weakened and no frozen
  characterisation assertion was moved.
- `apps/dashboard/server/__tests__/ws7AuthBootstrapGateGuard.test.mjs` — the two
  pins and their accounting only.
- `apps/dashboard/src/terminal/adapters/governanceReading.ts` — additive: three
  fetchers. `fetchCeremonyReadout` and `fetchMinistryGovernance` are UNCHANGED.
- `apps/dashboard/src/pages/ministry/PaperRoom.tsx` — additive: four fetches, the
  boundary surface, and a `data-paper-region` wrapper around the four
  pre-existing ledger components. `PaperTradingCard`, `LedgerPanel`,
  `TradeJournalPanel` and `RiskMetricsCard` are UNCHANGED and unwired by this task;
  the paper-trading fetches and their state handling are UNCHANGED.
- `apps/dashboard/src/pages/ministry/reservedRooms.tsx` — the owner corrected to
  D10's reservation, the reason corrected to the narrowed finding, and
  `STRATEGY_COMPLETION` added. The reserved rendering itself is unchanged.
- `apps/dashboard/src/terminal/routes/__tests__/roomBisect.test.tsx` — T9's
  `describe` appended. T8's five tests are UNCHANGED.

Unchanged, deliberately: `apps/dashboard/src/terminal/domain/ministryGovernance.ts`
and `MinistryRoom.tsx` (T8's room and its `MINISTRY_COMPLETION`, including its
`permits.brokers` `[]` assertion, are untouched); `services/authority/governance.mjs`
(its empty-store reason stays accurate for ITS readout); `executionAbsence.test.mjs`
and `absence-scope.mjs` (the `:43-52` assertion LOGIC is frozen and this task
touched neither the logic nor its scope); `e2e/terminal-perf.spec.ts` (MARKETS_PANELS
tracks what the MARKETS room fetches, and Paper/Live fetches no candles, so adding
entries would attribute requests to no panel); both lockfiles; `server/data/`; and
`.playwright-tmp/`.

## Guard posture

The route is GATED and DELIBERATELY NOT ALLOWLISTED. It exposes broker ids and
every refusal reason the permit write path can produce, none of it
declared-public, so it gets NO `DECLARED_PUBLIC` entry and NO unruled owner entry:
the 86 decision entries awaiting the owner are not a pool to draw from. Four guards
cover it, the last two because a static scan can be satisfied by a gate that never
runs — the route-auth coverage scan, the bootstrap-gate guard,
`paperLivePermitRoute.test.mjs`'s own anonymous-caller 401, and that file's
`first-run bootstrap` pair.

`requireAuth`'s first-run bootstrap is INHERITED from the shared gate, not
introduced, and is pinned in that file's own words: with an empty user store the
route answers 200, and once one account exists it answers 401. The room's safety
does not rest on the route's exposure — the client renders `unknown` for a refused
request, which is non-permissive.

No ceremony-action route was added, and a test asserts `handlers.mjs` contains no
`unlockVenueClass` and no `setAutomationPermitted`, so nothing in this branch can
create an enablement record or grant a permit at runtime. T9 renders state; it does
not enable execution.

## Net effect

The permit store has its first broker record and its first caller. The Paper/Live
room displays D6's ladder, the current rung from its real producer, T16's
provenance-gated `automationPermitted` beside the raw record flag, and the
ceremony and consent rails with the PRODUCERS' own note strings — and exposes no
live affordance, because D19's outcome authorises none and the verdict type has no
member that could say otherwise. It fails closed in both directions, including the
subtle one. It is independently revertible from Strategy, which is independently
revertible from it. The Strategy room is recorded as `incomplete` with a named open
boundary and a corrected finding, rather than shipped as a panel that would have
looked complete.