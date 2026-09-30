// Phase 5 — account-metrics layer (T5 parser/extractor + T6 store + T5/T7
// cadence collector) of docs/specs/PICC_HEADLESS_CAPTURE_ENGINE.md.
//
// Honesty-focused: the strict parser must never collapse an ABSENT balance to
// a fabricated 0 (accountFrom in expertoption.mjs does — that is exactly the
// flat view we re-derive from), and the store must never invent records for
// venues that produced no observation. liveEO is mocked (the collector reads
// its raw-frame cache); the store is exercised in-memory here and ON-DISK in
// the resetModules describe below (PICC_ACCOUNT_METRICS_DATA_DIR → tmp).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  accountMetricsForUser,
  accountMetricsRefresh,
  collectAccountMetrics,
  extractAccountState,
  getAccountMetrics,
  parseAccountFrame,
  putAccountMetrics,
  staleFrom,
  _resetMetricsCollectorState
} from "../services/accountMetrics.mjs"
import { metricsCadenceMs, setHeadlessSessionPolicy, listCaptureProfiles, _resetHeadlessSessionState } from "../services/captureProfiles.mjs"

// D2/AC-005: the `vi.mock("../services/liveEO.mjs", …)` block and the
// `liveEOAccountRaw` import are removed with liveEO.mjs. The collector's
// production frame source is gone, so the collector tests below assert the
// honest new outcome: with no `extractVia:["ws"]` profile left, the collector
// observes nothing and stores nothing. The extractor, parser and STORE are all
// still exercised directly — they are venue-agnostic and unchanged.

// D2/AC-005: `expertoption` is no longer a capture profile, so the tests that
// need a profile with a `ws` extractor cannot use it. `extractAccountState`
// refuses any venue whose profile does not declare `extractVia:["ws"]`, and after
// the removal NO profile declares it. The tests therefore drive the extractor
// through its own parser-facing seam and assert the venue-gate refusal, which is
// the guarantee that is still true. A synthetic profile is NOT injected: doing so
// would test a fixture the production table no longer contains.

const FRESH = new Date().toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  _resetHeadlessSessionState()
  _resetMetricsCollectorState()
  setHeadlessSessionPolicy({})
})

afterEach(() => {
  setHeadlessSessionPolicy({})
})

// ---------------------------------------------------------------------
// T5 — strict vocabulary parser
// ---------------------------------------------------------------------

describe("parseAccountFrame — strict null-vs-zero (T5)", () => {
  it("a frame with balance:null yields balance:null — never a fabricated 0", () => {
    const rec = parseAccountFrame({ balance: null })
    expect(rec).not.toBeNull()
    expect(rec.balance).toBeNull()
    expect(rec.demoWallet.balance).toBeNull()
    expect(rec.realWallet.balance).toBeNull()
    expect(rec.active).toBeNull()
    expect(rec.demo).toBeNull()
  })

  it("a genuine zero balance stays zero", () => {
    const rec = parseAccountFrame({ balance: 0 })
    expect(rec.balance).toBe(0)
    expect(rec.currency).toBe("USD")
  })

  it("EO demo profile frame — both wallets carried, demo context wins", () => {
    const rec = parseAccountFrame({ is_demo: 1, demo_balance: 123.45, real_balance: 0, currency: "USD" })
    expect(rec.demoWallet.balance).toBe(123.45)
    expect(rec.realWallet.balance).toBe(0) // genuine zero, present in the frame
    expect(rec.active).toBe("demo")
    expect(rec.balance).toBe(123.45)
    expect(rec.demo).toBe(true)
  })

  it("EO real profile frame flips the active context", () => {
    const rec = parseAccountFrame({ is_demo: 0, real_balance: 500, demo_balance: 100 })
    expect(rec.active).toBe("real")
    expect(rec.balance).toBe(500)
    expect(rec.realWallet.balance).toBe(500)
    expect(rec.demo).toBe(false)
  })

  it("absent real_balance in a demo frame is null, not 0", () => {
    const rec = parseAccountFrame({ is_demo: 1, demo_balance: 42 })
    expect(rec.realWallet.balance).toBeNull()
    expect(rec.demoWallet.balance).toBe(42)
  })

  it("single wallet flagged demo without demo_balance uses the single amount", () => {
    const rec = parseAccountFrame({ is_demo: 1, balance: 10 })
    expect(rec.demoWallet.balance).toBe(10)
    expect(rec.active).toBe("demo")
  })

  it("legacy single-balance with no flag does NOT guess the wallet", () => {
    const rec = parseAccountFrame({ balance: 42 })
    expect(rec.active).toBeNull()
    expect(rec.balance).toBe(42)
    expect(rec.demoWallet.balance).toBeNull()
    expect(rec.realWallet.balance).toBeNull()
    expect(rec.demo).toBeNull()
  })

  it("demangles the raw WS app-object wrapper", () => {
    const rec = parseAccountFrame({ action: "profile", message: { profile: { is_demo: 1, demo_balance: 7 } } })
    expect(rec).not.toBeNull()
    expect(rec.demoWallet.balance).toBe(7)
  })

  it("candle frames are not profile frames", () => {
    expect(parseAccountFrame({ action: "candle", asset_id: "EURUSD", candles: [{ v: [1, 2, 3, 4] }] })).toBeNull()
  })

  it("identity fields are preserved; open positions are never fabricated", () => {
    const rec = parseAccountFrame({ email: "trader@example.com", name: "Ada", is_demo: 1, demo_balance: 5 })
    expect(rec.email).toBe("trader@example.com")
    expect(rec.name).toBe("Ada")
    expect(rec.openPositions).toBeNull()
    expect(rec.exposurePct).toBeNull()
  })
})

