# 0042 - PREPUSH_LOW_FINDINGS v1 -> v2

Two LOW findings from the pre-push security review, both introduced by this branch
and both regressions rather than pre-existing concerns. Neither is a takeover and
neither leaks a secret **value**; both are disclosures that let an anonymous
caller read per-device and per-environment state off a route nobody had gated. The
second finding's more important half is not the disclosure at all — it is that the
allowlist entry justifying the route had become **factually false**, which is
exactly what D26 and the documentation-truth work exist to prevent.

rule: PREPUSH_LOW_FINDINGS
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0042-PREPUSH_LOW_FINDINGS-v1-to-v2.md)
date: 2026-10-03
approvalDate: 2026-10-03
historicalTradesAffected: none
source: >-
  Owner instruction for this task, given 2026-10-03, closing the two LOW findings
  of the pre-push security review of the 27-commit WS-7 branch. Finding 1:
  `GET /api/notifications/status` returned `subscriptionEndpoints` on a branch
  inside the DECLARED-PUBLIC `/api/notifications` wrapper with no gate of its own,
  and a probe confirmed an anonymous non-loopback caller received every
  subscribed device's push endpoint URL. Finding 2: `GET /api/integrations`
  returned `state` and `configEvidence` on rows T18 derived from `process.env`, and
  a probe confirmed an anonymous caller read
  `newsapi: state=degraded configuredEvidence="NEWSAPI_API_KEY=set + PICC_NEWS_NEWSAPI=on"`;
  the allowlist entry's own stated reason ("a static seed ... every entry
  'unconfigured' until a probe says otherwise. The source comment says so.") had
  stopped being true. Owner constraints recorded with the task: the
  `/api/notifications` wrapper may NOT carry a gate; no new `owner: "decision"`
  entry and no new allowlist entry (62 deferred reads remain deferred); the
  route-auth coverage guard may not be weakened; `vapid-public-key` must remain
  publicly readable; a negative test per finding; the probe re-run, not reasoned
  about. Owner is recorded as the literal `WS-7+`.

reason: >-
  Both routes answered a question about THIS MACHINE to a caller with no session.
  Finding 1 handed out a stable per-browser registration identifier plus the push
  provider, and the route is pollable, so a device being added or removed was
  observable. Finding 2 handed out which credentials the deployment holds, in
  either direction — with a key set the evidence said `=set`; with no key set the
  DECLARED absence reason opened "NEWSAPI_API_KEY is unset". A field strip of
  `state` and `configEvidence` alone would have closed only the first direction,
  which is why the negative test asserts the absence of every env var NAME rather
  than of two field names. Neither finding is a takeover: the `p256dh`/`auth` push
  keys were never mapped into the status payload, and `configEvidence` is built
  from the env var NAMES, never from what they hold. Both were bounded environment
  reconnaissance — and the reviewer's probes, not the reasoning, are what
  established that, which is why this entry records the probes rather than an
  argument.

## v1 -> v2

v1 recorded the two findings as reported by the review, with the field moves
described as a single surface change. v2 states the SECOND direction of finding 2
(the declared absence reason is also a machine claim, so the public projection
carries no verdict at all), records the ordering constraint on the new gated
integrations route, and pins the recomputed figures.

## Finding 1 - the push endpoint URL

`GET /api/notifications/status` returned
`subscriptionEndpoints: n.listPushSubscriptionEndpoints()`. Before this round:

```
status: 200
  "subscriptionEndpoints": ["https://fcm.googleapis.com/fcm/send/abc123SECRETPATHDEF456?auth_token=OPAQUE-TOKEN-789"]
LEAKS endpoint URL?  true
LEAKS push keys?     false
```

The wrapper cannot carry a gate — the `vapid-public-key` branch sits above where a
gate would go and always returns (both its 503 and its 200 `return`), so a gate
before it would gate the key the browser must fetch before it can authenticate.
That is a property of the code, not a preference. So the field moved to a new
gated sibling, `GET /api/notifications/push-endpoints`, with `requireAuth(req,
res)` as the FIRST statement of its own branch, and `SignalNotificationsCard`
reads it as a second call. `notifierStatus()` stays public and keeps returning
`subscriptions` — the bare COUNT — which is what the room already rendered as the
fallback. A refused second read leaves the count showing, because "could not ask" is
not "there are none".

After:

```
status: 401 body: {"error":"authentication required"}
obtains the endpoint? false

=== AUTHENTICATED GET /api/notifications/push-endpoints ===
status: 200 body: {"ok":true,"subscriptionEndpoints":["https://fcm.googleapis.com/fcm/send/abc123SECRETPATHDEF456?auth_token=OPAQUE-TOKEN-789"]}
```

and on the ungated status route:

```
LEAKS endpoint URL?  false
LEAKS push keys?     false
```

