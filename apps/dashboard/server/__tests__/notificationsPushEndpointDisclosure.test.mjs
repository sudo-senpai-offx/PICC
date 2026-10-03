// WS-7 pre-push review — FINDING 1, the two halves of it, asserted at the HTTP
// boundary. This is the file the finding asked for: the previous coverage proved
// only the POSITIVE path, which is how an anonymous reader got every subscribed
// device's push endpoint URL through a route nobody had gated.
//
// WHAT THE PROBE FOUND, reproduced here so the test and the finding cannot drift:
// with one account seeded and one push subscription stored, an anonymous
// non-loopback `GET /api/notifications/status` answered 200 with
//
//   "subscriptionEndpoints": ["https://fcm.googleapis.com/fcm/send/<id>?auth_token=<tok>"]
//
// That is a provider reveal plus a stable per-browser registration identifier, and
// the route is pollable, so a device being added or removed is observable. The
// `p256dh`/`auth` keys were never in that payload (only `.endpoint` is mapped), so
// this was an identifier disclosure and not a takeover — a host plus a path is
// still identifying, so a "redacted" endpoint would not have been a fix either.
//
// THE HARNESS DETAIL THAT MAKES ANY OF IT MEAN ANYTHING, carried from
// `t20rRouteAuthGates.test.mjs` verbatim because it is the whole difference
// between a real test and a green one:
//
//   * NO `socket` on the request. `requireAuth` admits a request outright when
//     `isLocalhostRequest(req)` is true, and that predicate reads the real TCP
//     peer, so a harness that supplies `socket: { remoteAddress: "127.0.0.1" }`
//     puts the "anonymous" caller INSIDE the trust boundary and every 401
//     assertion fails for the wrong reason.
//   * A SEEDED USER. With an empty user store `requireAuth` takes its first-run
//     bootstrap branch and admits everyone.
//
// Hermetic: every store is redirected through the SHARED `useIsolatedStoreDir`
// helper, never by assigning `process.env` — `ws7TestStoreIsolation.test.mjs`
// enumerates the suite via `git ls-files` and refuses a hand-rolled assignment.
// Nothing here resolves to the real `apps/dashboard/server/data/`.
//
// LATER RULING, WHICH CHANGED THIS FILE'S PREMISE — recorded here because the first
// version of block 1 below asserted that `/api/notifications/status` stays PUBLIC
// ("gating it would be a different decision"). The owner has since made that decision:
// `GET /api/notifications/status` is one of the 24 routes now gated with requireAuth.
// The finding's security property is therefore STRENGTHENED, not traded away — an
// anonymous caller now receives no endpoint URL, no push key, and in fact no payload
// at all. The block was re-pointed rather than deleted: the anonymous half asserts
// 401-with-no-leak, and the payload-shape half now runs WITH a session, which is
// where the field move has to still hold (the status branch must not read the
// endpoint list even for a caller who is allowed to read it).
// `routeAuthRuling24Gates.test.mjs` is where the 24 gates are enumerated; this file
// stays the place that pins what the payload must never contain.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const TOKEN = "c".repeat(64)
const USER_ROW = { id: "u1", email: "push-endpoints@example.test", name: "PE", salt: "s", passwordHash: "h", createdAt: 1 }

/** The reviewer's own probe payload, secret-bearing shape and all. */
const SECRET_ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123SECRETPATHDEF456?auth_token=OPAQUE-TOKEN-789"
const SECRET_P256DH = "P256DH-SECRET-VALUE"
const SECRET_AUTH = "AUTH-SECRET-VALUE"

const VAPID_PUBLIC = "BFakeVapidPublicKeyForTheDisclosureTest0000000000"

// ── harness ─────────────────────────────────────────────────────────────────

function makeReq(method, url, body, headers = {}) {
  const raw = body === null || body === undefined ? null : JSON.stringify(body)
  return {
    method,
    url,
    // NO `socket` — see the file header. This is what makes the caller remote.
    headers: { host: "picc.example.test", "content-type": "application/json", ...headers },
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
      if (evt === "end") cb()
    }
  }
}

function makeRes() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    }
  }
}

async function call(handleApi, method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

let dirs = []

function redirect(name, prefix) {
  const dir = useIsolatedStoreDir(name, { prefix })
  dirs.push(dir)
  return dir
}

function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value), "utf8")
}

