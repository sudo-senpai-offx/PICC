import { useCallback, useEffect, useRef, useState } from "react"
import { Badge, Button, Card, Skeleton, Toggle } from "@/components/ui"
import {
  getCommandCentreOrders,
  getCommandCentreOverview,
  post,
  proposeCommandCentreOrder,
  setCommandCentreKillSwitch,
  verifyCommandCentreOrder,
  type CommandCentreGateStatus,
  type CommandCentreMode,
  type CommandCentreOrder,
  type CommandCentreOverview
} from "@/lib/api"
import { withActionLock } from "@/lib/dangerousActionLock"

/**
 * T5b — the payload-locked re-consent handshake. When the human clicks
 * "Execute via PICC" the panel does NOT post yet: it opens a reconfirm modal
 * that shows the EXACT payload the server must re-hash and field-compare
 * against the durable proposal (D5 spot set — no server-derived fields), with
 * a human review window + a checkbox that is mechanically disabled until the
 * window elapses. Only confirming POSTs { clientOrderId, payload }; the click
 * alone is never consent.
 */
type SpotExecutePayload = {
  exchange: string
  symbol: string
  side: "buy" | "sell"
  amount: number
  price: number
  clientOrderId: string
}

type CommandCentreExecuteResponse = {
  ok: boolean
  consentBy: string
  blockedBeforeVenue?: boolean
  gate: { allow: boolean; blockedBy: string | null; reason?: string | null }
  execution: { status: "executed" | "failed"; idempotencyKey?: string; error?: string } | null
  state: { global: boolean; sites: Record<string, boolean> }
}

/**
 * Command Centre (spec slices 4 + 6) — the surface for the enforcement layer.
 * One component, mounted as the "Command Centre" tab on the trading suite
 * details.
 *
 * Honesty contract:
 *   • every cell renders what the server observed — a "not-wired" / "not-decided"
 *     state is rendered as that state, never as an OK
 *   • toggling a kill switch POSTs to the same store the sidecar gate reads;
 *     the panel re-renders from the response + a fresh overview, so a kill
 *     shown on a card IS a kill the enforcement layer will act on
 *   • the global kill switch header dominates every site card
 *   • slice 6: the CCXT order rail is ONE proposal with TWO carriers —
 *     "Execute via PICC" (carrier A: fresh consent at click, full gate re-run,
 *     then the venue) or "I placed it — verify" (carrier B: the human performs
 *     the venue step, the panel verifies the fill read-only)
 */
