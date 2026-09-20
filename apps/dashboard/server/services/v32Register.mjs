// Additive v3.2 engine register (PICC_COPILOT_REDESIGN_v1 §2). Composes the
// flip-gate readiness surface with the per-asset v3.2 decision rows already on
// the live payload. Never fabricates: absent data → explicit reason, rows are
// forwarded exactly as the wire produced them.

import { v32Status } from "./adaptiveConfluence.mjs"

export async function v32Register({ decisions = [], rows = null, config = null, at = Date.now() } = {}) {
  const status = await v32Status({ rows, config, at })
  const assets = (Array.isArray(decisions) ? decisions : [])
    .filter((d) => d?.strategies?.v32?.enabled === true && d.strategies.v32.result)
    .map((d) => d.strategies.v32.result)

  const base = {
    ok: true,
    enabled: status.enabled,
    mode: status.mode,
    at,
    flipGate: status.flipGate,
    assets,
    assetCount: assets.length
  }
  if (!status.enabled) {
    return {
      ...base,
      assets: [],
      assetCount: 0,
      soak: { resolved: 0, breakeven: null, reason: "v3.2 lane off — soak digits require a powered toggle" }
    }
  }
  const ledger = Array.isArray(rows) ? rows : []
  const breakeven = Number.isFinite(status.flipGate?.candidateExpectancy)
    ? Math.round(status.flipGate.candidateExpectancy * 1000) / 1000
    : null
  return {
    ...base,
    soak: {
      resolved: ledger.length,
      breakeven: breakeven == null ? null : breakeven,
      reason: breakeven == null ? "candidate expectancy not computable from supplied rows" : null
    }
  }
}