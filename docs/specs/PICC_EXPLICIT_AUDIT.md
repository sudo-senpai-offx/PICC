# PICC Explicit Audit — spec v1 (Phase 2)

**Status:** Draft for execution · **Date:** 2026-08-28
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

- [ ] **A1 — Build the ledger.** `docs/EXPLICIT_AUDIT_LEDGER.md`: table of F1-F8 + every queued item from REQ-1 sources, columns [finding, file:line, impact, decision (fix/decline/schedule), acceptance, owner task, status]. **Acceptance:** every prior-plan item appears exactly once.
- [ ] **A2 — F1 decision.** PR archiving or deleting `apps/extension/` per recorded decision; docs updated to name the canonical extension only. **Acceptance:** grep of `docs/` + `apps/dashboard/server` no longer implies plasmo is canonical (`ARCHITECTURE.md:84-85` note updated to "archived demo").
- [ ] **A3 — F3 regression lock.** Independent of Phase 1: a test asserting no broker ever returns bars for a resolution it doesn't serve and no response mislabels resolution. **Acceptance:** test fails against pre-Phase-1 code, passes after.
- [ ] **A4 — F5 fix.** Validate `timeframe` key in `handlers.mjs:1724` path. **Acceptance:** bogus tf → 400 `{error:"unsupported timeframe"}` with unit test.
- [ ] **A5 — F6 doc purge.** Rewrite the four doc sections to match shipped behavior (post-Phase 1). **Acceptance:** `docs-vs-code` grep check in PR (declared claims × code search) has zero mismatches; `TRADING_RUNBOOK.md:52-53` no longer instructs the reload that triggers invalidation.
- [ ] **A6 — F7 doc correction.** `NEXT_WAVE_generalization.md` extension references reconciled to canonical tree. **Acceptance:** reviewer diff; no content.tsx selector references remain for live paths.
- [ ] **A7 — F8 triage.** Each §7 leftover scheduled or declined in the ledger. **Acceptance:** every row has final status.
- [ ] **A8 — F2/F4 closure check** (post-Phase 1) — verify T3/T7 landed; any remainder becomes its own finding row. **Acceptance:** ledger shows closed with test refs.

## Risks

- **R1: audit scope creep.** The ledger must not become a second `full-implementation-roadmap.md`. Gate: every row is ≤3 lines + acceptance; anything needing design gets a new spec file, not a ledger row.
- **R2: doc purge breaks legitimately-aspirational docs.** Distinguish "describes current code" (must match) from "explicit roadmap" (allowed to lead). Only the former is in scope (REQ-3).

## Honesty notes

- No demo/live gates or rate limiters touched; each fix is test-guarded (REQ-4).
- Fabricated-state audit angle: F4/F5 are both *silent-emptiness* defects — the handout here is honest `source:"none"` labels, never zero-filled bars.
- UNVERIFIED re-read list: `background.js`/`popup.js` exact lines (F2), `yahoo.mjs` exports (F4, via Phase 1 T7), `brokers.mjs` shape (needed by Phase 1 T6).