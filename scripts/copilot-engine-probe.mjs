// WS-7 T11 — the B5/B6 evidence collector.
//
// Spec §4.6:726-727 gives these two rows as UNMEASURED and names T11 as their
// producer:
//   B5 | Copilot confluence evaluation (pure, deterministic) | <= 100 ms p95
//       excluding model/journal
//   B6 | Copilot veto evaluation (all six, pure)             | <= 25 ms p95
//
// Plan v1 §3.1 item 8: "B5/B6 have a first measurement... Measure over a pinned
// fixture set, record raw samples into `apps/dashboard/perf/`, and report a
// verdict. If the engine is too slow, the verdict is BREACH — do NOT defer it
// to T19. T19 records verdicts (:1368); T11 owns producing the number."
//
// WHY A SEPARATE ARTIFACT. `perf/terminal-perf-manifest.json` is the e2e
// manifest, and the spec records that it "does not survive a failing run"
// (plan §6 Risk 1) and that its flake is an open issue. Writing a T11 verdict
// into it would couple this engine's evidence to an unrelated browser flake.
// So this writes `perf/copilot-engine-bench.json`, and T19 can fold it in.
//
// PURE MEASUREMENT PATH. This measures the deterministic engine only: no model,
// no network, no journal, no persistence sink — which is exactly the exclusion
// B5's budget text specifies ("excluding model/journal").
//
// RUN IT:  node scripts/copilot-engine-probe.mjs
//
// The artifact it writes is a MEASUREMENT, not a contract: timings differ per
// machine, and the test asserts the recorded verdict is DERIVABLE from the
// recorded samples rather than pinning a number that would rot.

import { writeFileSync } from "node:fs"
import { cpus } from "node:os"
import { fileURLToPath } from "node:url"

import { ENGINE_VERSION, evaluateConfluence } from "../apps/dashboard/server/services/copilot/confluence.mjs"
import { evaluateAllVetoes } from "../apps/dashboard/server/services/copilot/vetoIndex.mjs"
import { deriveMarketState } from "../apps/dashboard/server/services/copilot/marketState.mjs"

/** The artifact schema, so T19 and a reader know what this file is. */
export const ARTIFACT_SCHEMA = "picc-copilot-bench/1"

/** Spec §4.6:726-727 — the two budgets this measures. */
export const BUDGETS_MS = Object.freeze({ confluenceP95: 100, vetoesP95: 25 })

/** Enough samples for a p95 to mean something; warm-up is discarded. */
export const WARMUP_ITERATIONS = 10
export const MEASURED_ITERATIONS = 200

/**
 * The pinned fixture set. Deterministic — a seeded walk and a sine, never
 * `Math.random()`, so the measured WORK is identical on every machine and the
 * only variable is the machine's speed.
 */
function pinnedFixtureSet() {
  const states = []
  const base = Date.UTC(2026, 2, 10, 11, 0)
  for (let variant = 0; variant < 4; variant++) {
    const candles = []
    let x = 12345 + variant * 7919
    let price = 100
    for (let i = 0; i < 600; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0
      price += ((x >>> 8) / 16777216 - 0.5) * 0.7 + 0.03
      const prev = candles.length > 0 ? candles[candles.length - 1].close : price
      candles.push({
        open: prev,
        high: Math.max(prev, price) * 1.001,
        low: Math.min(prev, price) * 0.999,
        close: price,
        volume: 1000,
        time: i * 60_000
      })
    }
    const h4 = []
    for (let i = 0; i < 300; i++) {
      const centre = 100 + 6 * Math.sin(i / 7) + 0.02 * i
      h4.push({
        open: 100 + 6 * Math.sin((i - 1) / 7) + 0.02 * (i - 1),
        high: centre + 0.35 * (1 + Math.cos(i / 2.5)),
        low: centre - 0.35 * (1 + Math.cos(i / 2.3)),
        close: centre,
        volume: 1000,
        time: i * 14_400_000
      })
    }
    const daily = []
    let y = 999 + variant * 131
    let dp = 100
    for (let i = 0; i < 500; i++) {
      y = (Math.imul(y, 1664525) + 1013904223) >>> 0
      dp += ((y >>> 8) / 16777216 - 0.5) * 1.2 + 0.08
      daily.push(dp)
    }
    states.push(
      deriveMarketState({
        candles,
        h4Candles: h4,
        dailyCloses: daily,
        computedAt: base,
        newsEvents: [],
        proposals: [{ symbol: "BTCUSD", correlationGroup: "crypto" }],
        facts: { direction: "long", higherTimeframeBias: "bullish", spreadPct: 0.05, targetPct: 0.2 }
      })
    )
  }
  return states
}

