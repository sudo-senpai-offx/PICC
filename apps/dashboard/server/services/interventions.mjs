/**
 * PICC Interventions — the human-in-the-loop layer.
 *
 * Two new capabilities live here:
 *
 *  1. A REVIEW QUEUE of intervention proposals. Every mutating step of a
 *     workflow (fill, click, type, submit…) becomes a proposal that a human
 *     can APPROVE, REJECT, EXECUTE or INTERRUPT before anything happens to the
 *     page. Read-only steps (goto, wait, read, assert, notify) run on their
 *     own and never need approval. This is the boundary that keeps PICC
 *     "full-fledged but trustworthy": it can be trusted to act, but only with
 *     the human's say-so per mutating action.
 *
 *  2. A WORKFLOW ENGINE — a small, safe step DSL that runs against the tab of
 *     your choice. Workflows are plain JSON and stay Trusted-Types-safe: every
 *     action goes through Playwright locators / keyboard primitives, never
 *     string-DOM or raw eval.
 *
 * Everything broadcasts `{ type: "intervention" }` so the content window can
 * render the queue + run state live.
 */
import { readPage } from "./browserBridge.mjs"
import { studioBroadcast, studioIsOpen, studioPageFor, studioTypeText } from "./browserStudio.mjs"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomBytes } from "node:crypto"

const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url))
const DATA_DIR = process.env.PICC_DATA_DIR
  ? isAbsolute(process.env.PICC_DATA_DIR)
    ? process.env.PICC_DATA_DIR
    : join(SERVER_DIR, process.env.PICC_DATA_DIR)
  : fileURLToPath(new URL("../data", import.meta.url))
const WORKFLOWS_DIR = join(DATA_DIR, "workflows")
const MAX_PROPOSALS = 50

/** Steps that mutate the page and therefore require human approval by default. */
const WRITE_STEPS = new Set(["fill", "click", "type", "key", "submit"])

/** Steps that only observe / navigate. Navigation is harmless and never paused. */
const READ_STEPS = new Set(["goto", "waitMs", "read", "assert", "notify"])

// ---------------------------------------------------------------------
// Built-in workflow templates (code catalog). User-saved workflows in
// WORKFLOWS_DIR are merged on top.
// ---------------------------------------------------------------------
const BUILTIN_WORKFLOWS = [
  {
    id: "read-portfolio",
    name: "Read my dashboard",
    description: "Reads the common balance/earnings fields on the active tab and reports them. Fully read-only — no approval needed.",
    suite: null,
    approval: "auto",
    steps: [
      { type: "notify", message: "Starting read — sampling balance fields…" },
      { type: "read", label: "dashboard", selectors: { balance: "[class*='balance'], [class*='credits'], [class*='earnings'], [class*='wallet']" } },
      { type: "notify", message: "Read complete — see metrics." }
    ]
  },
  {
    id: "guided-submit",
    name: "Guided submit (with approval)",
    description: "Template for a mutating flow: it pauses for your approval before every write step. Edit the steps to point at your real selectors.",
    suite: null,
    approval: "manual",
    steps: [
      { type: "notify", message: "Guided submit started. I'll ask before each action." },
      { type: "fill", selector: "input", value: "EDIT-ME", label: "First field" },
      { type: "click", selector: "button[type='submit'], button", label: "Submit button" }
    ]
  }
]

let proposals = []
let running = null
let runAbort = false

function currentState() {
  return {
    ok: true,
    running: running
      ? {
          workflowId: running.workflowId,
          name: running.name,
          tabId: running.tabId,
          status: running.status,
          stepIndex: running.stepIndex,
          totalSteps: running.totalSteps,
          pendingId: running.pendingId,
          metrics: running.metrics,
          log: running.log,
          approval: running.approval,
          startedAt: running.startedAt,
          finishedAt: running.finishedAt,
          error: running.error ?? null
        }
      : null,
    proposals: proposals.map((p) => ({ ...p }))
  }
}

function emit() {
  studioBroadcast({ type: "intervention", intervention: currentState() })
}

function newProposal({ workflow, tabId, step, stepIndex }) {
  const p = {
    id: randomBytes(6).toString("hex"),
    source: "workflow",
    workflowId: workflow.id,
    workflowName: workflow.name,
    tabId: tabId ?? null,
    stepIndex,
    action: step.type,
    label: step.label ?? step.type,
    detail: step.message ?? (step.selector ? `${step.selector}${step.value != null ? ` ← ${String(step.value).slice(0, 60)}` : ""}` : ""),
    risk: step.risk ?? "medium",
    status: "pending",
    createdAt: Date.now(),
    decidedAt: null
  }
  proposals.unshift(p)
  if (proposals.length > MAX_PROPOSALS) proposals = proposals.slice(0, MAX_PROPOSALS)
  return p
}

