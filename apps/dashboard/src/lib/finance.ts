// Local-first portfolio data layer: holdings and net-worth snapshots persisted
// in localStorage for the self-hosted single user.
import type { Holding, NetWorthSnapshot } from "./types"

const K_HOLDINGS = "picc.finance.holdings"
const K_SNAPSHOTS = "picc.finance.snapshots"

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function getHoldings(): Holding[] {
  return read<Holding[]>(K_HOLDINGS, [])
}

export function getSnapshots(): NetWorthSnapshot[] {
  return read<NetWorthSnapshot[]>(K_SNAPSHOTS, [])
}
