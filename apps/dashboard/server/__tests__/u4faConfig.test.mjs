// U4FA config module tests — spec T2 acceptance:
//   - defaults equal the blueprint transcription (verbatim numbers)
//   - a typo'd key fails validation loudly (unknown keys anywhere)
//   - AVOID-class and unclassified assets are hard-refused by the resolver
//   - per-asset resolution (class / pipSize / currencies / session) is correct
//   - file load deep-merges over defaults and rejects invalid files
import { describe, expect, it } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  U4FA_DEFAULTS,
  validateU4faConfig,
  deepMergeConfig,
  loadU4faConfig,
  saveU4faConfig,
  assetClassOf,
  resolveAssetConfig,
  resolvePipSize,
  resolveCurrencyMap
} from "../services/u4faConfig.mjs"

describe("u4faConfig — blueprint-verbatim defaults (REQ-STYLE / REQ-CAL / REQ-RISK)", () => {
  it("styles 1-5 carry the exact blueprint numbers", () => {
    expect(U4FA_DEFAULTS.presets["1"]).toMatchObject({ label: "Bullet", chartTf: 60, adxThreshold: 30, bbMult: 1.5, session: "ny-london", stoch: { long: 80, short: 20 } })
    expect(U4FA_DEFAULTS.presets["2"]).toMatchObject({ label: "Blitz", chartTf: 300, adxThreshold: 25, bbMult: 2.0, session: "ny-london", stoch: { long: 60, short: 40 } })
    expect(U4FA_DEFAULTS.presets["3"]).toMatchObject({ label: "Rapid", chartTf: 900, adxThreshold: 20, bbMult: 2.5, session: "ny-london", stoch: { long: 50, short: 50 } })
    expect(U4FA_DEFAULTS.presets["4"]).toMatchObject({ label: "Swing", chartTf: 3600, adxThreshold: 20, bbMult: 2.5, session: "any" })
    expect(U4FA_DEFAULTS.presets["5"]).toMatchObject({ label: "Position", chartTf: 86400, adxThreshold: 15, bbMult: 3.0, session: "any" })
  })

  it("calibration classes carry the blueprint confidence scores, expiry and AVOID flag", () => {
    expect(U4FA_DEFAULTS.calibration.forex).toMatchObject({ score: 5, bbMult: 2.0, adxThreshold: 25, stoch: { long: 60, short: 40 }, expiry: 900, eligibility: "trade" })
    expect(U4FA_DEFAULTS.calibration.gold).toMatchObject({ score: 4, bbMult: 1.8, adxThreshold: 22, expiry: 900 })
    expect(U4FA_DEFAULTS.calibration.indices).toMatchObject({ score: 3, bbMult: 2.2, adxThreshold: 25, expiry: 1800 })
    expect(U4FA_DEFAULTS.calibration.crypto).toMatchObject({ score: 3, bbMult: 2.5, adxThreshold: 30, stoch: { long: 80, short: 20 }, expiry: 1800 })
    expect(U4FA_DEFAULTS.calibration.commodities).toMatchObject({ score: 1, eligibility: "avoid" })
  })

  it("session window default is the blueprint 07:00-16:00 GMT mapped to Europe/London IANA", () => {
    expect(U4FA_DEFAULTS.sessionWindows["europe-london"]).toMatchObject({ tz: "Europe/London", start: "07:00", end: "16:00" })
  })

  it("risk defaults are the blueprint 0.5% / -5% / 10-per-day", () => {
    expect(U4FA_DEFAULTS.risk).toMatchObject({ riskPerTradePct: 0.5, dailyLossLimitPct: 5, maxDailyTrades: 10 })
    expect(U4FA_DEFAULTS.newsBlackoutMin).toBe(15)
    expect(U4FA_DEFAULTS.bbHugPct).toBe(0.9)
    expect(U4FA_DEFAULTS.regimeConfirmBars).toBe(2)
    expect(U4FA_DEFAULTS.spreadSource).toBeNull()
    expect(U4FA_DEFAULTS.expiries).toEqual([900, 1800])
  })
})

