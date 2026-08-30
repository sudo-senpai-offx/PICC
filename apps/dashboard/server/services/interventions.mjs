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
import {
  U4FA_RISK_PCT,
  U4FA_DAILY_LOSS_LIMIT_PCT,
  U4FA_MAX_DAILY_PROPOSALS,
  U4FA_POST_LOSS_COOLDOWN_MS,
  u4faAmountFor,
  pnlByUtcDay,
  lastLossAtFrom,
  checkProposalGate,
  riskDayState,
  recordU4faProposal
} from "./u4faRisk.mjs"

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

// Capture-login approval gate (Phase 5, spec T9 / REQ-E). The FIRST automated
// login for a headless-capture venue must be approved by a human: the engine
// proposes through this gate (a real proposal in the SAME queue, resolvable
// through the SAME respondIntervention endpoint as workflow write steps) and
// reports { state: "pending-approval" } until a decision lands. The browser is
// never touched before approval. A decided gate re-arms lazily: propose() on a
// decided gate creates a fresh proposal (used after a rejection cooldown).
let captureGate = null // { venueId, proposalId, status: "pending"|"approved"|"rejected"|"interrupted" }

// U4FA Augmentation gate (spec T11/M6): the human approves or rejects a U4FA
// signal BEFORE anything is placed. `tradeGate` mirrors `captureGate`: one
// pending trade proposal at a time; approve → openPaperTrade (paper only);
// reject → no order. The 10/day and 15-min-post-loss throttles apply WHEN the
// proposal is created (never to approving an already-pending one). The order
// lives on the gate, NOT on the queue entry — the proposal's pinned shape
// stays clean and the bell only ever sees the summary.
let tradeGate = null // { proposalId, status: "pending"|"approved"|"rejected"|"interrupted", order }

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

/**
 * T9 — propose the FIRST automated login for a headless-capture venue. The
 * proposal is a normal queue entry (source "capture") the human resolves with
 * respondIntervention. Idempotent while a proposal is still pending; a decided
 * gate re-arms with a fresh proposal on the next call (post-cooldown re-ask).
 */
export function proposeCaptureLogin({ venueId, venueName = venueId, tabId = null } = {}) {
  const vid = String(venueId || "").toLowerCase()
  if (captureGate && captureGate.venueId === vid && captureGate.status === "pending") {
    return { id: captureGate.proposalId, venueId: vid, status: "pending" }
  }
  const p = newProposal({
    workflow: { id: `capture-${vid}`, name: `${venueName} headless capture` },
    tabId,
    step: {
      type: "login",
      label: `First login — ${venueName}`,
      risk: "high",
      message: `Automated first login for ${venueName}. Credentials come from your vault; nothing is bought, sold or executed.`
    },
    stepIndex: 0
  })
  p.source = "capture" // distinct from workflow proposals in the queue UI
  captureGate = { venueId: vid, proposalId: p.id, status: "pending", createdAt: Date.now() }
  emit()
  return { id: p.id, venueId: vid, status: "pending" }
}

/** Latest gate status for a venue: { venueId, status } or { venueId, status: null } when never asked. */
export function captureLoginApproval(venueId) {
  const vid = String(venueId || "").toLowerCase()
  const status = captureGate && captureGate.venueId === vid ? captureGate.status : null
  return { venueId: vid, status }
}

/** Test seam (also used by the engine's reset) — drops the gate + its proposals. */
export function _resetCaptureGate() {
  captureGate = null
  proposals = proposals.filter((x) => x.source !== "capture")
}

/**
 * T11 — risk feeds for the tradeGate from the REAL paper ledger + accuracy
 * ledger. `paperHistory` closed entries give dollar PnL by UTC day (the barrier
 * feed); ledger misses by resolvedAt feed the post-loss throttle. Any failure
 * returns null — the gate fails closed ("risk feed unavailable"), it never
 * proposes on unobservable state.
 */
