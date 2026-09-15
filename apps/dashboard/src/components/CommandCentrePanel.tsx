import { useCallback, useEffect, useState } from "react"
import { Badge, Button, Card, Skeleton, Toggle } from "@/components/ui"
import {
  executeCommandCentreOrder,
  getCommandCentreOrders,
  getCommandCentreOverview,
  proposeCommandCentreOrder,
  setCommandCentreKillSwitch,
  verifyCommandCentreOrder,
  type CommandCentreGateStatus,
  type CommandCentreMode,
  type CommandCentreOrder,
  type CommandCentreOverview
} from "@/lib/api"

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
export function CommandCentrePanel() {
  const [overview, setOverview] = useState<CommandCentreOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [orders, setOrders] = useState<CommandCentreOrder[] | null>(null)
  const [orderDraft, setOrderDraft] = useState({ exchange: "binance", symbol: "BTC/USDT", side: "buy", amount: "0.01", price: "1000" })
  const [orderResult, setOrderResult] = useState<{ clientOrderId: string | null; ok: boolean; text: string } | null>(null)
  const [actingClientOrderId, setActingClientOrderId] = useState<string | null>(null)
  const [venueOrderIds, setVenueOrderIds] = useState<Record<string, string>>({})
  const [verifyingClientOrderId, setVerifyingClientOrderId] = useState<string | null>(null)

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

  // Carrier A — "Execute via PICC": this click IS the fresh per-action consent.
  // The server re-runs the FULL gate over FRESH observations and only a pass
  // reaches the venue (limit-only, hard-capped, env keys).
  const executeOrder = useCallback(
    async (clientOrderId: string) => {
      setActingClientOrderId(clientOrderId)
      setOrderResult(null)
      try {
        const res = await executeCommandCentreOrder({ clientOrderId })
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
    },
    [refresh, refreshOrders]
  )

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
            onExecute={executeOrder}
            onVerify={verifyOrder}
          />
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
  onExecute: (clientOrderId: string) => void
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
                onClick={() => onExecute(o.clientOrderId)}
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
        <div style={{ marginTop: 6, fontSize: 11, color: orderResult.ok ? "#3f9e65" : "#ff6b6b", whiteSpace: "pre-wrap" }}>
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