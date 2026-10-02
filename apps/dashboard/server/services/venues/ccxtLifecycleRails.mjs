// WS-7 T17 — THE RAILS. One evaluator, three rails, four legs, four venues.
//
// Spec :1350 is the task in one line: "The ceremony gate, consent payload lock,
// and risk rails are honored on EVERY leg." This module exists because "every leg"
// is only provable if there is exactly ONE definition of each rail that all four
// legs call. Four leg functions with four inline gate checks would each be
// auditable separately and none of them would establish the property AC-036 asks
// for. So the rails live here, once, and `ccxtVenueLifecycle.mjs` has no rail
// logic of its own at all.
//
// ---------------------------------------------------------------------------
// NOTHING IS RESTATED. The four boundaries this task must honour are owned by
// other tasks, and each is READ rather than re-declared:
// ---------------------------------------------------------------------------
//
//   ceremony gate            `ceremonyState.mjs` (WS-3) — `enablementFor()`
//   consent payload lock     `ccxtExecution.mjs` (WS-2) — `venueLegConsentHash()`
//                             over the SAME projection + canonicalisation + sha-256
//                             the spot and perps rails use
//   ATR stop / drawdown /    `copilot/riskLayer.mjs` (T11) — `atrStop()`,
//   3-strike key lock        `dailyDrawdownDisable()`, `createStrikeStore()`
//   automationPermitted      `authority/brokerAutomationPermit.mjs` (T16) — the
//   provenance gate          store's own `isAutomationPermitted()`
//
// T11's constants (ATR_STOP_MULTIPLE 1.5, DAILY_DRAWDOWN_DISABLE_PCT 2,
// THREE_STRIKE_LIMIT 3, KEY_LOCK_MS 24h) are NOT re-declared here. If they were,
// the copy would drift from the producer and the drift would be silent, which is
// the risk T16's own header names when it refuses to re-state a tier boundary.
//
// ---------------------------------------------------------------------------
// THE THREE-STATE VERDICT — WHY `absent` IS NOT `pass`
// ---------------------------------------------------------------------------
//
// Every rail component returns one of `pass` | `block` | `absent`, PLUS an
// `applies` bit. The aggregate rule is:
//
//   applies === true   -> the verdict DECIDES. Only `pass` allows.
//   applies === false  -> the verdict MUST be `absent` AND the reason MUST be a
//                         non-empty written sentence.
//
// So a component that cannot be evaluated cannot become a silent allow: the
// caller has to state, in words, why the rail does not apply to that leg, and
// `lifecycleRailMatrix()` surfaces that reason for every single cell. A rail that
// claimed to apply and then answered `absent` BLOCKS — a rail that cannot be
// evaluated while promising it governs must not be treated as satisfied.
//
// The reason this is not over-engineering: a spot cancel has no ATR stop distance
// to compute, and a venue adapter that "handled" that by returning true would be
// indistinguishable from one that checked it. Naming the non-applicability is the
// only way a reader can tell those two apart.
//
// ---------------------------------------------------------------------------
// WHICH RAIL BINDS WHICH LEG, AND WHY
// ---------------------------------------------------------------------------
//
// Exposure-ADDING legs: `place`, `amend`. Exposure-REMOVING legs: `cancel`,
// `close`. T11's ATR stop bounds the risk of an ENTRY, and its 2% drawdown
// disable is a disable on NEW exposure — so both govern the adding legs.
//
// They do NOT govern the removing legs, and that asymmetry is deliberate rather
// than convenient:
//
//   * a cancel deploys nothing. There is no new position for a stop to bound.
//   * a close REDUCES risk. Refusing a close because the account is already in a
//     2% daily drawdown would trap the operator inside the very loss the rail
//     exists to bound — the disable would make the drawdown worse.
//
// The 3-strike key lock governs ALL FOUR legs: "locks keys" is a statement about
// the CREDENTIAL, so a locked key cannot reach the venue on an exit either. That
// is the one place this module accepts a rail making a recovery harder, and it is
// T11's rule stated literally rather than softened for convenience.
//
// The ceremony gate and the consent lock govern all four legs unconditionally, and
// they are evaluated before anything else on every leg.

import { enablementFor as ceremonyEnablementFor } from "../commandCentre/ceremonyState.mjs"
import { venueLegConsent, venueLegConsentHash, venueLegConsentFields } from "../commandCentre/ccxtExecution.mjs"
import { atrStop, dailyDrawdownDisable } from "../copilot/riskLayer.mjs"
import { ccxtLifecycleVenue, ccxtVenueEnabled, VENUE_NOT_IN_THE_FOUR_CODE } from "./ccxtVenues.mjs"

