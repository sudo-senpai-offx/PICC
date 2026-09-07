// Command Centre — L2 Policy Graph + Catalog (PICC_SPEC: Command Centre Web §L2).
//
// "site = template": every income stream is a JSON template declaring its
// specialist agents (roster), typed data-flow edges (topology + purpose),
// bounded deliberation loops and its execution envelope. A new site/venue is a
// new template — no server code (User Story 28).
//
// Shape (validated by policyGraphValidator.mjs):
//   site                 unique site id ("site:posture" space)
//   stream               income stream ("trading")
//   venue                venue class the template targets
//   automationPermission sanctioned | gray | forbidden   (5C, per-site truth)
//   demoOnly             template may only ever run in demo mode
//   roster               ordered agent ids (must exist in AGENT_REGISTRY)
//   edges                {from, to, topology: 1:1|1:N|N:N|N:1, purpose}
//   loops                {node, maxRounds (default 3), convergenceDelta (default 0.05)}
//   envelope             {mode, maxExposureUsd, maxConcurrent, maxDailyLossPct}
//                        — the ceiling the template permits; the Mode Engine
//                        (slice 2) renders the actual per-site verdict. null
//                        numeric fields mean "not applicable to this stream".
//   protocols            P-* protocol ids in effect for this site

import { EXPERTOPTION_ROSTER, TRADING_ROSTER } from "./agentRoster.mjs"

export const DEFAULT_LOOP = Object.freeze({ maxRounds: 3, convergenceDelta: 0.05 })

export const PERMISSIONS = Object.freeze(["sanctioned", "gray", "forbidden"])
export const TOPOLOGIES = Object.freeze(["1:1", "1:N", "N:N", "N:1"])
export const ENVELOPE_MODES = Object.freeze(["autopilot", "copilot", "blocked", "demo"])
export const PROTOCOLS = Object.freeze([
  "P-SPECIFICITY",
  "P-GROUNDING",
  "P-ANTI-HALLUCINATION",
  "P-PURPOSE",
  "P-BOUNDED-LOOPS",
  "P-EVOLUTION",
  "P-SELF-IMPROVEMENT",
  "P-METALEARNING"
])

export const POLICY_GRAPH_CATALOG = Object.freeze([
  {
    // CCXT crypto venue class. Per-venue rows (binance/bybit/okx…) expand
    // one-by-one behind this template — official, platform-sanctioned APIs.
    site: "trading:ccxt",
    stream: "trading",
    venue: "ccxt-crypto (official protocol)",
    automationPermission: "sanctioned",
    demoOnly: false,
    roster: TRADING_ROSTER,
    edges: [
      { from: "news_sentiment", to: "consensus", topology: "N:1", purpose: "sentiment vote feeds the cross-source consensus vote" },
      { from: "technical", to: "consensus", topology: "N:1", purpose: "technical read feeds the cross-source consensus vote" },
      { from: "regime", to: "consensus", topology: "N:1", purpose: "regime label feeds the cross-source consensus vote" },
      { from: "volatility", to: "consensus", topology: "N:1", purpose: "volatility estimate feeds the cross-source consensus vote" },
      { from: "order_flow", to: "consensus", topology: "N:1", purpose: "order-flow delta feeds the cross-source consensus vote" },
      { from: "whale_onchain", to: "consensus", topology: "N:1", purpose: "on-chain read feeds the consensus vote on crypto venues" },
      { from: "consensus", to: "model_matrix", topology: "1:1", purpose: "verified cross-source agreement gates model-matrix confidence" },
      { from: "consensus", to: "risk_manager", topology: "1:1", purpose: "verified candles feed the risk manager's exposure math" },
      { from: "model_matrix", to: "risk_manager", topology: "1:1", purpose: "confidence-floored matrix output feeds position sizing" }
    ],
    loops: [
      { node: "consensus", maxRounds: 3, convergenceDelta: 0.05 },
      { node: "risk_manager", maxRounds: 2, convergenceDelta: 0.05 }
    ],
    envelope: {
      mode: "autopilot",
      maxExposureUsd: 10, // first-slice authority ceiling ($10)
      maxConcurrent: 2,
      maxDailyLossPct: 5 // first-slice authority (-5% / day)
    },
    protocols: PROTOCOLS
  },
  {
    // ExpertOption truth-table row (5C): unregulated venue (EOLabs LLC,
    // St. Vincent & Grenadines) — live money is FORBIDDEN until the connector
    // is re-engineered AND an explicit ADR decision; demo path is the ExpertBot
    // pattern, finished in slice 7.
    site: "expertoption",
    stream: "trading",
    venue: "expertoption (unregulated — demo only today)",
    automationPermission: "forbidden",
    demoOnly: true,
    roster: EXPERTOPTION_ROSTER,
    edges: [
      { from: "news_sentiment", to: "model_matrix", topology: "1:1", purpose: "sentiment refines demo matrix conviction" },
      { from: "technical", to: "model_matrix", topology: "1:1", purpose: "technical read feeds demo matrix confidence" },
      { from: "volatility", to: "risk_manager", topology: "1:1", purpose: "volatility feeds demo risk sizing" },
      { from: "model_matrix", to: "risk_manager", topology: "1:1", purpose: "matrix output feeds demo risk sizing" }
    ],
    loops: [
      { node: "model_matrix", maxRounds: 2, convergenceDelta: 0.05 }
    ],
    envelope: {
      mode: "demo",
      maxExposureUsd: null, // demo credits, not capital
      maxConcurrent: 1,
      maxDailyLossPct: 5
    },
    protocols: PROTOCOLS
  }
])

/** All catalog site ids, in catalog order. */
export function policyGraphSites() {
  return POLICY_GRAPH_CATALOG.map((t) => t.site)
}

/** Resolve one site template by id, or undefined. */
export function templateForSite(site) {
  return POLICY_GRAPH_CATALOG.find((t) => t.site === site)
}