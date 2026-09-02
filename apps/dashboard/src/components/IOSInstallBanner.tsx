// T2 / REQ-2 — "Add to Home Screen" guidance, shown ONLY while the shared
// iOS-install hook reports it is needed. Copy is honest by construction: it
// recommends the install step first and never claims push is reachable on a
// sub-16.4 or non-installed iOS PWA.
import { useInstallBanner } from "@/hooks/useInstallBanner"

export function IOSInstallBanner() {
  const needed = useInstallBanner()
  if (!needed) return null
  return (
    <div className="card pad" data-testid="ios-install-banner" style={{ border: "1px solid var(--border)", fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        📲 To get notifications on iOS, install the app first
      </div>
      <div className="muted" style={{ whiteSpace: "pre-line" }}>
        iOS delivers push only from an installed app, on iOS 16.4 or newer.
        Tap <strong>Share → Add to Home Screen</strong>, then open PICC from your Home
        Screen and enable notifications there.
      </div>
    </div>
  )
}