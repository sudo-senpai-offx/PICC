# 0036 - T14_NOTIFICATIONS_TELEGRAM_WEBPUSH v1 -> v2

Execution record for WS-7 task T14: both D11 notification transports, and the
delivery state machine that makes a delivery failure explicit rather than silent.

rule: T14_NOTIFICATIONS_TELEGRAM_WEBPUSH
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0036-T14_NOTIFICATIONS_TELEGRAM_WEBPUSH-v1-to-v2.md)
date: 2026-10-02
historicalTradesAffected: none
reason: >-
  D11 requires BOTH a Telegram bot and WebPush, configured in the general Settings
  room and not in a ministry-specific surface, with delivery failures explicit.
  Measuring the tree first showed the scope was not what the task line implies:
  WebPush already existed and worked, Telegram did not exist at all, and the
  substantive defect was in neither - it was that a working WebPush reported its
  OUTAGES as a missing setting. `sendWebPush` caught every per-subscription error,
  kept only 404/410 to prune dead subscriptions, discarded the rest, and returned
  a boolean; a push service answering 500 to every send therefore produced the same
  record as "no VAPID keys", which the room rendered as "not configured - nothing
  will be sent". An outage was displayed as an absent setting, which is the
  opposite of D11's "failures are explicit, not silent" and fails AC-037's "the
  failure is explicit".

  So the state machine is the work and the transport is the smaller half. A
  transport now reports acknowledgement COUNTS and `classifyDelivery` takes no
  boolean, so a transport that claims success while acknowledging nothing computes
  to `failed` - "never fabricate a delivery" is made unrepresentable rather than
  merely discouraged, and `unavailable` (nothing to send with) becomes a state
  distinct from `failed` (tried, nothing arrived), which is the pair D11 turns on.
  Telegram is added on its own env pair, its own preference key and its own module,
  and reports the NAMES of missing settings rather than their values, so no secret
  can reach a client-side field.

  `historicalTradesAffected: none` is a claim, not a formality: the notifier
  computes no tier, no threshold, no veto and no permit, and T14 changed only how a
  delivery is REPORTED. No signal, score, tier or order-affecting value is read or
  written on this path, which is also why the transports can be shown to be
  independent of the trading path - the notifier holds no static import of any
  broker, order, venue, execution or copilot module.
source: >-
  WS-7 task T14 at
  `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1318-1325`,
  acceptance criterion **AC-037** (`:1061-1067`), decision **D11** (`:184-191`),
  the honesty contract at **`:79`** and the file-touch union at **`:73`** (which
  admits `apps/dashboard/server/handlers.mjs`), plus T10's read-only room records
  in entry `0032`
  (`docs/trading-logic/changelog/entries/0032-T10_REMAINING_READ_ONLY_ROOMS-v1-to-v2.md`),
  T8's pre-existing-affordance precedent in the same table, and T21's seam-guard
  discipline in entry `0035`
  (`docs/trading-logic/changelog/entries/0035-T21_FINAL_WS7_SEAM_GUARD-v1-to-v2.md`).

> **Citation correction, recorded because it changed what this task did.** The task
> brief for T14 cited the binding decision as "D18 at `:185-191`". The decision at
> `:185-191` is **D11**; D18 is at `:247` and is "Full test floor at every commit".
> The line numbers were right and the label was wrong. D11 is what `:1323` and
> AC-037:1061 both name, so D11 is what this entry implements. Nothing in the repo
> changes as a result — this is a note so the next reader does not go looking for
> a push-notification decision under the number 18.

- **Task:** WS-7 T14 — notifications (AC-037, spec `:1318-1325`)
- **Branch state at close:** landed locally; **no push performed**
- **Registry status:** `ACTIVE-DRAFT` — unchanged
- **Verdict:** both transports delivered through a four-state machine that
  distinguishes unconfigured from failed, with failures reported rather than
  swallowed.

---

## 1. What T14 found: one transport existed, and the other failure was invisible

T14's scope reads as "build two transports". The measurement said otherwise, and
the difference is the whole task:

- **WebPush already existed and worked.** `sendWebPush` (`notifier.mjs`) drove
  `web-push` against every stored subscription. So half of D11 was already shipped.
- **Telegram did not exist at all.** No transport, no env pair, no preference key.
- **The more serious finding was not the missing transport — it was that a
  *working* transport reported its outages as a *missing setting*.**

`sendWebPush` returned a bare boolean, and it returned `false` for three different
situations:

