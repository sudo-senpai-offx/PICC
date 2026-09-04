# PICC — Finalization Report & Multi-Phased Blueprint

**Date:** 2026-09-04
**Scope:** the complete uncommitted body of work that shipped today (2026-09-02 audit remediation
Fixes 1–8, the UX/a11y wave, secret purge + CI gate, doc truth-sync) **plus** the standing context
of everything already committed since `origin/master` last advanced: the F-series explicit-audit
fixes (F-01…F-12), the explicit-audit task closures (A1–A8), the Q5 Income-Generalization
implementation (Tasks 1–13), and the T-series notification/venue work.
**Audience:** the AI coding assistant and the human reviewer. This file is the **single wrap-up
document** for the 2026-09-02→2026-09-04 session arc: every change, every decision, and everything
still open, with the multi-phased blueprint for what happens next. Where a finer-grained checklist
already exists (spec files, the audit report, the ledger), this report references it rather than
duplicating it — the linked file remains the canonical checklist.

> Ground-truth verification for everything in this report was run against the committed tree on
> 2026-09-04: **1,525/1,525 tests pass across 143 files** (`npx vitest run --maxWorkers=3` from
> `apps/dashboard`), `npx tsc -b --noEmit` exits 0, and the last audit run (2026-09-02) reported
> 0 `npm audit` vulnerabilities for the dashboard workspace.

---

## 1. Executive summary

The repository had two layers of "in-flight" work when this finalization pass began:

1. **25 committed-but-unpushed commits on local `master`** (origin/master was 25 behind): the Q5
   Income-Generalization series (13 commits, Tasks 1–13), the F-series explicit-audit fix series
   with rewritten hashes on top of the Q5 tree, and the 2026-09-04 doc/closure commits
   (indicators-timeframe strict validation `e2a8d7c`, Garman-Klass/Yang-Zhang volatility estimators
   `e1ab756`, archived-extension test retarget `fe66b81`, PRIVACY dual-mode + SETUP vault truth +
   ledger closures `fc456cca`).
2. **A large uncommitted working tree** in the main checkout: the 2026-09-02/03 audit-remediation
   wave (Fixes 1–8 from `docs/AUDIT_REPORT.md`), a frontend UX/a11y pass, and new hermetic test
   coverage — plus scratch/hygiene items that the audit explicitly said must never be committed.

This finalization pass:
- Verified the uncommitted wave end-to-end (full suite + typecheck green).
- Committed the wave in logical slices referencing the audit finding ids (spec REQ-4 convention).
- Purged committed secrets-adjacent probe scripts, added a gitleaks CI gate, and neutralized the
  remaining fixture token (Fix 1).
- Closed, declined-with-reason, or scheduled every remaining audit item.
- Untracked/gitignored build & scratch artifacts (`tsconfig.tsbuildinfo`, `dev_pack_code.py`,
  `project_tree.txt`, `.freebuff/`).
- Wrote this report, updated `docs/AUDIT_REPORT.md` remediation status, and appended `CHANGELOG.md`.
- Pushed `master` to `origin` (user-approved final gate).

**Net codebase posture:** advisory-only trading decision support (no execution weld anywhere), a
clean payment-security surface (no IDOR, owner-bound eWallet orders, functional BTCPay grants), a
credential-at-rest vault, loopback-only container exposure, shell-injection-free process
invocation, and a suite of 1,525 tests that lock all of it in.

---

## 2. What changed today (2026-09-04 finalization wave) — complete ledger

All files below were part of the uncommitted tree reviewed and committed in this pass. Each commit
is listed in §3 with its message; file-level detail follows.

### 2.1 Secrets hygiene & CI (audit Fix 1)