/**
 * The four lifecycle legs, in the order the lifecycle walks them.
 *
 * `place` and `amend` add exposure; `cancel` and `close` remove it. The
 * distinction is load-bearing for two of the three risk components and is
 * exported so a test and a governance surface read it from one place.
 */
export const LIFECYCLE_LEGS = Object.freeze(["place", "amend", "cancel", "close"])

/** The legs that deploy new exposure. T11's ATR stop and drawdown bind here. */
export const EXPOSURE_ADDING_LEGS = Object.freeze(["place", "amend"])

/** The legs that reduce exposure. The exit legs — where refusing would do harm. */
export const EXPOSURE_REMOVING_LEGS = Object.freeze(["cancel", "close"])

/** The three rails AC-036:1056 names, in the order the evaluator runs them. */
export const LIFECYCLE_RAILS = Object.freeze(["ceremony", "consent", "risk"])

/** The only three verdicts a rail component may report. */
export const RAIL_VERDICTS = Object.freeze(["pass", "block", "absent"])

/**
 * D6:139's heading names the ladder order — "paper -> demo -> live" — and
 * D6:142 makes it strict and one-directional. T17 declares the ORDER and refuses
 * an auto-execute leg that would advance along it; it does not advance it, and
 * nothing in this file can.
 */
export const D6_LADDER = Object.freeze(["paper", "demo", "live"])

// ── stable reason codes ───────────────────────────────────────────────────────

export const RAIL_CODES = Object.freeze({
  VENUE_UNKNOWN: VENUE_NOT_IN_THE_FOUR_CODE,
  LEG_UNKNOWN: "venue-rail:unknown-lifecycle-leg",
  CEREMONY_STORE_UNHEALTHY: "ceremony:deny:store-unhealthy",
  CEREMONY_NOT_UNLOCKED: "ceremony:deny:venue-class-not-unlocked",
  CEREMONY_VENUE_DISABLED: "venue-rail:deny:venue-not-enabled",
  CONSENT_NO_ANCHOR: "consent:deny:no-recorded-anchor",
  CONSENT_UNKNOWN_LEG: "consent:deny:unknown-lifecycle-leg",
  CONSENT_PAYLOAD_MISSING: "consent:deny:payload missing",
  CONSENT_MISMATCH: "consent:deny:consent-payload-mismatch",
  RISK_ATR_UNCOMPUTABLE: "risk:deny:atr-stop-not-computable",
  RISK_ATR_CONFORMANCE: "risk:deny:outside-the-atr-stop",
  RISK_DRAWDOWN_FIRED: "risk:deny:daily-drawdown-disable-fired",
  RISK_DRAWDOWN_UNOBSERVED: "risk:deny:daily-drawdown-unobservable",
  RISK_KEY_LOCKED: "risk:deny:key-locked-by-strike-rule",
  RISK_STRIKE_STATE_ABSENT: "risk:deny:no-strike-counter",
  AUTOMATION_NO_AUTHORITY: "authority:deny:no-acting-authority",
  AUTOMATION_NO_PROVENANCE: "authority:deny:automation-provenance-missing",
  AUTOMATION_CROSSES_RUNG: "authority:deny:auto-execute-would-cross-rung",
  RAIL_PROMISED_AND_ABSENT: "venue-rail:deny:rail-promised-but-absent",
  RAIL_ABSENT_WITHOUT_REASON: "venue-rail:deny:absent-rail-without-a-written-reason"
})

// ── component helpers ─────────────────────────────────────────────────────────

function component(applies, verdict, reason, detail = {}) {
  return { applies, verdict, reason: reason ?? null, detail }
}

function pass(reason, detail) {
  return component(true, "pass", reason ?? null, detail)
}

function block(reason, detail) {
  return component(true, "block", reason ?? null, detail)
}

/**
 * A written non-applicability. `reason` is REQUIRED and this function refuses to
 * build one without it — that refusal is the whole mechanism, because an absence
 * with an empty reason is indistinguishable from an unevaluated allow.
 */
function absentNonApplicable(reason, detail = {}) {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new TypeError("venue-rail: an absent rail must carry a written reason — an absence nobody can read is a default allow")
  }
  return component(false, "absent", reason, detail)
}

