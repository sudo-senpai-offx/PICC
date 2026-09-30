// WS-7 T11 — the six vetoes, in the spec's order, plus the INSPECTABLE record
// store that survives the call.
//
// AC-022:941-947:
//   Scenario:  The Wick-vs-Close veto fires.
//   Action:    Query the veto record.
//   Expected:  The rule id, inputs, suppressed action, timestamp, and rule
//              version are retrievable and displayed; the action is forced to
//              `hold` regardless of score.
//   Prohibited: A veto may not be absorbed into a lower score or hidden behind
//              a boolean.
//   Verification: Record read/write test; display assertion; a tier test
//              proving `hold` overrides a would-be A+.
//
// D7:148-155 makes the record first-class, and T11's file list (:1294) names
// `vetoIndex.mjs` as "inspectable veto record read/write". Plan v1 §3.1 item 6:
// "Assert this against the `vetoIndex.mjs` store, not against a returned object
// — D7's whole point is that the record survives the call."
//
// APPEND-ONLY, NO UPDATE, NO DELETE. §4.3:601 marks `VetoOutcome` "D7/D8:
// append-only, permanent. No update/delete path exists." This module therefore
// exports NO mutator other than `record`. There is deliberately no `update`,
// no `delete`, no `clear`, and no `set` — a retention class that can be edited
// is not a retention class. The tests assert their ABSENCE by name.
//
// RETENTION WIRING (T11's half of it). :1294 puts "the retention wiring for
// veto records" in T11, while T15 (:1330) owns `retention.mjs`, the persistence
// layer, and the purge job. The split is: T11 TAGS each record with D8's class
// and routes it to the injected sink; T15 decides what that class means over
// time and what gets purged. T11 therefore knows `permanent_append_only` and
// nothing about the 90-day or daily-aggregate classes — those are not veto
// records and writing them here would be T15's scope.
//
// D8:157-165: "Retention: vetoes/permanent". So the class is not a judgement
// call for this engine; it is the decision.

// Namespace imports: each rule module exports flat symbols (`RULE_ID`,
// `RULE_VERSION`, `SUPPRESSED`, `evaluate`), so the rule is imported as a
// namespace and referenced as `mod`.
import * as topDownHierarchy from "./vetoes/topDownHierarchy.mjs"
import * as correlationTrap from "./vetoes/correlationTrap.mjs"
import * as wickVsClose from "./vetoes/wickVsClose.mjs"
import * as spreadVsTarget from "./vetoes/spreadVsTarget.mjs"
import * as newsLockout from "./vetoes/newsLockout.mjs"
import * as sessionOpen from "./vetoes/sessionOpen.mjs"

/**
 * The six vetoes, in §4.4:691's order — and in the same order as
 * `contracts.ts:64-70`'s `VETO_RULE_IDS`, which the parity test pins.
 */
export const VETO_RULES = Object.freeze([
  Object.freeze({ ruleId: "topDownHierarchy", mod: topDownHierarchy }),
  Object.freeze({ ruleId: "correlationTrap", mod: correlationTrap }),
  Object.freeze({ ruleId: "wickVsClose", mod: wickVsClose }),
  Object.freeze({ ruleId: "spreadVsTarget", mod: spreadVsTarget }),
  Object.freeze({ ruleId: "newsLockout", mod: newsLockout }),
  Object.freeze({ ruleId: "sessionOpen", mod: sessionOpen })
])

export const VETO_RULE_IDS = Object.freeze(VETO_RULES.map((r) => r.ruleId))

/**
 * D8's class for a veto record: permanent and append-only.
 * §4.3:668-671 declares the three classes; §4.3:601 assigns vetoes to this one.
 */
export const VETO_RETENTION_CLASS = "permanent_append_only"

/** Retention classes this engine is allowed to tag. T11 owns exactly one. */
export const OWNED_RETENTION_CLASSES = Object.freeze([VETO_RETENTION_CLASS])

/**
 * Evaluate all six vetoes against one state.
 *
 * All six always run and all six always return a record — a veto that was not
 * evaluated is itself recorded (as fired, with `unevaluated` in its inputs), so
 * the caller can never mistake "I could not check" for "I checked and it was
 * fine". See `vetoes/outcome.mjs` for the fail-closed reasoning.
 *
 * @param {object} state A frozen state from `deriveMarketState`.
 * @returns {ReadonlyArray<object>} Six `VetoOutcome`s, in §4.4's order.
 */
