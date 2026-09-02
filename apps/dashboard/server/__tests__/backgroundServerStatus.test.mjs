// T11 follow-up — background worker server discovery truth for the popup.
//
// The popup used to render ONLY piccSensorStatus (written by the broker-tab
// sensor content script) and therefore showed "offline" on a healthy PICC
// backend. The worker now answers a `server-status` message with a LIVE health
// probe (detectServerPort → piccServerOnline/piccDetectedPort). This loads the
// REAL background.js into a vm sandbox with a chrome mock and pins that:
//   - a reachable localhost backend answers `online: true` with the port;
//   - a dead backend answers `online: false, port: null` (never a fake port);
//   - untrusted senders are rejected before any probe runs.
//
// The sandbox also exercises the load-time run while the probe is in flight —
// background.js starts detectServerPort + sendHeartbeat on boot — so the
// harness must drain those fetches too (a harness that "forgets" boot fetches
// produces false reds).

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../extensions/picc-overlay")
// The worker imports the pure cadence-policy module (syncPolicy.js). vm runs
// SCRIPT, not module, so load the REAL module here and inject its exports as
// sandbox globals — the same values the extension ships — and strip the import
// statement from the source before running it in the sandbox.
const syncPolicy = await import(pathToFileURL(join(EXT_DIR, "syncPolicy.js")).href)
const SOURCE = readFileSync(join(EXT_DIR, "background.js"), "utf8")
  .replace(/^import\s+\{[^}]*\}\s+from\s+"\.\/syncPolicy\.js"\s*$/m, "")

/** Resolved 200 with a JSON body shaped like /api/health. */
const okHealth = { ok: true, version: "test" }

function makeHarness({ fetchFn = async () => ({ ok: true, json: async () => okHealth }) } = {}, tabsOverrides = {}) {
  const state = {
    onMessageListener: null,
    tabsActivated: null,
    storageLocal: new Map(),
    storageSession: new Map(),
    responses: [],
    tabUpdates: [],       // [tabId, props] from open-broker-tab focus
    tabCreates: [],       // urls from open-broker-tab create
    windowFocuses: []     // [windowId, props] from open-broker-tab focus
  }

  const chrome = {
    runtime: {
      id: "picc-test-id",
      getManifest: () => ({ version: "9.9.9" }),
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener: (fn) => { state.onMessageListener = fn }
      }
    },
    storage: {
      local: {
        set: async (entry) => { Object.assign(state.storageLocal, entry) },
        get: async (keys) => {
          if (keys == null) return { ...state.storageLocal }
          const k = Array.isArray(keys) ? keys : [keys]
          return Object.fromEntries(k.map((key) => [key, state.storageLocal.get(key)]))
        }
      },
      session: {
        set: async (entry) => { Object.assign(state.storageSession, entry) },
        get: async (
          keys
        ) => {
          if (keys == null) return { ...state.storageSession }
          const k = Array.isArray(keys) ? keys : [keys]
          return Object.fromEntries(k.map((key) => [key, state.storageSession.get(key)]))
        }
      }
    },
    alarms: {
      getAll: async () => [],
      create: () => {},
      onAlarm: { addListener() {} }
    },
    tabs: {
      query: tabsOverrides.query ?? (async () => []),
      update: async (id, props) => { state.tabUpdates.push([id, props]); return { id } },
      create: async ({ url }) => { state.tabCreates.push(url); return { id: 99, url } },
      get: async (id) => ({ id, url: "https://app.expertoption.finance/", title: "" }),
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} }
    },
    windows: {
      update: async (id, props) => { state.windowFocuses.push([id, props]); return {} }
    }
  }

  const context = vm.createContext({
    chrome,
    SYNC: syncPolicy.SYNC,
    cadenceFor: syncPolicy.cadenceFor,
    fetch: (url, init) => fetchFn(url, init),
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    console: {
      log() {},
      info() {},
      warn() {},
      error() {}
    },
    Date: globalThis.Date,
    URL: globalThis.URL
  })
  vm.runInContext(SOURCE, context)

  /** Drain the worker's boot-time probe + heartbeat fetches. */
  async function settleBoot() {
    await new Promise((r) => setTimeout(r, 5))
  }

  /** Send a message like the popup does and return the sendResponse payload. */
  async function send(msg, sender = {}) {
    let response = null
    const kept = state.onMessageListener(msg, sender, (r) => { response = r })
    // Async listeners return true; await N microtasks so the probe resolves.
    if (kept === true) {
      for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
    }
    return response
  }

  return { state, chrome, send, settleBoot }
}

