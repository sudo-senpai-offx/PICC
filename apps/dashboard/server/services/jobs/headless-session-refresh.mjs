// PICC scheduler job: headless-session-refresh (extracted Wave 2.1 — body
// moved verbatim from services/scheduler.mjs; intervals, gates and wording
// unchanged).
//
// Phase 5 (spec PICC_HEADLESS_CAPTURE_ENGINE.md, T4/T5/T7) — headless session
// refresh + account-metrics collection share this 60 s job (stagger 45s),
// each with its own per-venue cadence gate so neither disturbs the other.
//     1. Session pass: iterate the venues whose token-refresh cadence is due
//        (captureProfiles owns the cadence gate + per-venue policy; T7 feeds
//        per-user prefs through that seam without touching this job).
//        captureVenue handles vault gate → capture → save → token-change revive
//        (restartLiveEO({force:true}) ONLY when the EO token string actually
//        changed, the flap guard of handlers.mjs:1292-1302). Failures surface
//        through the runner's honest per-venue report; token values never
//        arrive here.
//     2. Metrics pass (T5): for every venue whose metrics cadence is due,
//        re-derive the latest account observation from the accumulated WS
//        frames and store it per-user (accountMetrics.mjs owns its cadence
//        gate + store). Observe + persist ONLY — a null observation stores
//        nothing and leaves that venue's gate open for the next pass.
import { headlessSessionRefresh } from "../captureProfiles.mjs"
import { createLogger } from "../../logger.mjs"

const log = createLogger("picc-scheduler")

export const name = "headless-session-refresh"
export const intervalMs = 60 * 1000
export const staggerMs = 45_000

export async function run() {
  const reports = await headlessSessionRefresh()
  for (const r of reports) {
    log.info("headless capture pass", { venue: r.venue, state: r.state, tokenChanged: r.state === "ok" ? r.tokenChanged : undefined })
  }
  const { accountMetricsRefresh } = await import("../accountMetrics.mjs")
  const collected = await accountMetricsRefresh("default")
  for (const rec of collected) {
    log.info("account metrics collect", { venue: rec.venueId, sourceLeg: rec.sourceLeg, active: rec.active ?? null })
  }
}