export function evaluateAllVetoes(state) {
  return Object.freeze(VETO_RULES.map(({ mod }) => mod.evaluate(state)))
}

/** The fired subset, in the same order. */
export function firedVetoes(outcomes) {
  return outcomes.filter((o) => o.fired === true)
}

/**
 * An append-only veto record store.
 *
 * The store is IN-MEMORY by default and takes an optional `sink`, because the
 * durable persistence layer is T15's (spec :1330). Nothing here opens a file,
 * takes a lock, or writes to `server/data/` — T11 builds the record and its
 * retention tag; T15 decides where records live.
 *
 * @param {object} [options]
 * @param {(record: object) => void} [options.sink] Called once per appended
 *   record. A sink that throws propagates: losing a safety record silently is
 *   worse than failing the append.
 * @param {object} [options.store] A pre-seeded array, for tests and for T15's
 *   restore path.
 */
export function createVetoIndex({ sink = null, store = [] } = {}) {
  if (sink !== null && typeof sink !== "function") {
    throw new TypeError(`copilot: vetoIndex sink must be a function or null; received ${typeof sink}`)
  }

  // `Object.freeze`d length-less array: appends are possible, and nothing else is.
  const records = [...store]
  let sequence = records.length

  return Object.freeze({
    /**
     * Append one outcome. The ONLY mutator this store exposes.
     *
     * @param {object} outcome A `VetoOutcome` from one of the six rules.
     * @returns {object} The stored record, including its retention tag.
     */
    record(outcome) {
      assertOutcome(outcome)
      sequence += 1
      const entry = Object.freeze({
        sequence,
        ruleId: outcome.ruleId,
        fired: outcome.fired,
        inputs: outcome.inputs,
        suppressed: outcome.suppressed,
        evaluatedAt: outcome.evaluatedAt,
        ruleVersion: outcome.ruleVersion,
        retentionClass: VETO_RETENTION_CLASS
      })
      records.push(entry)
      if (sink !== null) sink(entry)
      return entry
    },

    /** Append every outcome, in order. Returns the stored entries. */
    recordAll(outcomes) {
      if (!Array.isArray(outcomes)) {
        throw new TypeError(`copilot: recordAll requires an array of outcomes; received ${typeof outcomes}`)
      }
      return outcomes.map((o) => this.record(o))
    },

    /**
     * Read records back. This is the D7 guarantee: the record survives the call
     * that produced it and is retrievable afterwards by rule id.
     *
     * @param {string} [ruleId] Filter to one rule. Omit for all.
     */
    read(ruleId) {
      if (ruleId === undefined) return records.slice()
      return records.filter((r) => r.ruleId === ruleId)
    },

    /** The most recent record for a rule, or null. Never a fabricated one. */
    latest(ruleId) {
      const matching = records.filter((r) => r.ruleId === ruleId)
      return matching.length > 0 ? matching[matching.length - 1] : null
    },

    /** Every FIRED record, in the order it was appended. */
    readFired() {
      return records.filter((r) => r.fired === true)
    },

    /** The retention class every record carries. Uniform, by construction. */
    retentionClass: VETO_RETENTION_CLASS,

    /** How many records are held. */
    get size() {
      return records.length
    }
  })
}

function assertOutcome(outcome) {
  if (outcome === null || typeof outcome !== "object") {
    throw new TypeError(`copilot: vetoIndex.record requires a VetoOutcome object; received ${String(outcome)}`)
  }
  if (!VETO_RULE_IDS.includes(outcome.ruleId)) {
    throw new TypeError(`copilot: unknown veto ruleId ${String(outcome.ruleId)}`)
  }
  if (typeof outcome.fired !== "boolean") {
    throw new TypeError(`copilot: veto record needs a boolean \`fired\`; received ${String(outcome.fired)}`)
  }
  if (typeof outcome.ruleVersion !== "string" || outcome.ruleVersion.length === 0) {
    throw new TypeError(`copilot: veto record needs a non-empty ruleVersion`)
  }
}
