import { useCallback, useEffect, useState } from "react"
import { Badge, Button, Card, Skeleton } from "@/components/ui"
import { post, request, type CommandCentreGateDecision } from "@/lib/api"
import { ReconfirmModal } from "@/components/CommandCentrePanel"

/**
 * Perps Command Centre (spec slice 6b — the perps rail). Renders ONLY what the
 * server recorded: the durable positions the venue manager persists plus the
 * perps proposal ledger. Every venue-touching action is a FRESH human re-consent:
 *   • propose — gate-check only, the venue is NOT touched (POSTs the perps body)
 *   • execute — opens the ReconfirmModal locked to the D5 open field set; only
 *     the confirmation POSTs { clientOrderId, payload }
 *   • close — opens the ReconfirmModal locked to the D5 close field set with the
 *     human's fresh exit price; only the confirmation POSTs { positionId, price,
 *     payload } (reduce-only)
 *   • verify — carrier B, read-only; the human placed the order at the venue and
 *     the panel records exactly what the venue answered
 * The enforcement stays server-side (R5.2: the server re-hashes the payload and
 * field-compares it against the durable proposal). An unobservable venue renders
 * honestly — positions are never fabricated.
 */

interface PerpsPosition {
  id: string
  symbol: string
  side: "long" | "short"
  size: number
  entryPrice: number
  leverage: number
  marginUsd: number
  marginMode: string
  openedAt: string
  openOrderId: string
  source?: string
}

interface PerpsProposal {
  clientOrderId: string
  idempotencyKey: string
  exchange: string
  symbol: string
  side: "buy" | "sell"
  amount: number
  price: number
  notionalUsd: number
  marginUsd: number
  leverage: number
  marginMode: string
  clamped: boolean
  rationale: string
  status: string
  kind: string
  positionId: string | null
  proposedBy: string | null
  proposedAt: string | null
}

interface PerpsSnapshot {
  ok: boolean
  consentBy: string
  reason?: string
  positions: PerpsPosition[]
  reconcile?: { ok: boolean; closedUnobserved?: unknown[] }
  proposals: PerpsProposal[]
  at: string
}

type PerpsOpenPayload = {
  action: "open"
  exchange: string
  symbol: string
  side: "buy" | "sell"
  amount: number
  price: number
  leverage: number
  marginMode: string
  clientOrderId: string
}

type PerpsClosePayload = {
  action: "close"
  exchange: string
  symbol: string
  positionId: string
  price: number
  side: "buy" | "sell"
  amount: number
  leverage: number
}

interface PerpsGateResponse {
  ok: boolean
  consentBy: string
  blockedBeforeVenue?: boolean
  gate: CommandCentreGateDecision
  execution?: { status: "executed" | "failed"; idempotencyKey?: string; error?: string } | null
  state?: { global: boolean; sites: Record<string, boolean> }
}

interface PerpsProposeResponse {
  ok: boolean
  consentBy: string
  gate: CommandCentreGateDecision
  order: { exchange: string; symbol: string; side: "buy" | "sell"; amount: number; price: number; notionalUsd: number; marginUsd: number; leverage: number; marginMode: string; clamped: boolean }
  idempotencyKey: string
  clientOrderId: string
  at: string
}

function getPerpsSnapshot(token?: string): Promise<PerpsSnapshot> {
  return request<PerpsSnapshot>("/command-centre/perps/positions", {}, token)
}