// ── the ceremony rail ─────────────────────────────────────────────────────────

/**
 * T16's WS-3 ceremony store, read fail-closed.
 *
 * `hyperliquidPerps.mjs:93-101` established the shape this copies: a store that
 * throws, or that reports anything other than `unlocked === true`, reads LOCKED.
 * The try/catch is not defensive noise — `enablementFor` returns
 * `{ locked: true, reason }` on an unhealthy store rather than throwing, and a
 * caller that read only `.unlocked` would see `undefined` and might treat it as
 * anything.
 */
export function ceremonyUnlockForCcxt(venueClass) {
  let rec
  try {
    rec = ceremonyEnablementFor(venueClass)
  } catch {
    return { unlocked: false, reason: RAIL_CODES.CEREMONY_STORE_UNHEALTHY }
  }
  if (rec == null) return { unlocked: false, reason: RAIL_CODES.CEREMONY_NOT_UNLOCKED, record: null }
  if (rec.locked === true) return { unlocked: false, reason: rec.reason ?? RAIL_CODES.CEREMONY_STORE_UNHEALTHY, record: rec }
  return { unlocked: rec.unlocked === true, reason: null, record: rec }
}

function evaluateCeremonyRail({ venue, deps }) {
  // The reader is called inside a try as well as the store being read fail-closed.
  // A dependency that THROWS must not become a permit: an exception escaping here
  // would propagate past the rails and surface as a 500 at a route, which reads as
  // "the rail is broken" rather than "the venue is locked". The locked reading is
  // both the safer answer and the honest one.
  let unlock
  try {
    unlock = deps.ceremonyUnlockFor(venue.ceremonyVenueClass)
  } catch {
    unlock = { unlocked: false, reason: RAIL_CODES.CEREMONY_STORE_UNHEALTHY }
  }
  if (unlock == null || unlock.unlocked !== true) {
    const why = unlock?.reason ?? RAIL_CODES.CEREMONY_NOT_UNLOCKED
    return block(
      `${RAIL_CODES.CEREMONY_NOT_UNLOCKED}: venue class "${venue.ceremonyVenueClass}" is not unlocked (${why}), so no ${venue.id} lifecycle leg may reach the venue`,
      { venueClass: venue.ceremonyVenueClass, unlockReason: why }
    )
  }
  const enabled = deps.venueEnabled(venue.id)
  if (enabled !== true) {
    return block(
      `${RAIL_CODES.CEREMONY_VENUE_DISABLED}: ${venue.id} is not independently enabled (set PICC_CCXT_VENUE_ENABLED_${venue.envSuffix}=1 behind the ceremony gate)`,
      { venueClass: venue.ceremonyVenueClass, envVar: `PICC_CCXT_VENUE_ENABLED_${venue.envSuffix}`, unlock: true }
    )
  }
  return pass(`ceremony class "${venue.ceremonyVenueClass}" is unlocked and ${venue.id} is independently enabled`, {
    venueClass: venue.ceremonyVenueClass,
    unlock: true,
    venueEnabled: true
  })
}

// ── the consent payload lock ──────────────────────────────────────────────────

/**
 * WS-2's lock, read as a rail.
 *
 * The mechanism is NOT reimplemented: `venueLegConsent` is the same projection +
 * canonicalisation the spot and perps rails feed `consentPayloadHash` through, so
 * a T17 hash and a WS-2 hash for the same six fields are the same value.
 *
 * BOTH SIDES ARE PROJECTED, not just the anchor. That matters for two fields:
 * `leg` and `exchange` are locked on every T17 set and BOTH are server-derived —
 * the leg is which function was called and the exchange is the venue the rails
 * just authorised. A caller resubmitting "the D5 payload" is resubmitting the
 * terms a human agreed to, which is what the other six fields are; making the
 * caller hand back the leg name and the venue id would put two server facts in
 * the consent and make a mismatch on them meaningless. Projecting the submitted
 * payload through the same field set with those two filled in from the request
 * keeps them locked AND keeps them honest.
 *
 * A field the submitted payload OMITS becomes `undefined` in its projection, and
 * `undefined` is not the anchored value — so a dropped field is a mismatch naming
 * that field, exactly as the existing route treats it. Treating an absent field
 * as "absent, therefore equal" would let a client omit the very value it is being
 * asked to re-consent to.
 *
 * THE PROPOSE PHASE IS A NAMED ABSENCE, NOT A SKIP. `proposeLeg` is the step that
 * WRITES the anchor, so asking it to replay one would make the consent rail refuse
 * the very act that creates a consent — and "the rail refused, so try again" would
 * refuse forever. So the propose phase records the consent rail as non-applicable
 * with a written reason, which the aggregate rule accepts, while the ceremony gate
 * and BOTH risk rails still bind on the propose exactly as they do on the execute.
 * The lock is therefore never off: it is simply not yet applicable, and the execute
 * step that follows cannot run without the record this one writes.
 */
