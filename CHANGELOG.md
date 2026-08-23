# Changelog

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
