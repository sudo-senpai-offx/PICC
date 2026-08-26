#!/usr/bin/env node
// PICC AI-skills setup — idempotent installer/verifier for the OpenCode
// skill ecosystem. Run at the start of any session (`node scripts/setup-ai-skills.mjs`)
// or with --check to print status without changing anything.
//
// What it guarantees:
//   1. ~/.agents/skills/**      — mattpocock/skills bundle (37 proven engineering
//                                 skills, MIT). OpenCode auto-scans this directory.
//   2. ~/.config/opencode/skills/security-review/SKILL.md
//                              — adaptation of anthropics/claude-code-security-review
//                                 (.claude/commands/security-review.md, MIT).
//   3. AGENTS.md                — carries the session-start instruction so every
//                                 conversation picks the right skills up.
//
// Sources of truth are UPSTREAM repos — nothing here is recreated from scratch;
// we clone/copy proven code and adapt only what must change (skill metadata).

import { spawnSync } from "node:child_process"
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, readdirSync
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const CHECK_ONLY = process.argv.includes("--check")
const HOME = homedir()
const AGENTS_SKILLS = join(HOME, ".agents", "skills")
const OC_SKILLS = join(HOME, ".config", "opencode", "skills")
const MP_REPO = "https://github.com/mattpocock/skills"
const REPO_ROOT = join(import.meta.dirname ?? ".", "..")

// ── helpers ──────────────────────────────────────────────────────────────────
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts })
  return r.status === 0 ? r.stdout?.trim() : null
}

function countSkills(dir) {
  try {
    let n = 0
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name))
        else if (e.name === "SKILL.md") n++
      }
    }
    walk(dir)
    return n
  } catch { return 0 }
}

function newestMtime(dir) {
  let newest = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      const st = statSync(p)
      if (e.isDirectory()) walk(p)
      else if (st.mtimeMs > newest) newest = st.mtimeMs
    }
  }
  try { walk(dir) } catch { /* missing */ }
  return newest
}

// ── 1. mattpocock/skills → ~/.agents/skills ─────────────────────────────────
async function ensureMattPocock() {
  const marker = join(AGENTS_SKILLS, ".picc-installed.json")
  const have = countSkills(AGENTS_SKILLS)
  if (CHECK_ONLY) {
    return { id: "mattpocock/skills", ok: have > 0, detail: `${have} skills at ${AGENTS_SKILLS}` }
  }
  // Refresh weekly or when fewer than 30 skills are present.
  const stale = !existsSync(marker) || Date.now() - JSON.parse(readFileSync(marker, "utf8")).installedAt > 7 * 86400_000
  if (have >= 30 && !stale) {
    return { id: "mattpocock/skills", ok: true, detail: `${have} skills (fresh)` }
  }
  const tmp = join(tmpdir(), "mp-skills-sync")
  rmSync(tmp, { recursive: true, force: true })
  const clone = sh("git", ["clone", "--depth", "1", MP_REPO, tmp])
  if (!clone && !existsSync(join(tmp, "skills"))) {
    return { id: "mattpocock/skills", ok: have > 0, detail: `clone failed; keeping existing ${have} skills` }
  }
  mkdirSync(AGENTS_SKILLS, { recursive: true })
  cpSync(join(tmp, "skills"), AGENTS_SKILLS, { recursive: true })
  writeFileSync(marker, JSON.stringify({ installedAt: Date.now(), upstream: MP_REPO }))
  rmSync(tmp, { recursive: true, force: true })
  return { id: "mattpocock/skills", ok: true, detail: `synced ${countSkills(AGENTS_SKILLS)} skills` }
}

