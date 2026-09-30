# 0024 - T16_AUTHORITY_AND_SEPARATION_OF_DUTIES v1 -> v2

Execution record for WS-7 task T16: the authority model `{ id, title, scope[],
canApprove[] }`, the mechanical build/approve collision detector, and the
`automationPermitted` change-event wiring from D5.

rule: T16_AUTHORITY_AND_SEPARATION_OF_DUTIES
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0024-T16_AUTHORITY_AND_SEPARATION_OF_DUTIES-v1-to-v2.md)
date: 2026-10-01
historicalTradesAffected: none
source: >-
  WS-7 task T16 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1336-1343`,
  decision D5 (`:130-137`), decision D12 (`:193-200`), D10 (`:175-182`),
  requirements R12.1/R12.2 (`:446-447`), acceptance criterion AC-035
  (`:1045-1051`), AC-024 (`:957-963`), the core data shapes at §4.3
  (`:590-672`, with `Authority` at `:642-648` and `BrokerRecord` at `:634-640`),
  the proposed module layout at §4.2 (`:568-570`), the risk table at §7
  (`:1436`), the freeze invariants at §0.3 (`:73`), the bisect matrix row BS-2
  (`:1397`), T8's file line (`:1267`), and plan v1 §3.5 (`:285-298`) with its
  Risk 6.

reason: >-
  D5 requires "ministry-authority sign-off" for the A+ auto-execute tier and D12
  requires that sign-off to come from an authority model the repository does not
  have. T11 built the decision path that CONSUMES the flag
  (`tiers.mjs:56-101`) but nothing anywhere owned the flag: as of `a4fac35`,
  `automationPermitted` existed only as a parameter read from whatever caller
  supplied it, with no record, no default at persistence, and no audit event.

  T16 therefore builds the authority side, not the broker-persistence side. The
  flag's default, its change event, and the separation check that guards it all
  live behind one write path that no existing caller uses yet — so nothing that
  ships today changes behaviour, which is what BS-2's placement requires.

## The authority record, as implemented

`{ id, title, scope[], canApprove[] }` and nothing else. D12:196 says "records of
**exactly** that shape", so `createAuthority` **refuses a fifth field** by name.
The obvious fifth field is `builtRooms`, and refusing it is the point:

1. §4.3:642-648 lists four fields, and a client-side mirror will list four.
2. A self-declared `built-room list` is a self-report. The build side of a
   separation-of-duties control has to come from the build side of the system, or
   the control is satisfied by whoever wrote the list.

So the build registry is a separate input: `buildRecords[] = { authorityId,
roomKey, action }`, where `action` is one of `construct | deploy | promote`.

**`scope[]` is carried and deliberately not interpreted.** §4.3 annotates
`canApprove` as room keys and says nothing about `scope`; D12 states the collision
in terms of builds. Reading `scope` as a build set would replace AC-035's
build/approve comparison with a field comparison and would invent a constraint
the spec never states. `scope` is validated (array of unique non-empty strings)
and carried onto the change event as the approving authority's declared remit.

`canApprove[]` is likewise room keys (§4.3:646), validated as an array of unique
non-empty strings. An empty array is a legitimate record — an authority that
approves nothing — and is not confused with "unknown".

**D10's reservation is a display value, never a record.**
`authorityById(authorities, "WS-7+")` is asserted to return `null`. A synthesised
record bearing that string as its id would satisfy a separation check and a permit
approval with a name no human holds, which is the fabrication D10:175-182 exists
to prevent. `unassignedAuthorityLabel()` returns the literal for a surface to
display instead.

## The collision condition, in one sentence

> A collision exists for authority **A** and room **R** if and only if **R** is in
> **A.canApprove** and **A** appears in the build registry for **R** — over any
> build verb, for any authority, for any room, with no regard to `scope`, to how
> many authorities exist, or to what any room is called.

Three things the condition deliberately does **not** contain, each with its own
test:

- **`scope`.** See above.
- **A verb allowlist.** D12 says "builds", and a build reaches production by being
  constructed, deployed, or promoted — the last being the one an approval would
  most plausibly be waved through on. All three verbs are builds. The verb is
  *validated* against a closed vocabulary and **refused** when unrecognised, not
  filtered: a typo that silently dropped a build record would leave the control
  passing on evidence it never read.
- **A special case.** The near-miss control is the one that matters.

### The worked pair: a collision IS detected

`COLLIDING_BUILDS` holds exactly one collision, and the fixture self-check
(`assertFixtureGeometry`) fails the file if it ever stops holding exactly one:

| Authority | `canApprove` | Built | Collides |
|---|---|---|---|
| `auth:build-lead` | `[risk, ceremony]` | `risk` (**construct**), `markets` | **YES** on `risk` |
| `auth:build-lead` | — | — | no, on `markets` (it does not approve it) |
| `auth:review-lead` | `[markets, dispatch]` | `ceremony` | no |
| `auth:trading-ops` | `[dispatch]` | `simulator` | no |

`detectBuildApproveCollisions` returns `ok: false` with one collision naming
**both** offenders, as AC-035:1048 requires:

```text
authorityId: "auth:build-lead"
authorityTitle: "Trading build lead"
roomKey: "risk"
approvedVia: "canApprove"
builds: [{ action: "construct" }]   buildCount: 1
```

`assertNoBuildApproveCollisions` throws with `.code === COLLISION_CODE`
(`authority:collide:build-approve`) and a message containing both the authority
id and the room key, so the operator reading the log is told which pair to fix.

### The worked pair: it is correctly NOT detected

`COMPLIANT_BUILDS` is the **same four authorities, the same four build records,
and the same four distinct rooms** — only the room each verb was applied to
moved. Nothing was deleted and no count changed, so size, name and room-vocabulary
checks cannot explain the differing verdict.

| Authority | `canApprove` | Built | Verdict |
|---|---|---|---|
| `auth:build-lead` | `[risk, ceremony]` | `markets`, `simulator` | clean — builds X, approves Y |
| `auth:review-lead` | `[markets, dispatch]` | `ceremony` | clean |
| `auth:trading-ops` | `[dispatch]` | `risk` | clean |

Two further non-collisions are asserted, because both are the ways a detector
gets this wrong:

- **Two authorities on one room.** `auth:trading-ops` builds `risk`;
  `auth:build-lead` approves `risk`. Different authorities, so no pair collides.
  A detector keyed on the ROOM rather than on the (authority, room) pair fails
  here.
- **Building a room without approving it.** `auth:build-lead` builds `markets` and
  approves `risk`/`ceremony`. It appears in `COLLIDING_BUILDS` — the registry that
  DOES collide — and `markets` is still reported separated. The per-room
  projection answers `separated: true` for `markets` and `separated: false` for
  `risk` **from the same registry**.

### The condition is evaluated exhaustively, not sampled

A matrix test runs **every** (authority × room × verb) combination — 4 × 4 × 3 =
48 cases — and computes the expected verdict from the condition independently of
the implementation. A further test hands the same facts in reversed registry
order and asserts `JSON.stringify` is byte-identical, so collision ORDER comes
from the authority set and never from array position. That is the same defence
T12 used against ordering luck for C1-vs-C2, and it caught a real defect here:
T16's first implementation carried `recordIndex` — the build record's position in
the registry — on every collision, which made two runs over the same facts
disagree. Position is not a fact; it was removed.

### Purity is asserted against the source, not trusted

`separationOfDuties.mjs` imports **nothing at all** and contains no `Date.now`,
`new Date`, `performance.now`, `Math.random`, `fetch(`, `node:fs`, `node:net`,
`node:http`, `require(` or `await `. A test reads the module's own source and
asserts each of those absent, plus asserts the import list is empty. An AC-035
verdict that could not be reproduced from the fixture that produced it would not
be a control, so this is the anti-goal stated as a test rather than as a promise.

## `automationPermitted`: the decision, and the test that holds it

**Decision: a DECLINE requires a recorded approving authority too. Both
directions are gated, and an unattributed change is REFUSED in both.**

The literal reading of D5:133 is "**Setting it true** requires ministry-authority
sign-off", which would leave a change to `false` free to be a bare boolean
assignment. Four things in the spec say no:

1. **§4.3:638 types `permitChangedByAuthorityId` as a SINGLE field, not a log.**
   An unattributed decline has to write `null` into it, destroying the record of
   who granted permission. Gating both directions is what keeps that field
   non-null after every successful change — which is precisely what plan v1
   §3.5:293-295 asks to be asserted ("must never be written `null` by a successful
   change").
2. **T16's acceptance (`:1341`) says "EVERY change"**, and the plan makes a change
   with no authority a *refusal* rather than a permitted write.
3. **D5's threat is unattended PROMOTION.** The sequence `true → false → true` with
   an unattributed middle link is exactly the sequence an audit needs to read, and
   exactly the sequence a decline-only waiver erases.
4. **D7:148-155** makes a safety-relevant transition a first-class inspectable
   outcome, "not a boolean folded into a score". Revoking automation is
   safety-improving; it is owed the same provenance as granting it.

### The cost, stated rather than hidden

Refusing an unattributed **decline** is the fail-OPEN direction: a refused decline
leaves the flag as it was, possibly `true`. That is a real cost and T16 does not
pretend otherwise. Two things bound it, and both are tested:

- **The refusal is loud.** A named throw (`PERMIT_NO_AUTHORITY_CODE`), never a
  silent no-op. A caller cannot mistake a refused revoke for a performed one.
- **The read is provenance-gated.** `isAutomationPermitted` requires a true flag
  **and** a resolving approving authority, so a record patched with a bare
  boolean — by a migration, a hand edit, or a future caller bypassing this store —
  does not read as permission. This is AC-024:961's "an absent flag must not mean
  permitted" applied to provenance as well as to value. A test grants a permit,
  reads it `true`, then reads the same record against an authority set that no
  longer contains the approver and gets `false`.

### The tests that hold the decision

- *"refuses a grant with no approving authority, and writes nothing"* — the
  record is byte-identical afterwards and the log is empty.
- *"refuses a **decline** with no approving authority, and writes nothing"* — the
  counter-case to the above, and the one the literal reading would let through.
  The record is byte-identical and the log still holds exactly the one prior
  event.
- *"records the DECLINING authority too"* — after a grant, a decline writes the
  **decliner's** id into `permitChangedByAuthorityId`, and the log holds both
  events with their `from`/`to` and timestamps.
- *"refuses a DECLINE blocked by a collision, loudly, and leaves the record
  alone"* — the fail-open case above, pinned as its own test.

## AC-035 is enforced by refusing a write, not by drawing a red row

Plan v1 §3.5:290-292 requires that "the detector is called from the persistence
path, not only from the Ministry room's render". The permit store's
`setAutomationPermitted` calls `assertNoBuildApproveCollisionFor` **before** it
writes anything, and propagates the detector's own code and message. A test
asserts the record is untouched and the log empty after the refusal, and a
comment in the module states that this is what AC-035:1049's "may not be a
convention or a UI-only warning" means in practice.

### The two forms, and why they differ on purpose

| Form | Condition |
|---|---|
| `detectBuildApproveCollisions` | `approve(A, R)` **and** `built(A, R)` |
| `assertNoBuildApproveCollisionFor` | `built(A, R)` only |

The focused form is the WRITE-PATH guard, and its `authorityId` is by construction
the party approving the grant, so it does not re-ask whether that authority
approves the room — the caller is asserting it. What it asks is whether that same
party BUILT the room the grant is held under. Keying it on `canApprove` would let
an authority that built a room but holds no approval over it pass a check whose
whole question is "did the approver also build it".

So `markets` is refused by the focused form (build-lead built it) while the
aggregate report calls that room separated (build-lead never approves it, so
there is no approval to collide with). **Both verdicts are asserted in one test**,
because a reader who assumes they must agree is the reader most likely to get it
wrong.

The focused form also refuses an unregistered approving authority rather than
treating it as one with an empty build history — absent is not permitted, applied
to identity.

The **aggregate** form is what the Ministry room and T21's seam guard consume.
The write path deliberately does not run it: refusing every automation grant
because some unrelated authority collides with some unrelated room would make one
pre-existing collision freeze automation permanently, which is a denial of
service rather than a control.

### Referential integrity, kept out of the collision condition

A build record naming an authority that is not registered is reported in a
separate `unknownAuthorityIds` field, and `assertNoBuildApproveCollisions` throws
`UNKNOWN_AUTHORITY_CODE` for it. It is **not** a collision — there is no
`canApprove` to collide with — but it must not be treated as clean: a build that
matches no authority record can never collide, so ignoring it would let the
registry pass on missing evidence. Keeping it a distinct field is what lets the
collision condition stay exactly AC-035's.

## The one write path, and what it records

```text
permit  ─┐
         ├─► setAutomationPermitted ─► [1] broker exists?
decline ─┘                            [2] explicit boolean? finite `at`? roomKey?
                                      [3] registered approving authority?
                                      [4] approving authority built the room?
                                      [5] append the change event
                                      [6] write the record
```

Each event carries `sequence`, `event: "automation-permitted-changed"`,
`field`, `brokerId`, `from`, `to`, `approvedByAuthorityId`,
`approvedByAuthorityTitle`, **`scope`** (the approving authority's D12 `scope[]`,
verbatim — this is the "under what scope" the acceptance requires), `roomKey`,
`separationChecked: true`, `at`, and `retentionClass`.

- **No clock.** `at` is a REQUIRED caller-supplied argument. The module contains no
  `Date.now` and no `new Date`, asserted against its own source. An audit record
  whose time nobody can account for is not an audit record.
- **Append-only.** The store exposes no `update`, `delete`, `remove`, `clear`,
  `reset`, `set` or `patch`; a test asserts each is `undefined` **by name**, so it
  fails if one is ever added. `setAutomationPermitted` is the only mutator.
- **`createBrokerRecord` refuses to be seeded.** Supplying `automationPermitted`,
  `permitChangedAt` or `permitChangedByAuthorityId` throws by name. A broker record
  that could be constructed already-permitted would make D5's default decorative.
  Defaults are asserted at the record type (AC-024:962's first half) and at
  persistence (its second).
- **A repeat of the same value is still recorded**, with `changed: false` derived
  and returned. The alternative — silently succeeding — would leave a caller with
  no way to know whether its assertion had any effect.
- **A throwing sink propagates.** Losing an audit record silently is worse than
  failing the change.

**Retention class.** D8:157-165 assigns `permanent_append_only` to veto decisions,
score breakdowns and execution receipts. A permit-change event is none of those
three, so `PERMIT_CHANGE_RETENTION_CLASS = "permanent_append_only"` is **T16's
judgement** and is the conservative one: deleting the event removes the only
evidence that auto-execute was ever authorised. T15 owns `retention.mjs`
(`:1330`) and may re-route it; no purge path exists here either way, which is the
property that actually protects the record. The test asserts the class comes from
D8's existing vocabulary rather than a new name.

## No tier logic was restated

What a permit *means* for an action is T11's `tiers.mjs:56-101`, and plan v1 §2's
Risk 6 warns that a duplicated safety boundary is where drift starts. T16's store
contributes exactly one boolean and nothing else.

Two tests hold that:

- `evaluateCopilot` is called with `{ automationPermitted: store.isAutomationPermitted(id),
  rung: "paper" }` and the engine's `tier.automationPermitted` is asserted equal to
  the store's read both before and after a grant. The market state is T11's own
  `fullMarketState` fixture with T11's own overrides, so a T11 input change surfaces
  as a T11 failure.
- The AC-024 outcome change is asserted by calling **T11's own exported `tierFor`**
  at a score above T11's own boundary, changing only the store's boolean:
  `notifyForApproval` → `autoExecute` → `notifyForApproval` across
  grant-then-decline.

T16 deliberately did **not** build an A+ market fixture. T11 tests `tierFor` with
explicit scores precisely because none of its market fixtures score A+, and
manufacturing one would mean reverse-engineering T11's confluence — a second copy
of the arithmetic, which is the exact failure Risk 6 names.

## BS-3 handoffs named, not silently trimmed (D27)

| # | Handoff | Why it could not land in T16 |
|---|---|---|
| 1 | **The Ministry room.** T16's file list at `:1339` names "the Ministry room and its tests". The **server side ships complete** — the authority model, the detector, and the per-room projection it will render. The room's *render* is BS-3. See the note below. | BS-2's "must not touch" column is **room visuals** (`:1397`), and the instruction for this task was explicit: nothing under `apps/dashboard/src/` |
| 2 | **The Ministry room's route key.** The room has no key yet. T16 did not create one, and `describeRoomSeparation` treats `roomKey` as an opaque string and never looks it in a room table, so T16 needs no key of its own. | The amendment that authorises `ministry` (and `risk`, `ceremony`, `strategy`) is **T7R-A**'s, per the owner's 2026-09-30 ruling to 22 instances / 15 keys. T16's handoff therefore names **no URL and assumes none** |
| 3 | **The build registry has no producer.** `buildRecords[]` is injected, exactly as T11 injected the veto index's `sink` and `store`. Nothing yet emits `construct`/`deploy`/`promote` records for a room, because no room is attributed to a named authority yet. T8 and T21 are its consumers and its producers. | A registry that nobody writes is honest — an empty registry has no collisions — but it is also not yet evidence. This is the same state T11's veto index shipped in |
| 4 | **No caller of the permit store.** As T12 recorded for `evaluateCopilot({ conflicts })`, the engine's default path is untouched and nothing supplies a broker permit until a service does. Wiring the store to a broker record and to the Paper/Live room is BS-3 (T9's room displays `automationPermitted` state, `:1278`). | Same |

### The T16 file-list / bisect tension, and how it was resolved

T16's file list at `:1339` names "the Ministry room and its tests", while the
bisect matrix places T16 in **BS-2** (`:1397`), whose "must not touch" column is
**room visuals**. The plan anticipates the split at §3.5:296-298 — T16 delivers the
model and detector, T8 delivers the surface — and T8's own file line at `:1267`
says the authority model "is consumed here, not built here".

**Resolution taken: the server side landed; `apps/dashboard/src/` gained zero
bytes; the room's consumption is recorded here as an untrimmed BS-3 handoff.**
The same pattern T11 (entry 0022) and T12 (entry 0023) used and recorded. The
instruction for this task was unambiguous that `src/` must not be edited, and it
was not.

**Exactly what the Ministry room must do later, so nothing is dropped:**

1. Render the authority set from `defineAuthorities(...)`: each record's `id`,
   `title`, `scope[]` and `canApprove[]`, with anything unassigned shown as the
   literal `WS-7+` from `unassignedAuthorityLabel()` — never a fabricated record.
2. For each room, render `describeRoomSeparation({ authorities, buildRecords,
   roomKey })`: `builders[]`, `approvers[]`, `collisions[]`, `separated`. A room
   with no builders and no approvers must render as an explicit **empty**
   separation state, not as "clean" — the distinction between "nothing to
   separate" and "separation verified" is the whole reason the projection returns
   `separated: false` for a real collision and `true` for an empty registry.
3. On a collision, name **both** offenders from the record: `authorityId`,
   `authorityTitle`, `roomKey`, and the `builds[]` verbs. A row that says
   "separation violation" without the pair is not actionable, and AC-035:1048
   asks for the pair.
4. Show the approving authority of any `automationPermitted` grant from the
   permit store's change events: `approvedByAuthorityTitle`, its `scope[]`, the
   `roomKey` the grant is held under, and the `at` timestamp.
5. Render a refusal as a refusal. `setAutomationPermitted` throws named errors for
   an unattributed change, an unregistered approver, a build/approve collision and
   an unknown broker. The room must show the code and the message rather than
   swallowing them — a governance surface that turns a refusal into a toast is the
   "UI-only warning" AC-035:1049 forbids.
6. Display `scope` as the approving authority's declared remit on every approval,
   because that is the only place the word "scope" is load-bearing in D5's chain.

## Files

Added:

- `apps/dashboard/server/services/authority/authorityModel.mjs`
- `apps/dashboard/server/services/authority/separationOfDuties.mjs`
- `apps/dashboard/server/services/authority/brokerAutomationPermit.mjs`
- `apps/dashboard/server/services/authority/__tests__/authorityModel.test.mjs`
- `apps/dashboard/server/services/authority/__tests__/separationOfDuties.test.mjs`
- `apps/dashboard/server/services/authority/__tests__/brokerAutomationPermit.test.mjs`
- `apps/dashboard/server/services/authority/__tests__/fixtures/authorityFixtures.mjs`

Edited: **none.** T16 is additive. No existing file was modified — not
`copilot/engine.mjs`, not `copilot/tiers.mjs`, not `vetoIndex.mjs`, not
`contracts.ts`, not any room route, not any existing test, and not any guard
value. T11 and T12's files were read, not touched.

Unchanged, deliberately: `apps/dashboard/src/**` (BS-2 must not touch room
visuals, and the instruction forbade it), `apps/dashboard/src/pages/ministry/MinistryRoom.tsx`
(its `MINISTRY_ROOMS` map has no `ministry` key and T16 did not add one), the
`ministryRooms.test.tsx` ordered-list pins, both lockfiles, `server/data/`, and
`.playwright-tmp/`.

## The readings T16 had to make, and which text won

1. **The build side is a registry, not a field.** See "The authority record".
   D12's prose ("an authority that builds a room and then approves it") and
   AC-035:1046 ("also appears as that room's builder") both name a BUILDER; §4.3
   lists four fields and none is `builtRooms`. **AC-035 won**, being the binding
   criterion, and its "builder" is sourced from outside the record.

2. **All three build verbs count.** D12 says "builds" and gives no vocabulary.
   The user's framing — constructs / deploys / promotes — is used as the closed
   set. A narrower set would leave the control open on the verb a promotion goes
   through. The set is exported as data and asserted per verb.

3. **`scope` is not a build set.** See "The authority record". §4.3 annotates
   `canApprove` only, and D12's collision is stated in build terms. Reading
   `scope` as builds would be a *second, different* control wearing this one's
   name.

4. **The write-path check is `built` only; the aggregate check is `approve ∧
   built`.** See "The two forms". The write path's `authorityId` is the approver by
   construction, so re-asking for approval would be re-asserting the caller's own
   premise.

5. **A decline is gated.** See "The decision". §4.3:638's single-valued
   `permitChangedByAuthorityId` is the decisive text; the cost is stated and
   mitigated rather than argued away.

6. **The permit's `roomKey` is the room the grant is HELD UNDER.** D5 does not
   name a room. §4.3:629 places `automationPermitted` inside `ExecutionTier`, and
   T9:1278 says the Paper/Live room displays it, so a grant needs a room for the
   separation check to key on. It is a required argument with no default — a grant
   with no room would have nothing to check, and a default room would be a
   fabricated scope.

7. **`PERMIT_CHANGE_RETENTION_CLASS` uses D8's existing vocabulary.** Creating a
   fourth class would extend D8 from inside T16, which is T15's task.

## AC-035 — how each half is met

### AC-035 (`:1045-1051`)

- **Scenario** — an authority whose `canApprove` includes a room also appears as
  that room's builder: the `auth:build-lead`/`risk` pair in `COLLIDING_BUILDS`.
- **Expected observable result** — "a hard failure naming the authority and the
  room": `assertNoBuildApproveCollisions` throws `COLLISION_CODE` with a message
  containing both, asserted individually.
- **Prohibited side effect** — "may not be a convention or a UI-only warning": the
  detector is called from the permit write path, and a test asserts the record and
  the log are untouched after the refusal.
- **Verification** — "a collision test plus a positive test for a compliant pair":
  both exist, on registries of identical size and room vocabulary, plus an
  exhaustive 48-case matrix and a byte-identical-order test.

## Net effect

The authority record is exactly D12's four fields and refuses a fifth. The
collision detector is a pure function with no imports, evaluated exhaustively over
every authority/room/verb combination, order-independent, and proven so by
reading its own source. AC-035 is enforced by refusing a write.

Every `automationPermitted` change records the approving authority — **in both
directions**, with the reasoning recorded above and the cost of that reading
stated and mitigated by a provenance-gated read. The decision path that consumes
the flag is T11's and was not restated.