# Changelog

## 2026-09-05 — Command Centre Web slice 1: policy-graph catalog + validator + roster registry

Per `docs/specs/COMMAND_CENTRE_WEB_SPEC.md` (living methodology: completion gate = verified in the
spec doc, which is ticked for this slice).

- **L2 catalog** — `server/services/commandCentre/policyGraphCatalog.mjs`: **"site = template"**
  with the 5C truth table as three shipped templates — `trading:ccxt` (sanctioned, $10 / 2
  concurrent / −5% envelope) · `bandwidth:browser` (gray, claims-only — honest null capital
  fields) · `expertoption` (forbidden + demoOnly, the unregulated-venue row).
- **L3 roster** — `commandCentre/agentRoster.mjs`: 13 agents, one task each (P-SPECIFICITY), each
  grounded in existing service modules (P-GROUNDING); `whale_onchain` is a declared-but-planned
  seam, surfaced as planned, never silently ready.
- **Validator** — `commandCentre/policyGraphValidator.mjs`: rejects purposeless/dangling/untyped
  edges (P-PURPOSE), duplicate ids + duplicate tasks (P-SPECIFICITY), unbounded/nonsense loops
  (P-BOUNDED-LOOPS), permission-vs-mode violations (5C: forbidden ⇒ demo|blocked, gray ⇒
  copilot|demo|blocked), insane envelope bounds (5D). Collects **all** violations in one pass.
- **Tests** — 31 hermetic cases in `server/__tests__/commandCentre.test.mjs` incl. a shipped-
  catalog-is-clean guard and module-existence checks against `server/services/`.
- Verification: full suite **1,653/1,653 green** (162 files, was 1,622); `npx tsc -b --noEmit` 0.
- Tracked in spec §slice-1 (Landed 2026-09-05). Next: slice 2 — mode engine + safety sidecar.

## 2026-09-05 — Doc consolidation → two-doc end-state; Command Centre Web begins

### Docs (repo end-state)
- `README.md` + `PICC.md` (new, exhaustive, living) are now the project's **only** docs. The legacy
  `docs/` corpus (24 files: architecture, audit reports, roadmaps, research, setup, runbook,
  known-issues, full-scope, prompt-patterns) was absorbed into `PICC.md` and **retired** —
  `docs/specs/` (16 spec files) stays as of record, `PRIVACY.md` stays until legal review.
- Code/agent references repointed at `PICC.md` (§18 setup, §16 roadmaps, §21 patterns): `amazon.mjs`
  header comment, `scripts/start-all.mjs` CrewAI probe line, `.opencode/agents/picc-planner.md`.
- Historical changelog entries referencing absorbed docs are left as written (history of record).

### Fix
- `localstore.mjs`: Windows EPERM on `rename(tmp, file)` while the destination is open
  (test pollers, listRows, antivirus) was silently dropping the latest snapshot + leaving `.tmp`
  residue — POSIX-only green masked it. Bounded EPERM/EACCES rename retry → direct-write fallback,
  tmp cleaned either way; `store.write()` returns the op-chain so durability can be awaited.
  Regression tests: EPERM-retry + permanent-lock fallback. Commit `0d88992`.

### Verification
- Full suite: **1,622/1,622 tests green** (161 files); `npx tsc -b --noEmit` exit 0.

### Next
- **Command Centre Web** (spec `docs/specs/COMMAND_CENTRE_WEB_SPEC.md`, ready-for-agent): slice 1
  landed (see the slice-1 entry above); slice 2 onwards per the spec's living methodology.

## 2026-09-04 - Strategy-program & finance wave (Phases 2–5)

### Phase 2 — Audit defect fixes (R4; AUDIT_REPORT §5.2–5.8, all re-verified then fixed)
- `accuracyLedger.mjs`: entry/exit fallback now uses the **signal-time candle** (no look-ahead). Regression tests in `accuracyLedger.test.mjs`.
- `localstore.mjs`: serialized load-then-write op chain + atomic tmp+rename persist (a write can never land before the initial load; a crash never leaves truncated JSON). New `localstore.test.mjs`.
- `liveCCXT.mjs`: feed liveness gated by last-message age (`CCXT_STALENESS_MS`) — a silent feed reports `stale`, never fake "connected". New `liveCCXT.staleness.test.mjs`.
- `liveEO.mjs`: `lastLiveFetch` throttle map is size-capped (`EO_FETCH_THROTTLE_MAX`, evicts oldest) — no unbounded growth. New `liveEO.fetchThrottle.test.mjs`.
- `modelMatrix.mjs`: breakout adds a neutral band (no signal until |Δ| clears the band) — zero-signal assets no longer vote direction; `modelMacd` EMA recompute is O(n) not O(n²). Extended `modelMatrix.test.mjs`.
- `correlation.mjs`: removed dead `portVar`. New `correlation.test.mjs`.

