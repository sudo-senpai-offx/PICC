# 0028 - T7RB_T7_RECONCILIATION_COPILOT_ROUTE v1 -> v2

The T7 reconciliation. WS-7 task T7R-B: the Copilot decision route that closes the
"no caller of `evaluateCopilot`" gap three tasks recorded, both T7 rooms wired to it,
and both completion verdicts flipped with their resolved blockers deleted.

rule: T7RB_T7_RECONCILIATION_COPILOT_ROUTE
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0028-T7RB_T7_RECONCILIATION_COPILOT_ROUTE-v1-to-v2.md)
date: 2026-10-01
historicalTradesAffected: none
source: >-
  WS-7 T7 acceptance at `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1255-1262`
  and the room-inventory arithmetic at `:73`, `:97`, `:514-530`; D20 (`:268-275`)
  and D27 (`:365-370`); AC-020 (`:365`) and AC-041 (`:1044`); the file-touch
  whitelist at `:73`(d) and the owner's 2026-09-30 room-key ruling recorded in
  entry 0027; T7's own completion records at
  `apps/dashboard/src/terminal/routes/MarketsRoom.tsx:102-104` and
  `apps/dashboard/src/terminal/routes/RiskRoom.tsx:99-102`; plan v1 §4
  (`docs/specs/PICC_TRADING_SUITE_WS7_REMAINING_T7_T21_PLAN_v1.md:474-520`)
  and §3.6 (`:313-397`); the three BS-3 handoff ledgers in entries 0023, 0024
  and 0025; `e2e/terminal-perf.spec.ts:140-161` for the request-attribution
  premise this record changes.

reason: >-
  T7's flags existed because its producers had not run and because two of its
  three risk capabilities did not exist. Both conditions have changed, so the
  record was amended in place rather than re-flagged or superseded: T11 shipped
  the engine and the risk layer (`a4fac35`), T12 shipped the conflict
  resolutions (`8ff9e63`), T13 shipped the model layer (`c8896f4`), T16 shipped
  the authority model (`f1567ef`), and the owner's 2026-09-30 amendment to WS-6
  §0.3 (entry 0027) authorised the `risk` room key, so `routeBlocker` named a
  resolved blocker.

  This record does three things. It DELETES `routeBlocker` and `pendingScope`
  rather than rewording them, because a record naming a resolved blocker as live
  is the unflagged drift AC-020 exists to prevent. It closes the structural gap
  the other tasks could not: `POST /api/trading/copilot`, which makes the engine's
  first real caller, because a room cannot fetch and BS-2 forbade touching
  `apps/dashboard/src/`. And it names, per item, all seventeen BS-3 handoffs from
  entries 0023/0024/0025 — two discharged, fifteen still open — under the rule
  that a producer's existence does not discharge a room's render obligation.

  The absences that survive are named rather than absorbed: the 5% Sentiment
  expert's model artifact, the daily drawdown figure, and the per-key strike
  counter. The two near-matches that exist in the tree for the drawdown rail are
  named as rejected rather than substituted. `historicalTradesAffected` is `none`
  because this is a room-surface and routing change: it moves no historical trade,
  reinterprets no prior reading, and invalidates no recorded decision. The
  route is gated and is not allowlisted.


---

## 1. The gap this task found, and why option "fetch candles in the page" was wrong

`evaluateCopilot` shipped with T11 (`a4fac35`) and had exactly **two** referents in
the repository: its own definition, and test files. Nothing in `handlers.mjs` called
it. Three tasks recorded this and none could close it:

| Task | Where it was recorded | Wording |
|---|---|---|
| T12 | entry 0023, handoff #2 | "Wire `evaluateCopilot({ conflicts })` into a caller… nothing consumes the conflicts until a room or a service asks for them" |
| T13 | entry 0025, handoff #6 | "No caller of the sentiment reader" |
| T11 | entry 0022 | the room renders the engine's absence |

