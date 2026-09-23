# PICC Trading Suite — WS-4 · Copytrading Idea Sourcing — spec v1

**Date:** 2026-09-23 · **Workstream:** WS-4 of `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md` (APPROVED) · **Kind:** implementation-ready plan · **Approved by:** pending owner, subagent-driven implementation.

- Master design: `docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md` — locked decision 10 (copytrading: pluggable leader-feed client; HIP-verified first adapter; manual/CSV import fallback; idea-sourcing ONLY, never auto-mirror; 300+ verified trades, <15% MDD, positive expectancy after costs; auto-unfollow after 21 days no positions; 5% rolling-7-day account stop) `:36`; WS-4 scope block `:64-67`; working set `:9-21`; venue classes / adapter contract `:40-42`.
- WS-3 spec (format precedent + landed substrate): `docs/specs/PICC_TRADING_SUITE_WS3_VALIDATION_AND_UNLOCK_CEREMONY_v1.md` — persistent store/gate/readout conventions WS-4 mirrors (store `:29-31`, gates `:151-155`, route `R9.1 :67`, resolution `:178-198`), status LANDED (PICC.md `:474`, `:942`).
- WS-2 spec: `docs/specs/PICC_TRADING_SUITE_WS2_RISK_AND_DRAWDOWN_ENFORCEMENT_v1.md` — resolution `:280-286`; WS-2 owns the MDD day-loss/break rails; WS-4's 5% stop is display-only and must not touch them (Non-goals).
- Scope compendium: `.superpowers/sdd/PICC_TRADING_SUITE_WS345_PIPELINE/plan.md` (WS-4 block; WS-4/5 not started — WS-3 landed `bb7bee0..bebd628`).

**Status: ACTIVE** — D1–D8 ratified by owner; T0–T7 executing. Final status string set at ship (T7).

---

## §0 Current state (verified file:line, 2026-09-23)

1. **No copytrade/leader code exists.** Grep `copytrad|leaderFeed|leader-idea|mirrorOrder|copyTrade` across the repo → no implementation files. The only leaderboard code is hyperopt's internal candidate ranking (`hyperopt.mjs:228-266`), unrelated. The catalog reserves a "Trading social/flow" slot (C6/7 — public analytics/leaderboard surfaces with no-key access, `PICC_TRADING_SITES_CATALOG_v1.md:87`) with the `verified === false` default rule (`:89`) — WS-4's platform-trust flag operationalizes that rule per leader-source.

2. **The pluggable-adapter seam exists and is the template.** `venueAdapterContract.mjs` freezes `CONTRACT_MEMBERS` (`:1-11`), `RISK_MODEL_FIELDS` (`:13-21`), holds a `registry = new Map()` (`:23`) and `validateVenueAdapter` (`:25+`). WS-4's leader-feed contract mirrors this file, not bolting onto it (venue adapters are execution-side; leader feeds are research-side, different lifetimes — D2).

3. **A real websocket client with full header control exists** — the HIP adapter's eventual transport. `wsclient.mjs` `WsClient` class `:26`, `wsConnect(urlStr, { headers, timeoutMs })` `:207` with Origin/UA override (default Chrome UA `:238`); consumed by `expertoption.mjs:20`. WS-4 ships the HIP adapter as a contract-level stub (D8) — no live endpoint exists to verify against.

4. **Pure analytics for qualification already exists.** `analytics.mjs` `metricsFrom` (`:80-117`) computes `maxDrawdown` (`:91`), `winRate` (`:143`), `profitFactor` (`:142`), `expectancy` (`:146`) over `equitySeries` (`:20`) / `drawdownSeries` (`:38-52`, peak-anchored %). `riskState.mjs` uses the same peak-anchored formula (`drawdownFromPeakPct`) — WS-4 reuses `analytics` (pure, no I/O), never re-implements.

5. **UTC day primitives exist.** `u4faRisk.mjs` `dayKeyOf` (`:29-31`), `utcDayStartMs` (`:34-36`) — used for the 21-day auto-unfollow window and the rolling-7-day stop window. Rolling-window precedent: `autopilot.mjs` `evaluateLossBreaker` (`:422-439`).

6. **The persistent-store pattern is established.** `ceremonyState.mjs` (`services/commandCentre/`): `KNOWN_VENUE_CLASSES` (`:15`), boot health with `version:1`, UNHEALTHY refuse-mutations (`:143` gate reads `storeHealth().ok !== true` → deny), operator-only writes for `enablement`/`platformVerification` (`R1.3`, `R11` — never credit-path-touched), self-wires a consumer at import (`index.mjs:11`). Store dir: `PICC_COMMAND_CENTRE_DATA_DIR` default `services/data/` (WS-3 `R1.1`; `riskState.mjs` `:7-9`). WS-4's follower store mirrors this exactly (D1).

