// T2 / REQ-2 — iOS install eligibility, PURE.
//
// 2026 iOS web-push rule set (verified in Decision F): on iOS, web push works
// only from an INSTALLED PWA on iOS 16.4+. So viewers need "Add to Home
// Screen" guidance exactly when:
//   1. the UA is iOS (iPad|iPhone|iPod), AND
//   2. they are not already running standalone, OR the OS is below 16.4.
// Anything else → false: Android/desktop are push-capable without install,
// and a run-standalone 16.4+ iOS PWA already has push. An iOS UA whose OS
// version cannot be parsed returns false (recommendation never fabricates a
// requirement it cannot justify).
export function isIOSInstallNeeded(userAgent: string, isStandalone: boolean): boolean {
  if (!/iPad|iPhone|iPod/.test(userAgent)) return false
  if (!isStandalone) return true
  const m = /OS (\d+)_(\d+)/.exec(userAgent)
  if (!m) return false
  const major = Number(m[1])
  const minor = Number(m[2])
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false
  return major < 16 || (major === 16 && minor < 4)
}