export function CommandCentrePanel({ reviewSeconds = 5 }: { reviewSeconds?: number } = {}) {
  const [overview, setOverview] = useState<CommandCentreOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [orders, setOrders] = useState<CommandCentreOrder[] | null>(null)
  const [orderDraft, setOrderDraft] = useState({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: "0.01", price: "1000" })
  const [orderResult, setOrderResult] = useState<{ clientOrderId: string | null; ok: boolean; text: string } | null>(null)
  const [actingClientOrderId, setActingClientOrderId] = useState<string | null>(null)
  const [venueOrderIds, setVenueOrderIds] = useState<Record<string, string>>({})
  const [verifyingClientOrderId, setVerifyingClientOrderId] = useState<string | null>(null)
  const [pendingExecute, setPendingExecute] = useState<{ order: CommandCentreOrder; payload: SpotExecutePayload } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getCommandCentreOverview()
      if (!res.ok) throw new Error("overview reported not ok")
      setOverview(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : "command centre failed")
    }
    setLoading(false)
  }, [])

  const refreshOrders = useCallback(async () => {
    try {
      const res = await getCommandCentreOrders()
      if (res.ok) setOrders(res.orders)
    } catch {
      // orders refresh is best-effort — the overview is the primary surface
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void refreshOrders() }, [refreshOrders])

  // Gate the order proposal: the server runs the FULL 10-gate chain over a
  // clamp-sized, consent-bound proposal and records it durably — NOTHING has
  // been touched on the venue yet. The returned clientOrderId is the identity
  // both carriers act on.
  const proposeOrder = useCallback(async () => {
    setOrderResult(null)
    const amount = Number(orderDraft.amount)
    const price = Number(orderDraft.price)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price <= 0) {
      setOrderResult({ clientOrderId: null, ok: false, text: "amount and price must be finite positive numbers" })
      return
    }
    try {
      const res = await proposeCommandCentreOrder({
        exchange: orderDraft.exchange.trim().toLowerCase(),
        symbol: orderDraft.symbol.trim().toUpperCase(),
        side: orderDraft.side === "sell" ? "sell" : "buy",
        amount,
        price
      })
      if (res.ok) {
        setOrderResult({
          clientOrderId: res.clientOrderId,
          ok: true,
          text: `proposal recorded as ${res.clientOrderId} — ready under ${res.idempotencyKey.length > 8 ? `${res.idempotencyKey.slice(0, 8)}… (5G)` : ""} (${res.order.notionalUsd} within the $10 envelope)`
        })
      } else {
        setOrderResult({
          clientOrderId: null,
          ok: false,
          text: `blocked at the gate: ${res.gate.blockedBy ?? "unknown"} — ${res.gate.reason ?? ""}`
        })
      }
      await refreshOrders()
    } catch (e) {
      setOrderResult({ clientOrderId: null, ok: false, text: e instanceof Error ? e.message : "propose failed" })
    }
  }, [orderDraft, refreshOrders])

  // Carrier A — "Execute via PICC". Opening the modal does NOTHING to the
  // venue: the panel hands the human the exact payload to consent to. Only the
  // modal's confirm POSTs { clientOrderId, payload }; the server re-runs the
  // full gate over fresh observations and compares the hashed payload field by
  // field against the durable proposal before a pass reaches the venue.
  const requestExecute = useCallback((order: CommandCentreOrder) => {
    setOrderResult(null)
    setPendingExecute({
      order,
      payload: {
        exchange: order.exchange,
        symbol: order.symbol,
        side: order.side,
        amount: order.amount,
        price: order.price,
        clientOrderId: order.clientOrderId
      }
    })
  }, [])

  const confirmExecute = useCallback(async () => {
    if (!pendingExecute) return
    const { order, payload } = pendingExecute
    const clientOrderId = order.clientOrderId
    setActingClientOrderId(clientOrderId)
    setOrderResult(null)
    setPendingExecute(null)
    try {
      const res = await withActionLock("command-centre-execute", () =>
        post<CommandCentreExecuteResponse>("/command-centre/orders/execute", { clientOrderId, payload })
      )
      if (res.ok) {
        setOrderResult({ clientOrderId, ok: true, text: "approved — order executed (audit: execution:executed)" })
      } else if (res.execution?.status === "failed") {
        setOrderResult({ clientOrderId, ok: false, text: `gate passed but the venue refused: ${res.execution.error ?? "unknown"}` })
      } else if (res.blockedBeforeVenue) {
        setOrderResult({ clientOrderId, ok: false, text: `refused before the venue: ${res.gate.reason ?? res.gate.blockedBy ?? "unknown"}` })
      } else {
        setOrderResult({ clientOrderId, ok: false, text: `blocked before the venue: ${res.gate.blockedBy ?? "unknown gate"}` })
      }
      await refreshOrders()
      await refresh()
    } catch (e) {
      setOrderResult({ clientOrderId, ok: false, text: e instanceof Error ? e.message : "execute failed" })
    }
    setActingClientOrderId(null)
  }, [pendingExecute, refresh, refreshOrders])

  // Carrier B — "I placed it — verify": the human performed the venue step on
  // the exchange; the fill is verified READ-ONLY and recorded honestly.
  const verifyOrder = useCallback(
    async (clientOrderId: string) => {
      const venueOrderId = (venueOrderIds[clientOrderId] ?? "").trim()
      if (!venueOrderId) return
      setVerifyingClientOrderId(clientOrderId)
      setOrderResult(null)
      try {
        const res = await verifyCommandCentreOrder({ clientOrderId, orderId: venueOrderId })
        setOrderResult({
          clientOrderId,
          ok: res.ok,
          text: res.ok
            ? "fill verified read-only against the venue — recorded (ccxt-verify:filled)"
            : "verification unobserved — the venue did not confirm the fill (never assumed filled)"
        })
        await refreshOrders()
      } catch (e) {
        setOrderResult({ clientOrderId, ok: false, text: e instanceof Error ? e.message : "verify failed" })
      }
      setVerifyingClientOrderId(null)
    },
    [refreshOrders, venueOrderIds]
  )

  const toggleKill = useCallback(
    async (scope: string, kill: boolean) => {
      setError(null)
      try {
        await withActionLock("kill-switch", () => setCommandCentreKillSwitch(scope, kill))
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
          Command Centre
        </div>
        <div className="row gap" style={{ alignItems: "center" }}>
          <span className="muted small">Global kill switch</span>
          <Toggle
            checked={globalKill}
            onChange={(v) => toggleKill("global", v)}
            label="global kill switch"
          />
          <Button variant="primary" onClick={refresh} disabled={loading} style={{ fontSize: 10, padding: "3px 10px" }}>
            {loading ? "..." : "Refresh"}
          </Button>
        </div>
      </div>

      {error ? (
        <div style={{ fontSize: 11, color: "var(--danger)" }}>{error}</div>
      ) : !overview ? (
        <div aria-busy="true" className="skeleton-row">
          <Skeleton width="60%" />
          <Skeleton width="85%" />
          <Skeleton width="45%" />
        </div>
      ) : (
        <>
          {globalKill && (
            <div style={{ fontSize: 11, color: "var(--danger)", marginBottom: 8 }}>
              GLOBAL KILL ACTIVE — every site below is BLOCKED until the human rearms
            </div>
          )}
          {overview.risk && <AggregateRiskStrip risk={overview.risk} />}
          {overview.sites.map((site) => (
            <SiteCard key={site.site} site={site} globalKill={globalKill} onToggleKill={toggleKill} />
          ))}
          <OrdersBlock
            orders={orders}
            draft={orderDraft}
            onDraftChange={setOrderDraft}
            orderResult={orderResult}
            actingClientOrderId={actingClientOrderId}
            verifyingClientOrderId={verifyingClientOrderId}
            venueOrderIds={venueOrderIds}
            onVenueOrderIdChange={(clientOrderId, id) =>
              setVenueOrderIds((prev) => ({ ...prev, [clientOrderId]: id }))
            }
            onPropose={proposeOrder}
            onExecute={requestExecute}
            onVerify={verifyOrder}
          />
        </>
      )}

      <ReconfirmModal
        open={pendingExecute !== null}
        title="Confirm this EXACT execution payload"
        subtitle="Nothing has touched the venue yet. The server will re-hash this payload and compare every field against the durable proposal consent before any venue touch."
        fields={pendingExecute
          ? [
              { label: "exchange", value: pendingExecute.payload.exchange },
              { label: "symbol", value: pendingExecute.payload.symbol },
              { label: "side", value: pendingExecute.payload.side },
              { label: "amount", value: String(pendingExecute.payload.amount) },
              { label: "price", value: String(pendingExecute.payload.price) },
              { label: "clientOrderId", value: pendingExecute.payload.clientOrderId }
            ]
          : []}
        rationale={pendingExecute?.order.rationale}
        consentBy={pendingExecute?.order.proposedBy}
        reviewSeconds={reviewSeconds}
        onCancel={() => setPendingExecute(null)}
        onConfirm={() => void confirmExecute()}
      />
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
          <Toggle
            checked={siteKill}
            onChange={(v) => onToggleKill(site.site, v)}
            label={`kill switch ${site.site}`}
          />
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

function AggregateRiskStrip({ risk }: { risk: NonNullable<CommandCentreOverview["risk"]> }) {
  const cells = [
    risk.dayLossPct === null ? "day loss n/a" : `day loss ${risk.dayLossPct}%`,
    risk.drawdownFromPeakPct === null ? "drawdown n/a" : `drawdown ${risk.drawdownFromPeakPct}%`,
    risk.portfolioHeatUsd === null ? "heat n/a" : `heat $${risk.portfolioHeatUsd}`,
    risk.halted ? `halted: ${risk.halted.trip}` : "not halted"
  ]
  const note =
    risk.reason ??
    (risk.unobservable.length > 0
      ? `unobservable: ${risk.unobservable.map((u) => `${u.venue} (${u.reason})`).join(", ")}`
      : null)
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, padding: "6px 0", borderTop: "1px solid var(--border)", alignItems: "center" }}
      aria-label="aggregate risk strip"
    >
      <span style={{ fontWeight: 600 }}>Aggregate risk</span>
      {cells.map((c) => (
        <span key={c} className="muted small" title={note ?? undefined}>{c}</span>
      ))}
      {note && <span className="muted small" title={note}>{note}</span>}
    </div>
  )
}

