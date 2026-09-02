// T7 / REQ-8 — in-app live window countdown. The Signal Engine's PRE_TRADE
// alert opens a trade window (leadMinutes from dispatch, windowMinutes long);
// this chip tells the user how much window time is LEFT, in mm:ss, ticking once
// per second. Honesty contract: every number is OBSERVED — the window close is
// computed from the engine's per-asset `since` (server authority, /api/signals/status)
// plus the SAME prefs feed (leadMinutes/windowMinutes) that the push dispatch
// used when it opened the window. Anything missing → no countdown, never a guess.
import { useEffect, useState } from "react"
import { request } from "@/lib/api"

export interface EngineStatusLike {
  states?: Record<string, { phase: string; since?: number }>
}
export interface PrefsLike {
  leadMinutes?: number
  windowMinutes?: number
}

/** Poll cadence — mirrors the engine's CHECK_INTERVAL so the chip re-hides as
 *  soon as the engine clears the window (expired / level-reached). */
const POLL_MS = 30_000

/**
 * PURE window math. Returns the absolute window-close timestamp for an alerted
 * asset, or null when any input is missing/foreign. The countdown NEVER renders
 * from a fabricated clock.
 */
export function windowEndAtForAsset(
  engine: EngineStatusLike | null | undefined,
  assetId: string | null | undefined,
  prefs: PrefsLike | null | undefined
): number | null {
  if (!engine?.states || !assetId || !prefs) return null
  const st = engine.states[assetId]
  if (!st || st.phase !== "alerted" || typeof st.since !== "number") return null
  const lead = Number(prefs.leadMinutes)
  const win = Number(prefs.windowMinutes)
  if (!Number.isFinite(lead) || !Number.isFinite(win)) return null
  return st.since + (lead + win) * 60_000
}

/** Presentational mm:ss ticker. `windowEndAt` null → renders nothing. */
export function CountdownChip({ windowEndAt, assetId }: { windowEndAt: number | null; assetId?: string }) {
  const [remainingSec, setRemainingSec] = useState<number | null>(() =>
    windowEndAt == null ? null : Math.max(0, Math.ceil((windowEndAt - Date.now()) / 1000))
  )

  useEffect(() => {
    if (windowEndAt == null) {
      setRemainingSec(null)
      return
    }
    let timer: ReturnType<typeof setInterval> | null = null
    const tick = () => {
      const sec = Math.max(0, Math.ceil((windowEndAt - Date.now()) / 1000))
      setRemainingSec(sec)
      // Stop at 00:00 — the countdown never runs negative.
      if (sec === 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
    tick()
    timer = setInterval(tick, 1000)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [windowEndAt])

  if (remainingSec == null) return null
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0")
  const ss = String(remainingSec % 60).padStart(2, "0")
  return (
    <span
      className="badge"
      data-testid="window-countdown"
      title={`${assetId ?? "Trade window"} closes in ${mm}:${ss} — the window is advisory, you act on your platform`}
    >
      ⏱ {assetId ? `${assetId} · ` : ""}
      {mm}:{ss}
    </span>
  )
}

/** Wired suite surface: observes the engine + prefs feeds and renders the chip
 *  only while the in-scope asset is inside a window. */
export function SignalWindowChip({ assetId }: { assetId: string | null | undefined }) {
  const [engine, setEngine] = useState<EngineStatusLike | null>(null)
  const [prefs, setPrefs] = useState<PrefsLike | null>(null)

  useEffect(() => {
    let alive = true
    const loadPrefs = () => {
      request<{ ok: boolean; prefs: PrefsLike }>("/notifications/status")
        .then((r) => { if (alive && r?.prefs) setPrefs(r.prefs) })
        .catch(() => {})
    }
    const loadEngine = () => {
      request<EngineStatusLike>("/signals/status")
        .then((r) => { if (alive && r?.states) setEngine(r) })
        .catch(() => {})
    }
    void loadPrefs()
    void loadEngine()
    const id = setInterval(loadEngine, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const windowEndAt = windowEndAtForAsset(engine, assetId, prefs)
  return <CountdownChip windowEndAt={windowEndAt} assetId={assetId ?? undefined} />
}