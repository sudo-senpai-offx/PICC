# ADR-0005: Additive-only API contract for the frontend overhaul

**Date:** 2026-09-20
**Status:** accepted
**Deciders:** repo owner (approval)

## Context

The Copilot Redesign (see `docs/specs/PICC_COPILOT_REDESIGN_v1.md`) needs new API surfaces — a dispatch inbox, a full v3.2 register stream, an on-demand engine register — and permission to enhance existing layers. The server was hardened to a 2527-test floor with a byte-identity guarantee: while the v3.2 lane is OFF, legacy decision payloads must stay byte-identical. The redesign must not re-open that contract.

## Decision

New endpoints and additive keys only. Existing payload bytes never change while the v3.2 lane is OFF. Where an existing layer is enhanced, it is enhanced with additive keys only. The 2527-test floor plus the byte-identity tests remain the gate for every commit in the redesign.

## Alternatives Considered

### Alternative 1: Consume-only frontend
- **Pros**: zero server risk
- **Cons**: v3.2 nuance (pillars, cost line, explain-state, soak digits) stays unrenderable
- **Why not**: hides shipped capability

### Alternative 2: Free hand on shared payload shapes
- **Pros**: highest ceiling
- **Cons**: re-opens the byte-identity contract
- **Why not**: unsafe against a live engine and its test floor

## Consequences

### Positive
- Redesign ceiling with a sealed legacy path
- Additive keys are directionally removable
- Gate is mechanical, not a ceremony

### Negative
- Some shapes may carry additive keys indefinitely
- Legacy payloads stay frozen even where now awkward

### Risks
- Drift where one endpoint is "enhanced" into a new shape — mitigated by the byte-identity gate and review at each tick