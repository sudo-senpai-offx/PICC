# 0009 - BANDWIDTH_SUITE_AUTOMATOR_CLAIM v1 -> v2

Supersession record for the claim, carried in two product documents, that a
six-provider bandwidth suite, an `automator` service module and an
`/api/automator/*` route group ship in this repository.

rule: BANDWIDTH_SUITE_AUTOMATOR_CLAIM
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0009-BANDWIDTH_SUITE_AUTOMATOR_CLAIM-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 is the repository's cleanest instance of the shape R5.2 names. The
  bandwidth suite is recorded as removed end-to-end in three places that agree
  with each other - `PICC.md` §10 (`PICC_BANDWIDTH_SUITE_design_v1 | REJECTED |
  ADR-0002 struck; removed end-to-end`), `docs/adr/0002-bandwidth-suite-rejected.md`,
  and the shipped collector's own header (`collectors.mjs:2-3`: "The
  bandwidth-suite removal left the CashPilot aggregator as the sole collector")
  - and v1 nevertheless described its collectors, its module and its route group
  as live in `PICC.md` §0/§3.3/§3.4/§4/§9 and `README.md`. A whole-tree grep
  for the provider names returns documents and archived or rejected artefacts and
  no shipped collector code: there is no `automator.mjs`, no
  `automatorAdvice.mjs`, and no `/api/automator` route in any non-test server
  module. `infra/pi-node/` is a self-hosted provider *deployment*, not a
  collector, and the app reads no balances from it. v2 states the reduction, the
  surviving collector, the ADR, and the absent module and route names.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, requirements
  R5.1 and R5.2 and acceptance criteria AC-016 and AC-017; owner decision D9 /
  ADR-0002 (bandwidth suite rejected). Findings H3 and H11 of
  .superpowers/sdd/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1/task-t5b-investigation.md,
  section 3 item 1, which names this the strongest R5.2 candidate in the
  repository. Sibling records: 0011-BANDWIDTH_PAYOUT_CLAIMS_LEG (the execution
  leg the same suite's plan described), 0007-BROWSER_EXTENSION_SHIPPED_CLAIM,
  0008-HOSTED_PERSISTENCE_AUTH_CLAIM.

## What changed

| Location | v1 claim | v2 |
|---|---|---|
| `PICC.md` §0 mission | "bandwidth/DePIN/storage/GPU/crypto/DeFi/NFT/P2P/AI-agent channels" as a shipped connector layer | unchanged - the connector layer and `connectors.mjs` are real. Only the removed suite is corrected, and the channel list is not a claim about a named provider. |
| `PICC.md` §3.3 | route group "Automator `/api/automator/status\|health\|assist`" | removed, and a note records that `/api/automator/*` does not exist |
| `PICC.md` §3.4 | "**Automator** - bandwidth balance collectors (Honeygain, IPRoyal Pawns, Traffmonetizer JWT, Repocket, manual/desktop EarnApp, PacketStream); JWT-expiry alerts (<=3 days); 30-min job" | "**Bandwidth balance collection - reduced to one collector (ADR-0002)**", the six named providers recorded as removed, `collectors.mjs:2-3` cited, and the absent alert job and scheduler rows stated |
| `PICC.md` §4 | "**Income & automator (8):** `connectors` . `collectors` . `automator` . `automatorAdvice` . ..." | "**Income (6):**", both absent modules removed and named |
| `PICC.md` §9 | "**Automator** bandwidth collectors as in §3.4" | "**Bandwidth collectors** as in §3.4 - CashPilot only, after ADR-0002 removed the wider suite and the `automator` module" |
| `README.md` feature 5 | "**Income connectors & Automator** - bandwidth providers (Honeygain, Pawns, Traffmonetizer, Repocket, EarnApp, PacketStream) ... and LLM health assist" | "**Income connectors**" - the **CashPilot aggregator named as the only surviving bandwidth source**, with Honeygain and the other five named inside the rejected set (they do not ship), and the `automator` service and its LLM health assist recorded as removed with the ADR cited |
| `README.md` roadmap | "Income connectors, Automator, Stream catalog, classifications \| ✅" | "Income connectors, Stream catalog, classifications \| ✅ (bandwidth suite removed - ADR-0002)" |

## What was deliberately not done

- `infra/pi-node/` and its `.env.example` / `README.md` were not edited. It is a
  provider deployment artefact for a device the operator may own; it is not a
  claim that the app collects from it, and correcting it is out of this slice's
  scope.
- `docs/adr/0002-bandwidth-suite-rejected.md` and the rejected spec
  `PICC_BANDWIDTH_SUITE_design_v1` were not edited. A rejection record that
  names the rejected thing is the same status as record 0001's: naming the claim
  is the record's purpose.
- The §0 mission sentence was not touched. "bandwidth/DePIN/..." is a category
  list for a connector layer that does ship (`connectors.mjs` is real and carries
  the `browser` transport over playwright-core); correcting it to remove the word
  "bandwidth" would have deleted a true statement to fix an adjacent false one.

## Why historicalTradesAffected is `none`

Decided, not defaulted, and the argument is the same shape as 0001's: every
sentence v2 changes is prose about which providers a module polls.

The clause worth arguing is the trade-leg one, because `PICC.md` v1 §11
described this same suite as the origin of a first live *execution* leg -
bandwidth payout claims on fresh human consent. That is corrected separately, by
record 0011, on its own reasoning, precisely so that this record's `none` is not
carrying an execution-path claim. What this record corrects is balance
*collection*: a poller's provider list and a route group. Neither was ever read
by a backtest, a sizing formula, a scoring path, a payout calculation or a
result label, and no paper or backtest result in this repository was computed
from a bandwidth balance - the paper ledger is fed by market data, not by income
connectors. Correcting the provider list therefore cannot change how any past
result was produced or read: `none` is the accurate answer, and `reinterpret`
would be the honest answer only if some recorded result had been labelled under
the v1 provider list, which none was.
