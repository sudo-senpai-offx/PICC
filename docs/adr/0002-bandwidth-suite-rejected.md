# ADR-0002: Bandwidth suite rejected — not profitable in the user's real segment

**Status:** accepted · **Date:** 2026-09-15
**Applies to:** `docs/specs/PICC_BANDWIDTH_SUITE_design_v1.md` (closed as REJECTED)

---

## Context

The bandwidth/depin sharing suite (Honeygain, Pawns, TraffMonetizer, Repocket, EarnApp)
was designed (2026-09-06) as an additional income ministry leg. The honest envelope in
the design itself estimated ≈ $3–8/month for a single low-demand-region IP segment, with
"demand-limited, not speed-limited" as the binding constraint, and exactly **one IP
segment** available to the user (1 phone + 1 laptop on the phone's hotspot; VPS deferred —
no genuinely free tier in user region).

On 2026-09-15 the owner reviewed the suite alongside the earnings ministry and decided in
his own words: the bandwidth/depin alternative is **useless and not profitable**.

## Decision

- **REJECT** `PICC_BANDWIDTH_SUITE_design_v1.md`. No implementation phases will be
  executed. The suite is dropped from the roadmap.
- The spec document stays in the repo with its status flipped to REJECTED so the
  considered-and-rejected path is legible (repo ADR pattern: the decision record is the
  point of truth, the spec is the rejected candidate).
- No new services, segments, collectors, claims, or extension origins for bandwidth
  providers will be built. Existing generic infrastructure (collectors, claim
  idempotency, income ledger) is shared machinery and remains — it is not removed
  because this one candidate was rejected.
- PICC research/development effort concentrates on the earnings ministry (agentic
  ministries) and the embedded browser studio, which have higher expected value per
  unit of user attention.

## Consequences

- The $3–8/month segment stays un-pursued — accepted by the owner as not worth the
  operational surface (sharing apps, per-segment constraints, payout-min verification,
  daily quests).
- No code needs to be deleted: the bandwidth suite never shipped implementation beyond
  pre-existing generic capabilities.
- Future reconsideration (e.g., a genuinely free VPS in user region, or a profitable
  resettable-limit source) would require a new design document, not resurrection of this
  one.