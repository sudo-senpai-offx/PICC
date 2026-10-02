# 0038 — WS-7 T17: the four-venue CCXT order lifecycle, gated on all three rails

rule: T17_CCXTVENUE_LIFECYCLE
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0038-T17_CCXTVENUE_LIFECYCLE-v1-to-v2.md)
date: 2026-10-02
historicalTradesAffected: none
source: >-
  WS-7 T17 at `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1345-1352`
  (Scope `:1346`, Files `:1348`, Acceptance `:1350`); AC-036 at `:1053-1059`; D9 at `:166-173`;
  D5 at `:130-137`; D6 at `:142`; D23 at `:327-337`; the AC-7a venue-freeze amendment at
  `docs/trading-logic/changelog/entries/0037-AC7A_VENUE_FREEZE_T17_AMENDMENT-v1-to-v2.md`
  (commit `8c4cded`); and the residual coverage record 0037 says was forthcoming.
reason: >-
  T17 mandated a full order lifecycle for exactly four venues and AC-036 required it to be
  demonstrated with rails on every leg. The venue surface was frozen by WS-5 AC-7a until record 0037
  authorised four named paths; this entry records the implementation those four paths carry, the
  three defects found and fixed while building it, and the coverage record 0037 listed as
  forthcoming — which now exists.

- **Date:** 2026-10-02
- **Owner:** WS-7+
- **Kind:** implementation record
- **Supersedes:** nothing. Adds no venue, removes no rail, lowers no threshold.

## What landed

Nine files. Four are the paths record 0037 authorised; the rest are the tests that make the
lifecycle's claims checkable and the absence-scope declaration that keeps the scanner honest.

| File | Role |
|---|---|
| `services/venues/ccxtVenues.mjs` | the four-venue registry, per-venue default-closed enablement, catalog facts |
| `services/venues/ccxtLifecycleRails.mjs` | the single ceremony / consent / risk evaluator, three-state, propose and execute |
| `services/venues/ccxtVenueLifecycle.mjs` | the four legs, propose/execute anchors, observed-fill position book, slippage, realized P&L |
| `services/ccxtOrdering.mjs` | **extended, not replaced** — `amendCcxtOrder`, `fetchCcxtOpenOrders`, `cancelCcxtOrder`, `closeCcxtPosition` |
| `services/commandCentre/ccxtExecution.mjs` | consent field sets extended for the amend, cancel and close legs |
| `scripts/absence-scope.mjs` | `services/venues/ccxtVenueLifecycle.mjs` declared order-capable |
| `__tests__/ccxtVenues.test.mjs` | venue count, catalog consistency, D26 claims |
| `__tests__/ccxtVenueLifecycle.rails.test.mjs` | the 4 x 4 x 3 rails matrix |
| `__tests__/ccxtVenueLifecycle.sandboxE2E.test.mjs` | injected-adapter lifecycle, and what a real sandbox still needs |

`ccxtOrdering.mjs` kept its single `createOrder` call site. `perpsSeamGuard.test.mjs` still counts it
at two across the whole server, and T17's files contribute none of them — which is also why the
adapter members are named `placeOrder`/`amendOrder`/`cancelOrder`/`closeOrder` rather than
`createOrder`/`editOrder`/etc. Those names are load-bearing for `absence-scope.mjs`'s scanner: the
lifecycle module is *discovered* as order-capable by that scanner and *declared* on the reviewed list,
both asserted in `ccxtVenueLifecycle.sandboxE2E.test.mjs`.

## The rails matrix — 4 venues x 4 legs x 3 rails, sixteen cells

Ceremony gate, consent payload lock and risk rails are evaluated on **every** leg of **every**
venue. A rail that cannot be evaluated is reported `absent` with a named reason and is never a
default-allow; the three-state vocabulary is `pass | block | absent`, and `absent` is a value the
evaluator must justify rather than a fallback.

