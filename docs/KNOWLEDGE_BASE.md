# PICC Knowledge Base — Master Index (L0–L5)

**Owner:** KB track · **Born:** 2026-09-03 · **Purpose:** single spine over every knowledge asset in the repo so agents and humans find the highest-evidence answer first. Files named `*-research.md` / `docs/specs/*` are *sources*; this file is the *index* — it never duplicates their content.
**Reader contract:** every entry below is rated. Rating scheme — **E = empirical** (measured on PICC or cited data with methodology), **A = audited** (verified against this repo's code, commit-cited), **R = reviewed** (claims collected, sources cited, not yet reproduced), **S = speculative/aspirational** (flagged, not evidence). When a rating is missing, treat the source as S and fix the rating.

## Layers

| Level | Name | What lives here | Status |
| :-- | :-- | :-- | :-- |
| **L0** | Platform truth | Architecture, security model, honest claims (`docs/ARCHITECTURE.md`, `README.md`, `docs/COMPLIANCE.md`) | ✅ maintained; truth-synced 2026-09-03 |
| **L1** | Defect & debt ledger | `docs/EXPLICIT_AUDIT_LEDGER.md` — every finding with status, every closure with a test ref | ✅ created 2026-09-03 |
| **L2** | Operating knowledge | Runbooks, setup, validation, manual logs (`docs/SETUP.md`, `docs/TRADING_RUNBOOK.md`, `docs/VALIDATION.md`, `docs/T11_E2E_MANUAL_LOG.md`) | 🟡 partially stale — reconciliation scheduled |
| **L3** | Spec & decision memory | `docs/specs/*` — each dated, each with checkbox state; code is truth when they disagree | 🟡 spec-vs-code checkbox reconciliation scheduled (F-12) |
| **L4** | Research corpus | Everything under "Research sources" below, evidence-rated | ✅ indexed here |
| **L5** | Strategy evidence catalog | Per-strategy dossiers: claim → mechanism → evidence → PICC mapping | 🟡 seeds below; full build scheduled with the strategy program |

## Research sources (L4) — index of evidence files

| File | Topic | Rating | Notes |
| :-- | :-- | :-- | :-- |
| `docs/mtf-convergence-research.md` (+ `-a-academic`, `-b-backtests`, `-c-systems`) | Multi-timeframe confluence | R | Academic + backtest + systems triple split; cited |
| `docs/trading-suite-competitor-research.md` | Competitor landscape (execution bots, algory.app, krypt.cc) | R | Marketing claims verified as claims only; product-mechanics patterns extracted |
| `docs/browser-extensions-research.md` | Extension patterns / sensor architectures | R | Feeds picc-overlay design history |
| `docs/headless-capture-venue-research.md` | Headless venue capture | R | Venue-pool decision context (Decision D) |
| *(annex)* strategy dossiers (FVG, liquidity sweep, anchored VWAP, volume profile, order-flow/whale, regime) | Per-strategy evidence | — | Not yet filed — scheduled with the strategy-program wave (see L5 seeds) |

## Strategy evidence catalog (L5) — seeds

Each dossier, when filed, follows: **claim → mechanism → evidence (E/A/R/S with sources) → counter-evidence → PICC mapping (which existing module implements or could test it) → gate (what data would move this from R→E).** Seeds queued from external research (algory.app / krypt.cc verification + quant literature): correlation-screened signal portfolio (PICC already has `correlation.mjs`/`riskParity.mjs`), "edge faded → rotate" surfacing (accuracy-ledger auto-resolution + weight decay exist), one-click advisory strategy profiles (momentum/mean-reversion/whale-follow as gated presets over the model matrix), public whale/order-flow watch as a read-only source. All gated: an honest `n/a` beats a fabricated number.

## Aggregated-info output contract (for the "aggregated information for AI agents" workstream)

When asked to produce aggregated information about PICC, agents MUST:
1. Start from this index, then L0 → L1 → L2 (platform truth first, then ledger, then ops).
2. Rate every claim E/A/R/S and cite the file it came from — never paraphrase a doc into a stronger claim than it makes.
3. Treat `docs/specs/*` checkboxes as *aspirations*, not facts, until verified in code (spec risk R2; ledger rule "code is truth").
4. Mark anything unverified `UNVERIFIED` rather than omitting it or guessing.

## Annex registry (append-only)

| Date | Asset | Type | Rating | Owner |
| :-- | :-- | :-- | :-- | :-- |
| 2026-09-03 | `docs/EXPLICIT_AUDIT_LEDGER.md` | Defect ledger | A | audit track |
| 2026-09-03 | `docs/KNOWLEDGE_BASE.md` (this file) | Master index | A | KB track |
| 2026-09-03 | README/ARCHITECTURE truth-sync (two model brains, vault, archived extension) | Platform truth | A | audit track |
