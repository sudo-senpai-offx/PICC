# Graduation Analytics — Design

**Date**: 2026-10-08
**Status**: proposed (owner approved design A 2026-10-08; pending written-spec review)
**Author**: agent, with owner decisions recorded verbatim below
**Wave**: Wave 3, item W3-04 (fourth of W3-01…W3-10, one by one)

## 1. Purpose

Per-strategy-tag readiness readout across paper → testnet → mainnet: which
strategies have earned the right to advance, which are decaying, and what the
evidence is. Advisory only — it moves no permit, unlocks nothing, pre-authorizes
nothing.

## 2. Owner decisions (2026-10-08, binding)

1. **Unit of graduation: strategy tag** (journal strategy/pattern tags).
2. **Gate metrics: constitution floors + costs** (12 embargoed walk-forward
   windows, EV gates, calibration tolerance, cost-drag-adjusted returns).
3. **Stages: paper → testnet → mainnet** (testnet = Hyperliquid testnet, real
   mechanics, no value). Testnet leg reads ABSENT until testnet creds land
   (Phase B blocked — expected, not a defect).
4. **Advisory only**: readout + reasons; every promotion stays a manual human
   act via existing ceremony/approval paths. Autonomy ceiling intact.
5. **Symmetric demotion with hysteresis**: promote on 12 consecutive windows
   above bar; demote on 6 windows below 70% of bar (anti-whipsaw).
6. **All three data sources, recency-weighted**: backtest embargoed windows +
   paper closes + live fills, exponential decay half-life 30 days
   (config-overridable), source provenance on every window.
7. **Surface: paper-room table** (stage, gate stats, demotion warnings).

## 3. Architecture

New `server/services/graduation/` boundary:

- `windows.mjs` — normalizes backtest embargoed residuals + paper closes + live
  fills into comparable per-window stats `{ source, windowStart, windowEnd,
  returnPct, sharpe, maxDd, costDragUsd, provenance }`; windows with
  insufficient data are absent with reason (never zero-filled).
- `weighting.mjs` — recency-decay weights (half-life 30d default,
  `PICC_GRADUATION_HALFLIFE_DAYS` override); pure.
- `gates.mjs` — per-strategy-tag evaluation: promotion (12 consecutive windows
  above bar), demotion (6 below 70%), stage labels paper|testnet|mainnet;
  testnet/mainnet legs ABSENT with reasons while creds/ceremony missing;
  output is a readout object, never a permit mutation.
- Route: additive `GET /api/graduation/overview` (requireAuth); paper-room
  table (stage, stats, warnings); no nav changes beyond the room section.

## 4. Honesty rules (load-bearing)

- No 12 qualifying windows → no promotion verdict (below-floor state shown).
- Stages are labels; a "graduated" label authorizes nothing mechanically.
- Demotion warnings fire on the same math as promotions (no asymmetric courage).
- Live-sparse strategies show thin-evidence states, never extrapolated verdicts.

## 5. Non-goals

- Permit flips, ceremony unlocks, auto-promotion of any kind.
- New backtest machinery (consume technicalBacktest/hyperopt/prediction outputs).
- Venue recommendations.

## 6. Testing

Hermetic per-file suites (fixture windows/closes/fills, dynamic imports,
`PICC_GRADUATION_DATA_DIR` only if a store is needed — stateless evaluation
preferred, no new env var beyond the half-life override); tripwire-safe; full
suite + typecheck green before merge.

## Known deferred items and outstanding owner decisions

Added by the final review wave on 2026-10-11. This section records ONLY what is
deferred, ruled, or undecided — the feature design is above and is not restated
here. It exists because the review ledger lived entirely in
`.superpowers/sdd/`, whose `.gitignore` is `*`: every ruling, every parked
finding and every diff artefact in it was invisible to `git diff`, to CI and to
any future reader, and was deleted at plan teardown.

### Outstanding owner decisions

These four change what the feature MEANS, so they are not defects to be fixed by
the next reviewer. Each is shipped in the honest state that does not require
inventing an answer, and each needs an owner decision to move.

1. **What performance clears the promotion bar?** No promotion bar exists
   anywhere in the platform. `graduationBars()` (`handlers.mjs:1323-1325`) is the
   single insertion point and returns `Object.freeze({})`, so every strategy
   honestly reports `bar-unavailable` and no promotion is arguable. This is the
   shipped state, not a defect: a bar this route invented would be a number no
   owner chose.
