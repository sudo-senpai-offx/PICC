// Additive realtime surface for the v3.2 soak bay (PICC_COPILOT_REDESIGN_v1
// ch.2 line 32 + ch.4). Composes the v32Register bytes with the soak digits the
// design names, plus additive per-asset explainState. Never fabricates: absent
// buffers / untamped uptime → explicit reason. `composeV32Section` is pure and
// injectable (every source passed in); `v32Section()` is the live wrapper that
// gathers each source in its own try/catch so a dead feed degrades, never throws.
import { v32Register } from "./v32Register.mjs"
import { MIN_BARS } from "./adaptiveConfluence.mjs"

export { v32Register } // re-export so the register's contract rides along unchanged

const SOAK_TARGET = 100 // flipGate default minTrades (constitution.mjs:243)

/**
 * Additive explain-state per asset, composed from the row's own fields so the
 * frontend never re-implements gate logic. Pure/deterministic; absent rows →
 * empty. Mirrors the exact V32ExplainState shape v32Copilot.explainState
 * produces (v32Copilot.mjs:216-236) but derives ok/verdict/blockedBy/wires
 * from the row's RECORDED copilot gate (the engine's decision-time result)
 * instead of re-running the gate — re-running would fail-close wires 1/3/4/6
 * on every row (empty risk/constitution) and flip every verdict to NEUTRAL.
 * The risk block is deliberately explicit null because this lane carries no
 * per-row risk context at explain time.
 */
function explainStateForRow(row, config, at) {
  const cp = row.copilot
  const score = row.score
  const adxReg = row.regime?.registers?.adx
  const sessionReg = row.regime?.registers?.session
  return {
    at: Number.isFinite(row.ts) ? row.ts : at,
    ok: cp?.ok === true,
    verdict: cp?.ok === true ? "TRADE" : "NEUTRAL",
    blockedBy: Array.isArray(cp?.blockedBy) ? cp.blockedBy : [],
    wires: Array.isArray(cp?.wires) ? cp.wires : [],
    costLine: row.costLine ?? null,
    score: score == null || score.available !== true ? null : { available: true, score: score.score, direction: score.direction },
    regime: {
      adx: adxReg == null ? null : { available: adxReg.available === true, chop: adxReg.available === true ? adxReg.chop : null },
      session: sessionReg == null ? null : { available: sessionReg.available === true, label: sessionReg.available === true ? sessionReg.label : null }
    },
    risk: { dayStartBalance: null, pnl: null, proposalsToday: null },
    config: { proposalCap: config?.proposalCap ?? null, consecutiveLossThreshold: config?.consecutiveLossThreshold ?? null }
  }
}

function explainFor(assets, config, at) {
  if (!Array.isArray(assets) || assets.length === 0) return []
  return assets.map((row) => ({
    assetId: row.assetId,
    state: explainStateForRow(row, config, at)
  }))
}

export async function composeV32Section({ decisions = [], rows = null, config = null, watch = [], at = Date.now() } = {}) {
  const register = await v32Register({ decisions, rows, config, at })
  const assetList = Array.isArray(watch) ? watch : []
  const buffered = assetList.filter((a) => (a?.periods?.[60]?.length ?? 0) >= MIN_BARS).length
  const watchDigit = {
    total: assetList.length,
    buffered,
    reason: assetList.length === 0 ? "waiting for the live watch set — broker feeds absent" : null
  }
  const candidateTrades = Number.isFinite(register.flipGate?.candidateTrades) ? register.flipGate.candidateTrades : 0
  // Ruling A: top-level breakeven rides the register's enabled-soak path. When
  // the lane is OFF, register.soak.breakeven is already null; when ON it is the
  // round3'd candidate expectancy (v32Register.mjs:32-34). Re-deriving it from
  // flipGate.candidateExpectancy here would leak candidate digits into the OFF
  // lane, so the register is the single source of truth.
  const breakeven = register.soak?.breakeven ?? null
  const enabledAt = config?.enabledAt
  const uptime = {
    seconds: Number.isFinite(enabledAt) && register.enabled && at >= enabledAt ? Math.floor((at - enabledAt) / 1000) : null,
    reason: register.enabled
      ? (Number.isFinite(enabledAt) ? null : "no enabledAt stamp in v32-config — uptime inapplicable")
      : "v3.2 lane off — uptime requires a powered toggle"
  }
  const explain = register.enabled ? explainFor(register.assets, config, at) : []
  return {
    ...register,
    watch: watchDigit,
    decisions: { resolved: candidateTrades, total: SOAK_TARGET },
    breakeven,
    uptime,
    explain
  }
}

/**
 * Live wrapper for realtimeSuite SECTIONS. Each source is fault-isolated: a
 * dead engine/ledger/config/broker feed degrades the digit to an honest null
 * rather than throwing and killing the whole `suite` event.
 */
export async function v32Section() {
  let decisions = []
  try {
    const { getDecisions } = await import("./adaptiveConfluence.mjs")
    decisions = ((await getDecisions())?.decisions ?? []) || []
  } catch { /* engine offline → empty */ }
  let rows = null
  try {
    const { correctlyAnsweredByEngine } = await import("./accuracyLedger.mjs")
    rows = correctlyAnsweredByEngine()
  } catch { rows = [] }
  let config = null
  try {
    const { loadV32Config } = await import("./v32Config.mjs")
    config = (await loadV32Config({})).config ?? null
  } catch { config = null }
  let watch = []
  try {
    const { getBrokerData } = await import("./brokers/index.mjs")
    const { mergeCCXTAssets } = await import("./liveCCXT.mjs")
    watch = (mergeCCXTAssets(getBrokerData())?.assets ?? []) || []
  } catch { watch = [] }
  let at = Date.now()
  try {
    const { getDecisions } = await import("./adaptiveConfluence.mjs")
    const cached = await getDecisions()
    if (Number.isFinite(cached?.ts)) at = cached.ts
  } catch { /* keep Date.now() */ }
  return composeV32Section({ decisions, rows, config, watch, at })
}