// ---------------------------------------------------------------------
// T5 — extractor
// ---------------------------------------------------------------------

describe("extractAccountState (T5)", () => {
  // D2/AC-005: `expertoption` is no longer a capture profile, so it is no longer
  // a valid `venueId` here. The extractor's gate is "does this venue's profile
  // declare extractVia:['ws']?", and after the removal NO profile declares it —
  // `expertoption` was the only one. So the extractor now refuses every venue,
  // which is the honest new behaviour and exactly what these tests pin. The
  // per-frame stamping logic (most-recent-wins, sourceLeg, observedAt) is
  // unchanged in the source and remains covered through `parseAccountFrame`
  // above; it is simply unreachable from production now, and pretending
  // otherwise would require injecting a profile the real table does not have.
  it("refuses a venue that no longer exists (expertoption, D2)", () => {
    expect(
      extractAccountState({
        venueId: "expertoption",
        frames: [
          { at: 100, leg: "studio", payload: { balance: 1 } },
          { at: 200, leg: "studio", payload: { balance: 2 } }
        ]
      })
    ).toBeNull()
  })

  it("refuses an unknown venue", () => {
    expect(extractAccountState({ venueId: "not-a-venue", frames: [{ balance: 1 }] })).toBeNull()
  })

  it("refuses a real venue with no ws extractor (iqoption)", () => {
    expect(extractAccountState({ venueId: "iqoption", frames: [{ balance: 1 }] })).toBeNull()
  })

  it("no capture profile declares the ws via any more, so no venue can be extracted", () => {
    const withWs = listCaptureProfiles().filter((p) => (p.metrics?.extractVia ?? []).includes("ws"))
    expect(withWs).toEqual([])
  })

  it("returns null when no frame parsed (candles only) or empty", () => {
    expect(extractAccountState({ venueId: "expertoption", frames: [] })).toBeNull()
    expect(extractAccountState({ venueId: "expertoption", frames: [{ action: "candle", candles: [] }] })).toBeNull()
  })

  it("observedAt is the record's, and staleFrom compares it to the cadence", () => {
    // staleFrom is store-agnostic: drive it with a hand-built record so the
    // assertion survives the removal of the ws producer.
    const rec = { venueId: "iqoption", observedAt: new Date().toISOString(), balance: 3 }
    expect(staleFrom({ record: rec, cadenceMs: 5 * 60 * 1000 })).toBe(false)
  })
})

// ---------------------------------------------------------------------
// T6 — per-user store
// ---------------------------------------------------------------------