async function tradeRiskFeeds() {
  try {
    const [{ paperOverview, paperHistory }, { ledgerHistory }] = await Promise.all([
      import("./trading.mjs"),
      import("./accuracyLedger.mjs")
    ])
    const ov = await paperOverview()
    const closed = await paperHistory(500)
    const ledger = await ledgerHistory(200)
    const resolved = Array.isArray(ledger?.entries) ? ledger.entries : []
    return {
      balance: Number(ov?.cash) || 0,
      closed: Array.isArray(closed) ? closed : [],
      resolved,
      lastLossAt: lastLossAtFrom({ closed: Array.isArray(closed) ? closed : [], resolved })
    }
  } catch {
    return null
  }
}

/**
 * T11 — the U4FA Augmentation gate. Mirrors proposeCaptureLogin: a normal queue
 * proposal (source "trade") the human resolves via respondIntervention.
 * Idempotent while one is pending (no dupes). A NEW proposal is only created
 * when every U4FA risk gate passes:
 *
 *   - the -5% UTC-day daily-loss barrier (Decision B: U4FA day-key, NOT
 *     autopilot's local-midnight knobs);
 *   - the 10/day proposal counter (the 11th proposal of a UTC day is refused);
 *   - the 15-min post-loss proposal throttle (suppresses NEW proposals only);
 *   - a valid order shape (the engine must show a real asset, direction, price
 *     and expiry — a malformed proposal is a loud throw, never a silent skip).
 *
 * Paper-only at the call site: approve reaches openPaperTrade and nothing else
 * (`autopilot.mjs:1332-1337` — there is no other execution path in PICC).
 */
export async function proposeTrade(order = {}, opts = {}) {
  const now = opts?.now ?? Date.now()
  const symbol = String(order.symbol || order.assetId || "").toUpperCase()
  const direction = String(order.direction || "")
  const entry = Number(order.entry)
  const expiry = Number(order.expiry)
  if (!symbol) throw new Error("trade proposal needs a symbol")
  if (!["up", "down"].includes(direction)) throw new Error("trade proposal needs direction up|down")
  if (!Number.isFinite(entry) || entry <= 0) throw new Error("trade proposal needs a valid entry price")
  if (!Number.isFinite(expiry) || expiry < 60) throw new Error("trade proposal needs an expiry >= 60s")

  if (tradeGate && tradeGate.status === "pending") {
    return { ok: true, id: tradeGate.proposalId, status: "pending", duplicate: true }
  }

  const feeds = await tradeRiskFeeds()
  if (!feeds) return { ok: false, status: "blocked", reason: "risk feed unavailable" }

  const risk = {
    riskPct: Number(opts?.risk?.riskPct) || U4FA_RISK_PCT,
    dailyLossLimitPct: Number(opts?.risk?.dailyLossLimitPct) || U4FA_DAILY_LOSS_LIMIT_PCT,
    maxDailyProposals: Number(opts?.risk?.maxDailyProposals) || U4FA_MAX_DAILY_PROPOSALS,
    postLossCooldownMs: Number(opts?.risk?.postLossCooldownMs) || U4FA_POST_LOSS_COOLDOWN_MS
  }

  const state = riskDayState({ now, balance: feeds.balance })
  const dayPnl = pnlByUtcDay({ closed: feeds.closed, dayKey: state.key })
  const gate = checkProposalGate({
    now,
    dayStartBalance: state.dayStartBalance,
    pnl: dayPnl,
    proposalsToday: state.proposals,
    lastLossAt: feeds.lastLossAt,
    ...risk
  })
  if (!gate.ok) {
    return { ok: false, status: "blocked", dayKey: gate.dayKey, dayPnl, reason: gate.reason }
  }

  const size = u4faAmountFor(feeds.balance, risk)
  const amount = order.amount != null && Number.isFinite(Number(order.amount)) && Number(order.amount) > 0
    ? Math.round(Number(order.amount) * 100) / 100
    : size.amount
  const floorNote = size.floorApplied ? ` · risk floor $1 unit applies (0.5% of $${feeds.balance} < $1)` : ""

  const summary = order.summary || `U4FA ${direction} ${symbol} ${Math.round(expiry)}s`
  const detail = `${summary} — stake $${amount.toFixed(2)}${floorNote}. PAPER ONLY: approving places a demo order; nothing touches a real account.`
  const p = newProposal({
    workflow: { id: "u4fa-trade", name: "U4FA signal" },
    tabId: null,
    step: {
      type: "order",
      label: `U4FA ${direction} ${symbol} (${Math.round(expiry)}s)`,
      risk: "high",
      message: detail
    },
    stepIndex: 0
  })
  p.source = "trade" // distinct from workflow/capture proposals in the queue UI
  tradeGate = {
    proposalId: p.id,
    status: "pending",
    order: {
      symbol,
      side: direction,
      entry: Math.round(entry * 1e6) / 1e6,
      amount,
      takeProfit: order.takeProfit != null && Number.isFinite(Number(order.takeProfit)) ? Number(order.takeProfit) : null,
      stopLoss: order.stopLoss != null && Number.isFinite(Number(order.stopLoss)) ? Number(order.stopLoss) : null,
      signalId: order.signalId || null
    }
  }
  recordU4faProposal({ now, balance: feeds.balance })
  emit()
  return { ok: true, id: p.id, status: "pending", amount, floorApplied: size.floorApplied, dayKey: gate.dayKey }
}

