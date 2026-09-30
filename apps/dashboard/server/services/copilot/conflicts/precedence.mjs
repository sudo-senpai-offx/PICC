// WS-7 T12 — the EXPLICIT PRECEDENCE between the three conflict resolutions.
//
// T12's bisect line (spec :1307): "a conflict between them (for example C1's
// override and C2's stop) is resolved by an explicit precedence recorded in
// `conflictOverrides`, not by ordering luck."
//
// This module is the whole of that mechanism. It is DATA plus one pure
// function, and it imports NO rule module — see the header on `index.mjs` for
// why that matters. A table that reached into the rules would be reachable only
// through them, and the "not by ordering luck" claim would end up resting on
// the import graph again, which is the failure being refused.
//
// ---------------------------------------------------------------------------
// WHY C2 OUTRANKS THE OTHER TWO
// ---------------------------------------------------------------------------
//
// A stop governs whether an OPEN position is EXITED. A score governs whether a
// position is ENTERED. The two answer different questions about the same
// candle, and the exit-side answer is the one that cannot be argued with by an
// entry-side reading:
//
//   C1 raises Trend_Score to its band maximum. That can only ever move a tier
//   UP. If it did so on the same candle C2 reports the position's stop geometry
//   breached, the engine would be promoting a new trade on the bar that says the
//   existing one is in trouble.
//
//   C3 removes 20 points of Macro Bias authority, which can only ever move a
//   tier DOWN — but "can only move it down" is not a reason to let a reweighting
//   outrank a live stop. A stop is a fact about the position; a weight is a
//   view about the market. The fact wins.
//
// So the table has two rows and NO row between C1 and C3. That empty cell is
// load-bearing: it is the control that distinguishes this table from a blanket
// "C2 always wins", and a test asserts it is empty.
//
// ---------------------------------------------------------------------------
// WHY THE RESOLVER IS ORDER-INDEPENDENT
// ---------------------------------------------------------------------------
//
// The resolver reads the TABLE and the SET of rules that want to apply. It never
// reads an array position, and it does not "first one wins". A test hands it the
// same candidates in two different orders and asserts byte-identical output.
//
// A cyclic table THROWS rather than resolving by traversal order: a cycle means
// the table is wrong, and picking an arbitrary winner inside a cycle is ordering
// luck with extra steps.

/** Bumped when a row is added, removed, or its `reason` changes. */
export const PRECEDENCE_VERSION = "copilot-conflict-precedence/1.0.0"

/**
 * loser -> winner. Frozen, and every row carries a reason a reader can argue
 * with. A row without a reason is a preference; this repository records reasons.
 */
export const CONFLICT_PRECEDENCE = Object.freeze([
  Object.freeze({
    loser: "C1",
    winner: "C2",
    domain: "positionSafety",
    reason:
      "C2 reads an open position's stop geometry and C1 only rewrites an entry-side score. " +
      "A score that C1 has maxed may raise a tier, and a raised tier on the candle C2 reports " +
      "breached would have the engine opening a new position on the bar that says the existing " +
      "one is in trouble. The stop is a fact about the position; the score is a view about the " +
      "market, so the stop outranks the view."
  }),
  Object.freeze({
    loser: "C3",
    winner: "C2",
    domain: "positionSafety",
    reason:
      "C3 removes 20 points of Macro Bias authority, which can only move a tier down, and " +
      "'can only move it down' is not a reason to let a reweighting outrank a live stop. " +
      "The 50-EMA/ATR stop is observed on this candle; the macro reallocation is a judgement " +
      "about which experts may speak. Same domain ordering as C1: the observed fact beats the " +
      "opinion, and the two are never allowed to be settled by which module loaded first."
  })
])

/**
 * Settle a set of candidate resolutions against the precedence table.
 *
 * PURE. Order-independent, and it says so by construction: the input array is
 * reduced to a SET of rules that want to apply, and everything after that reads
 * only the table.
 *
 * @param {ReadonlyArray<object>} candidates Resolutions from the three rules,
 *   any order, possibly with duplicates.
 * @param {object} [options]
 * @param {ReadonlyArray<object>} [options.table] Override the table. Used by the
 *   cycle test; production passes none.
 * @returns {{applied: ReadonlyArray<object>, superseded: ReadonlyArray<object>,
 *            all: ReadonlyArray<object>, winners: ReadonlyArray<string>,
 *            losers: ReadonlyArray<{rule: string, supersededBy: string}>}}
 */
