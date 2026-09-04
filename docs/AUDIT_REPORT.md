# PICC — Comprehensive Project Audit Report

**Audit date:** 2026-09-02
**Auditor:** PICC executor (big-pickle), with parallel subsystem exploration by explore agents
**Method:** Repository-wide structural mapping + independent manual verification of all load-bearing findings + full test/typecheck/dependency runs + external web research (2026 sources) for stack benchmarking and security asks.
**Scope:** 100% of the tracked codebase — 486 tracked files across `apps/dashboard` (347), server (205, incl. 91 services), extension (14), scripts (32), infra, docs, CI.

> **Honesty contract.** This report distinguishes clearly between findings the auditor **confirmed with their own commands/eyes** and findings reported by subsystem agents but **not independently reverified** (flagged `✓ verified` vs `[agent-reported]`). Severity reflects *realistic reachability* from the running system, not just the presence of the pattern.

---

## 1. Executive summary

PICC is a well-structured, unusually well-tested personal income-command-center: a single-owner "Emulation & Overlay" tool that **never executes on external platforms** (documented design intent, upheld in practice). The server is zero-framework Node ESM with a large, annotation-rich handler layer; the frontend is React + TS + Vite + Supabase; a canonical MV3 browser extension relays broker WebSocket frames back to the server bus; and a dedicated risk-currency descriptor is maintained in `docs/ARCHITECTURE.md`.

**Overall health: strong.** 1,391 tests pass (127 files) and TypeScript is clean. No frontend injection primitives (`dangerouslySetInnerHTML`/`eval` = zero matches). The two genuinely high-impact defects below are **correctness bugs in recently-added payment/session code**, not architectural rot.

### Priority remediation list

| # | Severity | Finding | Where | Kind |
|---|----------|---------|-------|------|
| 1 | **HIGH** | Committed ExpertOption session token (`6dc12a9…`) in 6 `scripts/` files | `scripts/probe-*.mjs` (all in git HEAD) | Secrets hygiene |
| 2 | **HIGH** | BTCPay subscription is *never* granted — handler checks keys the service never returns | `handlers.mjs:3646-3648` ↔ `btcpay.mjs:58` | Functional bug |
| 3 | **HIGH** | Stripe customer-portal IDOR — client-supplied `customerId` not checked against authed user | `handlers.mjs:3514-3527` | AuthZ / IDOR |
| 4 | **HIGH** | Frontend double-prefix → `/api/api/trading/session-policy`; **reachable** | `src/lib/api.ts:269,277` + `IncomeStreams.tsx` | Correctness |
| 5 | **MED** | Runtime `ReferenceError`: `round2` used but never defined | `handlers.mjs:2684` | Correctness |
| 6 | **MED** | EWallet self-serve approval has no real-money verification and no `userId` binding at order creation | `ewallet.mjs:72-116` | Payment forge path |
| 7 | **LOW/MED** | Docker publishes port on all interfaces (no loopback bind) | `infra/dashboard/docker-compose.yml:17` | Exposure |
| 8 | **LOW** | `execSync` string-interpolation shell-outs in browser bridge (not remotely reachable today; refactor to `execFile`) | `browserBridge.mjs:50,134,153,161` | Robustness |
| 9 | **LOW** | EO/venue session tokens stored in plaintext on disk (gitignored, single-user, by-design location) | `server/data/` | Hardening |
| 10 | **LOW** | Extension has no lockfile → non-reproducible deps | `apps/dashboard/extensions/picc-overlay/` | Supply-chain |

**Billed as done but actually NO-OP / unverified** (honest gaps): findings 3, 4, 5 are the ones that affect claimed "shipped" features — the T-series work shipped cleanly, but these are pre-existing or integration-level defects surfaced by the audit.

---

## 2. Repository map (100% coverage)

