import { useCallback, useEffect, useState } from "react"
import { Badge, Button, Card, Skeleton } from "@/components/ui"
import {
  executeCommandCentreClaim,
  getCommandCentreClaims,
  getCommandCentreOverview,
  setCommandCentreKillSwitch,
  type CommandCentreClaim,
  type CommandCentreGateStatus,
  type CommandCentreMode,
  type CommandCentreOverview
} from "@/lib/api"

/**
 * Command Centre (spec slices 4 + 5) — the surface for the enforcement layer.
 * One component, mounted as the "Command Centre" tab on the trading AND the
 * bandwidth suite details (the `stream` prop filters which rows load).
 *
 * Honesty contract:
 *   • every cell renders what the server observed — a "not-wired" / "not-decided"
 *     state is rendered as that state, never as an OK
 *   • toggling a kill switch POSTs to the same store the sidecar gate reads;
 *     the panel re-renders from the response + a fresh overview, so a kill
 *     shown on a card IS a kill the enforcement layer will act on
 *   • the global kill switch header dominates every site card
 *   • approving a payout claim (slice 5, bandwidth stream only) is a FRESH
 *     per-action human consent — the panel relays it to /command-centre/execute,
 *     which runs the full gate chain BEFORE the venue step, and renders the
 *     honest outcome (executed / failed / blocked) back on the card
 */
export function CommandCentrePanel({ stream }: { stream: "trading" | "bandwidth" }) {
  const [overview, setOverview] = useState<CommandCentreOverview | null>(null)
  const [claims, setClaims] = useState<CommandCentreClaim[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [claimWorkflowId, setClaimWorkflowId] = useState("")
  const [claiming, setClaiming] = useState<string | null>(null)
  const [claimResult, setClaimResult] = useState<{ platform: string; ok: boolean; text: string } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getCommandCentreOverview(stream)
      if (!res.ok) throw new Error("overview reported not ok")
      setOverview(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : "command centre failed")
    }
    setLoading(false)
  }, [stream])

  const refreshClaims = useCallback(async () => {
    try {
      const res = await getCommandCentreClaims()
      if (res.ok) setClaims(res.claims)
    } catch {
      // claims refresh is best-effort — the overview is the primary surface
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void refreshClaims() }, [refreshClaims])

  // A claim executes ONLY after this fresh per-action approval; the workflow id
  // names which saved workflow (in the Workflows app) performs the venue step.
  const approveClaim = useCallback(
    async (claim: CommandCentreClaim) => {
      setClaiming(claim.platform)
      setClaimResult(null)
      try {
        const res = await executeCommandCentreClaim({
          platform: claim.platform,
          balance: claim.balance,
          threshold: claim.payoutThreshold,
          ref: claim.ref,
          claimWorkflowId
        })
        if (res.ok) {
          setClaimResult({ platform: claim.platform, ok: true, text: "approved — claim executed (audit: execution:executed)" })
        } else if (res.execution?.status === "failed") {
          setClaimResult({
            platform: claim.platform,
            ok: false,
            text: `gate passed but the venue step failed: ${res.execution.error ?? "unknown"}`
          })
        } else {
          setClaimResult({
            platform: claim.platform,
            ok: false,
            text: `blocked before the venue: ${res.gate.blockedBy ?? "unknown gate"}`
          })
        }
        await refreshClaims()
        await refresh()
      } catch (e) {
        setClaimResult({ platform: claim.platform, ok: false, text: e instanceof Error ? e.message : "claim failed" })
      }
      setClaiming(null)
    },
    [claimWorkflowId, refresh, refreshClaims]
  )

  const toggleKill = useCallback(
    async (scope: string, kill: boolean) => {
      setError(null)
      try {
        await setCommandCentreKillSwitch(scope, kill)
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "kill-switch update failed")
      }
    },
    [refresh]
  )

  const killed = overview?.killSwitch
  const globalKill = killed?.global === true

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          Command Centre <span className="muted small">· {stream}</span>
        </div>
        <div className="row gap" style={{ alignItems: "center" }}>
          <span className="muted small">Global kill switch</span>
          <button
            type="button"
            className="toggle"
            aria-label="global kill switch"
            aria-pressed={globalKill}
            onClick={() => toggleKill("global", !globalKill)}
          >
            <span className="toggle-knob" />
          </button>
          <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "3px 10px" }}>
            {loading ? "..." : "Refresh"}
          </Button>
        </div>
      </div>

      {error ? (
        <div style={{ fontSize: 11, color: "#ff6b6b" }}>{error}</div>
      ) : !overview ? (
        <div aria-busy="true" className="skeleton-row">
          <Skeleton width="60%" />
          <Skeleton width="85%" />
          <Skeleton width="45%" />
        </div>
      ) : (
        <>
          {globalKill && (
            <div style={{ fontSize: 11, color: "#ff6b6b", marginBottom: 8 }}>
              GLOBAL KILL ACTIVE — every site below is BLOCKED until the human rearms
            </div>
          )}
          {overview.sites.map((site) => (
            <SiteCard key={site.site} site={site} globalKill={globalKill} onToggleKill={toggleKill} />
          ))}
          {stream === "bandwidth" && (
            <ClaimsBlock
              claims={claims}
              claiming={claiming}
              claimResult={claimResult}
              claimWorkflowId={claimWorkflowId}
              onWorkflowIdChange={setClaimWorkflowId}
              onApprove={approveClaim}
            />
          )}
        </>
      )}
    </Card>
  )
}

const MODE_TONE: Record<CommandCentreMode, "danger" | "warn" | "accent" | "muted" | "success"> = {
  BLOCKED: "danger",
  HOLD: "warn",
  COPILOT: "accent",
  AUTOPILOT_DEMO: "muted",
  AUTOPILOT: "success"
}