| Venue | Leg | Ceremony | Consent | Risk | Cell evidence |
|---|---|---|---|---|---|
| kraken | place / amend / cancel / close | pass with unlock, block without | locked, anchor required | ATR + drawdown on exposure-adding; key lock + automation provenance on all four | `ccxtVenueLifecycle.rails.test.mjs` |
| coinbase | place / amend / cancel / close | as above | as above | as above | as above |
| binance | place / amend / cancel / close | as above | as above | as above | as above |
| bybit | place / amend / cancel / close | as above | as above | as above | as above |

The matrix is asserted by iteration over the real registry and the real leg list, not by four
hand-written venue blocks, so adding a fifth venue or a fifth leg fails the test rather than quietly
leaving a hole.

## What each venue renders today, with no ceremony unlock

**Nothing, and that is the designed result.** T8 established that no production authority set exists
and no ceremony unlock has ever been granted, so every leg on all four venues refuses at the ceremony
gate before any adapter member is reached. `ccxtVenueLifecycle.sandboxE2E.test.mjs` proves this by
running every leg against an adapter whose every member throws: a test that passes is a test where no
throw could occur. Each venue additionally defaults to disabled unless
`PICC_CCXT_VENUE_ENABLED_<VENUE>` is exactly `"1"`.

## The consent lock, extended rather than replaced

`ccxtExecution.mjs` already carried the canonical projection, the locked-field set and the SHA-256
consent hash. T17 added one field set per new leg (`venueAmend`, `venueCancel`, `venueClose`) and
reused `spotOpen` for place. Nothing about the mechanism was rebuilt: the proposal records an anchor,
execution must resubmit a payload whose hash still matches that anchor, and the venue id is among the
locked fields so one venue's consent cannot be replayed at another.

## `ccxtOrdering.mjs` — what was extended

Four members, each with its own envelope so the seam is safe for any importer, not only for callers
that went through the lifecycle's rails:

- `amendCcxtOrder` — limit-only; `editOrder` cannot change side, so a caller believing it is changing
  direction is refused. Sizes the $10 cap from the **venue's own** reported amount and price, read
  back with the read-only `fetchOrder` the file already uses for verification. An amend whose live
  order cannot be priced is refused, because an envelope that cannot be evaluated is not an allow.
- `fetchCcxtOpenOrders` — read-only, for resolving a cancel target.
- `cancelCcxtOrder` — requires an order id or a client order id; a client-order-id-only cancel
  resolves through the read-only open-order view and reports `unobservable` rather than guessing.
- `closeCcxtPosition` — **calls no new venue method.** CCXT has no `closePosition` these four
  implement uniformly and it is in `ccxtConnector`'s blocklist besides, so the exit is derived as an
  opposite-side order and sent through the existing `placeCcxtOrder`. No withdraw, transfer or
  leverage path was added.

## The venue count, asserted

`CCXT_LIFECYCLE_VENUE_COUNT` is frozen at `4` and `ccxtVenues.test.mjs` asserts the list equals
exactly `kraken`, `coinbase`, `binance`, `bybit` — AC-036's own verification clause, at `:1058`.
`ccxtLifecycleVenue()` returns `null` for anything unlisted, so a fifth venue cannot be reached by
accident.

## Catalog consistency

Two of the four have a `streamCatalog.ts` row and two do not: **kraken and coinbase are absent from
the catalog**, and this entry did not invent rows for them. D26 removed the licensing/KYC claim class
from that catalog, and T7b removed 13 rows under record 0019; the test reads the removed ids out of
0019's own tables rather than restating them, so it cannot quietly pass against a list it no longer
matches. No row was reintroduced and no regulatory claim appears in any venue descriptor.

Each `kind` is now **derived from the catalog row and compared**, not merely checked against the
vocabulary `{spot, derivatives}`. That gap was real: the registry shipped Binance as `derivatives`
while justifying it by citing `streamCatalog.ts:122,125` as recording it so — line 122 is Binance's row
and reads "Spot exchange."; only line 125, Bybit's, reads "Derivatives exchange." A checkable claim
was checked against nothing. Binance is now `spot`, and the test fails if the two ever diverge again.

