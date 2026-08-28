// PICC Convergence Alert Bridge (spec 8b) — turns fired `convergence_above`
// engine alerts into notifier dispatches, mirroring the signal-engine pattern
// (signalEngine.mjs -> dispatchAlert). alertEngine stays decoupled from the
// notifier: it evaluates conditions and emits notifications; this module
// subscribes and fans out only the convergence-kind ones with honest
// skipped-vs-sent records (notifier.mjs:163-168) when channels are
// unconfigured.
import { onAlert } from "./alertEngine.mjs"
import { dispatchAlert } from "./notifier.mjs"

let off = null

function fmtScore(score5) {
  return score5 == null ? "—" : `${score5}/5`
}

/**
 * Subscribes once and dispatches every convergence_above notification.
 * Idempotent; returns the unsubscribe handle.
 */
export function startConvergenceAlerts() {
  if (off) return () => off()
  off = onAlert((n) => {
    if (n?.condition !== "convergence_above") return
    const title = `📶 ${n.symbol} — convergence ${n.state ?? "—"} @ ${fmtScore(n.score5)}`
    const body = `${n.message}\nstate ${n.state ?? "—"} · score ${fmtScore(n.score5)} · threshold ${n.value}/5${Array.isArray(n.band) ? ` · band [${n.band.join(", ")}]` : ""} · ${new Date(n.ts).toISOString()}`
    void dispatchAlert({
      kind: "convergence",
      assetId: n.symbol,
      title,
      body,
      details: { condition: "convergence_above", threshold: n.value, score5: n.score5, state: n.state }
    }).catch((err) => console.warn("[picc-alerts] convergence dispatch failed:", err.message))
  })
  return () => off()
}

export function stopConvergenceAlerts() {
  if (off) {
    off()
    off = null
  }
}