/** Every store a route under test might touch, redirected before handlers loads. */
function redirectAll() {
  for (const [name, prefix] of [
    ["PICC_AUTH_DATA_DIR", "pushdisc-auth"],
    ["PICC_NOTIFICATION_DATA_DIR", "pushdisc-notify"],
    ["PICC_TRADING_DATA_DIR", "pushdisc-trading"],
    ["PICC_DATA_DIR", "pushdisc-data"],
    ["PICC_ALERTS_DATA_DIR", "pushdisc-alerts"],
    ["PICC_WATCHLIST_DATA_DIR", "pushdisc-watchlist"],
    ["PICC_JOURNAL_DATA_DIR", "pushdisc-journal"],
    ["PICC_PROFILE_DATA_DIR", "pushdisc-profile"]
  ]) {
    redirect(name, prefix)
  }
}

/** Seed ONE account, so requireAuth enforces rather than taking its first-run branch. */
function seedUser(authDir) {
  writeJson(authDir, "sessions.json", { sessions: {} })
  writeJson(authDir, "users.json", { users: [USER_ROW] })
}

/** Seed one account AND a live session carrying TOKEN. */
function seedSession(authDir) {
  seedUser(authDir)
  writeJson(authDir, "sessions.json", {
    sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } }
  })
}

/** One stored web-push subscription, so the endpoint list is non-empty. */
function seedSubscription(notifyDir) {
  writeJson(notifyDir, "notifications.json", {
    prefs: { minConfidence: 65, leadMinutes: 3, windowMinutes: 15, channels: { inApp: true, webpush: true, webhook: true, telegram: true } },
    subscriptions: [{ endpoint: SECRET_ENDPOINT, keys: { p256dh: SECRET_P256DH, auth: SECRET_AUTH } }],
    recent: [],
    snoozes: {}
  })
}

const HANDLERS_QUERY = "?ws7-push-endpoint-disclosure"
async function loadHandlers() {
  vi.resetModules()
  const { handleApi } = await import("../handlers.mjs" + HANDLERS_QUERY)
  return handleApi
}

