# PICC Suite + Ministry Model & IA Rebuild — spec v1

> **Status/Resolution (2026-09-19):** PASSED-INTO-IMPL — partially executed (post-D1). Trust scope: written speculation unless executed/verified. Executed slices: ministry shell + inner sidebar (`1a382b8`), ministry rooms + suites landing + in-app browser rerouting (`47fbe3d`), studio as a cross-suite universal resource (`52091a3`), legacy bandwidth suite retired (`a11721e`, as cited below). Pending/aspirational: the authority/consent governance (autopilot/copilot flip-switch, confidence gates), sovereign envelope, and de-localized agent governance — VOTED-SAVE, untouched by code.

**Scope:** Rebuild PICC as a country of *ministries* (suites) over a shared spine. Establishes (a) the 3-suite inventory — **Trading** (production), **Earnings** (broad income ministry), **Intelligence for PICC** (prime-minister/governor suite) — with expandability, (b) the governance model (localized vs. de-localized agents, the *governor*, the *Godlike* user), (c) the authority/consent model (per-suite **autopilot/copilot flip-switch**, confidence-gated, sovereign envelope), (d) the two-level route/nav IA, (e) per-ministry encapsulation + shared spine, (f) the folding rules that retired the old category suites. Write-only planning artifact — no code changes in this session.

**Supersedes / retires:** `docs/specs/PICC_BANDWIDTH_SUITE_design_v1.md` (bandwidth suite removed in commit `a11721e`). This spec defines what comes after that removal.

**Extends / relates to:** `PICC.md` (master spec, root), `docs/specs/PICC_FRONTEND_UI_ENGINE.md`, `docs/specs/COMMAND_CENTRE_WEB_SPEC.md` (note: Command Centre runtime is currently **dysfunctional** — see Spine, §5), `docs/specs/PICC_INCOME_GENERALIZATION_*` (income/`StreamCategory` vocabulary), `docs/specs/PICC_UNIVERSAL_4FA_ENGINE.md` (advisory-first posture, honesty keys), `PICC_SESSION_POLICY_AND_CHANNEL_CATALOG.md` (session policy).

