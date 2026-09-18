// T3 — per-user chart source preference (PICC_MULTISOURCE_ENGINE, Mech B).
//
// chartPrefs mirrors the feed-mode persistence pattern in liveEO.mjs:
// an "auto" | broker-slug preference per user, keyed "default" pre-auth, with
// registry validation (only a REGISTERED candle-capable broker slug sticks —
// unknown/paper slugs resolve to "auto"), and disk reads/writes suppressed
// under VITEST so parallel test files can never contaminate each other.

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerBroker, unregisterBroker } from "../services/brokers/index.mjs"

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "picc-chart-prefs-"))
  // Point the prefs file at tmp BEFORE the module loads so any accidental
  // write would land there (and be asserted absent) — never in the repo.
  process.env.PICC_DATA_DIR = tmp
})

afterEach(() => {
  delete process.env.PICC_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
  unregisterBroker("pref-broker-a")
  unregisterBroker("paper")
})

describe("T3 chart source preference", () => {
  it("defaults to 'auto' for every user before anything is set", async () => {
    const { getSourcePref } = await import("../services/chartPrefs.mjs")
    expect(getSourcePref("default")).toBe("auto")
    expect(getSourcePref("user-a")).toBe("auto")
    expect(getSourcePref(null)).toBe("auto")
    expect(getSourcePref(undefined)).toBe("auto")
  })

  it("persists only REGISTERED candle-capable slugs; unknown/paper/empty resolve to 'auto'", async () => {
    registerBroker({
      slug: "pref-broker-a",
      label: "Pref Broker A",
      weight: 50,
      getCandles: () => []
    })
registerBroker({
    slug: "paper",
    label: "Paper broker",
    weight: 10,
    getCandles: () => []
  })
    const { getSourcePref, setSourcePref } = await import("../services/chartPrefs.mjs")

    expect(setSourcePref("user-a", "pref-broker-a")).toBe("pref-broker-a")
    expect(getSourcePref("user-a")).toBe("pref-broker-a")

    expect(setSourcePref("user-a", "no-such-broker")).toBe("auto")
    expect(getSourcePref("user-a")).toBe("auto")

    expect(setSourcePref("user-a", "paper")).toBe("auto") // paper = no candle data
    expect(getSourcePref("user-a")).toBe("auto")

    expect(setSourcePref("user-a", "")).toBe("auto")
    expect(setSourcePref("user-a", undefined)).toBe("auto")
    expect(setSourcePref("user-a", "AUTO")).toBe("auto") // case-insensitive
  })

  it("keeps preferences per-user — user A's pin never leaks into user B", async () => {
    registerBroker({ slug: "pref-broker-a", label: "Pref Broker A", weight: 50, getCandles: () => [] })
    const { getSourcePref, setSourcePref } = await import("../services/chartPrefs.mjs")

    setSourcePref("user-a", "pref-broker-a")
    expect(getSourcePref("user-b")).toBe("auto")
    expect(getSourcePref("default")).toBe("auto")
  })

  it("suppresses disk writes under the test runner (VITEST) — no file appears", async () => {
    registerBroker({ slug: "pref-broker-a", label: "Pref Broker A", weight: 50, getCandles: () => [] })
    const { setSourcePref } = await import("../services/chartPrefs.mjs")

    setSourcePref("user-a", "pref-broker-a")
    setSourcePref("user-a", "auto")

    expect(existsSync(join(tmp, "chart-prefs.json"))).toBe(false)
  })
})
