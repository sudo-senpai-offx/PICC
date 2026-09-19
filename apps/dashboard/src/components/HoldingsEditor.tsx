import { useCallback, useEffect, useState } from "react"
import { Badge, Button, Field, Input, Select } from "@/components/ui"
import { appendData, listData, removeData, type DataRow } from "@/lib/localdata"

// REQ-C (PICC_INCOME_GENERALIZATION): the holdings tables (nft_holdings,
// depin_nodes) are surfaced through the same server-backed CRUD as everything
// else — this editor is the write side of that view. Honest by construction:
// absent numerics render as "—", never fabricated zeros.

const BLOCKCHAINS = ["Ethereum", "Solana", "Polygon"]
const NODE_TYPES = ["bandwidth", "storage", "compute", "environmental", "energy"]
const DEPIN_PLATFORMS = [
  "DeNet",
  "Silencio",
  "COIN",
  "GridLink",
  "OpenLoop",
  "Hivello",
  "ProjectSolarMining"
]
const NODE_STATUSES = ["active", "offline", "paused", "retired"]

const NUM = (s: string) => (s.trim() === "" ? undefined : Number(s) || 0)

export function HoldingsEditor({ onChange }: { onChange?: () => void }) {
  const [nfts, setNfts] = useState<DataRow[] | null>(null)
  const [depins, setDepins] = useState<DataRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // NFT add form
  const [nft, setNft] = useState({ collection: "", tokenId: "", blockchain: "Ethereum", purchase: "", floor: "" })
  // DePIN add form
  const [depin, setDepin] = useState({ platform: "Silencio", nodeType: "bandwidth", status: "active", daily: "", total: "" })

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [n, d] = await Promise.all([listData<DataRow>("nft_holdings"), listData<DataRow>("depin_nodes")])
      setNfts(n.rows)
      setDepins(d.rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : "holdings load failed")
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const addNft = async () => {
    if (!nft.collection.trim()) return
    setBusy("nft")
    try {
      await appendData("nft_holdings", {
        collection_name: nft.collection.trim(),
        token_id: nft.tokenId.trim() || undefined,
        blockchain: nft.blockchain,
        purchase_price: NUM(nft.purchase),
        current_floor_price: NUM(nft.floor)
      })
      setNft({ collection: "", tokenId: "", blockchain: "Ethereum", purchase: "", floor: "" })
      await refresh()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "nft save failed")
    } finally {
      setBusy(null)
    }
  }

  const addDepin = async () => {
    setBusy("depin")
    try {
      await appendData("depin_nodes", {
        platform: depin.platform,
        node_type: depin.nodeType,
        status: depin.status,
        daily_earnings: NUM(depin.daily),
        total_earnings: NUM(depin.total)
      })
      setDepin({ platform: "Silencio", nodeType: "bandwidth", status: "active", daily: "", total: "" })
      await refresh()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "node save failed")
    } finally {
      setBusy(null)
    }
  }

  const removeRow = async (table: "nft_holdings" | "depin_nodes", id: string) => {
    setBusy(`del-${id}`)
    try {
      await removeData(table, id)
      await refresh()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed")
    } finally {
      setBusy(null)
    }
  }

  const money = (v: unknown) => (v == null || Number(v) === 0 ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

  return (
    <div className="stack" style={{ marginTop: 12 }}>
      {error ? <p className="muted" style={{ color: "var(--danger)" }}>{error}</p> : null}

      <div className="row wrap" style={{ gap: 12 }}>
        {/* NFT holdings */}
        <div className="card" style={{ flex: "1 1 320px" }}>
          <strong>NFT holdings</strong>
          {!nfts ? (
            <p className="muted small">Loading…</p>
          ) : nfts.length === 0 ? (
            <p className="muted small">None recorded.</p>
          ) : (
            <ul className="list" style={{ marginTop: 6 }}>
              {nfts.map((r) => (
                <li key={String(r.id)} className="list-row">
                  <span>
                    <Badge>{String(r.blockchain ?? "—")}</Badge> <strong>{String(r.collection_name ?? "Untitled")}</strong>
                    {r.token_id ? <span className="muted small"> #{String(r.token_id)}</span> : null}
                    <div className="muted small">
                      buy {money(r.purchase_price)} · floor {money(r.current_floor_price)}
                      {r.current_floor_price != null && r.purchase_price != null && Number(r.purchase_price) > 0
                        ? ` · ${((Number(r.current_floor_price) - Number(r.purchase_price)) / Number(r.purchase_price)) * 100 >= 0 ? "+" : ""}${(((Number(r.current_floor_price) - Number(r.purchase_price)) / Number(r.purchase_price)) * 100).toFixed(0)}%`
                        : ""}
                    </div>
                  </span>
                  <Button variant="ghost" disabled={busy === `del-${r.id}`} onClick={() => removeRow("nft_holdings", String(r.id))} style={{ fontSize: 10, padding: "2px 8px", color: "var(--danger)" }}>
                    {busy === `del-${r.id}` ? "…" : "Delete"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="row wrap" style={{ gap: 6, alignItems: "flex-end", marginTop: 8 }}>
            <Field label="Collection" >
              <Input value={nft.collection} onChange={(e) => setNft({ ...nft, collection: e.target.value })} placeholder="e.g. Bored Ape" style={{ minWidth: 120 }} />
            </Field>
            <Field label="Token ID">
              <Input value={nft.tokenId} onChange={(e) => setNft({ ...nft, tokenId: e.target.value })} placeholder="#1" style={{ width: 70 }} />
            </Field>
            <Field label="Chain">
              <Select value={nft.blockchain} onChange={(e) => setNft({ ...nft, blockchain: e.target.value })}>
                {BLOCKCHAINS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
            </Field>
            <Field label="Buy price $">
              <Input type="number" step="0.01" value={nft.purchase} onChange={(e) => setNft({ ...nft, purchase: e.target.value })} placeholder="0.00" style={{ width: 80 }} />
            </Field>
            <Field label="Floor $">
              <Input type="number" step="0.01" value={nft.floor} onChange={(e) => setNft({ ...nft, floor: e.target.value })} placeholder="0.00" style={{ width: 80 }} />
            </Field>
            <Button variant="primary" disabled={busy === "nft" || !nft.collection.trim()} onClick={addNft} style={{ fontSize: 10, padding: "4px 10px" }}>
              Add NFT
            </Button>
          </div>
        </div>

        {/* DePIN nodes */}
        <div className="card" style={{ flex: "1 1 320px" }}>
          <strong>DePIN nodes</strong>
          {!depins ? (
            <p className="muted small">Loading…</p>
          ) : depins.length === 0 ? (
            <p className="muted small">None recorded.</p>
          ) : (
            <ul className="list" style={{ marginTop: 6 }}>
              {depins.map((r) => (
                <li key={String(r.id)} className="list-row">
                  <span>
                    <Badge tone={r.status === "active" ? "success" : r.status === "offline" ? "danger" : "muted"}>{String(r.status ?? "—")}</Badge>{" "}
                    <strong>{String(r.platform ?? "—")}</strong>
                    <span className="muted small"> · {String(r.node_type ?? "—")}</span>
                    <div className="muted small">
                      {money(r.daily_earnings)}/day · {money(r.total_earnings)} total
                      {r.daily_earnings != null && Number(r.daily_earnings) > 0 ? ` · ≈$${(Number(r.daily_earnings) * 30).toFixed(2)}/mo` : ""}
                    </div>
                  </span>
                  <Button variant="ghost" disabled={busy === `del-${r.id}`} onClick={() => removeRow("depin_nodes", String(r.id))} style={{ fontSize: 10, padding: "2px 8px", color: "var(--danger)" }}>
                    {busy === `del-${r.id}` ? "…" : "Delete"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="row wrap" style={{ gap: 6, alignItems: "flex-end", marginTop: 8 }}>
            <Field label="Platform">
              <Select value={depin.platform} onChange={(e) => setDepin({ ...depin, platform: e.target.value })}>
                {DEPIN_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field label="Node type">
              <Select value={depin.nodeType} onChange={(e) => setDepin({ ...depin, nodeType: e.target.value })}>
                {NODE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={depin.status} onChange={(e) => setDepin({ ...depin, status: e.target.value })}>
                {NODE_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Daily $">
              <Input type="number" step="0.0001" value={depin.daily} onChange={(e) => setDepin({ ...depin, daily: e.target.value })} placeholder="0.00" style={{ width: 80 }} />
            </Field>
            <Field label="Total $">
              <Input type="number" step="0.0001" value={depin.total} onChange={(e) => setDepin({ ...depin, total: e.target.value })} placeholder="0.00" style={{ width: 80 }} />
            </Field>
            <Button variant="primary" disabled={busy === "depin"} onClick={addDepin} style={{ fontSize: 10, padding: "4px 10px" }}>
              Add node
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}