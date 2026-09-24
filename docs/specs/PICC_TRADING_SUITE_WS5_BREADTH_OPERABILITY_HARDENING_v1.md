# PICC Trading Suite — WS-5 · Breadth & Operability Hardening — spec v1

**Date:** 2026-09-23 · **Ratified:** 2026-09-24 (owner lock: "proceed with ws5") · **Workstream:** WS-5 of `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md` (APPROVED) · **Kind:** implementation-ready plan · **Approved by:** owner, subagent-driven implementation.

- Master design: `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md` — WS-5 scope block `:64-67` + `:69-74` (startup credential validation instead of fail-at-propose; de-risk the 13-screen breadth; cross-tab live-lock surface; Playwright e2e harness; runbook/credential rotation); locked decision 11 (venue earns live via ADR, `:37`); sequence/soak decisions `:27-34`; limitations 6–7 `:83-84`; working set `:9-21`.
- WS-4 spec (format precedent + landed substrate): `docs/specs/PICC_TRADING_SUITE_WS4_COPYTRADING_IDEA_SOURCING_v1.md` — store `:29-31`, readout route template `:1607-1650`-family, bisect matrix §6, resolution §9; status LANDED (PICC.md registry).
- WS-3 spec: `docs/specs/PICC_TRADING_SUITE_WS3_VALIDATION_AND_UNLOCK_CEREMONY_v1.md` — persistent-store/gate/readout conventions, ceremony LANDED. WS-2 spec: `docs/specs/PICC_TRADING_SUITE_WS2_RISK_AND_DRAWDOWN_ENFORCEMENT_v1.md` — WS-5 must not touch risk rails 16–19 / sidecar 1–10 / perps 11–15.
- Scope compendium: `.superpowers/sdd/PICC_TRADING_SUITE_WS345_PIPELINE/plan.md` — WS-5 block `:60-104`; "13 screens" claim at plan.md `:66` (see §0.1 for the honest reading); WS-5 = NEXT, spec not started.

**Status: ACTIVE** — decisions D1–D8 are owner-ratified as written (§2, §9). T0–T6 execute per the §6 matrix. Nothing in this spec is live until the §9 ship gate passes.

---

## §0 Current state (verified file:line, 2026-09-23)

