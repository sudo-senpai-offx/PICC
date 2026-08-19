import { useState, useCallback, useEffect } from "react"
import { Card, Button } from "@/components/ui"
import { getWatchlists, createWatchlist, deleteWatchlistApi, addToWatchlistApi, removeFromWatchlistApi, type Watchlist, type WatchlistItem } from "@/lib/trading"

export function WatchlistPanel() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [newName, setNewName] = useState("")
  const [addSymbol, setAddSymbol] = useState("")
  const [, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getWatchlists()
      setWatchlists(res.watchlists)
      if (!activeId && res.watchlists.length) setActiveId(res.watchlists[0].id)
    } catch { /* ignore */ }
    setLoading(false)
  }, [activeId])

  useEffect(() => { refresh() }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await createWatchlist(newName.trim())
    setNewName("")
    refresh()
  }

  const handleDelete = async (id: string) => {
    await deleteWatchlistApi(id)
    if (activeId === id) setActiveId(null)
    refresh()
  }

  const handleAdd = async () => {
    if (!activeId || !addSymbol.trim()) return
    await addToWatchlistApi(activeId, addSymbol.trim().toUpperCase())
    setAddSymbol("")
    refresh()
  }

  const handleRemove = async (sym: string) => {
    if (!activeId) return
    await removeFromWatchlistApi(activeId, sym)
    refresh()
  }

  const active = watchlists.find((w) => w.id === activeId)

  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Watchlists</div>

      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {watchlists.map((w) => (
          <button
            key={w.id}
            onClick={() => setActiveId(w.id)}
            style={{
              padding: "2px 8px", fontSize: 10, border: "none", borderRadius: 3, cursor: "pointer",
              background: activeId === w.id ? "var(--accent)" : "var(--bg)",
              color: activeId === w.id ? "#fff" : "var(--text-muted)"
            }}
          >
            {w.name} ({w.symbols.length})
          </button>
        ))}
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New list..."
          style={{ width: 90, padding: "2px 6px", fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, color: "var(--text)" }}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <Button variant="ghost" onClick={handleCreate} style={{ fontSize: 9, padding: "2px 6px" }}>+</Button>
      </div>

      {active && (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            <input
              value={addSymbol}
              onChange={(e) => setAddSymbol(e.target.value)}
              placeholder="Add symbol..."
              style={{ flex: 1, padding: "3px 6px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button variant="primary" onClick={handleAdd} style={{ fontSize: 10, padding: "3px 10px" }}>Add</Button>
            <Button variant="danger" onClick={() => handleDelete(active.id)} style={{ fontSize: 10, padding: "3px 10px" }}>Delete List</Button>
          </div>

          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "2px 4px" }}>Symbol</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>Last</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>24h%</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>Week%</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>Month%</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}></th>
                </tr>
              </thead>
              <tbody>
                {(active.prices ?? []).map((p: WatchlistItem) => (
                  <tr key={p.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "2px 4px", fontWeight: 600 }}>{p.symbol}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px" }}>{p.last?.toFixed(4)}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px", color: p.change24h >= 0 ? "#4ade80" : "#ff6b6b" }}>
                      {p.change24h >= 0 ? "+" : ""}{p.change24h?.toFixed(2)}%
                    </td>
                    <td style={{ textAlign: "right", padding: "2px 4px", color: p.changeWeek >= 0 ? "#4ade80" : "#ff6b6b" }}>
                      {p.changeWeek >= 0 ? "+" : ""}{p.changeWeek?.toFixed(2)}%
                    </td>
                    <td style={{ textAlign: "right", padding: "2px 4px", color: p.changeMonth >= 0 ? "#4ade80" : "#ff6b6b" }}>
                      {p.changeMonth >= 0 ? "+" : ""}{p.changeMonth?.toFixed(2)}%
                    </td>
                    <td style={{ textAlign: "right", padding: "2px 4px" }}>
                      <button
                        onClick={() => handleRemove(p.symbol)}
                        style={{ fontSize: 9, border: "none", background: "none", cursor: "pointer", color: "#ff6b6b" }}
                        title="Remove"
                      >X</button>
                    </td>
                  </tr>
                ))}
                {(!active.prices || active.prices.length === 0) && (
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: 12, color: "var(--text-muted)" }}>No symbols yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}