function evaluateConsentRail({ leg, request, deps, phase }) {
  const declared = venueLegConsentFields(leg)
  if (declared === null) {
    return block(`${RAIL_CODES.CONSENT_UNKNOWN_LEG}: no consent field set is declared for leg "${String(leg)}"`, {
      leg: String(leg)
    })
  }

  if (phase === "propose") {
    return absentNonApplicable(
      `this is the PROPOSE step for the ${leg} leg, and it is what RECORDS the consent anchor — there is no recorded consent here to replay yet. The lock binds on the EXECUTE step that follows, which cannot run without the record this step writes. The ceremony gate and the risk rails still bind on this step exactly as they do on the execute.`,
      { leg, phase, lockedFields: declared }
    )
  }
  const anchor = deps.consentAnchor
  if (anchor == null || typeof anchor !== "object") {
    return block(
      `${RAIL_CODES.CONSENT_NO_ANCHOR}: nothing was proposed for this ${leg} leg, so there is no recorded consent for it to replay — a leg with no anchor is refused, never assumed consented`,
      { leg }
    )
  }

  const supplied = request?.consentPayload
  if (supplied == null || typeof supplied !== "object" || Array.isArray(supplied)) {
    return block(`${RAIL_CODES.CONSENT_PAYLOAD_MISSING}: the ${leg} leg was called without the payload its consent was granted over`, {
      leg,
      fields: declared
    })
  }

  const anchored = anchor.fields ?? {}
  const submittedProjection = venueLegConsent(leg, { ...supplied, leg: request?.leg, exchange: request?.exchange })
  if (!submittedProjection.ok) {
    return block(`${RAIL_CODES.CONSENT_UNKNOWN_LEG}: ${submittedProjection.reason}`, { leg })
  }
  const submitted = submittedProjection.fields

  for (const field of declared) {
    if (!Object.is(submitted[field], anchored[field])) {
      return block(
        `${RAIL_CODES.CONSENT_MISMATCH}: field:${field} — consented ${JSON.stringify(anchored[field])}, submitted ${JSON.stringify(submitted[field])}`,
        { leg, field, consented: anchored[field], submitted: submitted[field], fields: declared }
      )
    }
  }

  // The hash, as an independent second check over the whole canonicalised object.
  // A field list is a per-key comparison; the hash is what catches an anchor whose
  // recorded value does not match its own recorded fields.
  const recomputed = venueLegConsentHash(leg, { ...anchored, leg, exchange: anchored.exchange })
  if (typeof anchor.consentHash !== "string" || recomputed !== anchor.consentHash) {
    return block(
      `${RAIL_CODES.CONSENT_MISMATCH}: the recorded consent hash does not match a recomputation of its own fields (anchored ${String(anchor.consentHash)?.slice(0, 12)}…, recomputed ${String(recomputed).slice(0, 12)}…)`,
      { leg, fields: declared }
    )
  }

  return pass(`the ${leg} payload matches all ${declared.length} locked consent field(s) and re-hashes to the recorded value`, {
    leg,
    fields: declared,
    consentHash: recomputed
  })
}

// ── the risk rail ─────────────────────────────────────────────────────────────