| Situation | Old result | Old room rendering |
|---|---|---|
| No `VAPID_*` keys | `false` → `skipped` | "not configured (no VAPID keys)" |
| Keys set, no subscriber | `false` → `skipped` | "not configured (no VAPID keys)" |
| **Keys set, subscribed, push service returns 500 to every send** | `false` → `skipped` | **"not configured (no VAPID keys)"** |

The third row is a total push outage displayed to the operator as an absent
setting. The cause was that the per-subscription `catch` at `notifier.mjs:154-156`
kept only 404/410 (to prune dead subscriptions) and **discarded every other
error**, after which `delivered > 0` was `false` and the dispatcher recorded
`skipped` — the same word used for an unconfigured transport.

D11's consequence clause is "**Delivery failures are explicit, not silent**"
(`:191`) and AC-037's is "the failure is explicit" (`:1064`). A room that reports
an outage as a missing key satisfies neither. So the substantive work of T14 is
the **state machine**, not the new transport; the transport is the smaller half.

## 2. The state machine — why it is a module and not a bigger `if`

`services/notifications/states.mjs` is pure, has no I/O, and holds four states:

| State | Means | Attempted | Reason |
|---|---|---|---|
| `off` | the operator turned it off | 0 | none needed |
| `unavailable` | nothing to send **with** — no key, or no recipient | 0 | **required** |
| `failed` | something **was** attempted and not acknowledged | ≥1 | **required** |
| `delivered` | ≥1 recipient acknowledged | ≥1 | none |

`unavailable` and `failed` are the pair D11 turns on, and they are the two the old
vocabulary merged.

**The anti-fabrication mechanism.** A transport reports acknowledgement COUNTS.
It does not report a boolean, and `classifyDelivery` accepts no `success`/`ok`/
`sent`/`claimed` parameter at all. A transport that "reports success" while
acknowledging zero recipients therefore *computes* to `failed` — the wrong thing
is unrepresentable rather than merely discouraged.
`notifications.states.test.mjs` proves it by handing `classifyDelivery` every
plausible lie at once and asserting the result is not `delivered`.

`summariseDeliveries` reduces a record to four buckets plus `deliveredAny`, and
`describeSummary` is the only sentence a room may show. `readoutObtained` is kept
separate from the buckets, per T10: "ran and found nothing" is not "could not be
reached".

**A real bug this caught, in my own new code.** `describeSummary` first returned
early on the success branch, so it printed `Delivered on inApp (1 acknowledged).`
and said nothing about the refused Telegram beside it. Because the in-app bell
succeeds on essentially every dispatch, that would have hidden a broken transport
*almost every time* — reintroducing the silent failure one layer up. The
non-delivery facts are now appended on every branch, and
`notifications.states.test.mjs` pins it.

## 3. Telegram

`services/notifications/telegram.mjs`. Env pair `TELEGRAM_BOT_TOKEN` +
`TELEGRAM_CHAT_ID`; both required. Reads only `process.env`, returns only an
outcome. **`telegramConfigStatus()` names the MISSING keys and never their
values**, so the reason is safe to persist in a record and safe to serialise to
the client — D11's "neither transport may carry a secret in a client-side field"
(`:187`) is met structurally, and
`notifications.transports.test.mjs` asserts the JSON of `notifierStatus()` does
not contain the token.

Three failure modes are separately reported, and a `200` whose body is
`{ok:false}` is **not** counted as a delivery.

**A real bug this caught, also in my own new code.** I first read the response as
`res.body.json()`. A WHATWG `Response` has `.json()` directly, so the transport
recorded a bare `http 401` with Telegram's `description` discarded, and treated
*every* 200 as unacknowledged. The test double had been written to match my
mistake. Fixed on both sides, and the reason the fix is safe is the `typeof`
guard: an unparseable body now degrades to a named failure instead of throwing
past the outcome.

## 4. The bisect line — three directions, and the third is the one that bites

Spec `:1325`: "Either transport can be disabled without affecting the other or
the trading path." One direction proves little, so all three are asserted in
`notifications.transports.test.mjs`:

1. **Telegram off** ⇒ WebPush still `delivered` with a positive acknowledgement,
   Telegram `off`, and Telegram is never even attempted.
2. **WebPush off** ⇒ Telegram still `delivered`; also asserted with WebPush
   *broken* rather than merely off, so independence holds under fault and not
   only under a clean toggle.
3. **Both off** ⇒ the in-app advisory alert still fires, the record is still
   produced and persisted. This is the direction a one-direction test would miss:
   had a shared registry entry been made to gate on "some transport is on", this
   is the assertion that catches it.