/** Every assertion below is about the ABSENCE of these strings in a body. */
function expectNoEndpointLeak(text, what) {
  for (const marker of [
    SECRET_ENDPOINT,
    "abc123SECRETPATHDEF456",
    "OPAQUE-TOKEN-789",
    "fcm.googleapis.com",
    "/fcm/send/",
    SECRET_P256DH,
    SECRET_AUTH
  ]) {
    expect(text, `${marker} must not reach an anonymous caller via ${what}`).not.toContain(marker)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE NEGATIVE — the GATED status read discloses no push endpoint to anyone
//    who has not proved a session, and carries no endpoint field even to one who has
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 finding 1 — the now-gated notification status discloses no push endpoint", () => {
  let authDir
  let notifyDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
    notifyDir = dirs[1]
    seedUser(authDir)
    seedSubscription(notifyDir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  it("an anonymous GET /api/notifications/status returns 401 and no endpoint URL and no push key", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/notifications/status")

    // The route is GATED by the owner's later ruling. So the assertion is BOTH halves:
    // the status is a refusal, AND the refusal leaks nothing. The leak check stays,
    // because a gate is a placement and the branch behind it still has to be free of
    // the field — proving that only for the 401 body would let a leak through the
    // gate with a red test nowhere, which is the shape of rot this file exists to catch.
    expect(res.status, `expected the gated 401, got ${JSON.stringify(res.body)}`).toBe(401)
    expect(res.body?.ok, "a refusal must never report success").not.toBe(true)
    expectNoEndpointLeak(JSON.stringify(res.body ?? {}), "an anonymous GET /api/notifications/status")
  })

  it("the status branch does not even CARRY the field an absent leak would hide in — for a SESSION either", async () => {
    // The string assertion above is the one that matters; this one names the
    // structural fact, so a future field rename cannot make the first vacuous by
    // accident. Run WITH a session, because on a 401 body `subscriptionEndpoints`
    // is trivially absent and would assert nothing about the branch.
    seedSession(authDir)
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/notifications/status", null, {
      authorization: `Bearer ${TOKEN}`
    })
    expect(res.status, `the session was refused: ${JSON.stringify(res.body)}`).toBe(200)
    expect(Object.keys(res.body ?? {})).not.toContain("subscriptionEndpoints")
    expectNoEndpointLeak(JSON.stringify(res.body ?? {}), "a SESSION read of /api/notifications/status")
  })

  it("the status read still answers what it always did — the channel table and the count", async () => {
    // The other half of a field move: the count is the honest fallback the room
    // renders, so dropping the list must not have cost the caller the count. And the
    // other half of the gate: a gate that emptied the payload would be a regression
    // the negative assertions above would happily pass, so the 200 is asserted here.
    seedSession(authDir)
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/notifications/status", null, {
      authorization: `Bearer ${TOKEN}`
    })

    expect(res.status, `expected 200 for a session, got ${JSON.stringify(res.body)}`).toBe(200)
    expect(res.body?.ok).toBe(true)
    expect(res.body?.subscriptions, "the bare count must survive the move").toBe(1)
    expect(Array.isArray(res.body?.prefs)).toBe(false)
    expect(typeof res.body?.prefs?.minConfidence).toBe("number")
    expect(Array.isArray(res.body?.channels)).toBe(true)
    expect(res.body.channels.map((c) => c.name)).toContain("webpush")
  })

  it("the status branch does not call listPushSubscriptionEndpoints at all", async () => {
    // A static backstop, because a string assertion is satisfied by any route
    // that happens not to be reached with that value today. The whole status
    // branch is read here, so a re-added call is caught even before a value exists
    // to leak.
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    const lines = src.split("\n")
    const start = lines.findIndex((l) => l.includes('path === "/api/notifications/status"'))
    expect(start, "the status branch must still exist").toBeGreaterThan(-1)
    const end = lines.findIndex((l, i) => i > start && /^\s{6}\}/.test(l))
    const branch = lines.slice(start, end === -1 ? start + 8 : end).join("\n")
    expect(branch, "the status branch must not read the endpoint list").not.toContain(
      "listPushSubscriptionEndpoints"
    )
  })

  it("the status branch carries requireAuth as the FIRST statement, now that it is gated", async () => {
    // Same reason `push-endpoints` has this assertion: a gate after a precondition is
    // dead code, and `ws7RouteAuthCoverageGuard` reads that statically. Asserted at
    // runtime-adjacent scope too so the static scan and this file cannot disagree.
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    const lines = src.split("\n")
    const start = lines.findIndex((l) => l.includes('path === "/api/notifications/status"'))
    const branch = lines.slice(start, start + 4).join("\n")
    expect(branch).toMatch(/requireAuth\(req, res\)/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE NEGATIVE — the new sibling refuses an anonymous caller
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 finding 1 — /api/notifications/push-endpoints is gated", () => {
  let authDir
  let notifyDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
    notifyDir = dirs[1]
    seedUser(authDir)
    seedSubscription(notifyDir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  it("refuses an anonymous caller with 401 and leaks nothing in the refusal", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/notifications/push-endpoints")

    expect(res.status, `expected 401, got ${JSON.stringify(res.body)}`).toBe(401)
    expect(res.body?.ok, "a refusal must never report success").not.toBe(true)
    expectNoEndpointLeak(JSON.stringify(res.body ?? {}), "a 401 from push-endpoints")
  })

  it("carries requireAuth as the FIRST statement of its own branch", async () => {
    // A gate placed after a precondition is dead code, and `ws7RouteAuthCoverageGuard`
    // reads that statically; asserting it here as well means the runtime refusal
    // above and the static scan cannot disagree.
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    const lines = src.split("\n")
    const start = lines.findIndex((l) => l.includes('path === "/api/notifications/push-endpoints"'))
    expect(start, "the gated sibling must exist").toBeGreaterThan(-1)
    const branch = lines.slice(start, start + 4).join("\n")
    expect(branch).toMatch(/requireAuth\(req, res\)/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE CONTROLS — the gate admits a real session, and the VAPID key stays public
// ═══════════════════════════════════════════════════════════════════════════

describe("WS-7 finding 1 — the controls: the room still works, and the key is still public", () => {
  let authDir
  let notifyDir

  beforeEach(() => {
    dirs = []
    redirectAll()
    authDir = dirs[0]
    notifyDir = dirs[1]
    seedSession(authDir)
    seedSubscription(notifyDir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  it("an authenticated caller still receives the endpoint list — a gate that 401s everyone would pass every negative above", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/notifications/push-endpoints", null, {
      authorization: `Bearer ${TOKEN}`
    })

    expect(res.status, `the gated sibling refused a REAL session: ${JSON.stringify(res.body)}`).toBe(200)
    expect(res.body?.ok).toBe(true)
    expect(res.body?.subscriptionEndpoints).toEqual([SECRET_ENDPOINT])
  })

  it("an authenticated caller still reads the channel status from the (now gated) route", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/notifications/status", null, {
      authorization: `Bearer ${TOKEN}`
    })
    expect(res.status).toBe(200)
    expect(res.body?.subscriptions).toBe(1)
  })

  it("vapid-public-key is STILL PUBLIC — the anti-goal this whole round must not cross", async () => {
    // WebPush needs the key BEFORE a session exists, so gating it would break the
    // subscribe flow in the browser rather than protect anything. Asserted with
    // the key SET, because the unset branch answers 503 and would pass a weaker
    // test for the wrong reason.
    vi.stubEnv("VAPID_PUBLIC_KEY", VAPID_PUBLIC)
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-never-served")
    const api = await loadHandlers()
    const res = await call(api, "GET", "/api/notifications/vapid-public-key")

    expect(res.status, `vapid-public-key stopped being public: ${JSON.stringify(res.body)}`).toBe(200)
    expect(res.body?.publicKey).toBe(VAPID_PUBLIC)
    expect(JSON.stringify(res.body)).not.toContain("private-never-served")
  })

  it("the wrapper carries no gate of its OWN — every gate belongs to a sub-branch that returns", async () => {
    // The structural reason the wrapper cannot carry a gate, pinned so a future
    // edit is a red build here rather than a broken browser.
    //
    // STATED ACCURATELY, because the first version of this assertion was wrong in
    // a way that would have banned correct code: `prefs`' gate has always sat
    // ABOVE the vapid branch, and that is harmless — it is inside a sub-branch
    // dispatched on `path === "/api/notifications/prefs"`, so a vapid GET never
    // reaches it. What would gate the key is a gate in the WRAPPER'S OWN BODY,
    // which is exactly one indentation level in from the wrapper's own `if`.
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    const lines = src.split("\n")
    const wrapper = lines.findIndex((l) => l.includes('path.startsWith("/api/notifications")'))
    expect(wrapper, "the notifications wrapper must still exist").toBeGreaterThan(-1)

    // The wrapper's own closing brace: the first line at its OWN indentation whose
    // first non-space character is `}`. Written as string slicing rather than a
    // quantifier regex, because an indentation-counted regex is one more thing that
    // has to be right in a test whose job is to be right about indentation.
    const wrapperIndent = (lines[wrapper].match(/^ */) ?? [""])[0].length
    let end = wrapper + 1
    for (; end < lines.length; end += 1) {
      const t = lines[end]
      if (t.trim().startsWith("}") && (t.match(/^ */) ?? [""])[0].length === wrapperIndent) break
    }
    expect(end, "the wrapper's own closing brace must be findable").toBeLessThan(lines.length)

    const wrapperGates = lines
      .slice(wrapper + 1, end)
      .map((l, i) => ({ l, i }))
      .filter((r) => r.l.includes("requireAuth(req, res)"))
      .map((r) => (r.l.match(/^\s*/) ?? [""])[0].length)
    expect(
      wrapperGates,
      "every gate inside the wrapper must belong to a sub-branch one level deeper than the wrapper's own body, " +
        "or a pre-auth GET would have to pass it to reach the VAPID key"
    ).toEqual(wrapperGates.filter((indent) => indent > wrapperIndent + 2))
    expect(wrapperGates.length, "the gated sub-routes must still carry gates").toBeGreaterThan(0)
  })

  it("the vapid branch's OWN block carries no gate", async () => {
    // The other half of the same claim, bound to the branch rather than to the
    // file: a gate inside the vapid branch would gate the key whatever its
    // position relative to the other sub-routes.
    const src = readFileSync(new URL("../handlers.mjs", import.meta.url), "utf8")
    const lines = src.split("\n")
    const start = lines.findIndex((l) => l.includes('path === "/api/notifications/vapid-public-key"'))
    const branch = lines.slice(start, start + 4).join("\n")
    expect(branch, "the vapid branch must stay ungated by protocol necessity").not.toContain("requireAuth")
  })
})