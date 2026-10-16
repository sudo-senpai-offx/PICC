import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Pure-logic coverage for the advisory engine. Execution internals were
// removed (PICC is advisory-first); what remains here is the decision
// contract every future notifier/surface depends on.

let tmp
let autopilot

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-autopilot-pure-"))
  process.env.PICC_TRADING_DATA_DIR = tmp
  process.env.PICC_DATA_DIR = tmp
  await import("../services/trading.mjs")
  autopilot = await import("../services/autopilot.mjs")
  await autopilot._resetAutopilotData()
})

afterAll(() => {
  delete process.env.PICC_TRADING_DATA_DIR
  delete process.env.PICC_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

describe("decideAutopilot (pure decision contract)", () => {
  const config = {
    enabled: true,
    minConfidence: 55,
    cooldownMs: 60000,
    maxConcurrent: 3,
    dailyLossLimitPct: 10
  }
  const strong = { direction: "up", confidence: 70, reason: "momentum" }

  it("approves a strong signal with a call direction", () => {
    const d = autopilot.decideAutopilot({ config, pred: strong, now: 1000000, lastEntryAt: 0 })
    expect(d.trade).toBe(true)
    expect(d.direction).toBe("call")
  })

  it("maps down signals to puts", () => {
    const d = autopilot.decideAutopilot({
      config,
      pred: { direction: "down", confidence: 80, reason: "revert" },
      now: 1000000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(true)
    expect(d.direction).toBe("put")
  })

  it("refuses when disabled or flat", () => {
    expect(autopilot.decideAutopilot({ config: { ...config, enabled: false }, pred: strong }).trade).toBe(false)
    expect(autopilot.decideAutopilot({ config, pred: { direction: "flat", confidence: 90 } }).trade).toBe(false)
    expect(autopilot.decideAutopilot({ config, pred: null }).trade).toBe(false)
  })

  it("refuses below the confidence threshold", () => {
    const d = autopilot.decideAutopilot({
      config,
      pred: { direction: "up", confidence: 50, reason: "weak" },
      now: 1000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/below/)
  })

  it("respects cooldown and max concurrent deals", () => {
    expect(
      autopilot.decideAutopilot({ config, pred: strong, now: 1000, lastEntryAt: 900 }).trade
    ).toBe(false)
    const d = autopilot.decideAutopilot({
      config,
      pred: strong,
      now: 200000,
      lastEntryAt: 100000, // 100s gap — cooldown long expired
      openCount: 3
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/max concurrent/)
  })

  it("consensus gate vetoes on matrix disagreement", () => {
    const d = autopilot.decideAutopilot({
      config: { ...config, consensusGate: true, minConsensusAgree: 4 },
      pred: strong,
      consensus: { ok: true, consensus: { direction: "down", agree: 5, total: 7 } },
      now: 500000,
      lastEntryAt: 0
    })
    expect(d.trade).toBe(false)
    expect(d.reason).toMatch(/consensus gate/)
  })
})

describe("advisory scope config (multi-asset targets)", () => {
  it("resolves enabled asset targets with legacy single-asset fallback", async () => {
    const legacy = await autopilot.getAutopilotConfig()
    expect(Array.isArray(legacy.assets)).toBe(true)

    await autopilot.saveAutopilotConfig({
      assets: [
        { assetId: "BTCUSD", enabled: true, duration: null, amount: null, minConfidence: null },
        { assetId: "ETHUSD", enabled: false }
      ]
    })
    const cfg = await autopilot.getAutopilotConfig()
    const targets = autopilot.enabledAssetTargets(cfg)
    expect(targets.map((t) => t.assetId)).toEqual(["BTCUSD"])
    // Disabled entries are retained in scope memory.
    expect(cfg.assets.length).toBe(2)
  })

  it("dry-run evaluator reports honest gates without executing anything", async () => {
    // D2/AC-005: the "token" gate is gone with the venue's credential. The
    // refusal is now asserted on the gate that actually exists — either the
    // disabled precondition or the removal gate — and the key guarantee (a
    // gated refusal, never a fabricated verdict) is unchanged.
    const why = await autopilot.whyAutopilot({})
    expect(why.dryRun).toBe(true)
    expect(why.wouldTrade).toBe(false)
    expect(why.direction).toBeNull()
    expect(why.confidence).toBeNull()
    const enabled = why.gates.find((g) => g.name === "enabled")
    expect(enabled).toBeTruthy()
    if (!enabled.pass) {
      expect(why.reason).toBe("precondition failed")
    } else {
      const removed = why.gates.find((g) => g.name === "venue-removed")
      expect(removed).toBeTruthy()
      expect(removed.pass).toBe(false)
      expect(why.reason).toBe("execution venue removed")
    }
  })
})

describe("scopeHealth (asset-scope resolvability)", () => {
  const scoped = {
    assets: [
      { assetId: "BTCUSD", enabled: true }, // canonical catalog id
      { assetId: "BITCOIN", enabled: true }, // catalog alias → BTCUSD
      { assetId: "240", enabled: true } // junk: nothing backs it
    ],
    assetId: "BTCUSD"
  }

  it("flags an id backed by neither catalog nor feed as unresolvable", () => {
    const h = autopilot.scopeHealth(scoped, { feedAssets: [] })
    const row = h.rows.find((r) => r.assetId === "240")
    expect(row.resolvable).toBe(false)
    expect(row.via).toBeNull()
    expect(row.problem).toMatch(/remove it from scope/)
    expect(h.problems).toContain("240")
    expect(h.healthy).not.toContain("240")
  })

  it("resolves canonical ids and aliases from the static catalog", () => {
    const h = autopilot.scopeHealth(scoped, { feedAssets: [] })
    expect(h.rows.find((r) => r.assetId === "BTCUSD").resolvable).toBe(true)
    expect(h.rows.find((r) => r.assetId === "BTCUSD").via).toBe("catalog")
    expect(h.rows.find((r) => r.assetId === "BITCOIN").resolvable).toBe(true)
    expect(h.rows.find((r) => r.assetId === "BITCOIN").via).toBe("catalog")
    expect(h.problems).toEqual(["240"])
  })

  it("resolves a numeric id present in the live broker feed", () => {
    const h = autopilot.scopeHealth(scoped, {
      feedAssets: [{ id: 240, name: "BTC/USD" }]
    })
    expect(h.rows.find((r) => r.assetId === "240").resolvable).toBe(true)
    expect(h.rows.find((r) => r.assetId === "240").via).toBe("feed")
    expect(h.problems).toEqual([])
    expect(h.healthy).toContain("240")
  })

  it("matches feed assets by name too (not only id)", () => {
    const cfg = { assets: [{ assetId: "GOLD/USD", enabled: true }], assetId: "GOLD/USD" }
    const h = autopilot.scopeHealth(cfg, { feedAssets: [{ id: 9, name: "Gold" }] })
    expect(h.rows[0].resolvable).toBe(true)
    expect(h.rows[0].via).toBe("catalog") // GOLD/USD is a catalog alias for GOLD
  })

  it("unknown junk ids stay flagged even when feed is empty", () => {
    const cfg = { assets: [{ assetId: "QQQJUNK", enabled: true }], assetId: "QQQJUNK" }
    const h = autopilot.scopeHealth(cfg, { feedAssets: [] })
    expect(h.rows.find((r) => r.assetId === "QQQJUNK").resolvable).toBe(false)
    expect(h.problems).toEqual(["QQQJUNK"])
  })
})

// ─────────────────────────────────────────────────────────────────────
// THE INVENTED 0.30 IS GONE FROM THE AUTOPILOT SIZING PATH.
//
// `defaultAmount` read `const currentVol = rv.annual || 0.30` — an unmeasured
// constant standing in for a measurement, in the function that decides how much
// money goes at risk. It fired on `null` (too few returns to measure) and on a
// genuine measured 0 (a flat series), and after the precision fix it stopped
// firing on the sub-floor band that mattered most. The gate now lives in
// `volatilityPositionSize`, so the caller passes the measurement through
// unchanged.
//
// WHAT THIS TEST CAN AND CANNOT SHOW, because a source guard that is mistaken
// for behavioural coverage is worse than none:
//
//   CAN show the substitution is absent and the refusal is honoured at the call
//   site — both are properties of the source text, and reverting either breaks
//   this test.
//
//   CANNOT show what `defaultAmount` computes, because `defaultAmount` is NOT
//   CALLED by anything in this repository. It is defined at autopilot.mjs:806
//   and has no call site. So the sizing it performs cannot be exercised through
//   any exported seam, and asserting its arithmetic would require exporting a
//   dead function purely to test it. The arithmetic is covered where it lives —
//   `volatility.test.mjs` drives `volatilityPositionSize` directly, including
//   the sub-floor refusal and the 0.02 still-sizes-up direction. What is pinned
//   HERE is the thing that is specific to this file: that it stopped inventing
//   the number, and that it checks the gate's verdict rather than assuming one.
// ─────────────────────────────────────────────────────────────────────
describe("the autopilot sizing path no longer invents a volatility", () => {
  const src = readFileSync(
    resolve(fileURLToPath(import.meta.url), "../../services/autopilot.mjs"),
    "utf8"
  )
  const fn = src.slice(src.indexOf("async function defaultAmount"))
  // COMMENTS ARE STRIPPED BEFORE ANY ASSERTION, and that is not a convenience —
  // it is the whole reason this guard is trustworthy. The explanation of why the
  // constant was removed quotes the removed constant verbatim, so an assertion
  // against raw source text matches this file's own prose and reports a green
  // defect as red. Only lines that are wholly a `//` comment are dropped, which
  // cannot touch a string literal or a URL on a line of code.
  const defaultAmount = fn
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")

  it("does not substitute an invented constant for a missing or unmeasurable volatility", () => {
    // The premise, asserted: the comments really did have to come out, so the
    // guard below is reading code and not prose.
    expect(fn).toMatch(/rv\.annual\s*\|\|\s*0\.30/)
    expect(defaultAmount).not.toMatch(/rv\.annual\s*\|\|\s*0\.30/)

    // And the generic form: no `annual` read anywhere in this function is
    // defaulted behind `||`, whatever number it might be by the next ruling.
    const annualReads = defaultAmount.match(/rv\.annual\s*\|\|[^\n]*/g) ?? []
    expect(annualReads, "no rv.annual may be defaulted with ||").toEqual([])

    // The measurement is passed through as measured — present, and named.
    expect(defaultAmount).toMatch(/const currentVol = rv\.annual\s*$/m)
  })

  it("honours the gate's refusal instead of assuming a scale factor came back", () => {
    // `units >= 1` alone would have accepted a refusal that returned units 1;
    // checking `sized` is what makes the refusal authoritative. The assertion is
    // on the conjunction, so dropping the `sized` half breaks it.
    expect(defaultAmount).toMatch(/sizing\.sized\s*&&\s*sizing\.units\s*>=\s*1/)
  })
})