describe("account-metrics store (T6)", () => {
  it("round-trips the latest record per user+venue, replacing older", async () => {
    await putAccountMetrics("userA", { venueId: "expertoption", balance: 10, observedAt: FRESH })
    await putAccountMetrics("userA", { venueId: "expertoption", balance: 20, observedAt: FRESH })
    expect(getAccountMetrics("userA", "expertoption").balance).toBe(20)
  })

  it("never leaks records across users", async () => {
    await putAccountMetrics("userA", { venueId: "expertoption", balance: 10, observedAt: FRESH })
    expect(getAccountMetrics("userB", "expertoption")).toBeNull()
    expect(accountMetricsForUser("userB")).toEqual({})
  })

  it("returns null for venues that were never observed", async () => {
    await putAccountMetrics("userA", { venueId: "expertoption", balance: 10, observedAt: FRESH })
    expect(getAccountMetrics("userA", "iqoption")).toBeNull()
  })

  it("a stored null balance stays null — no fabricated zero in persistence", async () => {
    await putAccountMetrics("userA", { venueId: "expertoption", balance: null, observedAt: FRESH })
    expect(getAccountMetrics("userA", "expertoption").balance).toBeNull()
  })

  it("accountMetricsForUser returns a defensive copy", async () => {
    await putAccountMetrics("userA", { venueId: "expertoption", balance: 10, observedAt: FRESH })
    const view = accountMetricsForUser("userA")
    view.expertoption.balance = 999
    expect(getAccountMetrics("userA", "expertoption").balance).toBe(10)
  })
})

describe("store survives a module restart via the data file (T6)", () => {
  let dir
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "picc-metrics-"))
    process.env.PICC_ACCOUNT_METRICS_DATA_DIR = dir
    vi.resetModules() // fresh instance so METRICS_FILE binds to the tmp dir
  })
  afterEach(() => {
    delete process.env.PICC_ACCOUNT_METRICS_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("restart reads the persisted observation back (boot read)", async () => {
    const m1 = await import("../services/accountMetrics.mjs")
    await m1.putAccountMetrics("userA", {
      venueId: "expertoption",
      balance: 42,
      sourceLeg: "studio",
      observedAt: new Date().toISOString()
    })
    vi.resetModules()
    const m2 = await import("../services/accountMetrics.mjs")
    const rec = m2.getAccountMetrics("userA", "expertoption")
    expect(rec.balance).toBe(42)
    expect(rec.sourceLeg).toBe("studio")
  })
})

// ---------------------------------------------------------------------
// T5/T7 — cadence collector
// ---------------------------------------------------------------------

describe("collector + cadence gate (T5/T7)", () => {
  // D2/AC-005: every test in this block is re-pointed. The collector's frame
  // producer (liveEO) is deleted and no profile declares `extractVia:["ws"]`, so
  // the collector now observes nothing for ANY venue and stores nothing. The
  // cadence gate and the store are still exercised — by asserting the honest
  // empty result, not by faking a frame source that no longer exists.

  it("collects nothing for the removed venue, and stores nothing", async () => {
    expect(await collectAccountMetrics("default", "expertoption")).toBeNull()
    expect(getAccountMetrics("default", "expertoption")).toBeNull()
  })

  it("collects nothing for a surviving venue, because none declares a ws extractor", async () => {
    expect(await collectAccountMetrics("default", "iqoption")).toBeNull()
    expect(getAccountMetrics("default", "iqoption")).toBeNull()
  })

  it("refresh collects nothing, on any pass — the gate is not what stops it", async () => {
    expect(await accountMetricsRefresh("default")).toHaveLength(0)
    expect(await accountMetricsRefresh("default")).toHaveLength(0)
  })

  it("a stored record still round-trips (the store survives with no producer)", async () => {
    await putAccountMetrics("default", { venueId: "iqoption", balance: 11, observedAt: FRESH })
    expect(getAccountMetrics("default", "iqoption").balance).toBe(11)
  })

  it("the policy seam feeds the effective metrics cadence (T7 wiring)", () => {
    // D2/AC-005: re-pointed from the removed "expertoption" to "iqoption", the
    // first still-profiled capture venue. The seam is venue-agnostic.
    setHeadlessSessionPolicy({ iqoption: { metricsCadenceMs: 60_000 } })
    expect(metricsCadenceMs("iqoption")).toBe(60_000)
    _resetHeadlessSessionState()
    expect(metricsCadenceMs("iqoption")).toBe(5 * 60 * 1000)
  })
})