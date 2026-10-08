// PICC scheduler job: pack-observation (extracted Wave 2.1 — body moved
// verbatim from services/scheduler.mjs; intervals, gates and wording
// unchanged).
//
// Phase 6 (spec PICC_PACK1_LOCAL_TRADING_CORE_v1.md, S1/T1.1–T1.2) — Pack-1
// observations ride the scheduler tick (no new process, every 60s, stagger
// 60s). P1-1 surveys the REAL seams read-only: liveEOStats
// (connected/stale/degraded sticky kinds), trading getCredentials (token
// PRESENCE only — the value never leaves trading.mjs). D2/AC-005:
// `headlessSessionStatus` and `liveEOStats` are both gone from this seam —
// the per-venue rows it returned and the transport `liveStats` described
// belonged to the removed venue — so the survey runs against no live capture
// source, which it reports as stopped-at-human rather than as a fabricated
// running state. The mapping lives in packObservers.mjs (pure, table-tested);
// the pack runner applies the envelope gate. Observation NEVER resumes
// stopped-at-human — that is the human ack's job.
// S6: the PICC-side settings toggle (sessionCaptureEnabled store) is read HERE —
//     an observed OFF skips p1-1. There is no browser-side kill-switch anymore
//     (clean break, D1): the studio leg is the only capture path.
import { createLogger } from "../../logger.mjs"

const log = createLogger("picc-scheduler")

export const name = "pack-observation"
export const intervalMs = 60 * 1000
export const staggerMs = 60_000

