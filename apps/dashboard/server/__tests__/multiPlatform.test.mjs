import { describe, expect, it, beforeEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

vi.mock("../services/browserBridge.mjs", () => ({
  openBridge: vi.fn(async () => ({
    goto: vi.fn(async () => {}),
    read: vi.fn(async () => ({})),
    addOverlay: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    onFrame: vi.fn(() => () => {})
  })),
  browserAvailable: vi.fn(async () => false)
}))

import {
  registerConnector,
  getConnector,
  hasConnector,
  listConnectors,
  collectSource,
  normalizeEarnings,
  openLiveSession
} from "../services/connectors.mjs"
import { normalizeYahooSymbol } from "../services/yahoo.mjs"
import { translateSymbol } from "../services/trading.mjs"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const CONTENT_PATH = join(__dirname, "..", "..", "extensions", "picc-overlay", "content.js")

class FakeHTMLElement {}

function makeElement(tag, shadowFactory) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    listeners: {},
    style: {},
    dataset: {},
    textContent: "",
    innerHTML: "",
    id: "",
    title: "",
    type: "",
    value: "",
    checked: false,
    disabled: false,
    appendChild(child) {
      el.children.push(child)
      return child
    },
    replaceChildren(...kids) {
      el.children = [...kids]
    },
    remove() {},
    setAttribute(name, v) {
      el.attributes[name] = String(v)
    },
    getAttribute(name) {
      return el.attributes[name] ?? null
    },
    addEventListener(type, fn) {
      ;(el.listeners[type] = el.listeners[type] || []).push(fn)
    },
    removeEventListener() {},
    querySelector(sel) {
      return matchIn(el, sel)[0] ?? null
    },
    querySelectorAll(sel) {
      return matchIn(el, sel)
    },
    closest() {
      return null
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 120, bottom: 40, width: 120, height: 40 }
    }
  }
  if (shadowFactory) el.attachShadow = () => shadowFactory()
  Object.setPrototypeOf(el, FakeHTMLElement.prototype)
  return el
}

