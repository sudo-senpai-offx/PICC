export const PILLAR_MIN_DEFAULT = 5

const PILLAR_META = Object.freeze([
  { id: "htfbias", label: "HTF bias" },
  { id: "vwap", label: "VWAP/key level" },
  { id: "ema921", label: "EMA 9/21" },
  { id: "volumedelta", label: "Volume delta" },
  { id: "cvd", label: "Cumulative volume delta (CVD)" },
  { id: "adxregime", label: "ADX regime" },
  { id: "externalclear", label: "External clear" }
])

const OSCILLATOR_LABEL = "Oscillator family (RSI/StochRSI/Stochastic/CCI)"
const OSCILLATOR_IDS = Object.freeze(["rsi", "stochRSI", "stoch", "stochastic", "cci"])

const EXTERNAL_CLEAR_REASON = "external-clear has no source wired today (zero code) — always honest-fail, never counted"
const NOT_SUPPLIED_REASON = "pillar input not supplied"

function validMin(v, name) {
  if (!Number.isInteger(v) || v < 1) {
    throw new TypeError(`${name}: expected a positive integer, got ${JSON.stringify(v)}`)
  }
  return v
}

export function resolvePillarMin({ min = null, v32Config = {}, env = process.env } = {}) {
  if (min != null) return validMin(min, "min")
  const envRaw = env.PICC_V32_PILLAR_MIN
  if (envRaw != null && String(envRaw).trim() !== "") {
    return validMin(Number(envRaw), `PICC_V32_PILLAR_MIN "${String(envRaw)}"`)
  }
  if (v32Config?.pillarMin != null) return validMin(v32Config.pillarMin, "v32Config.pillarMin")
  return PILLAR_MIN_DEFAULT
}

function rowFor(id, label, desc) {
  if (desc == null || typeof desc !== "object") {
    return { id, label, available: false, agrees: false, reason: NOT_SUPPLIED_REASON }
  }
  if (desc.available !== true) {
    return { id, label, available: false, agrees: false, reason: typeof desc.reason === "string" && desc.reason ? desc.reason : "unmeasurable" }
  }
  return {
    id,
    label,
    available: true,
    agrees: desc.agrees === true,
    reason: typeof desc.reason === "string" && desc.reason ? desc.reason : "measured"
  }
}

function externalClearRow() {
  return { id: "externalclear", label: "External clear", available: false, agrees: false, reason: EXTERNAL_CLEAR_REASON }
}

function oscillatorRow(group) {
  const entries = OSCILLATOR_IDS.filter((k) => group?.[k] != null && typeof group[k] === "object")
  if (entries.length === 0) {
    return { id: "oscillator", label: OSCILLATOR_LABEL, available: false, agrees: false, reason: "no oscillator indicators supplied (RSI/StochRSI/Stochastic/CCI)" }
  }
  const states = entries.map((k) => {
    const d = group[k]
    return `${k}:${d.available === true ? (d.agrees === true ? "agree" : "stand") : "unmeasured"}`
  })
  const available = entries.filter((k) => group[k].available === true)
  const agreeing = available.filter((k) => group[k].agrees === true)
  return {
    id: "oscillator",
    label: OSCILLATOR_LABEL,
    available: available.length > 0,
    agrees: agreeing.length > 0,
    reason: `${states.join(", ")} — ${agreeing.length} agree / ${available.length} available, packed to ONE vote (redundancy classifier)`
  }
}

export function evaluatePillarGate({ pillars = null, min = null, v32Config = {}, env = process.env } = {}) {
  const needed = resolvePillarMin({ min, v32Config, env })
  const src = pillars != null && typeof pillars === "object" && !Array.isArray(pillars) ? pillars : {}
  const rows = []
  for (const { id, label } of PILLAR_META) {
    rows.push(id === "externalclear" ? externalClearRow() : rowFor(id, label, src[id]))
  }
  if (src.oscillator != null && typeof src.oscillator === "object") rows.push(oscillatorRow(src.oscillator))
  const agreed = rows.reduce((a, r) => a + (r.agrees ? 1 : 0), 0)
  return { ok: agreed >= needed, agreed, needed, rows }
}