/** Nearest-rank percentile — no interpolation, so p95 is a REAL sample. */
function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

const round3 = (n) => Math.round(n * 1000) / 1000

/** The verdict a summary supports, derived from its own numbers. */
export function verdictFor(summary, budgetMs) {
  if (!summary || typeof summary.p95Ms !== "number") return "UNMEASURED"
  return summary.p95Ms <= budgetMs ? "pass" : "BREACH"
}

/**
 * Run the measurement. Exported so a caller can run it without touching the
 * filesystem.
 *
 * @returns {object} The artifact.
 */
export function measure({ warmup = WARMUP_ITERATIONS, iterations = MEASURED_ITERATIONS } = {}) {
  const states = pinnedFixtureSet()

  for (let i = 0; i < warmup; i++) {
    const s = states[i % states.length]
    evaluateConfluence(s)
    evaluateAllVetoes(s)
  }

  const confluenceSamples = []
  const vetoSamples = []

  for (let i = 0; i < iterations; i++) {
    const s = states[i % states.length]

    const c0 = process.hrtime.bigint()
    evaluateConfluence(s)
    const c1 = process.hrtime.bigint()

    const v0 = process.hrtime.bigint()
    evaluateAllVetoes(s)
    const v1 = process.hrtime.bigint()

    confluenceSamples.push(Number(c1 - c0) / 1e6)
    vetoSamples.push(Number(v1 - v0) / 1e6)
  }

  const summarise = (samples) => ({
    iterations: samples.length,
    p50Ms: round3(percentile(samples, 50)),
    p95Ms: round3(percentile(samples, 95)),
    maxMs: round3(Math.max(...samples))
  })

  const confluence = summarise(confluenceSamples)
  const vetoes = summarise(vetoSamples)

  return {
    schema: ARTIFACT_SCHEMA,
    engineVersion: ENGINE_VERSION,
    // Host facts are recorded so a number is never read without knowing what it
    // was measured on. A p95 from an unloaded CI box is not a p95 from a phone.
    host: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: typeof cpus === "function" ? cpus().length : null
    },
    fixtures: { pinnedStates: states.length, warmupIterations: warmup, measuredIterations: iterations },
    measurements: { confluence, vetoes },
    budgets: { confluenceP95Ms: BUDGETS_MS.confluenceP95, vetoesP95Ms: BUDGETS_MS.vetoesP95 },
    verdicts: {
      confluence: verdictFor(confluence, BUDGETS_MS.confluenceP95),
      vetoes: verdictFor(vetoes, BUDGETS_MS.vetoesP95)
    },
    rawSamplesMs: {
      confluence: confluenceSamples.map(round3),
      vetoes: vetoSamples.map(round3)
    },
    provenance:
      "WS-7 T11 — first measurement for spec §4.6 rows B5 and B6, both previously UNMEASURED. " +
      "Pure deterministic engine only: no model, no network, no journal, no persistence sink (B5's " +
      "stated exclusion). T19 records verdicts; this produces the number."
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (invokedDirectly) {
  const artifact = measure()
  const out = fileURLToPath(new URL("../apps/dashboard/perf/copilot-engine-bench.json", import.meta.url))
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
  console.log(`[picc-copilot-bench] wrote ${out}`)
  console.log(
    `  B5 confluence  p50 ${artifact.measurements.confluence.p50Ms}ms  p95 ${artifact.measurements.confluence.p95Ms}ms  max ${artifact.measurements.confluence.maxMs}ms  budget 100ms  => ${artifact.verdicts.confluence}`
  )
  console.log(
    `  B6 vetoes      p50 ${artifact.measurements.vetoes.p50Ms}ms  p95 ${artifact.measurements.vetoes.p95Ms}ms  max ${artifact.measurements.vetoes.maxMs}ms  budget 25ms  => ${artifact.verdicts.vetoes}`
  )
}
