import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../services/browserBridge.mjs", async () => {
  const onFrame = (cb) => {
    const frames = [{ url: "wss://fake" }]
    cb?.({ frames })
    return () => {}
  }
  return {
    openBridge: vi.fn(async () => ({
      goto: vi.fn(async () => {}),
      read: vi.fn(async () => ({ balance: "$1,234.56", today: "+$12.40 today", lifetime: "$9,876.00" })),
      addOverlay: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      onFrame
    })),
    browserAvailable: vi.fn(async () => true)
  }
})

import {
  parseAmount,
  normalizeEarnings,
  registerConnector,
  getConnector,
  listConnectors,
  hasConnector,
  browserCollect,
  collectSource,
  persistSnapshot,
  getLatestSnapshots,
  getHistory,
  openLiveSession,
  subscribeLive,
  closeLiveSession,
  closeAllLiveSessions,
  liveSubscriberCount,
  liveSessionSlugs
} from "../services/connectors.mjs"
import { browserAvailable, openBridge } from "../services/browserBridge.mjs"

let tmpDir
beforeEach(() => {
  vi.clearAllMocks()
  tmpDir = mkdtempSync(join(tmpdir(), "picc-conn-"))
  process.env.PICC_CONNECTOR_DATA_DIR = tmpDir
})

afterEach(() => {
  delete process.env.PICC_CONNECTOR_DATA_DIR
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("parseAmount", () => {
  it("parses USD and locale formats", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56)
    expect(parseAmount("+$12.40 today")).toBe(12.4)
    expect(parseAmount("€ 500")).toBe(500)
    expect(parseAmount("1 234,50")).toBe(1234.5)
    expect(parseAmount("2.5k")).toBe(2500)
    expect(parseAmount("1.2M")).toBe(1200000)
  })

  it("returns null for empty or non-numeric input", () => {
    expect(parseAmount("")).toBeNull()
    expect(parseAmount(null)).toBeNull()
    expect(parseAmount(undefined)).toBeNull()
    expect(parseAmount("n/a")).toBeNull()
  })
})

describe("normalizeEarnings", () => {
  it("fills defaults and stamps lastChecked", () => {
    const e = normalizeEarnings({ provider: "honeygain", balance: 5.5 })
    expect(e.provider).toBe("honeygain")
    expect(e.balance).toBe(5.5)
    expect(e.currency).toBe("USD")
    expect(e.source).toBe("manual")
    expect(e.status).toBe("ok")
    expect(e.today).toBeNull()
    expect(e.lastChecked).toBeGreaterThan(0)
    expect(e.extra).toEqual({})
  })
})

describe("connector registry", () => {
  it("registers built-in connectors with sensible metadata", () => {
    expect(hasConnector("expertoption")).toBe(true)
    expect(hasConnector("honeygain")).toBe(true)
    expect(hasConnector("opensea")).toBe(true)
    expect(hasConnector("nope")).toBe(false)
    const eo = getConnector("expertoption")
    expect(eo.label).toBe("ExpertOption")
    expect(eo.category).toBe("trading")
    expect(eo.transports).toContain("ws")
    expect(eo.transport).toBe("ws")
  })

  it("enumerates all registered connectors", () => {
    const slugs = listConnectors().map((c) => c.slug)
    for (const s of ["expertoption", "honeygain", "earnapp", "pawns", "repocket", "grass", "gradient", "silencio", "opensea", "aave", "yearn"]) {
      expect(slugs).toContain(s)
    }
  })

  it("rejects a connector without a slug", () => {
    expect(() => registerConnector({ label: "x" })).toThrow(/slug/)
  })
})

describe("browserCollect", () => {
  it("returns a normalized snapshot from mocked DOM reads", async () => {
    const result = await browserCollect({ slug: "honeygain", url: "https://dashboard.honeygain.com/" })
    expect(result.status).toBe("ok")
    expect(result.balance).toBe(1234.56)
    expect(result.today).toBe(12.4)
    expect(result.lifetime).toBe(9876)
    expect(result.source).toBe("browser")
    expect(result.extra.frames.length).toBeGreaterThan(0)
    expect(openBridge).toHaveBeenCalled()
  })

  it("returns an error snapshot when no browser is available", async () => {
    browserAvailable.mockResolvedValueOnce(false)
    const result = await browserCollect({ slug: "honeygain", url: "https://x" })
    expect(result.status).toBe("error")
    expect(result.error).toMatch(/no browser available/)
    expect(openBridge).not.toHaveBeenCalled()
  })

  it("reports a scrape that yielded no readable values instead of a fake zero balance", async () => {
    openBridge.mockImplementationOnce(async () => ({
      goto: vi.fn(async () => {}),
      read: vi.fn(async () => ({ url: "https://dashboard.example.com/", title: "Dashboard" })),
      addOverlay: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      onFrame: vi.fn((cb) => {
        cb?.({ dir: "recv", payload: "{}" })
        return () => {}
      })
    }))
    const result = await browserCollect({ slug: "honeygain", url: "https://dashboard.example.com/" })
    expect(result.status).toBe("error")
    expect(result.error).toMatch(/no readable values/)
    expect(result.balance).toBeNull()
  })

  it("maps custom selector keys (floor/volume) into balance + metrics", async () => {
    openBridge.mockImplementationOnce(async () => ({
      goto: vi.fn(async () => {}),
      read: vi.fn(async () => ({ floor: "$25.1K", volume: "$4.3M", url: "https://opensea.io/", title: "OpenSea" })),
      addOverlay: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      onFrame: vi.fn((cb) => {
        cb?.({ dir: "recv", payload: "{}" })
        return () => {}
      })
    }))
    const result = await browserCollect({
      slug: "opensea",
      url: "https://opensea.io/",
      selectors: { floor: "text:Floor price", volume: "text:Total volume" }
    })
    expect(result.status).toBe("ok")
    expect(result.balance).toBe(25100)
    expect(result.extra.metrics).toEqual({ floor: 25100, volume: 4300000 })
  })
})

