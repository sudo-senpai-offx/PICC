# 0046 - ROUTE_AUTH_OWNER_RULING v1 -> v2

Execution record for the owner's ruling that closed the 62 open route-auth
verdicts: 24 routes gated, every allowlist row re-decided, ten wrong reasons
corrected, the borderline reads left public on purpose, and the two signed
routes reclassified as standing records rather than open questions. One rule was
also quietly overridden in the process - "allowlist entries may not be deleted to
reach zero" - and that override is recorded here rather than absorbed silently.

rule: ROUTE_AUTH_OWNER_RULING
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0046-ROUTE_AUTH_OWNER_RULING-v1-to-v2.md)
date: 2026-10-03
approvalDate: 2026-10-03
historicalTradesAffected: none
source: >-
  Owner ruling given 2026-10-03 for this task, working alone. It named 24 routes to
  gate with requireAuth and required each gate to be the FIRST statement of its own
  dispatch branch, ahead of any precondition or withTimeout wrapper, because a gate
  placed later is dead code. It required the 24 corresponding allowlist entries to be
  DELETED rather than annotated, so the allowlist would describe only what is still
  public. It required the remaining decision items to become standing records with a
  real reason each, it named ten reasons that were factually wrong and required each
  to be corrected with before and after recorded, it required three borderline reads
  to be left public and flagged for a follow-up ruling, and it required the two
  signed routes to be recorded as standing records. It required `GET|POST
  /api/trading/paper/analytics` to be gated WITHOUT breaking the take-profit and
  stop-loss auto-close that the same handler performs. It required the n8n content
  pipeline to send a bearer token because `/api/content/generate` now refuses
  without one. Verification demanded: typecheck, the dashboard suite twice before
  the commit and once after, the WS-7 seam guard, the cross-room invariant gate over
  the real 22 rooms, `npm audit --audit-level=high`, and `git diff --check`. E2E was
  explicitly not needed, and the batch push is the owner's to make.
reason: >-
  A declared-public allowlist with 62 unruled entries is an open security surface
  wearing the costume of a finished audit. Each entry had been parked as "DECISION
  ITEM" with a recommendation, and the recommendations had disagreed with each other
  and with the code - one entry recommended leaving a route public while describing
  reads the route did not perform. Ten of them were simply wrong about what their
  route does, so leaving the text in place would have left the record asserting
  something false about live code. The honest repair in every case was to make the
  code match the ruling and then make the record match the code.

## What the ruling changed, measured

| Measure | Before | After |
|---|---|---|
| Allowlist rows | 74 | 50 |
| Rows still `owner: "decision"` | 62 | **0** |
| Rows `owner: "declared"` | 12 | 50 |
| `requireAuth(req, res)` call sites in handlers.mjs | 128 | 152 |
| `handlers.mjs` lines | 6376 | 6421 |
| Seam-gate `route-auth-verdicts-deferred` | 62/74 | **0/50** |

The +152 is 24 new gates plus the pre-existing 128. The +45 lines are 24 gate
lines, 21 lines of new comment recording why each gate is where it is, and 13
relocated lines from the notifications wrapper reorder that net to zero.

**A CONSTRAINT WAS OVERTURNED, AND THE OVERRIDE IS THE POINT.** The prior plan
(`PICC_TRADING_SUITE_WS7_REMAINING_T7_T21_PLAN_v1.md`) recorded "entries may not be
deleted to reach zero" as a standing constraint, with the reason that deletion is
how a surface disappears without being closed. That constraint is correct as a
default and it is overridden here by explicit instruction: these 24 rows are deleted
because the routes behind them now carry gates, so the rows describe nothing that
exists. The risk the constraint guards against - a row vanishing while its route
stayed open - is closed from the other side, by `routeAuthRuling24Gates.test.mjs`,
which asserts for each of the 24 that the allowlist has no row AND that an
anonymous caller is refused AND that the gate is the branch's first statement. A
deletion with no gate is a red build; that is what makes deletion safe here.

## The 24 gates, and the placement proof

Every row below was measured from `handlers.mjs` after the edit: the branch is the
`if (path === ...)` line, and the gate must appear within the branch's own opening
statements rather than anywhere in the file.