7. **The readout route + honesty contract is the route template.** `handlers.mjs` `GET /api/command-centre/ceremony` (`:1607-1650`): `requireAuth` (`:1608`), store health gates the read (`:1609`), per-class `evaluateCeremony` map (`:1619-1647`), `writeJson(res, 200, …)` (`:1648`). Imports live at `:154-158`. Overview route must stay byte-identical (ADR-0005, tested by `commandCentreOverview.test.mjs` parity — additive only).

8. **Body-handling for a new upload route needs care.** `readBodyMax` (`:5365-5374`) is used ONLY for `path === "/api/browser/upload"` via a ternary at `:1016`; every other route uses plain `readBody`. A new CSV/JSON import POST must handle its own body (mirror the `:1016` shape) — the `:1016` ternary is NOT extended (D2/R3).

9. **Audit trail exists.** `auditTrail.mjs` `appendAudit` (`:73-91`) append-only hash chain with `canTouchDisk()` guard — import/follow/trust writes are audited events (`leader:*`).

10. **UI pattern exists.** `UnlockCeremony.tsx` (Card + `useEffect`/`alive` + `not-wired` cells + verbatim deny reasons + muted badges for unverified, `:35-53`, `:117-122`), mounted in `CommandCentreRoom.tsx` (`:26-38`); client calls via `src/lib/api.ts` `request<T>`. Client test: `src/components/__tests__/UnlockCeremony.test.tsx`.

11. **No leader data exists anywhere.** Store starts empty — every cell `not-wired`/empty until the operator imports a real feed (ADR-0005: never fabricate a feed or a qualification). No credentials/tokens/wallets appear in this spec (values referenced by line, never copied).

---

## §1 Locked decisions re-affirmed (not renegotiable)

- Decision 10, exact text (`SEAL :36`): "Copytrading: pluggable leader-feed client; first adapter = HIP-verified feeds; manual/CSV import fallback. Idea-sourcing ONLY, never auto-mirror. Qualification: 300+ verified trades, <15% MDD, positive expectancy after costs. Auto-unfollow after 21 days no positions; 5% rolling-7-day account stop."
- Decision 1 (`SEAL :27`): one workstream at a time — WS-4 after WS-3 (landed), before WS-5 (not started).
- ADR-0005 additive-API contract: overview route and existing risk rails byte-identical; nothing absent ever reads as a pass; every un-evaluable input is a named deny.
- Master sequence WS-1→WS-5: this spec does not unlock execution, does not touch WS-2 risk gates 16–19 / sidecar 1–10 / perps 11–15, does not change the ceremony, does not change `policyGraphCatalog` templates.

---

## §2 Requirements

Each requirement names its task(s). "Testable" = has an acceptance criterion in §4.

