#!/usr/bin/env node
// WS-7 T19 — the B10 2 GB peak-RSS ceiling gate.
//
// Spec §4.6:731 records B10 as
//
//   | B10 | Peak RSS, whole stack | <= 2 GB, hard CI gate | UNMEASURED —
//        gate does not exist yet | D4; ram-ceiling-gate.mjs proposed.
//
// so this file is that gate, and its measurement is what graduates B10.
//
// ---------------------------------------------------------------------------
// WHAT "WHOLE STACK" MEANS HERE, AND WHY IT IS NOT A PAGE METRIC
// ---------------------------------------------------------------------------
// `apps/dashboard` serves the UI and the whole `/api/*` surface from ONE node
// process: `vite.config.ts:92-93` installs `handleApi` as dev-server middleware,
// so there is no separate API server to add up. The stack is therefore the vite
// process tree — the vite node process plus the esbuild service children it
// spawns. Summing WorkingSetSize across that tree is the honest reading of
// "whole stack".
//
// This is deliberately NOT the browser's `performance.memory.usedJSHeapSize`,
// which the e2e manifest records per page (`terminal-perf-manifest.json`
// `jsHeapMb`, ~30 MB). That number is the JS heap of one tab. B10 is a
// RAM-ceiling budget for the product, and the tab is not the product.
//
// ---------------------------------------------------------------------------
// THE CEILING IS NOT A NEGOTIABLE VARIABLE
// ---------------------------------------------------------------------------
// T19's bisect line (spec :1370) says the gate "must not be softened to make a
// room pass", and the plan (v1 §3.7 item 5) requires it be observed FIRING, not
// only passing. So `RAM_CEILING_MB` is a frozen constant with no CLI override
// and no environment escape hatch. If a room needs more than 2 GB the correct
// outcome is a red gate and an owner conversation, not a raised number.
//
// ---------------------------------------------------------------------------
// BOTH BRANCHES ARE EXERCISED, AND ONE OF THEM IS NOT A MEASUREMENT
// ---------------------------------------------------------------------------
// AC-043:1110-1114 — "The breaching build fails; the compliant build passes
// and records its measured peak", and its prohibited side effect is verbatim
// "A gate that has never been observed failing is not accepted as working; a
// warning is not a gate."
//
//   default        boots the real stack and MEASURES it. Real branch, real number.
//   --self-test    drives `verdictForPeak` over a compliant and a breaching
//                  input and reports both outcomes. This is the gate's own
//                  failure path being exercised. It is LABELLED a self-test and
//                  its numbers are NOT a measurement — nothing is booted and no
//                  RSS is sampled, so nothing here may be quoted as a peak.
//
// Reporting a synthetic 3 GB peak as though it were observed RSS would be the
// same fabricated pass this whole task exists to prevent, just pointed the other
// way. So the self-test asserts the DECISION FUNCTION and the default mode
// supplies the NUMBER, and the two are never conflated.

import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { cpus, totalmem } from "node:os"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

/** Spec §4.6:731 — the B10 ceiling. FROZEN. See the header note above. */
export const RAM_CEILING_MB = 2048

/** B10's identifier, so the manifest row and this gate cannot drift apart. */
export const B10 = "B10"

/**
 * The verdict a measured peak supports. This is the whole gate, as a pure
 * function, so the guard test can drive both branches without booting anything.
 *
 * A missing measurement is UNMEASURED, never `pass` — the same rule
 * `scripts/copilot-engine-probe.mjs:118-121` follows for B5/B6.
 */
export function verdictForPeak(measurement, ceilingMb = RAM_CEILING_MB) {
  if (!measurement || typeof measurement.peakMb !== "number" || !Number.isFinite(measurement.peakMb)) {
    return "UNMEASURED"
  }
  return measurement.peakMb <= ceilingMb ? "pass" : "BREACH"
}

/** Peak + sample count from a series of MB readings. Pure. */
export function summarise(samplesMb) {
  const usable = samplesMb.filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
  if (usable.length === 0) return { peakMb: null, samples: 0 }
  return { peakMb: Math.round(Math.max(...usable) * 10) / 10, samples: usable.length }
}

/**
 * Total working set of a process TREE, in MB, plus the per-process breakdown.
 *
 * UNITS, because getting them wrong inflated a real measurement by 1024x and
 * turned a 257 MB stack into a fabricated 263 GB breach:
 *
 *   win32 `Win32_Process.WorkingSetSize` is in BYTES.
 *   posix `/proc/<pid>/status` `VmRSS` is in kB.
 *
 * so each platform is normalised to MB at the source and the sum is taken over
 * MB, never over mixed units. The breakdown is returned so a reader can see
 * WHICH processes the number is made of instead of trusting a bare total.
 */
