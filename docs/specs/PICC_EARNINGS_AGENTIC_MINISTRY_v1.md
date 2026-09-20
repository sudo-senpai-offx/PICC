# PICC Earnings — Agentic Ministry (v1)

- **Status:** DRAFT — awaiting owner answers to Open Questions (§9). **Resolution:** ACTIVE — still the governing plan for earnings automation; §9 answered 2026-09-11; §11 tiered-router infra delivered via RESOURCE_GOVERNOR G1–G5; Phase A/B wiring unbuilt and §10-gated on trading-suite trust (now the v3.2 decision-core rebuild, ADR-0004) (**Date:** 2026-09-19)
- **Classification:** ARCHITECTURAL — a web of AI, agentic features, models and workflows inside the Earnings ministry (country-ministry concept)
- **Owner directive (this session):** "Automate as much as possible unless strict/risky where advice + manual." Semi-automatic workflows: agents prepare, humans execute the restricted class.
- **Anchors:** PICC_SUITE_MINISTRY_MODEL_v1.md — REQ-5/REQ-6 (advisory-first, sovereignty envelope), REQ-13 ("Earnings may emulate/spawn sub-agents for a particular task in its broad field"), T9 (localized vs de-localized — Phase 2, out of scope)
- **Backbone:** PICC_INCOME_GENERALIZATION_{requirements,design,checklist}_v1.md — Q5 tasks 1–13 landed (launch-gated)
- **Companion:** PICC_SUITE_AGENTS_INTEGRATION_v1.md (agent/crew registry, gate model, `agent_logs` contract) — this spec's sibling; lives under docs/specs/

## 1. Confirmed owner boundary (the L class)

Anything that **moves money, creates a payment link, publishes content, or sends something signed** is
**ADVISE + MANUAL**. Everything else **may run automatically**.

This spec encodes that as a per-step action-classification table (the Gate Model, §4). It is not a slogan:
a real code path enforces it (`/btcpay/invoice` — see §3.2), and the gate classifier is unit-tested.

## 2. Current state (verified — the honest baseline)

| Thing | State | Evidence |
|---|---|---|
| CrewAI crews | 10 crews exist in `server/services/opportunities.mjs`, wired to `agents/picc_agents/crew.py`; only `research` is reachable from the UI (Intelligence → Guidance, hardcoded) | code, verified |
| Crews relevant to earnings | `monitor` (yield_monitor + fleet_monitor), `strategist` (content strategy tied to real income streams), `content`, `bounty`, `cashclaw`, `investment`, `depin`, `trading`, `research`, `listing` | opportunities.mjs:64–77 |
| Earnings ministry UI | Dashboard (Overview/Streams/Catalog tabs), Simulator, Settings with ChannelsTab | EarningsRooms.tsx |
| Every stream's panel | blanket `ConnectorsPanel` placeholder | SUITE_PANELS |
| Stream model | `IncomeStream` (id/name/category/platform/status/balance/totalEarned/estimatedDaily/url/note) | lib/types.ts |
| Agents microservice | NOT running; needs `uvicorn server:app --port 8000` in `agents/picc_agents` + `PICC_AGENTS_URL` in dashboard .env; live crews need `OPENAI_API_KEY` in `agents/.env` | Intelligence guidance room copy |
| Raters | dashboard LLM settings exist (`/settings/llm` — providers + order + test) | api.ts:230–240 |
| depin category | dead (Q6 decision; technical/geolocation constraint) | earlier session |

## 3. Design

### 3.0 Native classification

- ARCHITECTURAL, UI-heavy → no TDD gate at spec level; unit tests are required for every component logic slice (gate classifier, workflow state machine, crew catalog integrity).
- Reuse: `listData("agent_logs")` already shows runs in Intelligence Guidance; earnings agents room writes to the same table (contract in sibling spec).

### 3.1 Phase A — Earnings → Agents room (wire existing crews)

- New room in the earnings ministry shell, same layout as the other ministries.
- Shared `AgentRunner` component (new file `src/components/agents/AgentRunner.tsx`): crew picker, per-crew input form, health-driven enable/disable (`getHealth().agents.ok`), report render, gate banner. Generalizes Intelligence Guidance's hardcoded research runner — **Intelligence refactor stays out of this slice** (no unrelated cleanup).
- Crews surfaced on the earnings agents room: `monitor` (yield leg only), `strategist`, `content`, `research` (baseline), and — pending Q1 — `bounty`/`cashclaw` (discovery/cold-start).
- Every surfaced crew gets a **gate label**: *what it automates / what it never touches* (L class).
- Honest status: agents offline → show setup instructions (same pattern as Guidance room). NEVER fake success. `agents.ok` comes from `getHealth()`, observed, not assumed.
- Acceptance: running a crew from the room produces either (a) a live report when the microservice responds, or (b) an explicit offline notice with setup steps. Nothing in between.

