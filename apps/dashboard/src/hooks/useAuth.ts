import { useEffect, useState } from "react"
import { fetchMe, getStoredSession, setStoredSession } from "@/lib/auth"
import type { LocalSession, LocalUser } from "@/lib/auth"

export function useAuth() {
  const [session, setSession] = useState<LocalSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      const stored = getStoredSession()
      if (!stored) {
        if (alive) {
          setSession(null)
          setLoading(false)
        }
        return
      }
      const user = await fetchMe()
      if (!alive) return
      if (user === undefined) {
        // Inconclusive (network error, 5xx, 429, unparseable body). Keep the
        // session we already had instead of signing the user out over a blip.
        // Clearing here — which this used to do for every non-user answer — is
        // what produced a hard /login redirect and, downstream, the WS-6 T10
        // perf-spec flake.
        setSession(stored)
        setLoading(false)
        return
      }
      if (user) {
        const fresh: LocalSession = { ...stored, user }
        setStoredSession(fresh)
        setSession(fresh)
      } else {
        setStoredSession(null)
        setSession(null)
      }
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  return { session, loading }
}

export function useUser(): LocalUser | null {
  const { session } = useAuth()
  return session?.user ?? null
}
