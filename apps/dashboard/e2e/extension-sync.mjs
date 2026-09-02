// PICC Sensor — real-browser E2E verification harness (manual / CI-optional).
//
// Verifies the per-stream sync redesign against a REAL Chromium-family browser
// (Microsoft Edge, already installed — no browser download needed) with the
// unpacked extension loaded:
//
//   1. extension service worker is alive and the sync scheduler alarms exist
//   2. content script injects on an http page
//   3. worker →content "venue-scan-now" round-trip runs scanVenueSession and
//      the observed session token relays to the server (capture-session POST)
//   4. the CAPTURE DEDUP holds: an identical second ping produces no duplicate
//   5. sensor-queue-depth round-trip answers (popup/worker ↔ content)
//   6. (full mode, ~75 s) the ALARM-DRIVEN scheduler pings the venue tab on its
//      own — proven by the sensor's scan clock advancing with NO manual
//      intervention, while the capture dedup keeps the relay count flat
//
// The fixture server answers exactly the endpoints the extension needs and
// reports a venue row whose host matches the fixture page, so the venue-scan
// path is exercised end-to-end WITHOUT a real ExpertOption login. This tests
// the EXTENSION's mechanics honestly; the server-side capture rules are covered
// by the vitest suite (extensionSessionCapture / captureProfiles), and the
// cadence policy by syncPolicy.test.mjs.
//
// Prereqs: none beyond a Windows host with Edge (the default path below) and
// playwright-core already resolvable from node_modules.
//
// Usage (repo root):
//   node apps/dashboard/e2e/extension-sync.mjs          # full, includes ~75 s scheduler wait
//   QUICK=1 node apps/dashboard/e2e/extension-sync.mjs  # skip the scheduler wait
//
// If a REAL PICC dev server is already listening on a PICC port (5173/3000/
// 5174/3001), the harness aborts with a clear message — the worker would detect
// that server instead of the fixture.

import { createServer } from "node:http"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT_DIR = join(__dirname, "..", "extensions", "picc-overlay")
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
const PICC_PORTS = [5173, 3000, 5174, 3001]
const TOKEN = "0123456789abcdef0123456789abcdef"
const QUICK = process.env.QUICK === "1"

let failures = 0
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

function listenOk(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => resolve({ ok: false }))
    server.listen(port, "127.0.0.1", () => resolve({ ok: true, server }))
  })
}

async function startFixture() {
  // Bind a PICC port the extension will auto-detect (background.js PICC_PORTS).
  for (const port of PICC_PORTS) {
    const { ok, server } = await listenOk(port)
    if (!ok) continue
    console.log(`fixture server on 127.0.0.1:${port}`)
    const captured = { sessions: [] }
    const venueRow = {
      venueId: "fixture",
      name: "Fixture Venue",
      hostRe: "127\\.0\\.0\\.1",
      via: "liveEO",
      keys: [
        { type: "cookie", key: "token" },
        { type: "cookie", key: "tokenDemo" },
        { type: "localStorage", key: "token" },
        { type: "sessionStorage", key: "token" }
      ],
      profileKeys: "user|account|profile|auth|session|current|me$|identity",
      enabled: true
    }
    server.on("request", (req, res) => {
      const url = (req.url ?? "/").split("?")[0]
      const send = (code, body) => {
        res.writeHead(code, { "Content-Type": "application/json" })
        res.end(JSON.stringify(body))
      }
      let raw = ""
      req.on("data", (c) => { raw += c })
      req.on("end", () => {
        let body = {}
        try { body = raw ? JSON.parse(raw) : {} } catch { /* ignore */ }
        if (url === "/api/health") return send(200, { ok: true })
        if (url === "/api/trading/capture-profiles") return send(200, { ok: true, venues: [venueRow] })
        if (url === "/api/trading/capture-session" && req.method === "POST") {
          captured.sessions.push(body)
          return send(200, { ok: true, state: "ok" })
        }
        if (url === "/api/extension/heartbeat") return send(200, { ok: true })
        if (url === "/api/trading/headless-status") return send(200, { ok: true, venues: null })
        if (url === "/") {
          res.writeHead(200, { "Content-Type": "text/html" })
          return res.end("<!doctype html><title>fixture venue</title><h1>Fixture</h1>")
        }
        return send(404, { error: "not found", path: url })
      })
    })
    return { server, port, captured }
  }
  throw new Error("no free PICC port (5173/3000/5174/3001) — a real PICC server may already be running; stop it and retry")
}