function setProposalStatus(id, status) {
  const p = proposals.find((x) => x.id === id)
  if (p) {
    p.status = status
    p.decidedAt = Date.now()
  }
  return p
}

// ---------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------
async function execStep(step, page, workflow) {
  const loc = (sel) => page.locator(String(sel))
  switch (step.type) {
    case "goto": {
      const url = String(step.url ?? "")
      if (url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 })
      break
    }
    case "waitMs":
      await page.waitForTimeout(Math.max(0, Math.min(Number(step.ms) || 0, 120_000)))
      break
    case "read": {
      const selectors = step.selectors && typeof step.selectors === "object" ? step.selectors : {}
      const values = await readPage(page, selectors)
      const label = step.label ?? "read"
      const recorded = {}
      for (const [k, v] of Object.entries(values)) recorded[`${label}.${k}`] = v
      Object.assign(running.metrics, recorded)
      running.log.push(`${label}: ${Object.values(values).filter(Boolean).join(" · ") || "no matches"}`)
      break
    }
    case "assert": {
      const el = loc(step.selector)
      await el.first().waitFor({ state: "visible", timeout: Number(step.timeout) || 10_000 })
      if (step.text) {
        const t = (await el.first().innerText().catch(() => "")) ?? ""
        if (!t.toLowerCase().includes(String(step.text).toLowerCase())) {
          throw new Error(`assert failed: "${step.text}" not found on ${step.selector}`)
        }
      }
      running.log.push(`assert ok: ${step.selector}${step.text ? ` contains "${step.text}"` : ""}`)
      break
    }
    case "fill": {
      const el = loc(step.selector).first()
      await el.waitFor({ state: "visible", timeout: Number(step.timeout) || 10_000 })
      await el.click()
      await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a")
      await studioTypeText(page, String(step.value ?? ""))
      running.log.push(`filled ${step.label ?? step.selector}`)
      break
    }
    case "type": {
      const el = loc(step.selector).first()
      await el.waitFor({ state: "visible", timeout: Number(step.timeout) || 10_000 })
      await el.click()
      await studioTypeText(page, String(step.value ?? ""))
      running.log.push(`typed into ${step.label ?? step.selector}`)
      break
    }
    case "click": {
      await loc(step.selector).first().waitFor({ state: "visible", timeout: Number(step.timeout) || 10_000 })
      await loc(step.selector).first().click()
      running.log.push(`clicked ${step.label ?? step.selector}`)
      break
    }
    case "key":
      await page.keyboard.press(String(step.key ?? ""))
      running.log.push(`pressed ${step.key}`)
      break
    case "submit":
      if (step.selector) {
        await loc(step.selector).first().waitFor({ state: "visible", timeout: Number(step.timeout) || 10_000 })
        await loc(step.selector).first().click()
      } else {
        await page.keyboard.press("Enter")
      }
      running.log.push("submitted")
      break
    case "notify":
      running.log.push(step.message ?? "notify")
      break
    default:
      throw new Error(`unknown step type: ${step.type}`)
  }
}