/** Test seam + engine reset — drops the trade gate + its proposals. */
export function _resetTradeGate() {
  tradeGate = null
  proposals = proposals.filter((x) => x.source !== "trade")
}

export async function respondIntervention({ id, decision } = {}) {
  const p = proposals.find((x) => x.id === id && x.status === "pending")
  if (!p) throw new Error("no pending intervention with that id")

  // T9 — capture-login gate proposal: no workflow is running for it, so the
  // decision resolves the gate instead of driving a run.
  if (captureGate && captureGate.proposalId === id) {
    if (!["approve", "execute", "reject", "interrupt"].includes(decision)) {
      throw new Error(`unknown decision: ${decision}`)
    }
    if (decision === "approve" || decision === "execute") {
      setProposalStatus(id, decision === "approve" ? "approved" : "executed")
      captureGate.status = "approved"
    } else if (decision === "reject") {
      setProposalStatus(id, "rejected")
      captureGate.status = "rejected"
    } else {
      setProposalStatus(id, "interrupted")
      captureGate.status = "interrupted"
    }
    emit()
    return currentState()
  }

  // T11 — trade-gate proposal (Augmentation gate): same queue, same endpoint.
  // It MUST short-circuit before the running-workflow check (spec R4), exactly
  // like the capture branch, so a pending U4FA signal stays resolvable while a
  // browser workflow is running. approve → exactly one openPaperTrade call;
  // reject/interrupt → no order ever.
  if (tradeGate && tradeGate.proposalId === id) {
    if (!["approve", "execute", "reject", "interrupt"].includes(decision)) {
      throw new Error(`unknown decision: ${decision}`)
    }
    if (decision === "approve" || decision === "execute") {
      // Order FIRST: if openPaperTrade throws (e.g. insufficient paper cash)
      // the proposal stays pending and the UI keeps the row so the human can
      // retry — a failed approval is never silently swallowed into "done".
      const { openPaperTrade } = await import("./trading.mjs")
      await openPaperTrade(tradeGate.order)
      setProposalStatus(id, decision === "approve" ? "approved" : "executed")
      tradeGate.status = "approved"
    } else if (decision === "reject") {
      setProposalStatus(id, "rejected")
      tradeGate.status = "rejected"
    } else {
      setProposalStatus(id, "interrupted")
      tradeGate.status = "interrupted"
    }
    emit()
    return currentState()
  }

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