### 2.1 Top-level structure
```
.
├─ apps/
│  └─ dashboard/            # The product: web app + server + extension (347 tracked files)
│     ├─ src/               # React + TS + Vite frontend (10 pages, 53 components)
│     ├─ server/            # Node ESM zero-framework backend (205 tracked files, 91 services)
│     ├─ extensions/picc-overlay/  # Canonical MV3 extension (14 tracked files)
│     └─ (legacy apps/extension skeleton — deprecated Plasmo)
├─ agents/picc_agents/      # Optional CrewAI microservice (FastAPI :8000) — decision-support only
├─ infra/
│  ├─ dashboard/            # docker-compose for the dashboard
│  ├─ supabase/             # SQL schema (v2/v3), RLS
│  └─ n8n/                  # optional aggregator workflow
├─ scripts/                 # 32 dev/diagnostic mjs scripts (probe-*, capture-*, tune-*, etc.)
├─ docs/                    # SPECS, ARCHITECTURE, SETUP, ROADMAPS, ADRs
└─ .github/workflows/       # CI: lint+typecheck → test → smoke-trading
```

### 2.2 Backend `apps/dashboard/server` (97 non-test modules)
- `index.mjs` / `app.mjs` — server bootstrap + same-origin middleware.
- **`handlers.mjs` (4,472 lines, 100+ routes)** — the single router/dispatcher for every feature family. This is the densest file in the repo and the primary audit surface (findings 2–6 live here).
- `services/` (91 files): trading engine (8-model ensemble, paper ledger), prediction, market-data bus + broker adapters, connectors (income), notifications/alerting, payments (stripe/paypal/ewallet/btcpay), session capture engine, analytics/models, browser automation bridge.
- `__tests__/` (107 `*.test.mjs`) — the dominant test surface.

### 2.3 Frontend `apps/dashboard/src`
- `pages/` (10): Dashboard, Simulator, Trading, Streams, Agents, Pricing/Profile, Suites, etc.
- `components/` (53), `hooks/`, `lib/` (`api.ts` typed transport, `types.ts`).
- `src/lib/__tests__` (15 test files) + component/hook tests (5).

### 2.4 Extension `extensions/picc-overlay` (14 files)
- MV3 vanilla JS, no build step. `inject.js` (MAIN world, DOM-free sensor) → `content.js` (ISOLATED, shape-validates frames) → service worker (telemetry/heartbeat/resurrection).
- Session-capture relay (T13) — primary headless-capture leg.

### 2.5 Tests & CI
- 128 test files total, **1,391 tests pass**, 127 files pass, TypeScript clean (`tsc -b --noEmit` exit 0).
- No `.skip`/`.only`/`.todo` (all tests are live).
- **Coverage gap:** no tests for auth, payment flows, browser automation, or `fetchCandles` — the exact areas findings 1–6 touch.

---

## 3. Security & secrets

### 3.1 ✓ verified — Committed ExpertOption session token (HIGH) — Finding #1
- `git grep -l "6dc12a98582558c0581c56bdc27f8c8c" HEAD -- scripts/` returns **six committed files**: `probe-eo-cookie.mjs`, `probe-eo-pushes.mjs`, `probe-eo-sessionid.mjs`, `probe-eo-sidebyside.mjs`, `probe-eo-subscribe.mjs`, `probe-live-eo.mjs` (all present in the initial commit `5d4efe0`).
- `probe-live-eo.mjs` hardcodes it as `expertoptionToken: "6dc12a9…"`.
- **Realistic blast radius limited:** the 32 `scripts/` are dev/diagnostic probes; **zero server modules import them** (verified), so the running app never reads or serves this token. It is not exposed through any API.
- **Still a real committed secret** — must rotate the EO session and purge these from history (see remediation §8). A committed bearer session token, even in dev-only scripts, is exactly what scanners flag.

### 3.2 ✓ verified — Docker publishes on all interfaces (LOW/MED) — Finding #7
- `infra/dashboard/docker-compose.yml:17`: `"${PICC_PORT:-3000}:3000"` binds host-wide (no `127.0.0.1:` prefix). The Node server binds `127.0.0.1` by default, but the published container port is reachable on every host interface. On a LAN/dev box, tighten to `127.0.0.1:3000:3000`.

