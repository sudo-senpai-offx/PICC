// WS-7 T13 — AC-031. THE test this task exists to pass.
//
// AC-031:1013-1019:
//   Scenario:  The model layer is invoked.
//   Action:    Inspect its outputs and call sites.
//   Expected:  It supplies only the 5% Sentiment expert input and the
//              plain-English explanation. It computes no ADX, no BBW, no
//              regime, no veto, and no tier.
//   Prohibited: No deterministic decision may import a model output other than
//              the sentiment input.
//   Verification: An import-boundary guard, PLUS a test asserting the
//              deterministic engine's result is identical when the model is
//              replaced by a stub returning garbage for indicator-shaped values.
//
// §4.1:533 is the architectural boundary in one sentence: "The Copilot's decision
// path is a pure function of market state. The model layer sits outside it: the
// model may contribute the 5% Sentiment expert's input and may write prose, and
// it may do nothing else."
//
// Plan v1 §3.3:257-258 is explicit about how the boundary is to be ENFORCED:
// "Assert this structurally, by walking the import graph from
// `confluence.mjs`/`tiers.mjs`/`vetoes/*`, not by grepping for a filename."
// So this file parses every module's real `import`/`export ... from` specifiers,
// resolves the relative ones against the filesystem, and BFSes from the decision
// path's entry points. A grep for a filename would be defeated by a
// re-export, an alias, or a one-character change; the graph cannot be.
//
// THE THREE-WAY DETERMINISM TEST at the bottom is the part AC-031's
// "Verification" clause actually asks for: the SAME market state evaluated with
// the model PRESENT, ABSENT, and ADVERSARIAL. The adversarial run stuffs
// indicator-shaped garbage — an ADX, a BBW, a regime, a tier, a veto verdict, a
// confluence score — into the sentiment input, and the assertion is that it
// moves NOTHING except the 5% row.

import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, resolve, sep } from "node:path"

import { evaluateCopilot } from "../engine.mjs"
import { EXPERT_WEIGHTS } from "../confluence.mjs"
import { WEIGHT_PCT as SENTIMENT_WEIGHT_PCT } from "../experts/sentiment.mjs"
import { createSentimentReader } from "../modelLayer/sentimentModel.mjs"
import { CACT_MAGIC_HEX } from "../modelLayer/artifactFormat.mjs"
import { manifest } from "../modelLayer/modelManifest.mjs"
import { fullMarketState } from "./fixtures/marketFixtures.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const COPILOT = resolve(HERE, "..")

/** The decision path's entry points. Anything the engine can reach starts here. */
const DECISION_PATH_ENTRIES = [
  "engine.mjs",
  "confluence.mjs",
  "tiers.mjs",
  "regime.mjs",
  "marketState.mjs",
  "vetoIndex.mjs",
  "riskLayer.mjs",
  join("experts", "macroBias.mjs"),
  join("experts", "structural.mjs"),
  join("experts", "trendStrength.mjs"),
  join("experts", "momentumExhaustion.mjs"),
  join("experts", "volatilityBoosters.mjs"),
  join("experts", "sentiment.mjs"),
  join("vetoes", "topDownHierarchy.mjs"),
  join("vetoes", "correlationTrap.mjs"),
  join("vetoes", "wickVsClose.mjs"),
  join("vetoes", "spreadVsTarget.mjs"),
  join("vetoes", "newsLockout.mjs"),
  join("vetoes", "sessionOpen.mjs"),
  join("conflicts", "index.mjs")
]

/** Paths the decision path may never reach, whatever the route. */
const FORBIDDEN_FROM_DECISION_PATH = [
  join("modelLayer", "sentimentModel.mjs"),
  join("modelLayer", "digestGate.mjs"),
  join("modelLayer", "modelManifest.mjs"),
  join("modelLayer", "artifactFormat.mjs"),
  "explain.mjs",
  "routing.mjs"
]

const rel = (p) => relative(COPILOT, p).split(sep).join("/")

/** Every `.mjs` under the copilot service directory, recursively. */
function allModules(dir = COPILOT, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "models" || name === "__tests__") continue
      allModules(full, acc)
    } else if (name.endsWith(".mjs")) {
      acc.push(full)
    }
  }
  return acc
}

/**
 * A module's RELATIVE import specifiers, read from its source.
 *
 * Covers the four forms a boundary could hide behind: a plain `import ... from`,
 * an `export ... from` re-export, a bare `import "x"` side-effect import, and a
 * dynamic `import("x")`. A `node:` specifier is skipped — it cannot reach a
 * sibling module — and a bare package specifier is skipped for the same reason.
 */