## Three defects found and fixed while building this

Each was found by reading the code against its own comments, and each is now covered by a test that
fails without the fix.

1. **A close could exit the wrong position.** The lookup was "find the open row for this symbol" while
   `positionOrderId` sat in the arguments unused, so with more than one open row the code would close
   whichever came first — and every rail would report `pass`, because the rails genuinely passed, for
   the wrong position. A wrong-but-consented close is the worst shape this module could fail in. The
   lookup is now by exact key, a mismatch refuses rather than falling back, and ambiguity refuses rather
   than choosing.
2. **The close cap was conditional.** The guard read
   `if (Number.isFinite(filled) && amountN > filled)`, so *omitting* `filledAmount` skipped the
   comparison entirely and any amount could be closed. The control was strongest exactly when the
   caller had the least evidence. A missing observation is now a refusal, not a bypass.
3. **The amend cap was not implemented.** `amendCcxtOrder`'s own comment promised "a refusal rather
   than a silent shrink when the amended notional would exceed the cap" and the body never computed a
   notional at all. Worse, the `amount`/`price` parameters it accepted were dead. Sizing from those
   caller-supplied values would have made the envelope defeatable by the very argument it checks, so
   the cap is now measured on the venue's reported figures.

## No live trading path, and no fabricated sandbox pass

Nothing here can trade for real. There is no route, no handler, and `handlers.mjs` is untouched, so the
current pins — statics `72`, dynamics `83`, `requireAuth` sites `126` — do not move. Needle 3 ships
no Windows build.

**The E2E evidence is an injected adapter, not a venue sandbox.** Every leg is exercised against a
testnet-shaped in-memory adapter with no network access and no credentials, and one test asserts that
no assertion in the file claims to be a sandbox run. `REAL_SANDBOX_E2E_REQUIREMENTS` records what a
real run still requires, with a named blocker for each.

## Verification

- `npm run typecheck` clean.
- `npm run test --workspace @picc/dashboard` green, run twice before the commit and again after.
- `scripts/ws7-seam-guard.mjs`: the three T21 findings are unchanged (expertoption residue `28`,
  unused dependency `1`, D26 catalog `1`) and were failing before T17 started. T17's own halves pass:
  `absence.discovered-scope-complete`, `perps.cancelOrder-blocked-and-seam-exposed` (**both** halves),
  `lockfile.single-and-no-pnpm`.
- `scripts/cross-room-invariant-gate.mjs`: T17 adds no room and supplies no room facts. All three
  branches re-proven — missing facts exits `1`, 22 incomplete records exit `1` naming 22 rooms, and 22
  valid records exit `0` with "failing rooms: none".
- The AC-7a guard passes, and record 0037's note that the rails matrix was "forthcoming, not yet
  existing" is now stale in the guard's favour: `ccxtVenueLifecycle.rails.test.mjs` exists and is the
  coverage that record said would be needed. The guard comment was left as written rather than edited,
  because a record that has been overtaken by later work is the owner's to reword.
- `ws7SeamGuard.test.mjs`'s unlanded-list pin moved from `["T17", "T18"]` to `["T18"]`, and the
  `PICC.md` row's live claim with it. Both are load-bearing in two directions: a `WS-7` commit subject
  carrying a bare `Tn` credits the task as landed (`ws7-seam-probe.mjs:1203-1207`), which is the trap
  record 0037 walked into.

## Not done, and not claimed

- No real venue sandbox or testnet run. No venue credentials, no egress-capable venue runtime, no
  granted ceremony authority.
- No CI workflow change. `spec:73(d)`'s file-touch union excludes `.github/workflows/**`, which needs
  its own dated amendment; T13 already holds that deviation open in entry 0025. This is a
  self-contradiction in T17's `:1348` file list, which names a CI config the file-touch union forbids
  touching, and it is left visible rather than resolved by widening a boundary.
- No handler, route or UI surface, so no room renders a T17 control.
