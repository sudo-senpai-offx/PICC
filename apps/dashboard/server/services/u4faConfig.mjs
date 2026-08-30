// U4FA configuration module — spec docs/specs/PICC_UNIVERSAL_4FA_ENGINE.md T2/M7.
//
// Presets 1-5 and the per-class calibration rows are transcribed VERBATIM from
// the project owner's 4-factor blueprint, which is the authoritative source of
// truth (spec §1). Where the blueprint is silent (per-style EMA lists, EMA50
// slope lookback, regime-confirmation bar count) the default is a configurable
// value and the comment says the blueprint gave no number — it is never
// silently invented.
//
// Honest-config rule (spec M7): a typo'd knob fails loudly during validation,
// it does not silently default. Unknown keys anywhere are rejected.
//
// T10 decisions (pinned 2026-08-30 — not re-opened at implementation):
//   Decision B (day-key): the U4FA risk layer runs its OWN UTC day-key
//   (`new Date().toISOString().slice(0,10)`), carrying the -5% daily-loss
//   barrier and the 10/day proposal counter. The legacy `dailyLossLimitPct`
//   /`maxDailyTrades` knobs in autopilot.mjs keep their local-midnight
//   semantics unchanged — deviation from the spec's wording "trips the
//   existing daily-loss refusal" is intentional and documented here and in
//   the spec's T10 section.

