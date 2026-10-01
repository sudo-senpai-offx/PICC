# 0029 — Spec amendment: WS-7 §0.3 freeze invariants (a) and (d)

- **Date:** 2026-09-30
- **Owner:** WS-7+
- **Kind:** dated spec amendment under §0.3's own "any path outside this union needs a dated spec amendment"
- **Supersedes:** nothing. This **widens** two invariants; it relaxes neither.

## What changed

Two clauses in `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:73`.

### (a) room key inventory — 18 → 22 instances / 11 → 15 distinct keys

The clause said 18 instances across 11 keys, "per WS-6 spec §0.3, carried forward". It now says
**22 instances across 15 distinct keys**, trading growing 9 → **13**.

`trading` → dashboard, markets, **risk**, **ceremony**, **ministry**, **strategy**, paper, autopilot,
command-centre, dispatch, simulator, studio, settings (13). `earnings` (4) and `intelligence` (5)
unchanged.

**Why.** D1 at `:97` orders the rooms Markets → Risk → Ceremony → Ministry → Strategy → Paper/Live,
but only `markets` and `paper` had keys in the frozen 18. Risk, Ceremony, Ministry and Strategy had
no route at all, so D1's acceptance could not honestly pass for four of the six rooms it names. The
owner ruled on 2026-09-30 that each takes a new key.

**Not a relaxation.** Four more surfaces, not fewer constraints. Every new key is subject to the same
AC-020 per-room completion bar and the same D27 flagging duty as the original 18. The `trading`
suite assignment is a **stated default** — the mermaid at `:524-530` draws all four on the
Copilot→execution path — and moving any one of them to `intelligence` is a mechanical edit that
changes both ordered-list pins, not a redesign.

**Recorded, not absorbed.** The count was never landed at 19 and widened to 22. Entry 0027 authored
it once at 22/15, per the plan's §3.6 resolution note.

### (d) file-touch whitelist — `handlers.mjs` added

The union named `apps/dashboard/server/services/**` and `apps/dashboard/server/__tests__/**` but not
the route file itself.

**Why.** WS-7's central seam is the route layer. Excluding it made WS-7 structurally unable to do the
work its own tasks assign it:

| Deviation | Task | What it needed the route file for |
|---|---|---|
| auth fail-open closure | the `802520e`–`3b0fcf6` slice | `requireSessionOrFirstRun` gates on 14 bootstrap routes |
| `POST /api/trading/copilot` | T7R-B (`99b9960`) | the route that made the deterministic engine reachable for the first time |

Both were recorded as deviations rather than absorbed, which was the correct handling. The defect was
in the union, not in the practice: **WS-7 cannot gate a route or expose a route without the route
file.** Adding it is what makes the previously-recorded deviations conforming rather than excusing
them.

**Scope of the grant.** One file. It does not open `apps/dashboard/server/**` generally — `vite.config.ts`,
`testSupport/`, and any future sibling stay outside and still need their own amendment.

## What this does NOT change

- Every path already outside the union and not named here is **still** outside it.
- `executionAbsence` (b) and the perps amputation intent (c) are untouched.
- No acceptance criterion is weakened. AC-020's per-room bar and D27's flagging duty apply to the four
  new keys exactly as to the original eighteen.
- The suite-level route-auth allowlist is untouched: still 86 unruled `owner: "decision"` entries
  awaiting the owner, and `POST /api/trading/copilot` was **gated, not allowlisted**.

## Also corrected in the plan, not the spec

`PICC_TRADING_SUITE_WS7_REMAINING_T7_T21_PLAN_v1.md` §3.6 said T10's remainder was 12, contradicting
its own §5. It is **16** — 22 total, minus the 6 rooms T7–T9 cover. The 12 was the never-taken
19-room branch's arithmetic.

## Verification

- Both edited files: no BOM, zero `U+FFFD`, non-ASCII (`— ≠ § →`) intact. WS-7 spec remains CRLF
  throughout (1522/1522); the plan remains LF (0/680).
- Both amended clauses read back as intended from disk.
- `git diff --check` clean.
- Suite untouched by this amendment — it is documentation only. Floor entering the next task is
  **4744 passed / 1 skipped / 0 failed**.