function evaluateAtrComponent({ leg, request, deps }) {
  if (!EXPOSURE_ADDING_LEGS.includes(leg)) {
    return absentNonApplicable(
      `T11's ATR(14) stop bounds the risk of an ENTRY. This is the ${leg} leg, which ${leg === "cancel" ? "removes a resting order and" : "reduces an existing position and"} deploys no new exposure, so there is no stop distance for it to compute. Refusing an exit because an entry-side rail has nothing to say would make the rail worse, not safer.`,
      { leg, exposureAdding: false }
    )
  }
  const series = deps.atrSeries
  const stop = atrStop(series?.highs, series?.lows, series?.closes)
  if (stop.available !== true) {
    return block(`${RAIL_CODES.RISK_ATR_UNCOMPUTABLE}: ${stop.unavailableReason}`, { leg, atr: stop.atr, multiple: stop.multiple })
  }
  const stopPrice = Number(request?.stopPrice)
  const reference = Number(request?.price)
  if (!Number.isFinite(reference) || reference <= 0) {
    return block(`${RAIL_CODES.RISK_ATR_CONFORMANCE}: the ${leg} leg declares no usable entry price, so the ${stop.multiple}x ATR(14) stop cannot be measured against it`, {
      leg,
      stopDistance: stop.stopDistance,
      atr: stop.atr
    })
  }
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
    return block(
      `${RAIL_CODES.RISK_ATR_CONFORMANCE}: the ${leg} leg declares no stopPrice, so the ${stop.multiple}x ATR(14) stop distance of ${stop.stopDistance} has nothing to be checked against`,
      { leg, stopDistance: stop.stopDistance, atr: stop.atr }
    )
  }
  // Conformity is measured against the stop DISTANCE from the entry, in the
  // adverse direction. A buy whose stop sits further below the entry than the
  // ATR distance allows is a wider stop than the rail permits; a narrower one is
  // fine and is the operator's to take.
  const adverseDistance = request.side === "buy" ? reference - stopPrice : stopPrice - reference
  if (!(adverseDistance <= stop.stopDistance)) {
    return block(
      `${RAIL_CODES.RISK_ATR_CONFORMANCE}: the stop is ${adverseDistance} from the ${reference} entry, beyond the ${stop.stopDistance} the ${stop.multiple}x ATR(14) stop permits`,
      { leg, adverseDistance, stopDistance: stop.stopDistance, atr: stop.atr, multiple: stop.multiple }
    )
  }
  return pass(`the stop sits ${adverseDistance} from the entry, within the ${stop.stopDistance} ${stop.multiple}x ATR(14) distance`, {
    leg,
    adverseDistance,
    stopDistance: stop.stopDistance,
    atr: stop.atr,
    multiple: stop.multiple
  })
}

function evaluateDrawdownComponent({ leg, deps }) {
  if (!EXPOSURE_ADDING_LEGS.includes(leg)) {
    return absentNonApplicable(
      `T11's 2% daily drawdown disable is a disable on NEW exposure. This is the ${leg} leg, which reduces exposure, so applying it here would refuse the very exit the rail exists to make unnecessary — and would trap the operator inside the loss.`,
      { leg, exposureAdding: false }
    )
  }
  const reading = dailyDrawdownDisable({
    dailyDrawdownPct: deps.dailyDrawdownPct,
    dayKey: deps.dayKey,
    observedAt: deps.now,
    source: deps.source
  })
  if (reading.available !== true) {
    return block(`${RAIL_CODES.RISK_DRAWDOWN_UNOBSERVED}: ${reading.unavailableReason}`, {
      leg,
      railPct: reading.railPct,
      dailyDrawdownPct: reading.dailyDrawdownPct
    })
  }
  if (reading.fired === true) {
    return block(
      `${RAIL_CODES.RISK_DRAWDOWN_FIRED}: today's observed daily drawdown ${reading.dailyDrawdownPct}% is at or beyond the ${reading.railPct}% disable`,
      { leg, dailyDrawdownPct: reading.dailyDrawdownPct, railPct: reading.railPct, dayKey: reading.dayKey }
    )
  }
  return pass(`today's daily drawdown ${reading.dailyDrawdownPct}% is inside the ${reading.railPct}% disable`, {
    leg,
    dailyDrawdownPct: reading.dailyDrawdownPct,
    railPct: reading.railPct,
    dayKey: reading.dayKey
  })
}

function evaluateStrikeComponent({ leg, deps }) {
  if (deps.strikeStore == null) {
    return block(
      `${RAIL_CODES.RISK_STRIKE_STATE_ABSENT}: no strike counter is wired for ${String(deps.credentialKey)}, so T11's 3-strike key lock cannot be evaluated. T11 distinguishes this from zero strikes — \`strikes: null\` is a claim that no counter exists, and "no counter" cannot read as "not locked".`,
      { leg, credentialKey: String(deps.credentialKey), strikes: null }
    )
  }
  const state = deps.strikeStore.readStrike(deps.credentialKey, deps.now)
  if (state.available !== true) {
    return block(`${RAIL_CODES.RISK_STRIKE_STATE_ABSENT}: ${state.unavailableReason}`, { leg, strikes: null })
  }
  if (state.locked === true) {
    return block(
      `${RAIL_CODES.RISK_KEY_LOCKED}: ${state.strikes} strike(s) against ${deps.credentialKey} lock the key until ${new Date(state.lockedUntil).toISOString()} (${state.lockMs}ms from the most recent strike)`,
      { leg, strikes: state.strikes, lockedUntil: state.lockedUntil, lockMs: state.lockMs, limit: state.limit }
    )
  }
  return pass(`${state.strikes} of ${state.limit} strikes against ${deps.credentialKey}; the key is not locked`, {
    leg,
    strikes: state.strikes,
    limit: state.limit,
    lockedUntil: state.lockedUntil,
    lockMs: state.lockMs
  })
}

