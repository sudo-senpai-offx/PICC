# Compliance

This document records the legal posture PICC is designed around. It is **not legal advice** — verify with a qualified Malaysian (or local) lawyer before launch, especially for the Malaysian market.

## The core principle

PICC is a **decision-support tool**, not an automated decision-making system:

- It **does not make decisions** — it visualizes data and proposes options.
- It **does not execute** trades, purchases, or publishing — the user clicks the final button on their own brokerage / marketplace / platform.
- Every AI output is gated behind a **human review** step.

This classification matters because decision-support tools are treated far more lightly than autonomous agents under both Malaysia's PDPA and international frameworks (e.g. EU AI Act "high-risk" categories).

## Malaysia PDPA 2010 (relevant from 30 April 2026)

The PDPA amendments plus the Commissioner's new guidelines (including the **Automated Decision-Making and Profiling (ADMP)** guidelines) introduce:

- **DPIA trigger.** ADMP activities (AI tools, profiling engines, automated scoring) trigger a Data Protection Impact Assessment before processing begins. Quantitative threshold: **20,000 data subjects** (or 10,000 for sensitive data). Fines up to **RM 1,000,000** per offence plus imprisonment.
- **Data Protection by Design (DPbD).** Privacy must be embedded into system design, not bolted on.
- **DPO requirement.** Designate a Data Protection Officer when thresholds apply.
- **Privacy notice.** Inform users that AI is used and how.

### PICC's position

- Because users make the final decisions, PICC's AI is a general-purpose assistant, so the strictest ADMP/DPIA duties do not apply to PICC's own processing of its suggestions. **However**, if you (the operator) run your own automated scoring of users or use AI to decide who gets which tier/service, run a DPIA.
- Re-evaluate if PICC ever gains the ability to place orders or auto-publish — that would change the classification entirely.

## Malaysia AI Governance Bill (in development)

The national AI Governance Bill is expected to be finalized over 2026. Anticipated requirements we have pre-designed for:

- Human and organizational accountability over AI systems.
- Transparency — users know when they are interacting with AI.
- Risk-based approach — lower obligations for assistive/decision-support tools.

**Actions:** monitor the Bill's engagement sessions; keep accountability and transparency as design principles (we already log everything and disclose AI use).

## Mandatory human-review feature

Implemented across every surface (dashboard copy buttons, extension overlay):

1. **5-second countdown** before a copy/apply button unlocks.
2. **Explicit confirmation toggle:** "I confirm I am a human making this final decision. The AI is only providing data."
3. **Audit logging** of every confirmation to `public.agent_logs` (plus structured per-action
   `human_review_logs` rows in the v2 schema: suggestion, user decision, review timer, IP).
4. **No auto-execution** anywhere in the system.

## What NOT to build (per the blueprint's red flags)

- ❌ "Fully automated" business registration — legally impossible; the human registers.
- ❌ Bypassing KYC/AML — Stripe and payment processors require identity verification; never automate around it.
- ❌ AI making final decisions without human oversight.
- ❌ Hidden bots/agents — disclose AI interaction in-app (already done in the extension popup and dashboard).
- ❌ Storing user data without protection — enforce RLS, HTTPS, and least-privilege keys.

## Data protection checklist (before launch)

- [ ] Run a DPIA if processing ≥20,000 Malaysian users or any sensitive personal data.
- [ ] Appoint a DPO if required.
- [ ] Update privacy notice: AI use disclosure, data uses, user rights.
- [ ] Enable Supabase RLS (schema ships with policies; verify each one).
- [ ] Rotate keys; use anon key in the browser only, service-role key server-side only.
- [ ] Add retention/deletion flows for user data.
- [ ] Log AI suggestions + human confirmations (schema provides `agent_logs`).