describe("background worker server-status for the popup (T11 follow-up)", () => {
  it("a reachable backend answers online:true with the detected port", async () => {
    const h = makeHarness()
    await h.settleBoot()
    const resp = await h.send({ action: "server-status" }, { id: "picc-test-id" })
    expect(resp.action).toBe("server-status")
    expect(resp.online).toBe(true)
    expect(resp.port).toBe(5173) // first candidate in PICC_PORTS wins
    // The probe result is also persisted for the popup's fallback read.
    expect(h.state.storageLocal.piccServerOnline).toBe(true)
    expect(h.state.storageLocal.piccServerPort).toBe(5173)
  })

  it("a dead backend answers online:false port:null — never a stale or fake port", async () => {
    const h = makeHarness({ fetchFn: async () => { throw new Error("connection refused") } })
    await h.settleBoot()
    const resp = await h.send({ action: "server-status" }, { id: "picc-test-id" })
    expect(resp.action).toBe("server-status")
    expect(resp.online).toBe(false)
    expect(resp.port).toBeNull()
    expect(h.state.storageLocal.piccServerOnline).toBe(false)
  })

  it("an untrusted sender is rejected before any probe runs", async () => {
    let fetchCalls = 0
    const h = makeHarness({ fetchFn: async (url) => { fetchCalls += 1; return { ok: true, json: async () => okHealth } } })
    await h.settleBoot()
    const before = fetchCalls
    const resp = await h.send({ action: "server-status" }, { url: "https://evil.example" })
    expect(resp).toEqual({ error: "untrusted sender" })
    expect(fetchCalls).toBe(before) // no extra probe after the rejection
  })

  it("relay-flush: a trusted sensor's batch is POSTed to /api/extension/ingest by the worker", async () => {
    const posts = []
    const h = makeHarness({
      fetchFn: async (url, init) => {
        if (String(url).includes("/api/extension/ingest")) {
          posts.push({ url, init })
          return { ok: true, status: 200, json: async () => ({ ok: true, accepted: 1, received: 1 }) }
        }
        return { ok: true, json: async () => okHealth }
      }
    })
    await h.settleBoot()
    const resp = await h.send(
      { action: "relay-flush", frames: [{ action: "candle", message: { assetId: "BTC" } }] },
      { id: "picc-test-id" }
    )
    expect(resp.ok).toBe(true)
    expect(resp.status).toBe(200)
    expect(posts.length).toBe(1)
    expect(posts[0].url).toContain("/api/extension/ingest")
    expect(JSON.parse(posts[0].init.body).frames).toHaveLength(1)
  })

  it("relay-flush: empty/oversized batches and untrusted senders never reach the server", async () => {
    let fetchCalls = 0
    const h = makeHarness({ fetchFn: async (url) => { fetchCalls += 1; return { ok: true, json: async () => okHealth } } })
    await h.settleBoot()
    const before = fetchCalls

    const empty = await h.send({ action: "relay-flush", frames: [] }, { id: "picc-test-id" })
    expect(empty.ok).toBe(false)
    expect(empty.error).toBe("no frames")

    const oversize = await h.send({ action: "relay-flush", frames: Array(201).fill({}) }, { id: "picc-test-id" })
    expect(oversize.ok).toBe(false)

    const evil = await h.send({ action: "relay-flush", frames: [{}] }, { url: "https://evil.example" })
    expect(evil).toEqual({ error: "untrusted sender" })

    expect(fetchCalls).toBe(before) // no POST until a valid, trusted batch arrives
  })

  it("open-broker-tab: focuses the existing venue tab when classifyHost matches (REQ-10)", async () => {
    const h = makeHarness({
      fetchFn: async (url) => {
        if (String(url).includes("/api/trading/capture-profiles")) {
          return { ok: true, json: async () => ({ ok: true, venues: [{ venueId: "expertoption", hostRe: "expertoption\\.(com|finance)", enabled: true }] }) }
        }
        return { ok: true, json: async () => okHealth }
      }
    }, {
      query: async () => [
        { id: 11, url: "https://news.example", windowId: 2 },
        { id: 12, url: "https://app.expertoption.finance/", windowId: 2 }
      ]
    })
    await h.settleBoot()
    const resp = await h.send(
      { action: "open-broker-tab", venueId: "expertoption", url: "https://app.expertoption.finance/" },
      { url: "chrome-extension://picc-test-id/content.js" }
    )
    expect(resp).toMatchObject({ ok: true, mode: "focused", tabId: 12 })
    expect(h.state.tabUpdates).toEqual([[12, { active: true }]])
    expect(h.state.windowFocuses).toEqual([[2, { focused: true }]])
    expect(h.state.tabCreates).toEqual([]) // never duplicates an existing tab
  })

  it("open-broker-tab: creates a new tab when no tab hosts the venue (REQ-10)", async () => {
    const h = makeHarness({
      fetchFn: async (url) => {
        if (String(url).includes("/api/trading/capture-profiles")) {
          return { ok: true, json: async () => ({ ok: true, venues: [{ venueId: "expertoption", hostRe: "expertoption\\.(com|finance)", enabled: true }] }) }
        }
        return { ok: true, json: async () => okHealth }
      }
    }, {
      query: async () => [{ id: 11, url: "https://news.example", windowId: 2 }]
    })
    await h.settleBoot()
    const resp = await h.send(
      { action: "open-broker-tab", venueId: "expertoption", url: "https://app.expertoption.finance/" },
      { url: "chrome-extension://picc-test-id/content.js" }
    )
    expect(resp).toMatchObject({ ok: true, mode: "created", tabId: 99 })
    expect(h.state.tabCreates).toEqual(["https://app.expertoption.finance/"])
    expect(h.state.tabUpdates).toEqual([])
  })

  it("open-broker-tab: refuses non-http(s) urls and missing venue ids without touching tabs", async () => {
    const h = makeHarness({}, { query: async () => [{ id: 11, url: "https://app.expertoption.finance/", windowId: 2 }] })
    await h.settleBoot()
    const evilJs = await h.send(
      { action: "open-broker-tab", venueId: "expertoption", url: "javascript:alert(1)" },
      { url: "chrome-extension://picc-test-id/content.js" }
    )
    expect(evilJs.ok).toBe(false)
    const noVenue = await h.send(
      { action: "open-broker-tab", url: "https://app.expertoption.finance/" },
      { url: "chrome-extension://picc-test-id/content.js" }
    )
    expect(noVenue.ok).toBe(false)
    expect(h.state.tabUpdates).toEqual([])
    expect(h.state.tabCreates).toEqual([])
  })

  it("open-broker-tab: untrusted senders are rejected", async () => {
    const h = makeHarness()
    await h.settleBoot()
    const resp = await h.send(
      { action: "open-broker-tab", venueId: "expertoption", url: "https://app.expertoption.finance/" },
      { url: "https://evil.example" }
    )
    expect(resp).toEqual({ error: "untrusted sender" })
    expect(h.state.tabCreates).toEqual([])
    expect(h.state.tabUpdates).toEqual([])
  })
})