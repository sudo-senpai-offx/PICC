// T10 (slice 6 reskin) — persisted per-user chart source preference
// (PICC_MULTISOURCE_ENGINE Mechanism B / server chartPrefs.mjs + the
// /api/trading/source-preference route). The hook mirrors the server contract:
//   GET  → { ok, userId, source }   ("auto" | broker slug, normalized)
//   POST → { source } → { ok, userId, source } (unknown slugs resolve to "auto")
// Non-blocking by design: while the initial GET is in flight `pref` stays
// "auto" (the plain quality fan-in — behavior-preserving), and TradingChart
// passes the pref down as the chart's `source`. A failed load/persist keeps the
// last-good value and surfaces a notice — the chart never breaks.
import { useCallback, useEffect, useRef, useState } from "react"
import { request, post } from "@/lib/api"

interface SourcePrefResponse {
  ok: boolean
  userId: string
  source: string
}

export interface SourcePreferenceResult {
  /** The active source ("auto" | broker slug). "auto" until the GET resolves. */
  pref: string
  /** True once the initial GET settled (success or failure). */
  loaded: boolean
  /** Non-blocking failure notice (null when all good). */
  notice: string | null
  /** Persist a new source. Resolves true when the server accepted it. */
  persist: (slug: string) => Promise<boolean>
}

export function useSourcePreference(): SourcePreferenceResult {
  const [pref, setPref] = useState("auto")
  const [loaded, setLoaded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Once the user acts, a slow/late GET response must not clobber the choice.
  const userChanged = useRef(false)

  useEffect(() => {
    let alive = true
    request<SourcePrefResponse>("/trading/source-preference")
      .then((r) => {
        if (!alive || userChanged.current) return
        setPref(r.source)
        setLoaded(true)
      })
      .catch(() => {
        if (!alive) return
        setLoaded(true)
        setNotice("Couldn't read your saved source — using Auto (best).")
      })
    return () => { alive = false }
  }, [])

  const persist = useCallback(async (slug: string): Promise<boolean> => {
    try {
      const r = await post<SourcePrefResponse>("/trading/source-preference", { source: slug })
      userChanged.current = true
      setPref(r.source)
      setNotice(null)
      setLoaded(true)
      return true
    } catch {
      setLoaded(true)
      setNotice("Couldn't save source — keeping your previous selection.")
      return false
    }
  }, [])

  return { pref, loaded, notice, persist }
}