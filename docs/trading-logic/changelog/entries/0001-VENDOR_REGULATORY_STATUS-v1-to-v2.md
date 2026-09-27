# 0001 - VENDOR_REGULATORY_STATUS v1 -> v2

Supersession record for the third-party regulatory-status claims that appeared in
PICC's own passive-income catalog and in the browser overlay's site index.

rule: VENDOR_REGULATORY_STATUS
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0001-VENDOR_REGULATORY_STATUS-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 asserted Malaysian Securities Commission registration (the "DAX" designation)
  for eight third-party venues - Luno, MX Global, HATA Digital, SINEGY DAX,
  Kinetic DAX, Funding Societies, Selangor Kuasa and Pitik - in the user-facing
  catalog at apps/dashboard/src/lib/streamCatalog.ts and again in the overlay's
  SITE_INDEX at apps/dashboard/server/services/browserStudio.mjs. PICC holds no
  licence, registry extract, or issuer disclosure in-tree for any of those
  registrations, so the assertions were unverifiable inside the repository while
  being presented to the user as fact. Owner decision D26 deletes unverifiable
  third-party regulatory claims rather than trying to verify them, and R5.4
  forbids keeping such a claim with a caveat or footnoting it to a source PICC
  does not control. v2 therefore removes the regulatory assertion and keeps
  everything that is genuinely product information. All nine catalog entries
  remain: id, name, category, residential, vps, payout and url are unchanged, and
  CATALOG still resolves every entry.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, decision D26
  and requirement R5.4, acceptance criterion AC-049; owner decision recorded
  2026-09-26.

## What changed

streamCatalog.ts notes:

| Entry | v1 note (claim portion) | v2 note |
|---|---|---|
| luno | "SC-registered DAX. ..." | "Buy & hold BTC/ETH; no local staking product - log gains as manual balance." |
| mx-global | "SC-registered DAX (Binance is an investor). BTC/ETH/USDT pairs." | "BTC/ETH/USDT spot pairs." |
| hata | "SC-registered DAX (2026 list)." | "Crypto exchange. PICC asserts no regulatory status for this venue." |
| sinegy | "SC-registered DAX based in Penang." | "Crypto exchange based in Penang. PICC asserts no regulatory status for this venue." |
| kinetic | "SC-registered DAX in KL." | "Crypto exchange based in Kuala Lumpur. PICC asserts no regulatory status for this venue." |
| funding-circle | "Malaysia SC-licensed P2P SME lending; ..." | "P2P SME lending; ..." |
| selangor-kuasa | "SC-licensed P2P Islamic financing platform." | "P2P Islamic financing platform. PICC asserts no regulatory status for this venue." |
| pitik | "SC-licensed agritech P2P for poultry/livestock financing." | "Agritech P2P for poultry/livestock financing. PICC asserts no regulatory status for this venue." |

browserStudio.mjs SITE_INDEX: the last tuple element for luno, mx-global, hata,
sinegy, kinetic, funding-circle, selangor-kuasa and pitik was the claim string
alone. It now carries the product description only ("Crypto exchange (MY).",
"P2P SME lending (MY).", "Islamic P2P financing (MY).",
"Agritech P2P financing (MY)."). Hosts, ids, names, categories,
payoutThreshold and url are unchanged.

## Deliberate decisions inside this deletion

- The `(Binance is an investor)` parenthetical on mx-global was removed as well.
  It is not a regulatory claim, but it is a third-party ownership assertion with
  no in-tree evidence, which is the same class of unevidenced assertion D26
  targets, and it is not "genuinely useful product information". The listed
  trading pairs were kept because they describe what the venue trades.
- The "DAX" substring still appears in two entry *names* ("SINEGY DAX",
  "Kinetic DAX"). Those are the venues' own branding, carried as a display name
  that PICC does not assert, and AC-049 forbids changing the entries themselves.
- Geography ("based in Penang", "in KL", "(MY)") was kept: it is orientation
  information for a Malaysia-scoped user, not a regulatory status claim.

## Why historicalTradesAffected is `none`

Decided, not defaulted. The `note` field is display copy only. It is read by the
catalog UI and the overlay help panel and by nothing else: no backtest, no
metric, no entry-selection branch, no risk gate and no scoring path ever parsed
it. Removing text that no execution or interpretation path consumed cannot change
how any past trade, backtest or paper result was produced or read. The values
`reinterpret` and `invalidated` would both require that the superseded text had
been load-bearing for interpreting a past result; it was not, so `none` is the
accurate answer and not a lazy one.
