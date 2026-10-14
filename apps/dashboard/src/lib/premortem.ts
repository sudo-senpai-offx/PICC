import { getToken } from "./auth"

/**
 * Typed client for `GET /api/premortem/overview` (W3-05 Task 5).
 *
 * THE TYPES ARE A CLOSE TRANSCRIPT OF THE PAYLOAD, and the one rule that shapes
 * them is this module's thesis rather than a formatting preference: an absence
 * must not be able to render as a value. `manualCheck` is therefore
 * `string | null` and stays null when nobody has work to do, `evidence` fields
 * are `| null` where the server can decline to produce them, and `VERDICTS` is
 * a closed union rather than `string` — a verdict outside the set is a compile
 * error here, which is the earliest place it can be caught.
 */

/** The seven verdicts, as a closed union. A readout claiming an eighth is a type error. */
export type Verdict =
  | "verified"
  | "partially-covered"
  | "guard-missing"
  | "guard-cannot-fail"
  | "unclaimed"
  | "unverified-manual"
  | "stale-catalog-entry"

/** The mutation tier's three verdicts. Deliberately separate from `Verdict`. */
export type MutationVerdict = "bites" | "does-not-bite" | "not-run"

/**
 * One self-audit finding.
 *
 * `catalogFindings` is NOT the same channel as `results`, and a consumer that
 * reads only one of them is wrong in a way that reads as confident. The audit
 * deliberately takes no inventory, so it structurally cannot see a claim that
 * resolves to nothing — that is the `stale-catalog-entry` VERDICT's job, and it
 * lives in `results`. A defect may legitimately appear in BOTH.
 */
export interface CatalogFinding {
  id: string
  reason: string
  kind: string
}

/** One catalog mode's evaluated claim. */
export interface PreMortemResult {
  id: string
  verdict: Verdict
  /** Absent here means "the planner could not produce it", never "zero". */
  evidence: Record<string, unknown> | null
  /** Non-null only where a human still has work to do. */
  manualCheck: string | null
}

/** One entry's mutation outcome. `evidence.failed` is null when nothing was measured. */
export interface MutationRow {
  id: string
  verdict: MutationVerdict
  evidence: {
    reason: string
    claimPath: string | null
    claimTitle: string | null
    failed: boolean | null
  } | null
}

export interface PreMortemOverview {
  ok: boolean
  /** The server labels this endpoint advisory. It flips no permit and writes no store. */
  advisory: boolean
  catalogFindings: CatalogFinding[]
  results: PreMortemResult[]
  mutation: MutationRow[]
  /** Tally of `results` only. It does NOT cover `catalogFindings`. */
  counts: Record<string, number>
}

function headers(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * THIS COSTS ABOUT ELEVEN SECONDS.
 *
 * The route builds a disposable git worktree outside the repository and runs the
 * real guard suites against a broken implementation. That is what gives the
 * mutation verdicts their substance — a tier that can only ever return `not-run`
 * reports on nothing — and it is also why callers must NOT invoke this on mount.
 * An eleven-second spinner reads as a broken page, and firing it for every
 * visitor multiplies worktrees rather than reusing one.
 *
 * Call it deliberately, and keep the result: the readout is a point-in-time
 * measurement of one tree at one commit, and re-running it costs another
 * checkout.
 */
export async function fetchPremortemOverview(): Promise<PreMortemOverview> {
  const res = await fetch("/api/premortem/overview", { headers: headers() })
  if (!res.ok) throw new Error(`pre-mortem overview GET failed: ${res.status}`)
  return (await res.json()) as PreMortemOverview
}