Each obeyed its own boundary: BS-2 forbade touching `apps/dashboard/src/`, and a room
cannot fetch. **The seam they kept pointing at had to live on the server.**

### Why the obvious client fix was rejected

The obvious wiring — have `pages/ministry/MarketsRoom.tsx` fetch
`/api/trading/candles` and call the engine in the browser — was drafted, and then
**reverted**. Three reasons, the first decisive:

1. **A candle series is an INPUT, not the engine's OUTPUT.** Even with candles in
   hand, nothing server-side would be computing anything, so `confluence` would
   still be `null` and Markets would still render an absence. The room would not
   have been completed by that change at all.
2. **`computedAt` is a safety input.** `marketState.mjs:135-139` makes it REQUIRED
   and refuses a missing one, because the engine reads no clock (AC-021). A value
   minted in the browser is the only input on this path no server can audit, and it
   feeds `sessionOpen` — the veto that suppresses entries for 15 minutes after the
   New York open. **A client that chooses `computedAt` chooses whether that veto
   fires.**
3. **It would leave `evaluateCopilot` with two referents still.** A browser caller
   is not "a caller" in the sense those three handoffs meant; the server module
   would remain uncalled and a second copy of the decision path would exist in a
   second runtime to drift.

### What landed instead

**One server route.** `POST /api/trading/copilot` →
`server/services/copilot/decision.mjs` → `marketDataBus` fetches its own
working-timeframe, 4H and daily series → `deriveMarketState` → `evaluateCopilot`
(so T12's C1/C2/C3 participate) → returns the score, contributions, vetoes, tier,
conflicts and the risk observations in **one** authenticated round trip.

**One client request.** The page asks for the *decision*. It never sends candles,
never sends a timestamp, and never computes. `src/terminal/adapters/copilotReading.ts`
is a pure projection with no arithmetic in it.

---

## 2. Files

### Added

- `apps/dashboard/server/services/copilot/decision.mjs` — the caller. Fetches, derives, evaluates, returns. Computes nothing itself.
- `apps/dashboard/server/services/copilot/decision.d.mts` — the typed surface for the client tests that drive it.
- `apps/dashboard/server/services/copilot/__tests__/decision.test.mjs` — 12 tests, the engine driven with only the broker injected.
- `apps/dashboard/server/__tests__/copilotDecisionRoute.test.mjs` — 11 tests at the HTTP boundary: 7 on the gate, 4 on the authenticated success path.
- `apps/dashboard/src/pages/ministry/RiskRoom.tsx` — the Risk page composition (see §5).

### Removed — two files that an earlier draft made necessary

An earlier draft of this task imported `services/copilot/engine.mjs` **into the
browser** and therefore needed co-located `.d.mts` declarations for the engine and the
risk layer to typecheck at the client call sites. §1 explains why that draft was
reverted. With the client-side import gone, both declarations were **unreferenced**,
so they were deleted rather than committed as dead files:

- `apps/dashboard/server/services/copilot/engine.d.mts`
- `apps/dashboard/server/services/copilot/riskLayer.d.mts`

`decision.d.mts` **is** retained: the client test genuinely imports
`decision.mjs`, and without a declaration that call site would be `any`.

### Edited

- `apps/dashboard/server/handlers.mjs` — the `/api/trading/copilot` block. **+38 lines**, one dynamic `import()`. This file is outside the `:73`(d) whitelist; see §8.
- `apps/dashboard/src/terminal/adapters/copilotReading.ts` — rewritten. The previous draft imported the server engine **into the browser**; that is reverted, for the three reasons in §1.
- `apps/dashboard/src/pages/ministry/MarketsRoom.tsx` — fetches the decision; passes real props.
- `apps/dashboard/src/pages/ministry/MinistryRoom.tsx` — `risk` re-pointed from `@/terminal/routes/RiskRoom` to the new page composition.
- `apps/dashboard/src/terminal/routes/MarketsRoom.tsx` — verdict flipped, false "T11 is not built" claims removed.
- `apps/dashboard/src/terminal/routes/RiskRoom.tsx` — `routeBlocker` and `pendingScope` **deleted**, verdict flipped.
- `apps/dashboard/src/terminal/domain/copilotDecision.ts` — `COPILOT_ENGINE_OWNER` no longer names a completed task.
- `apps/dashboard/src/terminal/domain/riskLayer.ts` — `RISK_LAYER_OWNER` likewise; every "DOES NOT EXIST" claim corrected.
- `apps/dashboard/src/terminal/contracts.ts` — two stale comments corrected (§6).
- `apps/dashboard/src/terminal/routes/__tests__/MarketsRoom.test.tsx`, `__tests__/RiskRoom.test.tsx`, `adapters/__tests__/copilotReading.test.ts` — rewritten against the real engine.
- `apps/dashboard/e2e/terminal-perf.spec.ts` — `MARKETS_PANELS` gains one entry (§7).
- `apps/dashboard/server/__tests__/ws7AuthBootstrapGateGuard.test.mjs` — **two pinned figures moved**, with the accounting the pin's own comment requires. See §8.
- `PICC.md:556` — the WS-7 registry row said "T5 in progress"; it had been false since `4078812`.

### Deleted

Nothing. No file was removed, renamed, or emptied to make a count fall.

---

## 3. The new route

**Path:** `POST /api/trading/copilot`
**Body:** `{ assetId }` — and nothing else. A test asserts `Object.keys(body).length === 1`.
**Auth:** `requireAuth(req, res)` as the first statement of the route's own block, before the `assetId` precondition and before any service import.

**GATED, NOT ALLOWLISTED.** No declared-public entry. No `owner: "decision"` entry.
The 86 unruled decision entries awaiting the owner are not a pool this route draws
from. Three guards cover it, and all three are asserted rather than assumed:

- `ws7RouteAuthCoverageGuard.test.mjs` discovers the route and finds a real gate in its own region.
- `ws7AuthBootstrapGateGuard.test.mjs` passes unmodified on the route shape.
- `copilotDecisionRoute.test.mjs` asserts the 401 behaviour at the boundary, because a **static scan can be satisfied by a gate that never runs.**

### What is disclosed, and to whom

Live engine state: regime, score, per-expert contributions with each unavailable
expert's reason, six versioned vetoes with their unevaluated reasons, the tier, and
T12's three conflict resolutions with their precedence record. None of it is
declared-public.

### One inherited property, pinned rather than assumed

`requireAuth` takes its **first-run bootstrap branch** when the user store is empty
(`firstRunBootstrapAllowed`). All ~97 gate sites share this; the route is not
special-cased and neither tightens nor loosens it. The consequence — a fresh install
with **no accounts** exposes live engine state — is asserted explicitly in
`copilotDecisionRoute.test.mjs`, with the same request asserted 401 the moment one
account exists. The honest place to change this is the shared gate; the honest place
to notice it is a test that says so out loud.

### What the route does NOT send, and does NOT do

- **No `credentials: "include"`.** The URL is relative, so the request is
  same-origin and the default `credentials: "same-origin"` already sends the cookie.
  `"include"` would change nothing here while being the option that forwards
  cookies to a third-party origin. `ws6SafetySeamGuard.test.mjs:136-138` pins this
  (`/fetch\([^)]*credential/i`); **the guard is right for that reason, so the fix was
  made in the adapter and not in the guard.**
- **No broker permit.** `automationPermitted: false`, `rung: "paper"` — AC-024
  (an absent flag must never mean permitted) and AC-025 (lowest rung).
- **No clock.** `computedAt` is the **newest bar's own timestamp**, never `Date.now()`.
  A test asserts the route returns the bar's 2023 time, which is what makes a replay
  reproducible and what keeps `sessionOpen` out of a caller's hands.

---

## 4. Verdicts, before and after

| Record | Field | Before (T7, `857443e`) | After (T7R-B) |
|---|---|---|---|
| `MARKETS_COMPLETION` | `verdict` | `"surface-complete, producer-pending"` | `"complete"` |
| | `pendingScope` | `"WS-7 T11 - the deterministic engine"` | **deleted** |
| | `routeBlocker` | absent | absent |
| | `ws8Handoff` | `null` | `null` (unchanged, re-stated against the built engine) |
| `MARKETS_NO_READING_REASON` | — | named `WS-7 T11` as a **pending task** | names the built engine and the adapter |
| `RISK_COMPLETION` | `verdict` | `"surface-complete, producer-pending, route-unmounted"` | `"complete"` |
| | `pendingScope` | `"WS-7 T11 - the risk layer (2% daily drawdown disable, 3-strike 24h key lock)"` | **deleted** |
| | `routeBlocker` | named the two frozen assertions | **deleted** |
| | `ws8Handoff` | `null` | `null` |
| `COPILOT_ENGINE_OWNER` | value | `"WS-7 T11"` | `"WS-7 market-state supply"` |
| `RISK_LAYER_OWNER` | value | `"WS-7 T11"` | `"WS-7 risk-observation supply"` |

`routeBlocker` was **deleted, not reworded**. It named the two frozen
characterisation tests as the obstacle; they stopped being the obstacle at T7R-A. A
record that names a resolved blocker as live is the unflagged drift AC-020 exists to
prevent.

### What "complete" means here, and what it does not

**It means** T7's acceptance line at spec `:1260` is met: Markets surfaces the score,
per-expert contributions and fired vetoes; Risk surfaces ATR, the 2% daily drawdown
disable and the 3-strike state **with honest unavailability**; both rooms are mounted
at URLs; no scope in either room logically belongs to WS-8.

**It does not mean everything is live.** Three absences survive, each named, none
absorbed:

1. **The 5% Sentiment expert.** T13's model artifact; renders as an unavailable expert carrying the engine's own reason.
2. **The 2% daily drawdown figure.** Nothing in the tree tracks a daily drawdown on the decision path. `v32Copilot`'s −2% *session* halt and `u4faRisk`'s −5% *daily* limit are **not** substituted, and the reason string names both as rejected.
3. **The per-key strike counter.** A read-only asset decision has no key, so `strikes: 0` would assert a counter nobody read.

A live ATR beside two named unavailable rails must not read as "the whole risk layer
is live". That separation is the feature.

---

## 5. Both rooms, wired

### Markets — `pages/ministry/MarketsRoom.tsx`

Fetches `POST /api/trading/copilot` on mount and on asset change; passes
`confluence`, `vetoes`, `automationPermitted`, `rung`. Before the response lands, and
if it never does, the surface renders its honest unavailable state. A pending request
is not a score of zero.

### Risk — `pages/ministry/RiskRoom.tsx` (new)

`MinistryRoom` renders `<Room />` with **no props**, and the terminal Risk room is
presentational by design. Routing `risk` straight at it mounted a room that rendered
three unavailable rows forever. The new page module is the missing caller; the
terminal room stays prop-only and testable.

It reuses the **same** request. A second endpoint for ATR alone would re-fetch the
same bars and give the two rooms two different views of one market. The Risk room's
ATR and the Markets room's ATR are the same number from the same bars at the same
`computedAt`, and this is what keeps that true.

### The measured cost, and `MARKETS_PANELS` before/after

| | Before | After |
|---|---|---|
| Entries | 7 | 8 |
| Added | — | `{ panel: "CopilotDecision", endpoints: ["/api/trading/copilot"] }` |

One additional request inside the measured window. **Three** broker fetches would
have been added had the client supplied candles; they are inside the one server call
instead.

The list's own stated premise (`terminal-perf.spec.ts:150-151`) is that it tracks what
the room **actually** fetches — `PackRegistryStrip` is in it precisely because it
fetches on mount. Omitting the endpoint would put the request in the aggregate while
attributing it to no panel, which is the defect the harness exists to prevent. D21
already superseded the 250 ms x86 tier with a ~1800 ms p95 ARM re-baseline and
records B1 as a KNOWN BREACH, so no ratified number is disturbed; T19 re-measures the
whole room set regardless.

**Not verified:** no e2e run was performed, so the added request's effect on the
measured transition is **not** measured here. T19 owns that number.

---

## 6. Stale records corrected, and one the plan scoped out

Every one of these was a claim that had stopped being true:

- `copilotDecision.ts:21-27` — "the risk layer — is WS-7 T11, **and it is not built**."
- `riskLayer.ts` — three capabilities described as "DOES NOT EXIST" / "NOT IMPLEMENTED".
- `contracts.ts:137` — "`ConfluenceScore` is WS-7 T11 and **is not built yet**."
- `contracts.ts:220-223` — "The 2% daily drawdown disable and the 3-strike 24h key lock **DO NOT exist anywhere in the tree**."
- `routes/MarketsRoom.tsx:16-27` — "a P0 task in the same workstream **that has not run**."
- `pages/ministry/MarketsRoom.tsx` — "WS-7 T11 **and has not been built**."

The `NOT IMPLEMENTED` string on the Risk drawdown row is gone. What replaced it is
the part that was never at risk: the **refusal**. A caller holding only a session
figure is still told the daily rail cannot be evaluated, and both near-matches are
still named as rejected.

---

## 7. The BS-3 handoff ledger — all 17 items, per item

**THE RULE, STATED AS THE OWNER STATED IT.**

> Discharge an item only if **this diff actually lands what it asked for**. A
> nearby server-side capability does **not** discharge a room's *render* obligation.
> Everything else is recorded still-open, naming the exact remaining work and the
> file that will own it.

Two of seventeen are discharged. **Fifteen are still open**, and the reason is the
same in every case: T7R-B built the *producer* path and did not build the *render*.
Marking a render discharged because its producer now exists is precisely the
inference this rule forbids — and it is the inference this whole task existed to
stop three earlier tasks from making.

### Entry 0023 — T12, conflict resolutions (3 items)

| # | Handoff | Disposition | Remaining work / owner |
|---|---|---|---|
| 0023-1 | Risk room surface for C2's two-tier stop | **STILL OPEN** | Two visually distinct states from `evaluateC2(...).stop`: `softAlertFired` (amber) and `hardStopFired` (red). Owner: `src/terminal/routes/RiskRoom.tsx`. T7R-B did **not** render C2's tiers. |
| 0023-2 | Wire `evaluateCopilot({ conflicts })` into a caller | **DISCHARGED** | `decision.mjs` passes `conflicts: {}`, so all three rules are evaluated and `notEvaluated` is absent. Pinned by `decision.test.mjs` ("asks for the conflicts, so C1/C2/C3 are evaluated rather than skipped") and by the route test asserting `["C1","C2","C3"]`. |
| 0023-3 | C1's window tracker needs a candle-index source | **STILL OPEN** | `windowCandles` / `candlesRemaining` are computed but no caller feeds a trigger-bar window. Owner: `src/terminal/routes/RiskRoom.tsx` render + the window's supplying service. T7R-B's route evaluates C1 with `window: null`, which is honest (a missing window is not an open one) and is NOT a discharge. |

Sub-items 1–7 of entry 0023's "exactly what the Risk room must do later" enumeration (stop geometry, trigger naming, C1 window surfacing, C3 weight reallocation, precedence visibility) are all part of 0023-1 / 0023-3 and are **still open** on the same terms.

### Entry 0024 — T16, authority & separation of duties (4 items)

| # | Handoff | Disposition | Remaining work / owner |
|---|---|---|---|
| 0024-1 | The Ministry room's render | **STILL OPEN** | All six enumerated obligations: the authority set, `describeRoomSeparation`, both collision offenders, the approving authority of a permit grant, refusals rendered as refusals, `scope` on every approval. Owner: `src/pages/ministry/reservedRooms.tsx` → a real `MinistryAuthorityRoom`. T7R-A gave it a **key**; T7R-B did not give it a **render**. A key without a body is a named absence, which is what it is. |
| 0024-2 | The Ministry room's route key | **DISCHARGED** | `ministry` is in `INNER_NAV` and `TRADING_ROOMS` under T7R-A's 2026-09-30 amendment; the trading list is 13 keys and the cross-suite total is 22. Pinned by `ministryRooms.test.tsx` and the parity guard. |
| 0024-3 | The build registry has no producer | **STILL OPEN** | No room is attributed to a named authority, so nothing emits `construct`/`deploy`/`promote`. Owner: the room-attribution step in T8's Ministry room. An empty registry has no collisions, which is honest and is not evidence. |
| 0024-4 | No caller of the permit store | **PARTIALLY OPEN — and the change makes it worse on purpose** | `decision.mjs` now supplies `automationPermitted: false` explicitly rather than leaving the field absent. That is the **fail-closed** direction and it is not a permit. The store is still unwired: nothing supplies a real broker permit. Owner: T9's Paper/Live room, per `:1278`. |

### Entry 0025 — T13, model layer & routing (7 items)

| # | Handoff | Disposition | Remaining work / owner |
|---|---|---|---|
| 0025-1 | Render the explanation in a room | **STILL OPEN** | `explainDecision` / `explainUnavailable` ship with no consumer. Owner: a room render. Note `decision.mjs` does **not** call the explain layer — the route returns the decision, not prose, and the room would have to bind `explanation.at` → `generatedAt`. |
| 0025-2 | The `at` / `generatedAt` rename | **STILL OPEN** | No renderer binds it, so the rename is still owed at the render boundary. Owner: whichever room renders an explanation. |
| 0025-3 | `exactScore` is not in the contract | **STILL OPEN** | Unchanged and still true: the contract has 7 fields, the module returns 8. No renderer exists to be misled. Owner: the explanation render. |
| 0025-4 | `isAdmissibleAsSignal` does not exist | **STILL OPEN** | Named in `contracts.ts` prose, implemented nowhere. `decision.mjs` does not invent it — the server's `routing.mjs` equivalent is `assertNotDeterministicInput`. Owner: a `src/` addition; inventing it from a comment would be a second definition of a boundary. |
| 0025-5 | No cloud transport exists | **STILL OPEN** | `routing.mjs` is a predicate. The four D16 obligations (call `routeFor` first, mark `provenance: "copilot: remote"`, redact, budget) remain unimplemented. Owner: whoever builds the Groq/OpenRouter client. **Deliberately untouched by T7R-B**: adding a network client would have made the boundary whatever that client allowed. |
| 0025-6 | No caller of the sentiment reader | **STILL OPEN, and now MORE visible** | `decision.mjs` omits `sentimentInput` entirely, so the 5% expert reports unavailable **with the engine's own reason** on every reading. That is better visibility, not a discharge: `createSentimentReader` still has no caller. Owner: T18, which owns the digest's sources under D17. |
| 0025-7 | The real inference backend is unwritten | **STILL OPEN** | Needs a platform with a Needle runtime and the GitHub release assets for the `llamaCpp` row. Cannot be closed here. Owner: an ARM-capable environment. |

### Two things T7R-B did that the ledger did not ask for

Recorded so they are not mistaken for discharges of something else:

- **A route was added to `handlers.mjs`**, which is outside the `:73`(d) whitelist. The owner directed this; see §8.
- **`MARKETS_PANELS` gained an entry**, which is a change to a measurement harness. The owner directed it; see §5.

---

## 8. Guard figures moved, and the whitelist deviation

### Two pinned figures moved

`ws7AuthBootstrapGateGuard.test.mjs` pins the module shape of `handlers.mjs` on a
comment-stripped view, precisely so a number written only in prose cannot rot.

| Figure | Before | After | Why |
|---|---|---|---|
| lines | 6,088 | **6,126** | +38: the `/api/trading/copilot` block |
| dynamic `import()` | 80 | **81** | one `await import("./services/copilot/decision.mjs")` |
| static `import` | 72 | **72** | unchanged — the service is reached dynamically, so the Copilot stays off the boot path |

The pin's own comment states the protocol: the figure is **moved to the new true
value**, never loosened, and each movement is accounted for in prose at the pin. Both
moved together, which is the point of pinning both — a route added with a *static*
import would move the other number, and the pair is what distinguishes "grew" from
"structure changed".

### The whitelist deviation — stated, not absorbed

WS-7 spec `:73`(d) admits `apps/dashboard/server/services/**` and
`apps/dashboard/src/**`. It does **not** admit `apps/dashboard/server/handlers.mjs`,
which is where every route lives. Adding a route therefore exceeds the task's file
list.

**The owner directed it**, on the reasoning that the missing route — not the panel
list — was the thing blocking completeness, and that three tasks had already recorded
the gap. The deviation is recorded here rather than absorbed, because the alternative
is a route that exists without a record of why it was out of scope.

What this entry does **not** do is amend the spec. `:73`(d) is unchanged, and a
follow-up spec amendment naming `handlers.mjs` as in-scope for Copilot work is the
correct home for this.

### A pre-existing stale figure, left alone

`authBootstrapGateFailsClosed.test.mjs:271` says "with 73 static and 84 dynamic
imports". That was **already stale** before this task — the pins have read 72 and 80
since T2. It is prose in a comment, not an assertion, so it fails nothing. Correcting
it is outside this diff's scope and is noted here rather than fixed quietly.

### A guard that only bites AFTER the commit — and what it caught

`ws7TestStoreIsolation.test.mjs` scans **`git ls-files`**, which is why it is not
evidence until the work is committed. The post-commit run of this task is what first
saw `copilotDecisionRoute.test.mjs`, and it **failed**: the file assigned
`PICC_TRADING_DATA_DIR` / `PICC_DATA_DIR` / `PICC_AUTH_DATA_DIR` by hand.

That is the guard working, and the prescribed repair is not an inventory addition —
the inventory is a legacy list whose own test says it "cannot grow". The prescribed
repair is to redirect through `useIsolatedStoreDir()` from
`testSupport/storeIsolation.mjs`, which mints the directory, canonicalises it, asserts
it is **not** the real `server/data`, and **throws** on a variable name the contract
does not know — so a misspelling through the helper fails loudly instead of silently
redirecting nothing.

The file now uses the helper. Nothing in the guard was weakened, and no inventory
entry was added.

**Worth recording as a property of this workstream:** two of the three failures in
this task's history were invisible pre-commit, and both were guards doing their job
(the `ws6SafetySeamGuard` `credentials` catch was visible; this one was not). A
pre-commit suite run on an untracked new file is not the same evidence as a
post-commit one, and this entry now says which is which.

---

## 9. Tests

| Suite | Count | What it proves |
|---|---|---|
| `server/services/copilot/__tests__/decision.test.mjs` | 12 | The engine runs and returns a score, six contributions and fired vetoes; `computedAt` is the bar's own time; byte-reproducible; conflicts asked for; fails closed on the broker flag; real ATR; two rails honestly null; absence below the engine's floor; one broker call per leg; sentiment/news/proposals never supplied |
| `server/__tests__/copilotDecisionRoute.test.mjs` | 11 | 401 anonymous on POST/GET/PUT/DELETE/PATCH; the gate precedes the `assetId` precondition; 401 ≠ 404 so the route provably exists; the first-run bootstrap pinned; authenticated callers get a **real score**; `computedAt` is the bar's; no history is a 200-with-absence, not a 502 |
| `src/terminal/adapters/__tests__/copilotReading.test.ts` | 12 | The projection carries a real engine result; unavailable reasons survive; refuses to invent the two rails; 401/502/throw/non-JSON are named absences; **dead zone ≠ not evaluated**; a malformed score is an absence, never a 0; fail-closed on `automationPermitted` and unknown rungs; sends `assetId` and nothing else |
| `src/terminal/routes/__tests__/MarketsRoom.test.tsx` | 34 | The room renders the engine's own score, all six contributions and every fired veto, each naming what it suppressed — **from a real `decision.mjs` run, not a fixture** |

### Two tests that changed meaning, and why

- **`RiskRoom.test.tsx`'s route-blocker assertion was INVERTED**, as plan §4:502 requires. It previously asserted `routeBlocker` contains `ministryRooms.test.tsx`; it now asserts the field is **absent** and that the record names the amendment (`0027`) instead.
- **The dead-zone test now distinguishes two absences that look alike.** `confluence: null` (the engine was not evaluated) and `confluence.score: null` (the engine ran and found the dead zone) are **not the same**. `contracts.ts:191-194` is explicit that `null` is not `0` and that `deadZone` is a regime, not a score. Collapsing them would throw away the regime label and the contributions and render "no decision" for a decision that was reached and correctly declined to score.

### Verification

- `npm run typecheck` — green.
- `npm test` — **4,744 passed / 1 skipped / 0 failed** (floor: 4,602), run **twice pre-commit and once post-commit**.
- The **post-commit** run is the load-bearing one: `ws7TestStoreIsolation.test.mjs` reads `git ls-files`, so it cannot see an untracked file. See §8.
- `ws6SafetySeamGuard.test.mjs` — 17 passed, **unmodified**.
- `ws7RouteAuthCoverageGuard.test.mjs` + `ws7AuthBootstrapGateGuard.test.mjs` — 76 passed.
- `ws7RegulatoryClaimGuard.test.mjs` — 29 passed.
- `ws7EncodingIntegrityGuard.test.mjs` — 18 passed.
- `ws7TestStoreIsolation.test.mjs` — passes **after** the helper migration in §8.
- `git diff --check` — clean.
- Nothing under `server/data/`, `.playwright-tmp/`, or any lockfile.
- No e2e run. No push.

---

## 10. What I could not verify

Stated plainly, because an unverified claim in a changelog is the thing this
workstream most often gets wrong:

1. **No e2e run.** The added request's effect on the measured Markets transition is **not measured**. T19 owns that number.
2. **No live broker was exercised.** Every test injects `marketDataBus`. Nothing here asserts that any real source serves any real asset.
3. **The engine has still never seen a live candle series through this route in a running process.** The route is proven against a deterministic injected series; that is the strongest claim available without credentials and a network.
4. **The first-run bootstrap exposure is inherited, not measured in production.** It is asserted at the unit level and flagged, not characterised.
5. **Two-thirds of the Risk room renders as absences in the mounted page.** That is correct and is not a defect, but it means "the Risk room is complete" is a statement about the *room*, not about three live rails.

## 11. Spec self-contradictions found, and NOT edited

1. **WS-7 spec `:73` still says "18 room keys"** while WS-6 §0.3 now says 22/15. T7R-A's amendment was scoped by the plan to the two WS-6 statements, so the WS-7 spec was left alone. **The workstream now contradicts itself across two files.** The fix is a dated WS-7 amendment pointing at entry 0027 — not an edit made silently inside a room task.
2. **Plan §3.6 and §5.1 disagree about T10's remainder** — 12 instances in one place, 16 in the other (§3.6 says "falls from 14 to 12"; §5.1's resolution note says "T10's remaining read-only rooms is 16, not 12"). Both cannot be right. **Unresolved and unedited**: it is the owner's arithmetic, and picking one silently would be the quiet invention D10 exists to prevent.
3. **Plan §5's table still lists Risk as "Producer exists? partial — ATR real, 2 of 3 missing"** and Ministry as "no". Both were true at `857443e` and are now stale, but the plan is a planning document and this entry records the delta rather than rewriting it.