describe("validateU4faConfig — a typo'd knob fails loudly, it never silently defaults", () => {
  it("accepts the defaults", () => {
    expect(validateU4faConfig(U4FA_DEFAULTS).ok).toBe(true)
  })

  it("rejects an unknown top-level key", () => {
    const res = validateU4faConfig({ newsBlackoutMins: 30 })
    expect(res.ok).toBe(false)
    expect(res.errors.join("; ")).toMatch(/unknown top-level key "newsBlackoutMins"/)
  })

  it("rejects an unknown nested key inside a preset", () => {
    const res = validateU4faConfig({ presets: { "2": { adxThresh: 30 } } })
    expect(res.ok).toBe(false)
    expect(res.errors.join("; ")).toMatch(/unknown preset key/)
  })

  it("rejects an unknown nested key inside calibration / risk", () => {
    expect(validateU4faConfig({ calibration: { forex: { scoree: 5 } } }).ok).toBe(false)
    expect(validateU4faConfig({ risk: { riskPercTradePct: 0.5 } }).ok).toBe(false)
  })

  it("rejects an unknown calibration class and a bad session reference", () => {
    expect(validateU4faConfig({ calibration: { bitcoin: { score: 3, eligibility: "trade" } } }).ok).toBe(false)
    expect(validateU4faConfig({ presets: { "2": { session: "tokyo" } } }).ok).toBe(false)
  })

  it("rejects type errors and out-of-range values", () => {
    expect(validateU4faConfig({ bbHugPct: 1.5 }).ok).toBe(false)
    expect(validateU4faConfig({ bbHugPct: 0 }).ok).toBe(false)
    expect(validateU4faConfig({ regimeConfirmBars: 0 }).ok).toBe(false)
    expect(validateU4faConfig({ regimeConfirmBars: 1.5 }).ok).toBe(false)
    expect(validateU4faConfig({ emaSlopeLookback: 0 }).ok).toBe(false)
    expect(validateU4faConfig({ expiries: [] }).ok).toBe(false)
    expect(validateU4faConfig({ expiries: [900, "x"] }).ok).toBe(false)
    expect(validateU4faConfig({ u4faVeto: "yes" }).ok).toBe(false)
    expect(validateU4faConfig({ correlations: { GBPUSD: { triggers: "EURUSD", pauseMs: 900000 } } }).ok).toBe(false)
    expect(validateU4faConfig({ risk: { riskPerTradePct: 25 } }).ok).toBe(false)
    expect(validateU4faConfig({ assetClassMap: { EURUSD: "bitcoin" } }).ok).toBe(false)
  })
})

describe("deepMergeConfig", () => {
  it("recursively merges nested objects and replaces scalars/arrays", () => {
    const merged = deepMergeConfig(U4FA_DEFAULTS, {
      newsBlackoutMin: 5,
      calibration: { gold: { bbMult: 1.5 } },
      correlations: { GBPUSD: { pauseMs: 600000 } },
      expiries: [900]
    })
    expect(merged.newsBlackoutMin).toBe(5)
    expect(merged.calibration.gold.bbMult).toBe(1.5)
    expect(merged.calibration.gold.adxThreshold).toBe(22) // untouched sibling
    expect(merged.calibration.forex).toEqual(U4FA_DEFAULTS.calibration.forex) // untouched row
    expect(merged.correlations.GBPUSD.pauseMs).toBe(600000)
    expect(merged.correlations.GBPUSD.triggers).toEqual(["EURUSD"])
    expect(merged.expiries).toEqual([900])
  })
})

