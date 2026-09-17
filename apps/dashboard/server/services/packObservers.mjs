// S1 — PICC_PACK1_LOCAL_TRADING_CORE_v1.md: Pack-1 observers. One pure mapping
// per pack step: takes what the REAL seams report (or nothing), returns the
// registry observation {status, detail, observed}. PURE — no imports of the
// engine modules here (the wiring layer passes the seam outputs in), so the
// → status mapping table is trivially table-tested with fake seams.
//
// P1-1 EO session capture (T1.1) mapping per spec AC:
//   PICC-settings kill-switch off → skipped-unconfigured "session-capture-disabled"
//   degraded unconfigured/expired → stopped-at-human "needs: re-login"
//   no token at all           → stopped-at-human "needs: login"
//   token present (armed)     → running, observed {tokenConfigured, status,
//                               sourceLeg, feedMode}
// Honesty notes:
//   - the PICC-side settings kill-switch (sessionCaptureEnabled) is read by the
//     scheduler wiring from the real settings store — default-ON when never set,
//     only a real observed false disables (never an assumed off);
//
// T1.2 — T0 extraction sub-step: the Cactus Needle runtime is
// DEPENDENCY-NOT-YET-AVAILABLE, so absent → skipped-unconfigured
// "cactus-needle-t0-runtime-not-shipped", observed null, never fake output.
// When present, routing goes through resourceGovernor.routeTask so
// PICC_GOV_T0_CONFIDENCE_THRESHOLD governs (act above, escalate below).
import { routeTask } from "./resourceGovernor.mjs"
import { SKIP_REASONS } from "./packRunner.mjs"

// Owner decision (2026-09-13, Q2): any manual-login need must surface a
// structured workflow PATHWAY prompt — never silent autodetection or
// automation. The pathway steps mirror the REAL capture mechanism (the
// logged-in EO tab is the credential; the 60s session-refresh pass reads it).
function loginPathway({ need, reason = null }) {
  const loginStep = need === "re-login"
    ? `Log in AGAIN to the DEMO account manually (the session token was rejected/expired${reason ? ` — ${reason}` : ""}) — the logged-in tab IS the credential; PICC reads it, never types it.`
    : "Log in to the DEMO account manually (username + password) — the logged-in tab IS the credential; PICC reads it, never types it."
  return {
    need,
    prompt: "Manual login required — PICC never auto-fills, auto-detects, or automates broker logins.",
    steps: [
      "Open the ExpertOption app tab for the capture leg you use (the studio browser, or your own browser): https://app.expertoption.com/",
      loginStep,
      "Keep the tab open — the 60s session-refresh pass reads the token from the logged-in tab automatically.",
      "Then acknowledge this handoff in the packs strip — the step re-arms from stopped-at-human (observation never auto-resumes it)."
    ]
  }
}

// S6/T6.2 — PICC-side session-capture kill-switch pathway (owner decision
// 2026-09-15): when the dashboard setting turned capture OFF, the step must
// NOT be silent — it prompts to re-enable in PICC settings. The pathway is a
// human action (flip the toggle), never an auto-resume.
function capturePathway() {
  return {
    need: "capture",
    prompt: "Session capture is disabled in PICC settings — re-enable it there to resume. PICC never enables capture on its own.",
    steps: [
      "Open the PICC Settings page (Settings → Session capture).",
      "Turn the session-capture toggle ON.",
      "Back on the packs strip, the step re-arms from skipped-unconfigured on the next pass (observation never auto-resumes a disabled step)."
    ]
  }
}

/**
 * Scheduler-side guard honoring the ack-only contract at the wiring seam:
 * the live seams may report healthy (running-intent) while the registry step
 * is still stopped-at-human awaiting a HUMAN ack. A direct runStep would
 * reject that transition (tested contract — stopped-at-human exits only via
 * ack); the wiring layer must rewrite the intent to a legal SAME-STATUS
 * stopped-at-human observation (keeps the real observed payload, records
 * fresh evidence) — never auto-resuming the step. PURE: table-tested here.
 *
 * S6/T6.2 — a session-capture settings kill-switch skip on a
 * stopped-at-human step is handled the same way: the pending handoff is
 * NEVER auto-cancelled by a kill-switch flip. The observation is rewritten
 * to same-status stopped-at-human carrying the REAL kill-switch facts in
 * observed (sessionCaptureEnabled + source), with the prior
 * login pathway preserved so the strip keeps instructing the pending handoff;
 * the capture prompt appears only after the ack re-arms the step (next tick
 * then skips honestly).
 *
 * @param {object} observation      the observer's raw intent (running etc.)
 * @param {string|null} currentStatus  the step's CURRENT registry status
 * @param {object|null} priorPathway   the step's current read-surface pathway
 * @returns {object} coerced observation, or the input untouched
 */
