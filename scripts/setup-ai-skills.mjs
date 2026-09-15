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
//   4. ~/.config/opencode/plugins/skill-router.js
//                              — the per-prompt skill-routing plugin keeps its
//                                 prototype-pollution patch (a "constructor" token
//                                 in any skill crashes the whole routing index,
//                                 silently disabling auto-activation everywhere).
//   5. ~/.config/opencode ECC bundle — affaan-m/ECC skills/commands/agents present
//                                 and intact, with every opencode.json instruction
//                                 resolving; reinstalled from upstream when an ECC
//                                 update regresses the install.
//
// Sources of truth are UPSTREAM repos — nothing here is recreated from scratch;
// we clone/copy proven code and adapt only what must change (skill metadata).

import { spawnSync } from "node:child_process"
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, readdirSync
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"

const CHECK_ONLY = process.argv.includes("--check")
const HOME = homedir()
const AGENTS_SKILLS = join(HOME, ".agents", "skills")
const OC_SKILLS = join(HOME, ".config", "opencode", "skills")
const MP_REPO = "https://github.com/mattpocock/skills"
const REPO_ROOT = join(import.meta.dirname ?? ".", "..")
const OC_DIR = join(HOME, ".config", "opencode")
const ROUTER = join(OC_DIR, "plugins", "skill-router.js")
const ECC_STATE = join(OC_DIR, "ecc-install-state.json")

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

function readEccConfig() {
  try { return JSON.parse(readFileSync(join(OC_DIR, "opencode.json"), "utf8")) } catch { return null }
}

