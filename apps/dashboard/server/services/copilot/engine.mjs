// WS-7 T11 — the engine entry point. Pure, deterministic, no model, no network.
//
// AC-021:935's action is "Run the confluence engine", so something callable has
// to exist that is more than the confluence function: the regime, the six
// experts, the six vetoes, the tier, and the veto records, in one call, from one
// market state.
//
// WHY THIS FILE IS NOT IN THE §4.2 LIST. §4.2 (:539-566) proposes
// `regime.mjs`, `experts/`, `confluence.mjs`, `tiers.mjs`, `vetoes/`,
// `vetoIndex.mjs`, `conflicts/`, `routing.mjs`, `retention.mjs`, `explain.mjs`.
// It is a proposed layout, and the spec says so at :537 — "no claim is made that
// they already exist". Nothing in that list composes the parts, and AC-021
// requires a single callable whole. This file is that composition, inside the
// §4.2-named directory. It is additive and changes no other module.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO, per the task boundaries:
//   - No model. T13 owns the sentiment input and the explanation layer.
//   - No routing. T13 owns the D16 cloud-routing predicate (`routing.mjs`).
//   - No conflicts. T12 owns C1/C2/C3 (`conflicts/`), and `conflictOverrides` is
//     therefore always the empty array here.
//   - No retention classes beyond the veto tag. T15 owns `retention.mjs`.
//   - No authority model. T16 owns `authority/`.
//
// SHIPS DARK, ENABLED PER ROOM (spec :1298: "It can ship dark and be enabled
// per room"). `isEngineEnabledForRoom` defaults to DISABLED for every room. The
// rooms themselves are T7-T10's and T11 does not touch them; this predicate is
// the seam a room or a config owner consults, and it is closed until someone
// deliberately opens a specific room.

import { ENGINE_VERSION, evaluateConfluence } from "./confluence.mjs"
import { deriveMarketState } from "./marketState.mjs"
import { createVetoIndex, evaluateAllVetoes, firedVetoes } from "./vetoIndex.mjs"
import { tierFor } from "./tiers.mjs"

/**
 * The full evaluation: confluence, vetoes, veto records, tier.
 *
 * @param {object} params
 * @param {object} params.marketState The caller's state (see `deriveMarketState`).
 * @param {object} [params.broker] `{ automationPermitted, rung }` per
 *   contracts.ts:205-215. `automationPermitted` is read as a POSITIVE `=== true`
 *   (AC-024:961) and `rung` is carried through untouched (AC-025:969).
 * @param {object} [params.vetoIndex] An existing `vetoIndex` to record into.
 *   Omit for a throwaway in-memory one.
 * @param {boolean} [params.recordVetoes] Default true. Every evaluation appends
 *   its six records, because D7's guarantee is that a record survives the call.
 * @returns {object} `{ confluence, vetoes, tier, vetoIndex, engineVersion }`
 */
export function evaluateCopilot({ marketState, broker = {}, vetoIndex = null, recordVetoes = true } = {}) {
  if (marketState === null || marketState === undefined) {
    throw new TypeError("copilot: evaluateCopilot requires a marketState")
  }

  const state = isDerived(marketState) ? marketState : deriveMarketState(marketState)
  const index = vetoIndex ?? createVetoIndex()

  // Regime first — the experts read it (Unicorn) and it decides whether a score
  // exists at all. Both come out of the confluence call.
  const confluence = evaluateConfluence(state)

  const vetoes = evaluateAllVetoes(state)
  if (recordVetoes) index.recordAll(vetoes)

  const tier = tierFor(confluence.score, {
    vetoes,
    automationPermitted: broker.automationPermitted,
    rung: broker.rung
  })

  return {
    confluence,
    vetoes,
    firedVetoes: firedVetoes(vetoes),
    tier,
    vetoIndex: index,
    engineVersion: ENGINE_VERSION
  }
}

/**
 * Is the Copilot enabled for a room?
 *
 * Ships dark: nothing is enabled until it is named. The default is `false` for
 * EVERY room, including rooms that already exist, because "enabled because
 * nobody said otherwise" is precisely the default this spec forbids
 * (AC-024:961's "an absent flag must not mean permitted", applied to a
 * different flag for the same reason).
 *
 * @param {string} roomKey
 * @param {object} [options]
 * @param {ReadonlySet<string>} [options.enabledRooms] The rooms to light up.
 * @returns {boolean}
 */
export function isEngineEnabledForRoom(roomKey, { enabledRooms = new Set() } = {}) {
  if (typeof roomKey !== "string" || roomKey.length === 0) {
    throw new TypeError(`copilot: a room key is required to ask whether the engine is on; received ${String(roomKey)}`)
  }
  return enabledRooms.has(roomKey)
}

/** The rooms currently lit. Read-only, for an audit surface. */
export function enabledRooms({ enabledRooms: rooms = new Set() } = {}) {
  return Object.freeze([...rooms].sort())
}

function isDerived(candidate) {
  return candidate !== null && typeof candidate === "object" && "series" in candidate && "computedAt" in candidate
}
