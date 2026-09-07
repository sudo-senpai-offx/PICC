// Command Centre — Slice 4 overview composition (PICC_SPEC: Command Centre Web,
// slice 4 "Command Centre surface"). PURE function of its inputs — no I/O.
//
// Honesty contract (the whole point of this module):
//   • every cell is OBSERVED state or an explicit "not-wired" label — a cell is
//     never "OK" just because nothing has been wired yet
//   • the mode verdict is rendered by the REAL engine (modeEngine.renderVerdict)
//     from those observed inputs — never fabricated by the surface
//   • a kill shown on a card IS the switch the sidecar gate reads (one switch)
//   • opt-in is a DECISION, not an approval: the T9 session-policy
//     "approved" verdict is sync-approval, NOT an automation opt-in — and no
//     automation opt-in has ever been granted, so none is ever claimed
//   • unconfigured ≠ zero-filled: where no deterministic source exists the
//     engine receives the conservative floor value (0 workability → COPILOT
//     cap), never an invented number that could raise a verdict
//
// The direction of every placeholder is DOWN (more conservative), because a
// surface must never display more execution power than the engine would grant.

import { GATE_ORDER } from "./safetySidecar.mjs"
import { policyGraphSites, templateForSite } from "./policyGraphCatalog.mjs"
import { renderVerdict } from "./modeEngine.mjs"
import { dayKeyOf } from "../u4faRisk.mjs"

const NOT_WIRED = "not-wired — arrives with execution (slice 5+)"
const VALID_STREAMS = ["trading"]

/**
 * Compose the Command Centre overview.
 *
 * metrics:      { [site]: { record, stale } | null } — record from
 *               accountMetricsForUser, stale computed by the handler
 * captureStatus: rows from captureProfiles.headlessSessionStatus() keyed by
 *               venue id (absent key = no capture profile for that site)
 * haltState:    safetySidecar.crossSiteHaltState() (null when none)
 * takeover:     safetySidecar.takeoverState() (null when none)
 * killState:    commandCentreRuntime.killSwitchState()
 * feeds:        { [site]: [{ name, ageSec, maxAgeSec }] } — OBSERVED mandatory-
 *               feed staleness. Sites absent from the map keep the
 *               capture-profile freshness logic.
 * execution:    { [site]: { action, power, inFlight, lastExecutedAt } } — the
 *               currently-executable leg per site. A site with a leg has its
 *               envelope (5D) + rationale (5F) cells + opt-in note composed
 *               from OBSERVED execution state; sites without one stay
 *               "not-wired" (never a silent OK).
 * stream:       optional "trading" — filters the rows
 */
