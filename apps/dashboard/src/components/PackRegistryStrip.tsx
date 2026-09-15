// S5 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md (T5.1–T5.2): the Pack Registry
// strip for the MarketsRoom suite header.
//
// It reflects the server's OBSERVED pack state, nothing else:
//   • polls GET /api/packs/registry (30s — well under the 30/60s read limit)
//     and stamps every render with the registry's own "as of" updatedAt;
//   • a failed fetch renders "registry unreachable" — NEVER cached rows, never
//     fabricated status (spec risk 4 guard);
//   • the status badge is server truth: stopped-at-human is shown as exactly
//     that, with the L-class "needs human: re-login" handoff signal;
//   • the ack button exists ONLY on stopped-at-human steps and POSTs the human
//     handoff — the ONLY legal exit (server records doneBy:"human", re-arms);
//   • the footer renders the §8.5 caps as read-only server env truth with the
//     config note — no settings affordance (T5.2: "no new settings page");
//     live usage is not-observed (never 0%, never fabricated).
import { useCallback, useEffect, useState } from "react"
import { Badge, Button, Card } from "@/components/ui"
import {
  ackPackStep,
  envelopeFactLine,
  getPackRegistry,
  type PackResourceCaps,
  type PackStep,
  type PackStepStatus
} from "@/lib/packRegistry"

const REFRESH_MS = 30_000

const STATUS_TONE: Record<PackStepStatus, "success" | "danger" | "warn" | "muted"> = {
  running: "success",
  "stopped-at-human": "danger",
  "skipped-unconfigured": "warn",
  blocked: "warn",
  idle: "muted"
}

function StepRow({ packId, step, onAck }: {
  packId: string
  step: PackStep
  onAck: (packId: string, stepId: string) => Promise<void>
}) {
  const [acking, setAcking] = useState(false)
  const [ackError, setAckError] = useState<string | null>(null)
  const needsHandoff = step.status === "stopped-at-human"
  // The capture pathway (owner decision 2026-09-15) is a PICC-settings action:
  // it renders on skipped-unconfigured steps too, WITHOUT an ack button — the
  // settings toggle re-arms the step, ack is only for manual-login handoffs.
  const showPathway = Boolean(step.pathway) && (needsHandoff || step.pathway!.need === "capture")

  const ack = useCallback(async () => {
    setAcking(true)
    setAckError(null)
    try {
      await onAck(packId, step.id)
    } catch (e) {
      setAckError(e instanceof Error ? e.message : "ack failed")
    } finally {
      setAcking(false)
    }
  }, [onAck, packId, step.id])

  return (
    <li className="pack-step" data-step={step.id}>
      <div className="pack-step-row">
        <span className="pack-step-name">{step.label}</span>
        <Badge tone={STATUS_TONE[step.status]}>{step.status}</Badge>
        {step.kind === "l-class" && needsHandoff ? (
          <Badge tone="danger">needs human: re-login</Badge>
        ) : null}
      </div>
      <div className="pack-step-facts">
        <span className="muted">{envelopeFactLine(step.envelope)}</span>
        {step.detail ? <span className="pack-step-detail">{step.detail}</span> : null}
      </div>
      {showPathway ? (
        <div className="pack-step-pathway" data-pathway={step.pathway!.need}>
          <p className="pack-pathway-prompt">{step.pathway!.prompt}</p>
          <ol className="pack-pathway-steps">
            {step.pathway!.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      ) : null}
      {needsHandoff ? (
        <div className="pack-step-actions">
          <Button
            variant="primary"
            disabled={acking}
            aria-label={`ack ${step.id}`}
            onClick={() => void ack()}
          >
            {acking ? "acking…" : "I handled it — re-arm"}
          </Button>
          {ackError ? <span className="pack-step-ack-error">{ackError}</span> : null}
        </div>
      ) : null}
    </li>
  )
}

function CapsFooter({ caps }: { caps: PackResourceCaps }) {
  return (
    <div className="pack-caps muted">
      §8.5 budget — RAM {caps.maxRamMb}MB · CPU {caps.maxCpuPct}% · storage {caps.maxStorageMb}MB
      {" "}(config: PICC_RESOURCE_* envs, read-only) — live usage: not-observed
    </div>
  )
}

export function PackRegistryStrip() {
  const [payload, setPayload] = useState<{ registry: import("@/lib/packRegistry").PackRegistry; caps: PackResourceCaps } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const res = await getPackRegistry()
      if (!res.ok) throw new Error("registry reported not ok")
      setPayload({ registry: res.registry, caps: res.caps })
    } catch (e) {
      setPayload(null)
      setError(e instanceof Error ? e.message : "registry unreachable")
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  // The human handoff: POST the ack, then re-read from the server so the strip
  // re-renders the re-armed step from the same store the next observation tick
  // acts on (never from the client's own guess).
  const handleAck = useCallback(async (packId: string, stepId: string) => {
    await ackPackStep(packId, stepId)
    void refresh()
  }, [refresh])

  return (
    <Card className="pack-registry-strip">
      <div className="pack-registry-head">
        <span className="pack-registry-title">Pack registry</span>
        {payload ? <span className="muted">as of {payload.registry.updatedAt}</span> : null}
      </div>
      {error ? (
        <div className="pack-registry-unreachable">
          <span className="badge badge-danger">registry unreachable</span>
          <span className="muted"> {error}</span>
        </div>
      ) : null}
      {payload ? (
        <>
          <ul className="pack-steps">
            {payload.registry.packs.flatMap((pack) =>
              pack.steps.map((step) => <StepRow key={step.id} packId={pack.id} step={step} onAck={handleAck} />)
            )}
          </ul>
          <CapsFooter caps={payload.caps} />
        </>
      ) : !error ? (
        <div className="muted">loading…</div>
      ) : null}
    </Card>
  )
}