| Route | Methods | Branch line | Gate |
|---|---|---|---|
| `/api/trading/status` | GET, POST | 1426 | first statement |
| `/api/twin/run` | POST | 1335 | first statement |
| `/api/trading/pro/narrative` | POST | 2759 | first statement |
| `/api/trading/portfolio/aggregate` | POST | 4387 | first statement |
| `/api/trading/risk-of-ruin` | POST | 4645 | first statement |
| `/api/notifications/status` | GET | 4230 | first statement |
| `/api/settings/llm/resource` | GET | 2842 | first statement |
| `/api/listing/analyze` | POST | 5137 | first statement |
| `/api/listing/keywords` | POST | 5144 | first statement |
| `/api/listing/rewrite` | POST | 5150 | first statement |
| `/api/content/generate` | POST | 5170 | first statement |
| `/api/trading/assist` | POST | 3048 | first statement |
| `/api/streams/snapshot` | GET | 5131 | first statement |
| `/api/trading/paper/positions` | GET, POST | 2974 | first statement |
| `/api/trading/paper/overview` | GET | 2980 | first statement |
| `/api/trading/paper/history` | GET, POST | 2986 | first statement |
| `/api/trading/signals` | GET | 2992 | first statement |
| `/api/trading/accuracy` | GET, POST | 3027 | first statement |
| `/api/trading/paper/analytics` | GET, POST | 3037 | first statement |
| `/api/trading/demo/analytics` | GET, POST | 3284 | first statement |
| `/api/trading/demo/deals` | GET, POST | 3295 | first statement |
| `/api/trading/export` | GET | 3307 | first statement |
| `/api/trading/alerts` | GET | 3620 | first statement |
| `/api/trading/alerts/history` | GET | 3626 | first statement |

Five branches return `true` from their dispatch rather than `return` -
`portfolio/aggregate`, `risk-of-ruin`, `notifications/status`,
`settings/llm/resource` and `trading/export` - and each of those returns `true`
after the gate rather than `return`, so the wrapper's own control flow is unchanged.

Three of these paths have a second method on a sibling branch that was already
gated: `/api/streams/snapshot` POST (5118), `/api/trading/signals` POST (3002) and
`/api/trading/alerts` POST (3637). Those were already gated and are recorded here
only so the reader can see that both halves of each path are now gated rather than
one.

**THE NOTIFICATIONS WRAPPER WAS REORDERED, AND THAT NEEDS SAYING.** The gate guard
classifies each allowlist branch by whether its enclosing block is conditional, and
it had flagged `path.startsWith("/api/notifications")` as a conditional wrapper
whose discriminator it could not resolve. The wrapper cannot carry a gate of its
own, because `GET /api/notifications/vapid-public-key` has to answer before a
session exists or the browser cannot subscribe at all. The repair was to put the
VAPID branch first in the wrapper and the gated `prefs` and `status` branches below
it, which leaves the wrapper's public path first in the body as well as first in
the dispatch. That is a code motion, not a new decision, and it is why the gate
assertion in `notificationsPushEndpointDisclosure.test.mjs` is bounded to the
vapid branch's own block: a wrapper-wide scan would report the key as gated and the
test would be asserting the opposite of what it claims.

## The ten wrong reasons, before and after

Four of the ten were routes the ruling gated, so their rows were deleted and there
is no surviving text to correct. Their HEAD wording is recorded because "the row is
gone" is not the same as "the claim was checked".

| Route | HEAD claim | Now |
|---|---|---|
| `/api/trading/status` | "Machine-level, no user data, and the dashboard polls it before a session exists. RECOMMENDATION: leave public." | Deleted; gated. The polling-before-a-session argument was the strongest reason to keep it open and it did not survive contact with an owner ruling. |
| `/api/trading/accuracy` | "POST re-baselines it. DECISION ITEM - it is computed from the signal store, which is itself ungated, so gating this alone would not stop the write path. RECOMMENDATION: gate it together with /api/trading/signals." | Deleted; gated together with `/api/trading/signals`, which is exactly what the old reason asked for. |
| `/api/notifications/status` | "Machine-level, no user data ... DECISION ITEM. RECOMMENDATION: leave public." | Deleted; gated. |
| `/api/trading/portfolio/aggregate` | "this one needs a closer look than the others, because 'aggregate' and the returned todayPnl/riskCheck fields suggest it may fold in the user's own positions ... owner should confirm whether it reads any per-user position store; if it does, gate it." | Deleted; gated. The owner's ruling is the confirmation this entry was asking for. |

