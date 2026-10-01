/**
 * WS-7 T8 — the transport seam for the Ceremony and Ministry rooms.
 *
 * WHY AN ADAPTER AND NOT A FETCH IN THE ROOM. `terminal/routes/CeremonyRoom.tsx`
 * and `terminal/routes/MinistryRoom.tsx` are presentational by construction:
 * they take a prop, open no transport and read no clock. `MinistryRoom.tsx`
 * (the page) renders rooms with NO props (`<Room />`), so a caller has to exist
 * to hand each room its reading — and that caller is `pages/ministry/*Room.tsx`.
 * This file is the seam those callers use, exactly as
 * `adapters/copilotReading.ts` is the seam for Markets and Risk.
 *
 * IT COMPUTES NOTHING. Every field below is either copied from the response or
 * is a named absence. Neither projection here evaluates a gate, derives a
 * separation verdict, decides whether a venue is unlocked, or restates a
 * threshold: the Ceremony gates are the WS-3 store's and the separation rows are
 * T16's, and a second copy of either in the client is the drift plan §3.5 Risk 6
 * names.
 *
 * NEITHER ROOM FETCHES CANDLES. They consume their own producers — the WS-3
 * ceremony store and the WS-7 authority model — so neither `marketDataBus` nor
 * any market endpoint appears here. Adding one would be the wrong fix for
 * nothing: T7R-B already established that a candle series is an INPUT to a
 * decision, not its output.
 *
 * ABSENCE STAYS ABSENCE. A transport failure, a 401, a 403, a non-JSON body and
 * a body with no rows are all the same thing here: a `null` readout plus a
 * reason, so each room renders its named-unavailable state. Neither function
 * synthesises an unlock, an authority, a collision verdict or a grant.
 *
 * NO `credentials` OPTION, AND THAT IS DELIBERATE — not an omission. The URLs are
 * RELATIVE, so both requests are same-origin, and `fetch`'s default is
 * `credentials: "same-origin"`, which already sends the session cookie.
 * `"include"` would change nothing here while doing real harm in one direction:
 * it is the option that forwards cookies to a THIRD-PARTY origin, so if `base`
 * were ever an absolute cross-origin URL these calls would ship the user's
 * session to it. It is also what `ws6SafetySeamGuard.test.mjs:136-138` pins —
 * the terminal tree must not fetch a credential-bearing endpoint — so the guard
 * is right for that reason and the fix belongs here, not in the guard.
 */

/** GET bodies this module reads. Never widened without a producer change. */
type CeremonyResponse = {
  ok?: boolean
  at?: string | null
  scaleMinResolves?: number | null
  scaleEnvError?: string | null
  classes?: unknown
}

type GovernanceResponse = {
  ok?: boolean
  governanceVersion?: string | null
  unassignedAuthority?: string | null
  authorities?: { registered?: unknown; count?: number; reason?: string | null } | null
  buildRegistry?: { recordCount?: number; roomsCovered?: unknown; reason?: string | null } | null
  rooms?: unknown
  separation?: Record<string, unknown> | null
  permits?: { brokers?: unknown; changeCount?: number; grants?: unknown; reason?: string | null } | null
  refusalCodes?: unknown
}

/**
 * One GET helper, used by both rooms.
 *
 * A delegation rather than two near-identical bodies: the drift that matters
 * here is the unsafe direction, where one of them stops treating a 401 as an
 * absence and starts rendering the room's contents to an anonymous caller.
 */
async function getJson(
  path: string,
  label: string,
  options: { signal?: AbortSignal; base?: string; fetchImpl?: typeof fetch }
): Promise<{ body: unknown; error: string | null }> {
  const { signal, base = "/api", fetchImpl } = options
  const doFetch = fetchImpl ?? fetch

  let response: Response
  try {
    response = await doFetch(`${base}${path}`, {
      method: "GET",
      // NO `credentials` OPTION — see this module's header.
      signal
    })
  } catch (err) {
    // A network failure is not an unlocked venue and not a clean separation state.
    return { body: null, error: `${label} could not be reached: ${err instanceof Error ? err.message : String(err)}` }
  }

  // A 401/403 is an AUTH ANSWER, and it must read as an absence: rendering the
  // room's contents after the gate refused is the disclosure the gate prevents.
  if (response.status === 401 || response.status === 403) {
    return {
      body: null,
      error: `${label} requires an authenticated session; the request was refused (${response.status}).`
    }
  }
  if (!response.ok) {
    return { body: null, error: `${label} answered ${response.status}.` }
  }

  try {
    return { body: (await response.json()) as unknown, error: null }
  } catch {
    return { body: null, error: `${label} answered ${response.status} with a body that is not JSON.` }
  }
}

/**
 * The Ceremony room's readout.
 *
 * `GET /api/command-centre/ceremony` is the WS-3 route that already existed at
 * `handlers.mjs:1868`, already `requireAuth`-gated as its first statement. T8
 * REUSES it and deliberately adds no second ceremony route: one server route per
 * room is the shape T7R-B established, and a second route serving the same
 * store would give one store two answers taken at two moments.
 *
 * NEVER THROWS. A failure is a `null` readout plus a reason.
 */
export async function fetchCeremonyReadout(
  options: { signal?: AbortSignal; base?: string; fetchImpl?: typeof fetch } = {}
): Promise<{ readout: CeremonyResponse | null; error: string | null }> {
  const { body, error } = await getJson("/command-centre/ceremony", "The ceremony readout", options)
  if (error !== null) return { readout: null, error }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { readout: null, error: "The ceremony readout returned a body that is not an object." }
  }
  return { readout: body as CeremonyResponse, error: null }
}

/**
 * The Ministry room's readout.
 *
 * `GET /api/trading/ministry`, added by T8 and gated the same way. Note what is
 * NOT here: no market data, no candles, and no request to the ceremony route.
 * T8's bisect line (spec :1271) requires the two rooms to degrade independently,
 * and a client that fetched one room's data while rendering the other would fuse
 * them at the seam.
 *
 * NEVER THROWS.
 */
export async function fetchMinistryGovernance(
  options: { signal?: AbortSignal; base?: string; fetchImpl?: typeof fetch } = {}
): Promise<{ readout: GovernanceResponse | null; error: string | null }> {
  const { body, error } = await getJson("/trading/ministry", "The Ministry governance readout", options)
  if (error !== null) return { readout: null, error }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { readout: null, error: "The Ministry governance readout returned a body that is not an object." }
  }
  return { readout: body as GovernanceResponse, error: null }
}
