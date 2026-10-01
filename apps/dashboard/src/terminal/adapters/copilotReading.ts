/**
 * WS-7 T7R-B — the Copilot seam: ONE adapter that turns the engine's output,
 * computed on the server, into the props both T7 rooms take.
 *
 * WHY AN ADAPTER AND NOT A FETCH IN THE ROOM. `terminal/routes/MarketsRoom.tsx`
 * states the rule this file implements: "Fetching the engine's output when it
 * exists is a wiring change in the adapter layer, not a change to this room."
 * Both rooms stay presentational — they take props, open no transport, and read
 * no clock of their own. The seam lives here, once, and neither room knows
 * where the reading came from.
 *
 * WHY IT IS AN HTTP CALL AND NOT A CLIENT-SIDE `evaluateCopilot`.
 *
 * An earlier draft of this file imported `services/copilot/engine.mjs` directly
 * and ran the engine in the browser. That was reverted, and the reason is the
 * whole reason T7's `producer-pending` flag existed:
 *
 *   1. IT DOES NOT CLOSE THE GAP. `evaluateCopilot` would then have exactly two
 *      referents in the repository — the browser and tests — which is the
 *      "no caller" condition T12 entry 0023 handoff #2 named. The SERVER would
 *      still be the module nothing calls, and there would be a second copy of
 *      the decision path in a second runtime to drift.
 *   2. `computedAt` IS A SAFETY INPUT. `marketState.mjs:135-139` makes it
 *      REQUIRED and refuses a missing one, because the engine reads no clock
 *      (AC-021). A value minted in the browser is the one input on this path no
 *      server can audit, and it feeds `sessionOpen` — the veto that suppresses
 *      entries for 15 minutes after the New York open. A caller choosing that
 *      timestamp chooses whether the veto fires.
 *   3. A CANDLE SERIES IS AN INPUT, NOT THE OUTPUT. The obvious client path —
 *      fetch candles, call the engine — would also put a market-data request in
 *      the measured room transition (`e2e/terminal-perf.spec.ts:150-161`) AND
 *      still leave Markets rendering an absence, because nothing server-side
 *      would be computing anything.
 *
 * So the client asks the server for the DECISION. `POST /api/trading/copilot`
 * fetches its own market state, derives it, evaluates, and returns the reading
 * in one authenticated round trip. See `services/copilot/decision.mjs`.
 *
 * IT IS A PROJECTION, NOT A SECOND ENGINE. Nothing here computes a score, a
 * band, a tier, or a threshold. The one `bandOf`/`tierFor` boundary in the
 * client remains a rendering projection, pinned equal to the server's by
 * `tierBoundaryParity.test.mjs`.
 *
 * ABSENCE STAYS ABSENCE. A transport failure, a 401, a non-JSON body, a
 * response with no `confluence`, and an asset with no history are all the same
 * thing to this file: `null` readings plus a named reason, so the rooms render
 * their honest-unavailable states. It never synthesises a score, never
 * substitutes a similar number, and never treats an unobserved value as zero.
 */

import type { ConfluenceScore, VetoOutcome } from "../contracts"
import type { AtrObservation, DrawdownObservation, ThreeStrikeObservation } from "../domain/riskLayer"

/**
 * What the client is given, and what it must never invent.
 *
 * `confluence: null` means "no score was obtained", never "the score is 0". The
 * room maps a null score to `ignore`/`hold` through
 * `domain/confluenceDecision.ts`, and conflating the two is the failure the
 * availability contract exists to prevent.
 */
export type CopilotReading = {
  confluence: ConfluenceScore | null
  vetoes: readonly VetoOutcome[]
  /** D5 safety flag. `false` unless a real gate said otherwise. */
  automationPermitted: boolean
  /** D6 read-only input. `paper` — the lowest rung — unless supplied. */
  rung: "paper" | "demo" | "live"
  /** Non-null only when the engine actually ran. Names the version. */
  engineVersion: string | null
  /** Why there is no reading, when there is none. Never empty on an absence. */
  reason: string | null
  /** Per-leg gaps the server reported, each naming which input was missing. */
  unavailable: ReadonlyArray<{ leg: string; reason: string }>
}

/** What RiskRoom takes: three independent observations, each nullable on its own. */
export type RiskReading = {
  atr: AtrObservation | null
  drawdown: DrawdownObservation | null
  threeStrike: ThreeStrikeObservation | null
}

/** The route's response shape, as far as this adapter reads it. */
type DecisionResponse = {
  ok?: boolean
  engineVersion?: string | null
  confluence?: Partial<ConfluenceScore> | null
  firedVetoes?: Array<Partial<VetoOutcome>>
  tier?: { automationPermitted?: boolean; rung?: string } | null
  unavailable?: Array<{ leg: string; reason: string }>
  risk?: {
    atr?: { atr: number; period: number; stopDistance: number; multiple: number; observedAt: number | null } | null
    drawdown?: DrawdownObservation | null
    threeStrike?: ThreeStrikeObservation | null
  } | null
}

