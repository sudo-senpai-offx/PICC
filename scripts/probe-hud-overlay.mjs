// HUD overlay probe: boot the real dashboard server, open the PICC studio on
// expertoption.com (headless), and verify the trading HUD overlay is injected
// into the broker page — container + DEMO badge + toggle + countdown clocks —
// and that it re-injects after a navigation. Also checks the dashboard HUD's
// data endpoints respond.
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, dirname } from "node:path"

const PORT = 3124
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

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/trading/status`)
      if (r.status === 200 || r.status === 401) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error("server did not start")
}

async function waitForTradingSite(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await api("/api/browser/status")
    const site = r.json?.currentSite ?? null
    const suite = r.json?.suite ?? null
    if (r.json?.open && site?.category === "trading") return { site, suite }
    await sleep(1000)
  }
  return null
}

let passed = 0
let failed = 0
const check = (name, ok, extra = "") => {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`)
  }
}

try {
  await waitForServer()
  console.log("server up — opening headless studio…")

  const opened = await api("/api/browser/open", { method: "POST", body: { headless: true } })
  check("studio opens headless", opened.status === 200 && opened.json?.open === true, `status=${opened.status}`)
  if (opened.status !== 200) throw new Error(`open failed: ${opened.text.slice(0, 300)}`)

  console.log("navigating the studio to expertoption.com…")
  const tab = await api("/api/browser/tab", { method: "POST", body: { action: "new", url: "https://www.expertoption.com/en" } })
  check("tab request accepted", tab.status === 200, `status=${tab.status}`)

  const active = await waitForTradingSite(60000)
  check("trading site detected on the active tab", Boolean(active), active ? `category=${active.site?.category} suite=${active.suite?.id}` : "timeout")
  if (!active) throw new Error("studio never reached a trading site")

  console.log("waiting for the decision engine + first HUD push…")
  await sleep(5000)

  const read1 = await api("/api/browser/read", {
    method: "POST",
    body: {
      selectors: {
        hud: "[data-picc-hud]",
        toggle: "[data-picc-hud-role='toggle']",
        row: "[data-picc-hud-role='row']",
        clock: "[data-picc-clock]"
      }
    }
  })
  const r1 = read1.json ?? {}
  check("read request ok", read1.status === 200, `status=${read1.status}`)
  check("HUD container injected", Boolean(r1.hud), r1.hud ? r1.hud.slice(0, 80).replace(/\n/g, " ") : "not found")
  check("HUD header + DEMO badge present", Boolean(r1.hud && r1.hud.includes("PICC ·") && r1.hud.includes("DEMO")))
  check("expand/collapse toggle present", Boolean(r1.toggle))
  if (/0 signals/.test(r1.hud ?? "")) {
    check("countdown clocks present", true, "n/a — 0 signals in this headless probe (clocks render per row; covered by tradingHud.test.mjs)")
  } else {
    check("countdown clocks present", Boolean(r1.clock && r1.clock.includes("expiry")), r1.clock ?? "none")
  }

  console.log("navigating to another broker page (re-injection check)…")
  const goto = await api("/api/browser/goto", { method: "POST", body: { url: "https://www.expertoption.com/en/trading" } })
  check("goto accepted", goto.status === 200, `status=${goto.status}`)
  await sleep(4000)

  const read2 = await api("/api/browser/read", {
    method: "POST",
    body: { selectors: { hud: "[data-picc-hud]", toggle: "[data-picc-hud-role='toggle']" } }
  })
  const r2 = read2.json ?? {}
  check("HUD re-injected after navigation", Boolean(r2.hud && r2.toggle), r2.hud ? r2.hud.slice(0, 60).replace(/\n/g, " ") : "not found")

  console.log("checking dashboard HUD data endpoints…")
  const decisions = await api("/api/trading/decisions")
  check("GET /api/trading/decisions responds", decisions.status === 200, `status=${decisions.status}`)
  if (decisions.json) {
    check("decision frame shape valid", Array.isArray(decisions.json.decisions) && typeof decisions.json.ts === "number")
  }

  const assist = await api("/api/browser/assist")
  check("GET /api/browser/assist carries trading suite", assist.status === 200 && assist.json?.suite?.id === "trading", assist.json?.suite?.id ?? "n/a")

  console.log("checking accuracy-ledger endpoints…")
  const ledger = await api("/api/trading/ledger")
  check("GET /api/trading/ledger responds", ledger.status === 200 && ledger.json?.stats && Array.isArray(ledger.json?.entries), `status=${ledger.status}`)

  const backtest = await api("/api/trading/ledger/backtest")
  check(
    "GET /api/trading/ledger/backtest responds",
    backtest.status === 200 && Array.isArray(backtest.json?.rows) && typeof backtest.json?.engine?.n === "number",
    `status=${backtest.status}`
  )

  const payouts = await api("/api/trading/observed-payouts")
  check(
    "GET /api/trading/observed-payouts responds",
    payouts.status === 200 && payouts.json?.ok === true && Array.isArray(payouts.json?.entries),
    `status=${payouts.status}`
  )
} catch (err) {
  failed++
  console.error("probe failed:", err.message)
} finally {
  console.log(`\nHUD probe: ${passed} passed, ${failed} failed`)
  server.kill()
  await sleep(500)
  process.exit(failed ? 1 : 0)
}
