import { getToken } from "./auth"

/**
 * Typed client for `POST /api/trading/risk-of-ruin` (UI-4).
 *
 * WHY THIS ROUTE NEEDS A CAREFUL TYPE. Until this task it was the one analysis
 * route the client could not be honest about: a caller that posted nothing got a
 * full, confident, precisely formatted readout — `riskOfRuin`, `edge`,
 * `unitsToRuin`, `kellyFraction`, a rounded `inputs` block — computed entirely
 * from values the SERVER had chosen, and not one field of the response said so.
 * The UI could not fix that, because it had nothing to be honest WITH; the fix
 * had to be at the source, and this module exists to make the new record hard to
 * misread on the way to the DOM.
 *
 * FOUR FACTS THE TYPE ENCODES, and each of them is a place a renderer would
 * otherwise collapse a distinction into a number:
 *
 *  1. `state` IS A CLOSED UNION of exactly three values. There is no fourth. A
 *     readout claiming "assumed-but-fine" is a compile error here rather than a
 *     line of JSX.
 *  2. `state` AND `supplied` ARE SEPARATE, and they can disagree. An input that
 *     was substituted AND THEN clamped has `state: "clamped"` and
 *     `supplied: false`. Reporting only the state hides that the operator never
 *     chose the number; reporting only `supplied` hides that it was changed.
 *  3. `used` IS THE NUMBER THE ARITHMETIC RAN ON, and `inputs` IS THE ROUNDED
 *     echo the server already shipped. They differ by ROUNDING — a ledger 47.5%
 *     reads 48 in `inputs` and 47.5 in `provenance.winRate.used`. The UI says
 *     "assumed 47.5%" by reading `used`, and that is why both are here.
 *  4. `substitute` AND `clamp` ARE `null` WHEN THEY DID NOT HAPPEN, not absent
 *     keys and not empty objects. Key presence is the test, so a renderer cannot
 *     reach `.reason` on something that has no reason.
 *
 * `assumedInputs` AND `clampedInputs` ARE NAMES, NOT COUNTS, and they are the
 * server's own lists rather than something the client re-derives. A client that
 * counted values would count a substituted `avgPayout` of 0.8 as supplied,
 * because 0.8 is indistinguishable from a typed 0.8 by value alone.
 */

/** The three inputs the UI collects, in the order the panel renders them. */
export type RiskOfRuinInput = "winRate" | "avgPayout" | "riskPct" | "balance"

export type RiskOfRuinInputState = "supplied" | "substituted" | "clamped"

/** Where a substituted value came from, in words the operator can act on. */
export interface RiskOfRuinSubstitute {
  /** The value chosen for the caller, in the caller's own unit. */
  value: number
  /** `"signal-accuracy-ledger"` or `"server-constant"`, as the server labelled it. */
  source: string
  /** The server's own reason, e.g. `"caller sent no value"`. */
  reason: string
}

/** Which bound moved a value, and why the bound is what it is. */
export interface RiskOfRuinClamp {
  from: number
  to: number
  /** The rule that applied, in words. */
  bound: string
  /** Why the rule exists — present only where "out of range" is not the whole story. */
  note?: string
}

export interface RiskOfRuinProvenanceEntry {
  /**
   * WHICH FACT CHANGED THE NUMBER. `"clamped"` outranks `"substituted"`, because
   * a reader misled by one is the one who has to notice a value was altered; the
   * assumption survives in `substitute` regardless.
   */
  state: RiskOfRuinInputState
  /** Whether the CALLER sent this value, independently of any clamp. */
  supplied: boolean
  /** The exact value the arithmetic ran on. `inputs` is this, rounded. */
  used: number
  substitute: RiskOfRuinSubstitute | null
  clamp: RiskOfRuinClamp | null
}

export interface RiskOfRuinInputs {
  winRate: number
  avgPayout: number
  riskPct: number
  balance: number
}

export interface RiskOfRuinMeasured {
  ok: true
  riskOfRuin: number
  riskOfRuinPct: string
  edge: string
  unitsToRuin: number
  expectedGrowthPct: string
  kellyFraction: string
  halfKellyPct: string
  inputs: RiskOfRuinInputs
  provenance: Record<RiskOfRuinInput, RiskOfRuinProvenanceEntry> & {
    /** Which inputs the caller did not supply. NAMES, never a count. */
    assumedInputs: RiskOfRuinInput[]
    /** Which inputs had a bound applied on the way in. */
    clampedInputs: RiskOfRuinInput[]
  }
}

/**
 * A refusal, from either of two places that mean different things.
 *
 * A thrown `401`/`500` never reaches this type — `readJson` turns those into a
 * thrown Error carrying the server's words. This is the shape where the route
 * answered 200 with `ok: false`, and it is declared rather than omitted so a
 * renderer is forced to decide what to draw.
 */
export interface RiskOfRuinRefused {
  ok: false
  error: string
}

export type RiskOfRuinResponse = RiskOfRuinMeasured | RiskOfRuinRefused

/** What the panel can collect. An ABSENT key means "send nothing". */
export type RiskOfRuinRequest = Partial<Record<RiskOfRuinInput, number>>

function headers(withJson: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  if (withJson) out["Content-Type"] = "application/json"
  // The route is behind `requireAuth`, so an anonymous call is a 401 — which
  // arrives here as a thrown Error carrying that message, and the panel renders
  // it as a refusal.
  const token = getToken()
  if (token) out.Authorization = `Bearer ${token}`
  return out
}

/**
 * A refusal becomes a thrown Error carrying the server's own words.
 *
 * The reason is the only useful part of a refusal, so falling back to a bare
 * status code is a last resort and never the first choice.
 */
async function readJson<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error || `${label} failed: ${res.status}`)
  return body
}

/**
 * POST the risk-of-ruin inputs.
 *
 * `inputs` IS SENT AS GIVEN, INCLUDING ITS ABSENT KEYS. A field the operator
 * left blank must arrive as ABSENT rather than as `0`, because `0` is a number
 * they did not type and sending it would make this client commit the very
 * substitution the server now discloses. Dropping the key is what lets the
 * server substitute honestly and report doing so.
 */
export async function fetchRiskOfRuin(inputs: RiskOfRuinRequest): Promise<RiskOfRuinResponse> {
  const res = await fetch("/api/trading/risk-of-ruin", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(inputs)
  })
  return readJson<RiskOfRuinResponse>(res, "risk-of-ruin")
}