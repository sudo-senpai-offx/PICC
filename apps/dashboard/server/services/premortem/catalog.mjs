// Pre-mortem planner — the curated failure-mode catalog (W3-05, Task 1).
//
// WHAT THIS IS. The one list the rest of the pre-mortem planner reads. Every
// failure mode this program has actually hit is filed here once, with the
// subsystem it lives in, and — the part that matters — with a DISPOSITION: either
// the repository-relative path of the tracked test file that claims to guard it,
// or an explicit `acceptedUnclaimed` record naming the manual check a human must
// perform. There is no third option. That is owner decision 5 (design spec
// section 2): "there is no third option, so silence can never read as coverage."
//
// WHY THAT RULE IS THE WHOLE FEATURE. This program shipped a guard that looked
// like coverage and was not (GUARD-1). The root cause was a hand-maintained
// inventory that omitted a consumer, so the offending file was invisible to the
// very guard meant to police it. A catalog entry with neither a claim nor a
// disposition reproduces exactly that: a reader who sees no `claim` cannot tell
// "covered" from "nobody looked", and defaults it to the answer that flatters the
// system.
//
// ADVISORY ONLY, and it is a constant besides: no store, no network, no
// `process.env`, no clock read, no import of any other service. Nothing here
// verifies anything — `inventory.mjs` derives the real guard inventory and
// `verify.mjs` diffs it against this file. This module only says what it claims.

/**
 * The severity scale, most severe first. Three levels, and the MEANING depends on
 * the entry's `kind` — the two kinds are never compared on one numeric scale,
 * because they do not measure the same thing (design spec section 3):
 *
 *   - on a `capital` entry, severity is BLAST RADIUS ON MONEY:
 *       `high`   capital at risk;
 *       `medium` capital impaired but bounded;
 *       `low`    nuisance with no capital path.
 *   - on a `shipping` entry, severity is BLAST RADIUS ON CORRECTNESS:
 *       `high`   a wrong thing can reach a user or a venue;
 *       `medium` internal wrongness that a test catches;
 *       `low`    internal wrongness that nothing depends on.
 *
 * So a `high` capital mode and a `high` shipping mode are not "equally bad"; they
 * are the top of two different scales, and a renderer that sorts the two together
 * into one "worst first" list is building a ranking nobody endorsed.
 */
export const SEVERITIES = Object.freeze(["high", "medium", "low"])

/**
 * The two kinds of risk a mode can carry, and the reason `kind` exists at all
 * (design spec section 2, owner decision 4 — "one catalog, two axes").
 *
 * `capital` is money at risk. `shipping` is correctness at risk. They share a
 * catalog and never blur: a capital mode is never reported as covered by a
 * passing test that means something else entirely, and the fact that they share
 * an array is a convenience, not an equivalence.
 */
export const KINDS = Object.freeze(["capital", "shipping"])

/**
 * The catalog itself: eleven modes, eleven dispositions, no thirds.
 *
 * Every mode below is seeded from something this program actually did, not from a
 * hypothetical. Where a mode names a guard, the path is the repository-relative
 * path of a TRACKED test file and `verify.mjs` resolves it — the planner never
 * takes this file's word for it, and this file never asks to be believed. Where a
 * mode names no guard, it says so out loud in `acceptedUnclaimed`, with the
 * specific thing a human has to check and who owns that check.
 *
 * ORDER IS GROUPED BY KIND, NOT BY SEVERITY. A severity-sorted catalog would put
 * a capital mode and a shipping mode next to each other and invite exactly the
 * comparison owner decision 4 forbids. Grouping by kind keeps each scale legible
 * on its own terms.
 *
 * `severity` is read through `kind`, never on its own — see `SEVERITIES` above for
 * why the same word carries two different meanings on the two halves.
 */