The six that survived were wrong about what their route does, and the correction in
each case is a fact about the code rather than a change of opinion:

| Route | HEAD claim | Corrected to |
|---|---|---|
| `/api/trading/candles` | "Reads the liveEO buffer and Yahoo, **not a user store**." | It also reads `chart-prefs.json`, which is keyed **by userId**, so the stored chart preferences are part of the answer. It is a per-user read served anonymously. |
| `/api/trading/watchlists` | "each entry carries **its id**." | Each entry carries **both its id and its userId**. userId is what makes it a per-user read rather than a neutral id list. |
| `/api/trading/spread` | "Reads live quotes and feed config, **not user state**." | It opens `venue-credentials.json` and the response **enumerates the configured exchanges**, so it discloses which venues this deployment holds credentials for. No credential material crosses, so it is configuration disclosure, not a secret leak. |
| `/api/integrations` | Described the projection as uniform: id, ministry, name, url, purpose, boundary, retrievalMode, licensedBasis, unconfiguredReason. | The 13 rows are **not uniform**: 5 are derived and carry those fields, the other 8 are static and carry six reference keys with no `unconfiguredReason` at all. The entry described half the catalog. |
| `/api/trading/calendar` | "Third-party macro data, no store read, no user data." | The store claim was right and the entry was still incomplete: it is an **outbound fetch of `CALENDAR_URL` on every request**, the same outbound surface its `/api/trading/news` and `/api/opportunities/bounties` siblings disclose, which this entry was silent about. |
| `/api/trading/health` | "Machine-level. RECOMMENDATION: leave public; it carries no per-user rows." | It is **not compute-only**: the handler fetches **200 candles from a live broker per request**, so an anonymous caller can drive repeated live-broker round trips. The outbound spend, not the payload, is the exposure. |

The last one is the clearest illustration of why the other nine mattered. "Machine
level" was true in the sense that mattered for per-user rows and false in the sense
that mattered for cost, and the entry used the true half to dismiss a cost the
route imposes on every anonymous request.

## Left public on purpose, and flagged

Three reads were judged borderline and deliberately NOT gated, because the ruling
named 24 routes and inventing a twenty-fifth would be substituting my judgement for
the owner's. Each says so in its own reason text and each needs a follow-up ruling:

| Route | Why it is borderline |
|---|---|
| `GET /api/trading/watchlists` | Each entry carries its userId, so on the merits it belongs with the per-user reads this round gated; its ids are also exactly what the sibling delete takes. |
| `POST /api/trading/candles` | Reads the per-user `chart-prefs.json`. |
| `POST /api/trading/scan` | Falls back to `getWatchlist()`, so it reads the operator's own saved watchlist when the caller passes no symbols. The symbol count should also be bounded, as the screener sibling already is. |

The GET on `/api/trading/watchlists` is the borderline half; its POST sibling was
already gated by T20R as a write. Asserting the POST as still-public would have
contradicted `t20rRouteAuthGates.test.mjs`, which asserts that POST is refused, so
both files now name the GET.

## The two signed routes

`POST /api/stripe/webhook` and `GET /api/profile/github/callback` keep their
allowlist rows - they must, since an external party calls them with no session -
and their reasons now read "STANDING RECORD, not an open question" instead of
carrying an unruled decision.

This required resolving an ambiguity in the instruction, which asked both that these
two "stay `owner: decision` as a standing record" and that the deferred count reach
zero. Those cannot both hold literally: a row whose owner is `decision` IS the
thing the deferred counter counts. They were recorded as `owner: "declared"` with a
reason that says in words that they are a standing record, which satisfies the
intent of both halves - the reasoning is preserved verbatim and the counter is
honest. The alternative, keeping `owner: "decision"` and accepting a non-zero
deferred count, would have left the headline number wrong to keep a field value
right. **If the owner intended the field itself to stay `decision`, this is the one
decision in this record that should be revisited.**