const ORDER_STATUS_TONE: Record<CommandCentreOrder["status"], "success" | "danger" | "warn" | "muted" | "accent"> = {
  open: "accent",
  executed: "success",
  failed: "danger",
  "verified-filled": "success",
  "verify-unobserved": "warn"
}

/**
 * Slice 6 — the CCXT order rail (trading stream). ONE proposal, TWO carriers:
 *   carrier A — "Execute via PICC" is a FRESH human approval (this click) that
 *     re-runs the full 10-gate chain server-side over fresh observations; only
 *     a pass reaches the venue (limit-only, $10-envelope, env keys).
 *   carrier B — "I placed it — verify" is the human doing the venue step on
 *     the exchange themselves; the panel verifies the fill READ-ONLY and
 *     records exactly what the venue answered (an unobserved venue is never
 *     reported as filled).
 * The proposal form itself only runs the gate and records the durable proposal
 * — not one order is placed at propose time.
 */
function OrdersBlock({
  orders,
  draft,
  onDraftChange,
  orderResult,
  actingClientOrderId,
  verifyingClientOrderId,
  venueOrderIds,
  onVenueOrderIdChange,
  onPropose,
  onExecute,
  onVerify
}: {
  orders: CommandCentreOrder[] | null
  draft: { exchange: string; symbol: string; side: string; amount: string; price: string }
  onDraftChange: (draft: { exchange: string; symbol: string; side: string; amount: string; price: string }) => void
  orderResult: { clientOrderId: string | null; ok: boolean; text: string } | null
  actingClientOrderId: string | null
  verifyingClientOrderId: string | null
  venueOrderIds: Record<string, string>
  onVenueOrderIdChange: (clientOrderId: string, id: string) => void
  onPropose: () => void
  onExecute: (order: CommandCentreOrder) => void
  onVerify: (clientOrderId: string) => void
}) {
  const open = orders?.filter((o) => o.status === "open") ?? []
  const settled = orders?.filter((o) => o.status !== "open") ?? []
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        CCXT orders (trading) <span className="muted small">· one proposal, two carriers — PICC executes your approved limit, or you place it and verify</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "6px 0", fontSize: 11 }}>
        <span className="muted small">propose (gate-check only — the venue is NOT touched):</span>
        <input
          aria-label="order exchange"
          className="input"
          value={draft.exchange}
          onChange={(e) => onDraftChange({ ...draft, exchange: e.target.value })}
          placeholder="exchange"
          style={{ width: 80, fontSize: 11, padding: "2px 6px" }}
        />
        <input
          aria-label="order symbol"
          className="input"
          value={draft.symbol}
          onChange={(e) => onDraftChange({ ...draft, symbol: e.target.value })}
          placeholder="BTC/USDT"
          style={{ width: 90, fontSize: 11, padding: "2px 6px" }}
        />
        <select
          aria-label="order side"
          className="input"
          value={draft.side}
          onChange={(e) => onDraftChange({ ...draft, side: e.target.value })}
          style={{ fontSize: 11, padding: "2px 4px" }}
        >
          <option value="buy">buy</option>
          <option value="sell">sell</option>
        </select>
        <input
          aria-label="order amount"
          className="input"
          value={draft.amount}
          onChange={(e) => onDraftChange({ ...draft, amount: e.target.value })}
          placeholder="amount"
          style={{ width: 64, fontSize: 11, padding: "2px 6px" }}
        />
        <input
          aria-label="order price"
          className="input"
          value={draft.price}
          onChange={(e) => onDraftChange({ ...draft, price: e.target.value })}
          placeholder="price"
          style={{ width: 64, fontSize: 11, padding: "2px 6px" }}
        />
        <Button variant="primary" onClick={onPropose} aria-label="gate this order" style={{ fontSize: 10, padding: "3px 10px" }}>
          Gate this order
        </Button>
      </div>

      {!orders ? (
        <div className="muted small">loading orders…</div>
      ) : open.length === 0 && settled.length === 0 ? (
        <div className="muted small">no CCXT proposals yet — nothing asserted, nothing touched</div>
      ) : (
        <>
          {open.map((o) => (
            <div
              key={o.clientOrderId}
              style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4, fontSize: 11 }}
            >
              <Badge tone={ORDER_STATUS_TONE[o.status]}>{o.status}</Badge>
              <span style={{ fontWeight: 600 }}>
                {o.side} {o.symbol}
              </span>
              <span className="muted small">
                {o.amount} @ {o.price} · ~${o.notionalUsd}{o.clamped ? " (clamped to envelope)" : ""}
              </span>
              <span className="muted small" title={o.rationale} style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {o.rationale}
              </span>
              <Button
                variant="primary"
                disabled={actingClientOrderId === o.clientOrderId}
                onClick={() => onExecute(o)}
                aria-label={`execute via picc ${o.clientOrderId}`}
                style={{ fontSize: 10, padding: "3px 10px" }}
              >
                {actingClientOrderId === o.clientOrderId ? "executing…" : "Execute via PICC"}
              </Button>
              <span className="muted small">or</span>
              <input
                aria-label={`venue order id for ${o.clientOrderId}`}
                className="input"
                placeholder="venue order id"
                value={venueOrderIds[o.clientOrderId] ?? ""}
                onChange={(e) => onVenueOrderIdChange(o.clientOrderId, e.target.value)}
                style={{ width: 120, fontSize: 11, padding: "2px 6px" }}
              />
              <Button
                variant="ghost"
                disabled={verifyingClientOrderId === o.clientOrderId || !(venueOrderIds[o.clientOrderId] ?? "").trim()}
                onClick={() => onVerify(o.clientOrderId)}
                aria-label={`verify fill ${o.clientOrderId}`}
                style={{ fontSize: 10, padding: "3px 10px" }}
              >
                {verifyingClientOrderId === o.clientOrderId ? "verifying…" : "I placed it — verify"}
              </Button>
            </div>
          ))}
          {settled.map((o) => (
            <div
              key={`${o.clientOrderId}-settled`}
              style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4, fontSize: 11 }}
            >
              <Badge tone={ORDER_STATUS_TONE[o.status]}>{o.status}</Badge>
              <span style={{ fontWeight: 600 }}>
                {o.side} {o.symbol}
              </span>
              <span className="muted small">
                {o.amount} @ {o.price} · ~${o.notionalUsd} · {o.clientOrderId}
              </span>
            </div>
          ))}
        </>
      )}

      {orderResult && (
        <div style={{ marginTop: 6, fontSize: 11, color: orderResult.ok ? "var(--success)" : "var(--danger)", whiteSpace: "pre-wrap" }}>
          {orderResult.ok ? "✓ " : "✗ "}
          {orderResult.text}
        </div>
      )}

      <div className="muted small" style={{ marginTop: 6 }}>
        Executing is fresh per-action consent (recorded as consentBy) — it is NOT an automation opt-in. Either carrier runs the full
        gate rail server-side over fresh observations (wallet + reference price) before anything is placed; orders are LIMIT-only,
        capped to the $10 envelope, and every outcome lands on the audit trail.
      </div>
    </div>
  )
}