async function drive() {
  while (running && running.status === "running") {
    const workflow = running.workflow
    const step = workflow.steps[running.stepIndex]
    if (!step) {
      running.status = "done"
      running.finishedAt = Date.now()
      running.log.push("workflow complete")
      emit()
      return
    }
    if (runAbort || running.interrupted) {
      running.status = "interrupted"
      running.finishedAt = Date.now()
      running.log.push("interrupted")
      emit()
      return
    }
    // Mutating step + manual approval => pause and ask the human — unless this
    // exact step was just approved (the approved step runs, the NEXT write step
    // pauses again).
    if (WRITE_STEPS.has(step.type) && running.approval !== "auto" && !running.approved.has(running.stepIndex)) {
      const p = newProposal({ workflow, tabId: running.tabId, step, stepIndex: running.stepIndex })
      running.pendingId = p.id
      running.status = "waiting"
      emit()
      return
    }
    const page = running.tabId != null ? studioPageFor(running.tabId) : null
    if (!page) {
      running.status = "error"
      running.error = "tab is gone or browser closed"
      running.finishedAt = Date.now()
      emit()
      return
    }
    try {
      await execStep(step, page, workflow)
    } catch (err) {
      running.status = "error"
      running.error = err?.message ?? String(err)
      running.finishedAt = Date.now()
      running.log.push(`error: ${running.error}`)
      emit()
      return
    }
    running.stepIndex += 1
    emit()
  }
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------
export function listInterventions() {
  return currentState()
}

export async function respondIntervention({ id, decision } = {}) {
  const p = proposals.find((x) => x.id === id && x.status === "pending")
  if (!p) throw new Error("no pending intervention with that id")
  if (running && running.pendingId !== id) throw new Error("intervention is not for the running workflow")

  switch (decision) {
    case "approve":
    case "execute": {
      setProposalStatus(id, decision === "approve" ? "approved" : "executed")
      if (running) {
        running.approved.add(running.stepIndex)
        running.pendingId = null
        running.status = "running"
        emit()
        void drive()
      }
      return currentState()
    }
    case "reject": {
      setProposalStatus(id, "rejected")
      if (running) {
        running.pendingId = null
        running.status = "aborted"
        running.finishedAt = Date.now()
        running.log.push(`rejected: ${p.label}`)
        emit()
      }
      return currentState()
    }
    case "interrupt": {
      setProposalStatus(id, "interrupted")
      if (running) {
        running.pendingId = null
        running.interrupted = true
        running.status = "interrupted"
        running.finishedAt = Date.now()
        running.log.push(`interrupted: ${p.label}`)
        emit()
      }
      return currentState()
    }
    default:
      throw new Error(`unknown decision: ${decision}`)
  }
}

export function listWorkflows() {
  const user = []
  try {
    mkdirSync(WORKFLOWS_DIR, { recursive: true })
    for (const f of readdirSync(WORKFLOWS_DIR).filter((x) => x.endsWith(".json"))) {
      try {
        const wf = JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), "utf8"))
        if (wf && Array.isArray(wf.steps)) user.push({ ...wf, builtin: false })
      } catch {
        /* skip malformed user workflow */
      }
    }
  } catch {
    /* workflows dir unavailable */
  }
  return [...BUILTIN_WORKFLOWS.map((w) => ({ ...w, builtin: true })), ...user]
}

export function saveWorkflow({ id, name, description = "", suite = null, approval = "manual", steps = [] } = {}) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error("workflow needs at least one step")
  const wf = {
    id: String(id || `wf-${randomBytes(3).toString("hex")}`),
    name: String(name || "Untitled workflow"),
    description: String(description),
    suite: suite || null,
    approval: approval === "auto" ? "auto" : "manual",
    steps: steps.map((s) => ({ ...s }))
  }
  mkdirSync(WORKFLOWS_DIR, { recursive: true })
  writeFileSync(join(WORKFLOWS_DIR, `${wf.id}.json`), JSON.stringify(wf, null, 2), "utf8")
  return wf
}

export async function runWorkflow({ workflowId, tabId, approval } = {}) {
  if (!studioIsOpen()) {
    const err = new Error("browser is not open — open the browser first")
    err.code = "BROWSER_CLOSED"
    throw err
  }
  if (running && (running.status === "running" || running.status === "waiting")) {
    throw new Error(`a workflow is already ${running.status} — interrupt it first`)
  }
  const wf = listWorkflows().find((w) => w.id === workflowId)
  if (!wf) throw new Error(`unknown workflow: ${workflowId}`)
  const tabIdNum = Number(tabId) || null
  if (tabIdNum != null && !studioPageFor(tabIdNum)) throw new Error("unknown tab id")

  runAbort = false
  running = {
    workflowId: wf.id,
    name: wf.name,
    workflow: wf,
    tabId: tabIdNum,
    stepIndex: 0,
    totalSteps: wf.steps.length,
    pendingId: null,
    metrics: {},
    log: [],
    approval: approval === "auto" ? "auto" : wf.approval === "auto" ? "auto" : "manual",
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    interrupted: false,
    approved: new Set()
  }
  emit()
  void drive()
  return currentState()
}

export function stopWorkflow() {
  if (!running) return currentState()
  if (running.pendingId) setProposalStatus(running.pendingId, "interrupted")
  running.pendingId = null
  running.interrupted = true
  running.status = "interrupted"
  running.finishedAt = Date.now()
  running.log.push("stopped")
  emit()
  return currentState()
}
