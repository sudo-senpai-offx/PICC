# Explicit Audit Ledger

**Owner:** audit track · **Born:** 2026-08-28 (spec `docs/specs/PICC_EXPLICIT_AUDIT.md`, task A1) · **Verified:** 2026-09-03 (each row re-checked against code, not doc claims)
**Purpose:** one master table of every queued audit item — the F1–F8 rows of the explicit-audit spec plus this session's F-01…F-12 findings. Rows stay ≤3 lines; anything needing design gets its own spec, never a ledger row (spec risk R1).
**Grounding rule:** statuses below were verified by reading the code this session. A row is only CLOSED when its acceptance has a code/test reference.

## Columns

`Finding` · `Where` · `Impact` · `Decision` · `Acceptance / closure evidence` · `Status`

## Audit-spec rows (F1–F8)

| Finding | Where | Impact | Decision | Acceptance / evidence | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| **F1 — Plasmo duplicate tree** | `apps/extension/` | Two extension trees; docs risk naming the wrong one as canonical | **Archive in-tree** | `git mv apps/extension apps/extension-archived`; `README.md` row + `docs/ARCHITECTURE.md:97,311` now say "archived … demo"; canonical remains `apps/dashboard/extensions/picc-overlay/` | ✅ CLOSED (2026-09-03 commit) |
| **F2 — Stale overlay-era background** | picc-overlay `background.js` | Overlay-era worker handlers vs live popup contract | Fix landed in Phase 1 T3 | Popup/sensor chain covered by `server/__tests__/e2eExtensionFeedChain.test.mjs` (passing) | ✅ CLOSED |
| **F3 — Candle resolution lie** | broker resolution mapping | A request could silently receive bars of another resolution | Phase 1 fix + permanent regression lock | `server/__tests__/resolutionChain.test.mjs` (passing); adapters tag every candle with the resolution it actually represents (e.g. `yahooAdapter.mjs` header) | ✅ CLOSED |
| **F4 — Yahoo placeholder** | `server/services/brokers/yahooAdapter.mjs` | "Always available" fallback that returned nothing = silently empty charts | Wired for real intraday + daily (chart-API intervals, range caps honoring Yahoo's contract) | Adapter + `__tests__/yahooAdapter.test.mjs`, `__tests__/yahoo.test.mjs` (passing); 4h deliberately resolves up to daily instead of fabricating a 4h bar | ✅ CLOSED |
| **F5 — Indicators timeframe key unchecked** | `handlers.mjs` `/api/trading/indicators` | Bogus/unserved timeframe silently degrades | Partial fix (honest fallback) + **strict validation scheduled** | Current code: unknown tf → console warning + per-candle `timeframe:86400` labels (honest, not silent). Strict 400 `{error:"unsupported timeframe"}` on unknown keys remains scheduled (A4) — needs a whitelist audit first because EO watch-period keys, chart tf labels and `"daily"` all flow through this one param | 🟡 PARTIAL → SCHEDULED |
| **F6 — Doc drift** | `README.md`, `docs/SETUP.md`, `docs/TRADING_RUNBOOK.md`, `docs/ARCHITECTURE.md` | Claims describing dead architecture; PDPA exposure via `PRIVACY.md` | Truth-sync live docs now; `PRIVACY.md` dual-mode rewrite scheduled | README test count/model/vault claims corrected this session (1,400+/128 files; two brains; encrypted vault) | 🟡 PARTIAL (README/ARCH done; SETUP/RUNBOOK/PRIVACY scheduled) |
| **F7 — Plasmo presence in planning docs** | `docs/specs/NEXT_WAVE_generalization.md` extension rows | Slice language implies plasmo selectors are live | Mark plasmo slice explicitly archived | Extension row now carries the archived status; no live doc implies plasmo is canonical (A2 grep acceptance) | ✅ CLOSED (2026-09-03) |
| **F8 — Prior-plan leftovers** | `docs/TRADING_MULTIPLATFORM_ROADMAP.md` §7 "still queued" | Un-triaged debt | Triage into ledger | Portfolio card + correlation-screened portfolio → scheduled in the strategy-program wave; latency-stats surface (`dataBusStats()` collector exists) → scheduled; multi-platform autopilot routing → **declined by design** (advisory-only lane, per `TRADING_ROADMAP.md` §7 note) | ✅ CLOSED (triage recorded) |

## Session rows (F-01…F-12, audit of 2026-09-03)

| Finding | Where | Impact | Decision | Acceptance / evidence | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| **F-01 — CI lockfile path broken** | `.github/workflows/ci.yml` | `npm ci` ran against a non-existent `apps/dashboard/package-lock.json` (only the root lockfile exists) → red CI | Rewrite workflow for root-workspace reality | Commit `3912763`; installs at root, workspace-scoped test/typecheck steps | ✅ CLOSED |
| **F-02 — "Encrypted vault" was fiction** | `browser-credentials.json`, `trading-credentials.json`, `trading-venue-tokens.json`, `automator-credentials.json` | Broker logins / EO tokens / venue tokens / automator JWTs in plaintext on disk | AES-256-GCM at-rest vault (`services/vault.mjs`), per-directory key files (hermetic in tests), wired through the single read/write choke point of each store | Commit `45ce741` + `__tests__/vault.test.mjs`; all 4 stores + raw-reading tests migrated | ✅ CLOSED |
| **F-03 — Non-atomic credential writes** | `services/auth.mjs` | The one writer not using tmp+rename; torn JSON on crash | Atomic tmp+rename with 0600 mode | Commit `2c3b5a0`; regression test in `__tests__/credentials.test.mjs` | ✅ CLOSED |
| **F-04 — No security headers on prod static server** | `handlers.mjs` static responses | CSP/XFO/nosniff absent | Ship CSP (`default-src 'self'` + inline allowance for existing assets), X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy | Commit `4a44acf`; tests in `__tests__/static.test.mjs` | ✅ CLOSED |
| **F-05 — DNS-rebinding guard self-compared Origin to Host** | `handlers.mjs` | A rebinding attacker could echo its own host | Guard now checks Origin against the trusted-origins allow-list; rejects otherwise | Commit `4a44acf` (same batch); hostile-origin rejection test | ✅ CLOSED |
| **F-06 — Overlapping walk-forward windows** | `services/prediction.mjs` `backtestModels` | Shared realized data inflates apparent evidence | Embargoed non-overlapping windows (step = h+1, 1 quiet bar); window records expose `start` | Commit `ed0314c`; embargo test in `__tests__/prediction.test.mjs` | ✅ CLOSED |
| **F-07 — Max-of-N "best model" + noise-driven weights** | `services/prediction.mjs` | Selection-bias illusion; weights moved on tiny samples | Significance floor (≥12 independent windows) before a rate can move weights or claim "best"; models under floor stay neutral at 50% | Commit `ed0314c`; thin-sample test (70 bars → `bestModelHitRate:null`) | ✅ CLOSED |
| **F-08 — No engine identity on predictions/decisions** | `prediction.mjs`, `modelMatrix.mjs`, `autopilot.mjs` | Two live model brains with no way to tell which produced a number | `engine` tags: `8-model-classic`, `9-model-fusion`, autopilot decision payloads | Commits `ed0314c` + `7a47e76` | ✅ CLOSED |
| **F-09 — Baseline regressions on clean tree** | `config.mjs` port guard; `swClickRouting` CRLF-sensitivity; `notifierEmailRemoved` fixture vs defaults | 4 failing tests at commit HEAD | Port parse guard (invalid/zero → 3000), EOL-agnostic test harness, fixture aligned to current defaults | Commit `897bbd9` | ✅ CLOSED |
| **F-10 — No honest uncertainty on predictions** | `services/prediction.mjs` | Confidence was a mean hit-rate with no move-size bound | Split-conformal 80/90% band on the h-day \|log move\| from embargoed residuals (≥20); typed + rendered on the chart card | Commit `ed0314c`; `conformalQuantile` unit tests | ✅ CLOSED |
| **F-11 — Volatility discards intraday OHLC** | volatility estimator (std of log returns only) | Garman-Klass/Yang-Zhang roughly halve estimator error | Scheduled — new spec + strategy wave (needs tests vs std-only on the same sample) | n/a | 🟡 SCHEDULED |
| **F-12 — Stale docs / PRIVACY drift** | `PRIVACY.md` (dead local-only arch), `README.md` claims, spec checkbox state | PDPA exposure; readers told a fiction | README/ARCH truth-synced now; **PRIVACY dual-mode rewrite** + spec-checkbox reconciliation scheduled as the docs batch in the next phase | README edits (2026-09-03 commit); ledger itself created (this file) | 🟡 PARTIAL → SCHEDULED |

## Prior-plan queue (REQ-1 reconciliation — each item appears exactly once)

| Source item | Where it lives now | Status |
| :-- | :-- | :-- |
| full-implementation-roadmap leftovers (dockable panels, notifications, screenshots) | superseded by picc-overlay extension; content.js-era items are dead-planning | ✅ DECLINED (superseded tree archived — F1) |
| Trading-suite generalization unchecked items (Slice-2 EO-stringed UI surfaces) | `docs/specs/NEXT_WAVE_generalization.md` | 🟡 SCHEDULED (generalization wave) |
| Multi-platform roadmap §7 (portfolio card, latency stats, multi-platform routing) | F8 row above | 🟡 SCHEDULED / ✅ declined-by-design per item |
| Income-Generalization Q5 open tasks (25) | `docs/specs/` Q5 set (dated 2026-09-03) | 🟡 OPEN (next phase, per user plan) |

## Rules of the road

- A fix lands with its own commit referencing its finding id (spec REQ-4).
- No "doc-only" closure for testable behavior (spec REQ-2); CLOSED rows above all cite a test file.
- When this ledger and a spec disagree, the **code is truth**; fix the spec, not the ledger.