/**
 * D5's provenance gate, as a rail component.
 *
 * `deps.permitStore.isAutomationPermitted` is T16's OWN method and is the only
 * thing consulted. T16 already implements "a true flag AND a resolvable approving
 * authority"; re-deriving it here would be the second copy of a safety boundary
 * that plan v1 Risk 6 warns about. An absent store therefore reads `false`, which
 * is why nothing in this repository can reach an auto-execute leg until a permit
 * store is wired.
 *
 * Two authority forms are recognised, and a third — none — is refused:
 *
 *   human-consent   a named per-action human consent that the consent rail has
 *                   already hash-verified. D5 governs AUTO-EXECUTE; it does not
 *                   re-litigate a click the operator made, and D25's amendment
 *                   makes per-action human approval the standing boundary.
 *   auto-execute    permitted only on a provenance-gated record AND without
 *                   advancing the D6 rung.
 *   none            refused. This is the case a bare `automationPermitted: true`
 *                   on an anonymous request would land in.
 */
function evaluateAutomationComponent({ leg, request, deps }) {
  const consentBy = request?.consentBy
  const claimsAuto = request?.automation === true
  const claim = claimsAuto ? "auto-execute" : typeof consentBy === "string" && consentBy.trim().length > 0 ? "human-consent" : "none"

  if (claim === "human-consent") {
    return pass(`the ${leg} leg carries a per-action human consent from "${consentBy}", which the consent rail has hash-verified`, {
      leg,
      claim,
      consentBy
    })
  }

  if (claim === "none") {
    return block(
      `${RAIL_CODES.AUTOMATION_NO_AUTHORITY}: the ${leg} leg names neither an acting human nor an auto-execute claim, so nothing authorises it`,
      { leg, claim }
    )
  }

  const brokerId = deps.brokerId
  if (typeof brokerId !== "string" || brokerId.trim().length === 0) {
    return block(
      `${RAIL_CODES.AUTOMATION_NO_PROVENANCE}: auto-execute was claimed but no broker record was named, and D5's permit is a field ON a broker record — there is nothing to read it from`,
      { leg, claim }
    )
  }
  const permitted = typeof deps.permitStore?.isAutomationPermitted === "function" ? deps.permitStore.isAutomationPermitted(brokerId) : false
  if (permitted !== true) {
    return block(
      `${RAIL_CODES.AUTOMATION_NO_PROVENANCE}: broker ${JSON.stringify(brokerId)} does not read as automation-permitted. D5 defaults the flag to false and T16's read is provenance-gated — a true flag whose approving authority does not resolve reads false, so a bare boolean is not permission.`,
      { leg, claim, brokerId, permitStoreWired: typeof deps.permitStore?.isAutomationPermitted === "function" }
    )
  }

  // D6:142 — within the current rung, never across it. The ladder is declared
  // once above and nothing here advances it.
  const current = String(deps.rung?.current ?? "")
  const requested = String(deps.rung?.requested ?? current)
  if (!D6_LADDER.includes(current)) {
    return block(
      `${RAIL_CODES.AUTOMATION_CROSSES_RUNG}: the current rung ${JSON.stringify(current)} is not one of the D6 ladder (${D6_LADDER.join(" -> ")}), so "within the current rung" cannot be established`,
      { leg, claim, brokerId, current, requested, ladder: D6_LADDER }
    )
  }
  const advanced = D6_LADDER.indexOf(requested) > D6_LADDER.indexOf(current)
  if (requested !== current || advanced) {
    return block(
      `${RAIL_CODES.AUTOMATION_CROSSES_RUNG}: an auto-execute ${leg} leg asked for rung ${JSON.stringify(requested)} while the current rung is ${JSON.stringify(current)}. D6 makes crossing a rung a human act with its own ceremony, and no tier, score or booster advances it.`,
      { leg, claim, brokerId, current, requested, ladder: D6_LADDER }
    )
  }
  return pass(`broker ${brokerId} is provenance-gated for automation and the ${leg} leg stays inside the ${current} rung`, {
    leg,
    claim,
    brokerId,
    rung: current,
    ladder: D6_LADDER
  })
}

