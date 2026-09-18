// T9 — contract locks (PICC_MULTISOURCE_ENGINE, backend half).
//
// Pins that the additive multisource fields never drift or break the
// pre-existing candles response shape:
//  - served and source:"none" candle responses expose EXACTLY the documented
//    key sets (a removed field fails the sorted-key assertion) and the
//    pre-existing fields keep their shapes (presence + types, byte-identical
//    semantics — nobody renames or re-types them);
//  - chartPrefs writes the pinned file schema through the REAL write path
//    (a bare node child OUTSIDE VITEST) with round-trip overwrite and
//    per-user isolation; VITEST-suppression is pinned by chartPrefs.test.mjs
//    ("suppresses disk writes under the test runner");
//  - the bus -> handler feed/stale flow surfaces on the endpoint: a broker
//    whose stats() report stale:true serves stale:true, a fresh one false;
//    non-EO winners echo their slug as feed (T4 tag test pins it);
//  - the popup storage-key pin is vacuous post-D1: no popup exists to read
//    keys — extensionAbsence.test.mjs pins that absence.
// The hook -> chart half of the feed/stale flow is the UI wave.

import { afterEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { handleApi } from "../handlers.mjs"
import { registerBroker, unregisterBroker } from "../services/brokers/index.mjs"

function makeReq(method, url, body) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json" },
    socket: { remoteAddress: "127.0.0.1" },
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
      if (evt === "end") cb()
    }
  }
}
function makeRes() {
  return {
    status: null,
    body: null,
    writeHead(status) { this.status = status },
    end(body) { this.body = body ? JSON.parse(body) : null }
  }
}
async function call(method, path, body) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body), res, path)
  return res
}

function synthCandles(n, base = 100) {
  return Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * 60,
    open: base + i * 0.1,
    high: base + i * 0.1 + 0.5,
    low: base + i * 0.1 - 0.5,
    close: base + i * 0.1
  }))
}

const testBrokerSlugs = []
function registerTestBroker(adapter) {
  testBrokerSlugs.push(adapter.slug)
  try {
    registerBroker(adapter)
  } catch { /* already registered */ }
}

afterEach(() => {
  for (const slug of testBrokerSlugs) unregisterBroker(slug)
  testBrokerSlugs.length = 0
})

const SERVED_KEYS = [
  "ok", "source", "feed", "stale", "assetId", "requestedTimeframe", "timeframe",
  "resolved", "candles", "availableSources", "sourceMode", "sources",
  "historyDepth", "backfilled", "historySpanMs", "historySource",
  "verifySources", "verifiedCount", "verifiedRatio"
].sort()

const NONE_KEYS = [
  "ok", "source", "feed", "assetId", "requestedTimeframe", "timeframe",
  "resolved", "candles", "availableSources", "sourceMode", "sources",
  "verifySources", "verifiedCount", "verifiedRatio"
].sort()

describe("T9 candles response contract locks", () => {
  it("served response exposes EXACTLY the documented key set", async () => {
    registerTestBroker({
      slug: "t9-served",
      label: "T9 served",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(90) : [])
    })
    const res = await call("POST", "/api/trading/candles", { assetId: "EURUSD", timeframe: 60, count: 50 })
    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(SERVED_KEYS)
  })

  it("pre-existing fields keep their exact shapes (presence + types)", async () => {
    registerTestBroker({
      slug: "t9-shape",
      label: "T9 shape",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600],
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(90) : [])
    })
    const res = await call("POST", "/api/trading/candles", { assetId: "EURUSD", timeframe: 60, count: 50 })
    const b = res.body
    expect(b.ok).toBe(true)
    expect(typeof b.source).toBe("string")
    expect(typeof b.feed).toBe("string")
    expect(typeof b.stale).toBe("boolean")
    expect(typeof b.assetId).toBe("string")
    expect(typeof b.requestedTimeframe).toBe("number")
    expect(typeof b.timeframe).toBe("number")
    expect(typeof b.resolved).toBe("boolean")
    expect(Array.isArray(b.candles)).toBe(true)
    for (const c of b.candles) {
      expect([typeof c.time, typeof c.open, typeof c.high, typeof c.low, typeof c.close]).toEqual(
        ["number", "number", "number", "number", "number"]
      )
    }
    expect(Array.isArray(b.availableSources)).toBe(true)
    expect(typeof b.sourceMode).toBe("string")
    expect(Array.isArray(b.sources)).toBe(true)
    // Additive truth tags stay additive — never zero-fabricated on a served win.
    expect(typeof b.verifySources).toBe("number")
    expect(typeof b.verifiedCount).toBe("number")
    expect(typeof b.verifiedRatio).toBe("number")
  })

  it("source:'none' response exposes EXACTLY the documented key set", async () => {
    const res = await call("POST", "/api/trading/candles", { assetId: "EURUSD", timeframe: 60, count: 50 })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("none")
    expect(Object.keys(res.body).sort()).toEqual(NONE_KEYS)
  })
})

