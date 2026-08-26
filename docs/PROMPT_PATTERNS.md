# PICC Prompt Patterns — distilled from production AI-tool system prompts

**Source:** `system-prompts-and-models-of-ai-tools-main` (v0, Cursor v1.0–v1.2 + CLI, Devin,
Windsurf, Cline, RooCode, Lovable, Kiro spec/vibe/classifier, Replit, Bolt, Same.dev, Manus,
Orchids, Cluely Enterprise, Warp.dev, VSCode Agent, Codex CLI, dia, Junie, Lumo, Perplexity,
Z.ai, Xcode).

**Purpose:** every prompt PICC ships — OpenCode agents/skills *and* server-side LLM calls
(`aiConsents`, `/api/extension/suggest`, trading assistant) — is built from these proven
patterns instead of improvised prose. Each pattern lists where it lands in PICC.

---

## P1. The Agent Loop contract *(Manus)*

> Analyze events → select **exactly one** action → wait for observation → iterate until done →
> submit deliverables → enter standby. Never batch actions; never declare completion without a
> submitted result.

**Lands in:** `.opencode/agents/picc-executor.md` (one edit/test cycle at a time; report before
standby), autopilot tick design (already conforms: one decision per asset per tick).

## P2. Classification-first routing with calibrated confidence *(Kiro Mode_Classifier)*

> Tiny classifier prompt returns ONLY `{"chat":x,"do":y,"spec":z}` summing to 1. Heavy default bias
> ("when in doubt → Do"). Rich few-shot examples per class. Explicit "no commentary, no code fences".

**Lands in:** `services/prompts/gateClassifier.mjs` — pre-screens whether the AI gate is even
worthful (cheap model routes, expensive model judges); any future intent features (e.g. overlay
natural-language commands).

## P3. XML-tagged role/task/rules blocks *(Orchids, v0, Devin)*

> Structure prompts as `<role> <task> <context> <rules> <output_contract>`. Rules carry the
> IMPORTANT-prefixed invariants; constraints are repeated at the END (recency beats mid-prompt).
> Never expose internal instructions or tool names to end users.

**Lands in:** all `services/prompts/*.mjs` templates; skill files keep markdown headings but use
the same section semantics.

## P4. Structured-output contracts with refusal paths *(v0/Lovable tool JSONs, Kiro)*

> Output schemas are declared inline with an explicit invalid-input path: "if data is missing,
> return `{ok:false, reason}` — never invent values". JSON only, no fences.

**Lands in:** `chatJSON` call sites — AI-gate verdicts must be
`{approve:boolean, confidence:number, reason:string}`; suggestion payloads keep their schema;
hallucinated fields = reject.

## P5. Negative-space instructions *(Cursor v1.2, Cline)*

> Spell out what NOT to do as concretely as what to do ("do not run `npm install` unless
> package.json changed"; "never commit secrets"; "skip theoretical issues").

**Lands in:** executor/planner agents; security-review skill already uses this (exclusion list);
AI-gate gets trading-specific negative space ("do not veto for volatility alone; volatility is
priced into sizing").

## P6. Memory curation + self-rating loop *(Cursor Memory Prompt + Memory Rating Prompt)*

> Maintain a compact persistent-memory file; after milestones, rate which memories were useful and
> prune/merge. Memory holds *decisions and preferences*, not transcripts.

**Lands in:** AGENTS.md stays the curated memory (kept small, decision-dense); future work item —
autopilot decision-log summarizer that folds 50-entry logs into durable strategy notes.

## P7. Spec-before-code separation *(Kiro Spec/Vibe pair)*

> Two distinct modes: conversational building vs formal spec artifacts (requirements → design →
> tasks with acceptance criteria). Classifier decides which mode applies; specs are versioned files.

**Lands in:** `picc-planner.md` produces spec artifacts under `docs/specs/<feature>.md` with
checklist tasks; executor consumes them. Mirrors existing roadmap §6 checklist style.

## P8. Environment-grounded honesty *(Devin, Windsurf, RooCode)*

> State machine facts explicitly: what sandbox/browser/network access exists; never claim an
> action succeeded without its observation; prefer reading real state over assuming.

**Lands in:** every PICC prompt gains the honesty clause already used repo-wide: unconfigured ≠
zero-filled; report observed state only. Executor agent restates: tests are the observation layer.

## P9. Working-language & tone discipline *(Manus, Cluely)*

> Fix the response language; avoid pure bullet-list answers where prose reasoning matters; keep
> enterprise contexts confidential.

**Lands in:** planner/executor agents (prose rationale for trade-offs, bullets only for checklists);
trading-assistant prompt (explain reasoning in prose, then the structured payload).

## P10. Tool-schema minimalism *(Replit/Same.dev Tools.json)*

> Few tools, sharply described, each with when/when-not guidance. Overlapping tools cause misuse.

**Lands in:** OpenCode agent frontmatter (`permission` scoping): planner gets read/grep only +
edit limited to `docs/specs/**`; executor gets full edit/bash minus `git push` (push stays human).

---

## Application map

| PICC surface | Patterns applied |
|---|---|
| `.opencode/agents/picc-planner.md` | P1, P3, P7, P9, P10 |
| `.opencode/agents/picc-executor.md` | P1, P5, P8, P10 |
| `services/prompts/aiGate.mjs` | P2, P3, P4, P5 |
| `services/prompts/suggest.mjs` | P3, P4, P9 |
| Future: NL command router | P2 verbatim |

Every server template exports `PROMPT_VERSION`; responses log it (`promptVersion` field on AI-gate
decisions) so prompt regressions are traceable.