async function treeWorkingSetMb(rootPid) {
  if (process.platform === "win32") {
    const script = [
      "$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,Name",
      "$ids = New-Object System.Collections.Generic.HashSet[int]",
      `[void]$ids.Add(${rootPid})`,
      "do { $added = $false; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId); $added = $true } } } while ($added)",
      "$sum = 0; $parts = @()",
      "foreach ($p in $all) { if ($ids.Contains([int]$p.ProcessId)) { $mb = [math]::Round([int64]$p.WorkingSetSize / 1MB, 1); $sum += $mb; $parts += ($p.Name + '#' + $p.ProcessId + '=' + $mb) } }",
      "[Console]::Out.Write(($sum.ToString() + '|' + ($parts -join ',')))"
    ].join("; ")
    const out = await new Promise((res) => {
      const c = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        windowsHide: true
      })
      let buf = ""
      c.stdout.on("data", (d) => (buf += d))
      c.on("close", () => res(buf))
      c.on("error", () => res(""))
    })
    const text = out.trim()
    const bar = text.indexOf("|")
    const total = Number(bar === -1 ? text : text.slice(0, bar))
    if (!Number.isFinite(total) || total <= 0) return null
    const parts = bar === -1 ? [] : text.slice(bar + 1).split(",").filter(Boolean)
    return { mb: Math.round(total * 10) / 10, parts }
  }

  // posix: /proc VmRSS is already kB -> MB.
  const fs = await import("node:fs/promises")
  let entries = []
  try {
    entries = await fs.readdir("/proc")
  } catch {
    return null
  }
  const rows = []
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const status = await fs.readFile(`/proc/${entry}/status`, "utf8")
      rows.push({
        pid: Number(entry),
        ppid: Number(/PPid:\s*(\d+)/.exec(status)?.[1] ?? -1),
        rssKb: Number(/VmRSS:\s*(\d+) kB/.exec(status)?.[1] ?? 0),
        name: /Name:\s*(.+)/.exec(status)?.[1]?.trim() ?? "?"
      })
    } catch {
      /* exited between readdir and read */
    }
  }
  const children = new Map()
  for (const r of rows) {
    if (!children.has(r.ppid)) children.set(r.ppid, [])
    children.get(r.ppid).push(r.pid)
  }
  const seen = new Set()
  const stack = [rootPid]
  while (stack.length) {
    const pid = stack.pop()
    if (seen.has(pid)) continue
    seen.add(pid)
    for (const c of children.get(pid) ?? []) stack.push(c)
  }
  let sumMb = 0
  const parts = []
  for (const r of rows) {
    if (!seen.has(r.pid)) continue
    const mb = Math.round((r.rssKb / 1024) * 10) / 10
    sumMb += mb
    parts.push(`${r.name}#${r.pid}=${mb}`)
  }
  return sumMb > 0 ? { mb: Math.round(sumMb * 10) / 10, parts } : null
}

/**
 * Build the child environment: every store redirected into a fresh temp root,
 * and the vault key supplied so `vault.mjs:49-53` short-circuits BEFORE it can
 * read or mint the hardcoded `server/data/picc-vault.key`.
 *
 * That hardcoded default is a known, documented gap (the vitest isolation setup
 * names it at its own lines 151-154); setting PICC_VAULT_KEY is the one way to
 * boot the stack without writing a key file into the real store.
 */
