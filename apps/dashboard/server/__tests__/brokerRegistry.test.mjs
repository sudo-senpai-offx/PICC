import { describe, expect, it, beforeEach } from "vitest"
import { registerBroker, getBroker, listBrokers, getActiveBrokers, anyBrokerAlive, unregisterBroker } from "../services/brokers/index.mjs"

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
})
