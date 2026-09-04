# PICC — Full Scope: Fixes, Worthy Implementations, and Everything Still Open

> **Status in this repo (2026-08-30):** Part 1 items 1–3 (paper adapter shape
> normalization, `GET /api/trading/paper/overview` route, Dashboard net-worth
> live fallback) are **applied and committed** in this tree, with a hermetic
> test suite (`server/__tests__/paperOverviewApi.test.mjs`). Parts 2 and 3 are
> still open — they are the next feature work when this doc is picked up.

### For your AI coding assistant. This is the consolidated reference — read this instead of piecing together every prior session's notes.

**Guardrails (unchanged, restated because this travels standalone):** no live-money order placement,
anywhere, ever. Demo/paper only. No behavioral camouflage against platform bot-detection. Every data
source reports its own honest `source`/status label — never fabricate a number.

---

## Part 1 — This session's verified fixes

Ground truth before and after: **709/709 tests pass, typecheck clean, 0 audit vulnerabilities.**
Patch: `PICC_FIXES_finance-tracker-and-paper-shape.patch`.

1. **`paperAdapter.mjs` shape mismatch (found live, fixed).** Your own latest commit fixed the
   `getAccountState()` stub, but returned the paper ledger's raw fields (`cash`, `starting`, ...)
   instead of the `{balance, demo, real, currency}` shape every other broker adapter returns. Verified
   live: `state.balance` was `undefined` for the paper venue specifically. Fixed to normalize the shape
   like `brokers/expertoption.mjs` does.
2. **`GET /api/trading/paper/overview` — new route.** `paperOverview()` (real cash/PnL/win-rate from
   the paper ledger) previously had no HTTP route at all — unreachable from the frontend even though
   the data was real and correct.
3. **Dashboard net-worth hero card — dead end, given a live fallback.** See Part 2, it's the same root
   issue as the finance tracker gap below; the fix here is the stopgap, Part 2 is the real feature.

---

## Part 2 — Worthy implementation to incorporate: a real Finance Tracker / Net Worth / Wallet feature

This is the highest-leverage thing found this session. **The backend for this already exists,
fully built, and is currently unused:**

- `infra/supabase/income_streams.sql` already defines `financial_accounts` (id, name, type
  `asset/expense/revenue/liability`, balance, currency) and `transactions` (account_id, amount,
  description, category, tags, transaction_date) — both with proper indexes and **Row Level Security
  already written** (`"Users can manage own financial accounts"`, scoped by `auth.uid()`).
- `apps/dashboard/server/services/localstore.mjs` already registers both tables for the self-hosted
  (no-Supabase) mode — meaning `/api/data/financial_accounts` and `/api/data/transactions` already work
  today, with the same real per-user row isolation already verified for `simulations`/`agent_logs`
  earlier this audit.
- The schema's own column names (`firefly_account_id`, `firefly_transaction_id`) reveal the original
  intent: sync from **Firefly III** (a real open-source personal finance manager), not just manual
  entry. That's a legitimate Phase 2 for this feature, not required for an MVP.

**What's missing is 100% frontend.** `src/lib/finance.ts` — the module `Dashboard.tsx` actually
uses — talks to `localStorage` instead of this real backend, has no write functions at all, and no UI
anywhere calls it. That's the entire gap.

### 2a. MVP — manual accounts + transactions, using the existing backend (no external dependency)

- [ ] Rewrite `src/lib/finance.ts` to use `listData`/`insertData`/`updateData`/`deleteData` from
      `localdata.ts` against the `financial_accounts` and `transactions` tables — the exact same
      pattern `Dashboard.tsx` already uses for `simulations`. Delete the localStorage read-only stub.
- [ ] New page or a section on `Profile.tsx`/`Settings.tsx`: **Accounts** — list accounts, add one
      (name, type, currency, starting balance), edit/delete. Trivial CRUD form against a table that
      already has RLS — no new backend validation logic needed beyond what `/api/data/*` already
      enforces generically.
- [ ] **Transactions** list per account: add/edit/delete, category + tag fields already in the schema.
      A running balance per account is just `starting balance + sum(transactions.amount)`.
- [ ] **Net-worth snapshot, computed not manually entered.** Replace the current dead `NetWorthSnapshot`
      manual-entry concept with a computed value: `sum(all asset-type account balances) - sum(all
      liability-type account balances)`, refreshed on every Dashboard load. This is strictly better
      than the original design (nothing to remember to update) and removes the need for a separate
      snapshot-entry UI entirely.
