// WS-7 T14 - the two transports, the explicit-failure contract, and the BISECT
// LINE from spec :1325: "Either transport can be disabled without affecting the
// other or the trading path."
//
// AC-037 (spec :1061-1066) is the scenario: "An alert fires and one transport is
// unreachable ... The reachable transport delivers ... the failure is explicit."
// That is reproduced here literally, and then generalised into the THREE-WAY
// independence the bisect line asks for. One direction is not enough: a suite
// that only proves "telegram off does not break webpush" would still pass if
// webpush had become a hard dependency of telegram.
//
// Nothing here reaches the network. `web-push` is mocked at the module boundary
// and Telegram's HTTP call is driven through an injected `fetchImpl`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DELIVERY_STATES, describeSummary } from "../services/notifications/states.mjs"
import { sendTelegram, telegramConfigStatus } from "../services/notifications/telegram.mjs"

// ── web-push is driven PER SUBSCRIPTION, so a test can fail one of several ───
// `mode` is either a global behaviour or a map from endpoint substring to
// behaviour, which is what makes a PARTIAL outage expressible: one subscription
// gone (410, pruned) while another is refused (500, retained).
const { pushBehaviour } = vi.hoisted(() => ({ pushBehaviour: { mode: "ok" } }))

function pushOutcomeFor(sub) {
  const mode = typeof pushBehaviour.mode === "object"
    ? Object.entries(pushBehaviour.mode).find(([k]) => String(sub?.endpoint ?? "").includes(k))?.[1]
    : pushBehaviour.mode
  if (mode === "throw-500") {
    const err = new Error("push service exploded")
    err.statusCode = 500
    throw err
  }
  if (mode === "gone") {
    const err = new Error("subscription gone")
    err.statusCode = 410
    throw err
  }
  return { statusCode: 201 }
}

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub, _body) => pushOutcomeFor(sub)
  }
}))

let tmp
let notifier

const VAPID_ENV = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]
const TELEGRAM_ENV = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]

function clearEnv(keys) {
  for (const k of keys) delete process.env[k]
}
function setEnv(pairs) {
  for (const [k, v] of Object.entries(pairs)) process.env[k] = v
}
const alert = (assetId = "BTCUSD") => ({ kind: "TEST", assetId, title: "t", body: "b" })

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-t14-"))
  process.env.PICC_NOTIFICATION_DATA_DIR = tmp
  clearEnv([...VAPID_ENV, ...TELEGRAM_ENV, "WEBHOOK_URL"])
  notifier = await import("../services/notifier.mjs")
})

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 80))
  delete process.env.PICC_NOTIFICATION_DATA_DIR
  rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  pushBehaviour.mode = "ok"
  clearEnv([...VAPID_ENV, ...TELEGRAM_ENV, "WEBHOOK_URL"])
  notifier.setPrefs({ channels: { inApp: true, webpush: true, webhook: true, telegram: true } })
})

afterEach(() => {
  clearEnv([...VAPID_ENV, ...TELEGRAM_ENV])
  pushBehaviour.mode = "ok"
  for (const sub of notifier.listPushSubscriptionEndpoints()) {
    notifier.removePushSubscription(sub)
  }
})

/**
 * A fetch double for Telegram. The double exposes `json()` DIRECTLY, because
 * that is what a WHATWG `Response` does - the first version of this helper
 * nested it under `.body`, which made the transport record a bare `http 401`
 * with no Telegram `description` and a 200 response look unacknowledged. Both
 * were real defects in the reading, caught here rather than in production.
 */