| File | Change |
| :-- | :-- |
| `scripts/probe-eo-cookie.mjs`, `probe-eo-pushes.mjs`, `probe-eo-sessionid.mjs`, `probe-eo-sidebyside.mjs`, `probe-eo-subscribe.mjs`, `probe-live-eo.mjs` | **Deleted from the tree** (`git rm`, staged). All six hard-coded the committed ExpertOption session token `6dc12a98…` (Finding #1 of the audit). They were dev-only diagnostic probes with zero server imports (verified), but a committed bearer token is exactly what scanners flag. |
| `.gitleaks.toml` | **New.** Gitleaks config: allowlist for known false positives (`tsconfig.tsbuildinfo`, `server/data/`, `package-lock.json`, `.test.*` fixtures) + explicit deny rules pinning the leaked EO token(s) so they fail the gate even if gitleaks' generic rules change. |
| `.github/workflows/ci.yml` | **New `secrets-scan` job** running `gitleaks/gitleaks-action@v2` (fetch-depth 0, config `.gitleaks.toml`) — runs FIRST and independently so a leaked credential never reaches the build matrix. |
| `apps/dashboard/server/__tests__/browserStudio.login.test.mjs` | Second real-looking token in a fixture (`b456f4a9…`) replaced with a fake `"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"` mirror so the test corpus itself carries no credential-shaped strings. |

> **Decision (partial by nature):** in-tree purge + CI gate are done. **Rotating the live EO
> session** and **rewriting history** (the token is present in pushed history since the initial
> commit) are human-only steps — rewriting origin history is destructive and needs explicit
> approval. See §6.1 remaining-work items R1a/R1b.

### 2.2 Payments & authorization (audit Fixes 2, 3, 5, 6)

| File | Change |
| :-- | :-- |
| `apps/dashboard/server/services/btcpay.mjs` | `createBtcpayInvoice` now accepts + embeds `{ userId, tier }` in invoice **metadata** and returns them; `btcpayInvoiceStatus` reads the metadata back (BTCPay echoes it) and returns a validated `userId`/`tier` (`tier` restricted to `pro`/`business`). The handler's grant branch now actually sees the owner/tier it checks (Fix 2 — previously the grant was permanently unreachable because the service never returned those fields). |
| `apps/dashboard/server/services/ewallet.mjs` | `createEwalletOrder` **requires a `userId`** and stores it on the order. `submitEwalletOrder` now takes `{ actorUserId, selfApprove }`: an order with an owner can only be confirmed by its owner; owner-less (legacy) orders and non-owner confirmations are rejected unless `selfApprove` is explicitly true. Confirmed orders record `confirmed_by` + `self_approved`. New `getEwalletOrder` read helper (owner-scoped lookup). (Fix 6 — orders are now bound to a real owner; the self-approve forge path is gated behind an explicit demo/admin flag.) |
| `apps/dashboard/server/handlers.mjs` | Four coordinated changes: (1) **Stripe portal IDOR closure (Fix 3)** — the `/api/billing/stripe/portal` route ignores any client-supplied `customerId` and resolves the authenticated user's OWN customer via new `stripeCustomerForUser()` (Supabase `profiles.stripe_customer_id` when `admin` is live, local `billing` store otherwise); 400 `"no Stripe customer on file"` when absent. (2) **`round2` defined + exported** (module scope, non-finite → null) fixing the `ReferenceError` on the `/api/trading/spread` route (Fix 5). (3) **eWallet order/submit handlers** bind orders to `userId` (authenticated user, or `"local-owner"` in the no-accounts first-run) and pass `actorUserId`/`selfApprove` (self-approve only while `!hasUsers()` — single-owner admin/demo mode) (Fix 6). (4) **BTCPay invoice handler** passes the authenticated `userId` + tier (default `"pro"`) into `createBtcpayInvoice` (Fix 2). |
| `apps/dashboard/server/__tests__/btcpay.test.mjs` | **New.** Mocked BTCPay server; asserts invoice metadata carries `userId`/`tier` and the status round-trip restores them (the exact seam Fix 2 needed). |
| `apps/dashboard/server/__tests__/stripePortal.test.mjs` | **New.** Local-mode (admin mocked null) end-to-end handler test: asserts `createPortalSession` sees the authenticated user's OWN customer and ignores a body-supplied foreign `customerId`. |
| `apps/dashboard/server/__tests__/ewallet.test.mjs` | Extended for the owner-binding contract: orders require an owner; non-owner submit rejected; owner submit confirms; self-approve path only for owner-less/legacy orders. |
| `apps/dashboard/server/__tests__/spreadRoute.test.mjs` | **New.** Exercises `/api/trading/spread` end-to-end with two in-memory CCXT exchanges (real `fetchTicker` injected via `getCredentials` mock; liveEO mocked off) — previously this route threw `ReferenceError: round2 is not defined` → 500. |

### 2.3 Web-app correctness (audit Fix 4)

| File | Change |
| :-- | :-- |
| `apps/dashboard/src/lib/api.ts` | `getSessionPolicy`/`setSessionPolicy` no longer repeat the `/api` prefix (`request()`/`post()` prepend it) — the transport URL resolves to a single `/api/trading/session-policy` instead of the 404-ing `/api/api/...`. |
| `apps/dashboard/src/lib/__tests__/sessionPolicy.test.ts` | **New.** Locks the resolved URL to a single prefix. |

### 2.4 Infrastructure hardening (audit Fix 7)

| File | Change |
| :-- | :-- |
| `infra/dashboard/docker-compose.yml` | Port publish bound to `127.0.0.1:${PICC_PORT:-3000}:3000` — no more host-wide/LAN exposure of the dashboard. |
| `infra/n8n/docker-compose.yml` | Same treatment for n8n (`127.0.0.1:5678:5678`) — n8n is PICC-internal automation. |

### 2.5 Process-invocation hardening (audit Fix 8, CWE-78)

| File | Change |
| :-- | :-- |
| `apps/dashboard/server/services/browserBridge.mjs` | Every `execSync("shell string …")` converted to `execFileSync(cmd, [args…])` with argument arrays: `reg query` (registry-executable + locale lookups), `pgrep -f`, `kill -9`, `powershell -File` (profile-kill + viewport), `taskkill /PID`. No value is ever re-parsed by a shell. |
| `apps/dashboard/server/__tests__/browserBridge.execFile.test.mjs` | **New.** Source-level regression lock: no `execSync` may return to the module; the previously-unsafe sinks must stay argument arrays (`["-f", needle]`, `["-9", String(id)]`, `["/PID", String(id), "/T", "/F"]`). |

### 2.6 New hermetic test coverage + store hermeticity

| File | Change |
| :-- | :-- |
| `apps/dashboard/server/services/tradeJournal.mjs` | `DATA_DIR` now honors `PICC_JOURNAL_DATA_DIR` (env override) so tests pin a temp dir before import. |
| `apps/dashboard/server/__tests__/tradeJournal.test.mjs` | **New.** Temp-dir-pinned tests for `addEntry` normalization (long/short, fields, open status). |
| `apps/dashboard/server/__tests__/notificationCenter.test.mjs` | **New.** Temp-dir-pinned tests for `notify`/`getNotifications` (id, level/channel normalization). |
| `apps/dashboard/server/__tests__/portfolioAnalytics.test.mjs` | **New.** `stressTest`: weighted shock impact math, worst-first sort, worst/best case, per-asset impacts. |
| `apps/dashboard/server/__tests__/riskParity.test.mjs` | **New.** `inverseVolWeights`, `equalRiskContribution`, `riskParityAllocation` math. |

> These close part of the audit's §7 coverage blind spot (untested services). `signalEngine`,
> `marketDataBus`, `scheduler` deep coverage remains scheduled — see §6 remaining work R4/R5.

### 2.7 Frontend UX & accessibility wave

| File | Change |
| :-- | :-- |
| `src/components/ui.tsx` | New `Skeleton` placeholder primitive (width/height/style props, `aria-hidden`). |
| `src/index.css` | Skeleton shimmer keyframes; `prefers-reduced-motion` global kill-switch (spinner keeps shape, skeleton shimmer stops); compact mobile tier (`≤560px`: topbar/search/HUD/content adjustments). |
| `src/components/AccountMetricsPanel.tsx`, `DataSourcesPanel.tsx`, `PortfolioAggregatePanel.tsx`, `SessionPanel.tsx` | Replace "Loading…" text with shape-preserving skeleton rows (`aria-busy` on container). |
| `src/components/CommandPalette.tsx` | Full combobox semantics: `role="combobox"`/`listbox`/`option`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, per-option ids, dialog label. |
| `src/components/NotificationCenter.tsx` | Notification items are real `<button>`s (keyboard-activable) with `aria-label` summarizing symbol/condition/value; bell gets `aria-expanded`/`aria-haspopup`/label. |
| `src/components/DockablePreview.tsx` | Dock tabs get `role="tab"`/`aria-selected`/`tabIndex=0` + Enter/Space activation. |
| `src/components/TopBar.tsx`, `TradingHud.tsx` | `aria-expanded`/`aria-label` on burger, palette, and HUD expand/collapse controls. |
| `src/components/TradingChart.tsx` | Fullscreen toggle ("⛶ Fullscreen" / "✕ Exit FS") — fixed inset-0 overlay, viewport-derived canvas height so the chart actually re-renders, Escape to exit. |
| `src/components/TradeOrderForm.tsx` | **Paper-only**: removes the "Demo EO" mode toggle, `placeDemoTrade`/`getBrokerDemoStatus` imports and the whole demo branch. Retitled "Quick Paper Trade" with a `simulated · advisory-only` badge. Entry-price field now unconditional. |
| `src/components/__tests__/Skeleton.test.tsx` | **New.** Renders widths/heights + aria-hidden. |

> **Decision:** removing the demo-EO path from the order form is the UI half of the standing
> advisory-only posture (execution was already removed server-side — `autopilot.mjs` reports
> "execution removed — advisory-only"; the roadmap §0 marks demo/real order placement dead-letter,
> and NEXT_WAVE §2.1 ADR "redirect, not execute" is the product rule). The form can now only ever
> place a paper (simulated) trade behind the human-approval gate.

### 2.8 Docs, hygiene & housekeeping (this finalization pass)

| File | Change |
| :-- | :-- |
| `docs/AUDIT_REPORT.md` | Committed (was untracked). §8 remediation status updated: Fixes 1–8 addressed/closed this wave; Fix 10 declined-with-reason; human-only follow-ups itemised (see §6.1). |
| `docs/FINALIZATION_REPORT.md` | This file. |
| `CHANGELOG.md` | New dated section summarising the wave. |
| `.gitignore` | Added `*.tsbuildinfo`, `.freebuff/`, `dev_pack_code.py`, `project_tree.txt`. |
| `apps/dashboard/tsconfig.tsbuildinfo` | **Untracked** (`git rm --cached`) — a build artifact the audit §7 explicitly says must never be committed. |

---

## 3. Commit log of this wave (in push order)

| # | Commit (subject) | Contents |
| :-- | :-- | :-- |
| 1 | `chore(security): purge committed EO probe scripts, add gitleaks gate (audit Fix 1)` | 6 deleted probe scripts, `.gitleaks.toml`, `ci.yml` secrets-scan job, fixture token neutralisation. |
| 2 | `fix(payments): audit remediation batch — BTCPay grant, Stripe IDOR, eWallet binding, round2 (Fixes 2,3,5,6)` | `handlers.mjs`, `services/btcpay.mjs`, `services/ewallet.mjs`, `btcpay.test.mjs`, `stripePortal.test.mjs`, `ewallet.test.mjs`, `spreadRoute.test.mjs`. |
| 3 | `fix(webapp): stop double-prefixing session-policy transport URL (Fix 4)` | `src/lib/api.ts`, `sessionPolicy.test.ts`. |
| 4 | `fix(infra): bind dashboard + n8n compose ports to loopback only (Fix 7)` | Both `docker-compose.yml`. |
| 5 | `fix(security): execFileSync argument arrays in browserBridge (Fix 8 / CWE-78)` | `services/browserBridge.mjs`, `browserBridge.execFile.test.mjs`. |
| 6 | `test(server): hermetic coverage for tradeJournal/notificationCenter/portfolioAnalytics/riskParity` | `tradeJournal.mjs` env override + 4 new test files. |
| 7 | `feat(webapp): a11y semantics, skeleton loading, chart fullscreen, paper-only order form` | 13 components + `ui.tsx`/`index.css` + `Skeleton.test.tsx`. |
| 8 | `chore: gitignore build/scratch artifacts, untrack tsbuildinfo` | `.gitignore`, index removal. |
| 9 | `docs: finalization report, audit-report closure status, changelog (wave 2026-09-04)` | `docs/FINALIZATION_REPORT.md`, `docs/AUDIT_REPORT.md`, `CHANGELOG.md`. |

---

## 4. Decisions made (with rationale) — this wave and standing

| # | Decision | Rationale / evidence |
| :-- | :-- | :-- |
| D1 | **Paper-only order form** — no demo/real broker execution UI, ever. | Server-side execution was already removed (roadmap §0, autopilot "execution removed — advisory-only"); NEXT_WAVE §2.1 ADR (redirect-not-execute) is the product rule; UI now cannot suggest an execution path (regression-locked by the suite's advisory-boundary tests). |
| D2 | **Never trust a client-supplied `customerId`** — resolve from the authed profile server-side (Fix 3). | OWASP API1/IDOR: any authed user could previously open any Stripe customer's portal. Locked by `stripePortal.test.mjs`. |
| D3 | **eWallet orders are owner-bound**; confirmations require the owner, or an explicit `selfApprove` flag that the handler only passes in single-owner (no-accounts) demo mode (Fix 6). | A "self-serve" receipt-confirm flow without owner binding is a payment-forge path. Locked by `ewallet.test.mjs`. |
| D4 | **BTCPay tier grant keys on invoice metadata round-trip** (`{userId, tier}` embedded at creation, read back at status) (Fix 2). | The service return shape now matches what the handler's grant branch checks — previously the grant was permanently unreachable. Locked by `btcpay.test.mjs`. |
| D5 | **`round2` defined once, exported, non-finite → null** (Fix 5). | Fixes a live `ReferenceError` on the spread route; guards like sibling helpers. Locked by `spreadRoute.test.mjs`. |
| D6 | **`execFileSync` argument arrays, no shell strings** in `browserBridge.mjs` (Fix 8). | 2026 CWE-78 guidance: never re-parse interpolated values in a shell. Source-locked by `browserBridge.execFile.test.mjs`. |
| D7 | **Secret purge in-tree + gitleaks CI gate; rotation & history-rewrite stay human** (Fix 1). | History rewrite on the pushed remote is destructive and requires explicit human approval; rotating the live EO session is a human login action. |
| D8 | **Loopback-only container publishes** (Fix 7), dashboard and n8n. | Single-owner self-hosted command centre; nothing should be reachable on the LAN. |
| D9 | **Fix 10 (extension lockfile) declined with reason.** | `apps/dashboard/extensions/picc-overlay/` is a zero-dependency, no-build MV3 extension — there is nothing to lock and `npm audit` would be vacuous. Revisit only if dependencies are ever added. |
| D10 | **Skeleton loading + `prefers-reduced-motion` + compact mobile tier + full ARIA semantics.** | Panels keep their shape while data is in flight; motion is honoured off for vestibular safety; command palette/notifications/tabs/HUD are keyboard- and screen-reader-accessible. |
| D11 | **File-backed stores gain env-overridable data dirs** (`PICC_JOURNAL_DATA_DIR`, `PICC_NOTIFICATION_DATA_DIR`); tests pin temp dirs before import. | Hermetic tests never touch real user data; consistent with the vault's per-directory key hermeticity pattern. |
| D12 | **Build & scratch artifacts never committed**: `*.tsbuildinfo`, `dev_pack_code.py`, `project_tree.txt`, `.freebuff/` gitignored; `tsconfig.tsbuildinfo` untracked. | Audit §7 explicit rule. |
| D13 | **Push approved by owner** for the whole backlog (25 commits + this wave) to `origin/master`. | The Q5 income spec's final gate (user launch + verify + "commit, push") and this session's explicit instruction. |

**Standing decisions already recorded elsewhere (unchanged, re-listed for completeness):** advisory-only & no behavioral camouflage (README legal posture); plasmo tree archived in-tree, `picc-overlay` canonical (F1); encrypted AES-256-GCM vault for all secret stores (F-02); embargoed walk-forward + significance floors + conformal bands (F-06/07/10); two live model brains tagged with `engine` (F-08); security headers + Origin allow-list (F-04/05); Q5 income generalization Tasks 1–13 shipped (registry snapshot, autodetect, wsFrames leg, income relay, overview endpoint/tab).

---

## 5. Ground truth (numbers & state after this wave)

| Check | Result |
| :-- | :-- |
| Tests | **1,525/1,525 pass, 143 files** (`apps/dashboard`, `vitest run --maxWorkers=3`) |
| TypeScript | `tsc -b --noEmit` exit 0 |
| Audit vulnerabilities | 0 (dashboard workspace, last audit 2026-09-02) |
| Git | local `master` fast-forwarded with this wave → **pushed to `origin/master`** |
| Secrets | no credential-shaped strings in tree/test fixtures; gitleaks gate live in CI |
| Scratch | `tsconfig.tsbuildinfo`, `dev_pack_code.py`, `project_tree.txt`, `.freebuff/` ignored/untracked |

---

## 6. Everything still to be done — the remaining-work register

Each item names its canonical tracker. Verified-open today; re-confirm before executing any of them.

### 6.1 Human-only actions (blocked on you)

- **R1a — Rotate the live ExpertOption session** whose token (`6dc12a98…`) was committed in history
  (probe scripts deleted from the tree today, but the token exists in pushed history). Log in fresh,
  revoke/replace the old session. Tracked: `docs/AUDIT_REPORT.md` Finding #1.
- **R1b — Decide on history rewrite.** Purge the token from `origin` history (BFG/`git filter-repo`)
  at the next natural point, or accept the residual risk given the token's blast radius is dev-only
  scripts (audit assessment). Needs an explicit human decision — rewriting shared history is
  destructive. Tracked: `docs/AUDIT_REPORT.md` §8.
- **R2 — Launch & verify the app** (the Q5 spec's standing final gate): confirm the income overview
  aggregates today/30d/lifetime/holdings honestly, that an extension-collected source lands a real
  Earnings snapshot, that there is no trading-candle regression, and that the extension stays
  read-only. Also confirm the new paper-only order form + chart fullscreen behave in the real UI.
  Tracked: `docs/specs/PICC_INCOME_GENERALIZATION_checklist_v1.md` items 115–116.
- **R3 — Approve the Q5 flag items** (Task 9 second site — `grass` wsFrames connector; Task 10 data
  migration) as done-by-approval if your live check passes. Tracked: same checklist.

### 6.2 Engineering backlog (agent-executable, ordered)

- **R4 — Audit agent-reported findings (§5.2–5.8 of `docs/AUDIT_REPORT.md`) — ✅ DONE 2026-09-04.**
  All seven were re-verified line-by-line, fixed, and regression-locked (look-ahead entry/exit →
  signal-time candle; localstore serialized chain + atomic writes; liveCCXT last-message staleness
  gate; liveEO throttle-map cap/eviction; modelMatrix breakout neutral band; modelMacd O(n) EMA;
  correlation dead `portVar` removed). Each closed in `AUDIT_REPORT.md` §5 with code + test refs.
- **R5 — NEXT_WAVE generalization slices — ✅ DONE 2026-09-04.** Slices 1/2/3 verified already
  landed in the T/Q5 waves; Slice 5d coverage completed for all 10 named services (hermetic, no
  network); Slice 7f (Binance/Bybit extension selectors) remains **open as a small stretch** — no
  second-site decision has been made (user-gated, per Q5 Task 14 flag).
- **R6 — Strategy-program wave — ✅ DONE 2026-09-04.** `annualizedVolatility` estimator chooser
  (GK/YZ/std) wired into the autopilot sizing consumer; `CorrelationScreen` in the suite consuming
  `/api/trading/correlation` (portfolio card + pre-trade risk check already live).
- **R7 — Finance Tracker — ✅ DONE 2026-09-04** (`docs/PICC_FULL_SCOPE.md` Part 2a checklist
  ticked): `finance.ts` rewrite + Accounts/Transactions CRUD (Profile → Finance tracker) +
  computed net worth (assets − liabilities, fixed-rate FX labelled approximate) + auto-synced
  paper-trading account; Dashboard hero fallback removed. Part 2b (Firefly III sync) remains a
  later phase; Part 3 (Wave-1 executor) stays dead-lettered per NEXT_WAVE §2.1.
- **R8 — Q5 follow-ups — ✅ DONE 2026-09-04.** Re-read the income spec set: Tasks 14–15 are
  user gates (unchanged); the one open agent item, REQ-C's holdings write side, landed as
  `HoldingsEditor` (add/delete for `nft_holdings`/`depin_nodes` on the Income Overview tab).
- **R9 — Periodic re-verification** (cheap, do alongside any future work): full suite green, `tsc`
  clean, gitleaks gate passing, ledger-vs-spec-vs-code truth (code wins; fix the doc, per ledger
  rules of the road).

### 6.3 Explicitly declined / out of scope (do not re-open without a product decision)

- Order execution of any venue (demo or real) — **superseded by the redirect-not-execute ADR**
  (`NEXT_WAVE_generalization.md` §2.1, roadmap §0). The TradeOrderForm change (D1) removes the last
  UI suggestion of it.
- Behavioral camouflage / ToS-violating automation; withdrawals/transfers anywhere.
- ARIMA/Prophet/LSTM/GARCH model names (repo rule, spec §7 appendix).
- Fix 10 extension lockfile (D9) until the extension gains dependencies.

---

## 7. Multi-phased blueprint (what happens next, by phase)

The phases below are the working plan agreed with the project owner across the 2026-08→09 session
arc, reconciled to today's tree. Each phase is independently shippable and gated on the previous
one's acceptance where noted.

### Phase 0 — Hardening close-out *(COMPLETE — this wave, 2026-09-04)*
Audit Fixes 1–8 + secret purge + gitleaks CI gate; UI/a11y pass; hermetic coverage additions;
ledger/spec/PRIVACY/SETUP truth-sync; scratch-hygiene; full suite + typecheck green; pushed.
**Acceptance:** §2 ledger + §3 commit log above; suite 1,525 green; origin/master updated.

### Phase 1 — Owner verification & human gates *(NEXT — you; unchanged)*
Launch the app and verify (R2), approve Q5 flag items (R3), rotate the EO session (R1a), decide on
history rewrite (R1b).
**Acceptance:** your sign-off on the Q5 checklist items 115–116 and this report's §6.1.

### Phase 2 — Close the audit's evidence gaps *(✅ EXECUTED 2026-09-04 — uncommitted edits for review)*
R4 findings (§6.2) — all seven re-verified, fixed, regression-locked, and closed in `AUDIT_REPORT.md` §5.
**Acceptance met:** each item CLOSED with a code/test reference; suite green throughout (1,620).

### Phase 3 — NEXT_WAVE generalization slices *(✅ EXECUTED 2026-09-04)*
Slices 1/2/3 verified landed; Slice 5d coverage complete for all 10 named services; R6 GK/YZ wiring
+ correlation screen landed. **Remaining:** Slice 7f (Binance/Bybit extension selectors) — small
stretch, user-gated on a second-site decision.

### Phase 4 — Finance Tracker *(✅ EXECUTED 2026-09-04)*
R7 complete: `finance.ts` rewrite + Accounts/Transactions CRUD + computed net worth + auto-synced
paper-trading account; Dashboard hero fallback removed; Part-2a checklist ticked.
**Remaining:** Firefly III sync (2b) only after the MVP has been used; **demo to owner pending**
(Phase 1 launch-verify).

### Phase 5 — Income & strategy deepening *(✅ EXECUTED 2026-09-04 — agent half; owner review pending)*
R8 complete (REQ-C holdings write side); F-11 estimator consumers wired into live risk tooling.
**Remaining:** Slice 7f second-site selectors and any new income connectors stay behind the Q5
user gates (Task 14); `TRADING_MULTIPLATFORM_ROADMAP.md` §6 only under the redirect-not-execute
boundary (unchanged).

### Standing gates for every phase
- A fix lands in its own commit referencing its finding id (audit spec REQ-4); no doc-only closure
  for testable behavior (REQ-2).
- `security-review` skill applied to any diff touching auth/payment/vault/broker paths.
- Full suite green + `tsc -b --noEmit` clean before any commit lands; ledger/spec/code stay
  truth-synced (code wins).

---
*End of report. Ground-truth numbers are from 2026-09-04 runs on the committed tree; anything cited
from an earlier audit is dated inline and was re-verified where stated.*
