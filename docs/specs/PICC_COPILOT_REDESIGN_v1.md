# PICC Copilot Redesign — design v1 (program spec)

**Status:** For execution · **Date:** 2026-09-20
**Program:** the trading suite (current focus) rebuilt from first principles as a universal trading/crypto copilot — notification-first, automation on the favored venue (per-action human consent), decision-support everywhere else.
**Extends:** `docs/specs/PICC_SUITE_MINISTRY_MODEL_v1.md` (ministry IA + Decision C classification), `docs/specs/PICC_FRONTEND_UI_RESKIN_v1.md` (completed at `a105d96` — token theme architecture, honesty surfaces, PWA shell), `docs/specs/PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md` + `PICC_V3_2_PLAN3_EXECUTION_COPILOT_v1.md` (v3.2 lane, shipped at `550f05c`), `docs/adr/0003`, `docs/adr/0004`.

**Scope commitment:** every requirement below ships in this program. Where sequencing puts an item in a later phase, that is *this program's* later phase — not a deferral. Nothing in this spec is parked, struck, or left to a future program. Functionality is prioritized over visual polish: functional surfaces land and are tested before the identity dress; the identity dress is its own full phase.

---

## 1 · Program structure

Four workstreams, executed **function-first**:

| # | Workstream | Kind | Content |
|---|-----------|------|---------|
| C1 | Dispatch + API layer | Function | Additive endpoints + dispatch center; the copilot's notification spine. **First.** |
| C2 | Copilot Command Deck | Function | Dashboard rebuild: v3.2 register, soak bay, loop spine, honest states. |
| C3 | Room functional parity | Function | Markets, Paper, Autopilot, Command Centre, Simulator, Studio/Settings wired with real data + honest states. |
| C0 | Design System + identity dress | Aesthetic | Sovereign Treasury + terminal density: tokens, primitives, Living Seal, vault empty states — applied as a cohesion pass across every surface, then browser-QA'd. **Last, fully shipped.** |

Functional builds (C1–C3) must produce clean, token-based markup (existing `themes.css` tokens, no one-off inline styling), so C0 is a re-skin, never a re-build.

**Review gates:** (1) user reviews the functional Command Deck before C3; (2) user reviews the dressed Command Deck (first identity surface) before the rooms' identity pass.

## 2 · API layer (C1 — core)

**Contract (ADR-0005, draft out for approval):** additive-only. New endpoints and additive keys on existing payloads; **existing payload bytes never change while v3.2 is OFF**; the 2527-test floor + byte-identity tests stay the gate for every tick. Where existing layers genuinely need enhancement, additive keys only.

New surfaces:
- **`GET /api/trading/dispatch`** — dispatch inbox history (kind, severity, title, body, ts, read, ref). `POST /api/trading/dispatch/read` — mark read.
- **Additive SSE section on the realtime stream** — `dispatch` latest events; richer `status.v32` (the full v3.2 register: enabled, assets watched, 1m buffer coverage, decisions resolved/total, breakeven, uptime, flip-gate progress) for the soak bay.
- **`GET /api/trading/engine/v32`** — on-demand full v3.2 register incl. per-asset pillars, cost line, trip-wires, and `explainState` (only present when the v3.2 lane is enabled and has live buffers; otherwise explicit absent-state).
- Enhancements ride `useRealtimeSuite`'s existing SSE coalescing; no new state library, no new runtime dependency.

Server tests follow the `accountMetricsApi.test.mjs` pattern (fresh import + `call(handleApi, …)`). Floor stays green; additive tests land in the same commit as each endpoint.

## 3 · IA spine — Watch → Decide → Dispatch → Act

The trading suite's rooms align around the copilot loop; the Command Deck *is* the spine stacked vertically, and every other room wears it as a header strip.

- **Dispatch is first-class**: a shell-level bell + a full Dispatch room. Unified in-app + webpush (existing `useWebPush`, alert engine). Kinds: decisions, readiness/soak milestones, venue & broker notices. The copilot's voice: PICC watches → decides → dispatches to you → you act (or it executes on the favored venue, per-action consent).
- Room registry (`MinistryRoom.tsx`) gains `dispatch` for the trading suite; lazy chunk, `rememberRoom` behavior unchanged.

## 4 · v3.2 becomes visible (C2 core)

The v3.2 lane currently has zero UI. The Command Deck surfaces it:
- **Decision Register** rows expand to: engine tag (legacy / v3.2), five-point execution pillars as a compact score, **cost line** (EV, cost-adjusted EV, EV/unit risk, margin vs `EV_RR_MIN`), confidence, trip-wire flags (0–8) as seal glyphs with reason text, and `explainState` text.
- **Soak Status bay**: live from the stream — enabled, assets watched, buffer coverage, decisions resolved/total, breakeven, uptime, flip-gate progress. **Stale = visibly stale**; never interpolated, never zeroed.
- Honest empty states: with feeds absent or buffers short, the register reads "awaiting live buffers (≥40 × 1m per asset)" — a vault note, not a void.

## 5 · Design System + identity dress (C0)

**Sovereign Treasury with terminal density** (approved aesthetic), dark-first.
- **Palette:** extend the existing token set — vault navy `--bg`, brass `--accent` (kept), seal vermilion (loss/danger), ledger green (realized profit), sovereign parchment (the one warm note). **Honesty tokens:** *ledger* (sealed — realized/used), *projection* (dashed, unsealed), *stale/absent* (hatched + explicit label). No number renders as confident that isn't.
- **Type:** engraved/ministerial display (restrained) for ministry titles; mono numerics for every figure; clean humanist body; sentence case.
- **Signature — the Living Seal:** one memorable element; a brass crest resolving with state (sealed / provisional / inert). Everything else stays quiet and dense. Motion: seal pulse + live-tick pulse only; reduced-motion respected.
- **Empty states:** "tidy vault" — engraved note of what is absent + the exact next action.
- Themed via the existing `[data-theme=…]` architecture (`themes.css`), per-ministry binding unchanged.

## 6 · Testing

- Server: handler tests (`call(handleApi,…)` fresh-import pattern), service unit tests — additive only, floor-green gates.
- Frontend: React Testing Library room tests (existing `MinistryRoom.studio.test.tsx` / `useCandleData` patterns) for every new surface and room.
- **browser-qa pass on every room** during the identity dress (C0), plus smoke + a11y on the dressed Command Deck. Visual baseline committed per room (INCONCLUSIVE never a silent PASS).
- Pre-existing order-coupled flake family (`autopilotRoutes.test.mjs`, `useCandleData.freshness.test.tsx`, `TradingSuite.deeplink.test.tsx`) continues to pass isolated; not re-introduced by new work.

## 7 · Sequencing

1. **C1** Dispatch + API layer (endpoints → dispatch room → shell bell).
2. **C2** Command Deck functional (register, soak bay, spine, honest states). **Gate: user review.**
3. **C3** Room functional parity, order: Markets → Paper → Autopilot → Command Centre → Simulator → Studio/Settings.
4. **C0** Design System + identity dress across every surface. **Gate: dressed Command Deck review** before rooms' dress.
5. Closure: full floor green, `npm run build` clean, browser-QA report committed.

**Success criteria:** every room unmistakably one world; v3.2 fully readable; honest empty states everywhere; zero regressions; flip-readiness readable at a glance from the Command Deck.

## 8 · Non-goals

No change to the automation posture (per-action consent stays); no new auth/account model; no data model migrations; no light themes. Everything else in the approved design is in scope.