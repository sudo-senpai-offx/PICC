// End-to-end probe: boot the real dashboard server, stream /api/trading/realtime
// (SSE) until the adaptive-confluence engine emits a decision event, then hit the
// on-demand GET /api/trading/decisions endpoint and print both.
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, dirname } from "node:path"

const PORT = 3123
const BASE = `http://localhost:${PORT}`
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(ROOT, ".probe-dist")
mkdirSync(DIST, { recursive: true })
const AUTH = join(ROOT, ".probe-auth")
mkdirSync(AUTH, { recursive: true })

const server = spawn(process.execPath, ["apps/dashboard/server/index.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), PICC_DIST_DIR: DIST, PICC_AUTH_DATA_DIR: AUTH },
  stdio: ["ignore", "pipe", "pipe"]
})
server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`))
server.stderr.on("data", (d) => process.stderr.write(`[server-err] ${d}`))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/trading/status`)
      if (res.status === 200 || res.status === 401) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error("server did not start")
}

async function readSse(url, durationMs) {
  const ctrl = new AbortController()
  const res = await fetch(url, { signal: ctrl.signal })
  if (res.status !== 200) {
    const body = await res.text()
    throw new Error(`SSE ${res.status}: ${body.slice(0, 200)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let lastEvent = ""
  const events = []
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      const evLine = part.split("\n").find((l) => l.startsWith("event:"))
      const dataLine = part.split("\n").find((l) => l.startsWith("data:"))
      if (evLine) lastEvent = evLine.slice(6).trim()
      if (dataLine) {
        try {
          events.push({ event: lastEvent, data: JSON.parse(dataLine.slice(5).trim()) })
        } catch {
          /* skip */
        }
      }
    }
  }
  ctrl.abort()
  return events
}

function summarizeDecision(d) {
  return {
    asset: d.asset,
    verdict: d.verdict,
    direction: d.direction,
    phase: d.phase,
    expiry: d.expiry,
    winProb: d.winProb,
    ev: d.ev,
    payout: d.payout,
    payoutSource: d.payoutSource,
    priceRR: d.priceRR,
    evRR: d.evRR,
    mttdSec: d.mttdSec,
    sampled: d.sampled,
    bars: d.bars,
    volume: d.volume ? `${d.volume.ratePerMin}/min up${d.volume.upRatio != null ? Math.round(d.volume.upRatio * 100) + "%" : "?"}` : "n/a",
    reasons: d.reasons?.slice(0, 2)
  }
}

try {
  await waitForServer()
  console.log("server up — streaming realtime SSE for 45s…")
  const events = await readSse(`${BASE}/api/trading/realtime`, 45000)
  const ticks = events.filter((e) => e.event === "tick").length
  const snaps = events.filter((e) => e.event === "snapshot")
  const decisions = events.filter((e) => e.event === "decision")
  console.log(`sse events: ${events.length} total (${ticks} ticks, ${snaps.length} snapshots, ${decisions.length} decision frames)`)
  if (decisions.length) {
    const last = decisions[decisions.length - 1].data
    console.log(`last decision frame: ts=${last.ts} status=${last.status} mode=${last.mode} decisions=${last.decisions.length}`)
    for (const d of last.decisions) console.log("  -", JSON.stringify(summarizeDecision(d)))
  }

  const onDemand = await fetch(`${BASE}/api/trading/decisions`)
  console.log(`on-demand /api/trading/decisions -> ${onDemand.status}`)
  if (onDemand.ok) {
    const body = await onDemand.json()
    console.log(`  status=${body.status} mode=${body.mode} decisions=${body.decisions.length}`)
    for (const d of body.decisions.slice(0, 4)) console.log("  -", JSON.stringify(summarizeDecision(d)))
  }
} catch (err) {
  console.error("probe failed:", err.message)
  process.exitCode = 1
} finally {
  server.kill()
  await sleep(500)
  process.exit(0)
}
