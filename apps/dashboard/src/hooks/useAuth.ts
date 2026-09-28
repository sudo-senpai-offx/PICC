import { useEffect, useState } from "react"
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
 * while giving up on a genuinely dead backend within ~15s. At the bounded
 * backoff below that is 5 retries after 1s, 2s, 4s and 8s; the 6th consecutive
 * inconclusive answer signs out. Comfortably longer than any plausible restart,
 * and short enough that "still signed in" never becomes a lie.
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

export function useAuth() {
  const [session, setSession] = useState<LocalSession | null>(null)
  const [loading, setLoading] = useState(true)
  // Consecutive inconclusive answers. This is the retry driver: the effect is
  // keyed on it, so each increment schedules exactly one bounded re-check.
  const [inconclusive, setInconclusive] = useState(0)

  useEffect(() => {
    let alive = true

    const run = async () => {
      if (inconclusive > 0) {
        const i = Math.min(inconclusive, INCONCLUSIVE_RETRY_DELAYS_MS.length) - 1
        await new Promise((r) => setTimeout(r, INCONCLUSIVE_RETRY_DELAYS_MS[i]))
        if (!alive) return
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
