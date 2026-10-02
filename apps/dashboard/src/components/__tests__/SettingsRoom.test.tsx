// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { flushSync } from "react-dom"
import type { ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { SettingsRoom } from "@/pages/ministry/SettingsRoom"
import { EarningsSettingsRoom } from "@/pages/ministry/EarningsRooms"
import { IntelligenceSettingsRoom } from "@/pages/ministry/IntelligenceRooms"
import { getMinistrySettings } from "@/lib/ministrySettings"

const WAIT = { timeout: 5000 }

/**
 * WS-7 T18. The D17 news/sentiment rows, shaped EXACTLY as the server derives
 * them from `newsSources.mjs`. One source is configured (`rss-atom`) and the
 * rest are absent, so both renderings are exercised in one table.
 */
const NEWS_FIXTURE = {
  entries: [
    {
      id: "rss-atom",
      ministry: "trading",
      name: "RSS / Atom feeds",
      url: "https://datatracker.ietf.org/doc/html/rfc4287",
      purpose: "headline-level news for the digest and the 5% Sentiment expert",
      retrievalMode: "licensed-feed",
      licensedBasis: "the publisher's own RSS/Atom feed, reached over HTTP GET with no credential.",
      boundary: { freeTier: "key-less", rateLimit: "6 fetches per feed per 10 min", keyRequired: false },
      state: "degraded",
      unconfiguredReason: null,
      configEvidence: "PICC_NEWS_FEEDS=set"
    },
    {
      id: "gdelt",
      ministry: "trading",
      name: "GDELT DOC 2.0",
      url: "https://gdeltproject.org/",
      purpose: "global news monitoring and tone scoring",
      retrievalMode: "licensed-api",
      licensedBasis: "GDELT publishes DOC 2.0 as open data over a documented, key-less HTTP API.",
      boundary: { freeTier: "key-less", rateLimit: "~1 request / 5 s", keyRequired: false },
      state: "unconfigured",
      unconfiguredReason: 'PICC_NEWS_GDELT is not "on". This is an absence, not a neutral reading.',
      configEvidence: null
    },
    {
      id: "newsapi",
      ministry: "trading",
      name: "NewsAPI",
      url: "https://newsapi.org/",
      purpose: "licensed headline search with source attribution",
      retrievalMode: "licensed-api",
      licensedBasis: "NewsAPI is a commercial licensed news API with published developer terms.",
      boundary: { freeTier: "credentialed - see the named env var", rateLimit: "100 requests/day", keyRequired: true },
      state: "unconfigured",
      unconfiguredReason:
        "NEWSAPI_API_KEY is unset, so the licensed NewsAPI leg cannot run. (observed: PICC_NEWS_NEWSAPI is not \"on\"; NEWSAPI_API_KEY unset.) This is an absence, not a neutral reading.",
      configEvidence: null
    },
    {
      id: "cryptopanic",
      ministry: "trading",
      name: "CryptoPanic",
      url: "https://cryptopanic.com/",
      purpose: "crypto asset-news stream for the crypto leg of the digest",
      retrievalMode: "licensed-websocket",
      licensedBasis: "CryptoPanic is a licensed crypto news/asset API with a realtime stream.",
      boundary: { freeTier: "credentialed - see the named env var", rateLimit: "published plan limits", keyRequired: true },
      state: "unconfigured",
      unconfiguredReason:
        "CRYPTOPANIC_AUTH_TOKEN is unset, so the licensed CryptoPanic stream cannot authenticate. (observed: PICC_NEWS_CRYPTOPANIC is not \"on\"; CRYPTOPANIC_AUTH_TOKEN unset.) This is an absence, not a neutral reading.",
      configEvidence: null
    },
    {
      id: "picc-own-browser",
      ministry: "trading",
      name: "PICC's own browser",
      url: "https://datatracker.ietf.org/doc/html/rfc9110",
      purpose: "the sanctioned path for a source that publishes no API or feed",
      retrievalMode: "picc-own-browser",
      licensedBasis:
        "PICC's own headed/headless Chromium, operated by PICC. D17:245: it carries PICC's labeling obligations.",
      boundary: { freeTier: "key-less", rateLimit: "one page read per source per pass", keyRequired: false },
      state: "unconfigured",
      unconfiguredReason:
        "PICC_NEWS_BROWSER_SOURCES names no page, so PICC's own browser was not asked to read anything. (observed: PICC_NEWS_BROWSER_SOURCES unset.) This is an absence, not a neutral reading.",
      configEvidence: null
    }
  ]
}

const TRADING_FIXTURE = {
  entries: [
    {
      id: "twelve-data",
      ministry: "trading",
      name: "Twelve Data",
      url: "https://twelvedata.com/pricing",
      purpose: "Real-time US equities, forex, crypto, technical indicators",
      boundary: { freeTier: "8 API credits/min, 800/day", rateLimit: "8 API credits/min", keyRequired: true },
      state: "unconfigured"
    },
    {
      id: "binance-public",
      ministry: "trading",
      name: "Binance Public API",
      url: "https://github.com/binance/binance-spot-api-docs/master/rest-api.md",
      purpose: "Spot market data, order book depth, trades, klines/candlesticks",
      boundary: { freeTier: "Weight-based limits, no key for public endpoints", rateLimit: "~1200 weight/min", keyRequired: false },
      state: "unconfigured"
    },
    {
      id: "gdelt",
      ministry: "trading",
      name: "GDELT DOC 2.0",
      url: "https://gdeltproject.org/",
      purpose: "Global news monitoring, tone/sentiment scoring, event detection",
      boundary: { freeTier: "100% free, open data", rateLimit: "1 request/5 seconds recommended", keyRequired: false },
      state: "unconfigured"
    }
  ]
}

function mountAt(path: string) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/suites/:suiteId/*" element={<SettingsRoom />} />
        </Routes>
      </MemoryRouter>
    )
  })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

describe("SettingsRoom", () => {
  let mounted: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => TRADING_FIXTURE
    })))
  })

  afterEach(() => {
    mounted.forEach((m) => m.unmount())
    mounted = []
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it("renders the two per-ministry controls", () => {
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    expect(m.host.textContent).toContain("Autopilot mode")
    expect(m.host.textContent).toContain("Confidence threshold")
    expect(m.host.textContent).toContain("stored locally on this machine per ministry")
  })

  it("persists a mode flip to copilot via saveMinistrySettings", () => {
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    const toggle = m.host.querySelector("input[type=checkbox]") as HTMLInputElement | null
    expect(toggle).not.toBeNull()
    flushSync(() => {
      toggle!.click()
    })
    expect(getMinistrySettings("trading").mode).toBe("copilot")
  })

  it("renders the per-ministry integration registry table", async () => {
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    await vi.waitFor(() => expect(m.host.textContent).toContain("Twelve Data"), WAIT)
    expect(m.host.textContent).toContain("Binance Public API")
    expect(m.host.textContent).toContain("GDELT DOC 2.0")
    expect(m.host.textContent).toContain("Read-only info acquisition")
    expect(m.host.textContent).toContain("Unconfigured")
    expect(m.host.textContent).toContain("Key?")
    expect(m.host.textContent).toContain("PICC-as-a-country")
  })

  // ── WS-7 T18 / D17 — the "licensed and labeled" columns ────────────────────
  //
  // D17's obligation is that every news/sentiment datum carries its source AND
  // its retrieval mode. A room that shows a source name and a "No key" badge and
  // nothing else cannot satisfy that, so T18 added two columns to the table that
  // already existed rather than building a second configuration surface.
  //
  // These assertions drive the REAL shape the server derives, including a
  // configured source, so the "degraded — configured but never probed" rendering
  // is exercised rather than assumed.
  it("shows the D17 retrieval mode and licensed basis for a news source", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => NEWS_FIXTURE })))
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    await vi.waitFor(() => expect(m.host.textContent).toContain("licensed-feed"), WAIT)
    // Four modes, and PICC's own browser is one of them and says so.
    expect(m.host.textContent).toContain("picc-own-browser")
    expect(m.host.textContent).toContain("PICC's own headed/headless Chromium")
    // And the trust basis is a sentence, not a badge.
    expect(m.host.textContent).toContain("labeling obligations")
  })

  it("names the MISSING setting for an unconfigured news source", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => NEWS_FIXTURE })))
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    // Each absent source names the knob that is unset, so an operator learns
    // WHICH setting to change rather than only that something is missing. This is
    // T14's rule for notifications, applied to news sources.
    await vi.waitFor(() => expect(m.host.textContent).toContain('PICC_NEWS_GDELT is not "on"'), WAIT)
    await vi.waitFor(() => expect(m.host.textContent).toContain("NEWSAPI_API_KEY unset"), WAIT)
    await vi.waitFor(() => expect(m.host.textContent).toContain("CRYPTOPANIC_AUTH_TOKEN unset"), WAIT)
    await vi.waitFor(() => expect(m.host.textContent).toContain("PICC_NEWS_BROWSER_SOURCES unset"), WAIT)
    // And each says it is an absence, not a neutral.
    expect(m.host.textContent).toContain("not a neutral reading")
  })

  it("a configured news source says CONFIGURED BUT NEVER PROBED — never \"Connected\"", async () => {
    // Nothing in this tree has ever fetched a news source, so `connected` would
    // be a claim about a fetch nobody made. T5 established this for Serper's
    // badge; T18 applies the same rule to the D17 rows.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => NEWS_FIXTURE })))
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    await vi.waitFor(() => expect(m.host.textContent).toContain("configured by PICC_NEWS_FEEDS=set — never probed"), WAIT)
    const rss = m.host.querySelector('[data-integration="rss-atom"]')
    expect(rss?.textContent).toContain("Degraded")
    expect(rss?.textContent).not.toContain("Connected")
  })

  it("no news row renders an empty licensed-basis cell", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => NEWS_FIXTURE })))
    const m = mountAt("/suites/trading/settings")
    mounted.push(m)
    await vi.waitFor(() => expect(m.host.querySelector('[data-integration="gdelt"]')).not.toBeNull(), WAIT)
    for (const id of ["rss-atom", "gdelt", "newsapi", "cryptopanic", "picc-own-browser"]) {
      const cell = m.host.querySelector(`[data-integration="${id}"]`)
      expect(cell, `${id} row missing`).not.toBeNull()
      const cells = [...(cell!.querySelectorAll("td") ?? [])].map((c) => c.textContent?.trim() ?? "")
      expect(cells.length, `${id} row has the wrong column count`).toBe(8)
      expect(cells[6], `${id} has no retrieval mode`).toBeTruthy()
      expect(cells[7], `${id} has no licensed basis`).toBeTruthy()
    }
  })
})

// ── WS-7 T14 / D11 — the notifications section, and NOT ministry-gated ────────
//
// D11 (spec :187, :191) puts notification configuration in the general Settings
// room and requires it not to be ministry-specific. "Not ministry-specific" is a
// claim about the ROOM KEY, and the first version of this suite got it wrong in
// the most flattering way available: it mounted `SettingsRoom` under all three
// `suiteId` values and passed, which proved only that ONE component renders the
// section for three URL parameters.
//
// It does not. `settings` is THREE separate components - `SettingsRoom`
// (trading), `EarningsSettingsRoom` and `IntelligenceSettingsRoom` - which is
// exactly why the cross-room attribution guard
// (`ReadOnlyRoom.test.tsx:587`, "an audit that could name an affordance
// belonging to a DIFFERENT instance would be worse than no audit, because it
// would relocate the finding") requires each instance's affordance token to
// appear in that instance's OWN page file. That guard caught the false green, so
// this suite now mounts the real component per suite and pins that the three are
// genuinely three.
describe("SettingsRoom - D11: notification configuration is in the general room", () => {
  let mounted: Array<{ unmount: () => void }> = []

  const ROOM_FOR: Record<string, () => ReactElement> = {
    trading: () => <SettingsRoom />,
    earnings: () => <EarningsSettingsRoom />,
    intelligence: () => <IntelligenceSettingsRoom />
  }

  function mountRoom(path: string, element: ReactElement) {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    flushSync(() => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/suites/:suiteId/*" element={element} />
          </Routes>
        </MemoryRouter>
      )
    })
    const m = {
      host,
      root,
      unmount() {
        flushSync(() => { root.unmount() })
        document.body.removeChild(host)
      }
    }
    mounted.push(m)
    return m
  }

  /**
   * Answers every route the three settings rooms read. The health shape matters:
   * `ChannelsTab` (EarningsRooms.tsx:183-189) reads `health.providers[key]`, so
   * a bare `{ok:true}` there throws inside a render and fails the test for a
   * reason that has nothing to do with notifications.
   */
  function stubApi() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url)
        if (u.includes("/integrations")) return { ok: true, json: async () => TRADING_FIXTURE }
        if (u.includes("/api/health")) {
          return { ok: true, json: async () => ({ ok: true, providers: { btcpay: false, ewallet: false } }) }
        }
        if (u.includes("/api/notifications/status")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              prefs: { minConfidence: 65, leadMinutes: 3, windowMinutes: 15, channels: { inApp: true, webpush: true, webhook: true, telegram: true } },
              subscriptions: 0,
              channels: [
                { name: "inApp", configured: true, userEnabled: true },
                { name: "webpush", configured: false, userEnabled: true },
                { name: "webhook", configured: false, userEnabled: true },
                { name: "telegram", configured: false, userEnabled: true, reason: "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID unset" }
              ]
            })
          }
        }
        return { ok: true, json: async () => ({ ok: true }) }
      })
    )
  }

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    mounted.forEach((m) => m.unmount())
    mounted = []
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it("mounts three DISTINCT settings components, which is what makes the rows below meaningful", () => {
    // Without this, a future edit could point all three routes at one body and
    // the three per-suite rows would keep passing while testing the same thing
    // three times - which is precisely the mistake the first version of this
    // suite made.
    const types = [ROOM_FOR.trading().type, ROOM_FOR.earnings().type, ROOM_FOR.intelligence().type]
    expect(new Set(types).size, "the three settings rooms must be three components").toBe(3)
  })

  it.each(["trading", "earnings", "intelligence"])(
    "the %s settings room renders the notifications section",
    async (suiteId) => {
      stubApi()
      const m = mountRoom(`/suites/${suiteId}/settings`, ROOM_FOR[suiteId]())
      // Wait for the CHANNEL LIST, not the heading. The card's <h3> renders
      // synchronously while the status request is still in flight, so waiting on
      // the heading passes before any configuration exists.
      await vi.waitFor(() => expect(m.host.textContent).toContain("telegram"), WAIT)
      // Both D11 transports are offered as configuration, not one of them.
      expect(m.host.textContent).toContain("webpush")
      expect(m.host.textContent).toContain("Min consensus confidence")
      // The section is in a container of its own, so a reader (and an audit) can
      // find it without inferring it from the page's general shape.
      expect(m.host.querySelector('[data-room="notifications"]')).not.toBeNull()
    }
  )

  it("names the MISSING setting for an unconfigured transport, rather than saying 'not configured'", async () => {
    stubApi()
    const m = mountRoom("/suites/trading/settings", ROOM_FOR.trading())
    // The server's reason is surfaced verbatim, so the operator learns WHICH env
    // var to set. Before T14 the room rendered a bare "(not configured - set env
    // keys)", which named nothing.
    await vi.waitFor(
      () => expect(m.host.textContent).toContain("TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID unset"), WAIT
    )
  })

  it("an unreadable notification readout says so, and does not render a configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url)
        if (u.includes("/integrations")) return { ok: true, json: async () => TRADING_FIXTURE }
        if (u.includes("/api/health")) {
          return { ok: true, json: async () => ({ ok: true, providers: { btcpay: false, ewallet: false } }) }
        }
        if (u.includes("/api/notifications/status")) throw new Error("notifier unreachable")
        return { ok: true, json: async () => ({ ok: true }) }
      })
    )
    const m = mountRoom("/suites/trading/settings", ROOM_FOR.trading())
    await vi.waitFor(() => expect(m.host.textContent).toContain("could not be read"), WAIT)
    // "Nothing below is known" is the honest rendering; an empty settings panel
    // would read as a fresh install with nothing configured, which is a
    // different and false claim.
    expect(m.host.textContent).toContain("Nothing below is known")
    expect(m.host.textContent).not.toContain("Min consensus confidence")
  })

  it("a test send renders the SERVER's per-transport outcome, never a bare success", async () => {
    // T14's substantive UI change: the card used to say "Test dispatched - check
    // bell/push." the moment the POST resolved, which is a claim about the HTTP
    // call and not about delivery. It now renders the record.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url)
        if (u.includes("/integrations")) return { ok: true, json: async () => TRADING_FIXTURE }
        if (u.includes("/api/health")) {
          return { ok: true, json: async () => ({ ok: true, providers: { btcpay: false, ewallet: false } }) }
        }
        if (u.includes("/api/notifications/test")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              record: {
                results: {
                  inApp: { state: "delivered", reason: null, attempted: 1, acknowledged: 1 },
                  webpush: { state: "failed", reason: "web-push 500: service exploded", attempted: 1, acknowledged: 0 },
                  telegram: { state: "unavailable", reason: "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID unset", attempted: 0, acknowledged: 0 }
                },
                delivery: {
                  readoutObtained: true,
                  delivered: [{ transport: "inApp", acknowledged: 1 }],
                  unavailable: [{ transport: "telegram", reason: "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID unset" }],
                  failed: [{ transport: "webpush", reason: "web-push 500: service exploded", attempted: 1 }],
                  off: [],
                  deliveredAny: true
                }
              }
            })
          }
        }
        if (u.includes("/api/notifications/status")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              prefs: { minConfidence: 65, leadMinutes: 3, windowMinutes: 15, channels: {} },
              subscriptions: 0,
              channels: [{ name: "inApp", configured: true, userEnabled: true }]
            })
          }
        }
        return { ok: true, json: async () => ({ ok: true }) }
      })
    )
    const m = mountRoom("/suites/trading/settings", ROOM_FOR.trading())
    // The button only exists once the status has loaded, so wait for the BUTTON
    // rather than the heading - clicking before the load lands finds no button.
    await vi.waitFor(
      () => expect([...m.host.querySelectorAll("button")].some((b) => b.textContent === "Send test")).toBe(true),
      WAIT
    )
    const sendTest = [...m.host.querySelectorAll("button")].find((b) => b.textContent === "Send test")!
    flushSync(() => {
      sendTest!.click()
    })
    await vi.waitFor(
      () => expect(m.host.querySelector("[data-notification-delivery]")).not.toBeNull(), WAIT
    )
    // The partial outcome is stated: in-app delivered AND webpush failed.
    const delivery = m.host.querySelector("[data-notification-delivery]")!
    expect(delivery.textContent).toContain("Delivered on inApp")
    expect(delivery.textContent).toContain("webpush: web-push 500: service exploded")
    expect(delivery.textContent).toContain("telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID unset")
    // The per-transport table names each one, so `failed` cannot be read as
    // `unavailable` on screen.
    expect(m.host.querySelector('[data-transport="webpush"]')?.textContent).toContain("failed")
    expect(m.host.querySelector('[data-transport="telegram"]')?.textContent).toContain("unavailable")
    // And the old unconditional claim is gone.
    expect(m.host.textContent).not.toContain("Test dispatched")
  })
})
