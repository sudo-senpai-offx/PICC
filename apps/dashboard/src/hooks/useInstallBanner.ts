// T2 / REQ-2 — THE single iOS-install opinion in the app (Decision F). Every
// surface (suite card, notification bell) consumes this hook; the pure
// `isIOSInstallNeeded` is called from exactly here and nowhere else, so no
// component can improvise a different eligibility rule.
import { useEffect, useState } from "react"
import { isIOSInstallNeeded } from "@/lib/installEligibility"

/** True when the current browser needs "Add to Home Screen" guidance before
 *  push can work: iOS AND (not standalone OR iOS < 16.4). Observable state —
 *  the standalone flag tracks live display-mode changes. */
export function useInstallBanner(): boolean {
  const [isStandalone, setIsStandalone] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return (
      (navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches
    )
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(display-mode: standalone)")
    const update = () => {
      setIsStandalone(
        (navigator as unknown as { standalone?: boolean }).standalone === true ||
          mq.matches
      )
    }
    update()
    mq.addEventListener?.("change", update)
    return () => mq.removeEventListener?.("change", update)
  }, [])

  return isIOSInstallNeeded(navigator.userAgent, isStandalone)
}