function attrFromSelector(sel) {
  const m = String(sel).match(/\[([a-zA-Z-]+)/)
  return m ? m[1] : null
}

function matchIn(node, sel) {
  const attr = attrFromSelector(sel)
  if (!attr) return []
  const out = []
  for (const child of node.children || []) {
    if (child.attributes && attr in child.attributes) out.push(child)
    out.push(...matchIn(child, sel))
  }
  return out
}

function loadOverlay(href) {
  const nodes = []
  const shadowRoot = {
    appendChild(n) {
      nodes.push(n)
      return n
    },
    getElementById(id) {
      return findById(nodes, id)
    },
    querySelector(sel) {
      for (const n of nodes) {
        if (attrFromSelector(sel) && attrFromSelector(sel) in (n.attributes || {})) return n
        const hit = matchIn(n, sel)[0]
        if (hit) return hit
      }
      return null
    },
    querySelectorAll(sel) {
      return nodes.flatMap((n) => matchIn(n, sel))
    },
    addEventListener() {}
  }

  function findById(list, id) {
    for (const n of list) {
      if (n.id === id) return n
      const hit = findById(n.children || [], id)
      if (hit) return hit
    }
    return null
  }

  const documentStub = {
    title: "Test Page",
    readyState: "complete",
    characterEncoding: "UTF-8",
    body: makeElement("body"),
    head: makeElement("head"),
    forms: [],
    images: [],
    links: [],
    scripts: [],
    createElement: (tag) => makeElement(tag, () => shadowRoot),
    createTextNode: (t) => ({ textContent: t }),
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByTagName: () => ({ length: 12 }),
    createTreeWalker: () => ({ nextNode: () => null })
  }

  const messages = []
  const chromeStub = {
    runtime: {
      sendMessage: async (msg) => {
        messages.push(msg)
        if (msg?.action === "check-server") return { online: true, port: 8177 }
        if (msg?.type === "picc-server-fetch") return { ok: false, error: "unreachable", data: null }
        return { online: true }
      },
      onMessage: {
        listeners: [],
        addListener(fn) {
          this.listeners.push(fn)
        }
      }
    },
    storage: {
      local: {
        set() {},
        get(_key, cb) {
          if (cb) cb({})
        }
      }
    }
  }

  const parsed = new URL(href)
  const winStub = {
    location: { href, hostname: parsed.hostname, pathname: parsed.pathname, protocol: parsed.protocol },
    innerWidth: 1440,
    innerHeight: 900,
    scrollX: 0,
    scrollY: 0,
    addEventListener() {},
    removeEventListener() {}
  }
  documentStub.window = winStub

  let intervalSeq = 0
  const sandbox = {
    console,
    URL,
    AbortController,
    HTMLElement: FakeHTMLElement,
    MutationObserver: class {
      observe() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    performance: { getEntriesByType: () => [], now: () => Date.now() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null },
    getComputedStyle: () => ({ fontSize: "14px", fontWeight: "400", color: "rgb(255,255,255)" }),
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => ++intervalSeq,
    clearInterval() {},
    requestAnimationFrame: () => 0,
    document: documentStub,
    window: winStub,
    location: winStub.location,
    chrome: chromeStub
  }
  sandbox.self = sandbox

  const src = readFileSync(CONTENT_PATH, "utf8")
  const hook =
    ";globalThis.__piccInternals = {" +
    "detectSite, normalizeAssetId, SUITE_DOCKABLE_PRESETS, getDefaultSettings," +
    "createOverlay," +
    "dockIds: () => activeDockables.map((d) => d.id)," +
    "dockBodyHtml: (id) => { const d = shadowRoot.getElementById('__PICC_DOCK_' + id + '__'); const b = d && d.querySelector('[data-picc-body]'); return b ? b.innerHTML : null }," +
    "overlayBrand: () => { const p = shadowRoot.getElementById(OVERLAY_ID); const header = p && p.children[0]; const brand = header && header.children[0]; return brand ? brand.textContent : null }," +
    "seedState: (patch) => Object.assign(tradingState, patch)," +
    "refreshPanels: () => updateAllDockables()," +
    "renderPortfolio, renderPageOverview, renderServerStatus" +
    "}"
  const patched = src.replace(/\}\)\(\)\s*$/, hook + "\n})()\n")
  if (patched === src) throw new Error("could not expose content.js internals")

  vm.createContext(sandbox)
  vm.runInContext(patched, sandbox, { filename: "content.js" })
  return sandbox.__piccInternals
}

const settle = () => new Promise((r) => setTimeout(r, 25))

beforeEach(() => {
  registerConnector({
    slug: "binance-spot",
    label: "Binance",
    category: "trading",
    transports: ["api", "browser"],
    url: "https://www.binance.com/",
    defaults: { label: "Binance" }
  })
  registerConnector({
    slug: "coinbase-exchange",
    label: "Coinbase",
    category: "trading",
    transports: ["api"],
    url: "https://www.coinbase.com/",
    defaults: { label: "Coinbase" }
  })
})