### R1 — Persistent per-leader follower store (decision 10; `SEAL :36`) — T0
- R1.1 A restart-persistent store mirrors `ceremonyState`/`riskState`: boot health, `version: 1`, unreadable/corrupt → UNHEALTHY, mutations refuse, **default `leaders: []`** (no leader is ever followed without an operator action). Store file `leader-ideas.json` beside `ceremony-state.json` (`PICC_COMMAND_CENTRE_DATA_DIR` default `services/data/`).
- R1.2 Per-leader record: `{ id, label, source: "csv"|"manual"|"hip", followedAt, lastPositionAt, platformTrust: { value: "UNVERIFIED"|"VERIFIED"|"ADVERSARIAL", at, by, evidence }, qualification: { verdict: "qualified"|"denied", deny: reason|null }, ideas: [], updatedAt }`.
- R1.3 Every transition (import, follow, trust change) is audited via `appendAudit` (event prefix `leader:*`); the store self-wires nothing beyond persistence — no consumer wiring (unlike ceremony's resolve consumer).

### R2 — Pluggable leader-feed contract + registry (`SEAL :36` "pluggable leader-feed client") — T1
- R2.1 New `leaderFeedContract.mjs` mirrors `venueAdapterContract.mjs` (`:1-25`): frozen `CONTRACT_MEMBERS`, `validateLeaderFeed`, `registry = new Map()`. Members: `id, label, provenance (hip|csv|manual), fetchIdeas(leaderId), fetchPositions(leaderId)`. Feed row shape (the CSV contract too): `{ id, at, asset, direction: "long"|"short"|"spread", sizeUsd, entryPrice, exitPrice|null, closedAt|null, pnlAfterCosts|null, feesUsd, ts }`.
- R2.2 `provenance` is a first-class discriminator (decision 10's three lanes). CSV/manual lanes are REAL in WS-4; HIP is a contract-verified STUB (D8).

### R3 — CSV/JSON import path (manual/CSV fallback) — T3
- R3.1 `POST /api/command-centre/leader-ideas/import` (auth) accepts a base64 JSON payload (feed rows + leader meta). Body handled in the route's own block (mirror `handlers.mjs:1016` shape with `readBodyMax`); payload cap 64 MB, `413` over cap.
- R3.2 Import = parse → validate rows against the R2.1 shape → reject rows missing `feesUsd`/`pnlAfterCosts` (a feed that does not account costs can never qualify: `leader:deny:costs-unaccounted`) → run qualification (R4) → write store + audit `leader:import:{id}`. Unknown asset ids are named denies (`leader:deny:unknown-asset`), never silent skips.
- R3.3 An import NEVER sets `platformTrust` (that is an operator store-write, R7) and NEVER marks anything followed.

### R4 — Qualification: 300+ trades, <15% MDD, positive expectancy after costs — T2
- R4.1 Pure `qualifyLeader(rows)` reuses `analytics.metricsFrom` (`:80-117`) — one call, no re-implementation of MDD/expectancy. Verdict `qualified` iff `trades ≥ 300` AND `maxDrawdown < 15` AND `expectancy > 0` on net-of-costs rows.
- R4.2 Named denies, verbatim-stable: `leader:deny:trades-short (have N, require 300)`, `leader:deny:mdd-over (have N%, require <15)`, `leader:deny:expectancy-nonpositive (have N)`. An unqualified leader stores `verdict: "denied"` + first-deny reason and surfaces as denied — never as qualified (ADR-0005).
- R4.3 Qualification is read-only state derived from imported rows; re-import re-evaluates.

### R5 — Auto-unfollow after 21 days with no positions — T6
- R5.1 Evaluated ON-READ at route compose (no new sweeper loop — D4): if `lastPositionAt == null` or older than `PICC_LEADER_AUTO_UNFOLLOW_DAYS` (default 21) UTC days (`dayKeyOf`, `u4faRisk.mjs:29-31`), the readout reports `status: "auto-unfollowed"` + reason `leader:auto-unfollow:no-positions-21d`. GET never writes the file (read-only probe test pins this).
- R5.2 The transition persists on the next store mutation (import/follow/trust), not silently on read.

### R6 — 5% rolling-7-day account stop (idea-sourcing display guard) — T6
- R6.1 Pure `sevenDayStop(ideas, equityUsd, now)`: trailing 7 UTC days (`dayKeyOf` windows), sum of `pnlAfterCosts` on closed idea rows vs account equity; breach or would-breach the `PICC_LEADER_7D_STOP_PCT` (default 5) floor → the readout surfaces the stop AND zeroes the surfaced idea rows for that leader (`ideas: []`) with reason `leader:idea-suppressed:7d-stop` until the window recovers. Unavailable equity (no finite positive `equityUsd`) → named `leader:deny:equity-unavailable` (ADR-0005 — un-evaluable cell never reads as a silent no-stop).
- R6.2 This is a DISPLAY/feed-suppression guard on the research surface only. **It is not a WS-2 risk rail**: gates 16–19, sidecar 1–10, perps 11–15, and the aggregate day-loss barrier are untouched (pinned by T6 seam guard). WS-4 has no execution path, so the stop has no trade teeth by construction.

### R7 — Platform trust flag (v3.4 Part-A platform-verification gate, operationalized per leader-source) — T0/T5
- R7.1 Every leader carries `platformTrust.value`, default `"UNVERIFIED"` — set by an operator store-write only (`POST /api/command-centre/leader-ideas/trust`, auth + audited `leader:trust:{id}`), never inferred, never set by import (mirror ceremony `platformVerification` write-gating, WS-3 R11). Evidence field holds an external evidence INDEX (regulator on public register, verified trade-history proof); the operator performs the external checks — the flag records outcome + index, ADR-0005.
- R7.2 `"ADVERSARIAL"` → ideas suppressed with `leader:deny:platform-adversarial` (no GO when platform flagged). `"UNVERIFIED"` → ideas surface with a muted `unverified` badge (honesty cell, never a deny, never a pass). `"VERIFIED"` → plain qualified surface.

### R8 — Readout route (idea-sourcing surface) — T4
- R8.1 `GET /api/command-centre/leader-ideas` (auth, `writeJson` mirror of the ceremony route `handlers.mjs:1607-1650`) returns `{ ok: true, at, leaders: [ { id, label, source, followedAt, lastPositionAt, status: "followed"|"auto-unfollowed", platformTrust, qualification: { verdict, deny } , guard: { autoUnfollow: {active, reason|null}, sevenDay: {active, reason|null} }, ideas: […] } ] }`. Unhealthy store → static health deny (`leader:deny:store-unhealthy`), never a silent all-pass. Adapter stub → `leader:deny:hip-not-wired — endpoint contract unverified` on that source. Overview route byte-identical (R9).
- R8.2 The panel (T5) renders the readout with the UnlockCeremony honesty pattern: `not-wired` for absent cells, deny reason verbatim, `unverified` muted badge — nothing absent reads as a pass.

### R9 — Additive-only contract — all tasks
- R9.1 `commandCentreOverview` aggregation (`commandCentreOverview.mjs`, honesty contract `:1-18`, `NOT_WIRED :25`) is not modified; overview/compose tests stay green untouched. No new page, no new rail, no catalog schema change (D5).

---

## §3 Design decisions (RATIFY; D1–D8) and non-goals

**D1 — Persistence location (RATIFY).** New `services/commandCentre/leaderIdeasState.mjs` + `leader-ideas.json` in the same `PICC_COMMAND_CENTRE_DATA_DIR` as `ceremony-state.json` / `ccxt-risk-aggregate.json` (WS-3 R1.1; `riskState.mjs:7-9`). Rationale: the follower set is command-centre operational truth like the ceremony/aggregate stores; one data dir keeps boot + `canTouchDisk`/VITEST semantics shared. Rejected: extending `ceremonyState` (ceremony is venue-class-scoped with `KNOWN_VENUE_CLASSES` keys `:15`; a leader is a different object that may trade unidentified venues — same persistence precedent, different shape); walls of raw JSON in the repo (runtime state, gitignored like the others).

**D2 — Pluggability via a second contract module, not the venue registry (RATIFY).** New `services/copytrade/leaderFeedContract.mjs` mirrors `venueAdapterContract.mjs` (`:1-25`) but registers leader feeds, not execution venues. Rationale: decision 10 says "pluggable leader-feed client" with three provenance lanes — a dedicated registry with `provenance` first-classed is the literal shape; venue adapters are execution-side and must not grow a research surface. Rejected: extending the venue registry (would entangle execution contracts with a never-executing feed client); hardcoding CSV only (violates "pluggable").

**D3 — Reuse `analytics.metricsFrom` for qualification (RATIFY).** The qualifier is pure over rows and calls the existing `metricsFrom` for `maxDrawdown`/`expectancy`/`winRate` (`analytics.mjs:80-117`, `:142-146`). Rationale: same peak-anchored MDD semantics as `riskState.drawdownFromPeakPct` already in the suite; re-implementing invites drift. "After costs" is enforced at import (R3.2), not inside the qualifier — the qualifier trusts the contract, the importer enforces it.

**D4 — Auto-unfollow on-read, no new loop (RATIFY).** Evaluation happens at route compose with `dayKeyOf` windows (R5.1); GET never writes. Rationale: WS-4 has no execution loop to piggyback on, and adding a `setInterval` (the `startSignalEngine` boot precedent, `index.mjs:184-193`) buys restart-truthiness problems for a display transition that a pure function already answers; the store persists the transition on the next mutation. This mirrors the v3.2 `v32Status` read-only probe precedent (its read never writes the ledger).

**D5 — Catalog unchanged, resolution-style note only (RATIFY).** The data catalog (`PICC_TRADING_SITES_CATALOG_v1.md` §2 schema `:14-28`) keeps its `verified:false` default (`:89`); WS-4 adds the trust flag to the follower store, not the catalog, and appends a resolution-style note pointing at it (mirror WS-3 D4's catalog-note idiom — do NOT add schema fields). Rationale: the catalog is a data-facts descriptor for sites; follow-trust is operational state with audit; a prose field would rot and cannot be machine-enforced.

**D6 — Operator-recorded trust, never inferred (RATIFY).** `platformTrust` mirrors ceremony `platformVerification` gating exactly (default null-equivalent = UNVERIFIED; only a deliberate store write sets VERIFIED/ADVERSARIAL with `at/by/evidence`; no code infers). Rejected: reading ceremony's venue-scoped `platformVerification` as the leader's trust (a leader can trade a verified venue while being unknown themselves — different object, same doctrine).

**D7 — One fetch, one read-only panel (RATIFY).** Single `GET /api/command-centre/leader-ideas` + `LeaderIdeasPanel` Card mounted in `CommandCentreRoom.tsx` beside `UnlockCeremony` (`:26-38`), client types in `api.ts`. Write actions ride three narrow POSTs (import / follow / trust), all auth + audited; the panel itself is read-only (human-flips-last-switch: data-entry happens in the API, never inferred UI state). Rationale: mirrors WS-3's readout route + UI with minimal surface.

**D8 — HIP adapter ships as a contract stub (RATIFY).** The registry contains the HIP entry (`provenance: "hip"`) whose `fetchIdeas`/`fetchPositions` return `{ ok: false, reason: "leader:deny:hip-not-wired — endpoint contract unverified" }` until a real HIP endpoint is verified (out of WS-4; the `wsConnect` header-control pattern at `wsclient.mjs:207` is documented as the future transport so the stub's shape matches). CSV/JSON + manual are the WORKING default lanes. Rationale: ADR-0005 — never fake a feed; a stub with a named deny is honest, a fabricated "HIP feed" is not. No HIP credentials anywhere in WS-4.

**Non-goals (explicitly out of WS-4):** any auto-mirror/execution from a leader idea (decision 10: "never auto-mirror" — WS-4 builds no trading path; the seam guard proves none exists); touching WS-2 risk gates 16–19, sidecar gates 1–10, perps gates 11–15, or the aggregate day-loss barrier; the 5% stop as anything but display/feed suppression (R6.2); changing `policyGraphCatalog` templates, `v32Config`, or the ceremony machinery; adding an enablement field to the catalog schema; a real HIP transport (endpoint unverifiable today); follow-too-many alerts, leader discovery/search, or a social leaderboard UI (catalog C6/7 stays research backlog — §21 "E leaderboard" is untouched); dependency bumps; any new page or nav item.

### §3.1 File map

| File | Kind | Owner | Changes | Dependencies |
|---|---|---|---|---|
| F1 | `services/commandCentre/leaderIdeasState.mjs` | CREATE | Persistent store (R1): boot health, version, per-leader records, `platformTrust` write-gating, audit via `appendAudit` | `u4faRisk.dayKeyOf`, `auditTrail.mjs` |
| F2 | `services/copytrade/leaderFeedContract.mjs` | CREATE | Feed contract + registry (R2): `CONTRACT_MEMBERS`, `validateLeaderFeed`, CSV row shape, HIP stub | — (mirror `venueAdapterContract.mjs:1-25`) |
| F3 | `services/copytrade/leaderQualification.mjs` | CREATE | Pure qualifier (R4): `qualifyLeader(rows)` via `analytics.metricsFrom` + named denies | `analytics.mjs` |
| F4 | `services/copytrade/csvFeedImport.mjs` | CREATE | Parse/validate/qualify + store-write path (R3) | F2, F3, F1, `appendAudit` |
| F5 | `services/copytrade/leaderGuard.mjs` | CREATE | Pure on-read guard (R5/R6): auto-unfollow window + rolling-7-day stop | F1 shape, `dayKeyOf` |
| M1 | `server/handlers.mjs` | MODIFY | Import store/gates/contract (`:154-158` block); add GET `leader-ideas` (`:1607-1650` mirror), POST `import` (`:1016`/`readBodyMax` mirror), POST `follow`, POST `trust` | F1–F5 |
| M2 | `server/index.mjs` | MODIFY | Boot import of the store beside the ceremony import (`:11`) | F1 |
| M3 | `src/lib/api.ts` | MODIFY | Client types + `getLeaderIdeas`/`importLeaderFeed`/`followLeader`/`setLeaderTrust` | route contract (M1) |
| F6 | `src/components/LeaderIdeasPanel.tsx` | CREATE | Read-only panel (R8.2), honesty cells mirroring `UnlockCeremony.tsx` | M3 |
| M4 | `src/pages/ministry/CommandCentreRoom.tsx` | MODIFY | Mount `LeaderIdeasPanel` beside `UnlockCeremony` (`:26-38`) | F6 |
| M5 | `apps/dashboard/.env.example` | MODIFY | WS-4 vars block (T8), mirroring the WS-3 block `:189-199` | — |
| M6 | `PICC.md` | MODIFY | §10 registry row (mirror `:474`), §23 methodology note (mirror `:942`) | — |
| M7 | `docs/specs/PICC_TRADING_SITES_CATALOG_v1.md` | MODIFY | Resolution-style note pointing at the follow store (D5, mirror its `:117-129` idiom — no schema change) | — |
| F7 | `server/__tests__/ws4LeaderSourcingSeamGuard.test.mjs` | CREATE | Seam guard (T6): no execution path; trust defaults; qualification floors; overview byte-identical | all |

### §3.2 Store shape (`leader-ideas.json`)

```json
{
  "version": 1,
  "leaders": [
    {
      "id": "leader-1",
      "label": "operator-name",
      "source": "csv",
      "followedAt": null,
      "lastPositionAt": null,
      "platformTrust": { "value": "UNVERIFIED", "at": null, "by": null, "evidence": null },
      "qualification": { "verdict": "denied", "deny": "leader:deny:trades-short (have 0, require 300)" },
      "ideas": [],
      "updatedAt": null
    }
  ]
}
```

Boot: unreadable / version ≠ 1 → UNHEALTHY (ceremony/risk mirror), mutations refuse, readout emits `leader:deny:store-unhealthy`. Default `leaders: []` — no data file, no fabricated feed. GET never writes; POSTs audit `leader:import|follow|trust`.

### §3.3 Route/payload contracts

- `GET /api/command-centre/leader-ideas` → `{ ok, at, leaders: [{ id, label, source, followedAt, lastPositionAt, status, platformTrust, qualification, guard: { autoUnfollow: {active, reason|null}, sevenDay: {active, reason|null} }, ideas }] }` (honesty: every cell real state or named deny; unhealthy store still renders per-leader denies).
- `POST /api/command-centre/leader-ideas/import` body `{ label, source: "csv"|"manual", payloadBase64 }` → `{ ok, leaderId, qualification }` or `400` named deny. 64 MB cap (`readBodyMax`, `handlers.mjs:5365-5374`), route-local body handling (`:1016` mirror).
- `POST /api/command-centre/leader-ideas/follow` body `{ leaderId }` → sets `followedAt = now` (human-flips-last-switch; only after a qualified import).
- `POST /api/command-centre/leader-ideas/trust` body `{ leaderId, value: "VERIFIED"|"ADVERSARIAL", evidence }` → operator store-write, audited; UNVERIFIED cannot be re-written to itself meaningfully (no-op).

Env vars (`.env.example` block, defaults pinned by F7): `PICC_LEADER_AUTO_UNFOLLOW_DAYS=21`, `PICC_LEADER_7D_STOP_PCT=5`. No HIP vars — the stub is not wired (D8).

---

## §4 Acceptance criteria

| AC | Criterion | Test file |
|---|---|---|
| AC-0 | Store boots on first run with `leaders: []` and health ok; corrupt/version≠1 file → UNHEALTHY, mutations refuse, readout denies; re-boot survival; default `platformTrust.value === "UNVERIFIED"` with null `at/by/evidence`; trust write is gated to VERIFIED/ADVERSARIAL with evidence string; audit events `leader:*` appended | `server/__tests__/leaderIdeasState.test.mjs` |
| AC-1 | `leaderFeedContract.mjs`: `CONTRACT_MEMBERS` frozen incl. `provenance`; `validateLeaderFeed` accepts csv/manual, accepts hip stub, rejects unknown provenance; registry get/register; HIP fetch returns exact `leader:deny:hip-not-wired — endpoint contract unverified` reason | `server/__tests__/leaderFeedContract.test.mjs` |
| AC-2 | `qualifyLeader` reuses `analytics.metricsFrom` results: trades ≥300 AND maxDrawdown <15 AND expectancy >0 → `qualified`; each shortfall → exact named deny (first-deny wins, stable strings); zero rows → `leader:deny:trades-short`; MDD measured on the same peak-anchored series as `riskState.drawdownFromPeakPct` (fixture cross-check) | `server/__tests__/leaderQualification.test.mjs` |
| AC-3 | CSV import: valid feed lands store + audit; row missing `feesUsd`/`pnlAfterCosts` → `leader:deny:costs-unaccounted` (feed rejected, store unchanged); unknown asset → `leader:deny:unknown-asset`; >64 MB → 413; import never sets `platformTrust`, never sets `followedAt`; re-import re-evaluates qualification; audit chain intact | `server/__tests__/csvFeedImport.test.mjs` |
| AC-4 | GET readout (auth): per-leader `{ status, platformTrust, qualification, guard, ideas }`; unhealthy store → `ok:true` with per-leader `leader:deny:store-unhealthy` denies (never a silent all-pass); 401 without auth; overview route byte-identical; GET is proven read-only (file untouched, probe) | `server/__tests__/leaderIdeasRoute.test.mjs` |
| AC-5 | Auto-unfollow: `lastPositionAt` >21 UTC days (or null) → `status:"auto-unfollowed"` + exact reason; <21d → `followed`; environment override honored with named `invalid-environment` deny on bad value; 7-day stop: trailing-7d closed-idea pnl breaching 5% of equity → suppressed rows + `leader:idea-suppressed:7d-stop`; recovered window → rows surface again | `server/__tests__/leaderGuard.test.mjs` |
| AC-6 | Panel: renders readout; denied leader shows deny reason verbatim; `UNVERIFIED` shows muted unverified badge (no deny, no pass); `ADVERSARIAL`/suppressed rows show reason; empty store → `not-wired`; error state → `not-wired — …` (mirror `UnlockCeremony.tsx:35-53`) | `src/components/__tests__/LeaderIdeasPanel.test.tsx` |
| AC-7 | Seam guard: (a) no module under WS-4 imports/exposes an execution or order path (grep-pinned: no `placeOrder`/`mirror`/`execute` reachable from F1–F5); (b) `platformTrust` default UNVERIFIED and only trust-POST writes it (source-pinned); (c) qualification floors = locked defaults with env unset; (d) overview/aggregate compose byte-identical; (e) HIP stub reason exact | `server/__tests__/ws4LeaderSourcingSeamGuard.test.mjs` |
| AC-8 | PICC.md §10 row for this spec + §23 methodology note; `.env.example` WS-4 block; catalog resolution note added — catalog schema §2 unchanged (assert: `verified` field lines untouched) | `npx vitest run --maxWorkers=1; npm run typecheck` (serial floor from `apps/dashboard`, ws1 §8.3); `verifyAudit()` green (WS-2 §9) |

---

## §5 Tasks

**T0 — Follower store (`F1`).** Acceptance per R1/R7/AC-0: boot health + version; per-leader records incl. `platformTrust` default UNVERIFIED and write-gate; UNHEALTHY refuse-mutations; re-boot survival; `resetLeaderIdeasState` test seam; audit on transitions. Tests: `server/__tests__/leaderIdeasState.test.mjs` (≥12). Command: `npx vitest run __tests__/leaderIdeasState.test.mjs`.

**T1 — Feed contract + registry (`F2`).** Acceptance per R2/AC-1: `CONTRACT_MEMBERS` frozen with provenance; CSV row shape; `validateLeaderFeed`; registry; HIP stub with exact deny. Tests: `server/__tests__/leaderFeedContract.test.mjs` (≥6). Command: `npx vitest run __tests__/leaderFeedContract.test.mjs`.

**T2 — Qualification (`F3`).** Acceptance per R4/AC-2: pure qualifier over `analytics.metricsFrom`; three named denies stable; fixture cross-check vs `riskState.drawdownFromPeakPct` semantics. Tests: `server/__tests__/leaderQualification.test.mjs` (≥9; zero-row and boundary cases first — <300, =15% MDD, expectancy 0). Command: `npx vitest run __tests__/leaderQualification.test.mjs`.

**T3 — CSV/JSON importer (`F4`).** Acceptance per R3/AC-3: parse-validate-qualify-store-audit chain; cost-accounting denies; asset denies; 64 MB cap; never sets trust/followedAt. Tests: `server/__tests__/csvFeedImport.test.mjs` (≥8). Command: `npx vitest run __tests__/csvFeedImport.test.mjs`.

**T4 — Guard + routes (`F5`, `M1`, `M2`).** Acceptance per R5/R6/R8/AC-4/AC-5: pure guard (auto-unfollow window + 7d stop) with env validation; GET readout (mirror `:1607-1650`); POST import (route-local body, `readBodyMax` cap), follow, trust — all auth + audited; store boot import beside `index.mjs:11`; overview byte-identical. Tests: `server/__tests__/leaderGuard.test.mjs` (≥10) + `server/__tests__/leaderIdeasRoute.test.mjs` (≥7, fixture store). Commands: the two vitest runs above; then `npx vitest run __tests__/commandCentreOverview.test.mjs` untouched-green.

**T5 — Client + panel (`M3`, `F6`, `M4`).** Acceptance per R8.2/AC-6: api.ts types + calls; `LeaderIdeasPanel` mounted in `CommandCentreRoom.tsx` beside `UnlockCeremony`; honesty cells; muted unverified badge. Tests: `src/components/__tests__/LeaderIdeasPanel.test.tsx` (≥5). Command: `npx vitest run src/components/__tests__/LeaderIdeasPanel.test.tsx`.

**T6 — Seam guard (`F7`).** Acceptance per AC-7: assert (a) no execution path reachable from WS-4 modules, (b) trust default + write-gate, (c) floors are locked defaults, (d) overview/aggregate compose byte-identical, (e) HIP stub reason exact. Tests: `server/__tests__/ws4LeaderSourcingSeamGuard.test.mjs` (≥12). Command: `npx vitest run __tests__/ws4LeaderSourcingSeamGuard.test.mjs`.

**T7 — Floor + docs (`M5`, `M6`, `M7`).** Acceptance per AC-8: `.env.example` WS-4 block; PICC.md §10 row + §23 note; catalog resolution note with schema §2 untouched. Commands: `npx vitest run --maxWorkers=1; npm run typecheck` (serial floor from `apps/dashboard`); `verifyAudit()` green (WS-2 §9).

---

## §6 Bisect matrix

One owner per file; zero hard conflicts — every file appears once, and shared-file tasks are single-owner sequential (M1 tasks coalesce into T4).

| File | Owner | T0 | T1 | T2 | T3 | T4 | T5 | T6 | T7 |
|---|---|---|---|---|---|---|---|---|---|
| F1 `leaderIdeasState.mjs` | A | ✓ | | | | | | | |
| F2 `leaderFeedContract.mjs` | A | | ✓ | | | | | | |
| F3 `leaderQualification.mjs` | A | | | ✓ | | | | | |
| F4 `csvFeedImport.mjs` | A | | | | ✓ | | | | |
| F5 `leaderGuard.mjs` | A | | | | | ✓ | | | |
| M2 `server/index.mjs` | A | | | | | ✓ | | | |
| M1 `server/handlers.mjs` | A | | | | | ✓ | | | |
| M3 `src/lib/api.ts` | B | | | | | | ✓ | | |
| F6 `LeaderIdeasPanel.tsx` | B | | | | | | ✓ | | |
| M4 `CommandCentreRoom.tsx` | B | | | | | | ✓ | | |
| F7 `ws4LeaderSourcingSeamGuard.test.mjs` | C | | | | | | | ✓ | |
| M5 `.env.example` | A | | | | | | | | ✓ |
| M6 `PICC.md` | A | | | | | | | | ✓ |
| M7 catalog spec note | A | | | | | | | | ✓ |

Ordering edges (task → must-precede): T3←{T0,T1,T2}; T4←{T0,T2,T3}; T5←T4 (route contract); T6←all of F1–F5+M1; T7←T6 (floor proof). Owners: A = store/gate/importer author (server services + handlers + boot + docs), B = client author (api.ts + panel + mount), C = QA seam-guard author. B starts only after T4's route contract lands; A and C never touch the same file in the same task.

---

## §7 Risks

1. **MDD/expectancy semantics drift.** If the qualifier re-implements instead of reusing `analytics.metricsFrom`, the 15% floor can disagree with the rest of the suite. Guard: T2 fixture cross-checks `maxDrawdown` against `riskState.drawdownFromPeakPct` on the same series (AC-2).
2. **A cost-blind feed qualifies.** "After costs" is contract + importer territory; a feed that omits `feesUsd`/`pnlAfterCosts` must never qualify. Guard: `leader:deny:costs-unaccounted` enforced pre-qualification (AC-3) — a re-imported empty-cost feed is a named deny, not a silent pass.
3. **Auto-unfollow state divergence (display vs store).** On-read evaluation without a write means the readout can say `auto-unfollowed` while the file still says `followed`. Guard: R5.2 (transition persists on next mutation) + a GET read-only probe in AC-4 — documented divergence, never silent.
4. **The 5% stop misread as a WS-2 rail.** A display guard could be mistaken for the day-loss barrier. Guard: T6 seam-guard (d) + Non-goals pin gates 16–19/sidecar/perps untouched; WS-4 has no execution path, so the stop is toothless by construction (R6.2).
5. **New upload body surface.** A second body-handling path invites readBody/readBodyMax confusion (`handlers.mjs:1016` ternary serves only `/api/browser/upload`). Guard: route-local body handling with `readBodyMax` cap (R3.1, AC-3 64 MB/413 test).
6. **ADVERSARIAL flag mistaken for enforcement.** With no execution path, "suppression" is the only enforcement that exists. Guard FAQ: suppressed ideas never reach the panel; the seam guard proves no mirror path can exist (AC-7a).
7. **Boot-order absence.** If the store module isn't imported at boot (beside `index.mjs:11`), the data dir/health conventions can misbehave in prod while tests pass (test imports self-wire). Guard: M2 in T4 + route test with fixture store.

---

## §8 Honesty notes

1. **No HIP endpoint is verified in WS-4.** The HIP adapter is a stub returning the exact `leader:deny:hip-not-wired — endpoint contract unverified` deny; the `wsConnect` header-control transport (`wsclient.mjs:207`) is documented, not wired. Nothing in WS-4 claims a live HIP feed.
2. **No leader data exists.** Store starts empty; every surface cell renders `not-wired`/empty/denied until the operator imports a real feed. No fabricated fixture feed ships in runtime data (test fixtures only).
3. **Trust is operator-recorded, never inferred.** `platformTrust` evidence is an external-evidence index the operator performs (regulator/public register + trade-history proof); code only records outcome + index (ADR-0005 machine-half / human-half split, same as ceremony R11.4).
4. **The 5% stop is display suppression only** — this spec does not claim a trade rail; the seam guard pins that no rail can exist.
5. **No credentials, tokens, wallets, or account numbers** appear in this spec; live values are cited by line reference, never copied (mirrors WS-2 §8/WS-3 §8).
6. **Overview byte-identical** (AC-4/AC-8) — additive-only per ADR-0005, proven by untouched-green compose tests.

---

## §9 Resolution (owner sign-off)

**Approved by owner on 2026-09-23** — D1–D8 ratified as written. Spec status flips from DRAFT to ACTIVE; T0–T7 execute in order; floor = {n} files / {n} passed, typecheck green, `verifyAudit()` green, PICC.md §10 + §23 updated. No hard conflicts in the §6 matrix — single pass, subagent-driven.

**Status (final, set at ship):** ACTIVE — (T0–T7 landed …) or per-file resolution notes appended below as tasks land.