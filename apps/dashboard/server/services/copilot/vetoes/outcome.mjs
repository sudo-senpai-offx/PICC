// WS-7 T11 — the one place a VetoOutcome is constructed.
//
// AC-022:941-947 requires every veto to be "inspectable outcomes": "The rule id,
// inputs, suppressed action, timestamp, and rule version are retrievable and
// displayed; the action is forced to `hold` regardless of score." D7 (:148-155)
// makes that a decision, not a preference.
//
// THE FAIL-CLOSED RULE. A veto that cannot be EVALUATED fires.
//
// This is the choice most likely to be argued with, so the reasoning is
// recorded rather than left implicit. The repo already states the precedent for
// it: `v32Copilot.mjs:5` — "Every wire FAILS CLOSED: an unavailable input
// blocks the entry with an honest reason and never passes (REQ-P3-7)."
//
// The alternative — reporting `fired: false` for a rule whose inputs were
// absent — is the fabrication this repository treats as a P1 defect. It would
// place a "checked and clear" in front of a caller when nothing was checked.
// `PICC.md:32-33` is explicit: "absent → null", "unconfigured ≠ zero-filled".
//
// So `fired: true` with `inputs.unevaluated` set is not a veto firing on the
// market's behalf. It is the engine declining to clear a trade it could not
// assess, and because the record is inspectable (D7) the caller can see
// exactly which inputs were missing and go and supply them.
//
// Note the consequence, stated plainly: a caller that supplies no veto inputs at
// all will have all six vetoes fire and will be held. That is correct. It means
// "I cannot evaluate any risk rule", and the correct response to that is not to
// trade.

/** Veto inputs a rule needs but did not receive, recorded on the outcome. */
export const UNEVALUATED = "unevaluated"

/**
 * Build a `VetoOutcome` (contracts.ts:176-184).
 *
 * @param {object} params
 * @param {string} params.ruleId   One of the six §4.3:594-595 ids.
 * @param {boolean} params.fired
 * @param {object} params.inputs   The values actually read. Must be a plain,
 *   finite-valued object — `Record<string, number | string | boolean>` per
 *   contracts.ts:179, which is why a nested object is rejected rather than
 *   silently stringified into an unreadable record.
 * @param {string} params.suppressed What this veto blocked. Never folded into a
 *   lower score (AC-022:945).
 * @param {number} params.evaluatedAt The supplied `computedAt`. Never a clock
 *   read (AC-021:937).
 * @param {string} params.ruleVersion
 */
export function buildOutcome({ ruleId, fired, inputs, suppressed, evaluatedAt, ruleVersion }) {
  assertPlainRecord(inputs)
  if (typeof evaluatedAt !== "number" || !Number.isFinite(evaluatedAt)) {
    throw new TypeError(`copilot: veto ${ruleId} needs a finite evaluatedAt; received ${String(evaluatedAt)}`)
  }
  if (typeof ruleVersion !== "string" || ruleVersion.length === 0) {
    throw new TypeError(`copilot: veto ${ruleId} needs a non-empty ruleVersion`)
  }
  return Object.freeze({
    ruleId,
    fired,
    inputs: Object.freeze({ ...inputs }),
    suppressed,
    evaluatedAt,
    ruleVersion
  })
}

/**
 * The outcome for a rule whose inputs were not supplied. Fires, and says why.
 *
 * @param {object} params `ruleId`, `evaluatedAt`, `ruleVersion`, `suppressed`,
 *   `missing` (the input names), and `present` (whatever WAS readable, so the
 *   record is not vacuously empty).
 */
export function unevaluatedOutcome({ ruleId, evaluatedAt, ruleVersion, suppressed, missing, present = {} }) {
  return buildOutcome({
    ruleId,
    fired: true,
    inputs: {
      [UNEVALUATED]: `cannot evaluate ${ruleId}: missing ${missing.join(", ")} — an unevaluated veto is not a passing veto`,
      missing: missing.join(","),
      present: JSON.stringify(present)
    },
    suppressed,
    evaluatedAt,
    ruleVersion
  })
}

/** A veto that was evaluated and did not fire. Recorded, not omitted. */
export function clearOutcome({ ruleId, inputs, suppressed, evaluatedAt, ruleVersion }) {
  return buildOutcome({ ruleId, fired: false, inputs, suppressed, evaluatedAt, ruleVersion })
}

/**
 * Reject anything that would make the record unreadable.
 *
 * `Record<string, number | string | boolean>` is contracts.ts:179, and an
 * inspectable record that cannot be rendered in an audit surface is not
 * inspectable. Rejecting beats stringifying silently.
 */
function assertPlainRecord(inputs) {
  if (inputs === null || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw new TypeError(`copilot: veto inputs must be a plain object; received ${String(inputs)}`)
  }
  for (const [key, value] of Object.entries(inputs)) {
    const t = typeof value
    if (value === null) continue // `present` of "this was absent" is meaningful
    if (t !== "number" && t !== "string" && t !== "boolean") {
      throw new TypeError(
        `copilot: veto input "${key}" must be a number, string, or boolean so the record stays inspectable; received ${t}`
      )
    }
    if (t === "number" && !Number.isFinite(value)) {
      throw new TypeError(`copilot: veto input "${key}" must be a finite number; received ${String(value)}`)
    }
  }
}

/** A finite number, or null. Used for every optional market fact. */
export function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