export function coerceObservationForStoppedStep(observation, currentStatus, priorPathway = null) {
  if (currentStatus !== "stopped-at-human") return observation
  if (observation?.status === "running") {
    return {
      ...observation,
      status: "stopped-at-human",
      detail: "seam healthy; step awaits human ack — observation never auto-resumes",
      observed: observation.observed != null ? observation.observed : null
    }
  }
  // A kill-switch skip must not cancel a pending handoff: coerce to
  // same-status stopped-at-human, keep the real observed facts + the prior
  // login pathway. Any OTHER skip intent passes through untouched (the
  // observer's honest status wins; the registry rejects it only if illegal).
  const killSwitchSkip = observation?.status === "skipped-unconfigured" &&
    observation?.detail === SKIP_REASONS.sessionCaptureDisabled
  if (killSwitchSkip) {
    return {
      ...observation,
      status: "stopped-at-human",
      detail: `capture kill-switch off (${observation.detail}); pending handoff still awaits human ack — the flip never cancels the handoff`,
      observed: {
        ...(observation.observed ?? {}),
        // Preserve the pending handoff's pathway (login) on the read surface;
        // the capture-disable prompt appears after the ack re-arms the step.
        ...(priorPathway ? { pathway: priorPathway } : {})
      }
    }
  }
  return observation
}

/**
 * Survey the EO session-capture step from the real seams' outputs.
 *
 * S6/T6.2 PICC-side session-capture kill-switch (owner decision 2026-09-15):
 * the dashboard setting is authoritative — an observed OFF skips. An
 * UNOBSERVED switch (null) is never assumed off — default-ON. There is no
 * browser-side kill-switch anymore (clean break, D1): the studio leg is the
 * only capture path.
 *
 * @param {{headless?: {sourceLeg?: string|null},
 *          liveStats?: {status?: string,
 *                       degraded?: {kind?: string, reason?: string}|null,
 *                       feedMode?: string},
 *          creds?: {expertoptionToken?: string},
 *          sessionCaptureEnabled?: boolean|null}} opts  null = server never observed it
 * @returns {{status:string, detail:string, observed:object}}
 *          a registry observation ready for runStep
 */
export function observeEoCapture({
  headless = {},
  liveStats = {},
  creds = {},
  sessionCaptureEnabled = null
} = {}) {
  // PICC-side kill-switch first — the dashboard setting is authoritative when
  // the server actually observed it off (null = "not observed, default-ON").
  // It surfaces the "capture" pathway so the UI prompts to re-enable in PICC
  // settings (never an auto-resume).
  if (sessionCaptureEnabled === false) {
    return {
      status: "skipped-unconfigured",
      detail: SKIP_REASONS.sessionCaptureDisabled,
      observed: {
        sessionCaptureEnabled: false,
        source: "PICC settings kill-switch",
        pathway: capturePathway()
      }
    }
  }

  const degKind = liveStats.degraded?.kind
  if (degKind === "unconfigured" || degKind === "expired") {
    return {
      status: "stopped-at-human",
      detail: "needs: re-login",
      observed: {
        degradedKind: degKind,
        reason: liveStats.degraded.reason,
        tokenConfigured: Boolean(creds.expertoptionToken?.trim()),
        sessionCaptureEnabled,
        pathway: loginPathway({ need: "re-login", reason: liveStats.degraded.reason })
      }
    }
  }

  if (!creds.expertoptionToken?.trim()) {
    return {
      status: "stopped-at-human",
      detail: "needs: login",
      observed: {
        tokenConfigured: false,
        sessionCaptureEnabled,
        pathway: loginPathway({ need: "login" })
      }
    }
  }

  return {
    status: "running",
    detail: `capture armed (token present; liveEO ${liveStats.status ?? "unknown"})`,
    observed: {
      tokenConfigured: true,
      status: liveStats.status ?? null,
      sourceLeg: headless.sourceLeg ?? null,
      feedMode: liveStats.feedMode ?? null,
      sessionCaptureEnabled
    }
  }
}