export async function run() {
  // D2/AC-005: the `liveEO.mjs` import is removed — the ExpertOption realtime
  // transport it wrapped no longer exists. `liveStats` is therefore absent
  // (not fabricated): `observeEoCapture` reads it defensively, so the p1-1
  // survey reports against no live transport instead of a deleted module.
  // The p1-1 registry step itself is retained — see the report: whether
  // "EO session capture" should leave the Pack-1 step list is a product
  // decision the owner did not authorise, and the step still surfaces an
  // honest unconfigured state rather than a fabricated running one.
  const [{ getCredentials }, { observeEoCapture, t0ExtractionSubStep, observeCcxtPoll, observeNewsDigest, observeSignalNotifications, coerceObservationForStoppedStep }, { runStep }, { resourceCaps, packOneDefinition, getStep }, { ccxtStats, ccxtStatus }, { digestState, newsFeedsConfig }, { notifierStatus }, { sessionCaptureEnabled }] = await Promise.all([
    import("../trading.mjs"),
    import("../packObservers.mjs"),
    import("../packRunner.mjs"),
    import("../packRegistry.mjs"),
    import("../liveCCXT.mjs"),
    import("../newsDigest.mjs"),
    import("../notifier.mjs"),
    import("../sessionCaptureSettings.mjs")
  ])
  // D2/AC-005: `liveStats` is a literal empty object and the
  // `headlessSessionStatus()` read is gone. Both belonged to the removed
  // venue's realtime transport; neither is fabricated into a plausible-looking
  // value, so `observeEoCapture` sees no live capture source at all. The
  // dropped `captureProfiles.mjs` dynamic import is not reinstated: the module
  // is already loaded statically for `headlessSessionRefresh` (jobs import
  // ../captureProfiles.mjs in headless-session-refresh.mjs).
  const liveStats = {}
  const creds = await getCredentials()

  const survey = observeEoCapture({
    liveStats,
    // PICC-side toggle: default-ON when never set; only a real false disables.
    sessionCaptureEnabled: sessionCaptureEnabled()
  })
  // T1.2 arm: only reachable while the capture step actually RAN (a stopped
  // step has no fresh session — the extraction question is moot, say nothing).
  if (survey.status === "running") {
    survey.observed = {
      ...survey.observed,
      t0SubStep: t0ExtractionSubStep({ runtimeAvailable: process.env.PICC_CACTUS_T0_RUNTIME === "available" }).observed
    }
  }

  const p1OneId = packOneDefinition().id // "pack1-local-trading-core" — derived, never a duplicate literal
  // Ack-only guard at the wiring seam: when the seams are healthy (running
  // intent) but the step is still stopped-at-human, runStep's illegal
  // transition error must not kill this tick (it would starve p1-2/3/4 and
  // freeze the registry). Coerce to a SAME-STATUS observation — the step
  // still only exits via a human ack (packRegistry legal map, enforced).
  const currentStep = await getStep(p1OneId, "p1-1-eo-session-capture")
  const surveyToRun = coerceObservationForStoppedStep(survey, currentStep?.status, currentStep?.pathway ?? null)
  const result = await runStep({
    packId: p1OneId,
    stepId: "p1-1-eo-session-capture",
    observation: surveyToRun,
    // D2/AC-005: the `hasCredentials` gate is REMOVED with the venue. It read
    // `creds.expertoptionToken`, and the credential it gated can no longer be
    // configured. Omitting the gate is behaviourally identical to passing
    // `false`: `envelopeGate` tests `gates.hasCredentials !== true`, so this
    // l-class step still stops at the login gate exactly as it did before.
    caps: resourceCaps()
  })
  if (result.applied) {
    log.info("pack p1-1 gate rewrite", { from: result.applied.from, to: result.applied.to, reason: result.applied.reason })
  } else {
    log.info("pack p1-1 observation", { status: surveyToRun.status, detail: surveyToRun.detail, at: result.step.lastObservedAt })
  }

  // T2.1 — P1-2 CCXT poll survey. Read-only again: the pair CONFIG comes from
  // the credential store, the STATE from liveCCXT's own buffers (ccxtStatus is
  // liveness-gated, never claims a live feed on empty/stale buffers). The RUN
  // leg is the EXISTING ccxt-market-data job (15s, no keys needed for public
  // data) — the registry only observes it, per T2.2 envelope facts.
  const ccxtSurvey = observeCcxtPoll({
    exchanges: creds.ccxtExchanges ?? [],
    stats: ccxtStats(),
    status: ccxtStatus()
  })
  const ccxtResult = await runStep({
    packId: packOneDefinition().id,
    stepId: "p1-2-ccxt-data-poll",
    observation: coerceObservationForStoppedStep(ccxtSurvey, (await getStep(packOneDefinition().id, "p1-2-ccxt-data-poll"))?.status),
    caps: resourceCaps()
  })
  if (ccxtResult.applied) {
    log.info("pack p1-2 gate rewrite", { from: ccxtResult.applied.from, to: ccxtResult.applied.to, reason: ccxtResult.applied.reason })
  } else {
    log.info("pack p1-2 observation", { status: ccxtSurvey.status, detail: ccxtSurvey.detail, at: ccxtResult.step.lastObservedAt })
  }

  // T3.1 — P1-3 news digest survey. Config from the same PICC_NEWS_FEEDS env
  // the run leg reads; STATE from the digest store (what the run leg actually
  // persisted — null until the first pass, never an invented 0). The synthesis
  // flag reports whether PICC_NEWS_DIGEST_SYNTHESIS=on was observed, never
  // assumed. The RUN leg is its own news-digest job (10min cadence), below.
  const digestSurvey = observeNewsDigest({
    feeds: newsFeedsConfig(),
    digest: await digestState(),
    synthesisEnabled: process.env.PICC_NEWS_DIGEST_SYNTHESIS === "on"
  })
  const digestResult = await runStep({
    packId: packOneDefinition().id,
    stepId: "p1-3-news-digest",
    observation: coerceObservationForStoppedStep(digestSurvey, (await getStep(packOneDefinition().id, "p1-3-news-digest"))?.status),
    caps: resourceCaps()
  })
  if (digestResult.applied) {
    log.info("pack p1-3 gate rewrite", { from: digestResult.applied.from, to: digestResult.applied.to, reason: digestResult.applied.reason })
  } else {
    log.info("pack p1-3 observation", { status: digestSurvey.status, detail: digestSurvey.detail, at: digestResult.step.lastObservedAt })
  }

  // T4.1 — P1-4 signal notifications survey. The engine kill-switch is
  // server-observable (PICC_SIGNAL_ENGINE env); channels and their dispatch
  // records ride on notifierStatus().recent (last 20 dispatch records) and
  // channels config. The observation is PURE — notifier seam inputs only.
  const notifierSnap = notifierStatus()
  const signalSurvey = observeSignalNotifications({
    engineEnabled: process.env.PICC_SIGNAL_ENGINE !== "0",
    recent: notifierSnap.recent,
    channels: notifierSnap.channels
  })
  const signalResult = await runStep({
    packId: packOneDefinition().id,
    stepId: "p1-4-signal-notifications",
    observation: coerceObservationForStoppedStep(signalSurvey, (await getStep(packOneDefinition().id, "p1-4-signal-notifications"))?.status),
    caps: resourceCaps()
  })
  if (signalResult.applied) {
    log.info("pack p1-4 gate rewrite", { from: signalResult.applied.from, to: signalResult.applied.to, reason: signalResult.applied.reason })
  } else {
    log.info("pack p1-4 observation", { status: signalSurvey.status, detail: signalSurvey.detail, at: signalResult.step.lastObservedAt })
  }
}
