# Changelog

## 2026-09-05 — Command Centre Web slice 5: first live execution leg (bandwidth payout claims)

Per `docs/specs/COMMAND_CENTRE_WEB_SPEC.md` (living methodology: completion gate = verified in the
spec doc, which is ticked for this slice). Bandwidth:browser is `gray` in the approved 5C truth
table → COPILOT / power `proposals` → the human-approved claims path (AUTOPILOT stays CCXT slice 6).

- **L1 execution seam** — `commandCentre/commandCentreExecution.mjs`: proposal builder (power
  `proposals`, fresh `consentBy` = acting human's uid, auto-rendered rationale 5F from observed
  payout data, durable idempotency key 5G `bandwidth:claim:<platform>:<payoutRef>` where the ref
  is the payout_ready row's day — scheduler rows carry no txn ref, the day IS the identity);
  `executeProposal` runs the FULL 10-gate `evaluateGate` chain and only a pass reaches the
  injected `executor` (venue-touching step: interventions workflow runner in production, fixture
  stub in CI). Every outcome audited (5A): `safety-gate:allow` / `safety-gate:deny` /
  `execution:executed` / `execution:failed`. A deny NEVER calls the executor; an executor throw is
  caught and audited failed — never a partial-success claim. Per-site in-flight counts feed the
  envelope cell (5D).
- **Sidecar power-aware gating** — `safetySidecar.mjs`: proposals now carry `power`
  (`none|proposals|liveDemo|live`) + `consentBy`. Gate 4: live/liveDemo need a STANDING opt-in,
  `proposals` only FRESH non-blank `consentBy` (denied at per-site-opt-in with the consent-≠-
  opt-in reason); legacy no-`power` proposals keep the exact old isLive+optIn semantics. Gate 7:
  forbidden → liveDemo/proposals on demoOnly templates only; gray → proposals only; sanctioned →
  live/proposals (liveDemo denied); power `none` denied outright. Allow audit events record
  power+consentBy.
- **API** — `GET /api/command-centre/claims` (lists scheduler `payout_ready` rows joined with an
  honest claimed/ready status from the durable audit trail — the same 5G chain) and
  `POST /api/command-centre/execute` (validates platform/balance/threshold/claimWorkflowId →
  400; builds OBSERVED gate state — killSwitch from the runtime store, breakers from cross-site
  halts, `staleFeeds` from the presence heartbeat with a 10-min cadence (no observed browser
  node = cannot prove fresh = deny, 5E), `concurrentUnits` from the execution seam, `dayLossPct`
  0 (claims surface has no market-loss axis) — then `claimPayout` with executor =
  `interventions.runWorkflow({ workflowId, tabId, approval: "manual" })`, which throws an honest
  BROWSER_CLOSED when the browser is closed → audited `execution:failed`). Overview composition
  now takes OBSERVED `feeds` + `execution` inputs: bandwidth fresh-data/envelope/rationale cells
  flip from not-wired to observed, the row gains `executionLeg`, and the opt-in note grows the
  consent-≠-opt-in sentence.
- **Panel** — `CommandCentrePanel.tsx` bandwidth stream gains the payout-claims block: scheduler
  payout_ready rows with claimed/ready badges, a claim-workflow-id input, and an "Approve &
  claim" button whose click is FRESH per-action human consent POSTed to `/api/command-centre/
  execute`; the honest outcome (executed / failed / blocked) renders back on the card.
- **Tests** — 13 new sidecar power tests (46 total), 14 execution seam tests, 8 new overview/
  claims/execute API tests (17 total), 3 execute-route happy-path tests with a fixture executor
  (`vi.mock` on `interventions.runWorkflow`), 2 new panel tests (6 total). Suite 1,770 → 1,810
  across 173 files; typecheck clean.
- Tracked in spec §slice-5 (Landed 2026-09-05); `PICC.md` §3.2/§3.3/§11/§11.1 L6/§11.3 wording
  updated, §4 count 104 → 105 (1 new service module). The happy path against a REAL browser
  (manual live verify) remains an owner-run step; CI proves the honest BROWSER_CLOSED failure and
  the full gate chain instead. Next: slice 6 — CCXT live execution.

## 2026-09-05 — Command Centre Web slice 4: Command Centre surface (runtime kill switch, overview API, panel)

Per `docs/specs/COMMAND_CENTRE_WEB_SPEC.md` (living methodology: completion gate = verified in the
spec doc, which is ticked for this slice).

- **Runtime kill-switch store** — `commandCentre/commandCentreRuntime.mjs`: global + per-site
  switches, persisted under `PICC_COMMAND_CENTRE_DATA_DIR` as `command-centre-runtime.json`;
  every transition (set/clear/global-raise) is audited (5A) with site/kind/data shape; an
  explicit human clear is RECORDED as an off switch (never forgotten); an unreadable store file
  boots conservatively with the GLOBAL KILL ON — fail-safe deny; `siteKilled` consults the reader
  chain first (state argument OR wired reader), global dominates.
- **Pure overview composition** — `commandCentre/commandCentreOverview.mjs`: every cell is
  OBSERVED state or an explicit "not-wired — arrives with execution (slice 5+)" label — never a
  silent OK. Verdicts come from the REAL engine `renderVerdict` over observed inputs: kill switch
  from the runtime store, breakers from the sidecar's recorded cross-site halt (breaker names
  mapped: dailyLoss → dailyLossHalted, regime/regimeHalted → regimeHalted), fresh-data from
  capture-profile rows + computed account-metrics staleness, workability conservatively 0 (no
  scorer wired — caps at COPILOT; never an invented number that could raise a verdict),
  deliberation null (engine reports "not-yet-available"), optIn false with a not-decided label —
  sync-approval is explicitly NOT an opt-in. The 10-gate rail renders in GATE_ORDER with the
  pass/block/restricted/mechanism-on/not-wired/not-decided vocabulary.
- **Sidecar reader seam** — `wireKillSwitchReader(readFn)`: gate 1 = state argument OR reader; a
  throwing reader reads as KILL (cannot prove OFF, so deny); unwiring (null) restores state-only.
- **API** — `GET /api/command-centre/overview` (per-site rows from observed state + optional
  `?stream=` filter, authenticated) and `POST /api/command-centre/kill-switch` (scope sanitized
  against catalog ids + "global", kill must be boolean, else 400; echoes the resulting state).
  Handlers wire `wireKillSwitchReader(() => anyKillActive())` + `wireAuditReader(() => readAudit())`
  at import — the panel toggle and the enforcement gate read ONE switch, and 5G durability
  survives restarts.
- **Panel** — `src/components/CommandCentrePanel.tsx`: ONE shared component, `stream` prop,
  mounted as a "Command Centre" tab on BOTH trading and bandwidth suite details. Per-site command
  cards + global kill header + full rail; not-wired rendered as not-wired, never as OK.
- **Tests** — 9 runtime store tests, 9 overview+kill-switch API tests, 4 sidecar reader tests,
  4 TSX panel tests (stubbed fetch). Suite 1,744 → 1,770; typecheck clean.
- Tracked in spec §slice-4 (Landed 2026-09-05); `PICC.md` §3.2/§3.3/§11.1 L6/§11.3 wording
  updated, §4 count 102 → 104 (2 new service modules). First-live executive wiring (break-by-
  pattern detectors, capture rows for ccxt/bandwidth, deliberation feed) is deferred to slice 5
  by design — the surface labels those honestly. Next: slice 5 — execution (slice 4's not-wired
  cells arrive with it).

## 2026-09-05 — Command Centre Web slice 3: deliberation layer + metalearning tuners

Per `docs/specs/COMMAND_CENTRE_WEB_SPEC.md` (living methodology: completion gate = verified in the
spec doc, which is ticked for this slice).

- **L4 blackboard** — `commandCentre/deliberation.mjs`: `deliberate({graph, decisionNode, findings,
  maxRounds, convergenceDelta, edgeTrust})`. Hop distance = BFS from the decision node over
  reversed edges, so findings land one round per hop traveled; the surface is a weighted
  directional average (neutral sides excluded from both numerator and denominator); convergence is
  round-over-round movement < `convergenceDelta` (early-stop), while exhausting `maxRounds` with
  movement still ≥ delta reports honest `non-converged` (divergence cutoff — never a fabricated
  consensus). Unlanded findings (no edge path into the decision node) are surfaced with a reason,
  never dropped. Edge trust multiplies into path trust via the injected `edgeTrust(edgeId)` seam
  (catalog `trust` × metalearning), and `strongestPath` is the max product over simple paths.
  Exports `DEFAULT_MAX_ROUNDS` / `DEFAULT_CONVERGENCE_DELTA` from the catalog `DEFAULT_LOOP`
  (3 / 0.05) and `MAX_WORKABILITY_SHIFT` (0.1).
- **P-METALEARNING tuner** — `commandCentre/metalearning.mjs`: outcome-gated edge trust.
  `applyOutcome` requires `settled` (an unsettled outcome mutates nothing and is rejected),
  applies hit ×1.05 / miss ×0.95 / push ×1.0, clamps to [0.2, 3.0], rounds to 4 decimals, and
  returns the 5A-style before/after audit event; `revertLastOutcome` undoes the last applied
  outcome; `setTrust` is discovery-time tuning only (also clamped, separately audited, never
  reverted by an outcome revert). The **export whitelist is the floor-proof**: the module exposes
  calibration knobs and nothing else — no envelope, breaker, or audit toggle is reachable (enforced
  by test).
- **L5 wiring** — `modeEngine.mjs` slots 6/7: a real deliberation object is optional (absent →
  "not-yet-available" reason); a `non-converged` board caps the mode at COPILOT and **excludes the
  advisory/LLM leg entirely** (deterministic-only verdict, reason surfaced); a converged board
  modulates workability by the bounded ±0.1 `MAX_WORKABILITY_SHIFT` **downwards only** — it can
  lower a mode, never raise one above the gates; deliberation breadcrumbs merge with wired
  breadcrumbs, deduped by agentId.
- **Tests** — 32 hermetic cases across `server/__tests__/commandCentre.{deliberation,
  modeEngine.slice3,metalearning}.test.mjs`: hop-2 timing proven with a late opposing voice moving
  the surface (same-sign contributions cannot move a weighted average), divergence cutoff via the
  bandwidth 2-round board, DEFAULT_LOOP vs per-node overrides, unlanded surfaced, P-GROUNDING
  source/cutoff passthrough, trust seam scaling (0.5 × 0.5 = 0.25), strongest-path on an N:N web,
  clamp/compounding/revert/setTrust semantics, export whitelist, and the full mode-engine matrix
  (absent marker, converged keeps AUTOPILOT, non-converged caps + excludes advisory, downgrade
  advisory stays COPILOT, breadcrumb merge/dedupe/empty).
- Verification: full suite **1,744/1,744 green** (168 files, was 1,712); `npx tsc -b --noEmit` 0.
- Tracked in spec §slice-3 (Landed 2026-09-05); `PICC.md` §4 count 99 → 102, §11 status slice 1–3,
  §11.1 L4 + P-METALEARNING wording updated. Next: slice 4 — Command Centre surface (per-stream
  command card, safety rail, mode verdict, kill-switch UI).

## 2026-09-05 — Command Centre Web slice 2: mode engine + safety sidecar + audit trail

Per `docs/specs/COMMAND_CENTRE_WEB_SPEC.md` (living methodology: completion gate = verified in the
spec doc, which is ticked for this slice).

- **L5 mode engine** — `commandCentre/modeEngine.mjs`: exactly five modes `BLOCKED | HOLD |
  COPILOT | AUTOPILOT_DEMO | AUTOPILOT` with their honest `executionPower` (`none/none/proposals/
  liveDemo/live`); verdict = a fixed 7-step decision order (kill switch → opt-in → named breakers
  → 5E staleness (forced HOLD) → 5C truth table → workability floor 0.5 → deliberation, declared
  "not-yet-available" until slice 3 → advisory). **5H is downgrade-only:** the advisory input can
  lower the mode but can never raise it — upgrade attempts are audited and rejected, and an
  advisory outage leaves the deterministic verdict bit-for-bit identical (proven by test).
- **5A audit trail** — `commandCentre/auditTrail.mjs`: append-only, hash-chained (sha-256 over
  recursively-key-sorted canonical JSON) JSONL under `PICC_COMMAND_CENTRE_DATA_DIR`; no update/
  delete API; `verifyAudit()` walks the chain and names the first broken entry. The canonical
  serializer deliberately avoids an array-replacer `JSON.stringify` — that silently drops every
  nested `data` key (tamper-blind chain), which the tamper test caught and fixed. Memory-backed
  (no disk) under vitest without the env var; boots from disk otherwise.
- **L0 safety sidecar** — `commandCentre/safetySidecar.mjs`: the pre-action gate order is enforced
  as a 10-step contract (kill-switch → cross-site-day-halt → human-takeover 5B → per-site-opt-in →
  hard-breakers → fresh-data 5E → toS-survival 5C → envelope-within-ceiling 5D →
  rationale-renderable 5F → idempotent 5G). A breaker trip on ANY site halts every site for the
  UTC day (`dayKeyOf`), day-scoped so the next day re-opens. 5G idempotency is checked in-memory
  AND durable through the audit trail when a reader is wired — reader throws → conservative deny.
  Every decision, allow and deny, is audited (5A); loosening the envelope never mutes the recorded
  why.
- **Tests** — 59 hermetic cases across `server/__tests__/commandCentre.{modeEngine,sidecar,
  auditTrail}.test.mjs`: verdict matrix (gate × mode, gray/forbidden truth tables, demo surfaces),
  5H proofs, gate-order contract, double-claim race, cross-site trip + rollover, tamper-evidence,
  disk persistence via a tmp `PICC_COMMAND_CENTRE_DATA_DIR`.
- Verification: full suite **1,712/1,712 green** (165 files, was 1,653); `npx tsc -b --noEmit` 0.
- Tracked in spec §slice-2 (Landed 2026-09-05); `PICC.md` §4 count 96 → 99 and §11.1 stale mode
  vocabulary (`autopilot|copilot|assist|off`) replaced with the five spec modes + 5H downgrade-only.
  Next: slice 3 — deliberation layer.

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
