# 0047 - GATED_ROUTE_CALLER_AUDIT v1 -> v2

Client-side audit of every caller of the 24 routes gated by 0046, plus the
inverse check 0046 could not perform on itself: whether any test of those routes
began passing only because of the loopback bypass. Two callers were broken on any
non-loopback deployment, both for the same reason and both by the same false
premise. One of them was found by grepping for the routes; the other was NOT, and
is the reason this entry exists.

rule: GATED_ROUTE_CALLER_AUDIT
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0047-GATED_ROUTE_CALLER_AUDIT-v1-to-v2.md)
date: 2026-10-04
approvalDate: 2026-10-04
historicalTradesAffected: none
source: >-
  Owner instruction given 2026-10-04 for this task, working alone, as the highest
  priority on the branch. It named NotificationCenter.tsx:88 as a known unfixed
  breakage and required every caller of all 24 gated routes to be found by grep
  rather than assumed from one directory, each classified as already-authenticated
  / broken-remote-only / broken-everywhere / no-caller, and every broken caller
  fixed by reusing src/lib/api.ts's existing bearer mechanism rather than
  inventing a second one. It required understanding why any caller had used
  `credentials: "include"` before changing it. It required one test per fixed
  caller that asserts the AUTHENTICATION MECHANISM, on the grounds that a test
  running on localhost cannot catch a loopback-bypass failure - which is the
  whole point, because the existing tests had passed while the client was broken.
  It required the inverse check on the gate tests themselves, and required the two
  signed routes' `owner` field change to be investigated and REPORTED but NOT
  changed, because that field change was not authorised. E2E was not to be run and
  the batch push is the owner's.
reason: >-
  0046 gated 24 routes and deleted their allowlist rows. A gate is only half a
  change: the other half is every client that must now present a credential, and
  0046 recorded one such client as broken without fixing it. The deeper problem is
  that the suite could not have caught it. `requireAuth` admits any request whose
  real TCP peer is loopback (`isLocalhostRequest`, handlers.mjs:6098), and every
  client test in this repo runs in jsdom against a stubbed `fetch`, so the server is
  never consulted and the bypass is never exercised in either direction. Nothing in
  a localhost client test can distinguish "the route answered" from "the route would
  have refused and the bypass let it through". That is a structural blind spot, not
  a missing assertion, and it is why the fix here is a test that asserts the
  CREDENTIAL against the real verifier rather than one more status-code assertion.

## The false premise, stated once

PICC's server sets **no cookie at all**. There is no `Set-Cookie` anywhere in the
non-test server sources; the session lives in `localStorage` under `picc.auth` and
travels as `Authorization: Bearer`, which is the only credential `verifyUser` reads
(`services/auth.mjs:799`, which returns null for anything not starting with
`Bearer `). Therefore `credentials: "include"` cannot authenticate anything in this
application, on any origin, ever - and the reason had to be understood before
changing it, because "there is no reason a header does not cover" is only
convincing once the absence of a cookie is established rather than assumed.

## Caller 1 - NotificationCenter.tsx (known, now fixed)

The alert bell's 10s poll called bare
`fetch("/api/trading/alerts", { credentials: "include" })` with no Authorization
header, on a route 0046 gated. On localhost the loopback bypass admitted it. On any
remote deployment `verifyUser` refused, the 401 body had no `ok` field, and the
component's `if (!data.ok) return` swallowed it - so the bell silently stopped
updating, with no error, which is the worst shape a client failure can take.

The same file already imported the authenticated client thirty lines above for
`getInterventions()`, which is what identifies this as an oversight rather than a
deliberate choice: `lib/trading.ts:1162` exports `getAlerts()`, an authenticated
wrapper for this exact route, and it was simply not used.

Fixed by calling `getAlerts()`. Mechanism reused: `lib/trading.ts`'s existing
`request()`, which is a verbatim twin of `lib/api.ts`'s and reads the same
`getToken()`. No second auth mechanism was introduced. Behaviour is unchanged for
the failure path: `getAlerts()` throws on a non-2xx and the existing
`catch { /* ignore */ }` swallows it exactly as `!data.ok` did.

## Caller 2 - terminal/adapters/readOnlyReading.ts (found by this audit)

`fetchReadOnlyView` is the ONE transport behind all sixteen read-only room
instances. Its `getJson` fetched with no Authorization header, and its module
header explained why:

> The URLs are RELATIVE, so every request is same-origin and `fetch`'s default
> `credentials: "same-origin"` already sends the session cookie.

That premise is false, and the falseness was load-bearing: it is why the adapter
sent no credential. Four of the producer routes declared in `readOnlyRooms.ts` are
among the 24 gated - `/api/trading/status` (:331), `/api/streams/snapshot` (:491),
`/api/twin/run` (:510), `/api/trading/signals` (:606) - so on any remote
deployment all sixteen rooms rendered their named absence for those four. The
absence text read "requires an authenticated session" for a user who WAS
authenticated; the client simply never said so.