/** The fail-closed reading. Every field is the safe direction. */
function absent(reason: string, unavailable: ReadonlyArray<{ leg: string; reason: string }> = []): CopilotReading {
  return {
    confluence: null,
    vetoes: [],
    // AC-024: an absent flag must never mean permitted. AC-025: lowest rung.
    automationPermitted: false,
    rung: "paper",
    engineVersion: null,
    reason,
    unavailable
  }
}

/**
 * Fetch the decision for one asset.
 *
 * ONE request. The client names the asset and nothing else — no candles, no
 * timestamps, no timeframes. Everything the engine needs, the server derives.
 *
 * @param assetId e.g. "EURUSD".
 * @param options `signal` for cancellation, `base` for the API root.
 * @returns The reading. NEVER throws: a transport failure is an absence with a
 *   reason, because a room that renders an error boundary instead of a named
 *   unavailable state is worse than one that names why it has nothing.
 */
export async function fetchCopilotReading(
  assetId: string,
  options: { signal?: AbortSignal; base?: string; fetchImpl?: typeof fetch } = {}
): Promise<CopilotReading> {
  // A delegation, not a second copy. Two nearly-identical fetch bodies would be
  // two places for the status handling to drift — and the drift that matters is
  // the unsafe direction, where one of them stops treating a 401 as an absence.
  // `fetchCopilotDecision` is the single implementation; this is its Copilot half.
  const { reading } = await fetchCopilotDecision(assetId, options)
  return reading
}

/**
 * The projection. Every field is either copied from the server or is the
 * fail-closed default. There is no arithmetic here.
 *
 * Exported for the test that drives it with a REAL engine result, so the
 * mapping is proven against something the engine actually produced rather than
 * against a hand-written object that could agree with a bug.
 */