/**
 * T2.1 — CCXT market-data poll survey (P1-2). Pure mapping from the real seams:
 * the credential store's ccxtExchanges list (config) + liveCCXT state (what was
 * actually observed: buffered pair count, liveness status, exchanges seen).
 * No CCXT pairs configured → honest config-level skip; pairs configured → the
 * RUN leg (scheduler ccxt-market-data, existing 15s job) is active, and the
 * observed freshness (connected/stale/idle from ccxtStatus) rides along. A
 * bufferedPairs of 0 is an OBSERVED zero (nothing landed yet), never a null.
 *
 * @param {{exchanges?: Array<{exchange?:string, symbol?:string}>,
 *          stats?: {pairs?:number, buffers?:number, exchanges?:string[]},
 *          status?: string}} opts
 * @returns {{status:string, detail:string, observed:object}}
 */
export function observeCcxtPoll({ exchanges = [], stats = {}, status = "idle" } = {}) {
  const configured = (Array.isArray(exchanges) ? exchanges : []).filter((e) => e?.exchange && e?.symbol)
  if (configured.length === 0) {
    return {
      status: "skipped-unconfigured",
      detail: SKIP_REASONS.noCcxtPairs,
      observed: { configuredPairs: 0 }
    }
  }
  return {
    status: "running",
    detail: `ccxt poll active (${configured.length} pair${configured.length === 1 ? "" : "s"} configured; state ${status})`,
    observed: {
      configuredPairs: configured.length,
      bufferedPairs: Number(stats.pairs) || 0, // observed count; 0 = nothing landed yet
      status, // ccxtStatus string — honest freshness (connected/stale/idle)
      exchanges: Array.isArray(stats.exchanges) ? stats.exchanges : []
    }
  }
}

/**
 * T1.2 — T0 extraction sub-step survey. The Cactus Needle runtime does not
 * ship in this repo (DEPENDENCY-NOT-YET-AVAILABLE): while absent the sub-step
 * is honestly skipped — never a fabricated extraction. When present, the
 * confidence-gated routing (resourceGovernor.routeTask) decides T0 vs escalate.
 *
 * @param {{runtimeAvailable?: boolean, confidence?: number}} opts
 * @returns {{status:string, detail:string, observed:object}}
 */
export function t0ExtractionSubStep({ runtimeAvailable = false, confidence } = {}) {
  if (runtimeAvailable !== true) {
    return {
      status: "skipped-unconfigured",
      detail: SKIP_REASONS.cactusNeedleT0NotShipped,
      observed: { runtimeAvailable: false }
    }
  }
  const routed = routeTask({ taskKind: "extraction", confidence })
  return {
    status: "running",
    detail: `T0 extraction routed → ${routed.tier}${routed.escalated ? " (escalated)" : ""}`,
    observed: { runtimeAvailable: true, tier: routed.tier, escalated: Boolean(routed.escalated), confidence: confidence ?? null }
  }
}

/**
 * T3.1/T3.2 — news digest survey (P1-2 pipeline tail; owner decision
 * 2026-09-13: Serper REPLACED by free RSS/Atom sources via the global PICC
 * webfetch capability). Config-level: no PICC_NEWS_FEEDS configured → honest
 * skipped-unconfigured; feeds configured → running, reporting only what the
 * digest store ACTUALLY observed — items/feeds counts stay null until a pass
 * has really run (never an invented 0). Synthesis is reported as the wiring
 * layer observed it (PICC_NEWS_DIGEST_SYNTHESIS=on), not assumed.
 *
 * @param {{feeds?: Array<{id?:string, url?:string}>,
 *          digest?: {last?: {ts?:string, feeds?:number, fetchedOk?:number,
 *                            gated?:number, rateLimited?:number, items?:number}|null,
 *                    lastRunAt?: string|null}|null,
 *          synthesisEnabled?: boolean}} opts
 * @returns {{status:string, detail:string, observed:object}}
 */