1. **The monolith.** `apps/dashboard/src/components/TradingSuite.tsx` = 96,044 bytes; ~2,098 lines (PowerShell `Measure-Object -Line`) / 2,208 (Read tool EOF line — discrepancy noted, both honest). Exports: MarketsSuite `:124`, AutopilotSuite `:292`, SignalNotificationsCard `:876`, StatusCards `:1020`, PredictionCard `:1102`, ProAnalysisCard `:1265`, PaperTradingCard `:1521`, TradePlannerCard `:1615`, WatchlistScannerCard `:1734`, NewsCard `:1855`, PaperAnalyticsCard `:1921`, SignalsCard `:2073`; internal `AssistantCard` (non-exported) `:2175`, used at `:279`. MarketsSuite renders the 12 exports + AssistantCard as a **flat panel stack** (no screen switcher, no per-panel routes, `data-panel` anchors) — plan.md's "13 screens" has no navigation to de-risk; the honest reading is **13 renderable panels stacked inside one route** (12 named exports + AssistantCard). AutopilotSuite occupies `:292-876` (~585 lines) — the largest single renderable unit.
2. **Mount points (the extraction seams).** MarketsSuite → `src/pages/Suites.tsx:5,32`. AutopilotSuite + ProAnalysisCard + PredictionCard → `src/pages/ministry/AutopilotRoom.tsx:2` (single import line), AutopilotRoom rendered at `:193`; route key `autopilot` in the lazy room map `src/pages/ministry/MinistryRoom.tsx:20`, key `command-centre` `:21`. Headers: `data-room="command-centre"` in `CommandCentreRoom.tsx:29`, `data-room="autopilot"` in `AutopilotRoom.tsx:188`, empty-state text at `AutopilotRoom.tsx:160`; `MinistryRoom.studio.test.tsx:41` mounts rooms via MemoryRouter at `/suites/:suiteId` (the studio-surface matrix).
3. **Floor pins that must stay green (untouched by design).** `src/components/__tests__/TradingSuite.deeplink.test.tsx` (imports MarketsSuite `:51`, mounts via MemoryRouter — the deep-link contract); `src/hooks/__tests__/useCandleData.render.test.tsx` (mounts the REAL MarketsSuite `:92,136`); `src/pages/__tests__/ministryRooms.test.tsx` (renders AutopilotSuite `:139`, verified by glob this session). `commandCentreOverview` aggregation + compose tests stay byte-identical (ADR-0005, WS-4 R9.1).
4. **No Playwright harness exists.** Only `playwright-core` ^1.49.1 (devDependency, `apps/dashboard/package.json:21`) used for CDP in `apps/dashboard/server/services/browserBridge.mjs:2,388`. No `@playwright/test`, no `playwright.config.*`, no `e2e/` dir, no CI e2e job (ci.yml `smoke-trading` job `:76-91` runs only `npm run smoke:trading`, which is `scripts/probe-e2e-decisions.mjs` — real-server boot probe wired at `apps/dashboard/package.json:14`).
5. **The E2E server substrate.** The vite dev server mounts the full API in-process: `vite.config.ts:82-101` (middleware → `handleApi`), SPA served on strict port 5173 `:113-114`, `startTradingHud()`/`startLedger()` at import `:55-56`, scheduler + liveness in dev `:61-71`, `initErrorLog()` gated by `PICC_ERROR_LOG` `:58-62`. So `npm run dev` = one process, SPA+API, no build step — the Playwright `webServer`.
6. **Data-directory isolation vars (verified, the full list the E2E must redirect).** `PICC_TRADING_DATA_DIR` (trading-credentials.json `services/trading.mjs:28-29`; trading-autopilot.json `services/autopilot.mjs:30-31`; positionManager `:20`; u4faConfig `:138`; v32Config `:65`), `PICC_AUTOMATOR_DATA_DIR` (venue-credentials.json `services/venueCredentials.mjs:13`; streamSnapshot `:14`), `PICC_COMMAND_CENTRE_DATA_DIR` (ceremony-state.json `commandCentre/ceremonyState.mjs:7-9`, command-centre-audit.jsonl `commandCentre/auditTrail.mjs:25-27`, ccxt-equity.json `ccxtOrdering.mjs:66-68`, ccxt-perps-positions/risk json `livePositionManager.mjs:100-103`, risk gates/state/halt/leader-ideas/runtime stores), `PICC_AUTH_DATA_DIR` (users/sessions `auth.mjs:10-12`), `PICC_BROWSER_DATA_DIR` (`browserStudio.mjs:28`), `PICC_ACCOUNT_METRICS_DATA_DIR` (`accountMetrics.mjs:37`), `PICC_ALERTS_DATA_DIR` (`alertEngine.mjs:10`), `PICC_CONNECTOR_DATA_DIR` (`connectors.mjs:272`), `PICC_CAPTURE_CONFIG_DATA_DIR` (`captureProfiles.mjs:275,376`), `PICC_DISPATCH_DATA_DIR` (`dispatch.mjs:10`), `PICC_EWALLET_DATA_DIR` (`ewallet.mjs:39`), `PICC_JOURNAL_DATA_DIR` (`tradeJournal.mjs:8`), `PICC_NOTIFICATION_DATA_DIR` (`notificationCenter.mjs:8`), `PICC_PROFILE_DATA_DIR` (`profile.mjs:19`), `PICC_WATCHLIST_DATA_DIR` (`watchlist.mjs:10`), `PICC_DATA_DIR` (localstore `:10-11`, feed-mode `liveEO.mjs:91-92`, chart-prefs `chartPrefs.mjs:25-26`), plus the file-scoped `PICC_SESSION_CAPTURE_SETTINGS_FILE` (`sessionCaptureSettings.mjs:12`) and `PICC_LLM_SETTINGS_FILE` (`llmSettings.mjs:12`). Vault: `PICC_VAULT_KEY` env (`vault.mjs:38`) — the E2E run mints its own hex key; `picc-vault.key` stays out of the fixture dir so the fixture is vault-fresh.
7. **No cross-tab coordination exists.** Zero matches for `BroadcastChannel|navigator.locks|SharedWorker|storage` events in `src/`. `public/sw.js` is a passive push/precache shell (versioned by `vite.config.ts:25-53`) with fetch passthrough. Auth is single-tab localStorage `picc.auth` (`src/lib/auth.ts` `getStoredSession` `:18-27`, `setStoredSession` `:29-36`).
8. **`suite:deny:*` does not exist.** Zero matches repo-wide. Existing deny vocabulary (verbatim): `invalid-environment: PICC_CCXT_LEVERAGE_MIN=…` (`commandCentre/perpsGates.mjs:121`), `invalid-environment: PICC_CCXT_MARGIN_PER_POSITION_CAP_USD=…` (`perpsExecution.mjs:167`), `perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)` (`server/__tests__/ceremonyVenueUnlock.test.mjs:13`), `ccxt ordering seam: no ${envKey(id)} credentials configured — set either PICC_CCXT_APIKEY_… + PICC_CCXT_SECRET_… (CEX-style) or PICC_CCXT_WALLETADDRESS_… + PICC_CCXT_PRIVATEKEY_… (Hyperliquid-style) — the execution leg is inoperable without them` (`ccxtOrdering.mjs:157`), plus the WS-4 `leader:*` corpus and ceremony deny compounds. WS-5 introduces `suite:deny:*` additively.
9. **Credential capture/expiry today.** `expertoptionTokenCapturedAt` is set on every credential save (`services/trading.mjs:172`) and read ONLY for session-age display (`handlers.mjs:4163-4164`) — never checked for expiry, never surfaced as a denial. All venue validation is call-time: `liveEO.mjs:685-699` (`openLiveSession` throws on absent token), `ccxtOrdering.mjs:116-119` reads the key pairs at order time, `ccxtOrdering.mjs:157` refuses when no pair exists, CCXT pair-completeness has no boot-time check anywhere. `index.mjs` (210 lines, `apps/dashboard/server/index.mjs:8-16` boot imports: handlers, scheduler, accuracyLedger, ceremonyState `:11`, leaderIdeasState `:12`, logger, errorLog, signalEngine, marketDataBus) runs NO credential/boot validation.
10. **Venue recon (WS-5 venue scope is recon-only).** `captureProfiles.mjs:55-74` (expertoption: full profile, demo-first, ws metrics), `:76-91+` (iqoption: storage-scan ssid cookie, `verified: false`, metric list empty — iqoption has no market-data mapping today); `expertoption.mjs:22` (`DEFAULT_WS_URL = wss://fr24g1eu.expertoption.com/ws/v45`, demo-only refusal `:8-10`). Hyperliquid: adapter surface `venues/hyperliquidPerps.mjs:546-549`, riskModel/readRiskModel call-time deny pattern `:19-27`, sandbox/mainnet flags read at `:105-106`. `ccxtOrdering.test.mjs` shows the env-fixture pattern for key pairs (`:69-75,91,120`).
11. **Runbook precedent.** `docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md` — living doc, sections 1-4+ (Goal `:12`, Reference `:25`, wallet-key creds section). `.env.example` CCXT block: `:142-173` documents `PICC_CCXT_APIKEY_<EX>`/`SECRET_<EX>`/`PASSWORD_<EX>` (CEX-style) vs `WALLETADDRESS_<EX>`/`PRIVATEKEY_<EX>` (wallet-style) `:148-149`, sandbox flags `:156-158`, perps caps `:168-172`.
12. **No credentials, tokens, wallets, or account numbers appear in this spec.** Live values are cited by line reference, never copied (mirrors WS-2/WS-3/WS-4 §8).

---

## §1 Locked decisions re-affirmed (not renegotiable)

- **Decision 10 / ADR-0005 additive contract:** everything absent reads as a named deny, never as a pass; no removal or rewording of an existing deny; overview route and existing rails byte-identical.
- **Decision 11 (`SEAL :37`):** a venue earns live status only via an ADR — WS-5 makes **no venue enablement change** and writes no venue ADR.
- **Decision 1 (`SEAL :27`):** one workstream at a time; WS-5 after WS-3/WS-4 (landed), before any WS-6 that may exist.
- **Master sequence WS-1→WS-5:** WS-5 does not unlock execution, does not touch WS-2 risk gates 16–19 / sidecar 1–10 / perps 11–15, does not alter the ceremony, does not modify `policyGraphCatalog` templates, does not modify `venueAdapterContract.mjs`.
- **Only allowed new dependency:** `@playwright/test`, pinned ^1.49.x, devDependency of `@picc/dashboard`, used solely by the e2e harness (T0). No other `package.json` dependency changes.
- **Server is ESM `.mjs` with one-line honesty comments; `src/` is strict TypeScript.** New client files are `.ts`/`.tsx` under `apps/dashboard/src`.

---

## §2 Ratified decisions (owner-locked 2026-09-24 — D1..D8)

Each entry: Context → Decision → Why → Consequence. **Ratified as written by the owner on 2026-09-24** ("proceed with ws5", no amendments); an amendment requires a fresh explicit owner instruction.

