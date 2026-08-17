export interface SuiteMeta {
  id: string
  label: string
  icon: string
  blurb: string
}

/** Client display metadata for every suite id (server owns feature/overlay flags). */
export const SUITE_META: Record<string, SuiteMeta> = {
  trading: {
    id: "trading",
    label: "Trading",
    icon: "📈",
    blurb: "Prediction, paper ledger, signals, watchlist and the read-only ExpertOption bridge + demo autopilot."
  },
  bandwidth: {
    id: "bandwidth",
    label: "Bandwidth",
    icon: "🌐",
    blurb: "Node health, earnings and the income automator for bandwidth-sharing apps."
  },
  depin: { id: "depin", label: "DePIN", icon: "🛰️", blurb: "DePIN node health and earnings." },
  nft: { id: "nft", label: "NFT & Royalties", icon: "🎨", blurb: "NFT floor price and volume reads." },
  defi: { id: "defi", label: "DeFi & Yield", icon: "💧", blurb: "Supply stables and yield vault tracking." },
  crypto: { id: "crypto", label: "Crypto & Staking", icon: "₿", blurb: "Exchange and staking dashboards." },
  p2p: { id: "p2p", label: "P2P Lending", icon: "🤝", blurb: "Peer-to-peer lending portfolios." },
  agent: { id: "agent", label: "AI Agent", icon: "🤖", blurb: "Agent-economy platforms." },
  other: { id: "other", label: "Site", icon: "🧭", blurb: "PICC site intelligence." }
}

/** Resolve display metadata for a suite id (falls back to a generic site suite). */
export function suiteMeta(id?: string | null): SuiteMeta | null {
  if (id && Object.hasOwn(SUITE_META, id)) return SUITE_META[id]
  return null
}
