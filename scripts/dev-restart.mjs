// Detached-vite-starter.mjs — starts the dashboard dev server detached with
// output to log files (opened fds, no pipes => parent exits immediately),
// so the shell tool timeout can never kill it.
import { spawn } from "node:child_process"
import { writeFileSync, mkdirSync, appendFileSync, openSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..")
const dashboardDir = join(repoRoot, "apps", "dashboard")
const logDir = join(repoRoot, "logs")
mkdirSync(logDir, { recursive: true })

const viteBin = join(repoRoot, "node_modules", "vite", "bin", "vite.js")
const outLog = join(logDir, "vite-dev.out.log")
const errLog = join(logDir, "vite-dev.err.log")

const outFd = openSync(outLog, "a")
const errFd = openSync(errLog, "a")

const child = spawn(process.execPath, [viteBin, "--host"], {
  cwd: dashboardDir,
  detached: true,
  stdio: ["ignore", outFd, errFd],
  windowsHide: true,
})

appendFileSync(outLog, `[${new Date().toISOString()}] starting vite (pid ${child.pid})...\n`)
child.on("exit", (code, signal) => {
  appendFileSync(outLog, `[${new Date().toISOString()}] vite exited code=${code} signal=${signal}\n`)
})

// Detach so it survives this script ending.
child.unref()

// Write pidfile for later kills.
writeFileSync(join(logDir, "vite-dev.pid"), String(child.pid))
console.log(`vite spawn attempted pid=${child.pid}; logs: ${outLog} / ${errLog}`)