### D1 — Breadth reduction = AutopilotSuite extraction only; the other 12 panels stay.
**Context:** plan.md `:66` says "de-risk the 13-screen breadth"; §0.1 shows there is no 13-screen navigation — 13 renderable panels stack inside one route, and only AutopilotSuite (~585 lines, `TradingSuite.tsx:292-876`) is a large, isolated renderable unit with a single importer.
**Decision:** Extract AutopilotSuite to `src/components/AutopilotSuite.tsx` (move body + its private helpers), re-export it from TradingSuite.tsx (`export { AutopilotSuite } from "./AutopilotSuite"`), and update `AutopilotRoom.tsx:2` to import from the new module. The other 11 exports + AssistantCard stay in TradingSuite.tsx. **No new routes, no screen switcher, no per-screen navigation.**
**Why:** Full rewrite of a 2,100-line, deeply tested surface is the highest-risk option with zero user-visible payoff; extraction is bisect-safe (single importer) and keeps every floor pin green.
**Consequence:** TradingSuite.tsx shrinks by ~585 lines; the three floor tests stay green untouched (deeplink imports MarketsSuite only, which is unmoved).

### D2 — "13 screens as 13 routes" is REJECTED.
**Context:** plan.md `:66` phrasing is ambiguous; one reading ("each screen as its own route") would restructure the flat stack.
**Decision:** The flat stack IS the screen. Breadth is de-risked by extraction (D1) + the honesty upkeep in D3/D4, not by re-routing.
**Why:** Re-routing changes deep-link behavior (`TradingSuite.deeplink.test.tsx`), breaks `data-panel` anchors used by browserStudio/ministry flows, and edits every card's mount condition for no functional gain.
**Consequence:** The honest mapping of "13 screens" is documented in the runbook (D8): 12 exported components + internal AssistantCard, one stacked route.

### D3 — E2E harness: `@playwright/test` + vite-dev webServer + full data-dir isolation.
**Context:** No harness exists (§0.4–0.6); the probe (`probe-e2e-decisions.mjs`) proved the honest real-boot pattern but is API-only.
**Decision:** Add `@playwright/test` ^1.49.x (sole new dep). `apps/dashboard/playwright.config.ts` with `webServer.command = "npm run dev"` (vite serves SPA+API in one process, port 5173 strict), and **webServer env = every var in §0.6** redirected into a per-run `.playwright-tmp/<hash>` dir + a freshly minted `PICC_VAULT_KEY` + `PICC_ERROR_LOG=0`. A config-time assertion fails the run if any isolated path escapes the tmp root or any `PICC_*` var is unset from the isolation list (belt: the boot probe inside `e2e/helpers/isolatedEnv.mjs` also asserts it).
**Why:** One process, no build step, honest full-stack behavior; the env list is verified (§0.6), so isolation is mechanical.
**Consequence:** E2E can never touch the real `server/data` or real credentials; CI can adopt `npm run test:e2e --workspace @picc/dashboard` later (ci.yml change is a follow-up, not in T0).

### D4 — Cross-tab dangerous-action lock: Web Locks (`navigator.locks`), honest denial, client-side only.
**Context:** No cross-tab primitive exists (§0.7); dangerous UI actions are kill-switch POST, autopilot config save, and command-centre execute-consent POST.
**Decision:** New `src/lib/dangerousActionLock.ts` wraps those three call sites. Semantics: `withActionLock(action, opts, fn)` → acquires `navigator.locks.request("picc:action:<action>", { timeout: 8_000 })`; on acquisition runs `fn`; on timeout → throw `suite:deny:lock-held (another tab holds the <action> lock — wait or close the other tab)`; when `navigator.locks` is unavailable → throw `suite:deny:lock-unavailable` (ADR-0005 — never a silent pass-through). Lock is released automatically on tab close/crash by the platform. jsdom does not implement `navigator.locks`, so unit tests stub it (see T2); the wrapper never falls back to storage events.
**Why:** Web Locks is same-origin, auto-releasing, deadlock-free, zero-dependency; storage-event rat-racing was rejected as flaky.
**Consequence:** Two tabs can no longer both land a dangerous POST at the same instant from this UI; the server rails (WS-2 idempotency/audit) remain the authority — the lock narrows the client race window, it does not replace the server (documented in Risks).