function evaluateRiskRail({ leg, request, deps }) {
  const components = {
    atrStop: evaluateAtrComponent({ leg, request, deps }),
    drawdownDisable: evaluateDrawdownComponent({ leg, deps }),
    keyLock: evaluateStrikeComponent({ leg, deps }),
    automationProvenance: evaluateAutomationComponent({ leg, request, deps })
  }
  const order = Object.keys(components)
  const firstBlocking = order.find((k) => components[k].applies && components[k].verdict === "block")
  // A component that PROMISED to apply and then could not answer is a failure,
  // not a pass: "I would have checked, but I could not" is the definition of an
  // unevaluated control, and this task's rule is that it never becomes an allow.
  const promisedButAbsent = order.find((k) => components[k].applies && components[k].verdict === "absent")
  // And a non-applicable component must have SAID so. `absentNonApplicable`
  // already refuses to build one without a reason, so this is the belt to that
  // braces: it catches a hand-built component object that skipped the helper.
  const absentWithoutReason = order.find(
    (k) => !components[k].applies && (components[k].verdict !== "absent" || typeof components[k].reason !== "string" || components[k].reason.trim().length === 0)
  )

  if (promisedButAbsent) {
    return block(`${RAIL_CODES.RAIL_PROMISED_AND_ABSENT}: risk component "${promisedButAbsent}" applies to the ${leg} leg but could not be evaluated`, {
      leg,
      components
    })
  }
  if (absentWithoutReason) {
    return block(`${RAIL_CODES.RAIL_ABSENT_WITHOUT_REASON}: risk component "${absentWithoutReason}" is recorded as non-applicable without a written reason`, {
      leg,
      components
    })
  }
  if (firstBlocking) {
    return block(components[firstBlocking].reason, { leg, blockedByComponent: firstBlocking, components })
  }
  return pass(`risk rails satisfied for the ${leg} leg (${order.filter((k) => components[k].applies).join(", ")})`, { leg, components })
}

// ── the evaluator ─────────────────────────────────────────────────────────────

/**
 * Every dependency's production default, declared in ONE place.
 *
 * A caller overrides only what it is testing. Nothing here has a permissive
 * default: `ceremonyUnlockFor` and `venueEnabled` both default to the real
 * readers, `consentAnchor` defaults to null (no anchor ⇒ refusal), the strike
 * store defaults to null (no counter ⇒ refusal), and the permit store defaults to
 * null (no store ⇒ not permitted). Every absence resolves to a block.
 */
/** The two phases a leg runs in. `execute` (the default) replays a recorded anchor. */
export const LIFECYCLE_PHASES = Object.freeze(["propose", "execute"])

export function defaultRailDeps(overrides = {}) {
  return {
    ceremonyUnlockFor: ceremonyUnlockForCcxt,
    venueEnabled: ccxtVenueEnabled,
    consentAnchor: null,
    permitStore: null,
    strikeStore: null,
    brokerId: null,
    credentialKey: null,
    atrSeries: null,
    dailyDrawdownPct: null,
    dayKey: null,
    source: "ccxt-venue-lifecycle",
    rung: null,
    phase: "execute",
    now: Date.now(),
    ...overrides
  }
}

/**
 * Evaluate all three rails for one (leg, venue) pair.
 *
 * Returns EVERY rail's reading, not only the blocking one, so a caller can show
 * the whole matrix and so `lifecycleRailMatrix` can enumerate it. `ok` is true
 * only when every applying component passed and every non-applying one carries a
 * written reason.
 *
 * The ceremony rail runs FIRST on every leg: an unlock that does not exist must
 * stop the evaluation before a consent hash is even computed, because computing a
 * consent comparison against a durable record for a venue that may not act is work
 * done for a caller that will be refused anyway.
 */