export const FAILURE_MODES = Object.freeze([
  Object.freeze({
    id: "SHIP-1",
    kind: "shipping",
    severity: "high",
    subsystem: "test-guards",
    summary:
      "A guard that cannot fail: its negative check matches one identifier name, so a second " +
      "lexer under any other name is invisible to it and the suite stays green.",
    claim: "apps/dashboard/server/__tests__/sharedCommentLexer.test.mjs",
    acceptedUnclaimed: null,
    mutation: true,
    rationale:
      "The claimed guard's negative half is the regex at sharedCommentLexer.test.mjs:100 — " +
      "/(?:function\\s+stripComments|(?:const|let|var)\\s+stripComments\\s*=)/ — which matches the " +
      "LITERAL identifier `stripComments` and nothing else. That is the historical GUARD-1 shape, " +
      "and it is still live: ws7AuthUsersReaderGuard.test.mjs:87 declares its own block-comment " +
      "lexer, `function codeOnly(text)`, which is outside the regex and therefore passes the very " +
      "guard meant to police it. So this claim is NOT that the drift class is closed — it is that " +
      "one drift is now pinned, while a differently-named instance of the same class is open and " +
      "visible only to a reader, which is why `mutation` is true: the experiment is already written " +
      "down in the guard's own header ('A FIXED GUARD IS NOT A FIXED GUARD UNLESS IT HAS BEEN SEEN " +
      "TO FAIL'), and `codeOnly` is that experiment's result."
  }),
  Object.freeze({
    id: "SHIP-2",
    kind: "shipping",
    severity: "high",
    subsystem: "test-guards",
    summary:
      "A hand-maintained guard inventory that omits a consumer, so the omitted consumer is " +
      "invisible to the guard that is supposed to police it.",
    claim: "apps/dashboard/server/__tests__/sharedCommentLexer.test.mjs",
    acceptedUnclaimed: null,
    mutation: true,
    rationale:
      "GUARD-1's root cause, and it is structural rather than accidental: the consumer list at " +
      "sharedCommentLexer.test.mjs:69-76 is a hand-written frozen array of six paths, and " +
      "ws7AuthUsersReaderGuard.test.mjs is not among them. Both halves of the proof that file " +
      "offers — the 'no consumer RETAINS a declaration' check and the 'resolves to the SAME " +
      "absolute module' check — iterate that array, so a consumer missing from it is invisible to " +
      "both. The file's own comment says so: registering a new consumer 'is part of adopting the " +
      "shared lexer, not an optional extra.' Severity is `high` on the shipping scale because the " +
      "guard this inventory under-reports is an auth-store guard whose stated failure is that a " +
      "corrupt users.json 'is reported as an empty store — a false answer about the server, and at " +
      "a gate a fail-open one' (ws7AuthUsersReaderGuard.test.mjs:200). `mutation` is true because " +
      "the experiment is a single deleted array element."
  }),
  Object.freeze({
    id: "SHIP-3",
    kind: "shipping",
    severity: "medium",
    subsystem: "graduation/windows",
    summary:
      "A spec asserting record fields the producer does not emit (entryTime / exitTime / pnlPct), " +
      "shipped into a plan before anyone checked the field names against the producer.",
    claim: "apps/dashboard/server/__tests__/graduationWindows.test.mjs",
    acceptedUnclaimed: null,
    mutation: false,
    rationale:
      "The producer is tradeJournal.mjs, which emits `entryTime` (:65), `exitTime` (:66) and " +
      "`pnlPct` (:68). The consumer reads exactly those names — windows.mjs:167 " +
      "`finiteOrNull(row?.returnPct ?? row?.pnlPct)`, :207 `row?.windowStart ?? row?.entryTime`, " +
      ":208 `row?.windowEnd ?? row?.exitTime` — and the guard pins them with fixtures built on the " +
      "real shape, so a field name that stops existing fails loudly rather than silently measuring " +
      "nothing. Severity is `medium` on the shipping scale: internal wrongness, caught by a test, " +
      "with no path to a user or a venue. `mutation` is deliberately false — the assertion shape " +
      "here is concrete (a row whose statistic is absent must yield null plus a reason, never a " +
      "fabricated zero), so the guard is worth running and not worth the cost of a mutation pass."
  }),
  Object.freeze({
    id: "SHIP-4",
    kind: "shipping",
    severity: "high",
    subsystem: "review-process",
    summary:
      "A failure called 'pre-existing' and therefore skipped, when it was our own regression — " +
      "five such claims in one session.",
    claim: null,
    acceptedUnclaimed: Object.freeze({
      owner: "platform owner",
      date: "2026-10-11",
      check:
        "Before any failure is attributed to code you did not write, bisect to the commit that " +
        "introduced it and read that diff. Five failures in one session were attributed to the " +
        "merge base and turned out to be regressions this program shipped; there is no test that " +
        "can catch a mis-attribution, because the mis-attribution is an act of reading rather than " +
        "a property of the tree."
    }),
    mutation: false,
    rationale:
      "Recorded in the design spec (section 1 and section 6) as the reason this feature exists at " +
      "all: the program shipped a guard that looked like coverage and was not, and separately " +
      "logged five 'pre-existing failure' claims that were its own regressions. Severity is `high` " +
      "on the shipping scale rather than `medium`, because the documented consequence is not a " +
      "note in a review — it is five unfixed regressions left in the server tree, which is code " +
      "that reaches users and venues. There is NO guard and none is proposed: the failure is in how " +
      "a diff was read, and no assertion about the tree can distinguish 'broken before us' from " +
      "'broken by us'. So the disposition is the manual check itself, which is the honest answer " +
      "and is exactly what owner decision 5 asks for when there is nothing to claim."
  }),
  Object.freeze({
    id: "SHIP-5",
    kind: "shipping",
    severity: "medium",
    subsystem: "graduation/gates",
    summary:
      "Two evidence piles drifting apart because each re-implemented one predicate, so the two " +
      "sides of a readout stopped reconciling with no explanation on the row.",
    claim: "apps/dashboard/server/__tests__/graduationGates.test.mjs",
    acceptedUnclaimed: null,
    mutation: true,
    rationale:
      "The two piles are `windowsUsed` (the top-level streak evidence count) and the per-source " +
      "`windowsSeen` / `windowsMeasured` rows, computed by different code over the same pile — see " +
      "gates.mjs:200-220, which documents the divergence and the rename from `windowsQualifying` " +
      "to `windowsMeasured`. The drift was real: the field name `windowsQualifying` let the two " +
      "read as the same number and produced a Task 4 table reporting '12 measured / 0 used' on one " +
      "row with nothing to explain the gap. The guard reconciles them as an identity — " +
      "`windowsUsed + Σskipped == ΣwindowsSeen` — at graduationGates.test.mjs:910, with the " +
      "control at :762 that the old name never reappears. Severity is `medium` on the shipping " +
      "scale: internal wrongness, now caught by a test, with no path to a user or a venue. " +
      "`mutation` is true because a reconciliation identity is precisely the assertion shape that " +
      "survives a broken implementation — both sides can be wrong in the same direction and the " +
      "equality still holds."
  }),
  Object.freeze({
    id: "SHIP-6",
    kind: "shipping",
    severity: "medium",
    subsystem: "graduation/gates",
    summary:
      "A source with no bar silently vetoing a gate forever, so a strategy could never be " +
      "promoted on any record however good.",
    claim: "apps/dashboard/server/__tests__/graduationGates.test.mjs",
    acceptedUnclaimed: null,
    mutation: true,
    rationale:
      "The defect is recorded in the module that had it, at gates.mjs:405-410: Task 1 merges " +
      "backtest, paper and live into one chronological sort, so live fills arrive interleaved; " +
      "treating the ungateable live windows as measurement failures reset the streak on every one " +
      "of them, and 'a strategy that also trades live could never be promoted no matter how good " +
      "its backtest record was — the live pile vetoed the argument it was absent from.' `live` has " +
      "no `GATE_PLANS` entry by construction, so the exclusion at gates.mjs:411-421 is what stops " +
      "it, and the guard is the interleaved control at graduationGates.test.mjs:707. Severity is " +
      "`medium` on the shipping scale: a silently wrong verdict in an internal readout, caught by a " +
      "test, and the thing it suppresses is a promotion to testnet — not a fill at a venue. " +
      "`mutation` is true because the corresponding implementation change is deleting the single " +
      "bare `continue` at gates.mjs:415 — the one that skips the run-resetting `aboveRun = 0` for a " +
      "source that is merely ungateable — which is cheap to break and expensive to notice."
  }),
  Object.freeze({
    id: "CAP-1",
    kind: "capital",
    severity: "high",
    subsystem: "venues",
    summary: "A venue outage while a position is open — no venue to exit through, no clock to exit by.",
    claim: null,
    acceptedUnclaimed: Object.freeze({
      owner: "platform owner",
      date: "2026-10-11",
      check:
        "Before arming any live venue, confirm by hand what the system does on a mid-position " +
        "outage: read services/venues/ccxtVenues.mjs to find whether an open position has a " +
        "documented unwind path that does not route through the venue (stop-loss, reduce-only " +
        "fallback, alert to a human), and confirm someone is on the other end of that alert. There " +
        "is no guard FILE to verify here: an outage is not a property of the tree."
    }),
    mutation: false,
    rationale:
      "Severity is `high` on the CAPITAL scale, which means blast radius on money: capital at " +
      "risk, with no bound. A closed position cannot lose; an open one cannot be exited while the " +
      "venue refuses. This entry is `claim: null` and will never be `verified` — design spec " +
      "section 3 reserves `unverified-manual` for exactly this case and forbids upgrading it, " +
      "because there is no file that encodes 'the venue is reachable'. `mutation` is false for the " +
      "same reason: there is no implementation to break."
  }),
  Object.freeze({
    id: "CAP-2",
    kind: "capital",
    severity: "medium",
    subsystem: "costs",
    summary: "A cost model that understates real drag, so trades are admitted whose edge never existed.",
    claim: null,
    acceptedUnclaimed: Object.freeze({
      owner: "platform owner",
      date: "2026-10-11",
      check:
        "Reconcile modeled drag against measured drag on real fills before trusting any net " +
        "figure: read services/costs/modeled.mjs for the assumptions it makes, then compare a " +
        "sample of its modeled cost lines against what services/costs/measured.mjs actually " +
        "recorded over the same fills. A model that understates drag turns every cost-adjusted " +
        "hit rate optimistic, and the error compounds silently rather than failing loudly."
    }),
    mutation: false,
    rationale:
      "Severity is `medium` on the CAPITAL scale, which means capital impaired but bounded, and " +
      "the bounding is the point: the true drag still caps each individual trade's loss. What " +
      "fails is the DECISION, not the loss ceiling — the strategy takes trades it should not, and " +
      "the aggregate bleed is real but is not an unbounded single event the way an outage is. " +
      "Deliberately NOT `high`: ranking this above an open position in a dead venue would put " +
      "two different kinds of unbounded-ness on one scale, which is the collapse owner decision 4 " +
      "rules out. `claim: null` and never `verified` — a model is only as correct as the fills " +
      "compared against it, which is a judgement about data nobody in this repository holds."
  }),
  Object.freeze({
    id: "CAP-3",
    kind: "capital",
    severity: "high",
    subsystem: "paperCircuit",
    summary: "A circuit breaker that fails to halt, so the loss control that should stop the bleeding never fires.",
    claim: null,
    acceptedUnclaimed: Object.freeze({
      owner: "platform owner",
      date: "2026-10-11",
      check:
        "Prove the halt by hand, on paper, not by reading the code: take services/paperCircuit.mjs, " +
        "state the exact inputs that should trip it, and confirm each one actually reaches the " +
        "state that stops new entries. Then confirm the FAIL-SAFE direction — a circuit that " +
        "cannot read its own inputs should stop trading, not continue. A breaker verified only by " +
        "reading is exactly as verified as one that does not exist."
    }),
    mutation: false,
    rationale:
      "Severity is `high` on the CAPITAL scale — capital at risk — and the reason it outranks CAP-2 " +
      "is structural rather than a matter of taste: a cost model that understates drag misprices a " +
      "trade that still goes through every other bound, whereas a breaker that fails to halt " +
      "REMOVES the bound. An absent ceiling is not a worse estimate, it is no estimate. " +
      "`claim: null` and never `verified`: the only meaningful verification is firing the breaker " +
      "and watching it stop, which is a manual drill and not a file."
  }),
  Object.freeze({
    id: "CAP-4",
    kind: "capital",
    severity: "medium",
    subsystem: "technicalBacktest",
    summary: "A regime change against a model fitted to the old one, so every forward estimate is confidently wrong.",
    claim: null,
    acceptedUnclaimed: Object.freeze({
      owner: "platform owner",
      date: "2026-10-11",
      check:
        "Re-fit services/technicalBacktest.mjs on data from the current regime and compare, before " +
        "any fitted strategy is promoted: a backtest that was never re-fitted reports its in-sample " +
        "regime's statistics with total confidence, and nothing in the code distinguishes the two " +
        "cases. Also confirm the gate is read against cost-ADJUSTED performance rather than gross, " +
        "so a regime with worse liquidity cannot look better than one with better."
    }),
    mutation: false,
    rationale:
      "Severity is `medium` on the CAPITAL scale — capital impaired but bounded — because the loss " +
      "still passes through venues, the circuit and the cost model, all of which remain in force; " +
      "what fails is the input to those bounds rather than the bounds themselves. The confident-" +
      "wrong part is real and is why this is not `low`: the system does not degrade, it asserts. " +
      "`claim: null` and never `verified` — whether a regime has changed is a claim about the world, " +
      "and no test in this repository can observe it."
  }),
  Object.freeze({
    id: "CAP-5",
    kind: "capital",
    severity: "medium",
    subsystem: "venueCredentials",
    summary: "A credential that expires between the check and the use, so an order is placed with authority nobody holds.",
    claim: null,
    acceptedUnclaimed: Object.freeze({
      owner: "platform owner",
      date: "2026-10-11",
      check:
        "Trace services/venueCredentials.mjs for the window between a credential being validated " +
        "and the order it authorises being sent, and confirm that an expiry inside that window " +
        "halts the order rather than falling through to a default or a cached value. Then confirm " +
        "by hand what a rejection from the venue does to an ALREADY-OPEN position, which is the " +
        "case a credential check cannot answer."
    }),
    mutation: false,
    rationale:
      "Severity is `medium` on the CAPITAL scale — capital impaired but bounded — and the bound is " +
      "real: an expired credential produces a REJECTED call, so the venue declines rather than " +
      "executing badly, and no unauthorised fill follows. It is `medium` rather than `low` because " +
      "the consequence is a trading halt nobody asked for, which is itself a capital event: a " +
      "position left unhedged for the length of the outage. `claim: null` and never `verified` — " +
      "the check is a race between two clocks, and asserting it in a test would mean a `sleep`."
  })
])

/**
 * The frozen catalog, handed to callers as a value.
 *
 * Returned rather than merely exported so a caller cannot push onto the shared
 * array. The entries are frozen too — a frozen array of MUTABLE objects is not a
 * constant, it is a list whose contents any importer can rewrite in place, which
 * would let one caller launder a mode's claim while every other reader still sees
 * the original id.
 *
 * @returns {ReadonlyArray<object>} the same frozen `FAILURE_MODES` array
 */
export function catalogEntries() {
  return FAILURE_MODES
}