function telegramFetch(mode) {
  const calls = []
  const reply = (ok, status, payload) => ({ ok, status, json: async () => payload })
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    if (mode === "throw") throw new Error("getaddrinfo ENOTFOUND api.telegram.org")
    if (mode === "401") return reply(false, 401, { ok: false, description: "Unauthorized" })
    if (mode === "ok-false-body") return reply(true, 200, { ok: false, description: "chat not found" })
    return reply(true, 200, { ok: true, result: { message_id: 1 } })
  }
  impl.calls = calls
  return impl
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-037: one transport unreachable, the other delivers, the failure is explicit
// ═══════════════════════════════════════════════════════════════════════════
describe("AC-037 - one transport unreachable, the reachable one delivers, the failure is explicit", () => {
  it("Telegram refuses (401) while WebPush delivers: both facts are in the same record", async () => {
    setEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })
    notifier.addPushSubscription({ endpoint: "https://push.example/ac037" })
    setEnv({ TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_CHAT_ID: "42" })
    const origFetch = globalThis.fetch
    globalThis.fetch = telegramFetch("401")
    try {
      const rec = await notifier.dispatchAlert(alert("AC037"))
      // The REACHABLE transport delivered - and the acknowledgement is counted.
      expect(rec.results.webpush.state).toBe(DELIVERY_STATES.DELIVERED)
      expect(rec.results.webpush.acknowledged).toBe(1)
      // The UNREACHABLE transport is FAILED, named, and not dressed up as
      // "not configured" - that conflation is what this task removed.
      expect(rec.results.telegram.state).toBe(DELIVERY_STATES.FAILED)
      expect(rec.results.telegram.reason).toMatch(/401/)
      expect(rec.results.telegram.reason).toMatch(/Unauthorized/)
      // The derived claim is true because something WAS acknowledged, AND the
      // room's sentence names the failure alongside the delivery. The in-app
      // bell also succeeded, so the delivered set has two members.
      expect(rec.delivery.deliveredAny).toBe(true)
      expect(rec.delivery.delivered.map((d) => d.transport).sort()).toEqual(["inApp", "webpush"])
      expect(rec.delivery.failed.map((f) => f.transport)).toEqual(["telegram"])
      const said = describeSummary(rec.delivery)
      expect(said).toMatch(/webpush/)
      expect(said).toMatch(/telegram: telegram 401: Unauthorized/)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it("Telegram unreachable by DNS while WebPush delivers - a throw is a FAILURE, not a skip", async () => {
    setEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })
    notifier.addPushSubscription({ endpoint: "https://push.example/dns" })
    setEnv({ TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_CHAT_ID: "42" })
    const origFetch = globalThis.fetch
    globalThis.fetch = telegramFetch("throw")
    try {
      const rec = await notifier.dispatchAlert(alert("DNS"))
      expect(rec.results.telegram.state).toBe(DELIVERY_STATES.FAILED)
      expect(rec.results.telegram.reason).toMatch(/unreachable/)
      expect(rec.results.webpush.state).toBe(DELIVERY_STATES.DELIVERED)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it("a 200 whose body says ok:false is NOT counted as a delivery", async () => {
    setEnv({ TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_CHAT_ID: "42" })
    const outcome = await sendTelegram({ kind: "T", assetId: "X", title: "t", body: "b" }, { fetchImpl: telegramFetch("ok-false-body") })
    expect(outcome.state).toBe(DELIVERY_STATES.FAILED)
    expect(outcome.acknowledged).toBe(0)
    expect(outcome.attempted).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE DEFECT THIS TASK FIXES: a total push outage was filed as "not configured"
// ═══════════════════════════════════════════════════════════════════════════
describe("a configured transport that fails every send is FAILED, never unavailable", () => {
  it("WebPush with a live subscription and a 500 from the push service reads FAILED", async () => {
    // This is the exact case the old build lost. It caught the error, discarded
    // it unless it was 404/410, and returned `delivered > 0` === false, which
    // the dispatcher recorded as `skipped` and the room rendered as "Web push
    // is not configured on this server (no VAPID keys) - nothing will be sent."
    // The keys WERE set and a send WAS attempted. D11 (spec :191) requires the
    // opposite of that rendering.
    setEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })
    notifier.addPushSubscription({ endpoint: "https://push.example/outage" })
    pushBehaviour.mode = "throw-500"
    const rec = await notifier.dispatchAlert(alert("OUTAGE"))
    expect(rec.results.webpush.state).toBe(DELIVERY_STATES.FAILED)
    expect(rec.results.webpush.state).not.toBe(DELIVERY_STATES.UNAVAILABLE)
    expect(rec.results.webpush.attempted).toBe(1)
    expect(rec.results.webpush.acknowledged).toBe(0)
    expect(rec.results.webpush.reason).toMatch(/500/)
    // The summary agrees for THIS transport. `deliveredAny` is a whole-record
    // claim and the in-app bell legitimately still delivered, so the assertion
    // is that webpush is absent from the delivered bucket - not that nothing
    // was delivered anywhere.
    expect(rec.delivery.delivered.map((d) => d.transport)).not.toContain("webpush")
    expect(rec.delivery.failed.map((f) => f.transport)).toContain("webpush")
    expect(describeSummary(rec.delivery)).toMatch(/webpush: web-push 500/)
  })

  it("the three web-push situations are now three DIFFERENT reported states", async () => {
    // (a) no keys at all
    const noKeys = await notifier.dispatchAlert(alert("NOKEY"))
    expect(noKeys.results.webpush.state).toBe(DELIVERY_STATES.UNAVAILABLE)
    expect(noKeys.results.webpush.reason).toMatch(/unset/)

    // (b) keys present, nobody subscribed
    setEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })
    const noSubs = await notifier.dispatchAlert(alert("NOSUB"))
    expect(noSubs.results.webpush.state).toBe(DELIVERY_STATES.UNAVAILABLE)
    expect(noSubs.results.webpush.reason).toBe("no-subscriptions")

    // (c) keys present, subscribed, and the service refuses
    notifier.addPushSubscription({ endpoint: "https://push.example/three" })
    pushBehaviour.mode = "throw-500"
    const refused = await notifier.dispatchAlert(alert("REFUSED"))
    expect(refused.results.webpush.state).toBe(DELIVERY_STATES.FAILED)
  })

  it("a partial outage is reported as failed with the PRE-prune attempt count", async () => {
    setEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })
    notifier.addPushSubscription({ endpoint: "https://push.example/doomed" })
    notifier.addPushSubscription({ endpoint: "https://push.example/stubborn" })
    // The first subscription is gone (410, pruned); the second is refused
    // (500, retained and REPORTED). One of the two failing is still a failure.
    pushBehaviour.mode = { doomed: "gone", stubborn: "throw-500" }
    const rec = await notifier.dispatchAlert(alert("PARTIAL"))
    // Both sends were really made, so `attempted` is the pre-prune count -
    // reporting the post-prune number would hide that a send was attempted.
    expect(rec.results.webpush.attempted).toBe(2)
    expect(rec.results.webpush.acknowledged).toBe(0)
    expect(rec.results.webpush.state).toBe(DELIVERY_STATES.FAILED)
    expect(rec.results.webpush.reason).toMatch(/500/)
    // The 410 was pruned as a dead subscription; the 500 was NOT silently
    // dropped along with it, which is the half that used to disappear.
    expect(notifier.listPushSubscriptionEndpoints()).toEqual(["https://push.example/stubborn"])
  })

  it("a run where every send returns 410 is a PRUNE, not a failure", async () => {
    // Every send was answered "this subscription is gone" - the push service
    // working correctly, with nothing left to send to. The transport is live,
    // so calling that `unavailable` is right and calling it `failed` would
    // report an outage that did not happen.
    setEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })
    notifier.addPushSubscription({ endpoint: "https://push.example/allgone" })
    pushBehaviour.mode = "gone"
    const rec = await notifier.dispatchAlert(alert("ALLGONE"))
    expect(rec.results.webpush.attempted).toBe(1)
    expect(notifier.listPushSubscriptionEndpoints()).toEqual([])
    // No recipient remains, so the next dispatch is a named absence.
    const next = await notifier.dispatchAlert(alert("ALLGONE2"))
    expect(next.results.webpush.state).toBe(DELIVERY_STATES.UNAVAILABLE)
    expect(next.results.webpush.reason).toBe("no-subscriptions")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE BISECT LINE, spec :1325 - three directions, not one
// ═══════════════════════════════════════════════════════════════════════════
describe("either transport can be disabled without affecting the other or the trading path", () => {
  beforeEach(() => {
    setEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })
    notifier.addPushSubscription({ endpoint: "https://push.example/independence" })
  })

  it("DIRECTION 1 - Telegram off leaves WebPush delivering and the dispatch intact", async () => {
    notifier.setPrefs({ channels: { telegram: false } })
    setEnv({ TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_CHAT_ID: "42" })
    // Even with Telegram fully configured, the operator's off wins and no
    // network call is made for it.
    const origFetch = globalThis.fetch
    let telegramCalled = 0
    globalThis.fetch = async () => {
      telegramCalled++
      return { ok: true, status: 200, body: { json: async () => ({ ok: true }) } }
    }
    try {
      const rec = await notifier.dispatchAlert(alert("DIR1"))
      expect(rec.results.telegram.state).toBe(DELIVERY_STATES.OFF)
      expect(rec.results.webpush.state).toBe(DELIVERY_STATES.DELIVERED)
      expect(rec.results.webpush.acknowledged).toBe(1)
      // "Unaffected" means not merely "did not crash": the OTHER transport did
      // its work, and the disabled one was not even attempted.
      expect(rec.delivery.delivered.map((d) => d.transport)).toContain("webpush")
      expect(rec.delivery.delivered.map((d) => d.transport)).not.toContain("telegram")
      expect(rec.delivery.off).toEqual(["telegram"])
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it("DIRECTION 2 - WebPush off leaves Telegram delivering and the dispatch intact", async () => {
    setEnv({ TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_CHAT_ID: "42" })
    notifier.setPrefs({ channels: { webpush: false } })
    const origFetch = globalThis.fetch
    const fx = telegramFetch("ok")
    globalThis.fetch = fx
    try {
      const rec = await notifier.dispatchAlert(alert("DIR2"))
      expect(rec.results.webpush.state).toBe(DELIVERY_STATES.OFF)
      expect(rec.results.telegram.state).toBe(DELIVERY_STATES.DELIVERED)
      expect(fx.calls).toHaveLength(1)
      expect(fx.calls[0].body.chat_id).toBe("42")
      expect(rec.delivery.off).toEqual(["webpush"])
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it("DIRECTION 2b - a BROKEN WebPush leaves Telegram delivering", async () => {
    // Direction 2 under fault rather than under a clean toggle. Both of these
    // are "WebPush cannot deliver"; neither may stop Telegram.
    setEnv({ TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_CHAT_ID: "42" })
    pushBehaviour.mode = "throw-500"
    const origFetch = globalThis.fetch
    const fx = telegramFetch("ok")
    globalThis.fetch = fx
    try {
      const rec = await notifier.dispatchAlert(alert("DIR2B"))
      expect(rec.results.webpush.state).toBe(DELIVERY_STATES.FAILED)
      expect(rec.results.telegram.state).toBe(DELIVERY_STATES.DELIVERED)
      expect(fx.calls).toHaveLength(1)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it("DIRECTION 3 - BOTH off leaves the trading path's in-app alert working", async () => {
    notifier.setPrefs({ channels: { telegram: false, webpush: false } })
    const rec = await notifier.dispatchAlert(alert("DIR3"))
    // The trading path's own advisory alert (the in-app bell) still fires. This
    // is the direction a one-direction test would miss: if a shared registry
    // entry had been made to gate on "some transport is on", this would be the
    // assertion that catches it.
    expect(rec.results.telegram.state).toBe(DELIVERY_STATES.OFF)
    expect(rec.results.webpush.state).toBe(DELIVERY_STATES.OFF)
    expect(rec.results.inApp.state).toBe(DELIVERY_STATES.DELIVERED)
    // The record is still produced and still persisted - a dispatch with every
    // push transport off is a normal, recorded event, not a failure.
    expect(rec.delivery.deliveredAny).toBe(true)
    expect(rec.ts).toBeTruthy()
    expect(notifier.notifierStatus().recent[0].assetId).toBe("DIR3")
  })

  it("the trading path is structurally unreachable FROM a notification failure", () => {
    // "The trading path" is asserted as a MODULE GRAPH fact, not as a hope: the
    // notifier holds no static import of any broker, order, venue or execution
    // module, so a notification failure has no import edge along which to
    // propagate into order handling. Measured from the source rather than
    // asserted in prose, so a future import would fail this test.
    const src = readFileSync(new URL("../services/notifier.mjs", import.meta.url), "utf8")
    const staticImports = [...src.matchAll(/^\s*import\s+(?!.*\bfrom\b)([\s\S]*?)from\s+["']([^"']+)["']/gm)].map(
      (m) => m[2]
    )
    const relative = staticImports.filter((s) => s.startsWith("."))
    expect(relative.length).toBeGreaterThan(0)
    const orderish = relative.filter((s) =>
      /broker|order|venue|execution|trading|hyperliquid|ccxt|authority|copilot/i.test(s)
    )
    expect(orderish, "the notifier must not statically import the trading path").toEqual([])
  })

  it("one transport THROWING does not prevent the others from running", async () => {
    // The independence property under fault, not just under a clean toggle: the
    // dispatch loop catches per channel, so a transport that escapes its own
    // error handling is still only its own failure.
    setEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })
    notifier.addPushSubscription({ endpoint: "https://push.example/throw-isolation" })
    setEnv({ TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_CHAT_ID: "42" })
    const origFetch = globalThis.fetch
    globalThis.fetch = telegramFetch("throw")
    try {
      const rec = await notifier.dispatchAlert(alert("THROWISO"))
      expect(rec.results.telegram.state).toBe(DELIVERY_STATES.FAILED)
      expect(rec.results.webpush.state).toBe(DELIVERY_STATES.DELIVERED)
      expect(rec.results.inApp.state).toBe(DELIVERY_STATES.DELIVERED)
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// D11: no secret in a client-side field
// ═══════════════════════════════════════════════════════════════════════════
describe("the Telegram credential never leaves the server", () => {
  it("telegramConfigStatus names the MISSING keys and never their values", () => {
    const none = telegramConfigStatus({})
    expect(none.configured).toBe(false)
    expect(none.reason).toBe("TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID unset")
    expect(none.reason).not.toMatch(/=/)

    const tokenOnly = telegramConfigStatus({ TELEGRAM_BOT_TOKEN: "super-secret" })
    expect(tokenOnly.configured).toBe(false)
    expect(tokenOnly.reason).toBe("TELEGRAM_CHAT_ID unset")
    // The one env var that IS set must not appear anywhere in the status.
    expect(JSON.stringify(tokenOnly)).not.toContain("super-secret")

    const both = telegramConfigStatus({ TELEGRAM_BOT_TOKEN: "super-secret", TELEGRAM_CHAT_ID: "42" })
    expect(both.configured).toBe(true)
    expect(both.reason).toBeNull()
  })

  it("notifierStatus serialises to JSON with no credential in it", async () => {
    setEnv({ TELEGRAM_BOT_TOKEN: "super-secret-token", TELEGRAM_CHAT_ID: "4242" })
    const st = notifier.notifierStatus()
    const telegram = st.channels.find((c) => c.name === "telegram")
    expect(telegram.configured).toBe(true)
    expect(telegram.userEnabled).toBe(true)
    // A configured channel carries no `reason` key at all - absence, not "".
    expect("reason" in telegram).toBe(false)
    const wire = JSON.stringify(st)
    expect(wire).not.toContain("super-secret-token")
  })

  it("an unconfigured telegram channel reports the reason, and a DISABLED one does not", () => {
    clearEnv(TELEGRAM_ENV)
    const unconfigured = notifier.notifierStatus().channels.find((c) => c.name === "telegram")
    expect(unconfigured.configured).toBe(false)
    expect(unconfigured.reason).toBe("TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID unset")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Legacy persisted records migrate, and say what they cannot say
// ═══════════════════════════════════════════════════════════════════════════
describe("a persisted record from before T14 migrates without inventing a cause", () => {
  it("`skipped` migrates to unavailable and NAMES the ambiguity it cannot resolve", async () => {
    const path = join(tmp, "notifications.json")
    // LET THE DEBOUNCED PERSIST SETTLE FIRST. `notifier.persist()` is debounced
    // 50ms and RE-ARMS on every call, so a write queued by an earlier test in
    // this file can land AFTER the legacy fixture is written and overwrite it -
    // which is how this test failed intermittently under a loaded parallel run
    // while passing in isolation. `notifier.test.mjs` settles the same way in its
    // afterAll for the same reason; here it has to happen BEFORE the write, not
    // after the file, because the write is the thing being clobbered.
    await new Promise((r) => setTimeout(r, 120))
    const legacy = JSON.stringify({
      prefs: { minConfidence: 65, leadMinutes: 3, windowMinutes: 15, channels: { inApp: true, webpush: true, webhook: true } },
      subscriptions: [],
      // A pre-T14 record: bare strings, and a sibling error key.
      recent: [{
        ts: new Date().toISOString(),
        kind: "TEST",
        assetId: "LEGACY",
        title: "t",
        body: "b",
        results: { inApp: "sent", webpush: "skipped", webhook: "failed" },
        webhookError: "webhook 503"
      }],
      snoozes: {}
    })
    writeFileSync(join(tmp, "notifications.json"), legacy)
    vi.resetModules()
    try {
      const fresh = await import("../services/notifier.mjs?t14-legacy=1")
      const rec = fresh.notifierStatus().recent[0]
      expect(rec.results.inApp.state).toBe(DELIVERY_STATES.DELIVERED)
      // `skipped` meant BOTH unconfigured and all-sends-failed, and the record
      // cannot say which. It migrates to `unavailable` with the ambiguity NAMED -
      // not to `failed`, which would invent an observed failure.
      expect(rec.results.webpush.state).toBe(DELIVERY_STATES.UNAVAILABLE)
      expect(rec.results.webpush.reason).toMatch(/ambiguous|could-mean/)
      // `failed` was unambiguous, and its sibling error key became the reason.
      expect(rec.results.webhook.state).toBe(DELIVERY_STATES.FAILED)
      expect(rec.results.webhook.reason).toBe("webhook 503")
      // The sibling keys are gone: one place to read a reason from.
      expect(rec.webhookError).toBeUndefined()
      // The new channel key is merged in by the defaults, as `webhook` was.
      expect(fresh.getPrefs().channels.telegram).toBe(true)
    } finally {
      vi.resetModules()
      // Put a clean state file back for whatever runs after this suite.
      writeFileSync(
        join(tmp, "notifications.json"),
        JSON.stringify({ prefs: { channels: { inApp: true, webpush: true, webhook: true, telegram: true } }, subscriptions: [], recent: [], snoozes: {} })
      )
    }
  })
})
