# 0027 - T7RA_WS6_ROOM_KEY_AMENDMENT v1 -> v2

The WS-6 §0.3 amendment. WS-7 task T7R-A: the owner-authorised widening of the
frozen ministry room-key inventory from **18 instances / 11 distinct keys** to
**22 instances / 15 distinct keys**, and the two frozen assertions whose values
that widening moves.

rule: T7RA_WS6_ROOM_KEY_AMENDMENT
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0027-T7RA_WS6_ROOM_KEY_AMENDMENT-v1-to-v2.md)
date: 2026-09-30
historicalTradesAffected: none
source: >-
  WS-6 spec §0.3 "Room keys (frozen)"
  (`docs/specs/PICC_TRADING_SUITE_WS6_TERMINAL_UI_REBUILD_v1.md:68-72`) and
  WS-6 R2.3 (`:345`); WS-7 freeze invariant (a) and the file-touch whitelist
  (d) at `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:73`;
  D1's completion order (`:97`); the ROOMS subgraph and its Copilot→execution
  edges (`:514-530`); D20 (`:268-275`); D27 (`:365-370`); AC-020 (`:365`);
  the "verify each path" rule at `:537`; T7 at `:1255-1262`; plan v1 §3.6
  (`docs/specs/PICC_TRADING_SUITE_WS7_REMAINING_T7_T21_PLAN_v1.md:313-397`)
  and §5.1 (`:561-584`).

reason: >-
  The freeze pinned the set of room keys that EXISTED. It did not authorise the
  absence of four rooms that WS-7's own completion order requires. D1 (`:97`)
  names six rooms — Markets/COP-22 → Risk → Ceremony → Ministry → Strategy →
  Paper/Live — and only two of them, `markets` and `paper`, bound to a key that
  existed. Risk, Ceremony, Ministry and Strategy had **no key at all**.

  The consequence was a workstream that could build a room and then be unable
  to reach it at any URL. T7 hit exactly this: Risk shipped at `857443e` as a
  complete, self-contained, 43-test room with **no route**, and recorded the gap
  as `route-unmounted` rather than absorbing it. That was the correct call then,
  because the fix required a spec amendment and a frozen assertion had no owner
  authorisation to move.

  This record is that amendment, and the owner supplied the authorisation on
  2026-09-30.

## The ruling, and what it authorises

| | Prior value | New value |
|---|---|---|
| Instances | 18 | **22** |
| Distinct keys | 11 | **15** |

Four new keys: **`risk`**, **`ceremony`**, **`ministry`**, **`strategy`**. All
four default to the **`trading`** suite. The basis is `:524-530`, which draws
every one of the four on the Copilot→execution path (`SCORE --> MKT`,
`TIERS --> LIVE`, `EXEC --> LIVE`), and the fact that Risk, Ceremony and
Strategy are trade-execution concerns. **Ministry is the weaker case** —
separation-of-duties is a governance concern that could sit in `intelligence`
— and that is why this is recorded as a stated *default* rather than a
per-room ruling: moving one of the four is a one-line change to each ordered
list.

Resulting `trading` order (13), with the four at their D1 positions:

```text
dashboard, markets, risk, ceremony, ministry, strategy, paper,
autopilot, command-centre, dispatch, simulator, studio, settings
```

`earnings` (4) and `intelligence` (5) are **unchanged**.

## The two assertions that move, and the third that does not

Both movers are **moved, not deleted and not weakened**. The pinned ordered list
remains an exact `toEqual` rather than becoming a length or membership check,
because the order is the property that would drift silently.

| File | Before | After |
|---|---|---|
| `ministryRooms.test.tsx:165-177` | trading keys = 9, exact ordered list | trading keys = **13**, four inserted at D1 positions |
| `ministryRooms.test.tsx:193-196` | `expect(total).toBe(18)` | `expect(total).toBe(22)` |
| `TerminalShell.test.tsx:45-59` | parity guard, no literal | **unchanged** — see below |