`vapid-public-key` is asserted still public **with the key set**, because the
unset branch answers 503 and would satisfy a weaker test for the wrong reason.

## Finding 2 - the credential-configuration evidence, and the false allowlist reason

`newsSourceRows(env)` is derived from `process.env` at CALL time, so three of its
fields are environment reconnaissance rather than reference data: `state`,
`configEvidence`, and `unconfiguredReason`. The third is the non-obvious one.
`NEWS_SOURCES[i].unconfiguredReason` reads, for NewsAPI, "NEWSAPI_API_KEY is unset,
so the licensed NewsAPI leg cannot run." That sentence is reference data about what
the source REQUIRES and it is ALSO a claim that this machine's key IS unset. So:

| projection | verdict |
| :-- | :-- |
| emit the declared reason only when the source is unconfigured | publishes exactly the machine claim being removed |
| emit it unconditionally | constant, but puts a sentence asserting a machine fact on rows where it is false |
| **emit no verdict** (taken) | the public catalog makes no claim about this machine at all |

`publicNewsSourceRows(env)` is therefore a separate export rather than a flag: a
`{ public: true }` option is one argument away from being wrong at a call site
nobody re-reads, and the failure is silent — the route still answers 200, the room
still renders, the disclosure is simply back. Two names make the choice visible at
the import.

`integrationRegistry.mjs` adds `getUnauthenticatedIntegrations(env)` and
`getUnauthenticatedMinistryIntegrations(ministry, env)`, which serve the
projection. Both ungated routes call them. `state` is dropped from EVERY row
including the static seed's constant `"unconfigured"` — that constant is not
env-derived so dropping it closes nothing on its own, but a projection that strips
the derived half and keeps the constant half is a projection nobody can describe in
one sentence.

`GET /api/integrations/configuration` is the gated sibling. It is dispatched
**above** the ungated `path.startsWith("/api/integrations/")` branch, because that
branch matches `/api/integrations/configuration` too — a gated route placed after it
would be answered by the projection before its gate ever ran. That ordering is the
same hazard as the notifications wrapper in the opposite direction, and both are
pinned by a test.

Before:

```
  gdelt: state="degraded" configEvidence="PICC_NEWS_GDELT=on"
  newsapi: state="degraded" configEvidence="NEWSAPI_API_KEY=set + PICC_NEWS_NEWSAPI=on"
LEAKS configured evidence? true
LEAKS any env knob at all? true
LEAKS the secret value?    false
```

After, anonymous, and with nothing configured either:

```
  gdelt: state=undefined configEvidence=undefined unconfiguredReason=null
  newsapi: state=undefined configEvidence=undefined unconfiguredReason=null
LEAKS any env knob name? false
LEAKS the observed clause?  false
```

and authenticated, which is what the room reads:

```
status: 200
  gdelt: state=degraded configEvidence="PICC_NEWS_GDELT=on"
  newsapi: state=degraded configEvidence="NEWSAPI_API_KEY=set + PICC_NEWS_NEWSAPI=on"
LEAKS the secret value? false
```

### The allowlist reason, before and after

Verbatim, the `/api/integrations` entry's `reason` was:

> Per-ministry integration catalog: a static seed with honest boundary metadata,
> every entry 'unconfigured' until a probe says otherwise. The source comment says
> so. DECISION ITEM: the boundary metadata is a map of what this deployment could
> reach. RECOMMENDATION: leave public.

and is now:

> Per-ministry integration catalog, serving the PROJECTION from
> getUnauthenticatedIntegrations(): id, ministry, name, url, purpose, boundary,
> retrievalMode and licensedBasis, with unconfiguredReason present and null. It
> carries NO field derived from process.env and makes NO claim about this machine's
> configuration: `state`, `configEvidence` and `unconfiguredReason` are served only
> by the GATED /api/integrations/configuration. `unconfiguredReason` is dropped
> rather than reduced to its DECLARED half because that sentence opens "NEWSAPI_API_KEY
> is unset, so the licensed NewsAPI leg cannot run" - reference data about what the
> source REQUIRES, and also a claim that this key IS unset. So an anonymous caller
> cannot read which credentials this deployment holds, in either direction. Boundary
> metadata is still static reference data describing each SOURCE. DECISION ITEM: the
> catalog is a map of what this deployment COULD reach. RECOMMENDATION: leave the
> catalog public and keep the configuration surface gated.

Two corrections were needed rather than one, and both are the same defect. The
`/api/integrations/` sibling said "Same static seed as the sibling above", which was
also untrue after T18; and the `/api/notifications` wrapper said "Public for exactly
one sub-route", which was already loose (`/api/notifications/status` is public too)
and became looser when `push-endpoints` joined the gated set. Both were corrected
in place rather than deleted, because the routes are still deferred reads and the
owner's ruling keeps them on the list. No entry was added, no entry was removed, and
`62/74 route-auth-verdicts-deferred` is unchanged.