### Phase 3 — NEXT_WAVE coverage + R6 live wiring
- Coverage for 9 previously-untested services: `orderFlow`, `dataSources`, `tradingSessions`, `watchlist`, `positionManager`, `indicators`, `volatility`, `scheduler` (all hermetic, no network) + `liveCCXT`/`liveEO` above; `indicators.mjs` flat-RSI returns 50 not 100; `positionManager.mjs` venue-concentration warning no longer false-positives on a first-ever trade.
- R6: `annualizedVolatility` estimator chooser (Garman-Klass / Yang-Zhang / std) exported from `volatility.mjs` and wired into the autopilot sizing consumer; **CorrelationScreen** added to the trading suite (top pairs by |corr|, diversification score, honest "—" states; consumes `/api/trading/correlation`).

### Phase 4 — Finance Tracker (R7; PICC_FULL_SCOPE Part 2a — the biggest product gap)
- `src/lib/finance.ts` rewritten: localStorage read-only stub → real CRUD over `/api/data/financial_accounts` + `/api/data/transactions` (per-user rows preserved server-side).
- New `FinanceTracker` on Profile: accounts CRUD (name/type/currency/starting balance), per-account transactions CRUD (category/tags/date), running balance = starting + sum(transactions).
- Net worth is **computed** (assets − liabilities, per-currency + fixed-rate USD conversion, labelled approximate FX) — the dead manual-snapshot concept is gone.
- Trading suite wired in as one auto-synced account (`synced` paper-trading account tracking the paper engine's live cash); Dashboard hero's temporary paper-balance fallback **removed** — hero shows the computed net worth.

### Phase 5 — Income follow-ups (R8 / REQ-C)
- New `HoldingsEditor` on the Income → Overview tab: server-backed add/delete for `nft_holdings` + `depin_nodes` (the missing write side of REQ-C's holdings view; view already existed).

### Verification
- Full suite: **1,620/1,620 tests green**; `npx tsc -b --noEmit` exit 0.
- Ledger/spec truth-sync: F-11 + F8 rows closed with wiring; NEXT_WAVE 5d ticked; PICC_FULL_SCOPE Part-2a checklist ticked.
- Human gates still open (unchanged): rotate the leaked EO session, decide on history rewrite, launch-verify the app, approve Q5 flag items.

---

## 2026-09-04 - Finalization wave (audit remediation + UX/a11y + push)

### Security & secrets (audit Fix 1)
- Deleted six `scripts/probe-eo-*.mjs` files that hard-coded a committed ExpertOption session token (`6dc12a98…`).
- Added `.gitleaks.toml` (false-positive allowlist + pinned deny rules) and an independent `secrets-scan` gitleaks job in CI that runs before the build matrix.
- Neutralised the remaining credential-shaped fixture token in `browserStudio.login.test.mjs`.
- Human steps remain: rotate the live EO session and decide on a history rewrite (see `docs/FINALIZATION_REPORT.md` §6.1).

### Payments & authorization (audit Fixes 2, 3, 5, 6)
- BTCPay: `createBtcpayInvoice` embeds `{userId, tier}` in invoice metadata and the status read-back restores them — the tier grant branch in `handlers.mjs` is now reachable (was permanently unreachable). New `btcpay.test.mjs`.
- Stripe portal: client-supplied `customerId` is ignored; the route resolves the authenticated user's own customer server-side (IDOR closure). New `stripePortal.test.mjs`.
- eWallet: orders are owner-bound (`userId` required); confirmation is owner-scoped with an explicit `selfApprove` flag used only in single-owner demo mode. Extended `ewallet.test.mjs`.
- `round2` defined + exported in `handlers.mjs` (was a runtime `ReferenceError` on the spread route). New `spreadRoute.test.mjs`.

### Web app & correctness (audit Fix 4)
- `session-policy` transport no longer double-prefixes `/api` (404 fix). New `sessionPolicy.test.ts`.

### Infrastructure (audit Fix 7)
- Dashboard and n8n docker-compose ports bound to `127.0.0.1` only.

### Process invocation (audit Fix 8 / CWE-78)
- `browserBridge.mjs` converted every `execSync("shell string…")` to `execFileSync(cmd, [args])`. New `browserBridge.execFile.test.mjs` source-lock.

### UX & accessibility
- Skeleton loading placeholders (new `Skeleton` in `ui.tsx` + shimmer CSS) across Account Metrics, Data Sources, Portfolio Aggregate, Session panels.
- ARIA/combobox/listbox/dialog semantics in CommandPalette, NotificationCenter (real buttons), DockablePreview tabs (keyboard-activable), TopBar/TradingHud toggles.
- Chart fullscreen toggle (Esc-aware); `prefers-reduced-motion` global kill-switch; compact mobile tier CSS.
- TradeOrderForm is paper-only (Demo-EO path removed, "simulated · advisory-only" badge) — UI half of the advisory-only posture.

### Tests & hermeticity
- `tradeJournal.mjs` honors `PICC_JOURNAL_DATA_DIR`; new hermetic tests for tradeJournal, notificationCenter, portfolioAnalytics, riskParity.
- Full suite: **1,525/1,525 tests (143 files)**; `tsc -b --noEmit` clean.

### Docs & hygiene
- `docs/FINALIZATION_REPORT.md`: complete change ledger, decisions, remaining-work register, multi-phased blueprint.
- `docs/AUDIT_REPORT.md`: §8 remediation status closed out (Fixes 1-8 addressed; Fix 10 declined with reason).
- `docs/EXPLICIT_AUDIT_LEDGER.md`/PRIVACY/SETUP truth-sync from the earlier 2026-09-04 doc batch stands.
- Gitignore: `*.tsbuildinfo`, `.freebuff/`, `dev_pack_code.py`, `project_tree.txt`; `tsconfig.tsbuildinfo` untracked.
- `master` pushed to `origin` (Q5 series + F-series + closures + this wave).

## 2026-08-23 - Hardening session (Phases 0-6)

### Phase 0 — Dependency + env ground truth
- Fixed nanoid high-severity `npm audit` vulnerability.
- Updated `.env.example`: added 15 undocumented env vars (PORT, LOG_LEVEL, PICC_BROWSER_PATH, PICC_BROWSER_PERF, PICC_HUMANIZE, data-dir overrides), removed 2 dead vars (`VITE_STRIPE_PRICE_PRO/BUSINESS` → server-side `STRIPE_PRICE_PRO/BUSINESS`).

### Phase 1 — Canonical extension
- `apps/dashboard/extensions/picc-overlay/` is the canonical extension; `apps/extension/` (Plasmo) marked deprecated with no trading features.
- Removed stale root scripts (`build:extension`, `build:all`, `typecheck:all`) that targeted the abandoned Plasmo skeleton.
- README/SETUP/ARCHITECTURE updated to the zero-build MV3 "load unpacked" flow.

### Phase 2 — ExpertOption session reliability
- Session expiry detection and staleness checks for captured EO tokens.
- Honesty labels: unconfigured/stale EO state is surfaced instead of pretending to be live data.
- Token capture via the in-app browser (`POST /api/browser/capture-session`, `scripts/capture-eo-session.mjs`) — no EO env vars.

### Phase 3 — Decision-engine correctness
- 54 validation tests for the decision engine (`decisionEngine.test.mjs`).

### Phase 4 — Autopilot E2E
- 20 end-to-end validation tests for demo autopilot (`autopilotE2E.test.mjs`): arm → deal open → settle → ledger/analytics flow.
- Fixed an `isNumber` bug uncovered by the E2E suite.

### Phase 5 — Multi-platform generalization
- Extension overlay generalizes beyond a single broker site (site-specific config, all-site content-script matches).
- Added `translateSymbol` for per-platform symbol normalization (Binance/Coinbase/Yahoo formats).
- 19 multi-platform validation tests (`multiPlatform.test.mjs`).

### Phase 6 — Documentation sync
- README.md: Trading Suite feature description updated to the real 8-model ensemble; Plasmo roadmap row marked deprecated; test count updated to 623+.
- docs/SETUP.md: prerequisites corrected to Node.js 22+; Stripe price IDs documented under their real names (`STRIPE_PRICE_*`, server-only); test command fixed to the workspace script; ExpertOption setup rewritten around in-app-browser token capture; verify-e2e LLM wording aligned with the hybrid provider rotation.
- docs/ARCHITECTURE.md: extension sections rewritten for the MV3 picc-overlay live trading-data path; stale `/api/trading/account` + EO env-var claims replaced with the real credentials-store flow via `/api/trading/status` and `/api/trading/pro/expertoption`; prediction-engine description updated to the 8-model walk-forward-backtested ensemble; LLM fallback wording aligned with the hybrid rotation.