**Grounding rule (per PICC convention):** every `file:line` below was read this session or is explicitly marked **UNVERIFIED**. Anything not re-read this session is **UNVERIFIED** and must be re-verified as a gate in its slice. The mission brief (this conversation's confirmed decisions) is the authoritative requirement. Where a requirement depends on a currently-dysfunctional subsystem (Command Centre runtime), it is stated as a *design target*, not an assumption that the subsystem works.

---

## Requirements

| ID | Requirement (user-visible, testable) |
|----|---------------------------------------|
| REQ-1 | **Ministry inventory.** The Suites group contains exactly three ministry entries: **Trading**, **Earnings**, **Intelligence for PICC**. The set is expandable (future ministries add entries, not structural change). No other suite appears in the Suites group. |
| REQ-2 | **Each ministry is a full workspace.** Dedicated dashboard, dedicated inner sidebar, per-ministry routes under `/suites/:suiteId/...`, per-ministry **settings**, per-ministry **simulator**. No simulation exists outside a ministry. |
| REQ-3 | **Intelligence is the master/prime-minister suite.** It spans and coordinates all other ministries; it hosts the general (de-localized, superior) agent. It has its own dashboard + sidebar like any ministry. |
| REQ-4 | **Governance:** the *governor* (in Intelligence) can coordinate ministries and *suggest* strategy, but the user is *Godlike* — final authority on **high-level/strategical** decisions. The governor is EIS/DSS (coarse-granularity, OLAP, analytical). |
| REQ-5 | **Authority model (per-suite):** each ministry's Settings exposes an **autopilot/copilot flip-switch**. `autopilot` = use autopilots wherever supported, fallback to copilot otherwise; `copilot` = 100% copilot (advisory; user executes). |
| REQ-6 | **Confidence-gated autopilot:** autopilot proceeds only when the governor is confident it can *endure the profitability with the risk level considered*. Confidence is assured by all the ministry's features (prediction, analysis, interpretation). Low-confidence signals never run hot. |
| REQ-7 | **Zero-to-one:** the Intelligence/executive surface assists the user toward profitability from first use, without any onboarding/quick-setup wizard. |
| REQ-8 | **Cumulative dashboard:** income is managed per-ministry and summed across ministries on a cumulative/executive view. No top-level Income page (REQ-9). |
| REQ-9 | **Page consolidation:** the top-level **Simulator** and **Income** pages are removed. Agents page removed. Simulators exist only per-ministry. |
| REQ-10 | **Sidebar IA:** outer sidebar groups — Command (Dashboard, Opportunities), Suites (one entry per ministry), Account (Settings [PICC-scoped], Profile). Profile navlink stays in the sidebar. |
| REQ-11 | **Two-level nesting:** `/suites/:suiteId` is the suite shell owning an inner sidebar + sub-routes. Entering a suite auto-collapses the outer sidebar; inner sidebar auto-expands. Manually expanding the outer sidebar inside a suite auto-collapses the inner. Collapse state is remembered per the user's deliberate choice. |
| REQ-12 | **Whole-app search:** the header search (in the suite context) searches the ENTIRE app (all ministries), never suite-scoped. Redesigned for nested context. |
| REQ-13 | **Per-ministry agentic capability + interaction:** each ministry has agents localized to its purpose; cross-ministry interaction is mediated by the de-localized general agent in Intelligence. Earnings may emulate/spawn sub-agents for a particular task in its broad field. |
| REQ-14 | **Extension generalization — SUPERSEDED by the D1 clean break (2026-09-17).** The overlay extension was removed; the requirement survives as **capture/studio generalization**: per-ministry catalogs/controls managed in per-ministry Settings, served by the browser studio + capture catalog (`studioCaptureCatalog()` in `captureProfiles.mjs`) instead of an extension. |
| REQ-15 | **Folding of old category suites (rule A):** depin removed (no hardware, laptop tiers = bandwidth yield); nft/royalties, defi/yield, crypto-staking, p2p-lending, and agent-**income** fold into **Earnings** as income sub-families (documented there); crypto **execution** folds into Trading; `other`(Site) is not a ministry. |
| REQ-16 | **Go-live gate (Trading):** Trading stays paper/demo until it is mature, viable, trusted, production-grade, **and** profitable, **and** the user approves. The real-money funding path (bank→Transak→Rabby→Arbitrum→Hyperliquid→ccxt) is **parked** as a future gate, not an immediate feature blocker. No real-money path is built or weakened before this gate. |

---

## Design

### Decision A — Ministry model: country + governor (chosen)

PICC is a country. **Ministries** = encapsulated workspaces, each with (a) a core purpose, (b) resources/relations optimized for that purpose, (c) **localized agents** specific to it (lower superiority), and (d) its own dashboard, sidebar, settings, simulator. Ministries cooperate **only in relevant endeavors**, mediated by the **governor**.

The **governor** (ruler) lives in the **Intelligence for PICC** ministry as a **general, de-localized, superior agent** — it provides decision capability, governance, and higher-level (strategical) features. The **user is Godlike**: above the ruler, holding final authority over high-level/strategical decisions. Technically the governor operates at the **EIS/DSS layer** — coarse-granularity, OLAP, analytical — aggregating across ministries and *suggesting*, never overriding the user.

**Rejected:** (b) flat suite list with no hierarchy (fails REQ-3/REQ-4 — no coordination or strategic layer); (c) standalone autonomous agents with no governor (fails REQ-4/REQ-6 — no sovereignty/confidence boundary).

### Decision B — Authority/consent: per-suite flip-switch + sovereign envelope (chosen)

Every ministry's Settings carries an **autopilot/copilot flip-switch** and a **confidence threshold**:

- **autopilot** mode: use autopilots wherever supported; **fallback to copilot** otherwise.
- **copilot** mode: 100% copilot — advisory only; the user executes every consequential action.

The governor executes autonomously only **within its sovereign envelope**: (1) the ministry's flip-switch allows autopilot, (2) the governor's **confidence** that it can endure the profitability given the risk is above the configured threshold, and (3) nothing crosses the user's Godlike strategic boundary. Low-confidence signals fall back to copilot (never run hot). This is the safety keystone — it lets predictive/analytical income ministries act without gambling.

**Rejected:** (b) unconditional governor sovereignty (fails REQ-6 safety — could execute low-confidence strategies); (c) strictly manual-only (fails the user's intent that ministries "can cooperate" through the sovereign while safety is preserved).

### Decision C — Folding of old category suites (rule A), chosen

Applied to the pre-existing `SUITE_META` ids (`apps/dashboard/src/lib/suites.ts`):

| Old id | Outcome | Basis |
|--------|---------|-------|
| `trading` | Keep — production ministry | Existing suite becomes the Trading ministry |
| `depin` | **Remove** | No GPU/server/hotspot hardware; laptop tiers are the bandwidth-yield family ($3–25/mo). 2026 research: high-yield tiers need $1.6k–8k capex. |
| `nft` (royalties) | Fold → Earnings | Royalties/content = income sub-family |
| `defi` (yield) | Fold → Earnings | Yield/interest = income sub-family |
| `crypto` | Split-fold | Staking yield → Earnings; execution → Trading |
| `p2p` (lending) | Fold → Earnings | Interest/lending = income sub-family |
| `agent` | Fold | Agent-**income** → Earnings; agentic-**capability** → cross-cutting + Intelligence |
| `other` (Site) | Remove as ministry | Generic site intelligence, no distinct ministry purpose; resides at platform level |

Under rule A the three-way test is: (1) relevant? (2) different purpose with no conflict → include as under-development suite; (3) conceptually similar to a ministry's core purpose → **append into that ministry's docs**, not a separate suite. DePIN is removed (test 1 fails — no hardware).

### Decision D — IA & routing (chosen)

Outer sidebar groups: **Command** (Dashboard, Opportunities), **Suites** (one entry per ministry: Trading, Earnings, Intelligence), **Account** (Settings [PICC-scoped], Profile). Agents page removed; top-level Simulator + Income removed.

Two-level nesting: `/suites/:suiteId` shell owns an inner sidebar + sub-routes. Trading example: `/suites/trading/dashboard|markets|paper|autopilot|command-centre|simulator|settings`. Pseudo-full-takeover: entering a suite auto-collapses the outer sidebar and auto-expands the inner; manually expanding the outer inside a suite auto-collapses the inner. Header search is **whole-app** (REQ-12).

**Rejected:** (b) flat top-level routes for every page (fails REQ-2/REQ-11 — no ministry enclosure); (c) suite-scoped search (fails REQ-12).

### Decision E — Shared spine versus dysfunctional Command Centre (chosen target)

The "country" shares resources/relations/flows — agents, models, systems, addons, workflows, algorithms, architectures, services. **Honest state:** the Command Centre runtime (`server/services/commandCentre/`) is currently **dysfunctional** per the user; it must **not** be assumed working. This spec treats the shared spine as a **design target**: ministries are encoded as encapsulated fronts over one shared spine, and the spine's repair/coherence is a tracked workstream (not silently reused). Crucially, ministries are **encapsulated** so a broken shared subsystem degrades ministry function honestly, not by fabrication.

### Decision F — Go-live gate (parked, not a blocker)

The Trading real-money funding path fails at the bank: **Mastercard (direct + GPay), auth approved by bank, then Transak rejects** — the signature of an issuer-side block on a foreign crypto on-ramp merchant category. **Recommendation when the user elects go-live:** fund via BNM-licensed exchange (Luno/MX Global) using direct bank transfer (DuitNow/FPX), not card → Transak; then withdraw to Rabby → Arbitrum → Hyperliquid → ccxt. **This is parked** (REQ-16). No feature work is spent on funding until the go-live gate is tripped by the user.

---

## Non-goals

- **No real-money execution.** Trading stays paper/demo (REQ-16). The advisory posture of `PICC_UNIVERSAL_4FA_ENGINE.md` is unchanged; nothing recovers a sovereign real-money path before the gate.
- **No funding/on-ramp build now.** Parking per Decision F.
- **No onboarding/quick-setup wizard.** `zero-to-one` is strategy + progress-to-profitability, not onboarding (REQ-7).
- **No fabricated numbers, ever.** Unconfigured ≠ zero; `source:"none"` honest emptiness is a feature (corpus-wide invariant).
- **No weakening of demo/live gates, honesty labels, or rate limiters** to make tests pass.
- **Command Centre** is a design target, not an assumed-working dependency (Decision E).

---

## Tasks

### Phase 1 (P1 — the IA + ministry shell; structural)

#### T1 — Ministry registry (`apps/dashboard/src/lib/suites.ts`)
Rework `SUITE_META` into the ministry inventory: `trading` (production), `earnings` (broad income ministry, under development), `intelligence` (master/prime-minister suite). Remove `depin`; remove/retire `nft`, `defi`, `crypto`, `p2p`, `agent`, `other` as *ministry ids* (their income families live under Earnings' docs). Keep the mapping in a single source of truth. Retire the obsolete `PICC_BANDWIDTH_SUITE_design_v1.md`.
**Acceptance:** `SUITE_META` keys = exactly the 3 ministry ids; grep asserts no leftover `depin|p2p|defi|nft` references in suite nav; metadata carries a `status` field (`production` | `under-development`) and `blurb`.

#### T2 — Route tree to two-level nesting (`apps/dashboard/src/App.tsx`)
Restructure routes: `/suites/:suiteId/...` owns the ministry shell. Remove top-level `simulator`, `agents`, `income` routes. Add `/suites/` redirect for legacy `/trading`. Each ministry route guarded by its feature via `RequireFeature`.
**Acceptance:** route test / grep — no top-level `simulator|agents|income` route; `/suites/:suiteId` resolves; `/trading` redirects to `/suites` (or its ministry); unknown `/suites/:id` falls back honestly.

#### T3 — Outer sidebar groups + profile/settings placement (`apps/dashboard/src/components/AppShell.tsx`)
Rebuild `NAV` into Command (Dashboard, Opportunities), Suites (Trading/Earnings/Intelligence), Account (Settings, Profile). Remove Agents, Income, top-level Simulator entries. Keep feature-gating; keep Profile navlink in Account.
**Acceptance:** grep `NAV` shows only the required items; each ministry entry is a NavLink into `/suites/<id>`; existing `AppShell` tests updated deliberately + counted.

#### T4 — Ministry shell + inner sidebar (new `apps/dashboard/src/pages/Ministries.tsx` or per-ministry)
A ministry shell component owns: the inner sidebar (sub-routes), the per-ministry dashboard, per-ministry simulator, per-ministry settings. The Intelligence ministry is the master — same shell, coordinating surface. Pseudo-full-takeover: entering `/suites/:id` collapses the outer sidebar and expands the inner; expanding the outer collapses the inner. Collapse state remembered.
**Acceptance:** component tests — entering a suite collapses outer + expands inner; manual outer-expand collapses inner; state persisted (localStorage key scheme survives the nested model — the current single boolean `picc.sidebar.collapsed` is replaced by a per-rail scheme).

#### T5 — Cumulative / executive dashboard
A cumulative view that sums income/PnL across ministries. Income is per-ministry; this view aggregates. The Intelligence suite's dashboard is the natural home for the executive/zero-to-one surface (REQ-7/REQ-8).
**Acceptance:** aggregate math is extracted server-side and unit-tested (no fabrication on empty ministries); a ministry with no data renders honest emptiness, not 0.

#### T6 — Per-ministry settings partition (`apps/dashboard/src/pages/Settings.tsx`)
Split PICC-scoped settings (credentials, server connection, features, keys) from per-ministry settings (catalog of that ministry's sites, the autopilot/copilot flip-switch + confidence threshold per REQ-5/REQ-6). No overlap between PICC and per-ministry settings.
**Acceptance:** Settings is PICC-scoped; each ministry has its own settings surface; the flip-switch + threshold are exposed per ministry and persisted; grep asserts no per-ministry site/catalog config leaks into PICC Settings.

#### T7 — Capture/studio generalization (SUPERSEDED by D1 — rewrite as of 2026-09-17)
The original task — generalize `apps/dashboard/extensions/picc-overlay/` for all ministries — is dead: the extension was removed with the D1 clean break. The surviving requirement (per-ministry capture catalogs/controls for the browser studio, configured sites managed in per-ministry Settings, honest "not supported" reporting per ministry) now lives at the capture-catalog layer (`captureProfiles.mjs` `studioCaptureCatalog()`) + studio bridge, not an extension manifest. Reword the acceptance accordingly: per-ministry catalog entries, not extension support, and no fabrication when a ministry's sites have no capture path.

### Phase 2 (P2 — governance substrate, following the ministry shells)

- **T8 — Governor confidence + envelope (P2).** The confidence signal (REQ-6) is computed from ministry features (prediction/analysis/interpretation) and gates autopilot; falls back to copilot below threshold. Server-side, unit-tested with fixtures (no fabrication; low-confidence → copilot).
- **T9 — Localized vs. de-localized agent model (P2).** Encode per-ministry localized agents + the de-localized general agent in Intelligence mediating cross-ministry interaction (REQ-13).

### Phase 3 (P3 — funding go-live gate, user-tripped only)

- **T10 — Funding health (only when user elects go-live).** A first-class funding/on-ramp status where each hop is reported (per Decision F's recommended route). Not started until REQ-16 gate.

---

## Risks

| # | Risk | Guard |
|---|------|-------|
| R1 | **Broken Command Centre silently assumed working.** | Decision E: spine is a design target; ministry features degrade honestly, never fabricate; spine repair is a tracked workstream. |
| R2 | **Nested collapse state breaks existing behavior.** The single `picc.sidebar.collapsed` key becomes insufficient with two rails. | T4 replaces it with a per-rail scheme + remembered state; tests cover enter/expand/in-expand + persistence. |
| R3 | **Old category-suite references linger** after folding. | T1 grep accepts no leftover `depin/p2p/defi/nft` in suite nav; folding is doc-append, not stub-keeping. |
| R4 | **Autopilot runs hot on low confidence.** | T8 confidence gate + per-ministry threshold; fallback to copilot; unit-tested with a low-confidence fixture; no real money (REQ-16). |
| R5 | **Command Palette / search becomes suite-scoped.** | REQ-12 whole-app search — T2/T3 keep search global; command-palette nav updated for the new route tree. |
| R6 | **Profile/Settings grouping regressed.** | REQ-10: Profile navlink stays in Account; T3 asserts. |

---

## Honesty notes (demo/live gates touched in this design)

- No demo/live gate is weakened. Trading stays paper/demo (REQ-16).
- Fabricated-state risk lives in (a) the confidence signal (T8) and (b) cumulative dashboard math (T5). Both are pinned to real producers / extracted server-side and unit-tested with a no-data → honest-empty expectation.
- Grep-able honesty strings per slice (`status` "..."); `"source:none"` honest emptiness on empty ministry data.
- **UNVERIFIED this session (re-verify as slice gates):** `server/services/commandCentre/*` exact working-state (user says dysfunctional); capture/studio generalization surface (`studioCaptureCatalog()` in `captureProfiles.mjs` + Browser Studio) beyond what the D1 slices touched (note: the former `apps/dashboard/extensions/picc-overlay/*` reference is dead — the extension was removed); all `commandCentre` endpoints' live behavior; `PICC.md` ministry-relevant content (not re-read this session).

---

## Slice list (handoff output)

**Phase 1 (7):** T1 Ministry registry · T2 Route tree two-level · T3 Outer sidebar groups · T4 Ministry shell + inner sidebar + pseudo-takeover · T5 Cumulative/executive dashboard · T6 Per-ministry settings partition · T7 Extension generalization
**Phase 2 (2):** T8 Governor confidence + envelope · T9 Agent model (localized vs de-localized)
**Phase 3 (1, user-tripped):** T10 Funding health

**Decisions to review:** A) ministry model with governor + Godlike user; B) per-suite autopilot/copilot flip-switch + confidence-gated sovereign envelope; C) folding of old category suites (depin removed; income families → Earnings; execution → Trading; agent-capability cross-cutting); D) two-level IA + whole-app search; E) shared spine = design target, not assumed working; F) go-live funding path parked.
