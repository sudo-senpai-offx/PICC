// PICC dev launcher: `npm run dev`
// Boots the dashboard (Vite dev server with the embedded /api backend) and the
// CrewAI agents microservice (uvicorn on port 8000) together, and tears both
// down cleanly on Ctrl+C.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const DASH = join(ROOT, "apps", "dashboard")
const AGENTS = join(ROOT, "agents", "picc_agents")
const ENV_PATH = join(DASH, ".env")
const VITE_BIN = join(ROOT, "node_modules", "vite", "bin", "vite.js")
const AGENTS_PORT_DEFAULT = 8000

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

async function probe(url, timeoutMs = 4000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

const env = parseEnv(ENV_PATH)
const agentsUrl = env.PICC_AGENTS_URL || `http://127.0.0.1:${AGENTS_PORT_DEFAULT}`
const agentsPort = Number(new URL(agentsUrl).port) || AGENTS_PORT_DEFAULT
const venvPy = process.platform === "win32"
  ? join(AGENTS, ".venv", "Scripts", "python.exe")
  : join(AGENTS, ".venv", "bin", "python")

// Free the agents port so `npm run dev` always owns the service. Only kills a
// listener whose command line is uvicorn running PICC's `server:app` module.
function freeAgentsPort() {
  if (process.platform !== "win32") return
  const ps = [
    `$pids = Get-NetTCPConnection -LocalPort ${agentsPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
    "foreach ($p in $pids) {",
    "  $proc = Get-CimInstance Win32_Process -Filter \"ProcessId=$p\" -ErrorAction SilentlyContinue",
    "  if ($proc -and $proc.CommandLine -match 'uvicorn') { & taskkill /F /T /PID $p 2>$null | Out-Null }",
    "}"
  ].join("; ")
  try {
    spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore" })
  } catch {}
}

if (!existsSync(VITE_BIN)) {
  console.error("[dev] vite not found — run `npm install` first")
  process.exit(1)
}
if (!existsSync(venvPy)) {
  console.error("[dev] agents venv missing at " + venvPy + " — create it (see agents/picc_agents/README.md)")
  process.exit(1)
}
if (!env.PICC_AGENTS_URL) {
  console.warn("[dev] PICC_AGENTS_URL not set in apps/dashboard/.env — dashboard won't reach the agents service")
}

freeAgentsPort()

console.log("[dev] starting dashboard (vite) and agents service (uvicorn)...")
const vite = spawn(process.execPath, [VITE_BIN], { cwd: DASH, stdio: "inherit" })
const agents = spawn(venvPy, ["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", String(agentsPort)], { cwd: AGENTS, stdio: "inherit" })

let shuttingDown = false
const children = [vite, agents]

function forceKill(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === "win32") {
    try { spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" }) } catch {}
  } else {
    try { process.kill(-child.pid, "SIGKILL") } catch { try { child.kill("SIGKILL") } catch {} }
  }
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  console.log("\n[dev] shutting down...")
  // Children share the console (stdio: inherit), so on Windows Ctrl+C already
  // reaches them and they shut down gracefully on their own. On POSIX the
  // signal only lands on this process, so forward it.
  if (process.platform !== "win32") {
    for (const c of children) { try { c.kill("SIGINT") } catch {} }
  }
  const deadline = Date.now() + 5000
  const timer = setInterval(() => {
    const alive = children.filter((c) => c.exitCode === null && c.signalCode === null)
    if (alive.length === 0 || Date.now() > deadline) {
      clearInterval(timer)
      for (const c of alive) forceKill(c)
      setTimeout(() => process.exit(0), 250)
    }
  }, 100)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
if (process.platform === "win32") process.on("SIGBREAK", shutdown)

vite.on("exit", (code, signal) => {
  if (shuttingDown) return
  console.error(`\n[dev] dashboard exited (${code ?? signal}); stopping everything`)
  shutdown()
})

agents.on("exit", (code, signal) => {
  if (shuttingDown) return
  const hint = code ? ` (uvicorn error code ${code}${code === 100 ? " — port " + agentsPort + " in use?" : ""})` : ""
  console.error(`[dev] agents service exited${hint}; dashboard keeps running`)
})

// Report once both services are up.
async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !shuttingDown) {
    if (await probe(url)) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

;(async () => {
  const dashUp = await waitFor("http://localhost:5173/api/health", 20000)
  if (!dashUp || shuttingDown) return
  console.log(`\n[dev] dashboard live at http://localhost:5173`)
  const agentsUp = await waitFor(`${agentsUrl}/health`, 10000)
  console.log(`[dev] agents (CrewAI) ${agentsUp ? "online" : "not responding"} at ${agentsUrl}`)
  if (!shuttingDown) console.log(`[dev] Ctrl+C stops both.`)
})()
