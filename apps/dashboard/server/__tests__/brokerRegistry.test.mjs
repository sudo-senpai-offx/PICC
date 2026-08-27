import { describe, expect, it, beforeEach } from "vitest"
import { registerBroker, getBroker, listBrokers, getActiveBrokers, anyBrokerAlive, unregisterBroker, getBrokerData, getBrokerStats, setBrokerStale, subscribeBroker } from "../services/brokers/index.mjs"

// Clean up after each test so brokers don't leak
const registered = []
function reg(adapter) {
  registered.push(adapter.slug)
  try { registerBroker(adapter) } catch { /* already registered */ }
}
beforeEach(() => {
  for (const slug of registered) unregisterBroker(slug)
  registered.length = 0
})

describe("broker registry", () => {
  it("registers and retrieves a broker by slug", () => {
    reg({ slug: "foo", label: "Foo" })
    const b = getBroker("foo")
    expect(b).not.toBeNull()
    expect(b.slug).toBe("foo")
    expect(b.label).toBe("Foo")
  })

  it("returns null for unknown slug", () => {
    expect(getBroker("nope")).toBeNull()
  })

  it("lists all registered brokers", () => {
    reg({ slug: "a", label: "A" })
    reg({ slug: "b", label: "B" })
    expect(listBrokers().length).toBeGreaterThanOrEqual(2)
    const slugs = listBrokers().map((b) => b.slug)
    expect(slugs).toContain("a")
    expect(slugs).toContain("b")
  })

  it("sorts active brokers by weight DESC", () => {
    reg({ slug: "heavy", label: "Heavy", weight: 100 })
    reg({ slug: "light", label: "Light", weight: 10 })
    const active = getActiveBrokers()
    const idx = active.findIndex((b) => b.slug === "heavy")
    const idxLight = active.findIndex((b) => b.slug === "light")
    expect(idx).toBeLessThan(idxLight)
  })

  it("defaults weight to 50 when omitted", () => {
    reg({ slug: "default-wt", label: "Default" })
    const b = getBroker("default-wt")
    expect(b.weight).toBe(50)
  })

  it("fills default methods for missing adapter hooks", () => {
    reg({ slug: "minimal", label: "Minimal" })
    const b = getBroker("minimal")
    expect(b.isAlive()).toBe(false)
    expect(b.getCandles()).toEqual([])
    expect(b.getAccountState()).toBeNull()
    expect(b.getExpiryDurations()).toBeNull()
    expect(typeof b.subscribe).toBe("function")
    expect(typeof b.stats).toBe("function")
    expect(typeof b.availableTimeframes).toBe("function")
  })

  it("throws on duplicate slug", () => {
    reg({ slug: "dup", label: "Dup" })
    expect(() => registerBroker({ slug: "dup", label: "Dup2" })).toThrow("already registered")
  })

  it("throws on missing slug", () => {
    expect(() => registerBroker({})).toThrow("must have a slug")
  })

  it("anyBrokerAlive returns true when at least one is alive", () => {
    reg({ slug: "dead-broker", label: "Dead" }) // isAlive defaults to false
    expect(anyBrokerAlive()).toBe(false)
    reg({ slug: "alive-broker", label: "Alive", isAlive: () => true })
    expect(anyBrokerAlive()).toBe(true)
  })

  it("unregisterBroker removes a broker", () => {
    reg({ slug: "temp", label: "Temp" })
    expect(getBroker("temp")).not.toBeNull()
    unregisterBroker("temp")
    expect(getBroker("temp")).toBeNull()
  })

  it("unregisterBroker is a no-op for unknown slug", () => {
    expect(() => unregisterBroker("nope")).not.toThrow()
  })

  it("fills default dataSnapshot and setStaleness for minimal adapters", () => {
    reg({ slug: "minimal2", label: "Minimal2" })
    const b = getBroker("minimal2")
    expect(typeof b.dataSnapshot).toBe("function")
    expect(typeof b.setStaleness).toBe("function")
    const snap = b.dataSnapshot()
    expect(snap).toHaveProperty("assets")
    expect(snap).toHaveProperty("ts")
    expect(b.setStaleness(true)).toBeUndefined() // no-op
  })
})

describe("broker registry convenience functions", () => {
  it("getBrokerData returns empty data when no brokers registered", () => {
    const data = getBrokerData()
    expect(data.assets).toEqual([])
    expect(data.ts).toBe(0)
  })

  it("getBrokerData returns data from the highest-weight alive broker", () => {
    reg({
      slug: "low-data",
      label: "Low",
      weight: 10,
      isAlive: () => true,
      dataSnapshot: () => ({ assets: [{ id: "A" }], ts: 100 })
    })
    reg({
      slug: "high-data",
      label: "High",
      weight: 100,
      isAlive: () => true,
      dataSnapshot: () => ({ assets: [{ id: "B" }], ts: 200 })
    })
    const data = getBrokerData()
    expect(data.assets[0].id).toBe("B") // high weight wins
  })

  it("getBrokerData falls back to dead broker with cached data", () => {
    reg({
      slug: "dead-cached",
      label: "Dead cached",
      weight: 10,
      isAlive: () => false,
      dataSnapshot: () => ({ assets: [{ id: "X" }], ts: 300 })
    })
    const data = getBrokerData()
    expect(data.assets[0].id).toBe("X") // only broker available
  })

  it("getBrokerStats returns disconnected default when no brokers registered", () => {
    const stats = getBrokerStats()
    expect(stats.status).toBe("disconnected")
  })

  it("getBrokerStats returns stats from the highest-weight alive broker", () => {
    reg({
      slug: "low-stats",
      label: "Low",
      weight: 10,
      isAlive: () => true,
      stats: () => ({ status: "idle", lastSeen: 100 })
    })
    reg({
      slug: "high-stats",
      label: "High",
      weight: 100,
      isAlive: () => true,
      stats: () => ({ status: "connected", lastSeen: 200 })
    })
    const stats = getBrokerStats()
    expect(stats.status).toBe("connected")
    expect(stats.lastSeen).toBe(200)
  })

  it("setBrokerStale calls setStaleness on the alive broker", () => {
    let staleFlag = false
    reg({
      slug: "staleable",
      label: "Staleable",
      weight: 50,
      isAlive: () => true,
      setStaleness: (v) => { staleFlag = v }
    })
    setBrokerStale(true)
    expect(staleFlag).toBe(true)
    setBrokerStale(false)
    expect(staleFlag).toBe(false)
  })

  it("subscribeBroker calls the broker's subscribe method", () => {
    let receivedAssetId = undefined
    reg({
      slug: "sub",
      label: "Sub",
      weight: 50,
      isAlive: () => true,
      subscribe: (assetId, cb) => { receivedAssetId = assetId; cb({ id: assetId }); return () => "unsub" }
    })
    let received = null
    const unsub = subscribeBroker((data) => { received = data })
    expect(typeof unsub).toBe("function")
    // subscribeBroker passes null as assetId (wildcard subscribe)
    expect(receivedAssetId).toBeNull()
    // The mock subscribe immediately invokes cb, so received is populated
    expect(received).toEqual({ id: null })
  })

  it("subscribeBroker returns no-op when no brokers registered", () => {
    const unsub = subscribeBroker(() => {})
    expect(typeof unsub).toBe("function")
    expect(unsub()).toBeUndefined()
  })
})
