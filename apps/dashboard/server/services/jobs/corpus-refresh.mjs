// PICC scheduler job: corpus-refresh (extracted Wave 2.1 — body moved
// verbatim from services/scheduler.mjs; intervals, gates and wording
// unchanged).
//
// Copytrading research corpus (Task 6, §8.2/§9) — the corpus-refresh RUN leg,
// registered beside the news-digest RUN leg rather than from a side-effect
// import in handlers.mjs: handlers.mjs keeps a pinned static-import count
// (ws7AuthBootstrapGateGuard), and a side-effect import is a module-graph edge
// that count cannot tell apart from a boot-path dependency. Registration is
// still via every() at module scope, so startScheduler() picks the job up
// after startLivenessMonitor() has run and both boot invariants in
// bootSequence.mjs hold unchanged. The job attempts ingest (currently
// discovery-unavailable, so it stores nothing) and prunes toward per-regime
// ceilings (§8 decision-2: thousands of samples per regime as a prune
// ceiling, never throughput maximised) and emits NO signals or alerts from
// others' activity (§9 non-goal). Retention pruning stays an explicit store
// call (Task 5), never a timer side effect.
import { createLogger } from "../../logger.mjs"

const log = createLogger("picc-scheduler")

export const name = "corpus-refresh"
export const intervalMs = 60 * 60 * 1000
export const staggerMs = 120_000

export async function run() {
  // Wave 1.2 cadence: reachability snapshot → discovery attempt
  // (discovery-unavailable, stores nothing) → prune to ceilings. Prune-only
  // until a state-neutral discovery source exists; each step is
  // named-absence-tolerant (never fabricated). OFF gate stays log-only and
  // never touches the network — corpusRefreshPass owns the gate so this
  // job stays thin.
  const { corpusRefreshPass } = await import("../copyCorpusIngest.mjs")
  const outcome = await corpusRefreshPass()
  if (outcome.gated) {
    log.info("corpus refresh pass", {
      lastIngestAt: outcome.status.lastIngestAt,
      lastResult: outcome.status.lastResult,
      reason: outcome.status.reason
    })
    return
  }
  log.info("corpus refresh pass", {
    ingested: outcome.ingested,
    skipped: outcome.skipped,
    pruned: outcome.pruned,
    marketSnapshot: outcome.marketSnapshot,
    reason: outcome.reason
  })
}
