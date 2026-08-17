// PICC all-in-one launcher: `npm run start:all`
// Builds the dashboard (if needed), starts the production server (frontend +
// /api backend), and reports the live status of every service in one screen:
// BTCPay node, CrewAI agents, and the provider matrix.
//
// Usage:
//   node scripts/start-all.mjs                # default
//   node scripts/start-all.mjs --port 8080    # change dashboard port
//   node scripts/start-all.mjs --force-build  # rebuild dist regardless
//   node scripts/start-all.mjs --n8n          # also docker compose up n8n
import { spawn } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const DASH = join(ROOT, "apps", "dashboard")
const DIST = join(DASH, "dist", "index.html")
const ENV_PATH = join(DASH, ".env")

const args = process.argv.slice(2)
const PORT = Number(args[args.indexOf("--port") + 1] || process.env.PORT || 3000)
const forceBuild = args.includes("--force-build")
const withN8n = args.includes("--n8n")

function parseEnv(path) {
  const out = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const idx = trimmed.indexOf("=")
    const k = trimmed.slice(0, idx).trim()
    const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "")
    if (k && !k.startsWith("VITE_")) out[k] = v
  }
  return out
}

const env = parseEnv(ENV_PATH)
const btcpayUrl = env.BTCPAY_URL || "http://127.0.0.1:23000"
const agentsUrl = env.PICC_AGENTS_URL || ""
const agentsVenv = existsSync(join(ROOT, "agents", "picc_agents", ".venv", "Scripts", "python.exe"))

async function probe(url, timeoutMs = 4000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return { ok: res.ok, body: await res.json().catch(() => ({})) }
  } catch {
    return { ok: false, body: {} }
  }
}

function line(label, ok, detail) {
  const mark = ok === true ? "OK " : ok === false ? "!! " : "-- "
  console.log(`  ${mark} ${label.padEnd(26)} ${detail}`)
}

console.log("")
console.log("PICC — all-in-one startup")
console.log("=========================")

// --- 1. BTCPay node --------------------------------------------------------
const btcpay = await probe(`${btcpayUrl}/api/v1/health`)
if (btcpay.ok) {
  const synced = btcpay.body.synchronized
  line("BTCPay node", synced, `${btcpayUrl} · ${synced ? "synchronized" : "still syncing blockchain"}`)
} else {
  line("BTCPay node", false, `${btcpayUrl} unreachable — check infra/btcpayserver`)
}

// --- 2. CrewAI agents ------------------------------------------------------
let agentsProbe = { ok: false }
if (agentsUrl) {
  agentsProbe = await probe(`${agentsUrl}/health`)
  line(
    "CrewAI agents",
    agentsProbe.ok,
    `${agentsUrl} · ${agentsProbe.ok ? "online" : "not responding"}${agentsVenv ? "" : " · venv not found (see docs/SETUP.md §7)"}`
  )
} else {
  line("CrewAI agents", null, "PICC_AGENTS_URL not set in apps/dashboard/.env")
}

// --- 3. n8n (optional) -----------------------------------------------------
if (withN8n) {
  const n8nDir = join(ROOT, "infra", "n8n")
  if (existsSync(join(n8nDir, "docker-compose.yml"))) {
    const up = spawn("docker", ["compose", "up", "-d"], { cwd: n8nDir, stdio: "inherit", shell: process.platform === "win32" })
    await new Promise((res) => up.on("exit", res))
    const n8n = await probe("http://127.0.0.1:5678")
    line("n8n", n8n.ok, `http://127.0.0.1:5678 · ${n8n.ok ? "up" : "still starting"}`)
  } else {
    line("n8n", false, "infra/n8n/docker-compose.yml missing")
  }
}

// --- 4. Build the dashboard (only if dist is stale/missing) ----------------
const sources = join(DASH, "src")
const needsBuild = forceBuild || !existsSync(DIST) || statSync(sources).mtimeMs > statSync(DIST).mtimeMs
if (needsBuild) {
  console.log("\n[build] dist missing or stale — running npm run build …")
  const { execSync } = await import("node:child_process")
  execSync("npm run build", { cwd: DASH, stdio: "inherit" })
} else {
  console.log("\n[build] dist is up to date — skipping")
}

// --- 5. Start the dashboard server (foreground) ----------------------------
const started = Date.now()
const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: DASH,
  env: { ...process.env, PORT: String(PORT) },
  stdio: "inherit"
})

// Wait for /api/health, then print the provider matrix once.
const deadline = started + 15000
;(async () => {
  while (Date.now() < deadline) {
    const health = await probe(`http://127.0.0.1:${PORT}/api/health`)
    if (health.ok && health.body.ok) {
      const p = health.body.providers
      console.log("\nPICC dashboard is live → http://localhost:" + PORT)
      console.log("-----------------------------------------------")
      line("Yahoo Finance", p.yahoo, "real market data")
      line("CoinGecko", p.crypto, "crypto prices (trading suite)")
      line("LLM rotation", p.llm, p.llmProviders?.join(", ") || "add any key in .env")
      line("Serper research", p.serper, "")
      line("Stripe", p.stripe, "")
      line("PayPal", p.paypal, "")
      line("BTCPay checkout", p.btcpay, btcpay.ok ? "" : "node unreachable")
      line("eWallet (TNG)", p.ewallet, "")
      line("Agents", agentsProbe.ok, agentsUrl ? (agentsProbe.ok ? "online" : "not responding") : "not configured")
      line("Amazon SP-API", p.amazon, "competitor intel")
      // Browser bridge (v2.0 connectors): real Chrome/Edge read path for
      // income sources with no public API (NFT, DeFi, DePIN, ExpertOption DOM).
      try {
        const conns = await probe(`http://127.0.0.1:${PORT}/api/connectors`, 4000)
        const browserOk = conns.ok && conns.body?.browser === true
        const connCount = Array.isArray(conns.body?.connectors) ? conns.body.connectors.length : 0
        line("Browser bridge", browserOk, `CDP + ${connCount} connectors · ${browserOk ? "Chrome/Edge ready" : "no browser found (set PICC_BROWSER_PATH)"}`)
      } catch {
        line("Browser bridge", false, "could not probe /api/connectors")
      }
      break
    }
    await new Promise((r) => setTimeout(r, 400))
  }
})()

server.on("exit", (code) => {
  console.log(`\n[dashboard] server exited (${code ?? "signal"}). Ctrl+C again to stop the launcher.`)
  process.exit(code ?? 0)
})
