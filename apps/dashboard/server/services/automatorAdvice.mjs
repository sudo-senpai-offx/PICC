// PICC Automator advice — a deterministic rule engine plus an optional LLM
// copilot, both feeding the "Health & helpers" and "Assistant" panels.
//
//   automatorHealth   issues + recent alerts + totals, computed locally.
//   automatorAssist   free-form question answered by the cloud LLM when
//                     configured, otherwise by the same rule engine (honest
//                     local fallback, never fabricated).
//   automatorAlerts   recent agent_logs rows relevant to the automator.
//
// Human-review rule: advice is advisory only — nothing here submits, claims,
// spends, or signs up on the user's behalf.

import {
  automatorIssuesFrom,
  automatorStatus,
  automatorTotals,
  scanNodes
} from "./automator.mjs"
import { chatText, llmConfigured } from "./llm.mjs"
import { appendRow, listRows } from "./localstore.mjs"

const ALERT_KINDS = new Set(["payout_ready", "credential_expiry", "assistant"])

function statusBrief(status) {
  const lines = []
  for (const p of Object.values(status?.providers ?? {})) {
    const state =
      p.status === "ok"
        ? `$${(Number(p.balance) || 0).toFixed(2)}`
        : p.status === "error"
          ? `error: ${p.error ?? "unknown"}`
          : "not configured"
    lines.push(`- ${p.platform}: ${state}`)
  }
  for (const m of status?.manual ?? []) {
    lines.push(`- ${m.name}: $${(Number(m.balance) || 0).toFixed(2)}`)
  }
  return lines.join("\n")
}

function issueList(issues) {
  return issues.map((i) => `[${i.severity}] ${i.platform ?? "PICC"}: ${i.message}`).join("\n")
}

function localAdvice(issues, totals, question) {
  const q = String(question ?? "").trim()
  const parts = []
  if (q) parts.push(`You asked: "${q}"`)
  if (issues.length === 0) {
    parts.push("Everything looks healthy — no open issues.")
  } else {
    const danger = issues.filter((i) => i.severity === "danger")
    const warn = issues.filter((i) => i.severity === "warn")
    const ready = issues.filter((i) => i.severity === "success" && i.topic === "payout")
    if (danger.length) parts.push("Act first on: " + danger.map((i) => `${i.platform ?? "PICC"} — ${i.message}`).join(" | "))
    if (warn.length) parts.push("Watch out for: " + warn.map((i) => `${i.platform ?? "PICC"} — ${i.message}`).join(" | "))
    if (ready.length) parts.push("Ready to cash out: " + ready.map((i) => i.platform).join(", "))
    if (!danger.length && !warn.length && !ready.length) {
      parts.push("No urgent issues. Keep the configured nodes running and check the dashboard daily.")
    }
  }
  parts.push(
    `Configured providers: ${totals.configured}; ready to cash out: ${totals.ready}; ` +
      `nodes detected locally: ${totals.nodesDetected}/${totals.nodesTotal}.`
  )
  parts.push("PICC only monitors — it never submits, claims, or spends on your behalf. Payouts stay manual.")
  return parts.join("\n")
}

export async function automatorAlerts(limit = 30) {
  const rows = await listRows("agent_logs")
  const alerts = (Array.isArray(rows) ? rows : [])
    .filter((r) => ALERT_KINDS.has(r?.kind))
    .sort((a, b) => new Date(b?.created_at ?? 0) - new Date(a?.created_at ?? 0))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      source: r.source,
      level: r.level,
      platform: r.platform,
      note: r.note,
      balance: r.balance,
      payoutThreshold: r.payoutThreshold,
      created_at: r.created_at
    }))
  return { ok: true, alerts }
}

export async function automatorHealth() {
  const [status, nodes] = await Promise.all([automatorStatus(), scanNodes()])
  const issues = automatorIssuesFrom(status, nodes)
  const totals = automatorTotals(status, nodes)
  const { alerts } = await automatorAlerts(20)
  return { ok: true, issues, alerts, totals, checkedAt: status.updatedAt }
}

export async function automatorAssist(question = "") {
  const q = String(question ?? "").trim().slice(0, 500)
  const [status, nodes] = await Promise.all([automatorStatus(), scanNodes()])
  const issues = automatorIssuesFrom(status, nodes)
  const totals = automatorTotals(status, nodes)

  let advice = null
  let source = "local"
  if (llmConfigured()) {
    try {
      const system =
        "You are PICC's passive-income copilot for bandwidth and app-earning streams " +
        "(Honeygain, Pawns, Traffmonetizer, Repocket, EarnApp, mobile apps). " +
        "You receive a live status snapshot plus detected issues. " +
        "Answer in under 180 words, plain text with line breaks, concrete and actionable. " +
        "Never instruct PICC to spend, submit, claim, or sign up on the user's behalf."
      const user = `LIVE STATUS:\n${statusBrief(status)}\n\nISSUES:\n${issueList(issues)}\n\n${
        q ? `Question: ${q}` : "Give a short status briefing and the top 3 actions to take this week."
      }`
      advice = String(await chatText(system, user)).trim()
      if (advice) source = "llm"
    } catch (err) {
      console.warn("[picc] automator assist LLM failed, using local engine:", err.message)
    }
  }

  if (!advice) advice = localAdvice(issues, totals, q)

  await appendRow("agent_logs", {
    kind: "assistant",
    source,
    level: "info",
    note: q ? `Assistant reply: "${q}"` : "Assistant: status briefing requested"
  })

  return { ok: true, source, advice, issues, totals }
}