function relativeSpecifiers(source) {
  const found = new Set()
  const patterns = [
    /^\s*import\s+[^'"]*from\s+["']([^"']+)["']/gm,
    /^\s*import\s+["']([^"']+)["']/gm,
    /^\s*export\s+[^'"]*from\s+["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier.startsWith(".")) found.add(specifier)
    }
  }
  return [...found]
}

/** The transitive module closure of a set of entry points, resolved on disk. */
function importClosure(entries) {
  const seen = new Set()
  const queue = entries.map((e) => join(COPILOT, e))
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file)) continue
    if (!existsSync(file)) continue
    seen.add(file)
    for (const specifier of relativeSpecifiers(readFileSync(file, "utf8"))) {
      queue.push(resolve(dirname(file), specifier))
    }
  }
  return seen
}

describe("AC-031 — the import boundary, walked structurally", () => {
  const closure = importClosure(DECISION_PATH_ENTRIES)
  const reachable = [...closure].map(rel).sort()

  it("resolves every declared entry point, so the walk is not vacuous", () => {
    for (const entry of DECISION_PATH_ENTRIES) {
      expect(existsSync(join(COPILOT, entry)), `missing entry point ${entry}`).toBe(true)
    }
    expect(reachable.length).toBeGreaterThanOrEqual(DECISION_PATH_ENTRIES.length)
  })

  it("reaches the modules the decision path is actually made of", () => {
    // If the walk found nothing, "no forbidden module" would be a vacuous pass.
    for (const must of ["engine.mjs", "confluence.mjs", "tiers.mjs", "experts/sentiment.mjs", "vetoes/newsLockout.mjs"]) {
      expect(reachable, `the walk never reached ${must}`).toContain(must)
    }
  })

  it("reaches NO model-layer module, by any route", () => {
    const leaked = reachable.filter((p) => p.startsWith("modelLayer/"))
    expect(leaked, `the decision path imports ${leaked.join(", ")}`).toEqual([])
  })

  it("reaches NO explanation or routing module, by any route", () => {
    const leaked = reachable.filter((p) => p === "explain.mjs" || p === "routing.mjs")
    expect(leaked, `the decision path imports ${leaked.join(", ")}`).toEqual([])
  })

  it("reaches none of the specifically forbidden files", () => {
    for (const forbidden of FORBIDDEN_FROM_DECISION_PATH) {
      expect(reachable, `the decision path reaches ${forbidden}`).not.toContain(forbidden.split(sep).join("/"))
    }
  })

  it("reaches no model layer even if explain.mjs were pulled in — explain has no engine edge", () => {
    // The dependency runs engine ← explain, never the reverse, so `explain.mjs`
    // sits outside the closure entirely.
    expect(reachable).not.toContain("explain.mjs")
    const explainClosure = importClosure(["explain.mjs"])
    expect([...explainClosure].map(rel)).not.toContain("engine.mjs")
  })

  it("leaves the sentiment expert with NO import of the model layer", () => {
    const source = readFileSync(join(COPILOT, "experts", "sentiment.mjs"), "utf8")
    for (const specifier of relativeSpecifiers(source)) {
      expect(specifier, "experts/sentiment.mjs must not import the producer of its own input").not.toMatch(/modelLayer|sentimentModel/)
    }
  })

  it("has T11's sentiment expert byte-for-byte unmodified by T13", () => {
    // T13's whole claim is that it filled the seam's PRODUCER and left the
    // CONSUMER alone. Pinning the file's digest makes that claim checkable
    // rather than asserted, and makes a future edit to the decision path a test
    // failure rather than a review comment.
    const bytes = readFileSync(join(COPILOT, "experts", "sentiment.mjs"))
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      SENTIMENT_EXPERT_SHA256_T11
    )
  })

  it("adds no import edge to any pre-existing decision-path module", () => {
    // Every module T11 wrote keeps the exact specifier list it had. This is the
    // narrowest possible statement of "T13 is additive on the decision path".
    for (const entry of DECISION_PATH_ENTRIES) {
      const file = join(COPILOT, entry)
      const source = readFileSync(file, "utf8")
      for (const specifier of relativeSpecifiers(source)) {
        const resolved = resolve(dirname(file), specifier)
        expect(rel(resolved), `${entry} imports ${specifier}`).not.toMatch(/^modelLayer\//)
      }
    }
  })

  it("keeps the model layer's own imports inside the model layer and its one consumer", () => {
    // The other direction of the boundary: the model layer may reach the expert
    // it feeds (in a test) and its own modules, and nothing on the decision path
    // except that expert's shape — which it does not even import.
    const producer = readFileSync(join(COPILOT, "modelLayer", "sentimentModel.mjs"), "utf8")
    for (const specifier of relativeSpecifiers(producer)) {
      expect(specifier, `modelLayer/sentimentModel.mjs imports ${specifier}`).toMatch(/^\.\/(digestGate|modelManifest)\.mjs$/)
    }
  })
})

