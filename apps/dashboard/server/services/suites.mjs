/**
 * Website category → PICC suite registry (server authority).
 *
 * A "suite" is the set of PICC capabilities auto-applied for a category of
 * sites. The trading suite is the flagship: it injects a live decision HUD
 * overlay into the page and powers the content-window + dashboard trading
 * panels. Every other recognized category gets the lighter content-window
 * suite (site info + related income apps + quick actions); the bandwidth
 * suite additionally mounts the automator + connector panels. The registry
 * stays open so future connectors (DePIN node health, P2P loan tracking, …)
 * can attach per-category capabilities.
 */
export const SUITES = {
  trading: {
    id: "trading",
    label: "Trading",
    icon: "📈",
    // The trading suite injects the live decision HUD into the browsed page.
    overlay: true,
    hud: true,
    features: ["markets", "decisions", "autopilot", "ledger", "payouts"]
  },
  bandwidth: {
    id: "bandwidth",
    label: "Bandwidth",
    icon: "🌐",
    overlay: false,
    hud: false,
    features: ["automator", "connectors"]
  },
  depin: {
    id: "depin",
    label: "DePIN",
    icon: "🛰️",
    overlay: false,
    hud: false,
    features: []
  },
  nft: {
    id: "nft",
    label: "NFT & Royalties",
    icon: "🎨",
    overlay: false,
    hud: false,
    features: []
  },
  defi: {
    id: "defi",
    label: "DeFi & Yield",
    icon: "💧",
    overlay: false,
    hud: false,
    features: []
  },
  crypto: {
    id: "crypto",
    label: "Crypto & Staking",
    icon: "₿",
    overlay: false,
    hud: false,
    features: []
  },
  p2p: {
    id: "p2p",
    label: "P2P Lending",
    icon: "🤝",
    overlay: false,
    hud: false,
    features: []
  },
  agent: {
    id: "agent",
    label: "AI Agent",
    icon: "🤖",
    overlay: false,
    hud: false,
    features: []
  },
  other: {
    id: "other",
    label: "Site",
    icon: "🧭",
    overlay: false,
    hud: false,
    features: []
  }
}

/** Resolve the suite for a detected site (falls back to the generic site suite). */
export function suiteForSite(site) {
  const category = site?.category
  if (category && Object.hasOwn(SUITES, category)) return SUITES[category]
  return SUITES.other
}