2. **Does cost drag adjust returns?** No drag policy exists in the stack.
   `costDragUsd` therefore ships UNADJUSTED (`adjusted: false`) beside the raw
   return, with the modeled-vs-measured provenance read off the overlay lines.
   A drag-adjusted return would be an arithmetic this route invented.
3. **The shipped unit is PER-ASSET, not the per-strategy-tag the spec was
   approved on.** `tagSemantics.scope` reads `"per-asset"`. This is a DEVIATION
   from owner decision 1 in section 2 above: no record in the platform carries a
   strategy identity, so the readout groups by `paperClose.symbol` and pools
   every paper trade on one asset under that asset regardless of which strategy
   placed it. Read a row as per-asset performance, not per-strategy performance.
4. **Is cumulative turnover the right capital base for the `capitalCommittedUsd`
   ratio?** The dollar base is the sum of committed `amount` across a tag's
   closes, which is cumulative turnover across sequential trades rather than one
   account balance. The base pile is also a strict SUBSET of the equity pile —
   a close with no strictly positive `amount` moves the equity curve but commits
   no capital — which is why `capitalBaseRows` now ships beside the figure. The
   base being right is an owner call; the discrepancy being visible is settled.

### Deferred code items

Deferred minors from the review ledger, one line each:

- T1: duplicate-window handling (a repeated window in one tag's pile is not
  collapsed; it contributes twice).
- T1: `strategyTag` type validation (a non-string tag value is not rejected at
  the boundary).
- T1: trailing newlines on generated/edited files.
- T2: `guard-primitives.mjs` stale consumer count in `sharedCommentLexer.test.mjs`.
- T2: the self-verifying assertion (the guard proving its own probe is real).
- T2/T3: cycles recorded with no observed RED — no test was seen to fail before
  its fix, so TDD was not demonstrably followed for them.
- T3: orphaned JSDoc in `gates.mjs` left behind by a removed declaration.
- T3: two pre-existing throwing-getter escapes (`gates.mjs:380`,
  `weighting.mjs:287`) — both unguarded, both latent and unreachable from the
  route; they are byte-identical to the merge base.
- T3: unsorted C-1 fixture (ordering is incidental, not asserted).
- T3: an advisory test pins only top-level keys, not their values.
- T4: `strategies` payload key naming.
- T4: `>=` truncation flags (the cap is reported but not signalled as reached).
- T4: `paper-closes-absent` sits outside the documented reason vocabulary.
- T4: `capitalCommittedReason` on an empty pile.
- T4: no fixture where BOTH legs fail at once.
- `formatStat` bare-`absent` path (an absent statistic with a null reason renders
  the word "absent" and nothing else).
- `maxDd.pct` can vanish without a marker on a row where the dollar figure
  renders.

### Parked findings and their rulings

- **The T2 report figure mislabel.** A reported figure was mislabelled. The
  ruling stands — the finding is real — but the only record of it lived in
  gitignored scratch and was deleted at teardown, so it could not be re-verified
  by anyone downstream. That loss is the reason this section exists.
- **The shared comment-lexer guard hole, re-scoped out of this task.** The
  guard's negative half is name-scoped (it looks for a `stripComments`
  declaration, not for any lexer), so a lexer under a different name is
  invisible to it. Re-scoped out of W3-04 rather than fixed here; tracked as
  GUARD-1 below.

### New tracked items raised by the final review wave

- **GUARD-1 — the shared comment-lexer guard's negative half is name-scoped.**
  `sharedCommentLexer.test.mjs` fails only on a retained `stripComments`
  DECLARATION, so a hand-rolled lexer under any other name passes silently.
  `ws7AuthUsersReaderGuard.test.mjs:87` declares a real, unregistered `codeOnly`
  lexer today: it is used at lines 131 and 313 of that file, does not import
  `guard-primitives.mjs`, and is therefore outside both halves of the proof.
  Not fixed in W3-04 — it is a different file with its own consumers.
- **PERPS-1 — `PerpsCommandCentre.test.tsx` is load-sensitive.** 2479ms for 7
  tests; it failed in 2 of 4 full-suite runs while passing 7 of 7 in isolation.
  The root cause was never rooted, so the flakiness is characterised, not fixed.
  Re-measured during this wave: 7 passed (7) in 2.65s, consistent with the
  original observation.
- **REPORT-1 — scratch artefacts are unreviewable.** This very problem. The
  review ledger, its rulings and its diff artefacts are untracked and were
  deleted at teardown, so a later wave cannot check what an earlier wave decided
  and why. This section is the tracked remedy for W3-04; the underlying workflow
  defect is not fixed.
