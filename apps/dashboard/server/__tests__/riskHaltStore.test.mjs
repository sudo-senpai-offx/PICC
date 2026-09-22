// WS-2 R4 / AC-3 — halt persistence store + the sidecar's additive write-through
// seam. Covers: trip → file + sidecar globalHalt; restart re-hydration (gate 2
// re-blocks; inactive only when no halt); takeover/clear write-through; unreadable
// and version-≠1 files hydrate TRIPPED (fail-safe deny); the seam itself fires
// from noteBreakerTrip / humanTakeover / clearTakeover.
import { beforeEach, describe, expect, test, vi } from "vitest"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  _resetHaltStore,
  clearTakeoverPersist,
  humanTakeoverPersist,
  hydrate,
  tripBreaker
} from "../services/commandCentre/riskHaltStore.mjs"
import {
  _resetSidecarState,
  clearTakeover,
  crossSiteHaltState,
  evaluateGate,
  humanTakeover,
  noteBreakerTrip,
  takeoverState,
  wireHaltPersistence
} from "../services/commandCentre/safetySidecar.mjs"
import { templateForSite } from "../services/commandCentre/policyGraphCatalog.mjs"
import { dayKeyOf } from "../services/u4faRisk.mjs"

const storeUrl = "../services/commandCentre/riskHaltStore.mjs"
const sidecarUrl = "../services/commandCentre/safetySidecar.mjs"

const ccxt = () => templateForSite("trading:ccxt")

function greenState(overrides = {}) {
  return {
    killSwitch: false,
    optIn: true,
    breakers: { dailyLossHalted: false, regimeHalted: false, siteCapped: false },
    staleFeeds: [],
    concurrentUnits: 0,
    dayLossPct: 0,
    now: Date.now(),
    ...overrides
  }
}

function greenProposal(overrides = {}) {
  return {
    action: "ccxt:limit-buy",
    live: true,
    exposureUsd: 5,
    rationale: "verified trend + entry within stop budget (deterministic gates green)",
    idempotencyKey: `buy-btc-2026-${Math.random().toString(36).slice(2)}`,
    ...overrides
  }
}

async function withDiskDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "picc-cc-halt-"))
  const envKey = "PICC_COMMAND_CENTRE_DATA_DIR"
  const prior = process.env[envKey]
  process.env[envKey] = dir
  try {
    return await fn(dir)
  } finally {
    if (prior === undefined) delete process.env[envKey]
    else process.env[envKey] = prior
  }
}

beforeEach(() => {
  _resetHaltStore()
  _resetSidecarState()
})

describe("riskHaltStore — the sidecar write-through seam (additive)", () => {
  test("noteBreakerTrip / humanTakeover / clearTakeover invoke the wired handlers", () => {
    const seen = { trip: null, takeover: null, clear: 0 }
    wireHaltPersistence({
      onTrip: (t) => {
        seen.trip = t
      },
      onTakeover: (t) => {
        seen.takeover = t
      },
      onClear: () => {
        seen.clear += 1
      }
    })
    const now = Date.now()
    noteBreakerTrip("expertoption", "regimeHalted", { now })
    expect(seen.trip).toMatchObject({ dayKey: dayKeyOf(now), site: "expertoption", breaker: "regimeHalted", at: now })
    humanTakeover({ now })
    expect(seen.takeover).toEqual({ at: now })
    clearTakeover()
    expect(seen.clear).toBe(1)
  })

  test("unwired (or all-null) seam leaves the in-memory mutations untouched", () => {
    wireHaltPersistence(null)
    const h = noteBreakerTrip("trading:ccxt", "dailyLoss")
    expect(h).toEqual(crossSiteHaltState())
    wireHaltPersistence({})
    humanTakeover()
    expect(takeoverState()).not.toBeNull()
    clearTakeover()
    expect(takeoverState()).toBeNull()
  })

  test("store mutations are audit-backed — the write-through records the why", () => {
    const events = []
    const audit = (e) => events.push(e)
    tripBreaker("trading:ccxt", "dailyLoss", { now: Date.now(), audit })
    humanTakeoverPersist({ now: Date.now(), audit })
    clearTakeoverPersist({ audit })
    expect(events.map((e) => e.kind)).toEqual(["halt:trip", "halt:takeover", "halt:clear"])
    expect(events[0]).toMatchObject({ site: "trading:ccxt", kind: "halt:trip" })
  })

  test("hydrate() re-seeds the sidecar from the store after a sidecar reset", () => {
    tripBreaker("trading:ccxt", "dailyLoss", { now: Date.now() })
    _resetSidecarState()
    expect(crossSiteHaltState()).toBeNull()
    hydrate()
    expect(crossSiteHaltState()).toMatchObject({ site: "trading:ccxt", breaker: "dailyLoss" })
  })
})