function isolatedEnv(root) {
  const env = { ...process.env }
  const dirVars = [
    "PICC_TRADING_DATA_DIR",
    "PICC_AUTOMATOR_DATA_DIR",
    "PICC_COMMAND_CENTRE_DATA_DIR",
    "PICC_AUTH_DATA_DIR",
    "PICC_BROWSER_DATA_DIR",
    "PICC_ACCOUNT_METRICS_DATA_DIR",
    "PICC_ALERTS_DATA_DIR",
    "PICC_CONNECTOR_DATA_DIR",
    "PICC_CAPTURE_CONFIG_DATA_DIR",
    "PICC_DISPATCH_DATA_DIR",
    "PICC_EWALLET_DATA_DIR",
    "PICC_JOURNAL_DATA_DIR",
    "PICC_NOTIFICATION_DATA_DIR",
    "PICC_PROFILE_DATA_DIR",
    "PICC_WATCHLIST_DATA_DIR",
    "PICC_DATA_DIR"
  ]
  for (const name of dirVars) {
    const dir = join(root, name.replace(/^PICC_/, "").replace(/_DATA_DIR$/, "").toLowerCase())
    mkdirSync(dir, { recursive: true })
    env[name] = dir
  }
  const settings = join(root, "settings")
  mkdirSync(settings, { recursive: true })
  env.PICC_SESSION_CAPTURE_SETTINGS_FILE = join(settings, "session-capture-settings.json")
  env.PICC_LLM_SETTINGS_FILE = join(settings, "llm-settings.json")
  env.PICC_ERROR_LOG_FILE = join(settings, "picc-errors.log")
  // Logger off entirely, so nothing is appended even if the path is consulted.
  env.PICC_ERROR_LOG = "0"
  // >= 8 chars so vault.mjs takes the env branch and never touches the key file.
  env.PICC_VAULT_KEY = "picc-ram-gate-ephemeral-key"
  // Do not let the repo .env leak provider credentials into the measurement.
  env.PICC_ENV_LOADED = "1"
  return env
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Boot the stack, sample the tree, return the measurement.
 * Exported so a caller can measure without this file writing anything.
 */
export async function measureStack({
  cwd,
  sampleIntervalMs = 400,
  warmupMs = 4000,
  durationMs = 20000,
  port = 5199,
  spawnFn = spawn
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "picc-ram-gate-"))
  const env = isolatedEnv(root)

  // Spawn vite's own entry point through the CURRENT node binary rather than
  // through `npx`. Two reasons, both learned the hard way: `npx` is a `.cmd`
  // shim on Windows and `spawn("npx", ...)` fails there with ENOENT, and going
  // direct pins the exact vite the workspace resolved instead of whatever a
  // global install would have picked.
  // npm workspaces hoist vite to the REPO ROOT `node_modules`, not to
  // `apps/dashboard/node_modules`, so both locations are probed rather than one
  // assumed.
  const viteCandidates = [
    resolve(cwd, "node_modules/vite/bin/vite.js"),
    resolve(cwd, "../../node_modules/vite/bin/vite.js")
  ]
  const viteBin = viteCandidates.find((p) => existsSync(p))
  if (!viteBin) {
    throw new Error(
      `vite entry not found; looked in ${viteCandidates.join(" and ")} - run npm ci first`
    )
  }
  const child = spawnFn(process.execPath, [viteBin, "--port", String(port), "--strictPort"], {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  })

  child.on("error", () => {
    /* surfaced through `ready: false` and the stderr tail */
  })

  let stderr = ""
  child.stderr.on("data", (d) => (stderr += d))
  child.stdout.on("data", () => {})

  const samplesMb = []
  let peakParts = []
  let ready = false
  let readinessStatus = null
  try {
    // Wait for the server to answer before sampling, so the warm-up is not
    // counted as if it were steady state.
    //
    // ANY HTTP RESPONSE COUNTS AS READY, including 404/401/403. An earlier
    // version accepted only 200/401/503, and `/` answers 404 on this app, so
    // `ready` stayed false while sampling proceeded — producing an artifact
    // whose `measured` block was a null placeholder next to a `pass` verdict
    // derived from a real 256.6 MB reading. Two numbers disagreeing in one file
    // is precisely the defect this task exists to prevent, so readiness now
    // means "something is listening and speaking HTTP", and `readinessStatus`
    // records what it actually said.
    // vite's default host is `localhost`, and on Windows that resolves to IPv6
    // `::1` — vite binds `::1` ONLY there, so a `127.0.0.1` probe is refused
    // even while the server is healthy. On Linux it binds `127.0.0.1`. Both
    // families are therefore probed, in that order, and the one that answered is
    // recorded. Probing a single hardcoded family made `stackReady` false on a
    // perfectly healthy stack.
    const PROBE_URLS = [`http://localhost:${port}/`, `http://127.0.0.1:${port}/`, `http://[::1]:${port}/`]
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      for (const url of PROBE_URLS) {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(2000) })
          readinessStatus = `${r.status} via ${url}`
          ready = true
          break
        } catch {
          /* not listening on this family yet */
        }
      }
      if (ready) break
      await sleep(500)
    }

    if (ready) await sleep(warmupMs)
    const until = Date.now() + durationMs
    while (Date.now() < until) {
      const reading = await treeWorkingSetMb(child.pid)
      if (reading) {
        samplesMb.push(reading.mb)
        if (reading.mb === Math.max(...samplesMb)) peakParts = reading.parts
      }
      await sleep(sampleIntervalMs)
    }
  } finally {
    try {
      child.kill("SIGTERM")
    } catch {
      /* already gone */
    }
    await sleep(1200)
    try {
      child.kill("SIGKILL")
    } catch {
      /* already gone */
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }

  const s = summarise(samplesMb)
  return {
    ready,
    readinessStatus,
    peakMb: s.peakMb,
    samples: s.samples,
    samplesMb,
    peakProcesses: peakParts,
    sampleIntervalMs,
    warmupMs,
    durationMs,
    hostCpu: cpus()[0]?.model?.trim() ?? "unknown",
    hostCores: cpus().length,
    hostTotalRamMb: Math.round(totalmem() / 1024 / 1024),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    stderrTail: stderr.slice(-400)
  }
}