export function evaluateLifecycleRails({ leg, venueId, request = {}, deps: overrides = {} } = {}) {
  const deps = defaultRailDeps(overrides)

  const venue = ccxtLifecycleVenue(venueId)
  if (venue === null) {
    return {
      ok: false,
      leg: String(leg ?? ""),
      venueId: String(venueId ?? ""),
      blockedBy: "venue",
      reason: `${RAIL_CODES.VENUE_UNKNOWN}: ${JSON.stringify(String(venueId ?? ""))} is not one of the four venues this lifecycle covers`,
      rails: {}
    }
  }
  const legName = String(leg ?? "").trim()
  if (!LIFECYCLE_LEGS.includes(legName)) {
    return {
      ok: false,
      leg: legName,
      venueId: venue.id,
      blockedBy: "venue",
      reason: `${RAIL_CODES.LEG_UNKNOWN}: ${JSON.stringify(legName)} is not one of the four lifecycle legs`,
      rails: {}
    }
  }

  const ceremony = evaluateCeremonyRail({ venue, deps })
  if (ceremony.verdict !== "pass") {
    return {
      ok: false,
      leg: legName,
      venueId: venue.id,
      blockedBy: "ceremony",
      reason: ceremony.reason,
      rails: { ceremony }
    }
  }

  const consent = evaluateConsentRail({ leg: legName, request, deps, phase: deps.phase === "propose" ? "propose" : "execute" })
  const risk = evaluateRiskRail({ leg: legName, request, deps })
  const rails = { ceremony, consent, risk }

  // Consent before risk: a leg whose consent does not replay has no authority to
  // act at all, so there is nothing for a risk number to decide.
  for (const name of LIFECYCLE_RAILS) {
    const reading = rails[name]
    if (reading && reading.verdict === "block") {
      return { ok: false, leg: legName, venueId: venue.id, blockedBy: name, reason: reading.reason, rails }
    }
  }
  return { ok: true, leg: legName, venueId: venue.id, blockedBy: null, reason: null, rails }
}

/**
 * The AC-036 matrix, as data.
 *
 * `evaluateLifecycleRails` is a function and a matrix is a claim, so this walks
 * the cross product explicitly and returns one cell per (venue, leg, rail). It is
 * exported rather than written in a test because the acceptance criterion is
 * about the product's coverage, not about one test file's loop: a governance
 * surface, a changelog entry and the test can all read the same enumeration.
 *
 * @param {(cell: {venueId: string, leg: string}) => any} evaluate called once
 *   per (venue, leg) pair; each result must carry a `rails` object.
 */
export function lifecycleRailMatrix(venues, legs, evaluate) {
  const cells = []
  for (const venue of venues) {
    for (const leg of legs) {
      const result = evaluate(venue, leg)
      for (const rail of LIFECYCLE_RAILS) {
        const reading = result?.rails?.[rail] ?? null
        cells.push({
          venueId: venue,
          leg,
          rail,
          covered: reading !== null,
          verdict: reading === null ? null : reading.verdict,
          applies: reading === null ? null : reading.applies,
          reason: reading === null ? null : reading.reason
        })
      }
    }
  }
  return cells
}

/**
 * Assert a matrix is COMPLETE and every absence is named.
 *
 * Used by the test, and worth exporting because the property is a real invariant
 * rather than a test detail: every (venue, leg, rail) triple must be present,
 * every verdict must be one of the three, and a non-applying cell must carry a
 * written reason. Returns the problems rather than throwing, so a caller decides
 * how to report them.
 */
export function railMatrixProblems(cells, { venues, legs, rails = LIFECYCLE_RAILS } = {}) {
  const problems = []
  const expected = venues.length * legs.length * rails.length
  if (cells.length !== expected) problems.push(`matrix has ${cells.length} cells, expected ${expected}`)
  for (const venue of venues) {
    for (const leg of legs) {
      for (const rail of rails) {
        const cell = cells.find((c) => c.venueId === venue && c.leg === leg && c.rail === rail)
        if (!cell) {
          problems.push(`${venue}/${leg}/${rail}: no cell`)
          continue
        }
        if (!cell.covered) {
          problems.push(`${venue}/${leg}/${rail}: rail was not evaluated at all`)
          continue
        }
        if (!RAIL_VERDICTS.includes(cell.verdict)) {
          problems.push(`${venue}/${leg}/${rail}: verdict ${JSON.stringify(cell.verdict)} is not one of ${RAIL_VERDICTS.join("/")}`)
        }
        if (cell.applies === false && (typeof cell.reason !== "string" || cell.reason.trim().length === 0)) {
          problems.push(`${venue}/${leg}/${rail}: recorded non-applicable with no written reason`)
        }
      }
    }
  }
  return problems
}