## paperAnalytics: gated, and the auto-close still happens

`GET|POST /api/trading/paper/analytics` is gated, and the handler also converges
open positions against take-profit and stop-loss (services/trading.mjs, the
`paperAnalytics` body and its call into `closePaperTradeLocked`). Gating the route
must not have quietly become "gating the route and the close", because the close
is what makes a position stop being open.

`paperAnalyticsAutoClose.test.mjs` measures the store rather than the status code:

- An anonymous GET is refused AND `trading-ledger.json` is byte-identical before
  and after, by SHA-256 of the file.
- An anonymous POST likewise leaves the ledger byte-identical.
- The same seed read WITH a session returns `autoClosed`, closes the seeded
  stop-loss position at 250 with `exitSource: "mark"`, and the ledger hash changes.
- A direct service call converges the same position with no HTTP involved.

The third test is the control the first two depend on: without it, "the ledger did
not change" would also be satisfied by a close that never happens at all.

## n8n

`infra/n8n/workflows/picc-content-pipeline.json` posts to `/api/content/generate`,
which now refuses an anonymous caller, so the HTTP Request node sends
`Authorization: Bearer {{ $vars.PICC_CONTENT_PIPELINE_TOKEN || $env.PICC_CONTENT_PIPELINE_TOKEN }}`
with `sendHeaders: true`. The token is resolved at RUN TIME and no literal secret is
written into the file, because an exported workflow is a tracked file and a literal
there would be a committed credential. If the variable is unset the header renders
as `Bearer ` and the route answers 401, which is the honest failure rather than a
silent success. Verified: valid JSON, 6 nodes, no long opaque token anywhere in the
node.

## Six tests that had to absorb the ruling, and what was NOT done to them

The ruling broke six pre-existing tests. Every one was a test asserting that one of
the 24 routes stays open. None was deleted and no assertion was weakened; in four
cases the assertion was made STRONGER.

- `ReadOnlyRoom.test.tsx` listed `/api/trading/signals` and `/api/trading/status`
  in `KNOWN_UNGATED_ROUTES` precisely because they were ungated. Both are now gated,
  so leaving them would assert that a closed hole is still open. Removed from the
  list, with the reason recorded in place.
- `t20rRouteAuthGates.test.mjs` gained the three borderline routes in its
  `DEFERRED_READS` table, on GET for watchlists.
- `ws7RouteAuthCoverageBehaviour.test.mjs` learned the alert payload shape by
  reading the registry anonymously, which is now refused. The shape is now
  established WITH a session, and the test additionally asserts that the anonymous
  read of the same registry is 401 and carries no id. The `not.toContain(ALERT_ID)`
  assertion it exists to make non-vacuous is unchanged.
- `notificationsPushEndpointDisclosure.test.mjs` asserted that
  `/api/notifications/status` returns 200 anonymously, because gating it "would be a
  different decision". That decision has now been made. The anonymous half asserts
  401 **and** no leak; the payload-shape half moved to a session, where the field
  move still has to hold - the status branch must not read the endpoint list even
  for a caller allowed to. A gate that emptied the payload would have satisfied the
  leak assertions, so the 200-with-count-and-channels test was kept and pointed at a
  session. One test was added: the status branch now carries `requireAuth` as its
  first statement, matching the sibling's existing static assertion.
- `ws7AuthBootstrapGateGuard.test.mjs` had the `handlers.mjs` line pin 6376, now
  6421, with the +45 accounted for as 24 gates + 21 comment lines + 13 relocated.

One defect was fixed in passing rather than worked around: the
`/api/trading/news` allowlist row had lost its four-space indent during an earlier
splice, so the behavioural sweep's anchored marker regex counted 49 rows while the
guard's looser parser counted 50. The sweep was therefore firing one probe fewer
than the allowlist has rows. The indentation was restored, and the exact pin in
`ws7RouteAuthCoverageBehaviour.test.mjs` is what surfaced it.

## Verification

`npm run typecheck` exit 0. Dashboard suite, `npm run test --workspace @picc/dashboard`:

| Run | Result | Test files | Tests |
|---|---|---|---|
| 1 | all green | 386 passed, 1 skipped | 5447 passed, 1 skipped, 0 failed |
| 2 | exit 0 | 386 passed, 1 skipped | 5447 passed, 1 skipped, 0 failed |