### 3.2 Phase B — Workflows layer (semi-automatic, the heart)

A workflow is a **bounded, gated, human-terminated loop** around one or more crews:

1. **Trigger** — manual (button), periodic (regulator with dead-band), or event (board scan hits).
2. **Prepare** — the crew produces a brief (RUN class steps may execute).
3. **Gate** — every step the brief implies is classified by the gate model (§4). L-class steps STOP here.
4. **Human executes** the L-class steps (with PICC's guidance UI — see §3.3), then confirms.
5. **Record** — every run + human confirmation lands in `agent_logs` (audit trail).
6. **Done** — the "done" cell is **flipped by the human only**; the loop is never its own acceptance officer (loop-design-check red line).

Workflow loop-safety rules (enforced in the registry, unit-tested):
- **Retry cap** per workflow (default 3); exceed → escalates to a human banner, not a retry loop.
- **Boundary + done-criterion together** (anti-Goodhart): a workflow is "done" when the human confirms the outcome AND no L-class step was auto-executed.
- **No clarification at runtime**: ambiguous steps are rendered as "needs your call — here are the options" and the human picks; the agent never guesses mid-run (loop-design-check failure mode #4).
- **Reconciliation over assertion**: crew advice quality is measured against observed outcomes (see §3.4), never against the crew's own confidence.

**The priority workflow (first slice):** the L-class triage itself. Any workflow that touches money, links,
content or signed sends is rendered as a **prepared brief + one-click human handoff**, e.g.:
"Here is the invoice you asked to create (§3.3) — the draft is ready; **you** click Create; your click is what
makes it real." The UI ships the clipboard-able draft + the button the human presses — nothing fires automatically.

### 3.3 The payment-link gate (concrete, already in the code)

Earnings Settings today has a working **Create payment link** that calls `POST /btcpay/invoice`
(api.ts:117) — it creates a REAL invoice on the owner's BTCPay node. That is an L-class action by the
owner's own boundary.

- Agents must **never** call `/btcpay/invoice`, `/btcpay/*`, or any money-moving route.
- Agents may **prepare** the invoice draft (amount, description, buyer, expiry) and hand it to the human.
- The Settings room's Create button remains **human-click-only**; the workflow layer surfaces a
  "prepared invoice pending human click" card, never a "payments sent" claim.
- Same rule class applies to: publishing content (drafts ok, publish = human), sending signed things
  (crypto-signed transactions, authenticated sends, emails/DMs per Q4).

### 3.4 Advice quality ledger (sibling to the Trading decision-accuracy ledger)

Advisory output is worthless if unmeasured. The earnings ministry gets a **brief → outcome ledger**
model (mirrors Trading's honest "predicted edge vs realized" pattern):

- Every agent brief is recorded with its predicted outcome/action.
- When the human acts + records the result, the brief is resolved (hit/miss/push).
- Calibration buckets: "80%+ confidence should be right ≥80%". Same honesty as the trading gate backtest.
- No guessed outcomes — unresolved stays unresolved.

### 3.5 Phase C — Deep automation (backlog, infra-gated)

- Feed stream balances/ledger context into crew prompts; add earnings-specific crews in `crew.py`
  (e.g., `payout_chaser`); streaming runs; runbook handoffs.
- **Launch gate:** requires agents microservice + an LLM key live. Not started = not claimed.
  No code in this phase until the infra runs and a live run is observed.

## 4. Gate model (unit-tested classifier)

| Class | Example steps | Runs automatically? |
|---|---|---|
| RUN | read balances, scan boards, draft text, compute, monitor, generate briefs | YES (bounded) |
| ADVISE+MANUAL (L) | move money, create payment link/invoice, publish content, send signed/authed things, place orders, withdraw, sign tx | NO — brief + human executes |

The classifier input is a step (`{crew, action, target}`) → output `{class: "RUN" | "L", reason}`.
Registry entries declare their owned steps; the classifier is tested with a table of positive/negative cases
(L-class words: pay, invoice, publish, send, withdraw, sign, order, approve... — plus negation tests).

## 5. Dropped from the earnings surface

- `fleet_monitor` (DePIN leg) and `depin` crew — owner-confirmed: depin is dead (technical/geolocation
  constraint). They do not appear on the earnings agents room or in workflow registry.
- `investment` crew — evaluated but parked unless Q1 puts it on the surface.

## 6. Honest status rules

- `agents.ok` from `getHealth()` is the ONLY source for "online". Offline → setup instructions, never a
  simulated report.
- If the crew microservice is unreachable, the room renders the honest gate (like Guidance room today).
- No report is rendered unless the backend actually returned one; no "should work" claims.

## 7. Slices (each with acceptance + narrow test)

- **A1** — `AgentRunner` component + unit test (crew list, input render, health gate, offline banner).
- **A2** — Earnings Agents room wiring `monitor`/`strategist`/`content`/`research` (+Q1's extras) + gate labels + smoke test (vitest) + real-service walk when infra is up.
- **B1** — workflow registry (`src/lib/earningsWorkflows.ts`) + gate classifier + unit tests.
- **B2** — first workflow end-to-end: "prepare BTCPay invoice brief → human click → agent_logs record" + test.
- **C1+** — backlog only; acceptance = live observed run, nothing else.

## 8. Doc + naming alignment

- Sibling spec `PICC_SUITE_AGENTS_INTEGRATION_v1.md` carries the shared agent/crew registry + `agent_logs`
  contract so Intelligence and Earnings share one source of truth (no duplicated contracts).

## 9. Open questions — status (2026-09-11, owner answered)

1. **Discovery crews — ANSWERED (yes, gated).** Include `bounty`/`cashclaw`, but wiring must be grounded in
   planning / webfetching / research / studying (not blind surface), with additional context and features
   considered. Going **live** with earnings automation gates on trading-suite trust (§10).
2. **Infra — ANSWERED.** Strictly 24/7 cross-provider with rate-limit optimizations + smart cloud-local
   fallback; owner approves installing local models ("not too heavy, but sufficient for PICC's ideal sweet
   spot"). Design in §11; Cactus Needle researched (§11.3).
3. **Workflows — PENDING owner approval.** Context provided in Appendix A (§12): triggers, steps, gates,
   effort, dependencies per workflow. Owner reviews and confirms order.
4. **L-class scope — ANSWERED ("Both").** Emails/DMs AND any signed/authenticated send. Full enumeration
   in Appendix B (§13).
5. **Algory RE — ANSWERED (scope = "everything").** Full-spec deliverable, AI-agent-readable, feeding
   trading-suite improvement. Separate project spec: `PICC_ALGORY_REVERSE_ENGINEERING_v1.md`.

## 10. Owner decisions — the trading trust gate

- Earnings **live capability** (RUN-class automated earnings workflows, live crews beyond research)
  **gates on trading-suite trust**: every demo-related feature proven working AND demo balance ends higher
  than start (realized edge; owner accepts risk is unavoidable in trading). Until the gate passes,
  earnings agents render advice/discovery only — no automated money-adjacent workflow claims.
- Consequence: **Trading-suite functionalization is the critical path** for earnings automation, and for
  the DAG of everything downstream. This spec's Phase A/B wiring exists to be switched live the moment
  the gate passes.

## 11. Infra — 24/7 cross-provider LLM gateway (Q2)

### 11.1 Requirements (owner, verbatim intent)
- Strictly 24/7 — live crews must never stall for a missing provider.
- Cross-provider with rate-limit optimizations.
- Smart cloud→local fallback.
- Local models approved to install — not too heavy, sufficient for PICC's sweet-spot usage.

### 11.2 Design — tiered router (agents microservice; config surface = dashboard `/settings/llm`)
- **Tier 0 — on-device tool-calling (new):** Cactus Needle 2 in `agents/picc_agents` for
  tool-calling / structured extraction / micro-decisions. Confidence-gated by design: calibrated
  confidence per response → act above threshold, escalate below. This is the "smart fallback" primitive.
- **Tier 1 — cloud (primary):** router over configured providers (OpenAI, Groq/llama-3.3-70b-versatile,
  + any added) with per-provider rate/credit budgets, 429-aware retry with backoff, failover on error,
  per-provider circuit breaker. 24/7 invariant: ≥2 providers configured; a single provider outage or
  exhausted key never halts a crew (the Serper 400 is the anti-pattern lesson).
- **Tier 2 — local heavy fallback (approved, optional):** one sweet-spot local model (owner picks size;
  candidate class Q4_K_M 7–8B via LM Studio/llama.cpp) as final fallback when cloud tiers are down/unset.
- Verdict routing: Tier-0 confidence gates every call; escalation path Tier 0 → Tier 1 → Tier 2 → honest
  "unavailable" (never a stall, never a fabricated result).

### 11.3 Cactus Needle — research findings (verified: cactuscompute.com/needle, GitHub, arXiv:2607.18363)
- **Needle 2:** open 45M-param model for tool calling, device use, structured extraction. Single 14 MB
  binary, ~28 MB session RAM, 500+ tok/s decode on Raspberry Pi 5, runs in WebAssembly in-browser.
- Apache-2.0; `pip install cactus-needle`; fine-tunable on your own data on a laptop in minutes→hours
  (fine-tune lifts +21–58 pts; beats DeepSeek V4 Flash on 3/4 tool-calling benchmarks at 45M params).
- **Native confidence-gating + escalation** ("act above threshold, ask again or escalate to cloud below")
  — matches the owner's smart cloud-local fallback requirement exactly.
- PICC fit: Tier-0 crew router for typed tool calls / extraction steps (classified outputs, arg filling,
  enum pick), which is precisely the "retrieval and assembly" workload Needle is trained for. Reasoning
  synthesis and long reports stay on Tier 1/2. Not suitable (and not needed) for frontier reasoning.

## 12. Appendix A — workflow context (Q3; owner reviews order)

Common invariant for all: crew steps are RUN (bounded, logged); L-class steps stop at a human handoff
card; the human executes; `agent_logs` records; the "done" cell is human-flipped.

1. **Invoice/link prep** — Trigger: manual or sale event. Steps: amounts/line items from your records
   (RUN) → draft description + BTCPay payload ready for paste (RUN, prepare only) → **human clicks
   Create / pastes into the BTCPay store** (L: creates a payment link) → record. Effort: small (draft
   logic only; the real `/btcpay/invoice` stays human-click-only as today). Dep: BTCPay node currently
   "unreachable" (Profile panel) — draft-first works even offline.
2. **Payout/owed-money digest** — Trigger: daily regulator. Reads: stream balances + payout schedules +
   rates (RUN). Output: "owed today/overdue" brief (RUN). No money moves. Effort: medium (streams data
   is local; rates via existing CoinGecko/ccxt legs).
3. **Content-prep** — Trigger: weekly or manual. `content`/`strategist` draft posts/scripts/reviews
   (RUN) → **human publishes** (L: publishes content). Drafts stored locally; publish buttons never fire.
   Effort: small (crews exist).
4. **Opportunity vetting briefs** — Trigger: manual/board scan. `bounty`/`cashclaw` scan public boards,
   filter by your skills, ranked shortlist + first steps (RUN). Accepting/joining a task = L (commitment)
   → human executes. Effort: small (crews + d-bounties catalog ready).
5. **Monthly earnings review → strategy brief** — Trigger: monthly. Aggregates ledger + streams +
   resolved briefs → `strategist` strategy brief (RUN). No L steps. Effort: small-medium (needs the
   advice-quality ledger §3.4).

Owner: approve order 1→5, reorder, or drop/add.

## 13. Appendix B — L-class enumeration (Q4: "Both")

Everything below: agents **prepare**; the **human executes**. Non-exhaustive by design — the classifier
word list drives it (unit-tested positive/negative cases).

- **Move money:** transfer, withdraw, deposit, pay, purchase, buy/sell with funds, tip, donate, buy
  crypto, send value.
- **Create payment links / invoices:** any `/btcpay/*` invoice call, link generation, charge flows.
- **Publish content:** post, publish, schedule-publish, ship a listing, upload video, go-live, deploy.
- **Send anything signed/authenticated:** emails, DMs, comments sent as you, signed transactions
  (crypto signers, order signatures), state-changing API calls with your auth, approvals, acceptances,
  commitments, bookings.
- Exception (runs): fully reversible, no-reputation, zero-value reads (GET-style observability only).

## Resolution (2026-09-19)

**Disposition:** ACTIVE — this is the standing source of truth for the earnings-ministry automation plan. Remaining work is intentional and unbuilt: Phase A (AgentRunner + the earnings agents room) and Phase B (workflow registry `earningsWorkflows.ts`, gate classifier, advice-quality ledger). §10 gates live capability on **trading-suite trust** — which is currently the v3.2 decision-core rebuild (ADR-0004) and therefore the thing holding this ministry's automation keyed.

**Evidence:** (1) the only commit ever touching this file is `ed81b5f` (batch docs write); no implementation commit references it. (2) `src/components/agents/AgentRunner.tsx` and `src/lib/earningsWorkflows.ts` DO NOT EXIST (globbed this session); `ministry/EarningsRooms.tsx` has only overview/streams/catalog/settings/simulator tabs — no agents room. (3) The §11 tiered-router infrastructure landed through the Governor instead: `server/services/resourceGovernor.mjs` (routeTask/recordCall/governorStats), `llm.mjs:53-74,134-136` (G2), `ResourceGovernorPanel.tsx`, pack registry (Pack 1, `0729544`) — so §11 is effectively implemented, not pending. (4) Owner answers confirmed: depin/fleet_monitor dropped (Q6), investment parked (Q1), Algory RE split out to its own spec.

**Successor / gate:** the trading-suite trust gate (§10) is now represented by ADR-0004 + `PICC_V3_2_LAYERED_ENGINE_REBUILD_v1.md`; the ministry's A/B wiring is designed to be switched live the moment that gate passes.