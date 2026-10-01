# 0030 - T8_CEREMONY_AND_MINISTRY_ROOMS v1 -> v2

The two middle rooms of D1's order. Ceremony and Ministry, each with a
server route, a projection, a surface, a completion record, and a test that
drives the real producer rather than a fixture.

rule: T8_CEREMONY_AND_MINISTRY_ROOMS
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0030-T8_CEREMONY_AND_MINISTRY_ROOMS-v1-to-v2.md)
date: 2026-10-01
historicalTradesAffected: none
source: >-
  WS-7 task T8 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1264-1271`;
  AC-020 (`:925-931`), AC-035 (`:1045-1051`), AC-041 (`:1093`); R1.4 (`:384`);
  D1 (`:94-101`), D10 (`:175-182`), D12 (`:193-200`), D27 (`:365-372`), D5
  (`:130-137`); the amended WS-6 §0.3 freeze invariants (a) and (d) at `:73`
  recorded in entry 0029 and entry 0027; T16's authority model, detector and
  permit store (`f1567ef`, entry 0024); T7R-B's route/projection/room wiring
  precedent (`99b9960`, entry 0028); and the WS-3 ceremony store and gates
  (`services/commandCentre/ceremonyState.mjs`, `ceremonyGates.mjs`).

reason: >-
  T7 landed the first two rooms and T7R-A authorised the four keys D1 names but
  had no route for. Ceremony and Ministry were routed at RESERVED bodies naming
  WS-7 T8 as their owner — a correct named absence, and now discharged. Both
  producers already existed: the Ceremony room's is WS-3's ceremony store, and
  the Ministry room's is T16's authority model. Neither was rebuilt here.

## Both rooms were already routable, and neither claimed a blocker

T7R-A (`e9c8137`) added `ceremony` and `ministry` to `INNER_NAV.trading` and to
`MINISTRY_ROOMS`, so both keys resolve to a URL today:
`/suites/trading/ceremony` and `/suites/trading/ministry`. Verified in
`src/pages/MinistryShell.tsx:15-16` and `src/pages/ministry/MinistryRoom.tsx`.
Neither room's completion record carries a `routeBlocker`, and neither could
honestly: the blocker T7 recorded for Risk was the frozen room-key count, and it
does not apply to a room whose key exists.

The RESERVED bodies for these two keys are DELETED rather than left exported and
unrouted. An unused export of a reserved body for a key that now has a real room
is a trap: it reads as a live fallback, and a later edit that re-points the
router at that import path finds a placeholder waiting rather than a missing
module. `reservedRooms.tsx` now exports only `StrategyRoom`, which is T9.

## CEREMONY — the producer was WS-3's, and the route already existed

THE ROUTE IS NOT NEW, AND THAT IS THE POINT. `GET /api/command-centre/ceremony`
has existed at `handlers.mjs:1868` since WS-3, already gated with
`requireAuth(req, res)` as its first statement, and already asserted by
`server/__tests__/ceremonyRoute.test.mjs` against the T7 client contract. T8
REUSED it and deliberately added no second ceremony route: one server route per
room is the shape T7R-B established, and a second route over the same store would
give one store two answers taken at two moments.

So Ceremony's server footprint for T8 is **zero files**. T8's contribution is the
surface: `src/terminal/domain/ceremonyRoom.ts`,
`src/terminal/components/CeremonySurface.tsx`,
`src/terminal/routes/CeremonyRoom.tsx`, the page caller
`src/pages/ministry/CeremonyRoom.tsx`, and the transport in
`src/terminal/adapters/governanceReading.ts`.

### R1.4, asserted against the producer's own source

R1.4 (`:384`) requires that "ceremony/handshake unlock requirements on the real
rails are asserted, not assumed". Two producer facts make that concrete, and
`CeremonyRoom.test.tsx` asserts BOTH by reading `ceremonyState.mjs` and
`ceremonyGates.mjs` rather than by asserting a fixture:

1. **`unlockVenueClass()` refuses outside a test run.**
   `ceremonyState.mjs:189-191` throws
   `ceremony:deny:ceremony-action-unreachable`, its own stated reason being that
   "no ceremony-action route is wired in production — the gate/route modules own
   the unlock check". The test asserts the code is present AND that the guard is
   conditioned on `process.env.VITEST !== "true"` — asserting the literal alone
   would have passed against an inverted guard that refused only IN tests.

2. **`evaluateCeremony()` fails on an empty store.**
   `ceremonyGates.mjs:38-46` returns `ceremony:deny:gate1-short` below 300
   spendable resolved rows, and `:187` short-circuits on it. The test asserts
   the deny string and the short-circuit, and then RUNS the real
   `evaluateCeremony` against the real store, which boots empty under the test
   harness, and asserts the rendered room shows `have 0, require 300`.

### The fabrication R1.4 forbids, asserted directly

A room that can render "unlocked" without the rail enforcing it fails R1.4. The
sharpest form of that defect is a room that infers the unlock from the GATES. So
the test feeds the room a store whose gates **all pass** and which holds **no
enablement record**, and asserts it still renders `data-unlocked="false"` and
`not unlocked`. `unlocked` is derived from `enablement.unlocked === true` and
from nothing else, and an enablement object WITHOUT that flag is also not an
unlock — both directions are tested.

### What Ceremony renders, populated vs empty

| | Populated store | Empty store (today, for every venue class) |
|---|---|---|
| unlock | `UNLOCKED`, with the record's `at` and `by` | `not unlocked`, plus "No enablement record. This is an ABSENCE, not a pending approval: on the real rail nothing can create one." |
| gates | each gate with the producer's own `reason`, pass and deny alike | all failing: `ceremony:deny:gate1-short (have 0, require 300)` |
| `spendableResolved` | the store's number, uncopied | `0` |
| platform verification | the record with `at`/`by`/`payoutFloorPct`/`withdrawalTested` | an absence, stated as neither a verification nor an accusation |
| `ok` from the route | labelled "the readout ran", explicitly "not a claim that any gate passed" | same |

## MINISTRY — the producer was T16's, and is consumed unmodified

T16 (`f1567ef`, entry 0024) shipped `authorityModel.mjs`,
`separationOfDuties.mjs` and `brokerAutomationPermit.mjs`. T8 consumed them and
re-implemented none of it:

- **No second collision detector.** `governance.mjs` calls T16's
  `describeRoomSeparation` per room key. T16 proved its detector pure by reading
  its own source, and found a real defect doing so — a `recordIndex` field that
  made registry position look like a fact. A second copy of the condition in a
  route or a room is precisely the drift plan §3.5 Risk 6 names.
- **No tier logic restated.** `brokerAutomationPermit.mjs` contributes exactly
  one boolean; what a permit means for an action is T11's `tiers.mjs:56-101`.

### `WS-7+` is not a string this task invented

D10 (`:175-182`) reserves `WS-7+` for anything unassigned, and T16 asserts
`authorityById(authorities, "WS-7+")` is `null` — it is a DISPLAY value, never an
authority id. The route emits it from T16's own `unassignedAuthorityLabel()`.

The anti-goal "Ministry inventing a string for unassigned other than WS-7+" is
held STRUCTURALLY: `MinistryRoom.test.tsx` reads the room, the domain projection
and the surface, strips their comments, and asserts that none of the three
CONTAINS the literal. The string reaches the room from the route, so a second copy
cannot exist to drift. The stripper carries its block state across lines, because
`MinistryRoom.tsx` explains D10 in a JSDoc block and a per-line stripper reported
that explanation as a second copy — the same class
`ws7RouteAuthCoverageGuard.test.mjs` documents for gate names in prose.

### There is NO production authority set, and that is the room's content

Enumerating every `.mjs`/`.ts`/`.tsx` under `apps/dashboard` for
`createAuthority`, `defineAuthorities` and `createBrokerAutomationPermitStore`
finds referents only in T16's own tests and fixtures. So the authority set is
empty, the build registry is empty, and the permit store holds no broker. Every
one of those is a NAMED absence in the response with its own reason, and every
room's approver renders as `WS-7+`.

### The three-way separation state, which is T8's own contribution

T16's `separated: boolean` is `true` for an empty registry. That is CORRECT as an
answer — a collision needs an approval to collide with — and wrong as a CLAIM:
nobody was separated from anything, because nobody was assigned. Entry 0024
obligation 2 names this. The room therefore renders three states, and `empty` is
a distinct label with its own reason:

| State | Condition | Rendered as |
|---|---|---|
| `collision` | `collisions.length > 0` | the pair: title, id, room, and every build verb — AC-035:1048 asks for the pair |
| `separated` | no collision AND something was assigned | "Separated — builders: …; approvers: …" |
| `empty` | no collision AND no builders AND no approvers | "EMPTY — nothing to separate", with "not a verified one: the collision check is vacuous rather than passed" |

### The route

`GET /api/trading/ministry`, gated, with `requireAuth(req, res)` as the FIRST
statement and ahead of any precondition — the T7R-B shape copied verbatim.

**GATED, NOT ALLOWLISTED.** It exposes authority ids, room keys, collision codes
and refusal codes; none of it is declared-public. It gets NO `DECLARED_PUBLIC`
entry and NO unruled decision-owner entry, because the 86 unruled decision
entries awaiting the owner are not a pool to draw from. Three guards cover it,
the third because a static scan can be satisfied by a gate that never runs:
`ws7RouteAuthCoverageGuard`, `ws7AuthBootstrapGateGuard`, and
`ministryGovernanceRoute.test.mjs`. That test drives the route through the real
handler and asserts a 401 discloses none of `authority`, `approver`, `builder`,
`separat`, `collision`, `ws-7+` or `permit`, and it PINS the inherited first-run
bootstrap by asserting the same request answers 200 with no accounts and 401 with
one.

It reads candles for neither room, and fetches nothing belonging to the other.

## The bisect line, held by a dedicated test

Spec `:1271` — "Neither room may depend on the other to render; both degrade to
reserved independently." That is a claim about the PAIR, so it is held in
`roomBisect.test.tsx` rather than inside either room's own file.

The proof is by making the sibling UNLOADABLE, not by reading an import list:
`vi.doMock(<sibling>, () => { throw … })` replaces the module with a factory that
throws on evaluation, so anything in the rendering graph that imports it fails
the render. Both directions are held, because one direction passing proves
nothing about the other. A static import-list check runs too, over the FULL graph
of each room — room, projection, surface, adapter and page caller — plus the
claim that neither page caller fetches the other's endpoint, and that the shared
adapter offers one endpoint per room and no `credentials` option.

**THE TEST WAS PROVEN TO BITE.** A sibling import was temporarily added to
`CeremonyRoom.tsx` and `roomBisect.test.tsx` failed twice (the dynamic proof and
the static check); the import was removed and both suites returned green.

Both rooms are separately asserted to render real output with NO readout at all,
so independence is not satisfied by a room that cannot render — and the two
absences are asserted to be visibly different from each other.

## Two defects this task found in its own work, and one it inherited

**A comment that broke a sibling test.** T8's first draft of the route comment
quoted the allowlist marker verbatim. `copilotDecisionRoute.test.mjs` proves the
route BEFORE this one is not allowlisted by slicing a fixed 1,400-character
window forward from that route's dispatch line, so the window reached T8's prose
and the reference test went red. The fix was to WORD THE COMMENT ACCURATELY, not
to widen the window or relax the assertion — a prose mention read as a code site,
the same class `ws7RouteAuthCoverageGuard` documents. Recorded at
`ws7AuthBootstrapGateGuard.test.mjs` so a future reader does not "restore" the
marker.

**A harness that took a real bypass.** `ministryGovernanceRoute.test.mjs`
originally supplied `socket: { remoteAddress: "127.0.0.1" }`, which trips
`isLocalhostRequest` and is admitted outright by `requireAuth` before any store
is consulted (`handlers.mjs:5854`). The 401 assertions failed. That bypass is
real and correct — a loopback caller is inside the trust boundary — so the fix was
the HARNESS: an assertion that a route refuses an anonymous caller must present a
NON-loopback caller, which is what omitting `socket` does. `copilotDecisionRoute`'s
harness does the same.

**Inherited: entry 0029 was red on arrival.** Commit `42dfaac` shipped
`0029-SPEC_AMENDMENT_room_count_and_route_layer-whitelist-v1-to-v2.md` with a
filename violating the `NNNN-<rule>-vN-to-vM.md` rule and NONE of the seven
required header fields, so four `ws7RegulatoryClaimGuard` D20 assertions were
failing before T8 began. T8 renamed the file and added the header, changing no
prose. Recorded because the guard's own contract is that a record missing a field
is a rule nobody can check, and because a red suite blocks the floor every WS-7
task verifies against.

## Pin accounting

`handlers.mjs` moved by exactly T8's one route, and every figure moved with the
accounting its own comment requires:

| Figure | Before | After | Why |
|---|---|---|---|
| lines | 6126 | 6177 | +51: the gate as the first statement, the dynamic import, the `writeJson`, the 502 branch, and the reasoning |
| dynamic `import()` | 81 | 82 | the one new service import, so the authority model stays off the boot path |
| static `import` | 72 | 72 | UNCHANGED — the growth is a route, not a module-level dependency |
| `verifyUser()` sites | 36 | 36 | unchanged; this route uses the shared `requireAuth` |

`ws7EncodingIntegrityGuard`, `ws7RouteAuthCoverageGuard`,
`ws7RouteAuthCoverageBehaviour` and `ws7RegulatoryClaimGuard` were not modified.
No frozen characterisation assertion was moved, and no existing guard value was
weakened — the only guard edits are the three pin figures above, each moved to
its new TRUE value with the accounting recorded beside it.

## Per-item handoff disposition — entry 0024 (T16)

The rule: **discharge only what this diff actually lands.** A producer's
existence does not discharge a room's RENDER obligation.

| # | Entry 0024 handoff | Disposition |
|---|---|---|
| 1 | **The Ministry room** — the server side shipped in T16; the render was BS-3 | **DISCHARGED.** `src/terminal/routes/MinistryRoom.tsx`, `components/MinistrySurface.tsx`, `domain/ministryGovernance.ts`, `pages/ministry/MinistryAuthorityRoom.tsx`, and `server/__tests__/ministryGovernanceRoute.test.mjs`. All six enumerated render obligations land — see below. |
| 2 | **The Ministry room's route key** | **DISCHARGED, and not by this diff.** Landed by T7R-A (`e9c8137`); verified present at `src/pages/MinistryShell.tsx:16`. T8 re-pointed the router at a real page composition. |
| 3 | **The build registry has no producer** | **STILL OPEN, and now made visible rather than silent.** T16 named T8 and T21 as its consumers and producers. T8 became the CONSUMER: the registry is an input to `GET /api/trading/ministry` and every room's `empty` separation state names it. T8 did NOT become the PRODUCER, because emitting a `construct`/`deploy`/`promote` record means attributing a room to a named authority, and no authority exists — T16's own `UNKNOWN_AUTHORITY_CODE` refuses exactly that. **Remaining work: the owner names real authorities and says who builds what; `services/authority/governance.mjs` then sources `authorities` and `buildRecords` instead of the empty arrays it declares today.** Recorded in `MINISTRY_COMPLETION.absences[1]`. |
| 4 | **No caller of the permit store** | **STILL OPEN, and T16 named whose it is.** T16 assigned the permit FLAG's display to T9's Paper/Live room (`:1278`), so T8 did not pre-build it. What T8 lands is the READ half obligation 4 asks for: `MinistrySurface` renders each grant's `approvedByAuthorityTitle`, its `scope[]`, the `roomKey` and the `at`, and obligation 5's refusal codes are rendered as text with their messages. Both sections render their named absence today because the store holds no broker. **Remaining work: T9 wires `setAutomationPermitted` to a broker record and supplies the Paper/Live permit display; `domain/ministryGovernance.ts`'s `projectGrant` then has rows to project.** Recorded in `MINISTRY_COMPLETION.absences` and in `governance.mjs`'s header. |

### The six enumerated render obligations, item by item

Entry 0024 §"Exactly what the Ministry room must do later":

| # | Obligation | Discharged by | Note |
|---|---|---|---|
| 1 | Render the authority set with `id`/`title`/`scope[]`/`canApprove[]`, anything unassigned as `WS-7+`, never a fabricated record | `MinistrySurface` authority section + `MinistryRoom.test.tsx`'s literal-scan and `authorityById` tests | The set is EMPTY today, so the surface renders the named absence and every room's approver renders `WS-7+`. The rendering path for a populated set is tested with a populated set. |
| 2 | Per room, `builders[]`/`approvers[]`/`collisions[]`/`separated`, with an explicit EMPTY state rather than "clean" | `domain/ministryGovernance.ts`'s `separationStateFor` + the room's per-room section | The three-way state is T8's own contribution and is asserted directly, plus through the rendered `data-separation`. |
| 3 | On a collision, name BOTH offenders: `authorityId`, `authorityTitle`, `roomKey`, `builds[]` | `projectCollision` + the collision `<li>` | Asserted with `data-collision` and `data-collision-builds`, and the full sentence is asserted. |
| 4 | Show a grant's approving authority, `scope[]`, `roomKey`, `at` | `projectGrant` + the grant section | The RENDERING exists and is tested with a populated grant; the DATA does not yet exist (handoff 4). |
| 5 | Render a refusal as a refusal — code and message, not a toast | `GOVERNANCE_REFUSAL_CODES` + the refusal section | Codes are copied from T16's own exported constants, so the surface cannot drift from the writer. |
| 6 | Display `scope` as the approving authority's declared remit on every approval | Authority `<li>` and grant `<li>`, both with `data-*-scope` | Rendered on every record, not only on approvals. |

### Other ledgers touched

| Source | Item | Disposition |
|---|---|---|
| 0023 (T12) #2 | Wire `evaluateCopilot({ conflicts })` into a caller | **DISCHARGED** at `99b9960` (T7R-B), before this task. Untouched here. |
| 0025 (T13) #6 | No caller of the sentiment reader | **STILL OPEN, not T8's.** Owner: T13's model artifact is a measured absence rendered by Markets. Not touched. |
| 0028 (T7R-B) | All 15 items it left open | **Not T8's to discharge.** T8's own contribution is this record. The three items T8's diff lands are item 1 (the Ministry room render) and, from the same ledger's framing, the three guards covering the new route. |

## Three `.d.mts` files, and why they declare so little

The room tests import three real server modules so their assertions run against
the PRODUCERS rather than against fixtures — `evaluateCeremony` and
`KNOWN_VENUE_CLASSES` for Ceremony, `authorityById` for Ministry. All three are
plain `.mjs`, so the importers got TS7016 and an `any`, and a shape mismatch would
have become a fabricated reading at runtime instead of a compile error. T7R-B set
the precedent with `services/copilot/decision.d.mts` and this follows it.

Each declaration is deliberately PARTIAL, and the omissions are the safety
property rather than an oversight:

- `ceremonyState.d.mts` declares the READ surface and NO mutation seam.
  `creditResolved`, `unlockVenueClass`, `setAssetClasses` and `resetCeremonyState`
  are absent, because a client test that can type-check a call to one is one edit
  from writing to a developer's real ceremony store. The room's assertions are
  about what the store REPORTS.
- `authorityModel.d.mts` declares `authorityById` and `unassignedAuthorityLabel`
  and NOT `createAuthority`/`defineAuthorities`, for the same reason: a client test
  that could mint an authority is a client test one edit from violating D10. Its
  `authorityById` return is typed `| null`, because that nullability IS D10's
  assertion and a non-null return type would let a caller dereference a lookup
  that is expected to fail.
- `ceremonyGates.d.mts` types `enablement` as a UNION, because every read in the
  store returns `{ locked: true, reason }` on an unhealthy store rather than the
  record map — a declaration that typed it as the map alone would let the room's
  projection reach `.unlocked` on an unhealthy answer.

`@ts-expect-error` was NOT used to silence TS7016. That would have made the type
system agree with an `any`, which is the opposite of what a declaration is for.

## Files

Added:

- `apps/dashboard/server/services/authority/governance.mjs`
- `apps/dashboard/server/services/authority/authorityModel.d.mts`
- `apps/dashboard/server/services/commandCentre/ceremonyState.d.mts`
- `apps/dashboard/server/services/commandCentre/ceremonyGates.d.mts`
- `apps/dashboard/server/__tests__/ministryGovernanceRoute.test.mjs`
- `apps/dashboard/src/terminal/domain/ceremonyRoom.ts`
- `apps/dashboard/src/terminal/domain/ministryGovernance.ts`
- `apps/dashboard/src/terminal/components/CeremonySurface.tsx`
- `apps/dashboard/src/terminal/components/MinistrySurface.tsx`
- `apps/dashboard/src/terminal/routes/CeremonyRoom.tsx`
- `apps/dashboard/src/terminal/routes/MinistryRoom.tsx`
- `apps/dashboard/src/terminal/adapters/governanceReading.ts`
- `apps/dashboard/src/pages/ministry/CeremonyRoom.tsx`
- `apps/dashboard/src/pages/ministry/MinistryAuthorityRoom.tsx`
- `apps/dashboard/src/terminal/routes/__tests__/CeremonyRoom.test.tsx`
- `apps/dashboard/src/terminal/routes/__tests__/MinistryRoom.test.tsx`
- `apps/dashboard/src/terminal/routes/__tests__/roomBisect.test.tsx`

Edited:

- `apps/dashboard/server/handlers.mjs` — one gated route, +51 lines
- `apps/dashboard/src/pages/ministry/MinistryRoom.tsx` — two keys re-pointed
- `apps/dashboard/src/pages/ministry/reservedRooms.tsx` — two reserved bodies deleted
- `apps/dashboard/server/__tests__/ws7AuthBootstrapGateGuard.test.mjs` — three pin figures, with accounting
- `docs/trading-logic/changelog/entries/0029-…` — renamed and header completed (inherited defect)

Untouched, deliberately: `e2e/terminal-perf.spec.ts` (its `MARKETS_PANELS` list
tracks what the MARKETS room fetches, and neither new room fetches market data —
adding entries would attribute requests to no panel), `services/copilot/**`,
T16's three authority modules, `streamCatalog.ts`, both lockfiles,
`server/data/`, `.playwright-tmp/`.

## Verification

- `npm run typecheck` green.
- `npm test --workspace @picc/dashboard`: **4789 passed / 1 skipped / 0 failed**
  (4790 total across 364 files: 363 passed + 1 skipped), twice pre-commit and once
  post-commit. Floor 4744; the rise is this task's own 45 new tests. The
  store-isolation guard enumerates via `git ls-files`, so the post-commit run is
  the one that can see the new test files; that ordering is why it was repeated
  after the commit.
- `git diff --check` clean; nothing under `server/data/`, `.playwright-tmp/` or
  any lockfile.
- No e2e run. No push.