`integrationRegistry.test.mjs` and `newsSources.test.mjs` grew the service-level
half of the same assertions; the HTTP-boundary half is
`integrationRoutesDisclosure.test.mjs` and
`notificationsPushEndpointDisclosure.test.mjs`. Every negative is paired with a
control that a real session is admitted, because a route hard-coded to 401 would
pass all of them and be completely broken.

## The `readOnlyRooms` contract pass

Requested as a focused scan of `readOnlyRooms.ts` and `readOnlyRoomCompletions.ts`
for anything that fetches, holds a credential, or writes. Result: **nothing**.
`readOnlyRooms.ts` has **no imports at all** — it is pure declarative data, and says
so at line 67 ("PURE. No clock, no transport, no credential. Every value is copied
from a response or…"). `readOnlyRoomCompletions.ts` imports exactly two things from
it, `READ_ONLY_OWNER` and two types. Neither file contains `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource`, `document`, `window`, `navigator`, `useEffect`,
`localStorage`, `JSON.parse`, `process.env`, or any fs/child_process import. The
only matches for credential vocabulary are the word appearing inside prose, and the
`sourceToken` field — a UI anchor holding a COMPONENT NAME such as
`"SignalNotificationsCard"`, not a secret. The write-affordance rows name routes
and reasons; they issue no request. One observation, not fixed and out of scope:
`readOnlyRoomCompletions.ts:587` cites `GET /api/integrations (:5476)` and that line
number was **already** stale before this round (the route was at 5578 on `HEAD`), so
it is now 124 lines further off rather than newly wrong.

## Pins

| Figure | Before | After | Why |
| :-- | :-- | :-- | :-- |
| static imports in `handlers.mjs` | 72 | **72** | both new routes reach a service already imported |
| comment-stripped dynamic imports | 83 | **83** | `/api/notifications/push-endpoints` sits beside the wrapper's existing `await import("./services/notifier.mjs")` |
| `requireAuth(req, res)` call sites | 126 | **128** | one gate per new route |
| lines in `handlers.mjs` | 6,325 | **6,376** | +51, accounted for below |

All four measured on the guard's own comment-stripped view, by extracting
`stripComments()` out of `ws7RouteAuthCoverageGuard.test.mjs` and evaluating it
rather than reimplementing it. The extraction is proved faithful by running it over
the PRE-FIX tree as well: it reports statics 72, dynamics 83, `requireAuth` sites
126 and 6,325 lines — all four of the guard's original pins, exactly — and over the
fixed tree 72 / 83 / 128 / 6,376. Raw and comment-stripped `requireAuth` counts are
equal in this file (no comment contains that literal), so that figure is not a view
difference. The +51 is 16 code lines added, 5 code lines removed, 48 comment lines
added, 9 comment lines removed, and 1 blank line — classified by walking
`git diff -U0`, not by eye.

## Verification measured on this change

- `npm run typecheck` — exit 0.
- `npm run test --workspace @picc/dashboard` — **5412 passed / 1 skipped / 0
  failed** (384 files: 383 passed, 1 skipped), run **twice before commit** and once
  after, identical every time. Floor was 5381; net **+31** tests.
- Both reviewer probes re-run — see the transcripts above. Probe 1's
  `LEAKS endpoint URL?` is `false`; probe 2's `LEAKS any env knob at all?` is
  `false` in the configured direction and in the unconfigured one.
- `node scripts/ws7-seam-guard.mjs` — `verdict pass; 0 failing check(s)`, exit 0,
  with `62/74 route-auth-verdicts-deferred` unchanged.
- `node scripts/cross-room-invariant-gate.mjs --facts-file <real facts>` — exit 0,
  `failing rooms: none`, over the real 22 rooms. (Invoked with `--facts-file`,
  as record `0041` records it; the gate refuses to run without facts, by design.)
- `npm audit --audit-level=high` — exit 0; 0 high / 0 critical.
- `git diff --check` — exit 0, no whitespace errors.
- Exactly **one** tracked lockfile: `package-lock.json`.
- `vapid-public-key` still answers `200 {"publicKey": …}` to an anonymous caller
  with the key set; asserted at the HTTP boundary, not only in prose.
- e2e not run, nothing pushed — the owner holds the batch push.

## Anything left unverified

- The e2e suite was not run, per instruction. The two client-side changes (the
  second fetch in `SignalNotificationsCard`, the bearer header on
  `fetchIntegrations`) are covered by unit/component tests and by the HTTP-boundary
  controls, but no browser exercised the real subscribe flow end to end this round.
- `terminal-perf` did not fail on any of the three runs. It is recorded as
  unexercised rather than green: its known ~4-in-5 run-level timeout was not
  provoked either way, and no claim is made about it here.