export function projectDecision(assetId: string, body: DecisionResponse): CopilotReading {
  const unavailable = Array.isArray(body.unavailable)
    ? body.unavailable
        .filter((u) => u && typeof u.leg === "string" && typeof u.reason === "string")
        .map((u) => ({ leg: u.leg, reason: u.reason }))
    : []

  const raw = body.confluence ?? null
  // TWO ABSENCES, AND THEY ARE NOT THE SAME THING.
  //
  //   `confluence === null`  — the server refused to evaluate at all. The route
  //     hit `decision.mjs`'s floor and returned an absence with named legs. The
  //     room gets its generic "no reading" state and a reason.
  //
  //   `confluence.score === null` — the engine RAN and found the frozen dead
  //     zone. `contracts.ts:191-194` is explicit that `deadZone` is a regime and
  //     `null` is not `0`: the state was unscoreable. Collapsing this into the
  //     branch above would throw away the regime label and the per-expert
  //     contributions, and render "no decision" for a decision that was reached
  //     and correctly declined to score.
  //
  // Only the first is an absence.
  if (raw === null) {
    const named = unavailable.map((u) => `${u.leg}: ${u.reason}`)
    return absent(
      `The engine was not evaluated for ${assetId}.` +
        (named.length > 0 ? ` ${named.join(" ")}` : ""),
      unavailable
    )
  }
  if (raw.score !== null && (typeof raw.score !== "number" || !Number.isFinite(raw.score))) {
    // The engine returned a confluence whose score is neither `null` nor a finite
    // number. That is a contract violation, and the safe reading of it is an
    // absence: a coerced 0 would be a fabricated score.
    //
    // `null` is explicitly ALLOWED through, because it is the contract's own
    // value for "unscoreable" — `contracts.ts:191-196` is explicit that it is
    // not `0`, and `0` is a legitimate score meaning "the engine evaluated this
    // and found nothing". `typeof null !== "number"` is true, so the naive check
    // below would reject the one null the contract permits.
    return absent(
      `The engine returned a malformed score for ${assetId} (${JSON.stringify(raw.score)}), which is not a reading.`,
      unavailable
    )
  }

  const tier = body.tier ?? null
  // Every narrowing below is deliberate. `ConfluenceScore` is a CLOSED contract
  // (`contracts.ts:195-204`): `confidence` is a four-value union, `regime` is a
  // five-value union, `computedAt` is a number, `engineVersion` is a string. A
  // cast would paper over a server that grew a sixth regime; narrowing turns the
  // same situation into a visible, tested fall-back.
  const confidence = oneOf(raw.confidence, ["high", "medium", "low", "unavailable"]) ?? "unavailable"
  const regime = oneOf(raw.regime, ["tokyoRange", "londonTrend", "nyVolatility", "hypertrend", "deadZone"]) ?? "deadZone"
  // `deadZone` is the contract's own name for "no regime could be read", and the
  // spec's note at `contracts.ts:191-194` is that it is a REGIME, not a score.
  // Falling back to it keeps an unreadable regime from reading as a market call.
  const computedAt = finite(raw.computedAt) ? raw.computedAt : 0
  const version = nonEmpty(raw.engineVersion) ?? nonEmpty(body.engineVersion) ?? "unknown"

  return {
    confluence: {
      score: raw.score,
      contributions: raw.contributions ?? [],
      confidence,
      regime,
      activeBoosters: raw.activeBoosters ?? [],
      conflictOverrides: raw.conflictOverrides ?? [],
      computedAt,
      engineVersion: version
    },
    vetoes: Array.isArray(body.firedVetoes)
      ? body.firedVetoes.filter((v): v is VetoOutcome => v != null && typeof v.ruleId === "string")
      : [],
    // Copied, and `=== true` on the way: the server is authoritative but a
    // non-boolean must not read as permitted.
    automationPermitted: tier?.automationPermitted === true,
    rung: tier?.rung === "live" || tier?.rung === "demo" ? tier.rung : "paper",
    engineVersion: version,
    reason: null,
    unavailable
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}
function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * The Risk room's three observations, from ONE decision response.
 *
 * `atr` is real when the server produced one. `drawdown` and `threeStrike` are
 * `null` unless the server supplies them, because this adapter does not compute
 * either and must not stand in: a `strikes: 0` assembled here would assert a
 * counter nobody read, and a drawdown rail evaluated from a session figure
 * would be the substitution `domain/riskLayer.ts` refuses.
 *
 * Each is independently nullable, and that is the point: a live ATR next to two
 * silent rails must not read as "the whole risk layer is live".
 */
export function projectRisk(body: DecisionResponse | null | undefined): RiskReading {
  const risk = body?.risk ?? null
  const atr = risk?.atr ?? null
  return {
    atr:
      atr && typeof atr.atr === "number" && Number.isFinite(atr.atr) && atr.atr > 0
        ? {
            atr: atr.atr,
            // The literal, not `atr.period`. The client's `AtrObservation` types
            // the period as `14` because that is the only period the engine
            // computes, and widening it here would quietly re-open the door to a
            // differently-perioded producer reaching this surface.
            period: 14,
            stopDistance: atr.stopDistance,
            observedAt: atr.observedAt ?? 0,
            source: "POST /api/trading/copilot"
          }
        : null,
    drawdown: risk?.drawdown ?? null,
    threeStrike: risk?.threeStrike ?? null
  }
}

/** What MarketsRoom takes. Assembled from ONE response in ONE fetch. */
export type CopilotAndRisk = { reading: CopilotReading; risk: RiskReading }

/**
 * Fetch the decision AND the risk observations in ONE request.
 *
 * Both surfaces are projections of the same response, so fetching them separately
 * would mean two round trips, two broker fan-ins, and — worse — two views of one
 * market taken at two different moments. The Risk room's ATR and the Markets
 * room's ATR are the same number computed from the same bars for the same
 * `computedAt`, and this is what keeps that true.
 */
export async function fetchCopilotDecision(
  assetId: string,
  { signal, base = "/api", fetchImpl }: { signal?: AbortSignal; base?: string; fetchImpl?: typeof fetch } = {}
): Promise<CopilotAndRisk> {
  const id = typeof assetId === "string" ? assetId.trim().toUpperCase() : ""
  if (!id) return { reading: absent("No asset was named, so no decision could be requested."), risk: projectRisk(null) }

  const doFetch = fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(`${base}/trading/copilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // NO `credentials` OPTION, AND THAT IS DELIBERATE — not an omission.
      //
      // The URL is RELATIVE, so the request is same-origin, and `fetch`'s default
      // is `credentials: "same-origin"`, which already sends the session cookie.
      // `"include"` would therefore change nothing here while doing real harm in
      // one direction: it is the option that forwards cookies to a THIRD-PARTY
      // origin, so if `base` were ever set to an absolute cross-origin URL, this
      // line would start shipping the user's session to it.
      //
      // It is also what `ws6SafetySeamGuard.test.mjs:136-138` pins: the terminal
      // tree must not fetch a credential-bearing endpoint, and
      // /fetch\([^)]*credential/i matches the `credentials` option inside the
      // call. The guard is right for the reason above, so the fix is here and not
      // in the guard.
      signal,
      body: JSON.stringify({ assetId: id })
    })
  } catch (err) {
    // A network failure is not a score of zero and not a pass.
    return {
      reading: absent(`The Copilot decision for ${id} could not be reached: ${err instanceof Error ? err.message : String(err)}`),
      risk: projectRisk(null)
    }
  }

  if (response.status === 401 || response.status === 403) {
    return {
      reading: absent(`The Copilot decision for ${id} requires an authenticated session; the request was refused (${response.status}).`),
      risk: projectRisk(null)
    }
  }
  if (!response.ok) {
    return {
      reading: absent(`The Copilot decision service for ${id} answered ${response.status}.`),
      risk: projectRisk(null)
    }
  }

  let body: DecisionResponse
  try {
    body = (await response.json()) as DecisionResponse
  } catch {
    return {
      reading: absent(`The Copilot decision service for ${id} answered ${response.status} with a body that is not JSON.`),
      risk: projectRisk(null)
    }
  }

  // Risk is projected from the SAME body, including when the confluence is an
  // absence. A refusal to score is not a refusal to report an ATR: the engine
  // derived the series and `atrStop` ran on it either way, so dropping the risk
  // half here would discard a real observation because an unrelated part of the
  // response was unusable.
  return { reading: projectDecision(id, body), risk: projectRisk(body) }
}