describe("multi-platform connector registry", () => {
  it("supports multiple trading platforms beyond ExpertOption", () => {
    expect(hasConnector("expertoption")).toBe(true)
    expect(hasConnector("binance-spot")).toBe(true)
    expect(hasConnector("coinbase-exchange")).toBe(true)
    const slugs = listConnectors().map((c) => c.slug)
    for (const s of ["expertoption", "binance-spot", "coinbase-exchange"]) {
      expect(slugs).toContain(s)
    }
    expect(getConnector("binance-spot").label).toBe("Binance")
    expect(getConnector("coinbase-exchange").label).toBe("Coinbase")
    expect(getConnector("binance-spot").category).toBe("trading")
  })

  it("gives every connector the interface its transport needs", () => {
    const slugs = ["expertoption", "honeygain", "opensea", "binance-spot", "coinbase-exchange"]
    for (const slug of slugs) {
      const conn = getConnector(slug)
      expect(conn, `${slug} must exist`).toBeTruthy()
      expect(conn.slug).toBe(slug)
      expect(typeof conn.label).toBe("string")
      expect(conn.label.length).toBeGreaterThan(0)
      expect(Array.isArray(conn.transports)).toBe(true)
      expect(conn.transports.length).toBeGreaterThan(0)
      expect(typeof conn.url).toBe("string")
      expect(/^https?:\/\//.test(conn.url)).toBe(true)
      expect(typeof collectSource).toBe("function")
    }
    const eo = getConnector("expertoption")
    expect(eo.transports).toContain("ws")
    expect(eo.transport).toBe("ws")
  })

  it("normalizes every platform's snapshot into the same Earnings shape", async () => {
    const snapshots = [
      normalizeEarnings({ provider: "expertoption", platform: "ExpertOption", balance: 10000 }),
      normalizeEarnings({ provider: "binance-spot", platform: "Binance", balance: 5000, source: "api" }),
      normalizeEarnings({ provider: "coinbase-exchange", platform: "Coinbase", balance: 2500 })
    ]
    const keys = Object.keys(snapshots[0]).sort()
    for (const snap of snapshots.slice(1)) {
      expect(Object.keys(snap).sort()).toEqual(keys)
    }
    for (const snap of snapshots) {
      expect(snap.status).toBe("ok")
      expect(snap.currency).toBe("USD")
      expect(snap.lastChecked).toBeGreaterThan(0)
    }
  })
})

describe("unknown platform handling", () => {
  it("reports unknown connectors instead of crashing", async () => {
    expect(hasConnector("definitely-not-real-exchange")).toBe(false)
    expect(getConnector("definitely-not-real-exchange")).toBeUndefined()
    await expect(collectSource("definitely-not-real-exchange")).rejects.toThrow(/unknown connector/)
    await expect(openLiveSession("definitely-not-real-exchange")).rejects.toThrow(/unknown connector/)
  })
})

describe("connector switching without state leakage", () => {
  it("routes each collection to the selected platform and keeps results independent", async () => {
    const calls = []
    const collector = (slug, label, balance) => async () => {
      calls.push(slug)
      return normalizeEarnings({ provider: slug, platform: label, balance, source: "ws" })
    }
    registerConnector({
      slug: "eo-switch",
      label: "ExpertOption",
      category: "trading",
      transports: ["ws"],
      url: "https://app.expertoption.finance/",
      collect: collector("eo-switch", "ExpertOption", 10000)
    })
    registerConnector({
      slug: "bn-switch",
      label: "Binance",
      category: "trading",
      transports: ["api"],
      url: "https://www.binance.com/",
      collect: collector("bn-switch", "Binance", 5000)
    })
    registerConnector({
      slug: "cb-switch",
      label: "Coinbase",
      category: "trading",
      transports: ["api"],
      url: "https://www.coinbase.com/",
      collect: collector("cb-switch", "Coinbase", 2500)
    })

    const a1 = await collectSource("eo-switch")
    const b1 = await collectSource("bn-switch")
    const c1 = await collectSource("cb-switch")
    const a2 = await collectSource("eo-switch")

    expect(a1.provider).toBe("eo-switch")
    expect(a1.platform).toBe("ExpertOption")
    expect(a1.balance).toBe(10000)
    expect(b1.balance).toBe(5000)
    expect(c1.balance).toBe(2500)
    expect(a2.balance).toBe(10000)

    expect(calls).toEqual(["eo-switch", "bn-switch", "cb-switch", "eo-switch"])
    expect(calls.filter((s) => s === "bn-switch")).toHaveLength(1)
    expect(calls.filter((s) => s === "cb-switch")).toHaveLength(1)
  })
})

describe("platform detection (extension overlay)", () => {
  it("detects ExpertOption from expertoption.com domains", () => {
    const i = loadOverlay("https://www.expertoption.com/trade")
    const site = i.detectSite("https://www.expertoption.com/trade")
    expect(site.id).toBe("expertoption")
    expect(site.label).toBe("ExpertOption")
    expect(site.category).toBe("trading")
    expect(site.suite).toBe("trading")

    const finance = i.detectSite("https://app.expertoption.finance/")
    expect(finance.id).toBe("expertoption")
    expect(finance.suite).toBe("trading")

    const sub = i.detectSite("https://eur.expertoption.com/x")
    expect(sub.id).toBe("expertoption")
  })

  it("detects Binance from binance.com domains", () => {
    const i = loadOverlay("https://www.binance.com/en/markets")
    const site = i.detectSite("https://www.binance.com/en/markets")
    expect(site.id).toBe("binance")
    expect(site.label).toBe("Binance")
    expect(site.suite).toBe("trading")

    const sub = i.detectSite("https://accounts.binance.com/en/login")
    expect(sub.id).toBe("binance")
  })

  it("detects Coinbase from coinbase.com domains", () => {
    const i = loadOverlay("https://www.coinbase.com/portfolio")
    const site = i.detectSite("https://www.coinbase.com/portfolio")
    expect(site.id).toBe("coinbase")
    expect(site.label).toBe("Coinbase")
    expect(site.suite).toBe("trading")
  })

  it("treats unknown platforms generically without crashing", () => {
    const i = loadOverlay("https://blog.example.org/post")
    const site = i.detectSite("https://random-broker.example.net/quotes")
    expect(site.id).toBeNull()
    expect(site.suite).toBeNull()
    expect(site.category).toBe("other")
    expect(site.label).toBe("random-broker.example.net")
    expect(i.detectSite("not-a-url")).toBeNull()
    expect(i.detectSite("")).toBeNull()
  })
})

describe("overlay UI adaptation per platform", () => {
  it("creates the full trading panel set on ExpertOption", async () => {
    const i = loadOverlay("https://www.expertoption.com/trade")
    const site = i.detectSite("https://www.expertoption.com/trade")
    i.createOverlay(site, {})
    await settle()
    const ids = i.dockIds()
    expect(ids).toContain("price-ticker")
    expect(ids).toContain("portfolio")
    expect(ids).toContain("ai-signals")
    expect(i.overlayBrand()).toContain("ExpertOption")
  })

  it("shows trading panels on Binance and Coinbase too", async () => {
    for (const href of ["https://www.binance.com/en/markets", "https://www.coinbase.com/dashboard"]) {
      const i = loadOverlay(href)
      i.createOverlay(i.detectSite(href), {})
      await settle()
      expect(i.dockIds()).toContain("price-ticker")
      expect(i.overlayBrand().length).toBeGreaterThan(0)
    }
  })

  it("renders the expiry optimizer only for trading-suite platforms", async () => {
    const eo = loadOverlay("https://www.expertoption.com/trade")
    eo.createOverlay(eo.detectSite("https://www.expertoption.com/trade"), {})
    await settle()
    expect(eo.dockIds()).toContain("expiry-opt")

    const unknown = loadOverlay("https://blog.example.org/post")
    unknown.createOverlay(unknown.detectSite("https://blog.example.org/post"), {})
    await settle()
    expect(unknown.dockIds()).toEqual(["page-overview", "page-content", "server-status"])
    expect(unknown.dockIds()).not.toContain("expiry-opt")

    const bandwidth = loadOverlay("https://www.speedtest.net/results")
    bandwidth.createOverlay(bandwidth.detectSite("https://www.speedtest.net/results"), {})
    await settle()
    expect(bandwidth.dockIds()).toEqual(["speed", "connectors"])
    expect(bandwidth.dockIds()).not.toContain("expiry-opt")
  })

  it("renders live platform-specific content into the expiry panel when data arrives", async () => {
    const i = loadOverlay("https://www.expertoption.com/trade")
    i.createOverlay(i.detectSite("https://www.expertoption.com/trade"), {})
    await settle()
    expect(i.dockBodyHtml("expiry-opt")).toContain("Analyzing optimal expiry")
    i.seedState({ expiry: { recommended: { label: "60s", score: 82 }, volatility: 0.4 } })
    i.refreshPanels()
    expect(i.dockBodyHtml("expiry-opt")).toContain("Recommended: 60s")
    expect(i.dockBodyHtml("expiry-opt")).toContain("82")
  })

  it("keeps generic panels working on every platform", async () => {
    const unknown = loadOverlay("https://blog.example.org/post")
    unknown.createOverlay(unknown.detectSite("https://blog.example.org/post"), {})
    await settle()
    expect(unknown.dockBodyHtml("server-status")).toContain("Server Online")
    expect(unknown.dockBodyHtml("page-overview")).toContain("Test Page")

    const settings = unknown.getDefaultSettings(null)
    expect(settings.enabled).toBe(true)
    expect(Object.keys(settings.dockables)).toEqual(["general"])

    const html = unknown.renderPortfolio()
    expect(html).toContain("No position data yet")

    const seeded = loadOverlay("https://www.coinbase.com/portfolio")
    seeded.seedState({ paper: { cash: 1234.5, committed: 200, realizedPnl: -12.25, winRate: 55 }, account: { currency: "USD" } })
    const portfolio = seeded.renderPortfolio()
    expect(portfolio).toContain("Paper Trading")
    expect(portfolio).toContain("$1,234.50")
    expect(portfolio).toContain("$-12.25")
    expect(portfolio).toContain("55%")
  })

  it("maps each suite to its own default dockables", () => {
    const i = loadOverlay("https://www.expertoption.com/trade")
    const trading = i.getDefaultSettings("trading")
    expect(trading.dockables["expiry-opt"]).toBe(true)
    expect(trading.features.autopilot).toBe(false)
    expect(Object.keys(i.getDefaultSettings("bandwidth").dockables)).toEqual(["speed", "connectors"])
    expect(Object.keys(i.getDefaultSettings("generic").dockables)).toEqual(["general"])
    const presets = i.SUITE_DOCKABLE_PRESETS.trading.map((p) => p.id)
    for (const id of ["price-ticker", "portfolio", "ai-signals", "expiry-opt", "sentiment"]) {
      expect(presets).toContain(id)
    }
  })
})

describe("symbol normalization across platforms", () => {
  it("normalizes EO display names by stripping OTC markers and mapping names", () => {
    const i = loadOverlay("https://www.expertoption.com/trade")
    expect(i.normalizeAssetId("EUR/USD (OTC)")).toBe("EURUSD")
    expect(i.normalizeAssetId("Gold (OTC)")).toBe("GOLD")
    expect(i.normalizeAssetId("Silver (OTC)")).toBe("SILVER")
    expect(i.normalizeAssetId("BTC/USD")).toBe("BTCUSD")
    expect(i.normalizeAssetId("")).toBe("EURUSD")

    expect(translateSymbol("Bitcoin (OTC)", "expertoption")).toBe("BTCUSD")
    expect(translateSymbol("EURUSD-OTC", "expertoption")).toBe("EURUSD")
    expect(translateSymbol("Gold (OTC)", "expertoption")).toBe("XAUUSD")
  })

  it("accepts Binance BTC/USDT-format symbols", () => {
    expect(translateSymbol("BTCUSDT", "binance")).toBe("BTCUSDT")
    expect(translateSymbol("ETHUSDT", "binance")).toBe("ETHUSDT")
    expect(translateSymbol("BTC/USDT", "binance")).toBe("BTCUSDT")
    expect(normalizeYahooSymbol("BTC/USDT")).toBe("BTCUSDT")
  })

  it("accepts Coinbase BTC-USD-format symbols", () => {
    expect(translateSymbol("BTC-USD", "coinbase")).toBe("BTC-USD")
    expect(translateSymbol("ETH-USD", "coinbase")).toBe("ETH-USD")
    expect(translateSymbol("Ethereum", "coinbase")).toBe("ETH-USD")
    expect(normalizeYahooSymbol("BTCUSD")).toBe("BTC-USD")
    expect(normalizeYahooSymbol("BTC-USD")).toBe("BTC-USD")
    expect(normalizeYahooSymbol("eurusd")).toBe("EURUSD=X")
  })

  it("translates one asset across all platforms from a single EO name", () => {
    expect(translateSymbol("Bitcoin", "expertoption")).toBe("BTCUSD")
    expect(translateSymbol("Bitcoin", "binance")).toBe("BTCUSDT")
    expect(translateSymbol("Bitcoin", "coinbase")).toBe("BTC-USD")

    const eoTicker = translateSymbol("Bitcoin", "expertoption")
    expect(normalizeYahooSymbol(eoTicker)).toBe("BTC-USD")
    expect(translateSymbol(eoTicker, "binance")).toBe("BTCUSDT")

    expect(translateSymbol(160, "binance")).toBeNull()
    expect(translateSymbol("", "binance")).toBeNull()
    expect(translateSymbol(undefined, "coinbase")).toBeNull()
  })
})
