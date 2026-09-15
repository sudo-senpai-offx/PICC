# Bandwidth Command-Centre Suite — Design v1

**Status:** REJECTED (struck by owner decision 2026-09-15 — see [ADR-0002](../adr/0002-bandwidth-suite-rejected.md): not profitable in the user's real segment) · **Date:** 2026-09-06
**Extends:** executed Q5 income generalization (`docs/specs/PICC_INCOME_GENERALIZATION_*`) · Command Centre slices 1–6 (`COMMAND_CENTRE_WEB_SPEC.md`) · Automator collectors (`apps/dashboard/server/services/automator.mjs`) · extension income leg (`apps/dashboard/extensions/picc-overlay/`)
**Supersedes:** nothing destructive — extends only. Trading suite (`HYPERLIQUID_CONNECT_RUNBOOK.md`) is unaffected and stays in flight.
**Grounding rule:** every claim carries a file:line read this session. Anything only seen via grep (function bodies not yet read) is marked **UNVERIFIED** and must be re-read at execution start.

---

## 0. The honest contract (inherited verbatim)

- **Unconfigured ≠ zero-filled.** A provider that is not registered, not enabled, not collected, or produced no readable value reports `null`/`"unconfigured"`/`status:"error"`, never a fabricated `0` (repo idiom: `accountMetrics.mjs` — "a fabricated 0 is indistinguishable from a real balance of zero").
- **Every status reports observed state.** `ok` only when a real observation landed this cycle; `error`/`stale`/`unconfigured` are distinct honest states.
- **One provider per IP segment.** Two sharing apps on one IP is the ToS ban pattern (Honeygain's own FAQ: "They detect multiple apps sharing the same IP"). The suite **refuses** this — no warning, no override.
- **Stability, not concealment.** The kill switch pauses sharing when a connection is establishing/unstable. A kill switch designed to *hide* traffic from a carrier or platform is off the table.
- **No fake traffic.** No proxies, no spoofing, no fake activity (pi-node README rule), no acceleration/boost schemes, no multi-accounting.

---

## 1. Design pillars

1. **Cumulative income tracking, segment-bounded sharing.** Every configured provider's balance aggregates into ONE honest ledger (the stacked-income surface). Sharing apps stay one-per-segment; new segments (VPS, broadband) are absorbed by config, not code.
2. **Independence constraint (web app / extension).** Web app alone: full suite surface via server-side collectors. Extension alone: income-frames capture for registered origins (grass is the seeded origin). Both present = ideal. Neither half may require the other (Q5 rule).
3. **Segment model as the core object.** `{ segmentId, kind: mobile|broadband|vps, provider, status, connectionState }` — assignment validator enforces one-provider-per-segment; kill switch keys off `connectionState`.
4. **Payout/claims as observed workflows.** Threshold radar + claim scheduler + durable idempotency (slice-5 pattern `bandwidth:claim:<platform>:<ref>`), cash-out ledger recording observed arrivals (platform → PayPal → bank → TnG).
5. **Honest numbers everywhere.** Every balance today/30d/lifetime/threshold is observed or null. Cash-out readiness is computed from observed balances only.

---

## 2. Grounded current state (what exists, what this suite extends)

| Capability | Where it lives today | Status |
|---|---|---|
| Server collectors for all 5 providers | `automator.mjs:200-222` (`honeygain/pawns/traffmonetizer/repocket/earnapp` fetch functions; min payouts 20/5/10/10/5) | EXISTS — fetch bodies **UNVERIFIED** (grep-line only) |
| Per-provider credential fields + whitelist | `automator.mjs:98-107,133-142`; `handlers.mjs:274-281` | EXISTS |
| `/api/collectors/honeygain` POST route | `handlers.mjs:3538-3547` | EXISTS |
| Bandwidth site catalog w/ ToS notes | `automator.mjs:389-397` (earnapp: "Desktop app only — ToS prohibits Docker/VMs/home servers"), `:470-478` (daily quests), `:502-506` (slug map) | EXISTS |
| Browser-studio site detection | `browserStudio.mjs:478-486`, slug map `:1669-1674` | EXISTS |
| Extension income leg (grass seeded) | `background.js:334` (`income-frames`), `:420` (`forExtension` snapshot); `content.js:368-373` (grass `PICC_CAPTURE_BUILTIN`); `inject.js:32-36`; `manifest.json:46-47` | EXISTS |
| Payout-claim leg (first live) | Command Centre slice 5 — `bandwidth:claim:<platform>:<ref>` idempotency, proposals + consent | EXISTS |
| CC catalog bandwidth template | `policyGraphCatalog.mjs` `bandwidth:browser` (gray → COPILOT, claims-only) | EXISTS — **UNVERIFIED** this session |
| Income overview (Q5) | `GET /api/income/overview` (Q5 Task 11) | EXISTS, launch-gate pending |
| Q5 user gates | Tasks 14–15 (launch+verify, then commit/push) | UNTICKED |
| Extension income test coverage | `backgroundServerStatus.test.mjs` (income-frames + grass pins) | EXISTS |

**User hardware reality (2026-09-06):** 1 phone (Snapdragon 680, Android, 4G, unlimited-data plan capped 48Mbps, no data-threshold throttle confirmed) + 1 laptop on the phone's hotspot. **Exactly one IP segment.** No home broadband; free-tier VPSes verified not actually free in-user-region → **VPS deferred to the future**. Honeygain currently runs on both devices (same IP — allowed with same account, but the traffic pie is shared/capped per IP, so the laptop adds ~nothing).

**Honest envelope:** one low-demand-region IP ≈ **$3–8/month** (2026 tested sources: $0.10–0.20/GB; typical users route 50–150 MB/day — demand-limited, not speed-limited). A 2–3 MB/s battery-safe share cap on the phone costs ~nothing in earnings (demand is the binding constraint). MY "unlimited" plans' fair-use throttling is the main silent killer — already cleared for this user's plan.

---

## 3. Module designs

### M1 — Segment model + assignment validator (server)
- New `bandwidthSuite/segments.mjs` (new service): segment registry, `assignSegment(segmentId, provider)`, `assertOneProviderPerSegment(provider, segment)`, `listSegments()`.
- Validator **refuses** a second sharer on a segment already carrying a provider. Never warns-and-allows.
- Persists via existing localstore pattern (`server/data/bandwidth-segments.json`; writes suppressed under `VITEST` — repo pattern).
- TDD; seams: segment CRUD + refusal matrix.

### M2 — Provider catalog extension (config, not code)
- Extend the existing catalog entries (`automator.mjs:389-397`) with `segmentKindAllowed: [mobile, broadband, vps]` + battery-cap hint + verified payout-min field (EarnApp min is $5 per repo / $2.50 per 2026 web sources — **verify before trust**).
- No new service module per site — the declarative registry rule (Q5 REQ-E) stays.

### M3 — Cumulative income aggregation (the stacked-income surface)
- Extend/confirm Q5 overview + CC overview to merge: per-provider balances, today/30d/lifetime, thresholds, cash-out readiness — all observed or `null`.
- The "stacking income" the user asked about lives HERE: five providers, one ledger, one honest screen, even while only one app shares per segment.
- Honesty badges per provider: `ok | error | stale | unconfigured`.

### M4 — Connection-state kill switch (server; stability semantics)
- Segment `connectionState: establishing|stable|unstable|down`; when a segment is `establishing`/`unstable`/`down`, the suite pauses claim scheduling + share-affecting actions for that segment and resumes on `stable`.
- Inputs: extension telemetry heartbeat (when browsing) + web-app heartbeat + manual override (user can HOLD a segment). Honest semantics only — never conceals traffic.
- TDD; seam: kill-switch state machine (transition matrix, resume-on-stable, manual HOLD override).

### M5 — Payout/claims workflow extension
- Threshold radar over observed balances; claim scheduler per provider with durable idempotency key `bandwidth:claim:<platform>:<ref>` (slice-5 pattern); proposals + consent for every external action (CC mode engine).
- Cash-out ledger: records observed arrivals of platform → PayPal → bank → TnG steps (manual bank-app step recorded, never automated — no third-party TnG push API exists, and PICC holds no custody).
- TDD; seams: radar over fixtures, idempotency replay, ledger honesty (no fabricated arrival).

### M6 — Agent roster (mapped onto existing services)
- Roster registry (CC slice-1 pattern) with specialists: balance-watcher, claim-executor, quest-tracker (daily quests `automator.mjs:470-478`), segment-health, honesty-checker.
- Each agent has a real observer it maps to; no agent with nothing to observe (CC principle: observable agent team).

### M7 — Extension income origins expansion (user-approved sites only)
- Q5 pattern: each new origin = declarative connector entry + (where needed) `inject-<slug>.js` + manifest host entry — **requires explicit user go-ahead per site** (Q5 Task 9/14 flag rule).
- grass stays the seeded origin. No new host permissions beyond what collection needs.

### M8 — Suite surface (web app)
- Bandwidth suite page/tab in the dashboard: segments, per-provider ledger, kill-switch state + manual HOLD, claims, cash-out history, honest badges.
- Web-app-alone fully functional (collectors are server-side); extension enhances capture only.

---

## 4. Constraints / non-goals (explicit)

- NO second sharing app on a segment that already has one (refused, not warned).
- NO acceleration/boost schemes, fake traffic, spoofing, proxies (repo rule + pi-node README).
- NO kill-switch-as-concealment (stability semantics only).
- NO VPS integration now (deferred; segment model makes it config when it arrives).
- NO third-party TnG push integration (does not exist for individuals); TnG arrivals recorded, not initiated, by PICC.
- NO new payment rails, NO custody of user funds, NO real-money movement beyond the sanctioned claim leg.
- Trading suite untouched: rung ladder, funding queues (Transak/Hata/Luno), `maxExposureUsd` envelope all unchanged.

---

## 5. Checklist outline (for approval → derived into executable tasks)

- Phase A — M1 segment model + validator (TDD) + M2 catalog extension (config)
- Phase B — M3 aggregation surface on existing overviews (TDD on merge + honesty badges)
- Phase C — M4 kill switch (TDD state machine)
- Phase D — M5 payout/claims extension (TDD radar/idempotency/ledger) + M6 roster
- Phase E — M8 suite surface (UI, launch-verify) + M7 extension origins (user-approved site)
- Phase F — user launch+verify gate, then commit/push (Q5 Tasks 14–15 pattern: nothing committed before user confirms)

**Flagged for explicit user approval:** M7 site scope (which origin(s) beyond grass); initial 4G slot provider (keep Honeygain vs swap to EarnApp — pending payout-min verification — vs Pawns; suite works regardless, it is config); battery-safe share-cap value on the phone.

---

## 6. File/reference map

| Concern | File:line |
|---|---|
| Collectors + min payouts | `automator.mjs:200-222` (fetch bodies **UNVERIFIED**) |
| Credential fields/whitelist | `automator.mjs:98-107,133-142`; `handlers.mjs:274-281` |
| Collector route example | `handlers.mjs:3538-3547` |
| Site catalog + quests + slugs | `automator.mjs:389-397,470-478,502-506` |
| Browser-studio sites/slugs | `browserStudio.mjs:478-486,1669-1674` |
| Extension income leg | `background.js:334,420`; `content.js:368-373`; `inject.js:32-36`; `manifest.json:46-47` |
| Extension income tests | `backgroundServerStatus.test.mjs` |
| CC payout-claim leg | Command Centre slice 5 (changelog `CHANGELOG.md`); `policyGraphCatalog.mjs` **UNVERIFIED** |
| Q5 executed/gates | `docs/specs/PICC_INCOME_GENERALIZATION_checklist_v1.md` (Tasks 1–13 done; 14–15 unticked) |
| Trading suite (unaffected) | `docs/runbooks/HYPERLIQUID_CONNECT_RUNBOOK.md` |