import { readFile, writeFile, rename } from "node:fs/promises"
import { mkdirSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const KNOWN_CLASSES = Object.freeze(["forex", "gold", "indices", "crypto", "commodities"])
export const CURRENCY_CODES = Object.freeze([
  "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"
])

/** Blueprint-verbatim default configuration (values transcribed from REQ-STYLE / REQ-CAL / REQ-RISK). */
export const U4FA_DEFAULTS = Object.freeze({
  activeStyle: "2",
  presets: Object.freeze({
    "1": Object.freeze({
      label: "Bullet", chartTf: 60, chartTfLabel: "1m", emas: [],
      adxThreshold: 30, stoch: Object.freeze({ long: 80, short: 20 }),
      bbMult: 1.5, session: "ny-london",
      note: "Per-style EMA list unspecified in blueprint — inherits main-engine EMA50"
    }),
    "2": Object.freeze({
      label: "Blitz", chartTf: 300, chartTfLabel: "5m", emas: [],
      adxThreshold: 25, stoch: Object.freeze({ long: 60, short: 40 }),
      bbMult: 2.0, session: "ny-london",
      note: "Per-style EMA list unspecified in blueprint — inherits main-engine EMA50"
    }),
    "3": Object.freeze({
      label: "Rapid", chartTf: 900, chartTfLabel: "15m", emas: [],
      adxThreshold: 20, stoch: Object.freeze({ long: 50, short: 50 }),
      bbMult: 2.5, session: "ny-london",
      note: "Per-style EMA list unspecified in blueprint — inherits main-engine EMA50"
    }),
    "4": Object.freeze({
      label: "Swing", chartTf: 3600, chartTfLabel: "1h", emas: [],
      adxThreshold: 20, stoch: Object.freeze({ long: 50, short: 50 }),
      bbMult: 2.5, session: "any",
      note: "Per-style EMA list unspecified in blueprint — inherits main-engine EMA50"
    }),
    "5": Object.freeze({
      label: "Position", chartTf: 86400, chartTfLabel: "1D", emas: [],
      adxThreshold: 15, stoch: Object.freeze({ long: 50, short: 50 }),
      bbMult: 3.0, session: "any",
      note: "Per-style EMA list unspecified in blueprint — inherits main-engine EMA50. 1D chart TF needs Yahoo EOD (not live buffers)"
    })
  }),
  sessionWindows: Object.freeze({
    "europe-london": Object.freeze({ tz: "Europe/London", start: "07:00", end: "16:00", label: "blueprint 07:00-16:00 GMT, IANA wall-clock (DST-aware)" }),
    "ny-london": Object.freeze({ tz: "America/New_York", start: "13:00", end: "17:00", label: "London-New-York overlap profile" }),
    "any": Object.freeze({ tz: "UTC", start: "00:00", end: "23:59", label: "always open" })
  }),
  calibration: Object.freeze({
    forex: Object.freeze({ score: 5, bbMult: 2.0, adxThreshold: 25, stoch: Object.freeze({ long: 60, short: 40 }), expiry: 900, pipSize: 0.0001, session: "europe-london", eligibility: "trade", maxSpreadPips: 1.5 }),
    gold: Object.freeze({ score: 4, bbMult: 1.8, adxThreshold: 22, stoch: Object.freeze({ long: 60, short: 40 }), expiry: 900, pipSize: 0.1, session: "europe-london", eligibility: "trade", maxSpreadPips: 1.5 }),
    indices: Object.freeze({ score: 3, bbMult: 2.2, adxThreshold: 25, stoch: Object.freeze({ long: 60, short: 40 }), expiry: 1800, pipSize: 1, session: "ny-london", eligibility: "trade", maxSpreadPips: 1.5 }),
    crypto: Object.freeze({ score: 3, bbMult: 2.5, adxThreshold: 30, stoch: Object.freeze({ long: 80, short: 20 }), expiry: 1800, pipSize: 1, session: "any", eligibility: "trade", maxSpreadPips: 1.5 }),
    commodities: Object.freeze({ score: 1, bbMult: null, adxThreshold: null, stoch: Object.freeze({ long: 60, short: 40 }), expiry: null, pipSize: null, session: "any", eligibility: "avoid", maxSpreadPips: null })
  }),
  assetClassMap: Object.freeze({
    XAUUSD: "gold", GOLD: "gold", SILVER: "gold", XAGUSD: "gold", XAG: "gold",
    BTCUSD: "crypto", ETHUSD: "crypto", XRPUSD: "crypto", LTCUSD: "crypto",
    SOLUSD: "crypto", DOGEUSD: "crypto", LINKUSD: "crypto", ADAUSD: "crypto",
    US500: "indices", US30: "indices", USTEC: "indices", NAS100: "indices",
    SPX500: "indices", NDX: "indices", DAX: "indices", FTSE: "indices", CAC40: "indices", VIX: "indices",
    OIL: "commodities", WTI: "commodities", BRENT: "commodities", NGAS: "commodities", NATGAS: "commodities", COPPER: "commodities"
  }),
  // Per-asset pip-size overrides. Class calibration has a default pipSize
  // (forex 0.0001 for majors/minors) but JPY pairs quote 0.01 — per-asset
  // override wins. Heuristic fills anything unmapped: JPY-pair -> 0.01.
  pipSizes: Object.freeze({
    USDJPY: 0.01, EURJPY: 0.01, GBPJPY: 0.01, AUDJPY: 0.01, NZDJPY: 0.01, CADJPY: 0.01, CHFJPY: 0.01,
    XAUUSD: 0.1, GOLD: 0.1, XAGUSD: 0.01, SILVER: 0.01
  }),
  // Currency tags per asset for the F1 news blackout (currency of high-impact
  // events must touch an asset's quote OR base). Heuristic fills unmapped
  // CCYCCY ids; explicit rows win.
  calendarCurrencyMap: Object.freeze({
    EURUSD: ["EUR", "USD"], GBPUSD: ["GBP", "USD"], USDJPY: ["USD", "JPY"],
    AUDUSD: ["AUD", "USD"], NZDUSD: ["NZD", "USD"], USDCAD: ["USD", "CAD"],
    USDCHF: ["USD", "CHF"], EURJPY: ["EUR", "JPY"], EURGBP: ["EUR", "GBP"],
    XAUUSD: ["USD"], GOLD: ["USD"], OIL: ["USD"]
  }),
  // Static, declared — NOT measured covariance (honesty label rides the F1
  // check and the payload). Blueprint: EURUSD loss -> pause GBPUSD 15 min.
  correlations: Object.freeze({
    GBPUSD: Object.freeze({ triggers: Object.freeze(["EURUSD"]), pauseMs: 900000, label: "static config, not measured covariance" }),
    EURUSD: Object.freeze({ triggers: Object.freeze(["GBPUSD"]), pauseMs: 900000, label: "static config, not measured covariance" })
  }),
  newsBlackoutMin: 15, // blueprint ±15 min (research notes prop-firm convention is ±2 — blueprint wins)
  bbHugPct: 0.9, // "hug" = percentB >= 0.9 upper / <= 0.1 lower
  regimeConfirmBars: 2, // blueprint says "until recovery" with no bar count; research consensus 2-3; default 2
  emaSlopeLookback: 5, // blueprint gives no slope lookback; research-consensus default, configurable
  expiries: Object.freeze([900, 1800]),
  timingAtNextBarMs: 2000, // REQ-MAIN: 25-30 ADX -> enter at open of NEXT 5-min candle +2s
  postLossNotifyCooldownMs: 900000, // REQ-RISK: 15-min anti-revenge proposal throttle
  u4faVeto: true, // REQ blueprint: Regime-3 Chop / F1-F3 NO_TRADE can veto a confluence TRADE
  spreadSource: null, // T6: no bid/ask feed exists anywhere; null = honest "unmeasurable" abort
  risk: Object.freeze({
    riskPerTradePct: 0.5, // REQ-RISK 0.5% of balance per trade (T10 Decision A: U4FA-size amount at proposal time)
    dailyLossLimitPct: 5, // REQ-RISK -5% -> halt until 00:00 GMT (T10 Decision B: U4FA-owned UTC day-key)
    maxDailyTrades: 10 // REQ-RISK max 10 signals/day, counted on U4FA proposals per UTC day
  }),
  // Per-asset strategy toggles (spec M4). Default OFF per asset — the strategy
  // dimension must never change the decision engine's output unless a watched
  // asset opts in explicitly (T9 acceptance: OFF path runs byte-identical).
  // style "2" = blueprint activeStyle default; weight 0.4 as specified in M4.
  assets: Object.freeze({})
})

function dataDir() {
  // Resolved lazily so tests can point PICC_TRADING_DATA_DIR at a tmp dir after
  // module import (autopilot captures it at import-time; lazily is strictly more
  // testable and a superset).
  return process.env.PICC_TRADING_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
}

const CONFIG_FILE = () => join(dataDir(), "u4fa-config.json")

// ---------------------------------------------------------------------
// Deep merge (plain objects recursed; arrays and scalars replace)
// ---------------------------------------------------------------------
export function deepMergeConfig(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over
  if (over != null && typeof over === "object" && base != null && typeof base === "object") {
    const out = { ...base }
    for (const k of Object.keys(over)) {
      out[k] = base[k] != null ? deepMergeConfig(base[k], over[k]) : over[k]
    }
    return out
  }
  return over == null && base != null ? base : over
}

// ---------------------------------------------------------------------
// Validation — unknown keys fail loudly (spec M7)
// ---------------------------------------------------------------------
const PRESET_KEYS = new Set(["label", "chartTf", "chartTfLabel", "emas", "adxThreshold", "stoch", "bbMult", "session", "note"])
const SESSION_KEYS = new Set(["tz", "start", "end", "label"])
const CAL_KEYS = new Set(["score", "bbMult", "adxThreshold", "stoch", "expiry", "pipSize", "session", "eligibility", "maxSpreadPips"])
const STOCH_KEYS = new Set(["long", "short"])
const RISK_KEYS = new Set(["riskPerTradePct", "dailyLossLimitPct", "maxDailyTrades"])
const U4FA_ASSET_KEYS = new Set(["enabled", "style", "weight"])
const ASSET_KEYS = new Set(["u4fa"])
const TOP_KEYS = new Set([
  "activeStyle", "presets", "sessionWindows", "calibration", "assetClassMap",
  "pipSizes", "calendarCurrencyMap", "correlations", "newsBlackoutMin",
  "bbHugPct", "regimeConfirmBars", "emaSlopeLookback", "expiries",
  "timingAtNextBarMs", "postLossNotifyCooldownMs", "u4faVeto", "spreadSource", "risk", "assets"
])

function checkType(v, kind, errors, path) {
  if (kind === "number" && (typeof v !== "number" || !Number.isFinite(v))) errors.push(`${path}: expected number, got ${typeof v}`)
  if (kind === "boolean" && typeof v !== "boolean") errors.push(`${path}: expected boolean, got ${typeof v}`)
  if (kind === "string" && typeof v !== "string") errors.push(`${path}: expected string, got ${typeof v}`)
}

/** Validate a merged U4FA config. Pure — returns { ok, errors }. */
export function validateU4faConfig(raw) {
  const errors = []
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["config must be a JSON object"] }
  }
  for (const k of Object.keys(raw)) {
    if (!TOP_KEYS.has(k)) errors.push(`unknown top-level key "${k}" (typo'd knob fails loudly)`)
  }

  if (raw.activeStyle != null) {
    if (!Object.keys(raw.presets ?? U4FA_DEFAULTS.presets).includes(String(raw.activeStyle))) {
      errors.push(`activeStyle "${raw.activeStyle}" not among preset keys`)
    }
  }

  // presets 1..5
  const presets = raw.presets ?? U4FA_DEFAULTS.presets
  if (presets != null && typeof presets === "object") {
    for (const key of Object.keys(presets)) {
      const p = presets[key]
      if (p == null || typeof p !== "object") { errors.push(`presets.${key}: must be an object`); continue }
      for (const k of Object.keys(p)) if (!PRESET_KEYS.has(k)) errors.push(`presets.${key}.${k}: unknown preset key`)
      checkType(p.chartTf, "number", errors, `presets.${key}.chartTf`)
      checkType(p.adxThreshold, "number", errors, `presets.${key}.adxThreshold`)
      checkType(p.bbMult, "number", errors, `presets.${key}.bbMult`)
      if (p.chartTf != null && p.chartTf < 30) errors.push(`presets.${key}.chartTf: too small`)
      if (p.stoch != null && typeof p.stoch === "object") {
        for (const k of Object.keys(p.stoch)) if (!STOCH_KEYS.has(k)) errors.push(`presets.${key}.stoch.${k}: unknown key`)
        checkType(p.stoch.long, "number", errors, `presets.${key}.stoch.long`)
        checkType(p.stoch.short, "number", errors, `presets.${key}.stoch.short`)
      }
      if (p.session != null && !Object.keys(raw.sessionWindows ?? U4FA_DEFAULTS.sessionWindows).includes(p.session)) {
        errors.push(`presets.${key}.session "${p.session}" not present in sessionWindows`)
      }
    }
  }

  // sessionWindows
  const windows = raw.sessionWindows ?? U4FA_DEFAULTS.sessionWindows
  if (windows != null && typeof windows === "object") {
    for (const key of Object.keys(windows)) {
      const w = windows[key]
      if (w == null || typeof w !== "object") { errors.push(`sessionWindows.${key}: must be an object`); continue }
      for (const k of Object.keys(w)) if (!SESSION_KEYS.has(k)) errors.push(`sessionWindows.${key}.${k}: unknown key`)
      checkType(w.tz, "string", errors, `sessionWindows.${key}.tz`)
      checkType(w.start, "string", errors, `sessionWindows.${key}.start`)
      checkType(w.end, "string", errors, `sessionWindows.${key}.end`)
      if (typeof w.start === "string" && !/^\d{2}:\d{2}$/.test(w.start)) errors.push(`sessionWindows.${key}.start "HH:MM" required`)
      if (typeof w.end === "string" && !/^\d{2}:\d{2}$/.test(w.end)) errors.push(`sessionWindows.${key}.end "HH:MM" required`)
    }
  }

  // calibration classes
  const cal = raw.calibration ?? U4FA_DEFAULTS.calibration
  if (cal != null && typeof cal === "object") {
    for (const key of Object.keys(cal)) {
      if (!KNOWN_CLASSES.includes(key)) { errors.push(`calibration.${key}: unknown class (known: ${KNOWN_CLASSES.join(", ")})`); continue }
      const c = cal[key]
      if (c == null || typeof c !== "object") { errors.push(`calibration.${key}: must be an object`); continue }
      for (const k of Object.keys(c)) if (!CAL_KEYS.has(k)) errors.push(`calibration.${key}.${k}: unknown calibration key`)
      checkType(c.score, "number", errors, `calibration.${key}.score`)
      checkType(c.eligibility, "string", errors, `calibration.${key}.eligibility`)
      if (c.eligibility != null && !["trade", "avoid"].includes(c.eligibility)) errors.push(`calibration.${key}.eligibility: "trade" or "avoid"`)
      if (c.eligibility === "avoid") {
        // an AVOID row may legitimately carry nulls (REQ-CAL commodities)
      } else {
        checkType(c.bbMult, "number", errors, `calibration.${key}.bbMult`)
        checkType(c.adxThreshold, "number", errors, `calibration.${key}.adxThreshold`)
        checkType(c.expiry, "number", errors, `calibration.${key}.expiry`)
        if (c.pipSize != null) checkType(c.pipSize, "number", errors, `calibration.${key}.pipSize`)
        if (c.maxSpreadPips != null) checkType(c.maxSpreadPips, "number", errors, `calibration.${key}.maxSpreadPips`)
        if (c.stoch != null && typeof c.stoch === "object") {
          for (const k of Object.keys(c.stoch)) if (!STOCH_KEYS.has(k)) errors.push(`calibration.${key}.stoch.${k}: unknown key`)
        }
        if (c.session != null && !Object.keys(windows).includes(c.session)) errors.push(`calibration.${key}.session "${c.session}" not in sessionWindows`)
      }
    }
  }

  // assetClassMap values must be known classes
  const acm = raw.assetClassMap ?? U4FA_DEFAULTS.assetClassMap
  if (acm != null && typeof acm === "object") {
    for (const [k, v] of Object.entries(acm)) {
      if (typeof v !== "string" || !KNOWN_CLASSES.includes(v)) errors.push(`assetClassMap.${k}: value "${v}" not a known class`)
    }
  }
  if (raw.pipSizes != null && typeof raw.pipSizes === "object") {
    for (const [k, v] of Object.entries(raw.pipSizes)) if (typeof v !== "number" || v <= 0) errors.push(`pipSizes.${k}: expected positive number`)
  }
  if (raw.calendarCurrencyMap != null && typeof raw.calendarCurrencyMap === "object") {
    for (const [k, v] of Object.entries(raw.calendarCurrencyMap)) {
      if (!Array.isArray(v) || v.length === 0 || !v.every((c) => typeof c === "string" && CURRENCY_CODES.includes(c))) {
        errors.push(`calendarCurrencyMap.${k}: array of currency codes (${CURRENCY_CODES.join("/")}) required`)
      }
    }
  }
  // correlations: triggers + pauseMs
  if (raw.correlations != null && typeof raw.correlations === "object") {
    for (const [k, v] of Object.entries(raw.correlations)) {
      if (v == null || typeof v !== "object") { errors.push(`correlations.${k}: must be an object`); continue }
      if (!Array.isArray(v.triggers) || v.triggers.length === 0 || !v.triggers.every((t) => typeof t === "string" && t.length)) {
        errors.push(`correlations.${k}.triggers: non-empty array of asset ids required`)
      }
      if (v.pauseMs != null && (typeof v.pauseMs !== "number" || v.pauseMs < 0)) errors.push(`correlations.${k}.pauseMs: non-negative number`)
    }
  }
  for (const [key, kind] of [["newsBlackoutMin", "number"], ["bbHugPct", "number"], ["timingAtNextBarMs", "number"], ["postLossNotifyCooldownMs", "number"], ["emaSlopeLookback", "number"]]) {
    if (raw[key] != null) checkType(raw[key], kind, errors, key)
  }
  if (raw.bbHugPct != null && (raw.bbHugPct <= 0 || raw.bbHugPct >= 1)) errors.push("bbHugPct must be in (0,1)")
  if (raw.regimeConfirmBars != null) {
    checkType(raw.regimeConfirmBars, "number", errors, "regimeConfirmBars")
    if (!Number.isInteger(raw.regimeConfirmBars) || raw.regimeConfirmBars < 1) errors.push("regimeConfirmBars: positive integer required")
  }
  if (raw.emaSlopeLookback != null && (!Number.isInteger(raw.emaSlopeLookback) || raw.emaSlopeLookback < 1)) errors.push("emaSlopeLookback: positive integer required")
  if (raw.expiries != null) {
    if (!Array.isArray(raw.expiries) || raw.expiries.length === 0 || !raw.expiries.every((e) => Number.isInteger(e) && e > 0)) {
      errors.push("expiries: non-empty array of positive integers")
    }
  }
  if (raw.u4faVeto != null) checkType(raw.u4faVeto, "boolean", errors, "u4faVeto")
  if (raw.risk != null && typeof raw.risk === "object") {
    for (const k of Object.keys(raw.risk)) if (!RISK_KEYS.has(k)) errors.push(`risk.${k}: unknown risk key`)
    for (const k of ["riskPerTradePct", "dailyLossLimitPct", "maxDailyTrades"]) {
      if (raw.risk[k] != null) checkType(raw.risk[k], "number", errors, `risk.${k}`)
    }
    if (raw.risk.riskPerTradePct != null && (raw.risk.riskPerTradePct <= 0 || raw.risk.riskPerTradePct > 20)) errors.push("risk.riskPerTradePct in (0,20]")
    if (raw.risk.dailyLossLimitPct != null && raw.risk.dailyLossLimitPct <= 0) errors.push("risk.dailyLossLimitPct must be > 0")
    if (raw.risk.maxDailyTrades != null && (raw.risk.maxDailyTrades < 0 || !Number.isInteger(raw.risk.maxDailyTrades))) errors.push("risk.maxDailyTrades: non-negative integer or 0=unlimited")
  }
  // per-asset strategy rows (spec M4): assets.<id>.u4fa.{enabled,style,weight}
  if (raw.assets != null && typeof raw.assets === "object") {
    for (const [assetId, row] of Object.entries(raw.assets)) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) {
        errors.push(`assets.${assetId}: must be an object`)
        continue
      }
      for (const k of Object.keys(row)) if (!ASSET_KEYS.has(k)) errors.push(`assets.${assetId}.${k}: unknown asset key (only "u4fa")`)
      const u4fa = row.u4fa
      if (u4fa == null) continue
      if (typeof u4fa !== "object" || Array.isArray(u4fa)) {
        errors.push(`assets.${assetId}.u4fa: must be an object`)
        continue
      }
      for (const k of Object.keys(u4fa)) if (!U4FA_ASSET_KEYS.has(k)) errors.push(`assets.${assetId}.u4fa.${k}: unknown key (enabled/style/weight)`)
      if (u4fa.enabled != null) checkType(u4fa.enabled, "boolean", errors, `assets.${assetId}.u4fa.enabled`)
      if (u4fa.style != null && typeof u4fa.style !== "string") errors.push(`assets.${assetId}.u4fa.style: preset key string required`)
      if (u4fa.weight != null) {
        checkType(u4fa.weight, "number", errors, `assets.${assetId}.u4fa.weight`)
        if (u4fa.weight != null && (u4fa.weight < 0 || u4fa.weight > 1)) errors.push(`assets.${assetId}.u4fa.weight: in [0,1]`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

// ---------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------
/**
 * Load the U4FA config: defaults <- deep-merge <- u4fa-config.json (if any).
 * @param {object} [opts] - { file = null, config = null } for tests
 * @returns {Promise<{ config: object, source: "file"|"defaults", file: string|null }>}
 */
export async function loadU4faConfig({ file = null, config = null } = {}) {
  let raw = null
  let filePath = file
  if (filePath == null) {
    try {
      filePath = CONFIG_FILE()
      raw = JSON.parse(await readFile(filePath, "utf8"))
    } catch {
      raw = null
      filePath = CONFIG_FILE()
    }
  } else if (config != null) {
    raw = config
  } else {
    try {
      raw = JSON.parse(await readFile(filePath, "utf8"))
    } catch (err) {
      if (err?.code === "ENOENT") {
        // no config file on disk yet -> defaults (spec: "loader returns defaults when no file exists")
        raw = null
      } else {
        // a file that exists but cannot be read/parsed must fail loudly, never silently default
        throw new Error(`u4fa-config file unreadable: ${filePath} (${err?.message ?? String(err)})`)
      }
    }
  }
  const merged = raw != null && typeof raw === "object" && !Array.isArray(raw)
    ? deepMergeConfig(U4FA_DEFAULTS, raw)
    : deepMergeConfig(U4FA_DEFAULTS, {})
  const res = validateU4faConfig(merged)
  if (!res.ok) throw new Error(`u4fa-config invalid: ${res.errors.join("; ")}`)
  return { config: merged, source: raw != null ? "file" : "defaults", file: filePath }
}

/**
 * Atomic tmp+rename write (same pattern as autopilot writeJSON). VITEST-suppressed:
 * tests never touch the real data dir.
 */
export async function saveU4faConfig(value, { file = null } = {}) {
  if (process.env.VITEST) return true
  const payload = JSON.stringify(validateU4faConfig(value).ok ? value : U4FA_DEFAULTS, null, 2)
  const filePath = file ?? CONFIG_FILE()
  const tmp = `${filePath}.${process.pid}.tmp`
  try {
    await writeFile(tmp, payload, "utf8")
    try {
      await rename(tmp, filePath)
    } catch (err) {
      if (err && err.code === "ENOENT") {
        mkdirSync(dirname(filePath), { recursive: true })
        await rename(tmp, filePath)
      } else {
        throw err
      }
    }
    return true
  } catch (err) {
    console.warn(`[picc-u4fa] write failed ${filePath}:`, err.message)
    try { unlinkSync(tmp) } catch { /* already gone */ }
    return false
  }
}

// ---------------------------------------------------------------------
// Per-asset resolution (REQ-CAL)
// ---------------------------------------------------------------------
/**
 * Classify an asset id: explicit assetClassMap row wins, then keyword heuristics,
 * then the CCYCCY forex pattern. Returns null when nothing matches (unclassified
 * assets are hard-refused by resolveAssetConfig — honest, per REQ-CAL).
 */
export function assetClassOf(assetId, config = U4FA_DEFAULTS) {
  const id = String(assetId ?? "").toUpperCase()
  if (!id) return null
  const map = config.assetClassMap ?? {}
  if (map[id]) return map[id]
  if (/\b(XAU|XAG|GOLD|SILVER)\b/.test(id)) return "gold"
  if (/\b(OIL|WTI|BRENT|NGAS|NATGAS|COPPER)\b/.test(id)) return "commodities"
  if (/\b(BTC|ETH|XRP|LTC|SOL|ADA|DOGE|LINK|DOT)\b/.test(id)) return "crypto"
  if (/\b(US500|US30|USTEC|NAS100|SPX500|NDX|DAX|FTSE|CAC40|VIX)\b/.test(id)) return "indices"
  if (/^[A-Z]{6}$/.test(id)) {
    const base = id.slice(0, 3)
    const quote = id.slice(3, 6)
    if (CURRENCY_CODES.includes(base) && CURRENCY_CODES.includes(quote)) return "forex"
  }
  return null
}

/** Off-spec heuristic: JPY pairs quote pips at 0.01. Documented, not invented. */
export function resolvePipSize(assetId, classKey, calibrationRow, config = U4FA_DEFAULTS) {
  const id = String(assetId ?? "").toUpperCase()
  const overrides = config.pipSizes ?? {}
  if (overrides[id] != null) return overrides[id]
  if (calibrationRow?.pipSize != null) return calibrationRow.pipSize
  if (id.endsWith("JPY")) return 0.01
  if (/\b(XAU|GOLD)\b/.test(id)) return 0.1
  if (classKey === "forex") return 0.0001
  return 1
}

/** Currencies for the F1 news blackout per asset (exact row -> CCYCCY heuristic -> []). */
export function resolveCurrencyMap(assetId, config = U4FA_DEFAULTS) {
  const id = String(assetId ?? "").toUpperCase()
  const map = config.calendarCurrencyMap ?? {}
  if (map[id]) return [...map[id]]
  if (/^[A-Z]{6}$/.test(id)) {
    const base = id.slice(0, 3)
    const quote = id.slice(3, 6)
    if (CURRENCY_CODES.includes(base) && CURRENCY_CODES.includes(quote)) return [base, quote]
  }
  return []
}

/**
 * Merge the active style preset over the asset's calibration class for one asset.
 * Precedence: calibration row wins over preset for any field it defines
 * (REQ-CAL is class-defining). AVOID-class and unclassified assets are refused
 * (hard gate, never a soft penalty — REQ-CAL).
 * `strategy` (spec M4) is the per-asset U4FA toggle: default OFF, weight 0.4,
 * style = per-asset override else activeStyle. AVOID/unclassified rows are
 * refused and cannot be enabled by a per-asset toggle.
 * @returns {{ accessibility, reason?, ... }|{ accessibility: string, class?: string }}
 */
export function resolveAssetConfig(assetId, config = U4FA_DEFAULTS) {
  const id = String(assetId ?? "").toUpperCase()
  const classKey = assetClassOf(id, config)
  const defaultStrategy = (row) => ({
    enabled: row?.u4fa?.enabled === true,
    weight: Number.isFinite(row?.u4fa?.weight) ? Math.min(1, Math.max(0, row.u4fa.weight)) : 0.4,
    style: typeof row?.u4fa?.style === "string" && row.u4fa.style
      ? row.u4fa.style
      : String(config.activeStyle ?? "2")
  })
  if (!classKey) {
    return { accessibility: "refused", reason: `no calibration class resolvable for "${id}"; unclassified assets are hard-refused (REQ-CAL)` }
  }
  const calibration = (config.calibration ?? {})[classKey]
  if (calibration?.eligibility === "avoid") {
    return { accessibility: "refused", class: classKey, reason: `class "${classKey}" is AVOID per REQ-CAL (blueprint confidence ${calibration.score}/5) — hard refusal` }
  }
  if (!calibration) {
    return { accessibility: "refused", class: classKey, reason: `class "${classKey}" has no calibration row` }
  }
  const preset = (config.presets ?? {})[String(config.activeStyle ?? "2")] ?? (config.presets ?? {})["2"]
  const sessionKey = calibration.session ?? preset?.session ?? "europe-london"
  const session = (config.sessionWindows ?? {})[sessionKey]
  const stoch = { ...(preset?.stoch ?? {}), ...(calibration.stoch ?? {}) }
  return {
    accessibility: "trade",
    assetId: id,
    class: classKey,
    score: calibration.score,
    style: String(config.activeStyle ?? "2"),
    preset,
    calibration,
    sessionKey,
    session,
    pipSize: resolvePipSize(id, classKey, calibration, config),
    adxThreshold: calibration.adxThreshold ?? preset?.adxThreshold ?? 25,
    bbMult: calibration.bbMult ?? preset?.bbMult ?? 2,
    stoch,
    expiry: calibration.expiry ?? 900,
    maxSpreadPips: calibration.maxSpreadPips ?? 1.5,
    currencies: resolveCurrencyMap(id, config),
    eligibility: calibration.eligibility ?? "trade",
    strategy: defaultStrategy((config.assets ?? {})[id])
  }
}