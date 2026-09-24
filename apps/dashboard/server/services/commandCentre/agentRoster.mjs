// Command Centre — L3 Agent Roster registry (PICC_SPEC: Command Centre Web §L3).
//
// Every agent has EXACTLY ONE specialized task (P-SPECIFICITY) and maps onto an
// existing service module (P-GROUNDING: the task is grounded in code that can
// actually run). New agents are added here; a new site is purely a catalog
// template — no engine code (User Story 28).
//
//   id          unique agent key, referenced by catalog templates
//   task        exactly one task description (validator rejects overlap
//               within a template roster)
//   modules     existing services the agent reads (may be several seams)
//   status      "ready"  = module imports resolve (test-enforced)
//               "planned" = declared but not yet built (honest, never silent)
//               ever marked ready — P-ANTI-HALLUCINATION
//
// `absent → null` (P-GROUNDING) is the standing finding convention for every
// agent: a missing feed/read yields null, never a fabricated number.

export const AGENT_REGISTRY = Object.freeze({
  // ── Trading team ────────────────────────────────────────────────────────
  news_sentiment: {
    task: "score news/sentiment for the asset with source + data cutoff",
    modules: ["sentimentEngine.mjs", "serper.mjs"],
    status: "ready"
  },
  technical: {
    task: "read multi-timeframe technical structure for the asset",
    modules: ["indicators.mjs", "multiTimeframe.mjs", "patterns.mjs"],
    status: "ready"
  },
  regime: {
    task: "classify the current market regime",
    modules: ["regimeDetection.mjs"],
    status: "ready"
  },
  volatility: {
    task: "estimate volatility via the estimator-chooser seam",
    modules: ["volatility.mjs"],
    status: "ready"
  },
  order_flow: {
    task: "read order-flow/delta for the asset — requires a signed-trades feed; reports unavailable for bar-only input (never candle-approximated)",
    modules: ["orderFlow.mjs"],
    status: "ready"
  },
  whale_onchain: {
    task: "read whale/on-chain flows for crypto venues",
    modules: [],
    status: "planned"
  },
  consensus: {
    task: "build cross-source candle consensus with verified tags",
    modules: ["marketDataBus.mjs"],
    status: "ready"
  },
  risk_manager: {
    task: "gate every action on observed risk — deterministic only, cannot be overridden",
    modules: ["u4faRisk.mjs", "kellyCriterion.mjs", "positionManager.mjs"],
    status: "ready"
  },
  model_matrix: {
    task: "compute the confidence-floored model matrix, abstaining below significance",
    modules: ["modelMatrix.mjs"],
    status: "ready"
  }
})

/** Ordered roster for the trading site template (deliberation order). */
export const TRADING_ROSTER = Object.freeze([
  "news_sentiment",
  "technical",
  "regime",
  "volatility",
  "order_flow",
  "whale_onchain",
  "consensus",
  "risk_manager",
  "model_matrix"
])

/** Ordered roster for the ExpertOption demo template (ExpertBot pattern subset). */
export const EXPERTOPTION_ROSTER = Object.freeze([
  "news_sentiment",
  "technical",
  "volatility",
  "risk_manager",
  "model_matrix"
])

/** Single-task agents that are actually wired to code, keyed by id. */
export function readyAgents() {
  return Object.fromEntries(
    Object.entries(AGENT_REGISTRY).filter(([, a]) => a.status === "ready")
  )
}

/** Agent definitions that are declared but not yet built — surfaced, never silent. */
export function plannedAgents() {
  return Object.fromEntries(
    Object.entries(AGENT_REGISTRY).filter(([, a]) => a.status === "planned")
  )
}