Baseline at the start of this task was 5431 passed / 1 skipped, so the net is +16.
**That +16 is not fully accounted for and is recorded as unverified rather than
explained.** 38 of the new tests are in two new files (33 + 5, both confirmed
present and green in the run output) and 1 more is in
`notificationsPushEndpointDisclosure.test.mjs`, which went 11 -> 12. A per-file
audit of `it(`/`test(` declarations across every tracked test file found only two
files changed and both went UP, so no test was deleted by this work; but declaration
counts were never a proxy for runtime counts (5108 declarations against a 5432-test
baseline), so the residual ~23-test difference is unexplained by anything measured
here. It is not load-bearing for any claim in this record - no assertion was
removed, which the declaration audit does establish.

Focused runs: `ws7RouteAuthCoverageGuard` 34 passed, `routeAuthRuling24Gates` 33
passed, `paperAnalyticsAutoClose` 5 passed.

Gates:

| Gate | Result |
|---|---|
| `node scripts/ws7-seam-guard.mjs` | exit 0, `verdict pass; 0 failing check(s)`, `route-auth-verdicts-deferred` reads `0/50 [RULED - NOTHING DEFERRED]` |
| `node scripts/cross-room-invariant-gate.mjs --facts-file <real facts>` | exit 0, `failing rooms: none`, over the real 22 rooms |
| `npm audit --audit-level=high` | exit 0; 3 moderate, **0 high / 0 critical** |
| `git diff --check` | exit 0, no whitespace errors |

The cross-room facts were produced by `collectRoomCompletionFacts()`, which is
TypeScript with `@/`-aliased imports and therefore needs the dashboard's vitest
config to resolve; they were emitted through a throwaway emitter that was deleted
immediately, and it is confirmed absent. Worth recording that this gate refuses to
run without facts, and that an EMPTY facts payload fails all 22 rooms with
`measured=0 budget=1` - by design, since a gate that cannot see a room cannot clear
it. Omitting the flag is not a way to make this gate quiet.

`npm audit` reports 3 moderate advisories, in `qs` and the `vitest` /
`@vitest/mocker` chain. They are pre-existing and below the gate's threshold; no
lockfile is touched by this change, so nothing here introduced them.

The `onTaskUpdate` worker transport error that entry 0045 recorded as making
`npm run test` exit 1 on an otherwise-green run did not appear in either run here;
both are recorded as clean, which is an observation about these two runs and not a
claim that the transport bug is fixed.

## Recorded, not fixed

**`NotificationCenter.tsx` cannot read a route this change gated.**
`apps/dashboard/src/components/NotificationCenter.tsx:88` fetches
`/api/trading/alerts` with `credentials: "include"` and NO `Authorization` header,
while `verifyUser` accepts only a bearer token. On localhost that is invisible,
because the loopback bypass admits the caller; on a remote deployment the request
is refused and the notification centre silently stops updating. This is a real
regression in a client that the ruling did not name, and the honest place for it is
here rather than a silent edit to a component outside the ruling's scope. **It needs
a follow-up: either the client sends the token or the route's read half is served by
a session-scoped sibling.**

**Five tracked files have no trailing newline, and did not have one at HEAD:**
`notificationsPushEndpointDisclosure.test.mjs`, `t20rRouteAuthGates.test.mjs`,
`ws7SeamGuard.test.mjs`, `ReadOnlyRoom.test.tsx` and `scripts/ws7-seam-probe.mjs`.
Verified against `git show HEAD:<file>` rather than assumed. They were left as they
were found, because appending a byte to five files that are otherwise untouched
would add diff noise to a security change for no behavioural gain. The two NEW files
in this change do end with a newline. All eleven changed files are CR-free.

**Historical records still describe the old state, correctly.** Entries 0032 and
0042 and the T7-T21 plan document that `/api/trading/signals` was ungated and that
entries may not be deleted to reach zero. Both were true when written. They were not
rewritten, because a changelog that edits its own past is not a changelog; this
entry is the supersession.

Not pushed: the owner holds the single batch push and a security review runs first.
No e2e run. Nothing written under `apps/dashboard/server/data/`.
