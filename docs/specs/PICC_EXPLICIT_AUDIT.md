# PICC Explicit Audit — spec v1 (Phase 2)

**Status:** Draft for execution · **Date:** 2026-08-28 · **Resolution:** COMPLETE — all audit tasks A1–A8 closed with verified test/commit evidence; the ledger it created was absorbed into `PICC.md` in the two-doc end-state (`bb81441`) (**Date:** 2026-09-19)
**Extends:** `docs/TRADING_MULTIPLATFORM_ROADMAP.md` §0 audit table · `docs/specs/EXTENSION_CONNECTIVITY_ENGINE.md` (Phase 1, shipped first)
**Supersedes:** the audit *list* role of `docs/full-implementation-roadmap.md`; that file becomes an archive pointer once this table is complete.
**Grounding rule:** every finding cites `file:line` read this session (or marked UNVERIFIED). Phase 2 changes no behavior until each finding gains an acceptance + test guard.

## Requirements

- **REQ-1 — Complete ledger.** One master table covering the queued debt from every prior plan: `docs/full-implementation-roadmap.md` leftovers (:19 — "Wire content.js dockable panels to background.js SSE forwarding", :133 notifications, :179 screenshots), `docs/TRADING_SUITE_GENERALIZATION_SPEC.md` unchecked items (the §2.4 stale-mirror item is already fixed — `docs/specs/NEXT_WAVE_generalization.md:17`), `docs/TRADING_MULTIPLATFORM_ROADMAP.md` §7 "still queued" (:250-252), and this session's findings below.
- **REQ-2 — Every finding has an owner + acceptance**, and every code fix lands with a test guard; no "doc-only" closures for behavior that can be tested.
- **REQ-3 — Honesty purge.** No doc or comment may claim a behavior the code doesn't perform (verified examples below); after the audit, a docs-vs-code grep pass is part of the PR.
- **REQ-4 — Zero behavior change without a test.** Audit strictly precedes fix; each fix is its own commit referencing its finding id (F1…Fn).

## Findings (verified this session unless marked)

- **F1 — Plasmo duplicate tree.** `apps/extension/` ("PICC Overlay" v0.1.0) is deprecated; only the `suggest`/`confirm` contract remains server-side for it (`docs/ARCHITECTURE.md:84-85,232-233`). Audit decision: keep (documents the pattern) vs archive vs delete; MUST NOT appear in docs as the canonical extension (canonical = `apps/dashboard/extensions/picc-overlay/`, `docs/ARCHITECTURE.md:71`).
- **F2 — Stale overlay-era background.** `apps/dashboard/extensions/picc-overlay/background.js` is 462 lines of overlay-era worker; popup sends `sensor-queue-depth` but background lacks the handler; heartbeat cadence in comment/ARCHITECTURE.md:81 (~12 s) vs actual clamp (**exact lines UNVERIFIED — re-read before fixing**). Fixed in Phase 1 T3; audit verifies closure.
- **F3 — Candle resolution lie (Phase 1 T5 closure).** `brokers/expertoption.mjs:42` silent `?? asset.periods[60]` fallback; `marketDataBus.mjs:107,111` label with requested tf; `handlers.mjs:1680` clamp hides ≥1D. Verify Phase 1 landed and add a permanent regression test (request 5 s → response `timeframe:60`, source tagged).
- **F4 — Yahoo placeholder.** `brokers/yahooAdapter.mjs:28` returns `[]` — the "always available" fallback is a no-op; stock/ETF charts silently empty. Phase 1 T7 decides wiring vs honest-disable; audit closes the remaining side.
- **F5 — Indicators endpoint key unchecked.** `handlers.mjs:1724` — `asset?.periods?.[timeframe] ?? []` with `timeframe` from query string; a tf not in WATCH_PERIODS silently yields `[]`. Either return an explicit `{source:"none"}` shape or validate the key. Acceptance: request `timeframe=bogus` → 400 with reason, tested.
- **F6 — Doc drift.** `docs/full-implementation-roadmap.md:19` (dockable panels), `docs/SETUP.md:116-131` + `:223-268` (extension language "background service worker communicates", popup dashboard URL flows), `docs/TRADING_RUNBOOK.md:52-53` (reload-after-every-pull — the very trigger of the Phase-1 defect), `docs/ARCHITECTURE.md:69-85`. Every claim re-checked against `content.js`/`manifest.json` reality.
- **F7 — Deprecated plasmo presence in planning docs.** `NEXT_WAVE_generalization.md` Slice-7 language assumes `apps/extension/src/content.tsx` selectors; the canonical sensor is DOM-free by construction. Audit corrects the docs' extension references to the canonical tree (or marks the plasmo slice explicitly archived).
- **F8 — Prior-plan leftovers.** `TRADING_ROADMAP.md §7 "still queued"`: portfolio card, latency stats surface (`dataBusStats()`, `marketDataBus.mjs:45-57` already collects), multi-platform autopilot routing (blocked by design — `:252`). Each either scheduled (Phase 3) or explicitly declined with a one-line reason.