/**
 * T5b — the payload re-consent modal shared by the order rail and the perps
 * panel. Mirrors the HumanReviewGate's human-window discipline: the confirm is
 * mechanically impossible while a review window runs AND while the exact-payload
 * checkbox is unchecked. The `extra` slot lets a caller (perps close) lock one
 * editable field — the fresh exit price — into the payload being displayed.
 */
export function ReconfirmModal({
  open,
  title,
  subtitle,
  fields,
  rationale,
  consentBy,
  confirmLabel = "Confirm execution",
  reviewSeconds = 5,
  extra,
  onCancel,
  onConfirm
}: {
  open: boolean
  title: string
  subtitle?: string
  fields: { label: string; value: string }[]
  rationale?: string
  consentBy?: string | null
  confirmLabel?: string
  reviewSeconds?: number
  extra?: React.ReactNode
  onCancel: () => void
  onConfirm: () => void
}) {
  const [secondsLeft, setSecondsLeft] = useState(reviewSeconds)
  const [acknowledged, setAcknowledged] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setSecondsLeft(Math.max(0, reviewSeconds))
    setAcknowledged(false)
    const deadline = Date.now() + Math.max(0, reviewSeconds) * 1000
    timerRef.current = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      if (remaining === 0 && timerRef.current) window.clearInterval(timerRef.current)
      setSecondsLeft(remaining)
    }, 250)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [open, reviewSeconds])

  if (!open) return null
  const ready = secondsLeft <= 0

  return (
    <div className="palette-overlay">
      <div className="palette" role="dialog" aria-modal="true" aria-label={title} style={{ padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        {subtitle && <div className="muted small" style={{ marginBottom: 10 }}>{subtitle}</div>}
        <div style={{ display: "grid", gap: 4, marginBottom: 6 }}>
          {fields.map((f) => (
            <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11 }}>
              <span className="muted small">{f.label}</span>
              <code style={{ fontSize: 11, wordBreak: "break-all", textAlign: "right" }}>{f.value}</code>
            </div>
          ))}
        </div>
        {extra}
        {rationale && (
          <div className="muted small" style={{ marginTop: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6 }}>
            {rationale}
          </div>
        )}
        <div className="muted small" style={{ marginTop: 8 }}>consentBy: {consentBy ?? "unknown"}</div>
        <label className="human-gate-check" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12 }}>
          <input
            type="checkbox"
            aria-label="acknowledge exact payload"
            disabled={!ready}
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>I have reviewed this EXACT payload — this is my per-action consent.</span>
        </label>
        <div aria-live="polite" className="muted small" style={{ marginTop: 6, minHeight: 16 }}>
          {!ready ? <>Review available in {secondsLeft}s — stay in control.</> : "Review complete — you are in control."}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Button variant="ghost" onClick={onCancel} aria-label="cancel execution">
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={!ready || !acknowledged} aria-label={confirmLabel}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}