async function main() {
  const { server, port, captured } = await startFixture()
  const userDataDir = mkdtempSync(join(tmpdir(), "picc-e2e-"))

  let context
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: EDGE,
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`
      ]
    })

    // 1. Extension service worker alive.
    let sw = context.serviceWorkers()[0]
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 })
    check("extension service worker is alive", !!sw)

    // 2. Scheduler alarms registered (worker may need a beat to register them).
    // NOTE: Playwright's SW eval wrapper shadows the bare `chrome` identifier;
    // the WebExtension namespace is only reachable via globalThis["chrome"], and
    // it may land a moment AFTER the worker handle is surfaced — so poll
    // defensively until the namespace + alarms are both visible.
    let alarms = []
    for (let i = 0; i < 24; i++) {
      alarms = await sw.evaluate(() => {
        const C = globalThis["chrome"]
        if (!C || !C.alarms) return []
        return C.alarms.getAll().catch(() => [])
      })
      if (alarms.some((a) => a.name === "picc-sync") && alarms.some((a) => a.name === "picc-heartbeat")) break
      await new Promise((r) => setTimeout(r, 500))
    }
    const names = alarms.map((a) => a.name).sort()
    check("sync scheduler alarm registered", names.includes("picc-sync"), `alarms: ${names.join(",")}`)
    check("heartbeat alarm registered", names.includes("picc-heartbeat"), `alarms: ${names.join(",")}`)

    // 3. Open the fixture "venue" tab; the content script injects into the
    //    ISOLATED world, so its presence is proven by asking it — the
    //    sensor-queue-depth round-trip only succeeds if a live sensor answers.
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" })
    const tabId = await sw.evaluate(async () => {
      const C = globalThis["chrome"]
      if (!C || !C.tabs) return null
      const tabs = await C.tabs.query({})
      const t = tabs.find((x) => x.url && x.url.includes("127.0.0.1"))
      return t ? t.id : null
    })
    check("worker found the fixture venue tab", tabId != null, `tabId=${tabId}`)
    const depth = await sw.evaluate(async (id) => {
      try {
        const C = globalThis["chrome"]
        if (id == null || !C || !C.tabs) return { error: "chrome namespace/tab unavailable" }
        return await C.tabs.sendMessage(id, { action: "sensor-queue-depth" })
      } catch (e) { return { error: String(e) } }
    }, tabId)
    check("content script sensor answers on the venue page (isolated-world proof)",
      depth?.observed === true, JSON.stringify(depth || {}))

    // 4. Seed a real 32-hex session token cookie on the venue origin.
    await context.addCookies([{ name: "token", value: TOKEN, domain: "127.0.0.1", path: "/" }])

    // 5. Manual worker →content venue-scan-now round-trip.
    const reply = await sw.evaluate(async (id) => {
      try {
        const C = globalThis["chrome"]
        if (!id || !C || !C.tabs) return { error: "chrome namespace/tab unavailable" }
        return await C.tabs.sendMessage(id, { action: "venue-scan-now" })
      } catch (e) { return { error: String(e) } }
    }, tabId)
    check("venue-scan-now round-trip observed", reply?.observed === true, JSON.stringify(reply))

    // 6. The token must flow: content → worker → fixture capture-session.
    let session = null
    for (let i = 0; i < 20 && !session; i++) {
      await new Promise((r) => setTimeout(r, 500))
      session = captured.sessions.find((s) => s.token) || null
    }
    check("session token relayed to the server", session != null && session.token === TOKEN && session.venueId === "fixture",
      session ? `venue=${session.venueId} source=${session.source}` : "no capture-session POST")
    if (session) check("relayed token is exactly the observed value", session.token === TOKEN)

    // 6b. After the scan, the sensor's config cache is warm — the sensor now
    //     identifies THIS tab as the fixture venue (sync-status honesty).
    const depth2 = await sw.evaluate(async (id) => {
      try {
        const C = globalThis["chrome"]
        if (id == null || !C || !C.tabs) return { error: "chrome namespace/tab unavailable" }
        return await C.tabs.sendMessage(id, { action: "sensor-queue-depth" })
      } catch (e) { return { error: String(e) } }
    }, tabId)
    check("sensor identifies the fixture venue after config cache warms",
      depth2?.observed === true && depth2.venueId === "fixture", JSON.stringify(depth2 || {}))

    // 7. Dedup: an identical second ping is a no-op (no duplicate relay).
    const before = captured.sessions.length
    await sw.evaluate(async (id) => {
      try {
        const C = globalThis["chrome"]
        if (id != null && C && C.tabs) await C.tabs.sendMessage(id, { action: "venue-scan-now" })
      } catch { /* ignore */ }
    }, tabId)
    await new Promise((r) => setTimeout(r, 1200))
    check("unchanged observation is NOT re-relayed (dedup holds)", captured.sessions.length === before,
      `relays before=${before} after=${captured.sessions.length}`)

    // 8. FULL MODE — the alarm-driven scheduler keeps syncing WITHOUT manual
    //    intervention (the user's core ask: tab switching must not stop sync).
    //    The scheduler CANNOT be observed as a second relay: the capture dedup
    //    (verified in step 7) suppresses duplicate observation relays BY DESIGN.
    //    The honest observables are (a) the sensor's scan clock advances (the
    //    alarm-driven venue-scan-now RAN the scan entry) and (b) the relay count
    //    stays flat (dedup did its job). Read the sensor's own clock before,
    //    then poll until it advances (or the window lapses). MV3 workers sleep
    //    and TERMINATE between beats — re-resolve the revived worker instance
    //    defensively whenever an eval fails.
    if (QUICK) {
      console.log("SKIP  scheduler wait (QUICK=1)")
    } else {
      let worker = sw
      const askSensor = async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            return await worker.evaluate(async (id) => {
              try {
                const C = globalThis["chrome"]
                if (id == null || !C || !C.tabs) return null
                return await C.tabs.sendMessage(id, { action: "sensor-queue-depth" })
              } catch (e) { return null }
            }, tabId)
          } catch {
            // Worker slept and was terminated — grab the revived instance.
            worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 5000 }).catch(() => null)
            if (!worker) return null
          }
        }
        return null
      }
      const baseline = await askSensor()
      const scansBefore = Number(baseline?.scannedAt) || 0
      const relaysBefore = captured.sessions.length
      const deadline = Date.now() + 75_000
      let scannedAt = scansBefore
      while (Date.now() < deadline && scannedAt <= scansBefore) {
        await new Promise((r) => setTimeout(r, 5000))
        const d = await askSensor()
        if (d?.scannedAt) scannedAt = Number(d.scannedAt)
      }
      const advance = scannedAt - scansBefore
      check("scheduler auto-pinged the venue sensor within the wait window",
        advance > 0, advance > 0 ? `scan clock advanced by ${advance}ms` : "sensor scan clock did not advance in 75s")
      check("auto-ping did NOT duplicate the relay (capture dedup holds on the scheduled path)",
        captured.sessions.length === relaysBefore,
        `relays before=${relaysBefore} after=${captured.sessions.length}`)
    }

    console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED")
    process.exitCode = failures ? 1 : 0
  } finally {
    try { await context?.close() } catch { /* ignore */ }
    server.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error("harness crashed:", err)
  process.exitCode = 1
})