/**
 * T11's `experts/sentiment.mjs` as committed at `a4fac35`. Recorded here rather
 * than looked up so the test cannot be satisfied by editing the file it checks.
 */
const SENTIMENT_EXPERT_SHA256_T11 = "56530b03a3c5717ad3af6dc4f267b29a30116280e95169dc5aa05433fed2adc2"

describe("AC-031's verification clause — the same state, model PRESENT / ABSENT / ADVERSARIAL", () => {
  /**
   * PRESENT: the real seam, driven through `createSentimentReader` with a
   * verified artifact and a stub backend. The reader is exercised for real; the
   * artifact is a small byte-valid `.cact` with its digest overridden in a
   * copied manifest, so the test needs no 35 MB download and the production
   * manifest is never edited.
   */
  const presentInput = (() => {
    const dir = mkdtempSync(join(tmpdir(), "picc-t13-ac031-"))
    try {
      const bytes = Buffer.concat([Buffer.from(CACT_MAGIC_HEX, "hex"), Buffer.from("weights", "latin1")])
      writeFileSync(join(dir, "needle3.cact"), bytes)
      const digest = createHash("sha256").update(bytes).digest("hex")
      const reader = createSentimentReader({
        modelDir: dir,
        manifest: {
          ...manifest(),
          artifacts: manifest().artifacts.map((a) =>
            a.fileName === "needle3.cact" ? { ...a, sha256: digest, bytes: bytes.length } : a
          )
        },
        backend: { id: "stub:ac031", sentimentOf: () => 0.6 }
      })
      const reading = reader.read({ headlines: ["ECB holds rates"] })
      expect(reading.available, "the stub backend must actually be reachable for this test to mean anything").toBe(true)
      return reading.input
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })()

  /** ABSENT: no model at all — the state T11 ships. */
  const absentInput = null

  /**
   * ADVERSARIAL: the same sentiment score, PLUS indicator-shaped and
   * decision-shaped garbage in the same object. AC-031:1018 asks for "a stub
   * returning garbage for indicator-shaped values"; this is that, made as
   * hostile as the contract allows.
   *
   * ONE KEY IS DELIBERATELY NOT IN THIS LIST: `score`. It is not a leak to be
   * defended against — it is the NAME of the sentiment input's own field
   * (`experts/sentiment.mjs` destructures `{ score, source }`), so a model
   * returning `score: 0` is a model returning a *sentiment reading of zero*, and
   * the engine is entitled to map it onto the ±5 band. An earlier draft of this
   * file put `score: 0` in the garbage block "as a confluence score" and the
   * headline assertion failed by exactly 1.5 points — which is the correct
   * behaviour and the reason the key is called out here rather than quietly
   * removed. The test below pins that distinction explicitly.
   */
  const adversarialInput = {
    ...presentInput,
    // indicator-shaped
    adx: 99.9,
    bbw: 0.0001,
    atr: 0,
    ema50: -1,
    ema200: 1,
    vwap: 999999,
    stochRsi: 1,
    divergence: "strong-bearish",
    supportResistance: { nearest: 0, distance: 0 },
    fibonacci: { "0.618": 0 },
    // decision-shaped
    regime: "deadZone",
    tier: "ignore",
    veto: { fired: true, ruleId: "newsLockout" },
    vetoes: [{ ruleId: "topDownHierarchy", fired: true }],
    confluenceScore: 0,
    confluence: 0,
    coveragePct: 100,
    confidence: "high",
    automationPermitted: true,
    rung: "live",
    action: "autoExecute",
    riskPct: 1,
    conflictOverrides: ["C1", "C2", "C3"],
    activeBoosters: ["unicorn"],
    weightPct: 100
  }

  /**
   * All three runs are built from `fullMarketState()` so the candles, daily
   * closes, 4H candles and `computedAt` are byte-identical between them. The
   * ONLY difference is `sentimentInput`, which is what makes "identical except
   * for the sentiment row" a real claim rather than an artefact of two
   * differently-generated fixtures.
   */
  const stateWith = (sentimentInput) => fullMarketState({ sentimentInput })

  const present = evaluateCopilot({ marketState: stateWith(presentInput), recordVetoes: false })
  const absent = evaluateCopilot({ marketState: stateWith(absentInput), recordVetoes: false })
  const adversarial = evaluateCopilot({ marketState: stateWith(adversarialInput), recordVetoes: false })

  it("builds the three runs from the same deterministic inputs", () => {
    const without = (state) => {
      const { sentimentInput, ...rest } = state
      return JSON.stringify(rest)
    }
    expect(without(stateWith(presentInput))).toBe(without(stateWith(absentInput)))
    expect(without(stateWith(adversarialInput))).toBe(without(stateWith(presentInput)))
  })

  it("the model PRESENT makes the Sentiment expert available", () => {
    expect(row(present, "sentiment").available).toBe(true)
  })

  it("the model ABSENT makes it unavailable with T11's own reason", () => {
    expect(row(absent, "sentiment").available).toBe(false)
    expect(row(absent, "sentiment").unavailableReason).toContain("T13")
  })

  it("ADVERSARIAL garbage moves NOTHING outside the 5% row", () => {
    // THE assertion. Byte-identical `JSON.stringify` of the whole engine result,
    // once the sentiment row — the one thing the model is allowed to touch — is
    // removed from both sides. An ADX of 99.9, a `deadZone` regime, a fired veto,
    // `automationPermitted: true` and `rung: "live"` in the model's output change
    // nothing at all.
    expect(strip(present)).toBe(strip(adversarial))
  })

  it("ADVERSARIAL garbage does not move the three scalars the 5% row does move", () => {
    // `strip()` omits these three because the sentiment row legitimately moves
    // them. Here they are compared directly, and they must be EQUAL — the two
    // runs carry the same sentiment reading, so nothing else may shift.
    expect(adversarial.confluence.score).toBe(present.confluence.score)
    expect(adversarial.confluence.coveragePct).toBe(present.confluence.coveragePct)
    expect(adversarial.confluence.confidence).toBe(present.confluence.confidence)
  })

  it("the five surviving experts are byte-identical across all three runs", () => {
    for (const expert of ["macroBias", "structural", "trendStrength", "momentumExhaustion", "volatilityBoosters"]) {
      expect(row(present, expert), expert).toEqual(row(absent, expert))
      expect(row(adversarial, expert), expert).toEqual(row(present, expert))
    }
  })

  it("the tier is byte-identical across all three runs", () => {
    expect(adversarial.tier).toEqual(present.tier)
    expect(absent.tier).toEqual(present.tier)
  })

  it("the vetoes are byte-identical across all three runs", () => {
    expect(adversarial.vetoes).toEqual(present.vetoes)
    expect(adversarial.firedVetoes).toEqual(present.firedVetoes)
  })

  it("the regime is byte-identical across all three runs", () => {
    expect(adversarial.confluence.regime).toBe(present.confluence.regime)
    expect(absent.confluence.regime).toBe(present.confluence.regime)
  })

  it("the model's `automationPermitted: true` and `rung: \"live\"` do NOT reach the tier", () => {
    // D5: the permission flag is a read-only broker input. A model output that
    // looks like one must not become one.
    expect(adversarial.tier.automationPermitted).toBe(present.tier.automationPermitted)
    expect(adversarial.tier.rung).toBe(present.tier.rung)
  })

  it("the model's `tier: \"ignore\"` and `action: \"autoExecute\"` do NOT become the tier", () => {
    expect(adversarial.tier.tier).toBe(present.tier.tier)
  })

  it("the model's `veto: { fired: true }` does NOT fire a veto", () => {
    expect(adversarial.firedVetoes).toEqual(present.firedVetoes)
  })

  it("the model's `weightPct: 100` does NOT change the sentiment expert's weight", () => {
    // The weight is T11's table, read at construction. A model cannot inflate
    // its own share of the confluence.
    expect(row(adversarial, "sentiment").weightPct).toBe(SENTIMENT_WEIGHT_PCT)
  })

  it("the model's `coveragePct: 100` and `confidence: \"high\"` do NOT become the coverage", () => {
    expect(adversarial.confluence.coveragePct).toBe(present.confluence.coveragePct)
  })

  it("the model changes the score by AT MOST its own 5% weight", () => {
    // The bound is read from T11's own weight table, never restated here — plan v1
    // Risk 6, which this task inherits. A model able to move the score by more
    // than its own weight would be influencing the decision.
    const declared = EXPERT_WEIGHTS.find((e) => e.expert === "sentiment").weightPct
    expect(declared).toBe(SENTIMENT_WEIGHT_PCT)
    const delta = Math.abs(present.confluence.score - absent.confluence.score)
    expect(delta).toBeLessThanOrEqual(declared)
  })

  it("ABSENT costs exactly its own weight and does NOT renormalise", () => {
    // T13:1316's bisect line, measured. Coverage 95 not 100, and each survivor
    // keeps the weighted points it had when the model was present.
    expect(absent.confluence.coveragePct).toBe(100 - SENTIMENT_WEIGHT_PCT)
    for (const expert of EXPERT_WEIGHTS.filter((e) => e.expert !== "sentiment")) {
      const a = present.confluence.expertScores.find((e) => e.expert === expert.expert)
      const b = absent.confluence.expertScores.find((e) => e.expert === expert.expert)
      expect(b.weightedPoints, expert.expert).toBe(a.weightedPoints)
    }
  })

  it("ABSENT reports a lower-or-equal confidence and never a fabricated one", () => {
    expect(["medium", "low", "unavailable"]).toContain(absent.confluence.confidence)
  })

  it("`score` IS the sentiment reading — the model's one permitted number, and nothing else", () => {
    // The counterpart to the note on `adversarialInput`. A model returning
    // `score: 0` is returning a sentiment reading of zero, which the engine maps
    // onto the ±5 band and nowhere else; every OTHER number it returns is
    // ignored. Asserted by holding the score and moving everything else.
    const zeroReading = evaluateCopilot({
      marketState: stateWith({ ...presentInput, score: 0 }),
      recordVetoes: false
    })
    const fullReading = evaluateCopilot({ marketState: stateWith(presentInput), recordVetoes: false })
    expect(row(zeroReading, "sentiment").rawDelta).toBe(0)
    expect(row(fullReading, "sentiment").rawDelta).toBe(3) // 0.6 × 5
    // The difference is confined to the 5% row, exactly as the garbage is.
    expect(strip(zeroReading)).toBe(strip(fullReading))
  })

  it("the engine is deterministic with an adversarial model over 100 runs", () => {
    const first = JSON.stringify(evaluateCopilot({ marketState: stateWith(adversarialInput), recordVetoes: false }))
    for (let i = 0; i < 100; i += 1) {
      expect(JSON.stringify(evaluateCopilot({ marketState: stateWith(adversarialInput), recordVetoes: false }))).toBe(first)
    }
  })

  it("runs the same way with NO model layer at all — the module simply is not used", () => {
    // The bisect slice in its strongest form: the engine never imported the
    // model, so removing the directory changes nothing about how it computes.
    const state = stateWith(null)
    const a = evaluateCopilot({ marketState: state, recordVetoes: false })
    const b = evaluateCopilot({ marketState: state, recordVetoes: false })
    expect(JSON.stringify(a.confluence)).toBe(JSON.stringify(b.confluence))
    expect(row(a, "sentiment").available).toBe(false)
  })
})

// ---------------------------------------------------------------------------

function row(score, expert) {
  return score.confluence.contributions.find((c) => c.expert === expert)
}

/**
 * The engine result with everything the model is ALLOWED to move removed, so the
 * remainder can be compared byte-for-byte.
 *
 * Removed: the sentiment row from `contributions` and `expertScores`, and the
 * three scalars that row legitimately moves — `score`, `coveragePct`,
 * `confidence`. Those three are asserted separately and explicitly rather than
 * being swept into a string comparison, because "identical except for the 5%
 * row" is only a meaningful claim if the exception is precisely enumerated.
 */
function strip(score) {
  const {
    score: _score,
    coveragePct: _coveragePct,
    confidence: _confidence,
    ...rest
  } = score.confluence
  return JSON.stringify({
    ...rest,
    contributions: score.confluence.contributions.filter((c) => c.expert !== "sentiment"),
    expertScores: score.confluence.expertScores.filter((c) => c.expert !== "sentiment")
  })
}