export function observeNewsDigest({ feeds = [], digest = null, synthesisEnabled = false } = {}) {
  const configuredFeeds = (Array.isArray(feeds) ? feeds : []).filter((f) => f?.url)
  if (configuredFeeds.length === 0) {
    return {
      status: "skipped-unconfigured",
      detail: SKIP_REASONS.noNewsSourceConfigured,
      observed: { configuredFeeds: 0 }
    }
  }
  const last = digest?.last ?? null
  return {
    status: "running",
    detail: `news digest active (${configuredFeeds.length} feed${configuredFeeds.length === 1 ? "" : "s"} configured${last ? `; last pass ${last.ts} — ${last.items ?? 0} items` : " — no pass has run yet"})`,
    observed: {
      configuredFeeds: configuredFeeds.length,
      fetchedSources: last?.feeds ?? null,
      okSources: last?.fetchedOk ?? null,
      gatedSources: last?.gated ?? null,
      rateLimitedSources: last?.rateLimited ?? null,
      items: last?.items ?? null, // null = no pass yet, never an invented 0
      lastRunAt: last?.ts ?? null,
      synthesisEnabled: Boolean(synthesisEnabled)
    }
  }
}

/**
 * T4.1/T4.2 — signal notifications survey (P1-4). Pure mapping from the
 * notifier seam: notifierStatus().recent (dispatch records, capped 20) and
 * notifierStatus().channels (configuration state per channel). The signal
 * engine kill-switch (PICC_SIGNAL_ENGINE=0) is read server-side at wiring
 * time and passed in as engineEnabled.
 *
 * Channel rows surface honest per-channel state from the LAST dispatch record
 * (sent/failed/skipped/off + reason). When no dispatch has fired, configured+
 * userEnabled channels show state null "no-dispatch-yet"; unconfigured channels
 * show their skip reason (no-vapid/no-webhook-url) from the config alone.
 *
 * @param {{engineEnabled?: boolean|null,
 *          recent?: Array<{ts:string, results:Record<string,string>,
 *                          [key:string]: *}>,
 *          channels?: Array<{name:string, configured:boolean,
 *                            userEnabled:boolean}>}} opts
 * @returns {{status:string, detail:string, observed:object}}
 */
export function observeSignalNotifications({
  engineEnabled = null,
  recent = [],
  channels = []
} = {}) {
  // T4.2 — kill-switch honesty: signal engine disabled → skip
  if (engineEnabled === false) {
    return {
      status: "skipped-unconfigured",
      detail: SKIP_REASONS.signalEngineDisabled,
      observed: { engineEnabled: false }
    }
  }

  const lastRecord = recent[0] ?? null
  const results = lastRecord?.results ?? {}

  const channelRows = channels.map((c) => {
    const r = results[c.name] ?? null

    // Dispatch record states — observed truth from the notifier
    if (r === "sent") return { name: c.name, state: "sent" }
    if (r === "failed") return { name: c.name, state: "failed", reason: lastRecord?.[`${c.name}Error`] ?? "send-failed" }
    if (r === "off") return { name: c.name, state: "off", reason: "channel-disabled-by-user" }
    if (r === "skipped") {
      if (!c.configured) {
        if (c.name === "webpush") return { name: c.name, state: "skipped", reason: SKIP_REASONS.noVapid }
        if (c.name === "webhook") return { name: c.name, state: "skipped", reason: SKIP_REASONS.noWebhookUrl }
        return { name: c.name, state: "skipped", reason: "unconfigured" }
      }
      return { name: c.name, state: "skipped", reason: "no-subscriptions" }
    }

    // No dispatch record for this channel — derive from config (honest config
    // facts, never fabricated dispatch states)
    if (!c.configured) {
      if (c.name === "webpush") return { name: c.name, state: "skipped", reason: SKIP_REASONS.noVapid }
      if (c.name === "webhook") return { name: c.name, state: "skipped", reason: SKIP_REASONS.noWebhookUrl }
      return { name: c.name, state: "skipped", reason: "unconfigured" }
    }
    if (c.userEnabled === false) return { name: c.name, state: "off", reason: "channel-disabled-by-user" }

    // Configured + user-enabled, no dispatch record yet
    return { name: c.name, state: null, reason: "no-dispatch-yet" }
  })

  const detail = lastRecord
    ? `signal engine active (last dispatch ${lastRecord.ts})`
    : "signal engine active (no dispatch yet)"

  return {
    status: "running",
    detail,
    observed: {
      engineEnabled: engineEnabled ?? true,
      channels: channelRows,
      recentCount: recent.length,
      lastDispatchAt: lastRecord?.ts ?? null
    }
  }
}