// ── 2. security-review skill (adapted from anthropics/claude-code-security-review) ──
const SECURITY_REVIEW_SKILL = `---
name: security-review
description: Senior-security-engineer review of pending branch changes for HIGH-CONFIDENCE exploitable vulnerabilities only. Use when asked to security-review, audit a diff/PR before push, or check new auth/payment/crypto/broker-API code. Adapted from anthropics/claude-code-security-review (MIT).
---

# Security Review

You are a senior security engineer conducting a focused security review of the pending changes on this branch.

## Gather the diff yourself

Run these first: \`git status\`, \`git diff --name-only @{u}...\` (fallback \`origin/HEAD...\`),
\`git log --no-decorate @{u}...\`, then read the full diff via \`git diff @{u}\`.
If there is no upstream, review staged + unstaged changes (\`git diff HEAD\`).

## Objective

Identify HIGH-CONFIDENCE security vulnerabilities newly added by this diff with real exploitation
potential. This is NOT a general code review — do not comment on pre-existing concerns, style, or
theory. Only flag issues where you are **>80% confident of actual exploitability**.

## Exclusions (do NOT report)

- Denial-of-service / resource-exhaustion / rate-limiting concerns
- Secrets merely stored on disk (handled by other processes)
- Generic input validation without proven impact; open redirects

## Categories to examine

- **Injection**: SQL / command / NoSQL / XXE / template / path traversal
- **AuthN & AuthZ**: bypass logic, privilege escalation, IDOR, session flaws
- **Data exposure**: hardcoded secrets, sensitive logging, PII violations
- **Crypto**: weak algorithms, bad key management, insecure randomness
- **Execution**: deserialization, eval/code injection, SSRF
- **Config**: insecure defaults, permissive CORS, missing auth on endpoints
- **Business logic**: TOCTOU, race conditions, trust-boundary crossings
- **PICC-specific**: broker credentials leakage in responses/logs, CSRF gaps on state-changing
  routes, demo/live gating bypasses, unvalidated proxy/frame ingestion (extension feed is hostile input)

## Output format

For each finding:
\`\`\`
[SEVERITY: critical|high|medium|low] <title>
File: <path>:<lines>
Why exploitable: <concrete attack path>
Fix: <specific remediation>
Confidence: <percentage>
\`\`\`

End with a verdict line: "CLEAN — no high-confidence findings" or "N findings (critical: X, high: Y)".
If the diff is empty, say exactly that and stop.
`

async function ensureSecurityReview() {
  const target = join(OC_SKILLS, "security-review", "SKILL.md")
  const ok = existsSync(target) && readFileSync(target, "utf8").includes("name: security-review")
  if (CHECK_ONLY) return { id: "security-review", ok, detail: target }
  if (!ok) {
    mkdirSync(join(OC_SKILLS, "security-review"), { recursive: true })
    writeFileSync(target, SECURITY_REVIEW_SKILL)
    return { id: "security-review", ok: true, detail: `created ${target}` }
  }
  return { id: "security-review", ok: true, detail: "already installed" }
}

// ── 3. AGENTS.md habituation ────────────────────────────────────────────────
const HABIT_MARKER = "<!-- picc-ai-skills:start -->"
const HABIT_BLOCK = `${HABIT_MARKER}
## AI Skills (run every session)

At the start of EVERY session in this repo, run:

    node scripts/setup-ai-skills.mjs --check

It verifies the globally-installed OpenCode skills (mattpocock/skills engineering bundle +
security-review) are present and fresh, and self-heals them when they are not. Then actually USE them:
prefer the matching skill for the task at hand (tdd, diagnosing-bugs, code-review, grilling,
research, security-review for auth/payment/broker diffs, writing-for-agents for docs) instead of
improvising process from scratch.
<!-- picc-ai-skills:end -->
`

function ensureAgentsMd() {
  const p = join(REPO_ROOT, "AGENTS.md")
  let body = ""
  try { body = readFileSync(p, "utf8") } catch { /* new file */ }
  if (body.includes(HABIT_MARKER)) return { id: "AGENTS.md", ok: true, detail: "instruction present" }
  const next = body ? body.replace(/\n*$/, "\n\n") + HABIT_BLOCK : HABIT_BLOCK
  if (!CHECK_ONLY) writeFileSync(p, next)
  return { id: "AGENTS.md", ok: true, detail: CHECK_ONLY ? "MISSING — will be created" : "instruction written" }
}

// ── run ──────────────────────────────────────────────────────────────────────
const results = []
for (const step of [ensureMattPocock, ensureSecurityReview, ensureAgentsMd]) {
  results.push(await step())
}
const label = CHECK_ONLY ? "CHECK" : "SETUP"
for (const r of results) {
  console.log(`[${label}] ${r.ok ? "ok " : "MISS"} ${r.id} — ${r.detail}`)
}
if (CHECK_ONLY && results.some((r) => !r.ok)) {
  console.log(`[${label}] drift detected — rerun without --check to heal.`)
}