export function resolvePrecedence(candidates, { table = CONFLICT_PRECEDENCE } = {}) {
  if (!Array.isArray(candidates)) {
    throw new TypeError(`copilot: resolvePrecedence requires an array of candidates; received ${typeof candidates}`)
  }

  // The SET that wants to speak. Duplicate rules collapse, so a caller that
  // evaluated C1 twice does not get two rows.
  const wanting = new Map()
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`copilot: a conflict candidate must be a resolution object; received ${String(candidate)}`)
    }
    if (typeof candidate.rule !== "string" || candidate.rule.length === 0) {
      throw new TypeError("copilot: a conflict candidate must name its rule")
    }
    if (candidate.applied === true) wanting.set(candidate.rule, candidate)
  }

  // A row only bites when BOTH of its rules want to apply. "C2 outranks C1" is
  // a statement about a collision, not a general demotion of C1.
  const beaten = new Map()
  for (const row of table) {
    if (wanting.has(row.loser) && wanting.has(row.winner)) beaten.set(row.loser, row)
  }
  assertAcyclic(table, wanting)

  const all = []
  for (const candidate of candidates) {
    if (candidate.applied !== true) {
      // Never applied, so there is nothing to supersede. Its own `status`
      // ("notTriggered", "disabled", "unavailable", "notHypertrend") is already
      // the outcome a reader needs.
      all.push(
        Object.freeze({
          ...candidate,
          evaluationStatus: candidate.status,
          supersededBy: candidate.supersededBy ?? null,
          supersededReason: null,
          supersededAdjustments: Object.freeze([])
        })
      )
      continue
    }
    const row = beaten.get(candidate.rule)
    if (row === undefined) {
      all.push(
        Object.freeze({
          ...candidate,
          // `status` is the PRECEDENCE outcome for every rule, so a caller can
          // read one vocabulary across C1/C2/C3. C2's own evaluation reports
          // "evaluated" and C1's reports "applied"; whichever it was, the rule
          // either won or lost here, and that is what `status` now says.
          status: "applied",
          evaluationStatus: candidate.status,
          supersededBy: null,
          supersededReason: null,
          supersededAdjustments: Object.freeze([])
        })
      )
      continue
    }
    all.push(
      Object.freeze({
        ...candidate,
        // The rule LOST. It is not dropped: `wouldHaveApplied` and
        // `supersededAdjustments` keep its decision verbatim, `status` names the
        // outcome, and `supersededBy`/`supersededReason` say who beat it and why.
        status: "superseded",
        evaluationStatus: candidate.status,
        applied: false,
        supersededBy: row.winner,
        supersededReason: row.reason,
        wouldHaveApplied: true,
        supersededAdjustments: Object.freeze([...(candidate.adjustments ?? [])]),
        adjustments: Object.freeze([]),
        reason: `${candidate.reason} — SUPERSEDED by ${row.winner}: ${row.reason}`
      })
    )
  }

  return Object.freeze({
    applied: Object.freeze(all.filter((r) => r.applied === true)),
    superseded: Object.freeze(all.filter((r) => r.status === "superseded")),
    // Reported in the SPEC's order (C1, C2, C3 — §4.4's enumeration), never in
    // the order the candidates happened to arrive in. AC-021 forbids an
    // observable collection whose order is incidental, and a report whose
    // ordering depended on its input would be exactly that.
    all: Object.freeze([...all].sort((a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0))),
    winners: Object.freeze([...new Set(all.filter((r) => r.applied === true).map((r) => r.rule))].sort()),
    losers: Object.freeze(
      [...new Map(all.filter((r) => r.status === "superseded").map((r) => [r.rule, { rule: r.rule, supersededBy: r.supersededBy }])).values()]
    )
  })
}

/**
 * Refuse a table whose rows form a cycle among the rules that want to apply.
 *
 * A cycle is unsatisfiable, and "resolve it by walking until something stops
 * moving" is exactly the ordering luck this module exists to remove — the stop
 * condition would depend on which rule was examined first.
 */
function assertAcyclic(table, wanting) {
  const edges = new Map()
  for (const row of table) {
    if (!wanting.has(row.loser) || !wanting.has(row.winner)) continue
    if (!edges.has(row.loser)) edges.set(row.loser, [])
    edges.get(row.loser).push(row.winner)
  }
  const visiting = new Set()
  const done = new Set()
  const walk = (node, path) => {
    if (done.has(node)) return
    if (visiting.has(node)) {
      throw new Error(
        `copilot: the conflict precedence table contains a cycle (${[...path, node].join(" -> ")}). ` +
          "A cycle is unsatisfiable, and resolving it by traversal order is the ordering luck this table exists to remove."
      )
    }
    visiting.add(node)
    for (const next of edges.get(node) ?? []) walk(next, [...path, node])
    visiting.delete(node)
    done.add(node)
  }
  for (const node of edges.keys()) walk(node, [])
}
