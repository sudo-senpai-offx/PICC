// Shared per-suite studio room (UI-reskin REQ-D.2 + REQ-E.3).
// One wrapper reused by all three ministries: it renders the exact StudioPage
// surface the standalone /studio route uses — no forked logic — so the
// running/connected/feed status shown here is always identical to the
// standalone page. The compact variant is StudioPage's own in-room styling.
import { StudioPage } from "@/pages/StudioPage"

export function StudioRoom() {
  return <StudioPage compact />
}