describe("riskHaltStore — persistence (AC-3 / R4)", () => {
  test("a trip writes command-centre-halt.json AND seeds the sidecar globalHalt", async () => {
    await withDiskDir(async (dir) => {
      vi.resetModules()
      const store = await import(storeUrl)
      const sidecar = await import(sidecarUrl)
      const now = Date.now()
      store.tripBreaker("trading:ccxt", "dailyLoss", { now })
      const file = join(dir, "command-centre-halt.json")
      expect(existsSync(file)).toBe(true)
      const persisted = JSON.parse(readFileSync(file, "utf8"))
      expect(persisted.version).toBe(1)
      expect(persisted.globalHalt).toMatchObject({ dayKey: dayKeyOf(now), site: "trading:ccxt", breaker: "dailyLoss", at: now })
      expect(persisted.takeover).toBeNull()
      expect(sidecar.crossSiteHaltState()).toEqual(persisted.globalHalt)
    })
  })

  test("a restart re-hydrates a persisted trip — gate 2 re-blocks (AC-3)", async () => {
    await withDiskDir(async (dir) => {
      vi.resetModules()
      const store = await import(storeUrl)
      store.tripBreaker("trading:ccxt", "dailyLoss", { now: Date.now() })

      vi.resetModules()
      const rebootedStore = await import(storeUrl)
      const rebootedSidecar = await import(sidecarUrl)
      expect(rebootedStore.haltSnapshot().globalHalt).toMatchObject({ site: "trading:ccxt", breaker: "dailyLoss" })
      const r = rebootedSidecar.evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState() })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("cross-site-day-halt")
    })
  })

  test("gate 2 stays inactive on a clean restart — no halt file, no block", async () => {
    await withDiskDir(async (dir) => {
      vi.resetModules()
      const store = await import(storeUrl)
      const sidecar = await import(sidecarUrl)
      expect(store.haltSnapshot()).toEqual({ globalHalt: null, takeover: null })
      const r = sidecar.evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState() })
      expect(r.allow).toBe(true)
      expect(r.blockedBy).toBeNull()
    })
  })

  test("a persisted takeover re-hydrates, gate 3 re-blocks, and the seam clears it", async () => {
    await withDiskDir(async (dir) => {
      const now = Date.now()
      vi.resetModules()
      const store = await import(storeUrl)
      store.humanTakeoverPersist({ now })

      vi.resetModules()
      const rebootedStore = await import(storeUrl)
      const rebootedSidecar = await import(sidecarUrl)
      expect(rebootedStore.haltSnapshot().takeover).toEqual({ at: now })
      const r = rebootedSidecar.evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState() })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("human-takeover")

      rebootedSidecar.clearTakeover()
      expect(JSON.parse(readFileSync(join(dir, "command-centre-halt.json"), "utf8")).takeover).toBeNull()
      const again = rebootedSidecar.evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState() })
      expect(again.allow).toBe(true)
    })
  })

  test("takeover and clear round-trip through the persisted file (write-through)", async () => {
    await withDiskDir(async (dir) => {
      vi.resetModules()
      const store = await import(storeUrl)
      const sidecar = await import(sidecarUrl)
      const now = Date.now()
      store.humanTakeoverPersist({ now })
      let persisted = JSON.parse(readFileSync(join(dir, "command-centre-halt.json"), "utf8"))
      expect(persisted.takeover).toEqual({ at: now })
      expect(sidecar.takeoverState()).toEqual({ at: now })

      store.clearTakeoverPersist()
      persisted = JSON.parse(readFileSync(join(dir, "command-centre-halt.json"), "utf8"))
      expect(persisted.takeover).toBeNull()
      expect(sidecar.takeoverState()).toBeNull()
    })
  })

  test("a sidecar noteBreakerTrip writes through the auto-wired seam without touching gate logic", async () => {
    await withDiskDir(async (dir) => {
      vi.resetModules()
      await import(storeUrl) // wires the seam into a fresh sidecar at module init
      const sidecar = await import(sidecarUrl)
      const now = Date.now()
      sidecar.noteBreakerTrip("trading:ccxt", "dailyLoss", { now })
      let persisted = JSON.parse(readFileSync(join(dir, "command-centre-halt.json"), "utf8"))
      expect(persisted.globalHalt).toMatchObject({ dayKey: dayKeyOf(now), site: "trading:ccxt", breaker: "dailyLoss" })

      sidecar.humanTakeover({ now })
      expect(JSON.parse(readFileSync(join(dir, "command-centre-halt.json"), "utf8")).takeover).toEqual({ at: now })
      sidecar.clearTakeover()
      expect(JSON.parse(readFileSync(join(dir, "command-centre-halt.json"), "utf8")).takeover).toBeNull()
    })
  })

  test("an unreadable halt file hydrates TRIPPED — gate 2 blocks (fail-safe deny)", async () => {
    await withDiskDir(async (dir) => {
      writeFileSync(join(dir, "command-centre-halt.json"), "{ corrupted json", "utf8")
      vi.resetModules()
      const store = await import(storeUrl)
      const sidecar = await import(sidecarUrl)
      expect(store.haltSnapshot().globalHalt).not.toBeNull()
      expect(sidecar.crossSiteHaltState().breaker).toBe("unreadable")
      const r = sidecar.evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState() })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("cross-site-day-halt")
    })
  })

  test("a version-≠1 halt file is handled conservatively — hydrated tripped", async () => {
    await withDiskDir(async (dir) => {
      writeFileSync(
        join(dir, "command-centre-halt.json"),
        JSON.stringify({ version: 2, globalHalt: null, takeover: null }),
        "utf8"
      )
      vi.resetModules()
      const store = await import(storeUrl)
      const sidecar = await import(sidecarUrl)
      expect(store.haltSnapshot().globalHalt).not.toBeNull()
      const r = sidecar.evaluateGate({ template: ccxt(), proposal: greenProposal(), state: greenState() })
      expect(r.allow).toBe(false)
      expect(r.blockedBy).toBe("cross-site-day-halt")
    })
  })
})