Plus a fourth, under fault: **one transport throwing** is recorded against itself
and the loop continues.

"The trading path" is asserted two ways. Behaviourally: the dispatch still
completes and the in-app alert still fires with every push transport off.
Structurally: the notifier holds **no static import** of any broker, order,
venue, execution or copilot module, measured from the source, so a notification
failure has no import edge along which to reach order handling. That is a fact
about the module graph rather than a hope about the code.

## 5. Where the configuration renders — reuse, and what "lives in" was taken to mean

**The route surface is reused, entirely. T14 adds no route and no gate.** The
`requireAuth(req, res)` call-site count in `handlers.mjs` is **126 before and 126
after** — which is how "this task added a transport, not a surface" is measured.

The brief asked me to check first whether a settings route already existed. It
did, and it was already the notification configuration surface:
`SignalNotificationsCard` (`components/TradingSuite.tsx`) reads
`/notifications/status`, writes `/notifications/prefs`, spends `/notifications/test`
and drives `subscribe-push`/`unsubscribe-push` through the shared `useWebPush`
hook. T14 **mounted that existing component in `SettingsRoom.tsx`** rather than
authoring a new form, because a new form over the same routes is a second route
over one store, "which gives that store two answers taken at two moments, a defect
T8 declined to create" — the ceremony-store reasoning at
`readOnlyRoomCompletions.ts:132-133`.

**The `settings` key is three instances of one component** (`trading/settings`,
`earnings/settings`, `intelligence/settings`), and the notifications section is
inside that one body. So D11's "not ministry-specific" is satisfied: the room
carries it regardless of suite, and nothing about it is keyed to a ministry.

**One judgement recorded rather than buried.** D11 says configuration "lives in"
the general Settings room. It does not say "only there", and T8 had already
declared `SignalNotificationsCard` a *pre-existing* affordance on
`trading/dashboard` and `trading/autopilot` and explicitly did **not** remove it,
because "removing shipped product functionality is a product decision, and D27
prohibits a task taking one silently". So T14 makes the configuration reachable in
the room D11 names and leaves the two pre-existing surfaces alone. Deleting them
would have been a product decision taken silently; that reading is recorded here
so a later reader can overrule it deliberately.

## 6. The affordance ceiling — unchanged, and why that is the honest answer

The brief anticipated a ceiling change. **There is none, and the reasoning is
worth more than the change would have been.**

The two figures measure different things:

- **`preExistingWriteAffordances`** is what the shipped page already carried. The
  card and its four routes are WS-3-era code; T14 *mounted* an existing control,
  it did not author one.
- **The ceiling** measures affordances WS-7 *added* to a read-only room. Its own
  rationale is specific: these rooms "compute no tier, no threshold, no gate and
  no permit, so there is nothing here whose result a control could change"
  (`readOnlyRooms.ts:216-219`), and it explicitly sanctions the pattern T14 uses —
  "every real action behind this surface belongs to a producer that already has
  its own auth-gated route and its own owner" (`:220-222`). Every route behind
  the notifications section is `requireAuth`-gated as its first statement.

A notification toggle changes neither a tier, a threshold, a gate nor a permit. It
changes whether an **advisory** alert is delivered. So the ceiling for all three
settings instances stays `READ_ONLY_INTERACTIVE_AFFORDANCES` — exported frozen
empty data, **unmoved and unweakened** — and the four controls are *named* in the
affordance list with their routes, which is what
`safety.affordance-declares-a-route-and-a-token` actually checks.

Inflating the ceiling to accommodate a control would have been the anti-goal.
Hiding the control to keep the ceiling at zero would have been a lie in the other
direction. The record is now true in both directions at once.

The before/after per instance: `trading/settings` 2 → 6 affordances,
`earnings/settings` 2 → 6, `intelligence/settings` **0 → 4**. That last one is the
sharpest in the table, because that instance's own recorded absences are about
refusing to render a settings object it did not receive. All six stay far under
the best-effort `UX_MAX_AFFORDANCES: 8`, which is a best-effort observation and
does not block.

## 7. What else changed, and what it cost

- **The room stopped fabricating a delivery.** "Send test" said
  *"Test dispatched — check bell/push."* the instant the POST resolved — true of
  the HTTP call, silent about whether anything arrived. It now renders the
  server's per-transport outcome: a one-line verdict plus a per-transport table of
  state and reason.
- **`readoutObtained` in the room.** A failed status fetch used to leave
  `status === null`, which rendered the same `Loading…` spinner as a slow
  request. It now says the configuration could not be read and that nothing below
  is known.