**Why the first sweep missed it, recorded because it is the transferable lesson.**
The audit swept every tracked file for the 24 route paths and then for every raw
`fetch(`. Both sweeps were clean for this file, because it fetches a COMPUTED path
(`getJson(plan.route, ...)`, `readOnlyReading.ts:132`) assembled from a
declarative `route:` field in another module. A literal-string sweep cannot see a
route that is never written as a literal. The thing that found it was reading the
module's own docstring and noticing it asserted a mechanism that did not exist -
so the durable rule is that a comment claiming an auth mechanism is itself a
finding, and worth verifying against the server rather than reading as settled.

Fixed by reading the token with `getToken()` and sending it as a bearer, matching
`lib/api.ts` and `lib/trading.ts`. The token is injectable via the same optional
override shape `request()` uses and DEFAULTS to the stored session, so a future
room cannot forget it - forgetting is the failure mode being fixed, so the default
must be the correct one rather than the explicit one. The `credentials` option
stays absent, which `ws6SafetySeamGuard.test.mjs:136-138` pins against; adding a
header does not weaken that assertion, which forbids fetching credential-BEARING
endpoints, not sending credentials.

## The loopback proof

`routeAuthClientAuthProof.test.tsx` asserts the credential, not a status, and
asserts it by handing the header the client actually emitted to the real
`verifyUser()` that `requireAuth` calls. `verifyUser` is a pure function of its
argument and never looks at a socket, so `isLocalhostRequest` cannot participate in
the verdict - the negative half is a real refusal, not a mock's idea of one.

Both halves are covered, and both were confirmed RED against the pre-fix code by
reverting each caller and re-running:

- reverting `readOnlyReading.ts` alone -> the two read-only assertions fail
- reverting `NotificationCenter.tsx` alone -> the component assertion fails

The component test is asserted separately from the `getAlerts()` test on purpose.
Asserting that the wrapper is authenticated is necessary but NOT sufficient: the
defect was never in `getAlerts`, it was in NotificationCenter declining to call it,
so a test that only drove the wrapper would have proved the wrapper was always
fine and said nothing about the caller. That gap was real and was caught by the
red-check, which is the reason the red-check was run rather than assumed.

A sibling `.d.mts` was added for `auth.mjs`, following the four existing
precedents. It is not ceremony: without it the importer is `any`, and
`await verifyUser(x) === null` would then compile for ANY `x`, including a
malformed header, so the test would assert nothing while typecheck stayed green.

## The inverse check - two tests were vacuous on loopback

Two suites exercised a newly-gated route through `socket: { remoteAddress:
"127.0.0.1" }`, so their 200-assertions were reachable by an anonymous caller
that production refuses, and neither could have detected the gate:

- `paperOverviewApi.test.mjs` - its header still claimed "/api/trading/* is
  auth-free (localhost)", a sentence that was true when written and became false
  when 0046 gated `/api/trading/paper/overview` and `/api/trading/paper/trade`
- `resourceGovernorApi.test.mjs` - same bypass against `/api/settings/llm/resource`

Both now present a NON-LOOPBACK peer (TEST-NET-3) and a real session, which is
the path production takes, and each gained one control asserting the anonymous
non-loopback caller is refused AND that the refusal carries none of the payload
the authenticated read returns. No existing assertion was weakened or removed;
every prior 200 and shape assertion is retained, now over the authenticated
request. Without those controls "the route answered" would still be satisfied by a
route that answers everyone, which is the vacuity being removed.

By contrast `routeAuthRuling24Gates.test.mjs:21-32` and
`t20rRouteAuthGates.test.mjs:17-33` already document and implement the correct
harness - no `socket` on the request, plus a seeded user so the first-run
bootstrap at `handlers.mjs:6119` cannot admit anyone - and
`ws7RouteAuthCoverageBehaviour.test.mjs:37-50` uses distinct TEST-NET-3 addresses
precisely so the bypass cannot apply. Those were checked and are sound; the
failure was confined to the two files above.

## The other 22 routes

Every remaining caller reaches its route through `lib/api.ts`'s `request()` or
`lib/trading.ts`'s identical local `request()`, both of which attach
`Authorization: Bearer` from `getToken()`. All of them sit under
`<RequireAuth>` (`App.tsx:49-77`), which renders nothing until a session exists,
so the token is present at each call site. `n8n`'s content pipeline was already
given a run-time bearer by 0046. The two dev probes
(`scripts/probe-e2e-decisions.mjs:30`, `scripts/probe-hud-overlay.mjs:48`) are
readiness polls that explicitly accept `401` as "server is up" and run against a
fresh empty auth dir, so they never depended on the gate. `/api/trading/risk-of-ruin`
and `/api/trading/export` have no client caller in the repository at all.

## What was NOT changed

The `owner` field on `/api/stripe/webhook` and `/api/profile/github/callback` was
reclassified from `decision` to `declared` by 0046 without authorisation, and it is
the one call on the branch the owner reserved. It was investigated and left alone.
Its blast radius is reported with the work rather than acted on.