describe("T9 bus → handler feed/stale flow", () => {
  it("a broker whose upstream writes went stale serves stale:true on the endpoint", async () => {
    registerTestBroker({
      slug: "t9-stale",
      label: "T9 stale",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600],
      stats: () => ({ status: "connected", error: null, lastSeen: Date.now(), stale: true }),
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(90) : [])
    })
    const res = await call("POST", "/api/trading/candles", { assetId: "EURUSD", timeframe: 60, count: 50 })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("t9-stale")
    expect(res.body.stale).toBe(true)
    expect(res.body.feed).toBe("t9-stale")
  })

  it("a healthy broker serves stale:false", async () => {
    registerTestBroker({
      slug: "t9-fresh",
      label: "T9 fresh",
      weight: 100,
      isAlive: () => true,
      availableTimeframes: () => [60, 300, 3600],
      stats: () => ({ status: "connected", error: null, lastSeen: Date.now(), stale: false }),
      getCandles: (id, opts) => (opts?.timeframe === 60 ? synthCandles(90) : [])
    })
    const res = await call("POST", "/api/trading/candles", { assetId: "EURUSD", timeframe: 60, count: 50 })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("t9-fresh")
    expect(res.body.stale).toBe(false)
    expect(res.body.feed).toBe("t9-fresh")
  })
})

describe("T9 chartPrefs file-schema lock (real write path)", () => {
  it("writes the pinned { userId: { source, updatedAt } } schema outside VITEST, round-trips, isolates users", () => {
    const tmp = mkdtempSync(join(tmpdir(), "picc-t9-prefs-"))
    const script = `
      import { readFileSync, existsSync } from "node:fs"
      import { join } from "node:path"
      const m = await import(process.env.CHART_PREFS_ENTRY)
      const dir = process.env.PICC_DATA_DIR
      m.setSourcePref("user-a", "auto")
      const f = join(dir, "chart-prefs.json")
      if (!existsSync(f)) { console.error("no chart-prefs.json written"); process.exit(1) }
      const data = JSON.parse(readFileSync(f, "utf8"))
      const row = data["user-a"]
      if (!row || typeof row.source !== "string" || typeof row.updatedAt !== "number" || row.source !== "auto") {
        console.error("schema violation:", JSON.stringify(data)); process.exit(2)
      }
      const first = row.updatedAt
      await new Promise((r) => setTimeout(r, 5))
      m.setSourcePref("user-a", "auto")
      const data2 = JSON.parse(readFileSync(f, "utf8"))
      if (typeof data2["user-a"].updatedAt !== "number" || data2["user-a"].updatedAt < first) {
        console.error("no round-trip overwrite"); process.exit(3)
      }
      if (m.getSourcePref("user-b") !== "auto") { console.error("user isolation broken"); process.exit(4) }
      console.log("CHART_PREFS_SCHEMA_OK")
    `
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        VITEST: "false",
        PICC_DATA_DIR: tmp,
        CHART_PREFS_ENTRY: pathToFileURL(join("server", "services", "chartPrefs.mjs")).href
      }
    })
    const says = (out) => String(out ?? "").trim()
    try {
      expect(child.status, `child failed: ${says(child.stdout)} ${says(child.stderr)}`).toBe(0)
      expect(says(child.stdout)).toMatch(/CHART_PREFS_SCHEMA_OK/)
      expect(existsSync(join(tmp, "chart-prefs.json"))).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})