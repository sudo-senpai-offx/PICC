import { Badge } from "@/components/ui"
import type { StudioAuthState } from "@/lib/api"

/**
 * Sign-in state badge for one studio tab. Renders what PICC detected from the
 * page (DOM signals, cookies, sign-in URL markers) with a hover detail of the
 * method, confidence, and — when available — the account model read straight
 * from the content window (guest vs active, wallet, signed-in identity).
 */
export function LoginBadge({ auth, compact = false }: { auth: StudioAuthState | null | undefined; compact?: boolean }) {
  if (!auth || auth.loggedIn == null) {
    return (
      <span title={auth ? `no session signal · ${auth.detail}` : "no session signal yet"}>
        <Badge tone="muted">{compact ? "·" : "session unknown"}</Badge>
      </span>
    )
  }
  const marker = auth.confidence === "high" ? "" : auth.confidence === "medium" ? "?" : "??"
  const acc = auth.account
  let label: string
  if (acc?.type === "active") {
    label = acc.wallet ? `signed in · ${acc.wallet} wallet${marker}` : `signed in${marker}`
  } else if (acc?.type === "guest") {
    label = compact ? "○" : `guest${marker}`
  } else {
    label = auth.loggedIn ? `signed in${marker}` : `signed out${marker}`
  }
  const parts = [`${auth.method} · ${auth.detail} · ${auth.confidence} confidence`]
  if (acc?.type) {
    if (acc.name) parts.push(`name: ${acc.name}`)
    if (acc.email) parts.push(`email: ${acc.email}`)
    if (acc.wallet) parts.push(`wallet: ${acc.wallet}`)
    if (acc.balance) parts.push(`balance: ${acc.balance}`)
  }
  const tone = acc?.type === "guest" ? "danger" : auth.loggedIn ? "success" : auth.confidence === "high" ? "danger" : "warn"
  return (
    <span title={parts.join(" · ")}>
      <Badge tone={tone}>{compact ? (auth.loggedIn ? "●" : "○") : label}</Badge>
    </span>
  )
}
