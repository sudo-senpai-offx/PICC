import { useEffect, useRef, useState } from "react"
import { Badge, Button, Card, Input, Select } from "@/components/ui"
import { openPaperTrade, getWatchlistQuotes } from "@/lib/trading"

interface TradeOrderFormProps {
  prefill?: {
    symbol?: string
    side?: "up" | "down"
    amount?: number
    expiry?: number
  }
  onPlaced?: () => void
}

const QUICK_AMOUNTS = [1, 5, 10, 25, 50]
const EXPIRY_OPTIONS = [
  { label: "60s", value: 60 },
  { label: "120s", value: 120 },
  { label: "300s (5m)", value: 300 },
  { label: "900s (15m)", value: 900 }
]

export function TradeOrderForm({ prefill, onPlaced }: TradeOrderFormProps) {
  const [symbol, setSymbol] = useState(prefill?.symbol ?? "EURUSD")
  const [side, setSide] = useState<"up" | "down">(prefill?.side ?? "up")
  const [amount, setAmount] = useState(String(prefill?.amount ?? 10))
  const [expiry, setExpiry] = useState(String(prefill?.expiry ?? 60))
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [entryPrice, setEntryPrice] = useState("")
  const entryTouchedRef = useRef(false)

  // Best-effort prefill of the paper entry price from the watchlist quotes.
  useEffect(() => {
    let alive = true
    getWatchlistQuotes()
      .then((res) => {
        if (!alive) return
        const q = res.symbols?.find((s) => s.symbol === symbol)
        if (q && typeof q.last === "number" && q.last > 0 && !entryTouchedRef.current) {
          setEntryPrice(String(q.last))
        }
      })
      .catch(() => { /* prefill is optional */ })
    return () => { alive = false }
  }, [symbol])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setResult(null)
    const amt = Number(amount)
    try {
      // Paper-only order path: PICC is advisory — broker execution (demo or
      // real) was deliberately removed, so the form never offers it.
      const entry = Number(entryPrice)
      if (!Number.isFinite(entry) || entry <= 0) {
        setResult({ ok: false, message: "Paper trades need an entry price above 0." })
        return
      }
      const res = await openPaperTrade({ symbol, side, entry, amount: amt })
      setResult({ ok: true, message: `Paper (simulated) trade opened: ${res.position?.symbol ?? symbol} ${side} $${amt} @ ${entry}` })
      onPlaced?.()
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Trade failed" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="pad">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <strong>Quick Paper Trade</strong>
        <Badge tone="muted">simulated · advisory-only</Badge>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label" style={{ fontSize: 11 }}>Asset</span>
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="EURUSD"
              style={{ fontSize: 12 }}
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label" style={{ fontSize: 11 }}>Expiry</span>
            <Select value={expiry} onChange={(e) => setExpiry(e.target.value)} style={{ fontSize: 12 }}>
              {EXPIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label" style={{ fontSize: 11 }}>Amount ($)</span>
            <Input
              type="number"
              min={1}
              max={1000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ fontSize: 12 }}
            />
          </label>
          <div>
            <span className="field-label" style={{ fontSize: 11, display: "block", marginBottom: 2 }}>Quick $</span>
            <div style={{ display: "flex", gap: 4 }}>
              {QUICK_AMOUNTS.map((a) => (
                <Button
                  key={a}
                  type="button"
                  variant={Number(amount) === a ? "primary" : "ghost"}
                  onClick={() => setAmount(String(a))}
                  style={{ padding: "2px 6px", fontSize: 11, flex: 1 }}
                >
                  ${a}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <label className="field" style={{ margin: 0 }}>
          <span className="field-label" style={{ fontSize: 11 }}>Entry Price</span>
          <Input
            type="number"
            step="any"
            min={0}
            value={entryPrice}
            onChange={(e) => { entryTouchedRef.current = true; setEntryPrice(e.target.value) }}
            placeholder="Current market price"
            style={{ fontSize: 12 }}
          />
        </label>

        <div>
          <span className="field-label" style={{ fontSize: 11, display: "block", marginBottom: 2 }}>Direction</span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type="button"
              variant={side === "up" ? "primary" : "ghost"}
              onClick={() => setSide("up")}
              style={{ flex: 1, color: side === "up" ? "var(--success)" : undefined, borderColor: side === "up" ? "var(--success)" : undefined }}
            >
              ▲ CALL (Up)
            </Button>
            <Button
              type="button"
              variant={side === "down" ? "danger" : "ghost"}
              onClick={() => setSide("down")}
              style={{ flex: 1, color: side === "down" ? "var(--danger)" : undefined, borderColor: side === "down" ? "var(--danger)" : undefined }}
            >
              ▼ PUT (Down)
            </Button>
          </div>
        </div>

        <Button type="submit" disabled={loading} style={{ marginTop: 4 }}>
          {loading ? "Placing…" : "Place Paper Trade"}
        </Button>

        {result && (
          <Badge tone={result.ok ? "success" : "danger"}>{result.message}</Badge>
        )}
      </form>
    </Card>
  )
}
