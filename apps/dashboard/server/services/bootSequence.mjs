// Shared boot sequence — one ordered startup used by BOTH entry points.
//
// WHY THIS EXISTS. The boot order lived twice: `server/index.mjs` (standalone)
// and `apps/dashboard/vite.config.ts` (dev). They drifted three separate times,
// each silently disabling part of the system in dev only:
//
//   startScheduler   dev registered the scheduler's jobs but never RAN them
//   runStartupHealth first GET performed the boot work, writing the audit row
//                    lazily instead of at boot
//   loadBrokers      dev never loaded the broker registry at all, so
//                    getBestCandles returned zero candidates and every consumer
//                    (Copilot legs, /api/trading/candles) reported honest
//                    absence while the scheduler separately reached CCXT through
//                    brokers.mjs — two populations of one registry
//
// The third was only found because a Copilot panel was dark and the symptom was
// chased to ground. The next drift would be equally invisible.
//
// ORDERING INVARIANTS. These are load-bearing; do not reorder casually:
//   1. loadBrokers() before anything that can call getBestCandles() — the signal
//      engine, decision engine and Copilot all read it.
//   2. startLivenessMonitor() before startScheduler() — it registers the
//      eo-liveness job, and jobs added after startScheduler() never get an
//      interval.
//   3. In the standalone entry, server.listen() must interleave between those
//      two; the dev entry is served by Vite and has no listen of its own.
//
// Every step is individually fault-tolerant: a failing optional step is logged
// and boot continues, matching the "advisory, never fatal" contract the callers
// already had.

import { loadBrokers } from "./marketDataBus.mjs"
import { startLivenessMonitor, startScheduler } from "./scheduler.mjs"

/**
 * Run the shared, ordered boot sequence.
 *
 * @param {object} [opts]
 * @param {(msg: string, err?: unknown) => void} [opts.log]
 * @param {() => (Promise<unknown> | unknown)} [opts.afterBrokers]
 *   Runs after the broker registry is loaded and BEFORE the liveness/scheduler
 *   pair — the standalone entry uses it for the signal engine, which reads
 *   market data.
 * @param {boolean} [opts.scheduler=true] set false to load brokers without
 *   starting timers (useful for entry points that only need data access).
 */
export async function bootRuntime({ log = console, afterBrokers = null, scheduler = true } = {}) {
  try {
    await loadBrokers()
    log.info?.("[picc] broker registry loaded")
  } catch (err) {
    // Not fatal: a boot without market data still serves the rest, and every
    // consumer will report honest absence rather than fabricate.
    log.warn?.("[picc] broker registry failed to load (advisory, boot continues):", err?.message ?? err)
  }

  if (afterBrokers) {
    try {
      await afterBrokers()
    } catch (err) {
      log.warn?.("[picc] post-broker boot step failed (advisory, boot continues):", err?.message ?? err)
    }
  }

  if (!scheduler) return

  try {
    startLivenessMonitor()
  } catch (err) {
    log.warn?.("[picc] liveness monitor failed to start (advisory):", err?.message ?? err)
  }
  try {
    startScheduler()
  } catch (err) {
    log.warn?.("[picc] scheduler failed to start (advisory):", err?.message ?? err)
  }
}