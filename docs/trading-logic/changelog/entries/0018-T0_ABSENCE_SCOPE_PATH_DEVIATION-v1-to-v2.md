# 0018 - T0_ABSENCE_SCOPE_PATH_DEVIATION v1 -> v2

Deviation record for WS-7 task T0. The spec's file list named
`scripts/absence-scope.mjs`; the module as built and as consumed is
`apps/dashboard/server/scripts/absence-scope.mjs`. This record resolves which of
the two permitted resolutions applies, states the evidence, and amends the spec's
file list to match reality.

rule: T0_ABSENCE_SCOPE_PATH_DEVIATION
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0018-T0_ABSENCE_SCOPE_PATH_DEVIATION-v1-to-v2.md)
date: 2026-09-29
approvalDate: n/a (records an executed fact; no new owner decision was required)
historicalTradesAffected: none
source: >-
  WS-7 task T0, `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1165-1172`,
  and the spec's file-tree entry at `:581`. Amended by this record at both
  locations. The D19 outcome (B) paper-only amendment that T0 also carried is
  recorded separately and is not restated here.

## Resolution: option (b) — record the deviation, amend the spec

**Chosen: (b). The spec was corrected; the code was not moved.**

The two permitted resolutions were (a) extract the discovery into
`scripts/absence-scope.mjs` as the spec says, or (b) record the deviation and
amend `:581` and `:1168` to match reality. (b) was chosen. Both spec locations
are amended in this change.

## The premise being corrected: the discovery was never test-internal

The framing behind option (a) — that the discovery logic "appears to have been
absorbed into `executionAbsenceScope.test.mjs`" — is **not what happened**, and
the distinction is the whole decision.

The discovery is **already a separate, reusable, exported module**. It is not
inline in the test:

- `apps/dashboard/server/scripts/absence-scope.mjs` exists and is tracked
  (156 lines).
- It exports `discoverOrderCapableModules`, `findUndeclaredOrderCapability`,
  `INTENTIONAL_ORDER_CAPABLE`, and `INTENTIONAL_PAPER_SEAMS`.
- `executionAbsenceScope.test.mjs:21-26` **imports all four** from it:

  ```js
  import {
    INTENTIONAL_ORDER_CAPABLE,
    INTENTIONAL_PAPER_SEAMS,
    discoverOrderCapableModules,
    findUndeclaredOrderCapability
  } from "../scripts/absence-scope.mjs"
  ```

So the extraction the spec asked for has already happened, and the "test consumes
the module" property that option (a) exists to establish **already holds**. The
sole deviation is the directory. The repository's own registry row agrees with
the code rather than with the spec: `PICC.md:556` records the mechanism as
"`server/scripts/absence-scope.mjs` discovers the absence scope from the
filesystem".

## Why the file must not be moved to root `scripts/`

Moving it would be an active regression, not a tidiness win.

`perpsSeamGuard.test.mjs:118-129` walks the **entire server tree** recursively
and pins the set of `createOrder`-family call sites to exactly two:

```js
const hits = {}
for (const abs of serverSources()) {          // recursive walk of serverRoot
  hits[label] = (readFileSync(abs, "utf8").match(/\.createOrder(?:s|Ws)?\s*\(/g) ?? []).length
}
expect(sites).toEqual([
  ["services/ccxtOrdering.mjs", 1],
  ["services/venues/hyperliquidPerps.mjs", 1]
])
```

A scanner that declares the very patterns it scans for must therefore never sit
inside that tree, or it counts itself as a third call site and fails a guard on
its own existence rather than on a real venue change. `absence-scope.mjs:27-43`
documents exactly this and the workaround it adopts: the method names are stored
as **bare strings** and compiled into `RegExp` objects at module load, so the
file's own source contains no literal `receiver.method(` sequence.

That constraint is only *live* while the file is inside the server tree. Relocate
it to root `scripts/` and it silently leaves the seam guard's walk — the
`SELF_MODULE` self-exclusion becomes dead code, the string-splitting workaround
becomes unnecessary, and the scanner stops being covered by the guard that
counts order call sites. **The current location is the stricter of the two**, and
it is the reason the module's comment is written the way it is.

A secondary, independent argument: the module reasons about the server tree's
order surface, takes the server root as its input, and declares its paths
relative to that root. Root `scripts/` otherwise holds repo-operations tooling
(`arm-probe.mjs`, `dev.mjs`, `start-all.mjs`, deploy and probe helpers). The
module belongs with the tree it scans.

## Verification: the discovery is machine-driven, and a planted module is found

