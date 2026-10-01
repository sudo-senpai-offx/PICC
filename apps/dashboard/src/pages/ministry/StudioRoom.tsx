// Shared per-suite studio room (UI-reskin REQ-D.2 + REQ-E.3).
// One wrapper reused by all three ministries: it renders the exact StudioPage
// surface the standalone /studio route uses — no forked logic — so the
// running/connected/feed status shown here is always identical to the
// standalone page. The compact variant is StudioPage's own in-room styling.
//
// WS-7 T10 (d1Order 12, 16, 21) — the read-only record, for all THREE instances.
//
// `studio` IS ALREADY ONE SURFACE INSTANTIATED THREE TIMES, and this file is the
// proof: `MinistryRoom.tsx:14-16` has pointed every suite at this single
// component since the 2026-09-16 removal decision, so T10 did not have to make it
// shared — only to give it one read-only body rather than three, and one
// completion record per instance rather than one. The suite is read from the route
// so the record's producers are declared per suite, and the three suites
// currently declare the same producer (`/api/browser/status`), which is what makes
// one surface sufficient without any branching here.
//
// The read-only band is rendered ABOVE the studio page and adds no control of its
// own. The studio's own open/close affordances are pre-existing and are recorded
// per instance in `readOnlyRoomCompletions.ts` rather than removed.
import { useParams } from "react-router-dom"
import { StudioPage } from "@/pages/StudioPage"
import { ReadOnlyRoom } from "@/terminal/routes/ReadOnlyRoom"
import { useReadOnlyView } from "./useReadOnlyView"
import type { ReadOnlySuiteId } from "@/terminal/domain/readOnlyRooms"

const VALID_SUITES = new Set<string>(["trading", "earnings", "intelligence"])

export function StudioRoom() {
  const { suiteId: raw } = useParams<{ suiteId: string }>()
  const suite: ReadOnlySuiteId = VALID_SUITES.has(raw ?? "") ? (raw as ReadOnlySuiteId) : "trading"
  const { view } = useReadOnlyView("studio", suite)
  return (
    <>
      <ReadOnlyRoom view={view} />
      <StudioPage compact />
    </>
  )
}