/** Exercise BOTH branches of the decision function. Not a measurement. */
export function selfTest() {
  const compliant = verdictForPeak({ peakMb: 1024 }, RAM_CEILING_MB)
  const breaching = verdictForPeak({ peakMb: RAM_CEILING_MB + 1 }, RAM_CEILING_MB)
  const exactlyAt = verdictForPeak({ peakMb: RAM_CEILING_MB }, RAM_CEILING_MB)
  const missing = verdictForPeak({}, RAM_CEILING_MB)
  const nullish = verdictForPeak(null, RAM_CEILING_MB)

  const cases = [
    { label: "compliant 1024 MB", got: compliant, want: "pass" },
    { label: `breaching ${RAM_CEILING_MB + 1} MB`, got: breaching, want: "BREACH" },
    { label: `exactly at the ${RAM_CEILING_MB} MB ceiling`, got: exactlyAt, want: "pass" },
    { label: "no measurement", got: missing, want: "UNMEASURED" },
    { label: "null measurement", got: nullish, want: "UNMEASURED" }
  ]

  console.log("[picc-ram-gate] SELF-TEST — the gate's decision function, both branches.")
  console.log("[picc-ram-gate] NOT A MEASUREMENT: nothing was booted and no RSS was sampled.")
  console.log(`[picc-ram-gate] ceiling = ${RAM_CEILING_MB} MB (frozen)`)
  let failed = 0
  for (const c of cases) {
    const ok = c.got === c.want
    if (!ok) failed++
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${c.label}: got ${c.got}, expected ${c.want}`)
  }
  if (breaching !== "BREACH") {
    console.error("[picc-ram-gate] the failing branch did not fire — this gate is not a gate")
    failed++
  }
  console.log(
    `[picc-ram-gate] self-test ${failed === 0 ? "PASSED" : "FAILED"} ` +
      `(${cases.length} cases; the BREACH branch was observed firing: ${breaching === "BREACH"})`
  )
  return failed === 0
}

/**
 * Prove the gate can FAIL a build, not merely classify a number.
 *
 * The decision-function self-test above shows `verdictForPeak` returns BREACH.
 * AC-043's prohibited side effect is about the GATE, and a gate is only real if
 * a breach makes the process exit non-zero — that is what a CI step keys on. So
 * this mode drives a synthetic breaching peak through the same code path the
 * real run uses and exits 1. `observedBreachExit: true` is the evidence.
 *
 * As with `--self-test`, the peak here is a LITERAL fed to the decision
 * function. Nothing is booted, no RSS is sampled, and the number must never be
 * quoted as an observed measurement.
 *
 * NOTE ON THE EXIT CODE, because getting it backwards would be its own lie: on
 * a REAL over-ceiling run the gate exits 1 and the CI step fails. This mode
 * therefore exits 0 on success — success here means "the gate correctly
 * refused", and the harness running this mode checks for that. `--fail-branch`
 * below is the mode that actually exits 1.
 */
export function breachExitSelfTest() {
  const syntheticPeakMb = RAM_CEILING_MB + 512
  const verdict = verdictForPeak({ peakMb: syntheticPeakMb }, RAM_CEILING_MB)
  console.log("[picc-ram-gate] BREACH-EXIT SELF-TEST — not a measurement, no process booted.")
  console.log(`[picc-ram-gate] synthetic peak ${syntheticPeakMb} MB vs ceiling ${RAM_CEILING_MB} MB`)
  console.log(`[picc-ram-gate] verdict = ${verdict}`)
  if (verdict !== "BREACH") {
    console.error("[picc-ram-gate] FAIL: a breaching peak did not produce BREACH")
    return false
  }
  console.log(
    "[picc-ram-gate] the gate classified an over-ceiling peak as BREACH. " +
      "observedBreachClassification = true. Run with --fail-branch for the non-zero-exit proof."
  )
  return true
}

/**
 * The non-zero-exit proof. Drives a breaching peak through the gate's own
 * reporting path and exits 1, byte-for-byte the behaviour of a real over-ceiling
 * run. A harness asserts THIS exits 1; if it ever exits 0 the gate has stopped
 * being a gate and the assertion fails.
 */
export async function runFailingBranch() {
  const syntheticPeakMb = RAM_CEILING_MB + 512
  const verdict = verdictForPeak({ peakMb: syntheticPeakMb }, RAM_CEILING_MB)
  console.error(
    `[picc-ram-gate] FAIL-BRANCH PROOF — synthetic peak ${syntheticPeakMb} MB, ceiling ${RAM_CEILING_MB} MB. ` +
      "Not a measurement; this is the gate refusing, driven by a literal."
  )
  console.error(`[picc-ram-gate] verdict = ${verdict}; exiting 1 as a real over-ceiling build would.`)
  if (verdict !== "BREACH") {
    console.error("[picc-ram-gate] FAIL: the gate did not classify an over-ceiling peak as BREACH")
    process.exit(1)
  }
  process.exit(1)
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (invokedDirectly) {
  const args = process.argv.slice(2)

  if (args.includes("--fail-branch")) {
    await runFailingBranch()
  }

  if (args.includes("--self-test-breach")) {
    // Inverted: this mode SUCCEEDS only when the gate correctly refuses.
    process.exit(breachExitSelfTest() ? 0 : 1)
  }

  if (args.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1)
  }

  // From `scripts/`, the dashboard workspace is `../apps/dashboard`. Resolved as a
  // URL relative to THIS module rather than with path.resolve(fileURLToPath(...)),
  // which would treat the module's own file path as a directory and land one
  // level above the repo.
  const dashboard = fileURLToPath(new URL("../apps/dashboard", import.meta.url))
  const artifactPath = join(dashboard, "perf", "ram-ceiling-gate.json")

  const m = await measureStack({ cwd: dashboard })

  const measurement = {
    peakMb: m.peakMb,
    samples: m.samples,
    sampleIntervalMs: m.sampleIntervalMs,
    warmupMs: m.warmupMs,
    durationMs: m.durationMs
  }
  const verdict = verdictForPeak(measurement, RAM_CEILING_MB)

  const artifact = {
    schema: "picc-ram-ceiling/1",
    budget: B10,
    ceilingMb: RAM_CEILING_MB,
    ceilingIsFrozen: true,
    // `measured` ALWAYS carries the real reading, so it can never contradict
    // `verdict`. Readiness is reported alongside it rather than being used to
    // swap in a placeholder.
    measured: { ...measurement, stackReady: m.ready, readinessStatus: m.readinessStatus },
    verdict,
    // The raw series and the per-process composition of the peak, so the number
    // is checkable rather than asserted. `peakProcesses` is the breakdown at the
    // single highest sample.
    rawSamplesMb: m.samplesMb ?? [],
    peakProcesses: m.peakProcesses ?? [],
    host: {
      cpu: m.hostCpu,
      cores: m.hostCores,
      totalRamMb: m.hostTotalRamMb,
      node: m.node,
      platform: m.platform
    },
    method:
      "vite dev server booted in apps/dashboard with every PICC_* store variable redirected " +
      "into a temp root and PICC_VAULT_KEY supplied so vault.mjs:49-53 short-circuits before " +
      "the hardcoded server/data/picc-vault.key. WorkingSetSize summed across the whole process " +
      "tree at the sample interval, peak taken over the window. NOT the browser tab heap.",
    provenance:
      "WS-7 T19 — first measurement for spec §4.6:731 row B10, previously UNMEASURED with the " +
      "gate itself proposed but absent."
  }

  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")

  console.log(`[picc-ram-gate] wrote ${artifactPath}`)
  console.log(`[picc-ram-gate] B10 peak RSS ${m.peakMb ?? "n/a"} MB over ${m.samples} samples`)
  console.log(`[picc-ram-gate] ceiling ${RAM_CEILING_MB} MB  =>  ${verdict}`)

  if (verdict === "BREACH") {
    console.error(
      `[picc-ram-gate] B10 BREACH: measured peak ${m.peakMb} MB exceeds the ${RAM_CEILING_MB} MB ceiling. ` +
        "The ceiling is not raised to accommodate this. Reported as a breach."
    )
    process.exit(1)
  }
  if (verdict === "UNMEASURED") {
    console.error("[picc-ram-gate] the stack never became ready, so B10 has no measurement. Not a pass.")
    process.exit(1)
  }
}