function lastRouterLogHealth() {
  try {
    const lines = readFileSync(join(OC_DIR, "logs", "skill-router.log"), "utf8").trimEnd().split("\n")
    const rel = lines.filter((l) => l.includes("indexed ") || l.includes("index build failed"))
    const last = rel[rel.length - 1]
    if (!last) return { failed: false, last: "no index lines yet" }
    return {
      failed: last.includes("index build failed"),
      last: last.replace(/^.*?\[(?:info|warn)\] /, "").replace(/\(cwd=.*$/, "").trimEnd(),
    }
  } catch { return { failed: false, last: "log missing" } }
}

// opencode.json `instructions` entries are config-dir-relative (or ~/ or absolute).
function danglingInstructions() {
  const cfg = readEccConfig()
  if (!cfg || !Array.isArray(cfg.instructions)) return { total: 0, missing: [] }
  const missing = []
  for (const rel of cfg.instructions) {
    let p = String(rel)
    if (p.startsWith("~")) p = join(HOME, p.slice(1).replace(/^[/\\]/, ""))
    else if (!isAbsolute(p)) p = join(OC_DIR, p)
    if (!existsSync(p)) missing.push(String(rel))
  }
  return { total: cfg.instructions.length, missing }
}

function trimDanglingInstructions() {
  const d = danglingInstructions()
  if (!d.missing.length) return 0
  const cfg = readEccConfig()
  cfg.instructions = cfg.instructions.filter((rel) => !d.missing.includes(String(rel)))
  writeFileSync(join(OC_DIR, "opencode.json"), JSON.stringify(cfg, null, 2) + "\n")
  return d.missing.length
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

// ── 4. skill-router global plugin + prototype-pollution patch ───────────────
const ROUTER_PATCH = `    // Own-property check: tokens like "constructor" hit Object.prototype
    // members via bare lookup, yielding a non-iterable that threw "al is not
    // iterable" and silently emptied the whole skill index.
    const al = Object.prototype.hasOwnProperty.call(ALIASES, t) ? ALIASES[t] : undefined`
const ROUTER_VULN_RE = /^\s*const al = ALIASES\[t\]\s*$/m

// Idempotent. Returns "patched" | "already-patched" | "unrecognized-shape" | "missing".
function applyRouterPatch() {
  if (!existsSync(ROUTER)) return "missing"
  const src = readFileSync(ROUTER, "utf8")
  if (src.includes("hasOwnProperty.call(ALIASES")) return "already-patched"
  if (!ROUTER_VULN_RE.test(src)) return "unrecognized-shape"
  const backup = join(OC_DIR, "plugins", "skill-router.js.orig-pre-eccfix")
  if (!existsSync(backup)) writeFileSync(backup, src) // preserve the true original once
  writeFileSync(ROUTER, src.replace(ROUTER_VULN_RE, ROUTER_PATCH))
  return "patched"
}

async function ensureSkillRouter() {
  const id = "skill-router (global routing plugin)"
  if (!existsSync(ROUTER)) {
    return { id, ok: false, detail: `missing ${ROUTER} — restore per ~/.config/opencode/AI_SKILLS_SETUP.md` }
  }
  let action = existsSync(ROUTER) && readFileSync(ROUTER, "utf8").includes("hasOwnProperty.call(ALIASES") ? "patch present" : "PATCH MISSING — rerun without --check to heal"
  if (!CHECK_ONLY) {
    const r = applyRouterPatch()
    if (r === "patched") action = "patched in place (backup: skill-router.js.orig-pre-eccfix)"
    else if (r === "unrecognized-shape") action = "UNRECOGNIZED ROUTER SHAPE — patch manually per AI_SKILLS_SETUP.md"
  }
  const nowPatched = readFileSync(ROUTER, "utf8").includes("hasOwnProperty.call(ALIASES")
  const log = lastRouterLogHealth()
  const logNote = log.failed
    ? `; LAST INDEX BUILD FAILED — routing is empty until a session restart (${log.last})`
    : `; ${log.last}`
  return { id, ok: nowPatched && !log.failed, detail: `${action}${logNote}` }
}

// ── 5. ECC bundle (affaan-m/ECC) integrity + healing ────────────────────────
const ECC_REPO = "https://github.com/affaan-m/ECC" // official source only
const ECC_MARKER = join(OC_DIR, ".picc-ecc-check.json")
const ECC_MIN_SKILLS = 50 // 61 installed; fewer means an update pruned/clobbered it

// spawnSync refuses npm.cmd without a shell on Windows (EINVAL), so shell out there.
function npmRun(args, cwd) {
  try {
    if (process.platform === "win32") {
      const r = spawnSync(`npm ${args.join(" ")}`, { stdio: "pipe", encoding: "utf8", cwd, shell: true, timeout: 600_000 })
      return r.status === 0 ? r.stdout?.trim() : null
    }
    return sh("npm", args, { cwd, timeout: 600_000 })
  } catch { return null }
}

async function ensureEccBundle() {
  const id = "ecc bundle (global skills/commands/agents)"
  let state = null
  try { state = JSON.parse(readFileSync(ECC_STATE, "utf8")) } catch { /* not installed */ }
  const have = countSkills(OC_SKILLS)
  const ver = state?.source?.repoVersion ?? "?"
  const d = danglingInstructions()
  if (CHECK_ONLY) {
    const parts = [`v${ver}`, `${have} skills`, state ? "state ok" : "STATE MISSING"]
    if (d.missing.length) parts.push(`${d.missing.length}/${d.total} dangling instructions`)
    return { id, ok: !!state && have >= ECC_MIN_SKILLS && d.missing.length === 0, detail: parts.join(", ") }
  }
  // Cheap local heal first: dangling opencode.json instruction entries.
  const trimmed = trimDanglingInstructions()
  let state2 = null
  try { state2 = JSON.parse(readFileSync(ECC_STATE, "utf8")) } catch { /* gone */ }
  const nowHave0 = countSkills(OC_SKILLS)
  if (state2 && nowHave0 >= ECC_MIN_SKILLS) {
    writeFileSync(ECC_MARKER, JSON.stringify({ checkedAt: Date.now() }))
    return { id, ok: true, detail: `v${ver}, ${nowHave0} skills (intact)${trimmed ? `, trimmed ${trimmed} dangling instructions` : ""}` }
  }
  // Heal: full reinstall from upstream (profile `opencode` — no hook runtime).
  const tmp = join(tmpdir(), "ecc-sync")
  rmSync(tmp, { recursive: true, force: true })
  const cloned = sh("git", ["clone", "--depth", "1", ECC_REPO, tmp]) !== null || existsSync(join(tmp, "package.json"))
  if (!cloned) {
    rmSync(tmp, { recursive: true, force: true })
    return { id, ok: have >= ECC_MIN_SKILLS, detail: `clone failed; keeping existing ${have} skills` }
  }
  const steps = [
    ["npm install", npmRun(["install", "--no-audit", "--no-fund"], tmp) !== null],
    ["build:opencode", npmRun(["run", "build:opencode"], tmp) !== null],
    ["install-apply", sh("node", ["scripts/install-apply.js", "--profile", "opencode", "--target", "opencode"], { cwd: tmp, timeout: 300_000 }) !== null],
  ]
  rmSync(tmp, { recursive: true, force: true })
  const nowHave = countSkills(OC_SKILLS)
  let nowVer = "?"
  try { nowVer = JSON.parse(readFileSync(ECC_STATE, "utf8"))?.source?.repoVersion ?? "?" } catch { /* reinstall failed */ }
  const trimmed2 = trimDanglingInstructions() // a reinstall restores all 14 entries; keep the ones that resolve
  const patch = applyRouterPatch() // belt & suspenders: a reinstall should never touch the router
  writeFileSync(ECC_MARKER, JSON.stringify({ checkedAt: Date.now() }))
  const failedStep = steps.find(([, ok]) => !ok)?.[0]
  const bits = []
  if (failedStep) bits.push(`FAILED at ${failedStep}`)
  bits.push(`${nowHave} skills (v${nowVer})`)
  if (trimmed2) bits.push(`trimmed ${trimmed2} dangling instructions`)
  if (patch === "patched") bits.push("re-applied router patch")
  if (patch === "unrecognized-shape") bits.push("ROUTER SHAPE UNRECOGNIZED — patch manually")
  return { id, ok: !failedStep && nowHave >= ECC_MIN_SKILLS, detail: bits.join(", ") }
}

// ── 3. AGENTS.md habituation ────────────────────────────────────────────────
const HABIT_MARKER = "<!-- picc-ai-skills:start -->"
const HABIT_BLOCK = `${HABIT_MARKER}
## AI Skills (run every session)

At the start of EVERY session in this repo, run:

    node scripts/setup-ai-skills.mjs --check

It verifies the globally-installed OpenCode skills (mattpocock/skills engineering bundle +
security-review), the skill-router patch, and the ECC bundle are present and fresh, and
self-heals them when they are not. Then actually USE them:
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
for (const step of [ensureMattPocock, ensureSecurityReview, ensureAgentsMd, ensureSkillRouter, ensureEccBundle]) {
  results.push(await step())
}
const label = CHECK_ONLY ? "CHECK" : "SETUP"
for (const r of results) {
  console.log(`[${label}] ${r.ok ? "ok " : "MISS"} ${r.id} — ${r.detail}`)
}
if (CHECK_ONLY && results.some((r) => !r.ok)) {
  console.log(`[${label}] drift detected — rerun without --check to heal.`)
}