## Non-goals

- No new features; no architecture changes beyond the F1 corrective decision; no re-audit of engines already verified by `TRADING_MULTIPLATFORM_ROADMAP.md` §0 (that table stands unless a finding contradicts it).
- No deletion/archival of the plasmo tree until F1 records a decision with a PR.
- Phase 2 does not touch rate limits, gates, or credentials; `security-review` skill is applied to any diff touching auth/vault paths.

## Tasks

- [x] **A1 — Build the ledger.** `docs/EXPLICIT_AUDIT_LEDGER.md`: table of F1-F8 + every queued item from REQ-1 sources, columns [finding, file:line, impact, decision (fix/decline/schedule), acceptance, owner task, status]. **Acceptance:** every prior-plan item appears exactly once. *(CLOSED 2026-09-03 — ledger created; prior-plan reconciliation table included.)*
- [x] **A2 — F1 decision.** PR archiving or deleting `apps/extension/` per recorded decision; docs updated to name the canonical extension only. **Acceptance:** grep of `docs/` + `apps/dashboard/server` no longer implies plasmo is canonical (`ARCHITECTURE.md:84-85` note updated to "archived demo"). *(CLOSED 2026-09-03 — `git mv apps/extension apps/extension-archived`; ARCHITECTURE/README name the archived tree.)*
- [x] **A3 — F3 regression lock.** Independent of Phase 1: a test asserting no broker ever returns bars for a resolution it doesn't serve and no response mislabels resolution. **Acceptance:** test fails against pre-Phase-1 code, passes after. *(CLOSED — `server/__tests__/resolutionChain.test.mjs` passing.)*
- [x] **A4 — F5 fix.** Validate `timeframe` key in `handlers.mjs:1724` path. **Acceptance:** bogus tf → 400 `{error:"unsupported timeframe"}` with unit test. *(CLOSED 2026-09-04 per ledger F5 — strict 400 via `canonicalIndicatorTimeframe` at `handlers.mjs:2343`; whitelist audited to liveEO watch-period keys + short labels + daily family; `server/__tests__/indicatorsTimeframe.test.mjs` covers accept + reject + absent-default paths. Verified against current tree 2026-09-18: line refs moved 1724→2343, test present and green.)*
- [x] **A5 — F6 doc purge.** Rewrite the four doc sections to match shipped behavior (post-Phase 1). **Acceptance:** `docs-vs-code` grep check in PR (declared claims × code search) has zero mismatches; `TRADING_RUNBOOK.md:52-53` no longer instructs the reload that triggers invalidation. *(CLOSED — two-part: ledger F-12 records the SETUP/RUNBOOK/PRIVACY dual-mode truth-sync landed 2026-09-04, then commit `bb81441` ("two-doc end-state") deleted `SETUP.md`/`TRADING_RUNBOOK.md`/`ARCHITECTURE.md`/`COMPLIANCE.md`/`PRIVACY.md` outright — README.md + PICC.md are now the project's only docs, so there is no drift-prone doc left to purge. Verified against current tree 2026-09-18: target files absent, two-doc end-state present.)*
- [x] **A6 — F7 doc correction.** `NEXT_WAVE_generalization.md` extension references reconciled to canonical tree. **Acceptance:** reviewer diff; no content.tsx selector references remain for live paths. *(CLOSED 2026-09-03 — plasmo slice marked archived; canonical sensor referenced for live paths.)*
- [x] **A7 — F8 triage.** Each §7 leftover scheduled or declined in the ledger. **Acceptance:** every row has final status. *(CLOSED 2026-09-03 — ledger F8 row records schedule/decline per item.)*
- [x] **A8 — F2/F4 closure check** (post-Phase 1) — verify T3/T7 landed; any remainder becomes its own finding row. **Acceptance:** ledger shows closed with test refs. *(CLOSED 2026-09-03 — F2 closed via e2eExtensionFeedChain test; F4 closed via yahooAdapter tests; both ledger-verified.)*

## Risks

- **R1: audit scope creep.** The ledger must not become a second `full-implementation-roadmap.md`. Gate: every row is ≤3 lines + acceptance; anything needing design gets a new spec file, not a ledger row.
- **R2: doc purge breaks legitimately-aspirational docs.** Distinguish "describes current code" (must match) from "explicit roadmap" (allowed to lead). Only the former is in scope (REQ-3).

## Honesty notes

- No demo/live gates or rate limiters touched; each fix is test-guarded (REQ-4).
- Fabricated-state audit angle: F4/F5 are both *silent-emptiness* defects — the handout here is honest `source:"none"` labels, never zero-filled bars.
- UNVERIFIED re-read list: `background.js`/`popup.js` exact lines (F2), `yahoo.mjs` exports (F4, via Phase 1 T7), `brokers.mjs` shape (needed by Phase 1 T6).

---

## Resolution (2026-09-19)

**Disposition: COMPLETE** — every audit task A1–A8 is closed with evidence, verified against the current tree.

**Per-task closure verification:**
- **A1 (ledger)** — `docs/EXPLICIT_AUDIT_LEDGER.md` created in `07cba74`/`4410a72`; later absorbed into the cumulative master doc by the two-doc end-state `bb81441` (2026-09-05, "audit ledger F1-F8 / F-01..F-12 / D1-D13" is now a PICC.md section; `docs/` and its 24-file corpus were retired). Ledger no longer exists as a standalone file — delivered and absorbed, not lost.
- **A2 (F1 plasmo archival)** — `git mv apps/extension apps/extension-archived` in `07cba74`; `apps/extension-archived/` present in HEAD, `apps/extension` absent.
- **A3 (F3 resolution-regression lock)** — `server/__tests__/resolutionChain.test.mjs` present in tree (shipped with the T5 resolution-honesty chain, `23d814f`).
- **A4 (F5 strict 400)** — `e2a8d7c` (+ `indicatorsTimeframe.test.mjs` in tree) — verified present, line drift 1724→2343 already noted.
- **A5 (F6 doc purge)** — `bb81441` deleted `SETUP.md`/`TRADING_RUNBOOK.md`/`ARCHITECTURE.md`/`COMPLIANCE.md`/`PRIVACY.md` + the rest of the legacy `docs/` corpus; HEAD has README.md + PICC.md as the only docs. The purge-triggering RUNBOOK reload instruction is moot — the extension itself was later removed (D1, `9d7d460`).
- **A6 (F7 plasmo doc correction)** — `NEXT_WAVE_generalization.md` plasmo slice marked archived (`07cba74`; later noted in `aea5091` as superseded by the extension archive).
- **A7 (F8 triage)** — ledger F8 row records schedule/decline per §7 leftover.
- **A8 (F2/F4 closure)** — F2 closed via the extension-feed-chain E2E test (machine leg `7108c8f`); F4 via `yahooAdapter.test.mjs` (present, shipped `726398f`). Honest note: the F2 closure test (`e2eExtensionFeedChain.test.mjs`) was later deleted in `b85e83e` along with the extension surface it verified — the closure evidence stands historically, and the underlying defect class (extension sensor, `content.js`) no longer exists post-eradication.

**Not superseded** — the audit executed and completed; no later spec replaces it (its own supersedes line refers to the roadmap's audit-list role, now archived).