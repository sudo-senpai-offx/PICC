import { buildReadOnlyRoomView, readOnlySectionsFor } from "../domain/readOnlyRooms"
import type { ReadOnlyRoomKey, ReadOnlyRoomView, ReadOnlySuiteId } from "../domain/readOnlyRooms"
import { getToken } from "@/lib/auth"

/**
 * WS-7 T10 — the transport seam for ALL SIXTEEN read-only room instances.
 *
 * ===========================================================================
 * ONE ADAPTER FOR SIXTEEN INSTANCES, NOT SIXTEEN ADAPTERS
 * ===========================================================================
 *
 * The same reasoning as T8's `governanceReading.ts`, carried further. T8 had two
 * rooms and one adapter, on the stated principle that "the drift that matters
 * here is the unsafe direction" — one copy treating a 401 as an absence and
 * another not. Sixteen instances multiplying that seam would multiply the exact
 * direction that matters most: one room rendering its contents to an anonymous
 * caller because its copy of the 401 handling was edited and the others were not.
 *
 * So there is ONE `getJson`, ONE treatment of a non-2xx answer, and ONE place a
 * refusal becomes an absence. Sixteen page callers use it, and none of them can
 * opt out of the safety direction.
 *
 * ===========================================================================
 * IT COMPUTES NOTHING AND ADDS NO ROUTE
 * ===========================================================================
 *
 * Every value is copied from a response or it is a named absence. Nothing here
 * evaluates a gate, derives a verdict, or restates a threshold — T11 owns what a
 * score means, T16 owns the permit, and the producers own their own state. T10's
 * producer audit found that all nine keys ALREADY had a producer behind a route
 * that ALREADY existed, so this adapter reuses nine existing GETs and adds none.
 * That is T9's Discipline paying off: check first whether a producer already has
 * a route, because a second route over one store gives that store two answers
 * taken at two moments.
 *
 * ===========================================================================
 * NO `credentials` OPTION, AND NO SESSION COOKIE TO SEND — DELIBERATE, PINNED
 * ===========================================================================
 *
 * Copied verbatim in substance from T8's adapter, for T8's reasons: the URLs are
 * RELATIVE, so every request is same-origin, and `"include"` would change
 * nothing here while doing real harm in one direction — it is the option that
 * forwards cookies to a THIRD-PARTY origin. That much still holds.
 *
 * What this header USED to assert next was false, and the falseness was load-
 * bearing: it claimed that `fetch`'s default `credentials: "same-origin"` "already
 * sends the session cookie", and on that premise the adapter sent NO
 * Authorization header at all. There is no session cookie. PICC's server sets
 * none — there is no `Set-Cookie` anywhere in the non-test server sources —
 * because the session lives in `localStorage` and travels as
 * `Authorization: Bearer`, which is the only credential
 * `verifyUser(req.headers.authorization)` (services/auth.mjs) will read. So the
 * request carried no credential, always, and four of the producer routes declared
 * in `readOnlyRooms.ts` are gated: /api/trading/status, /api/streams/snapshot,
 * /api/twin/run and /api/trading/signals. Every one of the sixteen read-only
 * room instances therefore rendered its named absence on any non-loopback
 * deployment while passing here, because `isLocalhostRequest()` admitted the
 * anonymous caller. That absence text then read "requires an authenticated
 * session" for a user who WAS authenticated — the client simply never said so.
 *
 * The fix is the same one the rest of the client already uses (lib/api.ts and
 * lib/trading.ts): read the token with `getToken()` and send it as a bearer. The
 * token is injectable for tests through the same optional-override shape
 * `request()` uses, and DEFAULTS to the stored session so a caller cannot forget
 * it — the failure mode being fixed here is precisely a call site that forgot.
 */

/** One section's declared producer, as the adapter needs it. */
export type ReadOnlyReadoutPlan = { id: string; route: string }

export type ReadOnlyFetchOptions = {
  signal?: AbortSignal
  base?: string
  fetchImpl?: typeof fetch
  /**
   * Bearer to present. DEFAULTS to the stored session (`getToken()`), which is
   * what makes the gate pass; pass it explicitly only to override, exactly as
   * `request()` in lib/api.ts treats its own optional `token`.
   */
  token?: string | null
}

/**
 * One GET helper, shared by all sixteen instances.
 *
 * A failure is never a value. A network error, a 401, a 403, a 500, a non-JSON
 * body — all of them produce `null` plus a reason, so the room renders its named
 * absence. There is no branch here that can return a plausible substitute, which
 * is what makes "unavailable is unavailable, not zero" a property of the
 * transport and not only of the projection.
 */
async function getJson(
  route: string,
  label: string,
  options: { signal?: AbortSignal; base?: string; fetchImpl?: typeof fetch; token?: string | null }
): Promise<{ body: unknown; error: string | null }> {
  const { signal, base = "", fetchImpl, token = getToken() } = options
  const doFetch = fetchImpl ?? fetch
  const path = `${base}${route}`
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await doFetch(path, {
      method: "GET",
      headers,
      // NO `credentials` OPTION — see this module's header.
      signal
    })
  } catch (err) {
    return {
      body: null,
      error: `${label} could not be reached (${route}): ${err instanceof Error ? err.message : String(err)}`
    }
  }

  // A 401/403 is an AUTH ANSWER and must read as an absence. Rendering a room's
  // contents after the gate refused is precisely the disclosure the gate prevents,
  // so this branch is not an optimisation — it is the gate.
  if (response.status === 401 || response.status === 403) {
    return {
      body: null,
      error: `${label} requires an authenticated session; ${route} refused the request (${response.status}).`
    }
  }
  if (!response.ok) {
    return { body: null, error: `${label} answered ${response.status} (${route}).` }
  }

  try {
    return { body: (await response.json()) as unknown, error: null }
  } catch {
    return { body: null, error: `${label} answered ${response.status} (${route}) with a body that is not JSON.` }
  }
}

/**
 * Fetch one instance's declared producers and project the view.
 *
 * SECTIONS ARE FETCHED INDEPENDENTLY. This is why the adapter is shaped this way
 * rather than bundling: one failing request must not blank the whole room, because
 * a room that goes blank cannot say WHICH producer was unobserved, and "some of
 * this room's data is missing" is less honest than "this producer is missing".
 *
 * A producer that refused is passed through as an OBJECT CARRYING ITS ERROR, not
 * dropped. The projection treats an object with an `error` field as a refusal, so
 * the room shows the producer's own words; passing `null` instead would discard
 * the only text that explains the absence.
 */
export async function fetchReadOnlyView(
  key: ReadOnlyRoomKey,
  suite: ReadOnlySuiteId,
  options: ReadOnlyFetchOptions = {}
): Promise<ReadOnlyRoomView> {
  const plans: ReadOnlyReadoutPlan[] = readOnlySectionsFor(key, suite)
  const readouts: Record<string, unknown> = {}

  await Promise.all(
    plans.map(async (plan) => {
      const { body, error } = await getJson(plan.route, plan.id, options)
      readouts[plan.id] = error === null ? body : { error }
    })
  )

  return buildReadOnlyRoomView({ key, suite, readouts })
}