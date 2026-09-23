import { useEffect, useState } from "react"
import { Badge, Card } from "@/components/ui"
import {
  getCeremonyOverview,
  type CeremonyClassState,
  type CeremonyGate,
  type CeremonyOverview
} from "@/lib/api"

// Honesty contract: every cell renders what the server reports — a deny gate
// shows its `ceremony:deny:*` reason verbatim, and absent/errored data renders
// "not-wired"; nothing absent ever reads as a pass.
export function UnlockCeremony() {
  const [data, setData] = useState<CeremonyOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getCeremonyOverview()
      .then((res) => {
        if (!alive) return
        if (!res.ok) throw new Error("ceremony readout reported not ok")
        setData(res)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "ceremony readout failed")
      })
    return () => { alive = false }
  }, [])

  let body: React.ReactNode
  const classes = data?.classes
  if (error) {
    body = (
      <div className="muted small" aria-label="ceremony honesty">
        not-wired — ceremony readout unavailable: {error}
      </div>
    )
  } else if (classes && classes.length > 0) {
    body = classes.map((cls) => <ClassCard key={cls.venueClass} cls={cls} />)
  } else if (data) {
    body = (
      <div className="muted small" aria-label="ceremony honesty">
        not-wired — no ceremony classes reported
      </div>
    )
  } else {
    body = <div className="muted small">loading ceremony readout…</div>
  }

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Unlock ceremony</div>
      {body}
    </Card>
  )
}

function ClassCard({ cls }: { cls: CeremonyClassState }) {
  const unlocked = cls.enablement?.unlocked === true
  const hasGates = Array.isArray(cls.gates) && cls.gates.length > 0
  return (
    <div
      aria-label={`ceremony class ${cls.venueClass}`}
      style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{cls.venueClass}</span>
        <Badge tone={unlocked ? "success" : "muted"}>{unlocked ? "unlocked" : "locked"}</Badge>
        {cls.binaryOptions === true && (
          <Badge tone={cls.platformVerification ? "success" : "danger"}>
            {cls.platformVerification ? "platform verified" : "platform unverified"}
          </Badge>
        )}
      </div>

      <div className="row gap" style={{ flexWrap: "wrap", marginTop: 6, fontSize: 11 }}>
        <span className="muted small">
          {cls.spendableResolved == null ? "spendable not-wired" : `spendable ${cls.spendableResolved}`}
        </span>
        <span className="muted small">{scaleCell(cls.scaleResolved)}</span>
        {unlocked && (
          <span className="muted small">· by {cls.enablement?.by ?? "unknown"}</span>
        )}
      </div>

      {cls.platformVerification && (
        <div className="muted small" style={{ marginTop: 4, fontSize: 11 }}>
          platform: {cls.platformVerification.regulator} · payout floor {cls.platformVerification.payoutFloorPct}% · withdrawal{" "}
          {cls.platformVerification.withdrawalTested ? "tested" : "untested"}
        </div>
      )}

      <div style={{ marginTop: 6 }}>
        {hasGates ? (
          cls.gates.map((g) => <GateRow key={g.id} gate={g} />)
        ) : (
          <div className="muted small">gates not-wired</div>
        )}
      </div>
    </div>
  )
}

function scaleCell(scale: number | null): string {
  if (scale == null) return "scale not-wired"
  if (scale >= 500) return "scale 500+ reached"
  return `scale ${scale} (< 500)`
}

function GateRow({ gate }: { gate: CeremonyGate }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11, marginTop: 3 }}>
      <Badge tone={gate.pass ? "success" : "danger"}>{gate.id}</Badge>
      {gate.pass ? (
        <span className="muted small">pass</span>
      ) : (
        <span style={{ color: "var(--danger)" }}>{gate.reason ?? "blocked — no reason recorded"}</span>
      )}
    </div>
  )
}