### 3.3 ✓ verified — Plaintext session tokens in `server/data/` (LOW, by design) — Finding #9
- `trading.mjs:145` writes EO credential JSON; the capture engine writes `server/data/trading-venue-tokens.json` — both on the **gitignored** path `apps/dashboard/server/data/` (verified in `.gitignore`), and deliberately split so tokens never ride API responses (`ARCHITECTURE.md` documents this). This is the *intended* single-user design.
- **Hardening opportunity only:** OS-level credential store (safeStorage/DPAPI) would lift the plaintext-at-rest exposure, but it is not a defect against the documented model.

### 3.4 ✓ verified — `execSync` string interpolation in browser bridge (LOW) — Finding #8
- `browserBridge.mjs` shells out via `execSync` at several sites (lines ~50, 134, 137, 153, 161, 200, 224).
- **I reviewed every interpolation's actual input.** `kill ${id}` / `taskkill ${id}` sources are PIDs already coerced via `.map(Number)` (safe); `reg query`/`powershell` calls are constants or server-generated temp paths; the one "dynamic" value is `needle`/`userDataDir` (`pgrep -f "${needle}"`, `powershell … "${needle}"`), which is built from the server's own fixed profile paths (`server/data/browser-profiles/<slug>`), not remote input.
- **Conclusion (downgraded from the agent's "medium"):** not a remotely-triggerable command injection under current data flow. The *pattern* remains a robust code smell flagged by 2026 CWE-78 guidance (Orbis AppSec: prefer `execFile`/argument arrays over `execSync` shell strings). Refactor for hardening, low urgency.

### 3.5 ✓ verified — No frontend injection primitives (clean)
- `grep dangerouslySetInnerHTML|new Function(|eval(` across `src/**/*.tsx` → **zero matches**. No HTML-insertion XSS primitive in React components.

### 3.6 ✓ verified — Secrets never reach the browser (by design)
- Non-`VITE_` env vars (LLM keys, Stripe, Supabase service role) are read only Node-side — confirmed consistent with `ARCHITECTURE.md`.

---

## 4. Payment & authorization defects (HIGH/CDN)

These are the highest-impact concrete bugs. All verified at the cited lines of `handlers.mjs`.

### 4.1 ✓ verified — BTCPay subscription never granted (HIGH, functional) — Finding #2
- `btcpay.mjs:58` returns only `{ status, amount }` — it never returns a `userId` or `tier`.
- `handlers.mjs:3646-3648` does: `if (info.userId === userId && info.tier && …) → grant` — `info.userId`/`info.tier` are always `undefined`, so the grant branch is **permanently unreachable**.
- **Net effect:** a BTCPay invoice that settles will report success but **never upgrade the user's tier**. Must align the service's return shape with what the handler checks (and add a test).

### 4.2 ✓ verified — Stripe customer-portal IDOR (HIGH, authz) — Finding #3
- `handlers.mjs:3514-3527`: the route verifies `userId` (Supabase JWT auth is present) **but never validates that the client-supplied `customerId` belongs to that user**. Any authenticated user can open any Stripe customer's billing portal by passing another user's `customerId`.
- Fix: resolve `customerId` server-side from the authenticated `userId`/profile (or assert ownership) — never trust the body. This is a classic **IDOR / broken object-level authorization** (OWASP API1).

### 4.3 ✓ verified — EWallet self-serve order with no real-money verification (MED) — Finding #6
- `ewallet.mjs:72` `createEwalletOrder` takes **no `userId`**; the order record carries no user binding.
- `ewallet.mjs:110` `submitEwalletOrder` is self-approving — a customer enters a receipt confirmation and the tier is granted **without any real-money verification**.
- Documented as "self-serve, audited in `payment_orders`" — acceptable as a demo/lab gate, but it must stay admin/demo-gated and explicit; flag it as a forge path (§`ARCHITECTURE.md` already calls the manual TnG path "audited", not "verified").

### 4.4 ✓ verified — Frontend double-prefix `/api/api/…` (HIGH, reachable) — Finding #4
- `src/lib/api.ts:269,277` passes `/api/trading/session-policy` into `request()`/`post()`, both of which prepend `/api` → resolves to `/api/api/trading/session-policy` = **404 at runtime**.
- **Reachable:** `components/IncomeStreams.tsx:486,495` call `getSessionPolicy()`/`setSessionPolicy()`. Any render of that control fails.
- Fix: pass `trading/session-policy` (single prefix) or make the transport not double-prefix. Add a unit test asserting the resolved URL.

---

## 5. Correctness / runtime defects

### 5.1 ✓ verified — `round2` undefined → `ReferenceError` (MED) — Finding #5
- `handlers.mjs:2684` (arbitrage/spread route) references `round2` with **no declaration or import anywhere** (verified). Reaching this route throws `ReferenceError: round2 is not defined` at runtime.
- Fix: define `round2` (e.g., `Math.round(x*100)/100`) at module scope or inline. No test covers this route — add one.

### 5.2 ✓ re-verified 2026-09-04 + ADDRESSED — `liveEO.mjs` unbounded `lastLiveFetch` Map
- **Re-verified:** the per-key re-fetch throttle map grew without eviction.
- **Fix:** `pruneLiveFetchMap` (exported, pure) drops entries idle past `LIVE_FETCH_TTL_MS` (5 min) and enforces a `LIVE_FETCH_MAX_KEYS` (256) hard cap, evicting oldest-first; `fetchAssetCandles` prunes when over cap.
- **Locked by:** `server/__tests__/liveEO.fetchThrottle.test.mjs` (TTL eviction, cap eviction oldest-first, non-Map safety).

### 5.3 ✓ re-verified 2026-09-04 + ADDRESSED — `liveCCXT.mjs` false "connected" staleness
- **Re-verified:** `liveCCXTData()` inferred `"connected"` from `assets.length` alone.
- **Fix:** liveness gate `ccxtFeedStatus`/`ccxtStatus` — `"connected"` only while some buffer was written within `CCXT_STALE_MS` (90 s, six 15 s scheduler polls); older buffers report `"stale"` (data stays readable); `mergeCCXTAssets` only lets a live primary feed override it.
- **Locked by:** `server/__tests__/liveCCXT.staleness.test.mjs` (idle / fresh-connected / stale-after-window / pure-gate boundary).

### 5.4 ✓ re-verified 2026-09-04 + ADDRESSED — `modelMatrix.mjs` `modelBreakout` has no flat state
- **Re-verified:** mid-channel position (0.5±) voted a coin-flip up/down.
- **Fix:** neutral mid-band — flat in 0.40–0.60 of the Donchian channel; tails (>0.85 / <0.15) and shoulders unchanged.
- **Locked by:** `server/__tests__/modelMatrix.test.mjs` (mid-band → flat + note, tails still directional).

### 5.5 ✓ re-verified 2026-09-04 + ADDRESSED — `modelMatrix.mjs` O(n²) EMA recompute
- **Re-verified:** `modelMacd` recomputed full-slice EMAs per `end`.
- **Fix:** one O(n) pass via `emaSeries` (full EMA12/26 runs, differenced) — same warmup seed, bit-for-bit identical output.
- **Locked by:** `server/__tests__/modelMatrix.test.mjs` equivalence test against the original quadratic implementation.

### 5.6 ✓ re-verified 2026-09-04 + ADDRESSED — `accuracyLedger.mjs` entry price look-ahead
- **Re-verified:** `recordDecision` sampled the newest (possibly forming) buffer candle regardless of when the decision was logged.
- **Fix:** new pure `sampleEntryPrice(candles, {at, price})` — an explicit signal-time `d.price` wins; otherwise the newest candle whose bar time is ≤ the decision's own `ts` (a late re-log can never capture a post-signal close). Entry records `entryCandleTime`.
- **Locked by:** `server/__tests__/accuracyLedger.test.mjs` (explicit price wins, `ts`-anchoring, invalid-price fallback, empty input).

### 5.7 ✓ re-verified 2026-09-04 + ADDRESSED — `localstore.mjs` load race + non-atomic write
- **Re-verified:** fire-and-forget initial load could clobber newer in-memory state; writes were plain `writeFile`.
- **Fix:** every store runs one promise chain — load settles before any write; a write issued before load resolves marks the store pre-written (file contents no longer merge over caller state); writes are atomic tmp+rename with ENOENT mkdir retry; corrupt JSON falls back to defaults; `store.ready` exposed.
- **Locked by:** `server/__tests__/localstore.test.mjs` (persist/reload, pre-load write wins, corrupt file, atomic no-`.tmp`-residue, per-name caching).

### 5.8 ✓ re-verified 2026-09-04 + ADDRESSED — `correlation.mjs` dead `portVar`
- **Re-verified:** unused portfolio-variance accumulation inside `diversificationScore`.
- **Fix:** dead block removed (score math unchanged).
- **Locked by:** `server/__tests__/correlation.test.mjs` (matrix/`highlyCorrelated`, score values for ±1-correlated and degenerate inputs).

---

## 6. Browser extension & infrastructure

### 6.1 ✓ verified — Extension has no lockfile (LOW, supply-chain) — Finding #10
- `apps/dashboard/extensions/picc-overlay/` ships **no lockfile** (ENOLOCK). Given it's an auto-loading MV3 extension with dev dependencies, add a lockfile so installs are reproducible and `npm audit` works (dashboard itself audits at **0 vulnerabilities**).

### 6.2 ✓ verified — Extension `backendUrl` is user-editable (LOW/design)
- The popup/settings let the user point `backendUrl` at an arbitrary `http(s)://` host; the content script will POST observed page data there. This is the documented self-hostable model; flag as: only enable relay when the host passes a localhost/loopback + `/api/health` check (the repo already re-probes `/api/health`).

### 6.3 ✓ verified — Extension context-invalidation resilience (good)
- `chromeGuard()` in `content.js` tears the sensor down on invalidated contexts — a deliberate, well-designed hardening (per `ARCHITECTURE.md`).

### 6.4 CI
- `.github/workflows/ci.yml`: lint-and-typecheck → test → smoke-trading on Node 22, matrix ubuntu/arm/windows. Adequate; could add a secrets-scan (gitleaks/trufflehog) step to catch the class of Finding #1.

---

## 7. Tests & tooling

- **1,391 passing tests / 127 files, `tsc -b --noEmit` exit 0** (run 2026-09-02). This is a healthy, genuinely-run suite — not a stubbed green.
- Zero `.skip`/`.only`/`.todo`; no `vitest.config` (defaults), `--maxWorkers=3`.
- **Coverage blind spots (align with findings):** no tests for auth/JWT middleware, payment grant logic (Stripe/BTCPay/EWallet — Findings 2, 3, 6), browser-bridge automation, or `fetchCandles` (Finding 4). Adding payment/tier tests would have caught Findings 2 and 3.
- Repo hygiene: never commit `tsconfig.tsbuildinfo`, `dev_pack_code.py`, `project_tree.txt`; `useCandleData.render.test.tsx` has a known newline artifact; `LF→CRLF` warnings are benign. AI-skills self-heal check passes.

---

## 8. Remediation plan (ordered, agent-executable)

> Each fix is a small, well-scoped slice amenable to TDD. Suggested test for each:
> - **Fix 1 (secrets):** `git rm`/`git filter-repo` the six probe files from history, rotate the EO session. Add `.gitleaks.toml` + CI scan.
> - **Fix 2 (BTCPay):** have `btcpay.mjs` return `{ userId, tier, status }` (or have handler read the order row), then gate on the order's real fields. **Test:** settle-invoice → `subscription_tier` updated.
> - **Fix 3 (Stripe IDOR):** derive `customerId` from the authed profile; reject bodies carrying a different customer. **Test:** user A requesting user B's `customerId` → 403.
> - **Fix 4 (double prefix):** stop double-prefixing `session-policy`. **Test:** transport URL resolves to single `/api/...`.
> - **Fix 5 (`round2`):** define it. **Test:** hit the spread/arbitrage route, assert a number, no throw.
> - **Fix 6 (eWallet):** bind `createEwalletOrder` to `userId`; keep self-approve behind an explicit admin/demo flag. **Test:** order carries owner; approval requires verified payment.
> - **Fix 7 (compose):** bind `127.0.0.1:3000:3000`.
> - **Fix 8 (browserBridge):** convert `execSync` → `execFile`/`spawn` with argument arrays (per CWE-78 guidance); no behavior change.
> - **Fix 10 (extension):** commit a lockfile; run `npm audit`.

**Remediation status (2026-09-03):**
- **Fix 2 (BTCPay tier grant) — ADDRESSED.** `createBtcpayInvoice` now embeds `{ userId, tier }` in invoice `metadata`; `btcpayInvoiceStatus` returns them so the existing grant check compares the order's real owner/tier. New `server/__tests__/btcpay.test.mjs` (6 tests).
- **Fix 3 (Stripe portal IDOR) — ADDRESSED.** Portal route ignores any client-supplied `customerId` and resolves the authenticated user's OWN `stripe_customer_id` via new `stripeCustomerForUser()` helper; 400 when none on file. New `server/__tests__/stripePortal.test.mjs` (2 tests).
- **Fix 4 (double prefix) — ADDRESSED.** `session-policy` caller paths in `api.ts` no longer repeat the `/api` prefix; transport URL resolves to single `/api/trading/session-policy`. New `src/lib/__tests__/sessionPolicy.test.ts` (2 tests).
- **Fix 5 (`round2` undefined) — ADDRESSED.** `round2` defined (and exported) in `handlers.mjs`; guards non-finite input like its peers. New `server/__tests__/spreadRoute.test.mjs` (2 tests) exercises the `/api/trading/spread` route end-to-end with two live CCXT quotes (previously threw ReferenceError → 500). Full suite green: **1403/1403 (131 files)**; `npx tsc -b --noEmit` exit 0.

**Remediation status (2026-09-04 — finalization wave, all committed + pushed to `origin/master`):**
- **Fix 1 (secrets) — ADDRESSED (in-tree).** The six `probe-*.mjs` files are deleted from the tree; `.gitleaks.toml` pins the known leaked tokens; CI gains an independent `secrets-scan` (gitleaks) job that runs before the build matrix; the remaining credential-shaped fixture token in `browserStudio.login.test.mjs` was neutralised. **Human steps remain:** rotate the live EO session; decide on a history rewrite of the pushed remote (token exists in history since the initial commit). See `docs/FINALIZATION_REPORT.md` §6.1 (R1a/R1b).
- **Fix 2 (BTCPay) — ADDRESSED + committed** (metadata `{userId,tier}` round-trip; `btcpay.test.mjs`).
- **Fix 3 (Stripe IDOR) — ADDRESSED + committed** (`stripeCustomerForUser` server-side resolution; `stripePortal.test.mjs`).
- **Fix 4 (double prefix) — ADDRESSED + committed** (`sessionPolicy.test.ts`).
- **Fix 5 (`round2`) — ADDRESSED + committed** (`spreadRoute.test.mjs`).
- **Fix 6 (eWallet owner binding) — ADDRESSED + committed.** Orders carry a `userId`; only the owner (or an explicit `selfApprove`, single-owner demo mode only) can confirm; legacy owner-less orders cannot be confirmed by an arbitrary caller (`ewallet.test.mjs`).
- **Fix 7 (compose loopback bind) — ADDRESSED + committed** for both `infra/dashboard` and `infra/n8n`.
- **Fix 8 (execFile refactor) — ADDRESSED + committed.** `execSync` fully replaced by `execFileSync` argument arrays (`browserBridge.mjs`; source-locked by `browserBridge.execFile.test.mjs`).
- **Fix 9 (vault at rest) — CLOSED earlier as by-design hardening** (F-02 vault work); unchanged.
- **Fix 10 (extension lockfile) — DECLINED with reason (2026-09-04).** `apps/dashboard/extensions/picc-overlay/` is a zero-dependency, no-build MV3 extension: there is nothing to lock and `npm audit` would be vacuous. Revisit only if the extension gains dependencies.
- **Suite at closure:** **1,525/1,525 tests (143 files)**; `npx tsc -b --noEmit` exit 0. Full wave ledger: `docs/FINALIZATION_REPORT.md`.

**Strategy-program wave (2026-09-04, Phases 2–5, uncommitted working-tree edits for owner review):**
- **§5.2–5.8 findings — all CLOSED with fixes + regression tests** (see §5 for per-finding code/test references): `accuracyLedger` look-ahead entry/exit (signal-time candle), `localstore` load-race + non-atomic write (serialized chain + atomic rename), `liveCCXT` false-connected staleness (last-message age gate), `liveEO` unbounded throttle map (size cap + eviction), `modelMatrix` breakout neutral band + `modelMacd` O(n) EMA, `correlation` dead `portVar` removal.
- **NEXT_WAVE slice 5d — DONE** (coverage for all 10 named services, hermetic, no network) and **R6 — DONE** (GK/YZ estimator chooser wired into autopilot sizing; correlation screen in the suite).
- **Finance Tracker (R7 / PICC_FULL_SCOPE Part 2a) — DONE**: `finance.ts` rewrite + Accounts/Transactions CRUD + computed net worth + auto-synced paper-trading account; Dashboard hero fallback removed.
- **Income REQ-C write side (R8) — DONE**: `HoldingsEditor` add/delete for `nft_holdings`/`depin_nodes` on the Income Overview tab.
- **Suite at wave end:** **1,620/1,620 tests (160 files)**; `npx tsc -b --noEmit` exit 0. Ledger F8/F-11 rows closed; NEXT_WAVE 5d + PICC_FULL_SCOPE Part-2a checklists ticked; CHANGELOG wave entry added.

---

## 9. External research notes (2026)

- **Browser automation stack:** Playwright is the 2026 incumbent (≈78.6k stars, 45%+ QA adoption); CDP remains the richest protocol for Chrome and is what `browserBridge.mjs` uses (via `playwright-core`) — an appropriate, current choice for real-browser connector reads. CDP remains superior for AI-agent/instrumented cases; BiDi is the rising W3C standard but not yet mandatory for Chrome-only paths.
- **Command-injection avoidance (CWE-78):** 2026 AppSec guidance (Orbis, OWASP cheat sheet) is unambiguous — prefer `execFile`/`spawn` with argument arrays over `execSync` shell strings; treat every interpolated value as tainted. Supports the browserBridge refactor (§3.4).
- **Dependencies:** dashboard `npm audit` → 0 reported vulnerabilities. Extension lacking a lockfile is the only supply-chain gap.

---

## 10. What was NOT verified (honest gaps)

The following came from subsystem explore agents during the parallel audit and were **not** independently re-run by me at audit time. **Since closed (2026-09-04 sweep):** every §5.2–5.8 finding was re-verified line-by-line, fixed, and regression-locked before closure — see §5 for code + test references.

Also not reverified (requires a running stack): live EO real-market feed (needs human re-login), the two standing open user items (extension empty inspection console, and no visible "Send test" button) — both remain **uninvestigated** as the audit superseded them.

---

*This report is intended as a living reference for AI agents and humans alike. Every HIGH finding has a file+line anchor and a proposed fix; every unverified claim is explicitly labelled. Re-run verification commands before committing a fix: `npx tsc -b --noEmit` and `npx vitest run` from `apps/dashboard`.*
