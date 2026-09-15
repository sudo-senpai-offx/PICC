# ADR-0001: Session-capture kill-switch — PICC settings overrides extension toggle (independence architecture)

**Date**: 2026-09-15
**Status**: accepted
**Deciders**: owner (PICC operator), executing agent

## Context

Pack-1 S6 (PICC_PACK1_LOCAL_TRADING_CORE_v1.md, T6.2) pins the session-capture
kill-switch to `piccSessionCapture` — a boolean in the extension's
`chrome.storage.local`, default-ON, surfaced to the server via the heartbeat
relay. Investigation found the extension popup only exposed a "Relay enabled"
toggle (`piccRelayEnabled`, the WS frame-relay kill-switch), so the owner had
no UI surface for the session-capture kill-switch the spec pins. Two surfaces
now exist for the same switch, so precedence must be decided rather than left
to whichever writes last.

## Decision

We add a Session-capture toggle to **both** the PICC Settings page (server-side,
persisted JSON) and the extension popup, per the independence architecture:

- When **both** are present, the PICC settings page is authoritative: if the
  dashboard setting is OFF, capture does NOT occur even if the extension toggle
  says enabled, and the system prompts the user to re-enable capture in PICC
  settings (popup note + registry pathway `need:"capture"`).
- When the extension is the **only** surface (server unreachable), the extension
  toggle alone dictates session capture.
- Precedence is AND-semantics: either switch observed OFF blocks capture. An
  unobserved switch (`null`) is never assumed OFF — default-ON — consistent
  with the honesty contract.
- Session capture is a **generalized** feature (not per-venue): the kill-switch
  gates the whole capture leg.

## Alternatives Considered

### Alternative 1: Keep session capture extension-only (no PICC settings surface)
- **Pros**: minimal change; matches today's `piccSessionCapture` mechanism.
- **Cons**: owner has no dashboard surface to disable capture remotely; the
  spec-pinned kill-switch stays invisible in the UI that operators use; no
  server-side enforcement.
- **Why not**: owner explicitly requested the toggle on both surfaces with
  settings-page override ("independence architecture").

### Alternative 2: Extension toggle overrides PICC settings
- **Pros**: local user always has the last word.
- **Cons**: a remote/dashboard kill-switch would be defeated by one browser
  setting; cannot enforce a central capture-off policy; contradicts the owner's
  stated precedence ("if settings disabled, extension enabled, means the
  capture not occur").

### Alternative 3: OR-semantics (any ON allows capture)
- **Pros**: capture happens if either surface allows it.
- **Cons**: a user who disabled capture in ONE place would find capture still
  running, silently defeating the kill-switch; NULL never means OFF would make
  this even harder to reason about.
- **Why not**: owner explicitly confirmed AND semantics — either switch OFF
  blocks capture.

## Consequences

### Positive
- The spec-pinned `piccSessionCapture` kill-switch gets a first-class UI on both
  surfaces the operator actually uses.
- Dashboard-down independence preserved: extension toggle still works alone.
- Honest observation layered server-side: `observeEoCapture` reports
  `sessionCaptureEnabled` only when the server actually observed it, never an
  assumed false; `SKIP_REASONS.sessionCaptureDisabled` and
  `SKIP_REASONS.extensionCaptureDisabled` surface distinct reasons.

### Negative
- Two switches to reason about; a user may toggle one and be surprised by the
  other — mitigated by the popup "disabled in PICC settings" note and the
  registry `need:"capture"` pathway prompt directing to Settings.
- Server view requires the capture-profiles fold
  (`sessionCaptureEnabled` in `GET /api/trading/capture-profiles`) — a stale
  server view could gate an extension that the operator re-enabled locally;
  the 5-minute TTL bounds this.

### Risks
- Confusion risk (two toggles): mitigation is the explicit override note and
  the disabled-then-prompt UX rather than silent override.
- Contract-lock tests (captureContracts/extensionIntegrity) pin the expanded
  storage keys (`piccSessionCapture` read + write in popup.js) and the added
  read-only `capture-profiles` probe; future extension changes must update them
  deliberately.