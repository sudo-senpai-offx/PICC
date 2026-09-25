import { useEffect, useState } from "react"

/**
 * WS-6 T8 — reduced-motion preference (AC-005, AC-016).
 *
 * Reads `prefers-reduced-motion` and exposes a duration that collapses to 0 when
 * reduction is requested, so a component can honour it without branching on the
 * media query itself.
 *
 * DEPENDENCY DECISION: spec 4.8 deferred the `motion` install to T8. It is NOT
 * installed here, for the same reason TanStack was not installed in T5: D2
 * permits no degradation on the Atom/Snapdragon floor, ARM64 cannot be validated
 * from this host, and every spec 4.5 size figure is a dated third-party estimate
 * that T10 was supposed to replace with measurements. Reduced-motion support is
 * achievable with zero new dependency weight, so it is achieved that way. If a
 * real animation primitive is added later it must be measured first.
 */
export type MotionPreference = {
  prefersReducedMotion: boolean
  /** 0 when reduced motion is requested; otherwise a nominal UI duration. */
  durationMs: number
}

const NOMINAL_DURATION_MS = 160

export function useMotionPreference(): MotionPreference {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    let mql: MediaQueryList
    try {
      mql = window.matchMedia("(prefers-reduced-motion: reduce)")
    } catch {
      return
    }
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setPrefersReducedMotion(e.matches)
    // Safari <14 and some jsdom builds only expose the deprecated API.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    }
    if (typeof mql.addListener === "function") {
      mql.addListener(onChange)
      return () => mql.removeListener(onChange)
    }
    return
  }, [])

  return { prefersReducedMotion, durationMs: prefersReducedMotion ? 0 : NOMINAL_DURATION_MS }
}