- [ ] **Wire the trading suite in as one account, automatically.** Once `financial_accounts` exists for
      real, auto-create (or let the user link) a `type: asset` account whose balance is kept in sync
      with `getPaperOverview().cash` (and, once Wave 1 below restores a real execution path, each
      connected broker's live balance too). This is the actual bridge between "trading suite" and
      "finance tracker" you asked about — not a special case, just one more account in the same table.
      The stopgap fallback added this session (Part 1, item 3) becomes unnecessary once this exists —
      remove it then, don't leave both.
- [ ] Currency: the existing hardcoded `MYR` in `Dashboard.tsx` should become the account's own
      `currency` field, formatted per-account; a simple fixed-rate or live-rate total conversion for
      the single net-worth number is a reasonable v1 (don't over-build FX handling here).

### 2b. Phase 2 (later, real but not urgent) — Firefly III sync

- [ ] A connector following the exact pattern already used for other external services: pull
      accounts/transactions from a user-configured Firefly III instance's API, upsert into
      `financial_accounts`/`transactions` keyed by `firefly_account_id`/`firefly_transaction_id` (both
      columns already exist for exactly this). Gate behind an env var / Settings toggle, same as every
      other optional integration in this codebase (`FIREFLY_URL`, `FIREFLY_TOKEN`). Honest degradation
      when not configured, same pattern as everything else here.

---

## Part 3 — The other major open item: Wave 1, restoring trade execution

Not new this session — already fully scoped in `docs/TRADING_MULTIPLATFORM_ROADMAP.md` §6, restated
here because "everything" should include it and its own checklist hasn't been started yet
(confirmed: all items still unchecked). Summary for context in this consolidated doc:

- [ ] Define a `BrokerAdapter` execution contract (`placeOrder`, `closeOrder`) separate from the
      existing read-only `LiveBroker` contract (`getCandles`, `getAccountState`, etc. — already solid,
      don't touch).
- [ ] Implement it for exactly two adapters first: `paper` (trivial — it's already a local simulation)
      and `expertoption` (demo-only, reusing the session/token machinery that already exists and is
      well-tested — the part that was removed was the *tick-driven autopilot loop*, not the underlying
      session/WS code, which is intact).
- [ ] A new `executorRegistry.mjs` that routes a "place this trade" call to whichever adapter is
      active, with the demo-only guard living at this single choke point — one place to audit, not
      scattered across call sites like the old architecture had.
- [ ] Only after that: decide whether to bring back an autonomous tick loop (the old "autopilot") on
      top of it, or keep PICC advisory-first with manual-only execution through the new adapters. That's
      a product decision, not an engineering one — flag it back to the project owner rather than
      assuming.

---

## Part 4 — Additional considerations (smaller, real, not urgent)

- [ ] `content.js` (extension) — still large, no bundler. Deprioritized twice now; fine to keep
      deprioritizing, but it's the file most likely to bite during a rushed edit.
- [ ] Multi-user trading isolation — documented as intentional (single browser session = single
      broker login). Once Part 2's account system exists, the same question applies there too: decide
      now whether `financial_accounts` rows should stay strictly per-user (matches its RLS as written)
      even on a single-operator instance, or whether a household/shared mode is ever wanted. Cheaper to
      decide before data exists than to migrate after.
- [ ] `docs/TRADING_MULTIPLATFORM_ROADMAP.md` and this document will drift out of sync the moment
      either gets edited without the other — treat this file as the current index, and fold its
      relevant parts back into the roadmap doc once Part 2/3 work actually starts, same "one living
      doc, not scattered snapshots" principle used throughout this project so far.

---

## Master checklist (flat)

- [x] Patch applied: paper adapter shape fix + paper/overview route + Dashboard fallback
- [x] `finance.ts` rewritten against `financial_accounts`/`transactions` via `localdata.ts` (2026-09-04 — lib + FinanceTracker + tests)
- [x] Accounts CRUD UI shipped (Profile → Finance tracker)
- [x] Transactions CRUD UI shipped (per-account, category/tags/date)
- [x] Net worth computed from real account balances, not manually snapshotted (assets − liabilities, per-currency + fixed-rate USD conversion)
- [x] Trading suite balance(s) wired in as a real account, auto-synced (`synced` paper-trading account tracking `getPaperOverview().cash`)
- [x] Dashboard.tsx's temporary paper-balance fallback removed once the above exists (hero now reads the computed finance-tracker net worth)
- [ ] (Later) Firefly III sync connector
- [ ] Wave 1 executor contract + paper/expertoption adapters + registry choke point
- [ ] Product decision made on autonomous execution vs. manual-only, post-Wave-1