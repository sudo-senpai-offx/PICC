import { useEffect, useRef, useState } from "react"
import { fetchMe, getStoredSession, setStoredSession, shouldClearStoredSession } from "@/lib/auth"
import type { LocalSession, LocalUser } from "@/lib/auth"

/**
 * Consecutive INCONCLUSIVE answers tolerated before the retained session is
 * abandoned.
 *
 * An inconclusive answer proves nothing about the token, so one must never sign
 * anyone out — but retaining the session forever is not free either: if the
 * backend stays unreachable the user is left with a permanently "logged in"
 * shell whose every request fails, and a session that was genuinely revoked
 * survives until reload instead of redirecting cleanly.
 *
 * 5 is chosen to ride out a real but short outage (a server restart or redeploy)
 * while giving up on a genuinely dead backend within ~23s. At the bounded
 * backoff below that is FIVE waits, not four: the sign-out check happens on the
 * way IN to a /me call, so the 8s entry is spent twice — once returning to
 * inconclusive #4, and once more on the pass that runs with inconclusive
 * already at 5. That sixth pass is the one that trips `next > MAX`, so the
 * waits are 1s, 2s, 4s, 8s and 8s, totalling 23s, and the SIXTH consecutive
 * inconclusive answer signs out. (Pass 5 sets inconclusive = 5 and does not
 * trip; the label that matters is the pass, not the counter value.) Comfortably
 * longer than any plausible restart, and short enough that "still signed in"
 * never becomes a lie.
 */
export const MAX_INCONCLUSIVE_CHECKS = 5

/**
 * Delay before each re-check after an inconclusive answer.
 *
 * Bounded on purpose: the last entry is the ceiling, so a struggling auth
 * service is polled at most every 8s. A zero-delay or growing retry here would
 * turn a degraded dependency into a request storm.
 */
export const INCONCLUSIVE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000]

/**
 * WS-6 T10 INSTRUMENTATION — one line per sign-out decision.
 *
 * The terminal-performance flake is UNROOTED. These two lines are the only thing
 * that separates the candidate mechanisms, and they separate it by elapsed time
 * measured over the CURRENT chain of attempts:
 *
 *   reason "rejected"                with a SMALL elapsedMs  -> a 401 destroyed a
 *                                      session the client still held
 *   reason "inconclusive-exhausted"   with elapsedMs ~23000   -> six inconclusive
 *                                      answers in a row
 *
 * Only the first is consistent with the recorded symptom. On the inconclusive
 * path the effect calls setSession(stored) and setLoading(false), so the app
 * RENDERS with the retained session and `[data-room='markets']` is satisfied in
 * about a second — a 30s selector timeout does not match it. That is why rounds 1
 * and 3 were mis-specified, and why no fifth mechanism is proposed here.
 *
 * ── WHY `startedAt` IS REBASED, AND WHY IT HAD TO BE ────────────────────────
 * Round 4 set `startedAt` once, in a `useRef` at mount, and nothing ever reset
 * it: `setInconclusive(0)` clears the counter at :145 and :156 but not the ref.
 * So `elapsedMs` was time-since-MOUNT, and the discriminator above is unsound
 * for any sign-out that does not happen immediately after mount — a 401 arriving
 * on the seventh attempt after a 23-second outage reported the outage's length,
 * i.e. the exact number the line exists to keep separate from it.
 *
 * It is rebased at the top of every pass where `inconclusive === 0`, which is
 * precisely "the first attempt of a chain": it covers the initial mount, and it
 * covers every reset, because every reset (sign-out, and recovery) goes through
 * `setInconclusive(0)` and the effect is keyed on that counter — so the next pass
 * runs with 0 and rebases. One line rather than two, and it cannot drift out of
 * agreement with the counter the way a reset in each branch could.
 *
 * Pinned behaviourally, not by source regex, in
 * src/hooks/__tests__/useAuth.signOutTrace.test.tsx. The regex round 4 shipped
 * (/elapsedMs:[\s\S]{0,80}performance\.now\(\) - startedAt/) matches this code AND
 * the broken code; it described an expression, not a value.
 *
 * Cheap and silent when nothing is wrong: one console.debug, which the browser
 * only surfaces with devtools open, and only on a sign-out. Never throws.
 */
const AUTH_TRACE_ENABLED = () => {
  try {
    return typeof localStorage !== "undefined"
  } catch {
    return false
  }
}

function traceSignOut(reason: "rejected" | "inconclusive-exhausted", inconclusive: number, startedAt: number) {
  if (!AUTH_TRACE_ENABLED()) return
  try {
    console.debug("[auth] sign-out", {
      reason,
      inconclusivePass: inconclusive,
      elapsedMs: Math.round(performance.now() - startedAt)
    })
  } catch {
    /* instrumentation must never break sign-in */
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

export function useAuth() {
  const [session, setSession] = useState<LocalSession | null>(null)
  const [loading, setLoading] = useState(true)
  // Consecutive inconclusive answers. This is the retry driver: the effect is
  // keyed on it, so each increment schedules exactly one bounded re-check.
  const [inconclusive, setInconclusive] = useState(0)
  // The start of the CURRENT chain of attempts, so traceSignOut reports how long
  // the chain the line is about actually took — and not how long the component
  // has been mounted. Rebased at the top of every pass that begins a chain.
  const startedAt = useRef(now())

  useEffect(() => {
    let alive = true

    const run = async () => {
      if (inconclusive > 0) {
        const i = Math.min(inconclusive, INCONCLUSIVE_RETRY_DELAYS_MS.length) - 1
        await new Promise((r) => setTimeout(r, INCONCLUSIVE_RETRY_DELAYS_MS[i]))
        if (!alive) return
      } else {
        // A pass with no retry pending IS the first attempt of a chain: the first
        // one ever, or the first since the counter was reset by a sign-out or a
        // recovery. Rebasing here rather than in each reset site is what keeps
        // the number and the counter it describes from drifting apart.
        startedAt.current = now()
      }

      const stored = getStoredSession()
      if (!stored) {
        setSession(null)
        setLoading(false)
        return
      }

      const result = await fetchMe()
      if (!alive) return

      if (shouldClearStoredSession(result)) {
        // The server refused the token outright. That is the ONLY branch that
        // destroys a session.
        traceSignOut("rejected", inconclusive, startedAt.current)
        setStoredSession(null)
        setSession(null)
        setInconclusive(0)
        setLoading(false)
        return
      }

      if (result.kind === "confirmed") {
        const fresh: LocalSession = { ...stored, user: result.user }
        setStoredSession(fresh)
        setSession(fresh)
        // Reset the backoff after a recovery. This re-runs the effect once more,
        // which costs one extra /me call per outage and then settles.
        setInconclusive(0)
        setLoading(false)
        return
      }

      // Inconclusive: keep the session and come back on the bounded backoff,
      // until the tolerance above is spent.
      const next = inconclusive + 1
      if (next > MAX_INCONCLUSIVE_CHECKS) {
        traceSignOut("inconclusive-exhausted", inconclusive, startedAt.current)
        setStoredSession(null)
        setSession(null)
        setLoading(false)
        return
      }
      setSession(stored)
      setInconclusive(next)
      setLoading(false)
    }

    void run()
    return () => {
      // Unmount / superseded: drop any in-flight answer so it cannot land
      // against a session that has since changed.
      alive = false
    }
  }, [inconclusive])

  return { session, loading }
}

export function useUser(): LocalUser | null {
  const { session } = useAuth()
  return session?.user ?? null
}