The hard requirement is that the scope be **discovered**, not a hardcoded list.
Verified by execution, not by reading. To avoid mutating the repository — its
`apps/dashboard/server/data/` is a 1.46 GB live store and it has its own
`server/node_modules` — the plant was performed in a throwaway mirror outside the
repo containing only the 383 `.mjs` sources (`data/` and `node_modules/`
excluded).

**Discovery over the real server tree (read-only): 3 modules.**

```text
handlers.mjs
services/ccxtOrdering.mjs
services/venues/hyperliquidPerps.mjs
```

`findUndeclaredOrderCapability` reports **0 undeclared** — the guard is green, and
those three are exactly the members of `INTENTIONAL_ORDER_CAPABLE`.

**Plant results.** Three modules were planted into the mirror:

| Planted module | Shape | Discovered | Expected |
| --- | --- | --- | --- |
| `services/zzT0PlantProbe.mjs` | `await swap.createOrder(...)` | **yes** | discovered |
| `services/zzT0DecoyBare.mjs` | prose only: `"we could call placeOrder one day"` | no | not discovered |
| `services/zzT0DecoyDataKey.mjs` | data keys `{ order, createOrder, placeOrder }`, `orderFlow` | no | not discovered |

The discovered set grew from 3 to 4 and the new member was **exactly**
`services/zzT0PlantProbe.mjs`. A module nobody had heard of, created moments
earlier, was found with no change to any list — which is the property T0 exists
to provide.

The two decoys were correctly **not** found, which shows the scan matches
capability rather than vocabulary: a receiver, a method name, and an opening
paren are all required, so prose and data keys named `order` do not register.

The planted module was also reported as **undeclared**
(`undeclared: ["services/zzT0PlantProbe.mjs"]`), which is the guard failing
closed — the intended outcome when new capability appears with no reviewed
decision behind it.

**Not a hardcoded list.** The module performs a real filesystem walk
(`readdirSync` + `statSync` + `.endsWith(".mjs")`, recursing and skipping
`__tests__`, `node_modules`, `fixtures`, `data`). Its five `.mjs` string literals
are the *reviewed allow-lists* and the self-exclusion path — they are what
`findUndeclaredOrderCapability` compares discovery **against**, and
`discoverOrderCapableModules` never consults them. That asymmetry is the design,
not an accident: discovery finds the scope, and the allow-list makes a new
capability a deliberate edit to a reviewed list rather than a silent omission
from a scanning list.

## ExpertOption corroboration: still holds after removal

T0's machine-driven scope is also the evidence for D2's blast-radius claim, so
the earlier T2 observation was re-verified rather than assumed.

- `INTENTIONAL_ORDER_CAPABLE` contains `services/expertoption.mjs`: **false**.
  The full set is `["services/ccxtOrdering.mjs", "services/venues/hyperliquidPerps.mjs", "handlers.mjs"]`.
- The discovered set contains it: **false**.
- The file exists on disk: **false** (deleted by T2 at `d01debd`).

Stronger than the earlier observation, which was inferred from the guard passing:
the **pre-deletion blob itself** was read from git at `d01debd^` and matched
against all eleven discovery patterns. It is 1405 lines and contains **zero**
order-capable call sites.

Therefore `expertoption.mjs` was never inside the discovered scope, and its
deletion moved the discovered scope by **exactly nothing**. The scope before the
removal and the scope after it are the same three modules. This independently
corroborates that ExpertOption placed no venue orders, which is what made T2's
removal cost no working order capability.

## Spec amendments made by this record

Two, both minimal and both in the file list only — no acceptance criterion, no
guard, and no assertion was changed.

1. **`:581`** — the file-tree entry moved out of the root `scripts/` block into a
   new `apps/dashboard/server/scripts/` block, with a four-line comment recording
   that the location is deliberate and pointing here.
2. **`:1168`** — T0's `**Files:**` line now names
   `apps/dashboard/server/scripts/absence-scope.mjs`, annotated `**path AMENDED
   2026-09-29**` with the reason inline.

The `:581` block previously sat under a root `scripts/` heading whose other
entries (`arm-probe.mjs`, `ram-ceiling-gate.mjs`, `model-digest-gate.mjs`) are
genuinely root-level, so leaving the entry there would have kept asserting a false
location next to three correct ones.

## Net effect

- `apps/dashboard/server/scripts/absence-scope.mjs` — **unchanged**. Not moved,
  not rewritten, not weakened.
- `executionAbsenceScope.test.mjs` — **unchanged**. No assertion altered, removed,
  or relaxed.
- `perpsSeamGuard.test.mjs` — **unchanged**. Untouched, and the reason the file
  stays where it is.
- Spec `:581` and `:1168` — amended to the real path.
- No test file changed, so the T0 acceptance criteria are unaffected by this
  record.