describe("asset class resolution (REQ-CAL)", () => {
  it("classifies majors, gold, indices, crypto, commodities", () => {
    expect(assetClassOf("EURUSD")).toBe("forex")
    expect(assetClassOf("usdjpy")).toBe("forex")
    expect(assetClassOf("XAUUSD")).toBe("gold")
    expect(assetClassOf("GOLD")).toBe("gold")
    expect(assetClassOf("US500")).toBe("indices")
    expect(assetClassOf("BTCUSD")).toBe("crypto")
    expect(assetClassOf("OIL")).toBe("commodities")
  })

  it("returns null for unclassifiable ids", () => {
    expect(assetClassOf("FOOBAR")).toBeNull()
    expect(assetClassOf("XYZZY")).toBeNull()
  })

  it("AVOID-class assets are hard-refused with the blueprint confidence cited", () => {
    const res = resolveAssetConfig("OIL")
    expect(res.accessibility).toBe("refused")
    expect(res.reason).toMatch(/AVOID per REQ-CAL/)
    expect(res.class).toBe("commodities")
  })

  it("unclassified assets are hard-refused (no calibration = no evaluation)", () => {
    const res = resolveAssetConfig("FOOBAR")
    expect(res.accessibility).toBe("refused")
    expect(res.reason).toMatch(/no calibration class/)
  })

  it("resolves a tradeable asset's effective config (forex default style 2)", () => {
    const res = resolveAssetConfig("EURUSD")
    expect(res.accessibility).toBe("trade")
    expect(res.class).toBe("forex")
    expect(res.style).toBe("2")
    expect(res.adxThreshold).toBe(25)
    expect(res.bbMult).toBe(2.0)
    expect(res.stoch).toEqual({ long: 60, short: 40 })
    expect(res.expiry).toBe(900)
    expect(res.pipSize).toBe(0.0001)
    expect(res.currencies).toEqual(["EUR", "USD"])
    expect(res.sessionKey).toBe("europe-london")
    expect(res.session.tz).toBe("Europe/London")
    expect(res.maxSpreadPips).toBe(1.5)
  })

  it("JPY pairs convert pips at 0.01", () => {
    expect(resolvePipSize("USDJPY", "forex", U4FA_DEFAULTS.calibration.forex)).toBe(0.01)
    expect(resolveAssetConfig("USDJPY").pipSize).toBe(0.01)
    expect(resolveAssetConfig("EURJPY").currencies).toEqual(["EUR", "JPY"])
  })

  it("crypto resolves its calibration (ADX 30, expiry 1800, 80/20)", () => {
    const res = resolveAssetConfig("BTCUSD")
    expect(res.adxThreshold).toBe(30)
    expect(res.expiry).toBe(1800)
    expect(res.stoch).toEqual({ long: 80, short: 20 })
    expect(res.bbMult).toBe(2.5)
  })

  it("respects a user assetClassMap + calibration override from the merged config", () => {
    const cfg = deepMergeConfig(U4FA_DEFAULTS, {
      assetClassMap: { "MYASSET": "forex" },
      calibration: { gold: { adxThreshold: 20 } }
    })
    expect(assetClassOf("MYASSET", cfg)).toBe("forex")
    expect(resolveAssetConfig("XAUUSD", cfg).adxThreshold).toBe(20)
  })
})

describe("validateU4faConfig — per-asset strategy rows (spec M4)", () => {
  it("accepts valid assets rows", () => {
    const res = validateU4faConfig({
      assets: {
        EURUSD: { u4fa: { enabled: true, weight: 0.4 } },
        BTCUSD: { u4fa: { enabled: false, style: "3" } }
      }
    })
    expect(res.ok).toBe(true)
  })

  it("rejects unknown asset keys and unknown u4fa keys", () => {
    expect(validateU4faConfig({ assets: { EURUSD: { algo: true } } }).ok).toBe(false)
    expect(validateU4faConfig({ assets: { EURUSD: { u4fa: { speed: 9 } } } }).ok).toBe(false)
  })

  it("rejects non-object rows and out-of-range weights / wrong types", () => {
    expect(validateU4faConfig({ assets: { EURUSD: "on" } }).ok).toBe(false)
    expect(validateU4faConfig({ assets: { EURUSD: { u4fa: { weight: 1.5 } } } }).ok).toBe(false)
    expect(validateU4faConfig({ assets: { EURUSD: { u4fa: { weight: -0.1 } } } }).ok).toBe(false)
    expect(validateU4faConfig({ assets: { EURUSD: { u4fa: { enabled: "yes" } } } }).ok).toBe(false)
  })
})