const GATE_TONE: Record<CommandCentreGateStatus, "success" | "danger" | "warn" | "accent" | "muted"> = {
  pass: "success",
  block: "danger",
  restricted: "warn",
  "mechanism-on": "accent",
  "not-wired": "muted",
  "not-decided": "muted"
}

function SiteCard({
  site,
  globalKill,
  onToggleKill
}: {
  site: CommandCentreOverview["sites"][number]
  globalKill: boolean
  onToggleKill: (scope: string, kill: boolean) => void
}) {
  const siteKill = site.inputs.killSwitch === true
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{site.site}</span>
          <span className="muted small" style={{ marginLeft: 6 }}>{site.venue}</span>
          <Badge tone={MODE_TONE[site.mode]}>{site.mode}</Badge>
          <span className="muted small" style={{ marginLeft: 6 }}>{site.executionPower}</span>
        </div>
        <div className="row gap" style={{ alignItems: "center" }}>
          {site.metrics.source !== "observed" ? (
            <span className="muted small" title={site.metrics.note}>{site.metrics.source}</span>
          ) : (
            <span className="muted small" title={site.metrics.observedAt}>
              observed{site.metrics.stale ? " · stale" : ""}
            </span>
          )}
          <span className="muted small">kill</span>
          <button
            type="button"
            className="toggle"
            aria-label={`kill switch ${site.site}`}
            aria-pressed={siteKill}
            onClick={() => onToggleKill(site.site, !siteKill)}
          >
            <span className="toggle-knob" />
          </button>
          {globalKill && <span className="muted small">(global)</span>}
        </div>
      </div>

      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {site.reasons.slice(0, 4).map((r) => (
          <div key={r}>· {r}</div>
        ))}
      </div>

      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        <div>Opt-in: {site.inputs.optIn.status}</div>
        <div>Workability: {site.inputs.workability.value === null ? "not-wired" : site.inputs.workability.value.toFixed(3)}</div>
        <div>Deliberation: {typeof site.inputs.deliberation === "string" ? site.inputs.deliberation : "converged"}</div>
      </div>

      <div className="row gap" style={{ flexWrap: "wrap", marginTop: 6 }}>
        {site.gates.map((g) => (
          <span key={g.gate} title={`${g.gate}: ${g.note}`} style={{ cursor: "help", textTransform: "none" }}>
            <Badge tone={GATE_TONE[g.status]}>{g.gate}</Badge>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Slice 5 — the bandwidth payout-claim surface. Lists the scheduler's
 * payout_ready observations (reported from automator status, not invented) with
 * an honest claimed/ready badge from the durable audit trail. A READY claim is
 * executed only on a FRESH human approval (the button) — approval runs the full
 * 10-gate chain server-side BEFORE the venue step, and the outcome renders back.
 */
function ClaimsBlock({
  claims,
  claiming,
  claimResult,
  claimWorkflowId,
  onWorkflowIdChange,
  onApprove
}: {
  claims: CommandCentreClaim[] | null
  claiming: string | null
  claimResult: { platform: string; ok: boolean; text: string } | null
  claimWorkflowId: string
  onWorkflowIdChange: (id: string) => void
  onApprove: (claim: CommandCentreClaim) => void
}) {
  const ready = claims?.filter((c) => c.status === "ready") ?? []
  const done = claims?.filter((c) => c.status === "claimed") ?? []
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        Payout claims (bandwidth) <span className="muted small">· scheduler-observed, claim by fresh human approval</span>
      </div>

      {!claims ? (
        <div className="muted small">loading claims…</div>
      ) : ready.length === 0 && done.length === 0 ? (
        <div className="muted small">no payout_ready observations yet — nothing to claim, nothing asserted</div>
      ) : (
        <>
          {ready.map((c) => (
            <div
              key={c.idempotencyKey}
              style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4, fontSize: 11 }}
            >
              <Badge>ready</Badge>
              <span style={{ fontWeight: 600 }}>{c.platform}</span>
              <span className="muted small">
                balance {c.balance} ≥ {c.payoutThreshold} threshold · ref {c.ref}
              </span>
              <input
                aria-label={`claim workflow id for ${c.platform}`}
                placeholder="claim workflow id"
                value={claimWorkflowId}
                onChange={(e) => onWorkflowIdChange(e.target.value)}
                style={{ width: 140, fontSize: 11, padding: "2px 6px" }}
              />
              <Button
                variant="primary"
                disabled={claiming === c.platform || !claimWorkflowId.trim()}
                onClick={() => onApprove(c)}
                aria-label={`approve and claim ${c.platform}`}
                style={{ fontSize: 10, padding: "3px 10px" }}
              >
                {claiming === c.platform ? "approving…" : "Approve & claim"}
              </Button>
            </div>
          ))}
          {done.map((c) => (
            <div
              key={c.idempotencyKey}
              style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4, fontSize: 11 }}
            >
              <Badge tone="muted">claimed</Badge>
              <span style={{ fontWeight: 600 }}>{c.platform}</span>
              <span className="muted small">
                balance {c.balance} · ref {c.ref} — already executed (durable audit trail)
              </span>
            </div>
          ))}
        </>
      )}

      {claimResult && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: claimResult.ok ? "#3f9e65" : "#ff6b6b",
            whiteSpace: "pre-wrap"
          }}
        >
          {claimResult.platform}: {claimResult.text}
        </div>
      )}

      <div className="muted small" style={{ marginTop: 6 }}>
        Approving is fresh per-action consent (recorded as consentBy) — it is NOT an automation opt-in. The claim runs the full
        gate rail server-side before any venue step; a blocked or failed claim is reported here exactly as observed.
      </div>
    </div>
  )
}