export function composeCommandCentreOverview({
  sites = policyGraphSites(),
  metrics = {},
  captureStatus = {},
  haltState = null,
  takeover = null,
  killState = { global: false, sites: {} },
  feeds = {},
  execution = {},
  stream,
  now = Date.now()
} = {}) {
  if (stream !== undefined && !VALID_STREAMS.includes(stream)) {
    return { ok: false, error: `unknown stream: ${stream}` }
  }
  const kill = { global: killState?.global === true, sites: killState?.sites ?? {} }
  const siteKilled = (site) => kill.global || kill.sites[site] === true
  const haltToday = !!haltState && haltState.dayKey === dayKeyOf(now)

  const rows = sites
    .map((site) => templateForSite(site))
    .filter((t) => t && (stream === undefined || t.stream === stream))
    .map((template) => {
      const site = template.site
      const metricsRow = metrics[site] ?? null
      const capture = captureStatus[site] ?? null
      const dailyLoss = haltToday && haltState.breaker === "dailyLoss"
      const regime = haltToday && (haltState.breaker === "regime" || haltState.breaker === "regimeHalted")
      const breakers = {
        dailyLossHalted: dailyLoss,
        regimeHalted: regime,
        siteCapped: false // no site-cap observation source yet — never claimed
      }

      const staleFeed =
        metricsRow?.record && metricsRow.stale
          ? [
              {
                name: "account-metrics",
                ageSec: Math.max(0, Math.round((now - Date.parse(metricsRow.record.observedAt)) / 1000)),
                maxAgeSec: 5 * 60
              }
            ]
          : []
      const siteFeeds = Array.isArray(feeds[site]) ? feeds[site] : []
      // A site whose mandatory feeds are DECLARED (even when the array is
      // empty = everything within cadence) is wired to observed feed state —
      // an absent key is the not-wired case.
      const feedsDeclared = Array.isArray(feeds[site])
      const siteStaleFeeds = siteFeeds.filter(
        (f) => f && typeof f.ageSec === "number" && typeof f.maxAgeSec === "number" && f.ageSec > f.maxAgeSec
      )
      const leg = execution[site] ?? null
      const env = template.envelope ?? {}

      // Real engine, conservative observed inputs:
      //   workability 0 — no deterministic scorer is wired yet, so the honest
      //   input is the floor (caps at COPILOT), never an invented number
      //   optIn false  — no automation opt-in has ever been granted
      //   deliberation null — the engine reports "not-yet-available" itself
      const verdict = renderVerdict(template, {
        killSwitch: siteKilled(site),
        optIn: false,
        breakers,
        staleFeeds: [...staleFeed, ...siteStaleFeeds],
        workability: 0,
        deliberation: null,
        advisory: null,
        demoActive: false
      })

      const gates = GATE_ORDER.map((name) => {
        switch (name) {
          case "kill-switch":
            return {
              gate: name,
              status: siteKilled(site) ? "block" : "pass",
              note: siteKilled(site)
                ? "runtime kill switch is ON — the panel toggle and the enforcement gate share this switch"
                : "runtime kill switch OFF"
            }
          case "cross-site-day-halt":
            return {
              gate: name,
              status: haltToday ? "block" : "pass",
              note: haltToday
                ? `breaker "${haltState.breaker}" tripped on ${haltState.site} — all sites halted until the next UTC day`
                : "no cross-site breaker halt today"
            }
          case "human-takeover":
            return {
              gate: name,
              status: takeover ? "block" : "pass",
              note: takeover
                ? `human takeover active since ${takeover.at} — deny-all until explicit rearm (5B)`
                : "no takeover active"
            }
          case "per-site-opt-in":
            return {
              gate: name,
              status: "not-decided",
              note: leg
                ? `automation opt-in is a DECISION, not an approval — none has ever been granted. The ${leg.power} leg (${leg.action}) executes only on FRESH per-action human consent (consentBy), which is explicitly NOT an automation opt-in`
                : "automation opt-in is a DECISION, not an approval — the sync-approval verdict is NOT an opt-in, and none has ever been granted"
            }
          case "hard-breakers": {
            const trips = []
            if (dailyLoss) trips.push("daily-loss trip observed")
            if (regime) trips.push("regime-shift trip observed")
            return {
              gate: name,
              status: trips.length ? "block" : "pass",
              note: trips.length ? trips.join("; ") : "no breaker trip observed"
            }
          }
          case "fresh-data": {
            // A site with a DECLARED feeds entry reports its real staleness;
            // an empty declared array means within cadence.
            if (feedsDeclared) {
              if (siteStaleFeeds.length > 0) {
                return {
                  gate: name,
                  status: "block",
                  note: `stale mandatory feed(s): ${siteStaleFeeds.map((f) => f.name).join(", ")} — observed at overview time (5E)`
                }
              }
              return { gate: name, status: "pass", note: "mandatory feeds within cadence (observed at overview time)" }
            }
            if (!capture) {
              return {
                gate: name,
                status: "not-wired",
                note: `no capture profile for ${site} — feed freshness ${NOT_WIRED}`
              }
            }
            if (metricsRow?.stale) {
              return { gate: name, status: "block", note: "account-metrics older than its cadence — data is stale (5E)" }
            }
            return {
              gate: name,
              status: "pass",
              note: metricsRow?.record
                ? "capture profile present, metrics within cadence"
                : "capture profile present, no metrics observation yet — nothing to assert"
            }
          }
          case "toS-survival": {
            const perm = template.automationPermission
            if (perm === "forbidden") {
              return {
                gate: name,
                status: "restricted",
                note: "venue forbids automation — demo-only surface (5C truth table)"
              }
            }
            if (perm === "gray") {
              return {
                gate: name,
                status: "restricted",
                note: "gray venue — proposals only, never live autopilot (5C truth table)"
              }
            }
            return { gate: name, status: "pass", note: "sanctioned venue (5C truth table)" }
          }
          case "envelope-within-ceiling": {
            if (leg) {
              const cap = env.maxConcurrent
              const atCap = cap != null && leg.inFlight >= cap
              const passNote =
                env.maxExposureUsd != null
                  ? `${leg.power} leg observed: ${leg.inFlight} in-flight of ${cap ?? "n/a"} concurrent ceiling; market exposure capped at $${env.maxExposureUsd} per action (5D)`
                  : `${leg.power} leg observed: ${leg.inFlight} in-flight of ${cap ?? "n/a"} concurrent ceiling — no market-exposure surface on this site (5D)`
              return {
                gate: name,
                status: atCap ? "block" : "pass",
                note: atCap
                  ? `${leg.inFlight} in-flight ${leg.power} units at the ${cap} concurrent ceiling (5D)`
                  : passNote
              }
            }
            return { gate: name, status: "not-wired", note: NOT_WIRED }
          }
          case "rationale-renderable": {
            if (leg) {
              return {
                gate: name,
                status: "pass",
                note: "rationale is rendered from observed inputs before any execution (5F)"
              }
            }
            return { gate: name, status: "not-wired", note: NOT_WIRED }
          }
          case "idempotent":
            return {
              gate: name,
              status: "mechanism-on",
              note: "in-memory key set + durable audit key store — duplicated keys are rejected (5G)"
            }
          default:
            return { gate: name, status: "not-wired", note: NOT_WIRED }
        }
      })

      return {
        site,
        stream: template.stream,
        venue: template.venue,
        mode: verdict.mode,
        executionPower: verdict.executionPower,
        reasons: verdict.reason,
        inputs: {
          killSwitch: siteKilled(site),
          optIn: {
            status: "not-decided",
            note: "no automation opt-in granted (sync-approval is NOT an opt-in)"
          },
          workability: {
            value: null,
            note: "deterministic workability scorer not-wired — conservative 0 fed to the engine (slice 5+)"
          },
          deliberation: verdict.deliberation
        },
        demo: {
          demoOnly: template.demoOnly === true,
          active: false,
          note: template.demoOnly ? "demo surface reported by the ExpertBot runtime — finishes slice 7" : null
        },
        executionLeg: leg
          ? {
              leg: leg.power,
              action: leg.action,
              inFlight: leg.inFlight ?? 0,
              lastExecutedAt: leg.lastExecutedAt ?? null,
              consent: "per-action human consent (consentBy) — NOT an automation opt-in"
            }
          : null,
        metrics: metricsRow?.record
          ? { source: "observed", venueId: site, observedAt: metricsRow.record.observedAt, stale: metricsRow.stale }
          : capture
            ? { source: "not-observed", note: "capture profile present, no metrics observation yet" }
            : { source: "not-wired", note: `no capture profile for ${site} — metrics arrive with execution (slice 5+)` },
        gates
      }
    })

  return {
    ok: true,
    at: new Date(now).toISOString(),
    stream: stream ?? "all",
    killSwitch: kill,
    sites: rows
  }
}