describe("resolveAssetConfig — strategy seam (spec M4)", () => {
  it("default strategy is OFF with the blueprint weight 0.4 and activeStyle 2", () => {
    expect(resolveAssetConfig("EURUSD").strategy).toEqual({ enabled: false, weight: 0.4, style: "2" })
  })

  it("a per-asset row enables the strategy and overrides weight/style", () => {
    const cfg = deepMergeConfig(U4FA_DEFAULTS, { assets: { EURUSD: { u4fa: { enabled: true, weight: 0.3, style: "1" } } } })
    expect(resolveAssetConfig("EURUSD", cfg).strategy).toEqual({ enabled: true, weight: 0.3, style: "1" })
  })

  it("weight is clamped into [0,1] and style falls back to activeStyle", () => {
    const high = deepMergeConfig(U4FA_DEFAULTS, { assets: { EURUSD: { u4fa: { weight: 5 } } } })
    expect(resolveAssetConfig("EURUSD", high).strategy.weight).toBe(1)
    const low = deepMergeConfig(U4FA_DEFAULTS, { assets: { EURUSD: { u4fa: { weight: -2 } } } })
    expect(resolveAssetConfig("EURUSD", low).strategy.weight).toBe(0)
    expect(resolveAssetConfig("EURUSD", low).strategy.style).toBe("2")
  })

  it("AVOID/unclassified assets stay hard-refused even when a row tries to enable them", () => {
    const oil = deepMergeConfig(U4FA_DEFAULTS, { assets: { OIL: { u4fa: { enabled: true } } } })
    expect(resolveAssetConfig("OIL", oil).accessibility).toBe("refused")
    const goo = deepMergeConfig(U4FA_DEFAULTS, { assets: { GOO: { u4fa: { enabled: true } } } })
    expect(resolveAssetConfig("GOO", goo).accessibility).toBe("refused")
  })
})

describe("loadU4faConfig — reads a file, merges over defaults, rejects invalid", () => {
  it("returns the defaults when no file exists (source 'defaults')", async () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-u4fa-cfg-"))
    const res = await loadU4faConfig({ file: join(dir, "absent-u4fa-config.json") })
    expect(res.source).toBe("defaults")
    expect(res.config.newsBlackoutMin).toBe(15)
    expect(res.config.presets["2"].adxThreshold).toBe(25)
    rmSync(dir, { recursive: true, force: true })
  })

  it("deep-merges a valid file over the defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-u4fa-cfg-"))
    const file = join(dir, "u4fa-config.json")
    writeFileSync(file, JSON.stringify({ newsBlackoutMin: 5, calibration: { gold: { adxThreshold: 20 } } }))
    const res = await loadU4faConfig({ file })
    expect(res.source).toBe("file")
    expect(res.config.newsBlackoutMin).toBe(5)
    expect(res.config.calibration.gold.adxThreshold).toBe(20)
    expect(res.config.calibration.gold.bbMult).toBe(1.8) // untouched sibling survives
    rmSync(dir, { recursive: true, force: true })
  })

  it("throws on a file with an unknown key (loud failure, no silent default)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "picc-u4fa-cfg-"))
    const file = join(dir, "u4fa-config.json")
    writeFileSync(file, JSON.stringify({ newsBlackoutMins: 5 }))
    await expect(loadU4faConfig({ file })).rejects.toThrow(/unknown top-level key "newsBlackoutMins"/)
    rmSync(dir, { recursive: true, force: true })
  })

  it("saveU4faConfig is VITEST-suppressed (tests never touch disk)", async () => {
    expect(await saveU4faConfig(U4FA_DEFAULTS)).toBe(true)
  })
})