`TerminalShell.test.tsx:45-59` needs **no value change** and this is worth being
precise about, because `RiskRoom.tsx:36-42` lists it among the assertions that
must move. That comment is accurate that it is a *constraint* and inaccurate
that it needs a *value edit*: it is a parity guard (`INNER_NAV`'s key set equals
`MINISTRY_ROOMS`'s key set; both totals equal) carrying no literal, so it
passes unchanged once all four keys are in both surfaces.

**All three files are nonetheless required to be consistent, and only two carry
a number.** To keep parity from becoming evidence-free, this task also adds to
the parity file the assertion that a bare total cannot make: the four
authorised keys named in the surface that actually serves them, plus the
22/22/15 triple. And `ministryRooms.test.tsx` gains the distinct-key count
beside the instance count, for the same reason — a `22` reached by a rename, a
duplicate, or an unrelated addition would satisfy a bare total.

## The authorisation, quoted from the assertion's own header

`ministryRooms.test.tsx:157-158` reads, in the frozen block's own words:

> "If a test here fails, the migration has broken routing compatibility and
> must be reverted or **the spec amended**."

**This is that amendment.** Two prior tasks in this branch declined to move a
frozen assertion to force a test green and recorded the blocker instead; that
was correct, and this record does not undo it. What changed is that an owner
ruling now exists, so the assertions move under explicit authorisation rather
than under pressure.

## What this amendment does NOT change

The freeze exists so the strangler migration cannot silently rename, drop, or
repoint a room key, and so WS-6's `data-room` hooks stay addressable. This
amendment **adds four keys and moves one ordered list**. It renames nothing,
drops nothing, and repoints nothing.

**This is an authorised widening, not a relaxation of a safety invariant.** Room
keys are a *navigation and routing* contract. None of the safety seams — the
execution-absence contract, the availability union, the tier boundary, the
perps policy input, the paper-only execution mode — is touched, and
`contracts.ts` is not edited at all. A reader who takes "22" as licence to
fabricate four rooms would be misreading it: each of the four renders an
explicit reserved state naming its owning task until that task builds it.

R2.3 is annotated rather than restated. Its binding half — *preserves* the
existing keys and the `data-room` hooks — is unchanged and still binding; the
`data-room` obligation is extended to the four new keys exactly as it applies to
the existing eighteen.

## The three rooms that do not exist yet

`risk` has a real room (`terminal/routes/RiskRoom.tsx`). `ceremony`, `ministry`
and `strategy` do not: Ceremony and Ministry are T8, Strategy is T9. They still
need a `MINISTRY_ROOMS` entry, because the parity guard requires the key sets to
be equal in both directions and would otherwise fail.

They resolve to `src/pages/ministry/reservedRooms.tsx`, which renders the
explicit reserved state from `RoomFrame` naming the owning task and showing no
number, chart point, score, or control. That file is the minimum the parity
guard requires and no more. Writing plausible-looking surfaces instead would be
D27's exact failure mode — scope that looks assigned and is a placeholder — and
each of these is deliberately a NAMED absence with an owner.

Note that two of the three have producers that already ship: Ceremony's
(`commandCentre/ceremonyState.mjs`) and Ministry's (the T16 authority model and
separation-of-duties detector). Their reserved bodies say so, so a reader is not
left thinking the whole room is unstarted when only its surface is.

## Files

Added:

- `apps/dashboard/src/pages/ministry/reservedRooms.tsx` — the three reserved
  bodies.
- This record.

Edited:

- `docs/specs/PICC_TRADING_SUITE_WS6_TERMINAL_UI_REBUILD_v1.md` — §0.3 "Room
  keys" and R2.3, both carrying the dated amendment inline with the prior value
  retained.
- `apps/dashboard/src/pages/MinistryShell.tsx` — `INNER_NAV.trading` gains the
  four keys at their D1 positions.
- `apps/dashboard/src/pages/ministry/MinistryRoom.tsx` — `TRADING_ROOMS` gains
  the four lazy imports.
- `apps/dashboard/src/pages/__tests__/ministryRooms.test.tsx` — the two
  assertions moved; two new tests added; the existing uniqueness and label
  guards untouched.
- `apps/dashboard/src/terminal/components/__tests__/TerminalShell.test.tsx` —
  one new test. No existing assertion changed.

Unchanged, deliberately: `TerminalShell.test.tsx`'s two parity assertions,
`contracts.ts` and its four `ws6TerminalSeamGuard` regex pins, `RiskRoom.tsx`
(mounted and re-flagged by T7R-B, the next commit, so that no record ever names
a resolved blocker as a live one), every existing test and guard value, both
lockfiles, and nothing under `apps/dashboard/server/data/`.

## Net effect

The count a reader is told is 22, and the code is 22. The four keys that caused
the move are named in the assertion that pins the count, in the ordered list
that pins their position, and in the parity guard that pins them to the surface
that serves them. Nothing was deleted to make a number true, and no safety
invariant was relaxed to make a test green.