### D5 — Startup validation module: read-only, additive, surfaced via a new readout route.
**Context:** No boot validation exists (§0.9); failures surface only at propose/execute time.
**Decision:** New `apps/dashboard/server/services/commandCentre/startupHealth.mjs` imported from `index.mjs` (beside `ceremonyState`/`leaderIdeasState` import lines `:11-12`), runs once at boot, and is served by a new auth-gated `GET /api/command-centre/startup-health` route in `handlers.mjs`. Checks (all read-only, values never echoed, tokens masked `****`):
1. Credential stores decrypt: `readSecretJson` on `trading-credentials.json` and `venue-credentials.json` — corrupt/vault-failure → `suite:deny:credential-store-unreadable (<file>)` (error).
2. EO token expiry: `expertoptionTokenCapturedAt` age vs `PICC_CRED_EXPIRY_DAYS_EXPERTOPTION` (default 30; absent var → check skipped) → `suite:deny:credential-expired (expertoption, age N days exceeds M)` (error). Token present with NO capturedAt → `suite:deny:credential-capture-date-missing (expertoption, rotation record absent — re-capture to record it)` (warning).
3. CCXT pair completeness per venue (env keys, `ccxtOrdering.mjs:116-119` + detection regex `:466`): a half-set pair (APIKEY without SECRET, or WALLETADDRESS without PRIVATEKEY) → `suite:deny:credential-pair-incomplete (<EX>: <missing var>)` (warning — the exec leg refuses anyway with its own string, `ccxtOrdering.mjs:157`, which the readout reuses verbatim when no pair exists).
4. Perps rail mode: reuses the existing `perps-rail-off: …` refusal of `ceremonyVenueUnlock.test.mjs:13` when sandbox+mainnet engines are both off (informational, this is the WS-3 gate's own vocabulary — no new string).
Response shape: `{ ok: boolean, at, checks: [{ id, severity: "ok"|"warning"|"error", deny: string|null, detail }], generatedAt }` — `ok: false` iff any error-severity check fails. One `appendAudit` entry (`audit:startup-health`) written per boot with the summary.
**Why:** Matches the master's "startup credential validation instead of fail-at-propose" while honoring ADR-0005 additive-only — nothing fails that didn't fail before; it now fails earlier and named.
**Consequence:** `verifyAudit()` (`auditTrail.mjs:99-107`) stays green; rail behavior byte-identical.

### D6 — Credential expiry/rotation policy: capturedAt stays THE rotation record; TTL is env-advisory.
**Context:** `expertoptionTokenCapturedAt` is already the authoritative rotation timestamp (`trading.mjs:172`, set on every save).
**Decision:** No new storefile, no write-path change. Expiry = `capturedAt + TTL`, TTL from `PICC_CRED_EXPIRY_DAYS_EXPERTOPTION` (default 30). The deny is emitted by the D5 readout; the execution leg keeps its existing call-time failure (no-token throw / ccxt refusal). Rotation = the existing re-capture flow, which resets capturedAt. An execute-time expiry deny is **explicitly out of scope** unless the owner amends D6 — it would touch the WS-2 order rail.
**Why:** Minimal additive surface; rotation already works; the gap was only that nothing told the operator staleness exists.
**Consequence:** Operators see `suite:deny:credential-expired` in the readout minutes after boot, not at first failed proposal.

### D7 — Venue scope: recon-only, zero enablement change.
**Context:** Master decision 11; §0.10 recon shows iqoption is capture-only (no market-data mapping), EO is an unofficial WS client locked to demo, HL is sandbox-gated.
**Decision:** WS-5 covers: EO token expiry reporting (D5 check 2), CCXT pair completeness (check 3), and documented venue status in the runbook. The iqoption market-data path, EO re-engineering, and HL feature work remain open (ADR 0006+ deferred — no venue ADR in WS-5).
**Why:** Everything else is a venue ADR decision, not an operability fix.
**Consequence:** No venue code changes beyond nothing — hyperliquidPerps/expertoption/liveEO files are untouched by WS-5.

### D8 — Docs: new companion runbook + cross-links + registry rows.
**Context:** Runbook precedent exists (§0.11); operability surfaces (startup readout, expiry, lock, E2E) are cross-venue, so they don't belong inside the Hyperliquid connect runbook.
**Decision:** New `docs/runbooks/PICC_OPERABILITY_RUNBOOK.md`: how to read `/api/command-centre/startup-health`, credentials/rotation/expiry policy, cross-tab lock semantics, how to run the E2E harness + the full isolation var list, and the honest mapping of the "13 screens" (D2). One additive cross-pointer line in `HYPERLIQUID_CONNECT_RUNBOOK.md`. PICC.md registry rows for WS-5 (status + files). `.env.example` documents `PICC_CRED_EXPIRY_DAYS_EXPERTOPTION` (vars owned by T3, docs owned by T5 — file ownership is T3's alone, see §6).
**Why:** Extending the HL runbook would dilute its connect-flow focus; a separate operability runbook matches the working-set deliverable in the master design.
**Consequence:** One new doc, one pointer line, registry rows — nothing removed.

---

## §3 Requirements

Each requirement names its task(s). "Testable" = has an acceptance criterion in §5.

### R1 — AutopilotSuite extraction (D1/D2) — T4
- R1.1 `TradingSuite.tsx` no longer contains the AutopilotSuite body; it re-exports `AutopilotSuite` from the new module; the other 11 exports + AssistantCard are byte-unchanged (their line ranges may shift only by the removal).
- R1.2 `src/components/AutopilotSuite.tsx` imports ONLY from `@/lib`, `@/hooks`, `@/components/ui`, `react` (never from TradingSuite.tsx or sibling cards) — no circular import is possible.
- R1.3 `AutopilotRoom.tsx` renders from the new module; route key `autopilot` + `data-room="autopilot"` unchanged.
- R1.4 The three floor pins (deeplink, useCandleData.render, ministryRooms) stay green without edits.

### R2 — Playwright harness (D3) — T0
- R2.1 `@playwright/test` ^1.49.x added as devDependency; `test:e2e` script added; `playwright.config.ts` with `webServer` = `npm run dev` + the full §0.6 env isolation; testDir `e2e/`.
- R2.2 The webServer command refuses to boot unless every isolation path resolves under the per-run tmp root (config-time + boot-probe assertion).
- R2.3 No other dependency added (T6 asserts the package.json diff).

### R3 — E2E specs (D3) — T1
- R3.1 `e2e/command-centre-order-flow.spec.ts`: fresh user session (![signup via `/api/auth/signup` (`handlers.mjs:4266`) + login through the `/login` UI (`App.tsx:48`); fallback documented in runbook: localStorage `picc.auth` injection in the `auth.ts:16-39` shape); `/suites/trading/command-centre` renders (`data-room="command-centre"`); overview shows at least one honesty cell (not-wired / named deny — never a fake pass); kill-switch toggle → halted risk strip + subsequent propose returns a gate deny; order execute without any CCXT credentials → named refusal (the string from `ccxtOrdering.mjs:157` or a gate deny) — the E2E asserts a refusal, never an `ok`; audit rows landed on disk under the isolated dir and `verifyAudit()` over them is `{ok:true,...}`.
- R3.2 `e2e/autopilot-surface.spec.ts`: `/suites/trading/autopilot` renders (`data-room="autopilot"`), empty-decisions honesty text visible (`AutopilotRoom.tsx:160`), no console errors.
- R3.3 E2E never touches real `server/data`, never configures CCXT vars (so no live-trade path exists by construction) and never asserts a fabricated pass (ADR-0005).

### R4 — Cross-tab lock (D4) — T2
- R4.1 `src/lib/dangerousActionLock.ts`: acquires `navigator.locks.request("picc:action:<name>", {timeout:8000})`; deny strings verbatim: `suite:deny:lock-held (another tab holds the <action> lock — wait or close the other tab)`, `suite:deny:lock-unavailable`.
- R4.2 Wrapped call sites: kill-switch POST (global + site toggles in `CommandCentrePanel.tsx:232-236` family), command-centre execute-consent POST, autopilot config save (arm/disarm/settings inside the extracted `AutopilotSuite.tsx`).
- R4.3 Lock acquisition failure → UI surfaces the verbatim deny reason; the underlying POST is never sent; a second attempt may retry.
- R4.4 Existing client tests updated with a `navigator.locks` stub (see T2) — floor stays green.

### R5 — Startup validation (D5) — T3
- R5.1 `startupHealth.mjs` runs at boot (imported from `index.mjs`) and exports the check list builder + a single build/audit entry.
- R5.2 `GET /api/command-centre/startup-health` (auth, `writeJson` mirror of the WS-4 `leader-ideas` route shape `handlers.mjs` family) returns `{ ok, at, checks, generatedAt }`; deny strings verbatim (D5 list); token values never echoed (masked).
- R5.3 `ok: false` iff an error-severity check fails; warnings never flip `ok`.
- R5.4 One `audit:startup-health` entry per boot; `appendAudit` used as-is (no modification to `auditTrail.mjs`).

### R6 — Expiry policy (D6) — T3
- R6.1 EO token older than `PICC_CRED_EXPIRY_DAYS_EXPERTOPTION` (default 30) → error `suite:deny:credential-expired (…)`; missing capturedAt → warning `suite:deny:credential-capture-date-missing (…)`; absent var → check skipped, no deny invented.
- R6.2 Rotation record = existing capturedAt; no storefile changes; execution-leg behavior unchanged (`liveEO.mjs:685-699`, `ccxtOrdering.mjs:157` byte-identical).
- R6.3 `.env.example` documents the new var (T3 owns the file).

### R7 — Venue recon-only (D7) — T3/T5
- R7.1 No venue adapter, capture profile, or rail file is modified by WS-5 (T6 asserts a file-touch whitelist).
- R7.2 Runbook documents current venue status (EO demo-locked + expiry policy; iqoption capture-only/unverified; HL sandbox-gated; ADR 0006+ pending) with the §0.10 references.

### R8 — Additive contract & deny corpus (D1–D8) — T6
- R8.1 Every pre-existing deny/reason string listed in §0.8 + the WS-4 `leader:*` corpus is still emitted by its module (T6 regression list).
- R8.2 New strings are all `suite:deny:*` / `audit:startup-health`; nothing absent reads as a pass (T6 structural guard).
- R8.3 Floor: serial vitest in `apps/dashboard` green (`npm test`, `--maxWorkers=1`), root `npm run typecheck` green, `verifyAudit()` green, seam-guard test green.

---

## §4 Design

### 4.1 Extraction seam (R1)
Mechanical cut: relocate `TradingSuite.tsx:292-876` body + its private helpers into `src/components/AutopilotSuite.tsx`; leave a re-export in its place. The guard-rule that prevents circular imports (R1.2) is checked by the T6 seam guard (grep: no `TradingSuite` import inside the new file). Behavior parity is proven by ministryRooms (existing) + `autopilot-surface.spec.ts` (new) + deeplink/useCandleData (existing, exercising only MarketsSuite — untouched).

### 4.2 Lock (R4)
`withActionLock(name, fn)` lives in `src/lib/dangerousActionLock.ts`. The three wrapped call sites are the only mutations to existing client components. jsdom reality: tests install a 20-line `navigator.locks` stub (acquire → run → release; timeout; and unavailable paths) via `Object.defineProperty(navigator, "locks", …)` in the test file; the "unavailable" unit test asserts the verbatim `suite:deny:lock-unavailable` and that `fetch` was never called (spy). This keeps real-browser semantics everywhere and denies explicitly in tests.

### 4.3 Startup health (R5/R6)
`startupHealth.mjs` follows the store module conventions of `ceremonyState.mjs` (`version:1`, boot run, no self-wiring beyond its own single audit append). Boot import sits beside `index.mjs:11-12` — additive two-line edit. Route mirrors the WS-4 readout `writeJson` shape. Test fixtures redirect `PICC_TRADING_DATA_DIR`/`PICC_AUTOMATOR_DATA_DIR` to tmp (the established pattern: `ccxtOrdering.test.mjs:91`, `captureVenue.test.mjs:119`).

### 4.4 E2E (R2/R3)
Structure: `playwright.config.ts` → `webServer` (vite dev, isolated env) → `e2e/helpers/isolatedEnv.mjs` (mints tmp root, the 20-var map incl. the two file-scoped vars, `PICC_VAULT_KEY`, `PICC_ERROR_LOG=0`, asserts containment) → specs. Selectors prefer deterministic hooks already present (`data-room`, `aria-label="global kill switch"`, `data-panel`); new `data-testid`s are allowed only inside the two spec files' own surface interactions (T1), and must be additive.

### 4.5 Docs (D8)
New runbook documents: readout anatomy + severities, expiry/rotation policy, lock semantics, E2E run + isolation contract, "13 screens" mapping (D2). Pointer line in the HL runbook. PICC.md registry rows.

---

## §5 Acceptance criteria

### AC-1 (R1.1–R1.4) — extraction
- AC-1a `TradingSuite.tsx` contains `export { AutopilotSuite } from "./AutopilotSuite"` and no longer contains the AutopilotSuite body (guard asserts the re-export exists + body-size marker removed).
- AC-1b `AutopilotSuite.tsx` has zero imports resolving into TradingSuite.tsx or the sibling cards (guard grep).
- AC-1c `AutopilotRoom.tsx` renders from the new module; `autopilot` room + `data-room="autopilot"` unchanged.
- AC-1d The three floor tests pass with zero edits: `TradingSuite.deeplink.test.tsx`, `useCandleData.render.test.tsx`, `ministryRooms.test.tsx`.

### AC-2 (R2.1–R2.3) — harness
- AC-2a `npm run test:e2e --workspace @picc/dashboard` boots vite, runs both specs, exits 0; rerun after `rm -rf .playwright-tmp` still green (fresh-run determinism).
- AC-2b Isolation assertion fails the run if any override resolves outside the tmp root (negative test in the spec suite).
- AC-2c `git diff apps/dashboard/package.json` shows only the devDep + script; `npm ls --depth=0` shows no other additions.

### AC-3 (R3.1–R3.3) — e2e specs
- AC-3a Order-flow spec: every assertion in R3.1 passes with a fresh user + fresh tmp; kill-switch toggle changes the risk strip to halted; the credential-less execute returns a named refusal (string contains "credentials configured" or a gate deny), never `ok`.
- AC-3b Autopilot spec: render + honest empty-state + zero console errors.
- AC-3c Post-run: `git status` shows no writes under `apps/dashboard/server/data` (the real dir) — verified by the workflow, not assumed.

### AC-4 (R4.1–R4.4) — lock
- AC-4a Unit tests (stubbed locks): success-holds-runs-releases; held/8s → throw `suite:deny:lock-held (…)` verbatim; unavailable → throw `suite:deny:lock-unavailable` verbatim; denied path never calls `fetch` (spy); auto-release on "tab close" simulated.
- AC-4b `CommandCentrePanel.test.tsx` green with the stub installed; existing kill-toggle tests unchanged in intent.
- AC-4c Manual matrix (documented in runbook): two real tabs → second tab's kill-switch toggle shows the held deny; closing the holder tab releases (retry succeeds).

### AC-5 (R5.1–R5.4) — startup validation
- AC-5a Fixture cases (tmp dirs, env-fixture pattern of `ccxtOrdering.test.mjs:69-75,91`): corrupt vault store → `suite:deny:credential-store-unreadable (<file>)`; expired token (capturedAt 41d ago, TTL 30) → `suite:deny:credential-expired (expertoption, age 41 days exceeds 30)`; token with no capturedAt → warning `…capture-date-missing…`; half-set HYPERLIQUID pair (WALLETADDRESS set, PRIVATEKEY absent) → `suite:deny:credential-pair-incomplete (HYPERLIQUID: PICC_CCXT_PRIVATEKEY_HYPERLIQUID)`; no pair at all → readout reuses the `ccxt ordering seam: no … credentials configured …` refusal verbatim; sandbox+mainnet both off → `perps-rail-off: …` verbatim.
- AC-5b `GET /api/command-centre/startup-health` (authed) returns the shape; token values masked `****` (assert the raw token never appears in the response); unauthenticated → 401.
- AC-5c `ok:false` iff an error check exists; one `audit:startup-health` row per boot; `verifyAudit()` green afterwards.

### AC-6 (R6.1–R6.3) — expiry
- AC-6a Skip semantics: no `PICC_CRED_EXPIRY_DAYS_EXPERTOPTION` → check skipped, `ok` unaffected (no invented deny).
- AC-6b `.env.example` documents the var (T3-only edit); runbook §"Credentials, rotation, expiry" describes the policy.

### AC-7 (R7.1–R7.2) — venue recon-only
- AC-7a T6 whitelist proves zero edits to `services/venues/*`, `captureProfiles.mjs`, `expertoption.mjs`, `liveEO.mjs`, `ccxtOrdering.mjs`, `policyGraphCatalog.mjs`, `venueAdapterContract.mjs`.
- AC-7b Runbook venue-status section cites `captureProfiles.mjs:55-91+`, `expertoption.mjs:8-10,22`, `hyperliquidPerps.mjs:105-106,546-549`.

### AC-8 (R8.1–R8.3) — additive contract + floor
- AC-8a Seam guard asserts the §0.8 deny corpus + WS-4 `leader:*` corpus are all still emitted (verbatim contains-check).
- AC-8b Seam guard asserts `suite:deny:*` appears only in WS-5-introduced strings and `audit:startup-health` in the health module.
- AC-8c Final: serial vitest green in `apps/dashboard` (≥ WS-4's 278-file / 3102-passed baseline, + the new test files), root typecheck green, `verifyAudit()` green `{ok:true,brokenAt:null,reason:null}`, seam guard green, `test:e2e` green.

---

## §6 Implementation tasks + bisect matrix

Owners: **A** = server author (startup health + seam guard) · **B** = client author (extraction + lock) · **C** = QA/docs author (harness + specs + runbook). **Zero cross-owner file sharing** in any task.

| File (new = F, modified = M) | Owner | T0 | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|---|---|
| F1 `server/services/commandCentre/startupHealth.mjs` | A | | | | ✓ | | | |
| F2 `server/__tests__/startupHealth.test.mjs` | A | | | | ✓ | | | |
| M1 `server/index.mjs` | A | | | | ✓ | | | |
| M2 `server/handlers.mjs` | A | | | | ✓ | | | |
| M3 `apps/dashboard/.env.example` | A | | | | ✓ | | | |
| F10 `server/__tests__/ws5SeamGuard.test.mjs` | A | | | | | | | ✓ |
| F3 `src/components/AutopilotSuite.tsx` | B | | | ✓ (edit) | | ✓ (create) | | |
| M4 `src/components/TradingSuite.tsx` | B | | | | | ✓ | | |
| M5 `src/pages/ministry/AutopilotRoom.tsx` | B | | | | | ✓ | | |
| F4 `src/lib/dangerousActionLock.ts` | B | | | ✓ | | | | |
| M6 `src/components/CommandCentrePanel.tsx` | B | | | ✓ | | | | |
| M7 `src/components/__tests__/CommandCentrePanel.test.tsx` | B | | | ✓ | | | | |
| F5 `src/components/__tests__/dangerousActionLock.test.ts` | B | | | ✓ | | | | |
| M8 `apps/dashboard/package.json` | C | ✓ | | | | | | |
| F6 `apps/dashboard/playwright.config.ts` | C | ✓ | | | | | | |
| F7 `apps/dashboard/e2e/helpers/isolatedEnv.mjs` | C | ✓ | | | | | | |
| F8 `apps/dashboard/e2e/command-centre-order-flow.spec.ts` | C | | ✓ | | | | | |
| F9 `apps/dashboard/e2e/autopilot-surface.spec.ts` | C | | ✓ | | | | | |
| F11 `docs/runbooks/PICC_OPERABILITY_RUNBOOK.md` | C | | | | | | ✓ | |
| M9 `docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md` | C | | | | | | ✓ | |
| M10 `PICC.md` | C | | | | | | ✓ | |

Ordering edges (task → must-precede): **T4 → T2** (F3 created before F3 edited — B-internal); **T0 → T1** (specs need the harness — C-internal); **T3 → T5** (runbook documents the readout — A→C); **T0 → T5** (runbook documents the harness — C-internal); **T6 → all of F1–F10 + M1–M8** (guard is the last thing in). B can start T2 immediately after T4; A's T3 and B's T4 and C's T0 are mutually independent first moves.

### T0 — Playwright harness (C) — R2 — AC-2
Add `@playwright/test` ^1.49.x devDependency + `"test:e2e": "playwright test"` script (`apps/dashboard/package.json`); `playwright.config.ts` (webServer = `npm run dev`, full §0.6 env isolation, testDir `e2e/`, workers 1, baseURL `http://127.0.0.1:5173`); `e2e/helpers/isolatedEnv.mjs` (tmp root + the 16 dir vars + 2 file-scoped vars + `PICC_VAULT_KEY` mint + `PICC_ERROR_LOG=0` + containment assertions — 20 vars total). Add companion `.gitignore` entry for `.playwright-tmp/` (M8-adjacent, C-owned). AC-2a/b/c.

### T1 — E2E specs (C) — R3 — AC-3
`command-centre-order-flow.spec.ts` + `autopilot-surface.spec.ts` per §4.4 with the exact assertions of AC-3a/b/c. No new `data-testid`s outside these files. AC-3a/b/c.

### T2 — Cross-tab lock (B) — R4 — AC-4
`src/lib/dangerousActionLock.ts` (acquire → run → release; 8s timeout; deny throws verbatim; no storage-event fallback); wrap kill-switch POSTs + execute-consent POST in `CommandCentrePanel.tsx` and the autopilot save in `AutopilotSuite.tsx` (post-T4 file); update `CommandCentrePanel.test.tsx` with the `navigator.locks` stub; new `dangerousActionLock.test.ts` covering success/held/unavailable/auto-release/no-fetch-on-deny. AC-4a/b/c.

### T3 — Startup validation + expiry (A) — R5/R6 — AC-5/AC-6
`startupHealth.mjs` (checks 1–4 of D5 + audit append, severity model, masked echo); import + boot run in `index.mjs` (beside `:11-12`); `GET /api/command-centre/startup-health` in `handlers.mjs` (auth, writeJson shape); `.env.example` documents `PICC_CRED_EXPIRY_DAYS_EXPERTOPTION`; fixtures in tmp dirs (expired/missing/corrupt/half-pair/no-pair/rail-off). AC-5a/b/c, AC-6a/b. Never modify `auditTrail.mjs`, `ccxtOrdering.mjs`, `liveEO.mjs`, `trading.mjs` — read-only consumers.

### T4 — AutopilotSuite extraction (B) — R1 — AC-1
Cut `TradingSuite.tsx:292-876` + private helpers into `src/components/AutopilotSuite.tsx` (imports only from `@/lib`, `@/hooks`, `@/components/ui`, `react`); replace the body in TradingSuite.tsx with a re-export; update `AutopilotRoom.tsx:2` import. AC-1a/b/c/d.

### T5 — Docs (C) — D8, R7.2 — AC-7b
`PICC_OPERABILITY_RUNBOOK.md` (render runbook per §4.5); cross-pointer line in `HYPERLIQUID_CONNECT_RUNBOOK.md`; PICC.md registry rows. AC-7b.

### T6 — Seam guard + final floor (A) — R8 — AC-8
`ws5SeamGuard.test.mjs`: deny-corpus regression (AC-8a), `suite:deny:*` + `audit:startup-health` scoping (AC-8b), structural guards (AutopilotSuite no-TradingSuite-import; TradingSuite re-export present; no `Route`/navigator additions to the flat stack — MarketsSuite still mounts all 12 exports + AssistantCard; venue-file whitelist AC-7a; package.json diff AC-2c). Run the final serial floor + typecheck + `verifyAudit()` + `test:e2e` and record results in the §9 block. AC-8c.

---

## §7 Risks

1. **Most likely to bite — the lock breaks existing client tests.** `CommandCentrePanel.test.tsx` exercises kill-toggle POSTs; without a `navigator.locks` stub every click would throw `suite:deny:lock-unavailable` and the floor goes red. Guard: T2 installs the stub in the same commit that wraps the call sites; AC-4b pins the existing tests green *with* the wrap; the "unavailable" case is tested explicitly with a no-fetch spy (so the deny behavior is proven, not papered over).
2. **Circular import trap in the extraction.** `AutopilotSuite.tsx` importing helpers back from `TradingSuite.tsx` (which re-exports it) is a hard cycle. Guard: R1.2 import whitelist + AC-1b structural grep in the seam guard; the extraction task must hoist or copy private helpers rather than import them.
3. **E2E isolation leak.** A missed `PICC_*` var writes to real `server/data` during what looks like a test run. Guard: the §0.6 list is complete (verified), the webServer command asserts containment at boot (AC-2b), and AC-3c checks `git status` for real-dir writes after the run.
4. **Startup validation misread as a new gate.** The readout reports + audited but changes nothing at execute time; an operator could expect it to block expired tokens. Guard: D5/D6 text + AC-5a/6a pin that rails behave byte-identically; runbook states the readout is advisory, the rails are the authority.
5. **Severity drift (error vs warning).** `ok:false` on an expired EO token is a product call; if the operator wants execute-time teeth that's D6 variant B (out of scope, would touch the WS-2 rail). Guard: AC-5a/6a pin the mapping; §2 records the variant explicitly for owner ratification.
6. **The "13 screens" claim keeps being read as routes.** A future reviewer may resurrect plan.md `:66` as a routing mandate. Guard: D2 pins the reading, the runbook documents it, and AC-8b's structural guard proves the stack is still one route.
7. **Playwright browser download in CI/offline.** `test:e2e` requires a Chromium install (`npx playwright install chromium`). Guard: documented in the runbook + the `test:e2e` script stays local-first; CI adoption remains a later follow-up (not in T0).

---

## §8 Honesty notes

1. **"13 screens" is a plan.md claim that does not survive source inspection.** The truthful mapping (12 named exports + internal AssistantCard in one stacked route, §0.1) is what WS-5 ships and documents — no navigation surface is invented to make the claim true.
2. **Startup validation adds no enforcement.** Every check is read-only and advisory; the execution-leg failures it predicts already exist (`liveEO.mjs:685-699`, `ccxtOrdering.mjs:157`) and stay byte-identical. WS-5 never claims to have "fixed" credential expiry — it reports it.
3. **The cross-tab lock narrows the client race window; it is not a server rail.** Two tabs that both POST before lock release can still race; WS-2 idempotency/audit remains the authority. The spec says so (D4) rather than overclaiming.
4. **E2E asserts failures, not successes.** With no CCXT credentials configured, the order-flow spec proves the *refusal* surface and never a live trade — the honest guarantee in a credential-less run.
5. **No credentials, tokens, wallets, or account numbers appear in this spec.** Values are cited by line, never copied; E2E mints its own `PICC_VAULT_KEY` per run; fixtures use the repo's established placeholder pattern (`ccxtOrdering.test.mjs:69-75`).
6. **Line-count discrepancy noted** (2,098 PowerShell vs 2,208 Read-EOF) — the file's signature is 96,044 bytes; all structural claims use anchors (exports/line positions) verified this session.
7. **WS-3/WS-4 spec headers cited as format precedent were read by the planning agent this session** (WS-4 §0-§2 and §6-§9 verified directly; WS-3 store/gate/route/resolution conventions per the WS-4 reference list).
8. **R1.2's import whitelist is narrower than its own guard, and the extracted body needed five more modules than the whitelist lists.** The extracted `AutopilotSuite` body references `ReadinessPanel`, `IOSInstallBanner`, `SignalWindowChip`, `TradingChart` (each its own module — no path back to `TradingSuite`) and `Link` (`react-router-dom`). All five are imported **directly**, which satisfies AC-1b (the machine-checked criterion T6 enforces: zero imports resolving into `TradingSuite.tsx` or the sibling cards) and R1.2's stated purpose ("no circular import is possible"). Only `SignalNotificationsCard` is *defined inside* `TradingSuite.tsx:278`, so it is the single collaborator injected as a prop from `AutopilotRoom` — the one genuine cycle edge. A first implementation injected all six as props to satisfy the whitelist literally; that was rejected because it made the module non-self-contained and turned the AC-1a re-export into a trap. The deviation from R1.2's literal four-item list is recorded here rather than silently taken.
9. **`@playwright/test` resolves to 1.63.0, not 1.49.x.** `^1.49.1` is a caret range, so 1.63.0 is in-spec (D3/§1 pin the *range*). Adding it forces one transitive consequence: `playwright@1.63.0` hard-depends on `playwright-core@1.63.0`, and npm hoists a single `playwright-core`, so the existing `^1.49.1` declaration (a production dependency, not dev — §0.4 called it a devDependency; the lockfile shows otherwise) moves 1.49.1 → 1.63.0. `package-lock.json` also carried dead `@supabase/*` / `iceberg-js` / `tslib` entries that a plain `npm install --package-lock-only` prunes; those were **excluded** from this workstream's diff to keep it scoped, and remain a separate cleanup.
10. **The T0 `baseURL http://127.0.0.1:5173` does not work in this repo, and is corrected to `localhost`.** `vite.config.ts:112-114` sets `port: 5173, strictPort: true` with no `host`, so Vite binds `localhost` (IPv6 `::1` on Windows). Verified empirically, not assumed: `http://127.0.0.1:5173/` returns connection-refused while `http://localhost:5173/` returns 200. The first `npm run test:e2e` run failed before any test with `Timed out waiting 60000ms from config.webServer` / `ECONNREFUSED`. The harness now uses `http://localhost:5173`; shared `vite.config.ts` is deliberately untouched (it is in no task's file list). AC-2a/AC-3a remain satisfied — both specs pass, including a fresh run after `rm -rf .playwright-tmp`.
11. **AC-3a's "kill-switch toggle changes the risk strip to halted" is factually wrong about this product, and the assertion was corrected rather than forced.** The aggregate risk strip's halt cell (`CommandCentrePanel.tsx:390`) reads `risk.halted`, which is the **WS-2 risk-engine trip** (day-loss / drawdown / heat) — a different control from the **global kill switch**. Toggling the kill switch does not and cannot set it in a credential-less run, so the ratified expectation encoded a product assumption that source inspection contradicts (the same class of error as honesty note 1). The e2e now asserts the kill switch's real, observable effects: `aria-checked="true"` on the switch, the "GLOBAL KILL ACTIVE — every site below is BLOCKED until the human rearms" banner, and the subsequent propose returning `blockedBy === "kill-switch"`. **This is a correction to a ratified acceptance criterion and is flagged for owner review**, not a silent pass.
12. **AC-8b's "MarketsSuite still mounts all 12 exports + AssistantCard" is also factually wrong, and the seam guard was corrected to compare against the baseline.** `WatchlistScannerCard` and `PaperAnalyticsCard` are exported from `TradingSuite.tsx` but are **never mounted** — verified with `git show d400c70:apps/dashboard/src/components/TradingSuite.tsx`, where both appear only as `export function` declarations, exactly as they do now. The claim therefore never held, before or after WS-5, and asserting it would be unsatisfiable at the baseline too. The guard now pins what WS-5 actually owes: the **export surface is intact** (all 12 named exports + the `AutopilotSuite` re-export) and the **set of mounted cards is identical to the pre-WS-5 baseline**. This is the third instance of the note-1 pattern and is flagged for owner review.
13. **`npm run test:e2e` and `npx vitest run` both glob `**/*.spec.ts`, so the e2e specs were being collected by Vitest.** There is deliberately no `vitest.config.ts` (the `@` alias lives in `vite.config.ts`), so Vitest read the default include glob and swept up the two Playwright specs, failing the serial floor on a harness mismatch. `vite.config.ts` now carries `test.exclude = [...configDefaults.exclude, "**/e2e/**"]`. The dev server is unaffected; `vite.config.ts` is in no task's file list, so this is recorded as an executor-level integration fix.

---

## §9 Resolution (owner sign-off)

**Ratified 2026-09-24.** Owner ratified D1–D8 (§2) as written, with no amendments. **Status → ACTIVE**; T0–T6 execute per the §6 bisect matrix (owners A/B/C; ordering edges T4→T2, T0→T1, T3→T5, T0→T5, T6 after all of F1–F10 + M1–M8). The mutually independent first moves are A-T3, B-T4, and C-T0. T6 records the final verification results in the block below.

**Ship gate (T6 records observed results here):**
- Serial vitest in `apps/dashboard` green (≥ 278 files / ≥ 3102 passed baseline + new test files).
- Root `npm run typecheck` green.
- `verifyAudit()` → `{ok:true, brokenAt:null, reason:null}`.
- `npm run test:e2e --workspace @picc/dashboard` green; no writes under `server/data`.
- Seam guard green (AC-8a/b/c).
- D1–D8 ratified; PICC.md registry updated; runbook reflects reality.
- T6 first pass 2026-09-24 (RED, superseded): `npx vitest run --maxWorkers=1` = 280 files passed / **3 failed suites** / 1 skipped (284); 3129 passed / 1 failed / 1 skipped (3131). Failures: Vitest collecting both Playwright specs, plus the guard's missing `WatchlistScannerCard` / `PaperAnalyticsCard` mounts. `npm run typecheck` = exit 0. `verifyAudit()` = `{"ok":true,"brokenAt":null,"reason:null}`. `npm run test:e2e --workspace @picc/dashboard` = 2 passed (12.2s). Guard = 10 passed / 1 failed of 11.
- T6 diagnosis: both failures were **bad assertions/harness wiring, not product regressions**. (a) Vitest's default `**/*.spec.ts` glob swept up the Playwright specs, fixed by `vite.config.ts` `test.exclude` (honesty note 13). (b) `WatchlistScannerCard` / `PaperAnalyticsCard` are exported but were never mounted, at baseline `d400c70` or now, so the "all 12 exports mounted" assertion was unsatisfiable even at baseline; the guard now pins export-surface integrity + a baseline-equal mounted set (honesty note 12). The guard's falsifiability was proved by injecting a `useLocation` import into `AutopilotSuite.tsx` and observing the guard fail, then restoring the file byte-identical.
- **T6 final observed 2026-09-24 (GREEN):** (1) `npx vitest run --maxWorkers=1` = **281 files passed / 1 skipped (282); 3130 tests passed / 1 skipped (3131)** — above the 278/3102 WS-4 baseline; 227s. (2) `npm run typecheck` = **exit 0**. (3) `verifyAudit()` = **`{"ok":true,"brokenAt":null,"reason:null}`**. (4) `npm run test:e2e --workspace @picc/dashboard` = **2 passed**, including a fresh run after `rm -rf .playwright-tmp` (AC-2a) and **no writes under `apps/dashboard/server/data`** (AC-3c). (5) `npx vitest run server/__tests__/ws5SeamGuard.test.mjs --maxWorkers=1` = **11 passed**.
- **Still UNVERIFIED at ship-gate time:** AC-4c's manual two-real-tab lock matrix (real-browser only; documented in the runbook, not automated), and T3's full production-server boot (the readout is covered by module + route tests, not a live boot).

**Status (final, set at ship):** (owner to set after the ship gate is observed green) — until then this workstream is ACTIVE but unshipped.