- **The push subscription count became a list.** `{n} server-side` cannot say
  *which* browsers are subscribed, so an operator cannot tell their own
  subscription from a stale one. `notifierStatus()` gained
  `listPushSubscriptionEndpoints()` and the status route returns
  `subscriptionEndpoints`; `subscriptions` is still returned so no consumer
  breaks.
- **The capabilities probe was incomplete.** `/api/system/capabilities` enumerated
  only `inApp` and `webpush`, omitting the pre-existing `webhook` channel as well
  as Telegram. Both are now present.
- **Persisted records migrate.** A pre-T14 `recent` row stored bare strings. `sent`
  and `off` migrate cleanly; `failed` takes its reason from the old sibling
  `${channel}Error` key, which is then dropped so a reason has one home. `skipped`
  is the interesting one: it meant *both* unconfigured and all-sends-failed and the
  record cannot say which, so it migrates to `unavailable` with a reason that
  **names the ambiguity**. Downgrading it to `failed` would understate a real
  failure; upgrading it would invent one that was never observed.

### Known limitation, recorded not hidden

The two new `notifierChannels` entries in `/api/system/capabilities` are
env-derived, exactly like the `webpush` line beside them, rather than read from
the notifier's own `CHANNELS` registry. That is a **restated list — a second home
for it** — and it is the one place in this task that trades a pin for a
duplication. The alternative was exporting the registry from `notifier.mjs` and
importing it into the boot path of the capabilities route, which would have moved
the import pair this file's whole accounting rests on. Flagged for a later task
rather than absorbed here.

## 8. Guard pins moved, and the accounting

Recomputed with the guard's **own extracted `stripComments()`**, not by trusting a
green assertion:

| Figure | Before | After | Movement |
|---|---|---|---|
| static imports | 72 | **72** | none |
| dynamic imports (comment-stripped) | 83 | **83** | none |
| raw dynamic imports | 84 | **84** | none |
| `requireAuth(req, res)` call sites | 126 | **126** | none |
| lines in `handlers.mjs` | 6,312 | **6,325** | **+13** |

The `lines` movement is 14 added and 1 removed: **4 code lines** (the status
route's `const st` + spread, and the two new capability entries) and **10 comment
lines**. The import pair being unchanged is the load-bearing part: not one of the
13 lines is a new module binding, because both edits reach a service those routes
had already imported.

Three test assertions moved, each to a **stronger** form rather than a looser one,
each with the reasoning recorded in the file:

- `ws7SeamGuard.test.mjs` — the unlanded-task list is now exactly `["T17","T18"]`
  with `count: 2`. Kept as an **exact list**, not a count, because "T14 is not in
  here" is evidence only if the list is complete.
- The same file's PICC.md row assertion now requires `T17 and T18 have not` and
  **forbids** `T14, T17 and T18 have not` as a live claim — the historical
  sentence survives only inside a quoted correction, matching the ARM/2 GB
  pattern already in that file.
- `ws7AuthBootstrapGateGuard.test.mjs` — the `lines` pin, with the accounting above.

Existing notifier/packObservers assertions moved from string comparisons to outcome
comparisons — `toBe("skipped")` became `toBe("unavailable")` **plus** a reason
assertion, because the string vocabulary had nowhere to put one.

## 9. Verification

- `npm run typecheck` — clean.
- Dashboard unit suite — green, above the 5,096 floor; run at least twice, and
  again after the commit.
- `crossRoomInvariantGate` and `ws7SeamGuard` — both run and reported before and
  after; the affordance ceiling is unchanged, so the ceiling invariant is
  unaffected by construction.
- `npm audit --audit-level=high` — must stay 0 high/critical. **No dependency was
  added**: `web-push@^3.6.7` was already in `apps/dashboard/package.json:27` and
  already had a production importer, which is why `deps.no-unused-dependency`
  stayed at 0.
- Exactly one tracked lockfile (`package-lock.json`); no pnpm field in any
  `package.json`.
- E2E not run. Nothing pushed.

## 10. Handoffs

**None, and that is a decision rather than an omission.** The handoff tables in
entries 0028, 0032 and 0035 exist to record work deferred to a *later* task; T14
defers nothing. Its whole scope — both transports, the state machine, the room —
is closed by this entry, so there is no row to carry. The seam guard's
`changelog-handoffs-open` count is therefore deliberately **unchanged** at 34
rows / 28 open, and the absence of a `0036` table is stated here so a reader
checking the arithmetic does not conclude one was forgotten.