describe("collectSource", () => {
  it("routes a known connector through its browser transport", async () => {
    const result = await collectSource("opensea")
    expect(result.status).toBe("ok")
    expect(result.provider).toBe("opensea")
  })

  it("throws for unknown connectors", async () => {
    await expect(collectSource("does-not-exist")).rejects.toThrow(/unknown connector/)
  })
})

describe("snapshot persistence", () => {
  it("persists a snapshot and exposes latest + filtered history", async () => {
    const snap = normalizeEarnings({
      provider: "honeygain",
      platform: "Honeygain",
      balance: 12.5,
      lifetime: 100,
      source: "browser",
      extra: { url: "https://x", frames: [{ dir: "recv", payload: "secret" }] }
    })
    await persistSnapshot(snap)

    const latest = await getLatestSnapshots()
    expect(latest.honeygain.balance).toBe(12.5)
    // heavy payload is trimmed on the way to disk
    expect(latest.honeygain.extra).toEqual({ url: "https://x", title: undefined })

    const history = await getHistory("honeygain", 10)
    expect(history).toHaveLength(1)
    expect(history[0].provider).toBe("honeygain")

    expect(await getHistory("opensea", 10)).toHaveLength(0)
    expect(await getHistory("honeygain", 1)).toHaveLength(1)
  })

  it("appends multiple snapshots in order and respects the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await persistSnapshot(normalizeEarnings({ provider: "aave", balance: i, extra: { url: "https://app.aave.com/" } }))
    }
    const history = await getHistory("aave", 3)
    expect(history).toHaveLength(3)
    expect(history[0].balance).toBe(2)
    expect(history[2].balance).toBe(4)
  })

  it("ignores snapshots without a provider", async () => {
    expect(await persistSnapshot(normalizeEarnings({}))).toBeNull()
  })
})

describe("live sessions", () => {
  it("opens a session, streams frames + snapshots to subscribers, then closes", async () => {
    let frameCb = null
    openBridge.mockImplementationOnce(async () => ({
      goto: vi.fn(async () => {}),
      read: vi.fn(async () => ({ balance: "$5.00", today: "", lifetime: "" })),
      addOverlay: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      onFrame: vi.fn((cb) => {
        frameCb = cb
        return () => {}
      })
    }))

    const session = await openLiveSession("honeygain")
    expect(session.slug).toBe("honeygain")
    expect(liveSessionSlugs()).toContain("honeygain")

    const seen = []
    const off = subscribeLive("honeygain", (msg) => seen.push(msg))
    expect(liveSubscriberCount("honeygain")).toBe(1)
    expect(session.latest?.balance).toBe(5)

    // a page WS frame is forwarded immediately
    frameCb({ dir: "recv", payload: '{"action":"ping"}' })
    expect(seen.some((m) => m.type === "frame" && m.frame?.dir === "recv")).toBe(true)

    await closeLiveSession("honeygain")
    off()
    expect(liveSessionSlugs()).not.toContain("honeygain")
    expect(liveSubscriberCount("honeygain")).toBe(0)
    expect(seen.some((m) => m.type === "closed")).toBe(true)
  })

  it("reuses an existing session for the same slug", async () => {
    const first = await openLiveSession("honeygain")
    const second = await openLiveSession("honeygain")
    expect(second).toBe(first)
    await closeAllLiveSessions()
    expect(liveSessionSlugs()).toEqual([])
  })

  it("fails cleanly when no browser is available", async () => {
    browserAvailable.mockResolvedValueOnce(false)
    await expect(openLiveSession("honeygain")).rejects.toThrow(/no browser available/)
    expect(openBridge).not.toHaveBeenCalled()
  })

  it("throws for unknown connectors", async () => {
    await expect(openLiveSession("nope")).rejects.toThrow(/unknown connector/)
  })
})
