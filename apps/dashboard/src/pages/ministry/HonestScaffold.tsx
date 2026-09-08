import { type SuiteId, suiteMeta } from "@/lib/suites"

export function HonestScaffold({ suiteId, room, slug }: { suiteId: SuiteId; room: string; slug: string }) {
  const meta = suiteMeta(suiteId)
  return (
    <div className="stack">
      <header data-room={slug}>
        <div className="row gap" style={{ alignItems: "center" }}>
          <span style={{ fontSize: 22 }}>{meta?.icon}</span>
          <div>
            <h2>{room}</h2>
            <span className="badge badge-muted">under development</span>
          </div>
        </div>
        <p className="muted small">
          This ministry&apos;s {room.toLowerCase()} surface is under development. No fabricated data —
          configured capabilities will appear here.
        </p>
      </header>
    </div>
  )
}
