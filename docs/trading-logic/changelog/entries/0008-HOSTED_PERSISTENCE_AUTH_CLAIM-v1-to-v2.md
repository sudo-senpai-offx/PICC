# 0008 - HOSTED_PERSISTENCE_AUTH_CLAIM v1 -> v2

Supersession record for the claim, carried in three product documents, that a
hosted Supabase persistence and authentication layer ships in this repository.

rule: HOSTED_PERSISTENCE_AUTH_CLAIM
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0008-HOSTED_PERSISTENCE_AUTH_CLAIM-v1-to-v2.md)
date: 2026-09-27
historicalTradesAffected: none
reason: >-
  v1 described Supabase as the shipped database and auth layer: a service
  module in the inventory, a stack entry in the frontend layer, the login page's
  authentication mechanism, the JWT scheme on all three payment paths, three
  environment variables, and a "hosted mode" in the privacy policy that sent
  profile and payment rows to the operator's own project. None of it is live.
  There is no supabase package in the root or dashboard `package.json` and no
  client anywhere in `apps/dashboard/server` or `apps/dashboard/src`; every
  occurrence of the word in shipped code is a comment recording the removal.
  `apps/dashboard/.env.example:8-10` says "Persistence: fully local (Supabase
  REMOVED per owner) ... No cloud database, no service-role keys, nothing to
  configure here"; `localstore.mjs:2-3` says every collection "now lives in
  server/data/<table>.json, fully self-hosted"; `auth.mjs:215` says the local
  verifier "Replaces the Supabase verifier". The three SQL files in
  `infra/supabase/` survive, which is what made v1 look true to a reader - but
  a schema with no client is an orphaned artefact, not a persistence layer, and
  v2 says so in those words rather than leaving the row to imply a live
  database.
source: >-
  WS-7 spec PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md, requirement
  R5.1 and acceptance criterion AC-016. The removal itself is recorded in
  apps/dashboard/.env.example:8-10 and in the code comments cited above, which
  attribute it to owner decision "D8". Findings H2 and H11 of
  .superpowers/sdd/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1/task-t5b-investigation.md.
  Sibling records: 0007-BROWSER_EXTENSION_SHIPPED_CLAIM (the other removed
  subsystem the same three documents described as live),
  0009-BANDWIDTH_SUITE_AUTOMATOR_CLAIM, 0010-PAPER_ONLY_ORDER_PATH_CLAIM.

## The decision-number collision, recorded rather than silently resolved

`PICC.md` §12.4 defines **D8 = loopback-only publishes**, and that definition is
used consistently inside `PICC.md` (it backs the "Docker/n8n containers bind
loopback only (D8)" line in §3.5). The Supabase removal is attributed to a
"per owner - D8" in `.env.example` and in five code comments. The same
identifier therefore denotes two unrelated decisions, one of which is a
persistence-architecture change that invalidates the architecture diagram, the
frontend layer list, the page table, the payments section, the environment
classes and the deployment section, and the other of which is a network-binding
choice.

This record does **not** renumber either decision. The spec is the register of
decisions and it is out of scope for this slice, and the code comments are code.
What v2 does is state the collision where a reader of `PICC.md` will meet it: the
Supabase layer entry in §3.2 now says in terms that the removal is recorded
elsewhere as "D8" and that this is a different decision from §12.4's D8. That
makes the ambiguity visible and resolvable instead of leaving two meanings
sharing one name.

## What changed

| Document | v1 claim | v2 |
|---|---|---|
| `PICC.md` §3.2 frontend | "React + TypeScript + Vite + Supabase" | "on the local JSON data store (`localstore.mjs`)" |
| `PICC.md` §3.2 providers | "**Supabase** - RLS-scoped tables v1 + v2 income-classification schema (`infra/supabase/`)" | "Persistence is fully local", the SQL files named as an orphaned schema with no client, plus the D8 collision note |
| `PICC.md` §4 inventory | "**Persistence & infra (9):** ... `supabase` client ..." | "(8)", the `supabase` client removed, "There is no `supabase` module" |
| `PICC.md` §5 page table | "\| Login \| Supabase auth \|" | "\| Login \| local `auth.mjs` verifier (the hosted JWT verifier was replaced) \|" |
| `PICC.md` §7 | "Three paths, all Supabase-JWT-authed" | "all behind the local `auth.mjs` verifier (the hosted Supabase JWT verifier was replaced; there is no hosted auth)" |
| `PICC.md` §18 | "Supabase: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`" | "Persistence: nothing to configure", naming the three variables as removed |
| `PICC.md` §18 deployment | "Supabase: `schema.sql` + `v2.sql`" | "No database setup step - the SQL is orphaned documentation, not a deployment step" |
| `README.md` directory table | "React + TypeScript + Vite + Supabase" | "(local JSON data store)" |
| `README.md` directory table | "\| `infra/supabase` \| Database schema with Row Level Security \|" | "**Orphaned** ... kept as documentation - no client in the tree" |
| `README.md` quick start | "# add Supabase + LLM + Serper + payment keys" | "# add LLM + Serper + payment keys (no database keys)" |
| `README.md` roadmap | "..., Supabase v1+v2 \| ✅" | "..., local JSON data store \| ✅" |
| `PRIVACY.md` mode table | "\| Accounts \| ... \| Supabase auth, per-user data scoping \|" and "profile/payment rows to your Supabase project" | local verifier; conditional on an operator-configured store |
| `PRIVACY.md` outbound list | item 4, "Hosted mode only - Supabase: with `VITE_SUPABASE_URL`/keys configured ... stored in **your** Supabase project" | item 4 restated as a hosted store the operator wires up themselves, with the removal and the absence of a client stated |
| `PRIVACY.md` retention | "profile/payment rows live in your Supabase project" | "whatever store the operator configured"; the SQL files named as orphaned documentation |

## Why the privacy-policy wording changed shape rather than disappearing

The hosted mode is not a fiction: the policy's local-only default still holds,
and an operator *can* front the app with a reverse proxy and TLS. What v1 got
wrong was naming a specific third-party store, its specific environment
variables and its specific schema as the mechanism, in a document whose whole
purpose is to tell a reader where their data goes. v2 keeps the mode, keeps the
conditional, and replaces the false specificity with the accurate statement:
nothing is sent unless the operator wires up a store, and then it goes to that
operator's store, not to PICC. Deleting the mode instead would have been
over-correction; the "hosted mode" line in the policy's own changelog note is
still true.

## Why historicalTradesAffected is `none`

Decided, not defaulted. The superseded text was architecture prose: a stack
entry, a bullet in a layer list, a table cell naming a page's auth mechanism, a
sentence naming the JWT scheme three payment paths use, and a list of
environment variable names. None of it was parsed by a backtest, a sizing
formula, a scoring path or a result label.

The clause worth arguing rather than asserting is the payments one, because
"the JWT scheme all three payment paths use" looks load-bearing. It is not: the
three payment paths' inputs, outputs, metadata round-trips, entitlement checks
and audit rows are unchanged by this correction, and the local verifier already
sits behind the same routes and the same authorisation checks that the hosted
verifier sat behind. What changed is the name of the module that answers "who is
this caller", which was already the local one before v2 was written. No prior
payment result, grant, tier assignment or audit row is affected, so no result
needs re-labelling and none is invalidated.

The orphaned SQL is a real file and is retained. It is documentation of a data
model, not a store, and v2 says so where a reader would otherwise have inferred
otherwise from a directory table.
