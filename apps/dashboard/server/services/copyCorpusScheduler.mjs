// Copytrading research corpus — scheduler attach (Task 6, §8.2/§9).
//
// Attaches WITHOUT touching bootSequence.mjs ordering: this module registers
// one job via every() at import time, and startScheduler() picks up every
// registered job after startLivenessMonitor() has run, so both boot
// invariants (loadBrokers first; liveness before scheduler) hold unchanged.
// handlers.mjs imports this module for its registration side effect; both
// server entries import handlers before bootRuntime() runs.
//
// The job sustains per-regime coverage (§8 decision-2: thousands of samples
// per regime, never throughput maximised) and emits NO signals or alerts
// from others' activity (§9 non-goal). Retention pruning stays an explicit
// store call (Task 5), never a timer side effect.
import { every } from "./scheduler.mjs"
import { createLogger } from "../logger.mjs"

const log = createLogger("picc-corpus-refresh")

every(
  "corpus-refresh",
  60 * 60 * 1000,
  async () => {
    // Honest skip unless explicitly enabled: with no cadence configured there
    // is nothing to sustain and the job must not fabricate ingest activity.
    if (process.env.PICC_COPYCORPUS_REFRESH !== "on") return
    const { ingestStatus } = await import("./copyCorpusIngest.mjs")
    const status = ingestStatus()
    log.info("corpus refresh pass", {
      lastIngestAt: status.lastIngestAt,
      lastResult: status.lastResult,
      reason: status.reason
    })
  },
  { staggerMs: 120_000 }
)