export function PerpsCommandCentre({ reviewSeconds = 5 }: { reviewSeconds?: number } = {}) {
  const [snapshot, setSnapshot] = useState<PerpsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ symbol: "ETH/USDT", side: "buy", amount: "0.5", price: "2400", leverage: "25", marginMode: "isolated" })
  const [perpsResult, setPerpsResult] = useState<{ clientOrderId: string | null; ok: boolean; text: string } | null>(null)
  const [actingClientOrderId, setActingClientOrderId] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [venueOrderIds, setVenueOrderIds] = useState<Record<string, string>>({})
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [pendingExecute, setPendingExecute] = useState<{ proposal: PerpsProposal; payload: PerpsOpenPayload } | null>(null)
  const [pendingClose, setPendingClose] = useState<{ position: PerpsPosition; exitPrice: string } | null>(null)

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await getPerpsSnapshot()
      setSnapshot(res)
    } catch (e) {
      setSnapshot(null)
      setLoadError(e instanceof Error ? e.message : "perps positions failed")
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Propose: gate-check ONLY — the venue is never touched here. The server runs
  // the gate chain and records the durable proposal; the returned clientOrderId
  // is what both carriers act on.
  const propose = useCallback(async () => {
    setPerpsResult(null)
    const amount = Number(draft.amount)
    const price = Number(draft.price)
    const leverage = Number(draft.leverage)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(leverage) || leverage <= 0) {
      setPerpsResult({ clientOrderId: null, ok: false, text: "amount, price and leverage must be finite positive numbers" })
      return
    }
    try {
      const res = await post<PerpsProposeResponse>("/command-centre/perps/propose", {
        exchange: "hyperliquid",
        symbol: draft.symbol.trim().toUpperCase(),
        side: draft.side === "sell" ? "sell" : "buy",
        amount,
        price,
        leverage,
        marginMode: draft.marginMode.trim().toLowerCase()
      })
      if (res.ok) {
        setPerpsResult({
          clientOrderId: res.clientOrderId,
          ok: true,
          text: `proposal recorded as ${res.clientOrderId} — ready under ${res.idempotencyKey.length > 8 ? `${res.idempotencyKey.slice(0, 8)}… (5G)` : res.idempotencyKey}`
        })
      } else {
        setPerpsResult({
          clientOrderId: null,
          ok: false,
          text: `blocked at the gate: ${res.gate.blockedBy ?? "unknown"} — ${res.gate.reason ?? ""}`
        })
      }
      await refresh()
    } catch (e) {
      setPerpsResult({ clientOrderId: null, ok: false, text: e instanceof Error ? e.message : "propose failed" })
    }
  }, [draft, refresh])

  // Carrier A (open) — clicking opens the reconfirm modal; it posts nothing.
  // The payload is the D5 open field set replayed from the durable proposal.
  const requestExecute = useCallback((proposal: PerpsProposal) => {
    setPerpsResult(null)
    setPendingExecute({
      proposal,
      payload: {
        action: "open",
        exchange: proposal.exchange,
        symbol: proposal.symbol,
        side: proposal.side,
        amount: proposal.amount,
        price: proposal.price,
        leverage: proposal.leverage,
        marginMode: proposal.marginMode,
        clientOrderId: proposal.clientOrderId
      }
    })
  }, [])

  const confirmExecute = useCallback(async () => {
    if (!pendingExecute) return
    const { proposal, payload } = pendingExecute
    const clientOrderId = proposal.clientOrderId
    setActingClientOrderId(clientOrderId)
    setPerpsResult(null)
    setPendingExecute(null)
    try {
      const res = await post<PerpsGateResponse>("/command-centre/perps/execute", { clientOrderId, payload })
      if (res.ok) {
        setPerpsResult({ clientOrderId, ok: true, text: "approved — order executed (audit: execution:executed)" })
      } else if (res.execution?.status === "failed") {
        setPerpsResult({ clientOrderId, ok: false, text: `gate passed but the venue refused: ${res.execution.error ?? "unknown"}` })
      } else if (res.blockedBeforeVenue) {
        setPerpsResult({ clientOrderId, ok: false, text: `refused before the venue: ${res.gate.reason ?? res.gate.blockedBy ?? "unknown"}` })
      } else {
        setPerpsResult({ clientOrderId, ok: false, text: `blocked before the venue: ${res.gate.blockedBy ?? "unknown gate"}` })
      }
      await refresh()
    } catch (e) {
      setPerpsResult({ clientOrderId, ok: false, text: e instanceof Error ? e.message : "execute failed" })
    }
    setActingClientOrderId(null)
  }, [pendingExecute, refresh])

  // Close — reduce-only. The human must re-lock the FRESH exit price into the
  // payload before the window even starts; the modal renders it live.
  const exitPriceNum = pendingClose ? Number(pendingClose.exitPrice) : NaN
  const closePayload: PerpsClosePayload | null = pendingClose
    ? {
        action: "close",
        exchange: "hyperliquid",
        symbol: pendingClose.position.symbol,
        positionId: pendingClose.position.id,
        price: exitPriceNum,
        side: pendingClose.position.side === "long" ? "sell" : "buy",
        amount: pendingClose.position.size,
        leverage: pendingClose.position.leverage
      }
    : null

  const requestClose = useCallback((position: PerpsPosition) => {
    setPerpsResult(null)
    setPendingClose({ position, exitPrice: String(position.entryPrice) })
  }, [])

  const confirmClose = useCallback(async () => {
    if (!pendingClose || !closePayload) return
    if (!Number.isFinite(exitPriceNum) || exitPriceNum <= 0) return
    const position = pendingClose.position
    setClosingId(position.id)
    setPerpsResult(null)
    setPendingClose(null)
    try {
      const res = await post<PerpsGateResponse>("/command-centre/perps/close", {
        positionId: position.id,
        price: exitPriceNum,
        payload: closePayload
      })
      if (res.ok) {
        setPerpsResult({ clientOrderId: position.openOrderId, ok: true, text: "position reduced (audit: execution:executed)" })
      } else if (res.execution?.status === "failed") {
        setPerpsResult({ clientOrderId: position.openOrderId, ok: false, text: `gate passed but the venue refused: ${res.execution.error ?? "unknown"}` })
      } else {
        setPerpsResult({ clientOrderId: position.openOrderId, ok: false, text: `blocked before the venue: ${res.gate.blockedBy ?? "unknown gate"}` })
      }
      await refresh()
    } catch (e) {
      setPerpsResult({ clientOrderId: position.openOrderId, ok: false, text: e instanceof Error ? e.message : "close failed" })
    }
    setClosingId(null)
  }, [pendingClose, closePayload, exitPriceNum, refresh])

  // Carrier B — the human placed the order at the venue; verify read-only.
  const verify = useCallback(
    async (proposal: PerpsProposal) => {
      const venueOrderId = (venueOrderIds[proposal.clientOrderId] ?? "").trim()
      if (!venueOrderId) return
      setVerifyingId(proposal.clientOrderId)
      setPerpsResult(null)
      try {
        const res = await post<{ ok: boolean; consentBy: string; kind: string; clientOrderId: string; at: string }>(
          "/command-centre/perps/verify",
          { clientOrderId: proposal.clientOrderId, orderId: venueOrderId }
        )
        setPerpsResult({
          clientOrderId: proposal.clientOrderId,
          ok: res.ok,
          text: res.ok
            ? "fill verified read-only against the venue — recorded (perps-verify:filled)"
            : "verification unobserved — the venue did not confirm the fill (never assumed filled)"
        })
        await refresh()
      } catch (e) {
        setPerpsResult({ clientOrderId: proposal.clientOrderId, ok: false, text: e instanceof Error ? e.message : "verify failed" })
      }
      setVerifyingId(null)
    },
    [refresh, venueOrderIds]
  )

  const openProposals = snapshot?.proposals.filter((p) => p.status === "open") ?? []

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        Perps Command Centre
      </div>

      {loadError ? (
        <div style={{ fontSize: 11, color: "var(--danger)" }}>{loadError}</div>
      ) : !snapshot ? (
        <div aria-busy="true" className="skeleton-row">
          <Skeleton width="70%" />
        </div>
      ) : !snapshot.ok ? (
        // An unobservable venue renders honestly — never positions we do not have.
        <div style={{ fontSize: 11, color: "var(--warn)" }}>
          {snapshot.reason ?? "positions-unobservable — the venue did not answer"}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Positions <span className="muted small">· durable venue positions</span>
          </div>
          {snapshot.positions.length === 0 ? (
            <div className="muted small">no open perps positions</div>
          ) : (
            snapshot.positions.map((p) => (
              <div key={p.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4, fontSize: 11 }}>
                <Badge tone={p.side === "long" ? "accent" : "warn"}>{p.side}</Badge>{" "}
                <span style={{ fontWeight: 600 }}>{p.symbol}</span>
                <span className="muted small">
                  {p.size} @ {p.entryPrice} · lev {p.leverage} {p.marginMode} · margin ${p.marginUsd}
                </span>
                <Button
                  variant="danger"
                  disabled={closingId === p.id}
                  onClick={() => requestClose(p)}
                  aria-label={`close position ${p.id}`}
                  style={{ fontSize: 10, padding: "3px 10px" }}
                >
                  {closingId === p.id ? "closing…" : "Close"}
                </Button>
              </div>
            ))
          )}

          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 12, marginBottom: 4 }}>
            Perps proposals <span className="muted small">· execute is fresh per-action consent</span>
          </div>
          {openProposals.length === 0 ? (
            <div className="muted small">no open perps proposals yet — nothing asserted, nothing touched</div>
          ) : (
            openProposals.map((p) => (
              <div key={p.clientOrderId} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4, fontSize: 11 }}>
                <Badge tone="accent">{p.status}</Badge>{" "}
                <span style={{ fontWeight: 600 }}>
                  {p.kind === "close" ? "close" : p.side} {p.symbol}
                </span>
                <span className="muted small">
                  {p.side} {p.amount} @ {p.price} · ~${p.notionalUsd} margin ${p.marginUsd} @ {p.leverage}x {p.marginMode}
                  {p.clamped ? " (clamped to cap)" : ""}
                </span>
                <Button
                  variant="primary"
                  disabled={actingClientOrderId === p.clientOrderId}
                  onClick={() => requestExecute(p)}
                  aria-label={`execute perps ${p.clientOrderId}`}
                  style={{ fontSize: 10, padding: "3px 10px" }}
                >
                  {actingClientOrderId === p.clientOrderId ? "executing…" : "Execute via PICC"}
                </Button>
                <span className="muted small">or</span>
                <input
                  aria-label={`perps venue order id for ${p.clientOrderId}`}
                  className="input"
                  placeholder="venue order id"
                  value={venueOrderIds[p.clientOrderId] ?? ""}
                  onChange={(e) => setVenueOrderIds((prev) => ({ ...prev, [p.clientOrderId]: e.target.value }))}
                  style={{ width: 120, fontSize: 11, padding: "2px 6px" }}
                />
                <Button
                  variant="ghost"
                  disabled={verifyingId === p.clientOrderId || !(venueOrderIds[p.clientOrderId] ?? "").trim()}
                  onClick={() => void verify(p)}
                  aria-label={`verify perps fill ${p.clientOrderId}`}
                  style={{ fontSize: 10, padding: "3px 10px" }}
                >
                  {verifyingId === p.clientOrderId ? "verifying…" : "I placed it — verify"}
                </Button>
              </div>
            ))
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 12, fontSize: 11 }}>
            <span className="muted small">perps (gate-check only — the venue is NOT touched):</span>
            <input
              aria-label="perps symbol"
              className="input"
              value={draft.symbol}
              onChange={(e) => setDraft({ ...draft, symbol: e.target.value })}
              placeholder="ETH/USDT"
              style={{ width: 90, fontSize: 11, padding: "2px 6px" }}
            />
            <select
              aria-label="perps side"
              className="input"
              value={draft.side}
              onChange={(e) => setDraft({ ...draft, side: e.target.value })}
              style={{ fontSize: 11, padding: "2px 4px" }}
            >
              <option value="buy">buy</option>
              <option value="sell">sell</option>
            </select>
            <input
              aria-label="perps amount"
              className="input"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              placeholder="amount"
              style={{ width: 64, fontSize: 11, padding: "2px 6px" }}
            />
            <input
              aria-label="perps price"
              className="input"
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              placeholder="price"
              style={{ width: 64, fontSize: 11, padding: "2px 6px" }}
            />
            <input
              aria-label="perps leverage"
              className="input"
              value={draft.leverage}
              onChange={(e) => setDraft({ ...draft, leverage: e.target.value })}
              placeholder="leverage"
              style={{ width: 56, fontSize: 11, padding: "2px 6px" }}
            />
            <select
              aria-label="perps margin mode"
              className="input"
              value={draft.marginMode}
              onChange={(e) => setDraft({ ...draft, marginMode: e.target.value })}
              style={{ fontSize: 11, padding: "2px 4px" }}
            >
              <option value="isolated">isolated</option>
              <option value="cross">cross</option>
            </select>
            <Button variant="primary" onClick={() => void propose()} aria-label="gate perps order" style={{ fontSize: 10, padding: "3px 10px" }}>
              Gate this perps order
            </Button>
          </div>
        </>
      )}

      {perpsResult && (
        <div style={{ marginTop: 6, fontSize: 11, color: perpsResult.ok ? "var(--success)" : "var(--danger)", whiteSpace: "pre-wrap" }}>
          {perpsResult.ok ? "✓ " : "✗ "}
          {perpsResult.text}
        </div>
      )}

      {pendingExecute && (
        <ReconfirmModal
          open={true}
          title="Confirm this EXACT perps execution payload"
          subtitle="The server will re-hash this payload and compare every field against the durable proposal consent before any venue touch."
          fields={[
            { label: "action", value: pendingExecute.payload.action },
            { label: "exchange", value: pendingExecute.payload.exchange },
            { label: "symbol", value: pendingExecute.payload.symbol },
            { label: "side", value: pendingExecute.payload.side },
            { label: "amount", value: String(pendingExecute.payload.amount) },
            { label: "price", value: String(pendingExecute.payload.price) },
            { label: "leverage", value: String(pendingExecute.payload.leverage) },
            { label: "marginMode", value: pendingExecute.payload.marginMode },
            { label: "clientOrderId", value: pendingExecute.payload.clientOrderId }
          ]}
          rationale={pendingExecute.proposal.rationale}
          consentBy={pendingExecute.proposal.proposedBy}
          reviewSeconds={reviewSeconds}
          onCancel={() => setPendingExecute(null)}
          onConfirm={() => void confirmExecute()}
        />
      )}

      {pendingClose && closePayload && (
        <ReconfirmModal
          open={true}
          title="Confirm this EXACT perps close payload"
          subtitle="Reduce-only exit — the position closes, margin settles from the fill, and the venue is not touched before your consent."
          fields={[
            { label: "action", value: closePayload.action },
            { label: "exchange", value: closePayload.exchange },
            { label: "symbol", value: closePayload.symbol },
            { label: "positionId", value: closePayload.positionId },
            { label: "price", value: String(closePayload.price) },
            { label: "side", value: closePayload.side },
            { label: "amount", value: String(closePayload.amount) },
            { label: "leverage", value: String(closePayload.leverage) }
          ]}
          consentBy={snapshot?.consentBy ?? null}
          confirmLabel="Confirm close"
          reviewSeconds={reviewSeconds}
          extra={
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, marginTop: 8 }}>
              <span className="muted small">fresh exit price</span>
              <input
                aria-label="perps close price"
                className="input"
                value={pendingClose.exitPrice}
                onChange={(e) => setPendingClose({ ...pendingClose, exitPrice: e.target.value })}
                style={{ width: 110, fontSize: 11, padding: "2px 6px" }}
              />
            </div>
          }
          onCancel={() => setPendingClose(null)}
          onConfirm={() => void confirmClose()}
        />
      )}
    </Card>
  )
}