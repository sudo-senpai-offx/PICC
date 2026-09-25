#!/usr/bin/env node
// WS-7 ARM baseline probe — run this ON THE TARGET DEVICE (Snapdragon 680).
//
// Purpose: close the `ARM64: UNVERIFIED` marker that WS-6 could not close from
// an x86 host. CPU throttling on x86 proves the PERFORMANCE gate; it can never
// prove the ARCHITECTURE gate. Only a real ARM64 run can.
//
// Usage on the device:
//   node scripts/arm-probe.mjs
//
// Paste the ENTIRE output back. It is machine-readable so the numbers land in
// the spec as measured evidence rather than as prose.
import { execFileSync } from "node:child_process"
import os from "node:os"

const r = []
const line = (k, v) => r.push(`${k}=${v}`)

line("schema", "picc-arm-probe/1")
line("timestamp", new Date().toISOString())
line("platform", `${os.platform()}-${os.arch()}`)
line("cpu_model", os.cpus()?.[0]?.model?.trim() ?? "unknown")
line("cpu_cores", os.cpus()?.length ?? 0)
line("cpu_speed_mhz", os.cpus()?.[0]?.speed ?? 0)
line("total_ram_mb", Math.round(os.totalmem() / 1024 / 1024))
line("free_ram_mb", Math.round(os.freemem() / 1024 / 1024))
line("node_version", process.version)

// Memory on a phone is the real constraint. Report headroom AFTER the OS, not
// the marketing number, because a Snapdragon 680 advertising 8GB typically
// exposes far less to userspace and less again to a browser tab.
const mb = (n) => Math.round(n / 1024 / 1024)
line("heap_total_mb", mb(process.memoryUsage().heapTotal))

// Single-thread integer+float loop: a cheap, dependency-free CPU ceiling that
// correlates with indicator-computation cost on this class of silicon.
const t0 = process.hrtime.bigint()
let acc = 0
for (let i = 1; i <= 8_000_000; i++) acc = (acc + Math.sqrt(i) * Math.sin(i)) % 1e9
const t1 = process.hrtime.bigint()
line("bench_ms", Number(t1 - t0) / 1e6)
line("bench_checksum", acc.toFixed(3))

// Event-loop responsiveness matters more than raw speed for a realtime feed:
// a blocked loop drops ticks. Measure scheduler jitter under a 50ms timer.
const jitter = await new Promise((resolve) => {
  const samples = []
  let last = process.hrtime.bigint()
  const iv = setInterval(() => {
    const now = process.hrtime.bigint()
    samples.push(Number(now - last) / 1e6 - 50)
    last = now
    if (samples.length >= 40) {
      clearInterval(iv)
      samples.sort((a, b) => a - b)
      resolve({
        p50: samples[20],
        p95: samples[38],
        max: samples[samples.length - 1]
      })
    }
  }, 50)
})
line("jitter_p50_ms", jitter.p50.toFixed(2))
line("jitter_p95_ms", jitter.p95.toFixed(2))
line("jitter_max_ms", jitter.max.toFixed(2))

// Try to detect whether Python is present, so we know whether the agents
// service is viable on this device at all.
try {
  const py = execFileSync("python3", ["--version"], { encoding: "utf8" }).trim()
  line("python", py)
} catch {
  try {
    const py = execFileSync("python", ["--version"], { encoding: "utf8" }).trim()
    line("python", py)
  } catch {
    line("python", "absent")
  }
}

console.log(r.join("\n"))
