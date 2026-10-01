// WS-7 slice C — the OBSERVABLE behaviour behind the route-auth invariant.
//
// `ws7RouteAuthCoverageGuard.test.mjs` proves the STRUCTURE: every /api route
// is gated in its own block or declared public with a reason. This file proves
// the two halves of that claim that structure alone cannot:
//
//   1. A GATED ROUTE ACTUALLY REFUSES, with the protected payload ABSENT — not
//      merely that a status came back. A gate that answered 401 *and* leaked the
//      body would satisfy every structural assertion in the sibling file.
//   2. A DESTRUCTIVE delete leaves the record ON DISK when the caller is
//      anonymous, and removes it when the caller is authenticated. The second
//      half is the control: without it, "the record still exists" could be
//      satisfied by a store that was never seeded, or by a route that never
//      worked at all.
//
// and, for the other direction:
//
//   3. EVERY DECLARED-PUBLIC ROUTE STILL ANSWERS ANONYMOUSLY, so the allowlist
//      cannot rot into a list of things that are quietly broken. An allowlist
//      entry is a claim that public access is INTENDED and WORKING; if the route
//      starts answering 401 the entry has become a lie, and a reviewer reading
//      the list would be misled.
//
// NO REAL STORE IS TOUCHED. Every store is redirected through the shared helper
// in testSupport/storeIsolation.mjs, which mints a temp directory, refuses the
// real server/data by canonical path, and REFUSES a variable name the contract
// does not know — so a misspelling here is a loud failure rather than a silent
// write into the developer's live data. That is the same discipline
// ws7TestStoreIsolation enforces across the suite.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const GUARD_REL = "server/__tests__/ws7RouteAuthCoverageGuard.test.mjs"

// A distinct, NON-LOOPBACK remote address per request.
//
// Two reasons, both load-bearing. `clientIp()` reads req.socket.remoteAddress,
// and `isLocalhostRequest()` is TRUE for 127.0.0.1 / ::1 / localhost — so a
// loopback address would sail through the documented loopback bypass in
// requireAuth() and every "anonymous" request in this file would be
// authenticated. And the general rate limiter is keyed `general:<ip>` at 60
// POSTs a minute, so a shared address would make the 98-route allowlist sweep
// start answering 429 part-way through and prove nothing. 203.0.113.0/24 is
// TEST-NET-3, reserved and unroutable, so it is both non-loopback and distinct
// per request.
let ipCounter = 0
const nextIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`

function makeReq(method, url, { body = {}, authorization, ip = nextIp(), origin } = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body)
  return {
    method,
    url,
    // No `origin` and no `sec-fetch-site`, so checkCsrf() returns true at step 3
    // ("no browser headers at all"). Present on purpose: a browser-shaped request
    // would be a different test.
    headers: {
      host: "example.test",
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
      ...(origin ? { origin } : {})
    },
    socket: { remoteAddress: ip },
    raw: null,
    on(evt, cb) {
      if (evt === "data" && raw) cb(Buffer.from(raw, "utf8"))
      if (evt === "end") cb()
    },
    removeAllListeners() {},
    destroy() {}
  }
}

function makeRes() {
  return {
    status: null,
    body: null,
    headersSent: false,
    setHeader() {},
    writeHead(status) {
      this.status = status
      this.headersSent = true
    },
    end(chunk) {
      this.headersSent = true
      if (chunk) {
        try {
          this.body = JSON.parse(chunk)
        } catch {
          this.body = chunk
        }
      }
    }
  }
}

/**
 * Fire one request and report the outcome as a status.
 *
 * A THROW is reported as a 500 rather than propagated, because this file is
 * about what a caller OBSERVES and a route that throws before it writes has
 * still answered — with a 500. Letting it propagate would abort the test
 * instead of measuring the route, and the one route that does this
 * (`/api/metrics`, via the pre-existing ReferenceError recorded in ACCEPT) would
 * then be untested rather than recorded.
 */
async function call(method, url, opts = {}) {
  const { handleApi } = await import("../handlers.mjs?ws7-route-auth-behaviour")
  const res = makeRes()
  try {
    await handleApi(makeReq(method, url, opts), res, url)
  } catch (err) {
    return { status: 500, body: { error: String(err?.name ?? "Error"), thrown: true }, thrown: err }
  }
  return res
}

// ── store fixtures ─────────────────────────────────────────────────────────
const ALERT_ID = "alert_seed_slice_c"
const WATCHLIST_ID = "wl_seed_slice_c"
const SEEDED_ALERT = {
  id: ALERT_ID,
  userId: "default",
  symbol: "EURUSD",
  condition: "price_above",
  value: 1.2345,
  message: "seeded by the ws7 slice C behaviour test",
  createdAt: 1,
  status: "active"
}
const SEEDED_WATCHLIST = { id: WATCHLIST_ID, name: "Seeded", symbols: ["EURUSD"], createdAt: 1, updatedAt: 1 }

// A notification old enough for `clear` to remove. The route's default cutoff is
// 7 days (`Number(body.olderThanMs) || 7 * 24 * 60 * 60 * 1000`), and
// `clearOld()` filters `createdAt >= cutoff`, so an entry created "now" would
// SURVIVE a working clear — and the control test would then pass because nothing
// was ever deletable, not because the gate refused.
const NOTIFICATION_ID = "ntf_seed_slice_c_round1"
const SEEDED_NOTIFICATION = {
  id: NOTIFICATION_ID,
  title: "seeded by the ws7 slice C fix-round-1 behaviour test",
  body: "the control depends on this row being clearable",
  level: "warn",
  channel: "in-app",
  read: false,
  createdAt: 1,
  meta: {}
}

const USER_ROW = { id: "u1", email: "e@example.test", name: "E", salt: "s", passwordHash: "h", createdAt: 1 }
const TOKEN = "b".repeat(64)

let authDir
let alertsDir
let watchDir
let notifyDir

function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value), "utf8")
}

/**
 * Point all three stores at fresh scratch directories and seed them.
 *
 * `useIsolatedStoreDir` is the SHARED helper, not a hand-rolled
 * `process.env.X = mkdtemp(...)`: ws7TestStoreIsolation fails any test file that
 * assigns a contract store variable itself, and the helper also asserts the
 * result is not the real store. Seed files are written BEFORE handlers.mjs is
 * imported because alertEngine.mjs and watchlist.mjs both read their JSON at
 * module load (`load()` / `loadAlerts()`), so a seed written after the import
 * would never be seen.
 */
function seedStores({ users = [USER_ROW], usersRaw = null } = {}) {
  authDir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR", { prefix: "picc-ws7c-auth" })
  alertsDir = useIsolatedStoreDir("PICC_ALERTS_DATA_DIR", { prefix: "picc-ws7c-alerts" })
  watchDir = useIsolatedStoreDir("PICC_WATCHLIST_DATA_DIR", { prefix: "picc-ws7c-watchlist" })
  notifyDir = useIsolatedStoreDir("PICC_NOTIFICATION_DATA_DIR", { prefix: "picc-ws7c-notify" })

  writeJson(authDir, "sessions.json", { sessions: {} })
  writeJson(authDir, "users.json", usersRaw !== null ? usersRaw : { users })
  writeJson(alertsDir, "alerts.json", [SEEDED_ALERT])
  writeJson(watchlistsDir(), "watchlists.json", [SEEDED_WATCHLIST])
  writeJson(notifyDir, "notification-center.json", { notifications: [SEEDED_NOTIFICATION] })
  vi.resetModules()
}
const watchlistsDir = () => watchDir

const alertsFile = () => join(alertsDir, "alerts.json")
const watchlistsFile = () => join(watchDir, "watchlists.json")
const notificationsFile = () => join(notifyDir, "notification-center.json")
const readAlerts = () => JSON.parse(readFileSync(alertsFile(), "utf8"))
const readWatchlists = () => JSON.parse(readFileSync(watchlistsFile(), "utf8"))
const readNotifications = () => JSON.parse(readFileSync(notificationsFile(), "utf8"))

/**
 * Let a FLOATING store write land before asserting that it did not.
 *
 * Needed because the notifications route does not `await` its store calls (see
 * the CONTROL test below: `notify()`, `getNotifications()`, `unreadCount()`,
 * `notificationStats()` and `clearOld()` are all called without `await`, so a
 * 200 can be written while the write is still in flight). Without this, "the
 * store is unchanged" would pass on a schedule rather than on a fact — a write
 * that merely had not landed yet would look exactly like a write that was
 * refused. Waiting first means the negative assertions are about the GATE.
 */
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  seedStores()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const dir of [authDir, alertsDir, watchDir, notifyDir]) {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
})

describe("WS-7 slice C — a gated destructive delete REFUSES an anonymous caller, payload absent", () => {
  // THE FINDING, restated as wire behaviour. Before the gate each of these
  // answered 200 {"ok":true} to a caller who had never authenticated, and the
  // reviewer's probe returned {"ok":false} only because its id did not exist.

  it("POST /api/trading/alerts/delete does NOT delete when the user store is unreadable", async () => {
    // An unreadable users.json is the case the shared gate refuses with 503: it
    // cannot tell "no accounts" from "cannot read the account list", and the
    // lenient answer would serve the route unauthenticated.
    writeJson(authDir, "users.json", "{ not json")
    const res = await call("POST", "/api/trading/alerts/delete", { body: { id: ALERT_ID } })
    expect([401, 503], `unexpected status ${res.status}: ${JSON.stringify(res.body)}`).toContain(res.status)
    // The decisive assertion: not merely that a status came back, but that the
    // protected payload is absent AND the store was not touched.
    expect(JSON.stringify(res.body ?? {})).not.toContain(ALERT_ID)
    expect(res.body?.ok).not.toBe(true)
    expect(
      readAlerts().some((a) => a.id === ALERT_ID),
      "the alert must still be on disk after an unauthenticated delete attempt"
    ).toBe(true)
  })

  it("POST /api/trading/watchlists/delete does NOT delete when the user store is unreadable", async () => {
    writeJson(authDir, "users.json", "}}} still not json")
    const res = await call("POST", "/api/trading/watchlists/delete", { body: { id: WATCHLIST_ID } })
    expect([401, 503], `unexpected status ${res.status}: ${JSON.stringify(res.body)}`).toContain(res.status)
    expect(JSON.stringify(res.body ?? {})).not.toContain(WATCHLIST_ID)
    expect(res.body?.ok).not.toBe(true)
    expect(
      readWatchlists().some((w) => w.id === WATCHLIST_ID),
      "the watchlist must still be on disk after an unauthenticated delete attempt"
    ).toBe(true)
  })

  it("both deletes refuse with 401 when the store is HEALTHY and a user exists", async () => {
    // The ordinary case, which is the one an attacker actually meets. The
    // 503-above case is the fail-closed hardening; this is the plain refusal.
    for (const [url, id] of [
      ["/api/trading/alerts/delete", ALERT_ID],
      ["/api/trading/watchlists/delete", WATCHLIST_ID]
    ]) {
      const res = await call("POST", url, { body: { id } })
      expect(res.status, `${url} must refuse an anonymous caller: ${JSON.stringify(res.body)}`).toBe(401)
      expect(JSON.stringify(res.body ?? {})).not.toContain(id)
      expect(res.body?.ok).not.toBe(true)
    }
    expect(readAlerts().some((a) => a.id === ALERT_ID)).toBe(true)
    expect(readWatchlists().some((w) => w.id === WATCHLIST_ID)).toBe(true)
  })

  it("the alert payload is ABSENT from an anonymous refusal, not merely the status", async () => {
    // The assertion that a status-only test would miss. The alert registry
    // carries a userId field, so a refusal that echoed the row would be a
    // disclosure wearing a 401.
    const res = await call("GET", "/api/trading/alerts", {})
    // The GET is NOT gated — it is a declared-public decision item — so this
    // documents what the payload looks like, which is what the delete's refusal
    // must not echo. Kept as its own test so the shape is pinned rather than
    // assumed.
    expect(res.status, "the alert registry GET is a declared-public decision item, not a gated route").toBe(200)
    expect(JSON.stringify(res.body ?? {})).toContain(ALERT_ID)
    const refusal = await call("POST", "/api/trading/alerts/delete", { body: { id: ALERT_ID } })
    expect(JSON.stringify(refusal.body ?? {})).not.toContain(ALERT_ID)
  })
})

describe("WS-7 slice C — the delete assertions can actually detect a deletion", () => {
  // THE CONTROL, and it is the whole reason these tests are honest. If the
  // authenticated delete did not remove the record, then "the record still
  // exists" in the tests above would be satisfied by a store that was never
  // writable, or a route that never worked — and both would be green for the
  // wrong reason.

  it("an AUTHENTICATED delete really does remove the record from disk", async () => {
    writeJson(authDir, "sessions.json", {
      sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } }
    })
    vi.resetModules()

    const ok = await call("POST", "/api/trading/alerts/delete", {
      body: { id: ALERT_ID },
      authorization: `Bearer ${TOKEN}`
    })
    expect(ok.status, `the gate must admit a real session: ${JSON.stringify(ok.body)}`).toBe(200)
    expect(ok.body?.ok, "deleteAlert must report the deletion it performed").toBe(true)
    expect(
      readAlerts().some((a) => a.id === ALERT_ID),
      "an authenticated delete MUST remove the record — if this fails, the refusal tests above prove nothing"
    ).toBe(false)

    const ok2 = await call("POST", "/api/trading/watchlists/delete", {
      body: { id: WATCHLIST_ID },
      authorization: `Bearer ${TOKEN}`
    })
    expect(ok2.status, `the gate must admit a real session: ${JSON.stringify(ok2.body)}`).toBe(200)
    expect(ok2.body?.ok, "deleteWatchlist must report the deletion it performed").toBe(true)
    expect(
      readWatchlists().some((w) => w.id === WATCHLIST_ID),
      "an authenticated delete MUST remove the record — if this fails, the refusal tests above prove nothing"
    ).toBe(false)
  })

  it("the seeded records were really on disk before the delete", async () => {
    // The other half of the control: the seed reached the store the handler
    // reads. Without this, "still exists" could mean "was never there".
    expect(readAlerts().map((a) => a.id)).toContain(ALERT_ID)
    expect(readWatchlists().map((w) => w.id)).toContain(WATCHLIST_ID)
  })

  it("the stores really were redirected away from the live server/data", async () => {
    // Stated rather than assumed, because the round-4 auth incident in this
    // repository was exactly a test writing a real account into the live store
    // through a misspelled variable.
    for (const dir of [authDir, alertsDir, watchDir]) {
      expect(dir.includes("server") && dir.includes("data"), `${dir} must not be the live store`).toBe(false)
      expect(existsSync(dir), `${dir} must exist`).toBe(true)
    }
  })
})

describe("WS-7 slice C fix round 1 — /api/trading/notifications refuses an anonymous caller", () => {
  // THE C2 LIVE DEFECT, AS WIRE BEHAVIOUR. The gate on this route covered only
  // `webhook-settings` and `webhook-test`, so the reviewer's probe against the
  // real handler with a healthy populated store answered, anonymously:
  //
  //     GET                     -> 200 {notifications, unread, stats, webhook}
  //     POST action=read        -> 200 {ok:true}   markRead
  //     POST action=read-all    -> 200 {ok:true}   markAllRead
  //     POST action=clear       -> 200 {ok:true}   clearOld — DELETES
  //     POST action=<t,b>       -> 200 {ok:true, notification}   inject
  //
  // `clear` is the serious one: clearOld() filters the registry and persists, so
  // it is a destructive operation on shared state. The gate is now unconditional
  // at the top of the block.

  it("GET refuses an anonymous caller, with the registry absent from the body", async () => {
    const res = await call("GET", "/api/trading/notifications", {})
    expect(res.status, `must refuse, got ${JSON.stringify(res.body)}`).toBe(401)
    // Not merely a status: the seeded title is a payload an anonymous caller must
    // not receive, so a refusal that echoed the registry would be a disclosure
    // wearing a 401.
    expect(JSON.stringify(res.body ?? {})).not.toContain(NOTIFICATION_ID)
    expect(JSON.stringify(res.body ?? {})).not.toContain("seeded by the ws7 slice C")
    expect(res.body?.ok).not.toBe(true)
    expect(readNotifications().notifications.map((n) => n.id)).toContain(NOTIFICATION_ID)
  })

  it("POST action=clear refuses, and the stored notification is STILL ON DISK", async () => {
    // The on-disk assertion is the one that matters. clearOld() DELETES rows, so
    // "it answered 401" is not the finding — "nothing was deleted" is.
    const before = readNotifications().notifications.length
    const res = await call("POST", "/api/trading/notifications", { body: { action: "clear" } })
    expect(res.status, `clear must refuse, got ${JSON.stringify(res.body)}`).toBe(401)
    expect(res.body?.ok).not.toBe(true)
    await settle()
    expect(
      readNotifications().notifications.map((n) => n.id),
      "an anonymous clear must not delete the seeded notification"
    ).toContain(NOTIFICATION_ID)
    expect(readNotifications().notifications.length, "and must not delete anything at all").toBe(before)
  })

  it("POST read / read-all / inject all refuse, and inject writes nothing", async () => {
    const before = readNotifications().notifications
    for (const body of [
      { action: "read", id: NOTIFICATION_ID },
      { action: "read-all" },
      { title: "injected by an anonymous caller", body: "should never persist", level: "critical" }
    ]) {
      const res = await call("POST", "/api/trading/notifications", { body })
      expect(res.status, `action ${body.action ?? "inject"} must refuse`).toBe(401)
      expect(res.body?.ok).not.toBe(true)
    }
    // The wait matters here more than anywhere else: the route does not `await`
    // its store calls, so a write that was merely in flight would look identical
    // to a write that was refused. See settle().
    await settle()
    const after = readNotifications().notifications
    expect(
      after.some((n) => n.read),
      "an anonymous read / read-all must not mark the stored notification read"
    ).toBe(false)
    expect(
      after.length,
      "an anonymous inject must not add a notification — it writes arbitrary title/body/level/meta into the registry"
    ).toBe(before.length)
    expect(after.map((n) => n.title)).not.toContain("injected by an anonymous caller")
  })

  it("the two webhook actions that WERE gated stay gated", async () => {
    // The conditional gate covered these, so they were never part of the defect.
    // Pinned anyway: the fix MOVED the gate rather than widening it, and a move
    // that dropped the two would be a regression nobody would otherwise notice.
    for (const action of ["webhook-settings", "webhook-test"]) {
      const res = await call("POST", "/api/trading/notifications", {
        body: { action, settings: { url: "http://127.0.0.1:1/x" }, event: "autopilot.start" }
      })
      expect(res.status, `${action} must still refuse`).toBe(401)
    }
  })

  it("CONTROL — an AUTHENTICATED caller really can write and really can clear", async () => {
    // THE CONTROL, and without it every "refuses" test above is worth nothing: a
    // route that 401s because it is broken, or a store that was never writable,
    // produces the same green. The gate must ADMIT a real session, an
    // authenticated write must really PERSIST, and clearOld() must ACTUALLY
    // delete — so that "the notification is still on disk" is a statement about
    // the gate and not about an inert store.
    //
    // IT USES inject/clear RATHER THAN THE GET, and that is a finding, not a
    // convenience. The route's GET branch builds its body as
    // `{ notifications: getNotifications(…), unread: unreadCount(), stats: notificationStats() }`
    // with NO `await` on any of the three, and all three are `async function`, so
    // the 200 body is `{"ok":true,"notifications":{},"unread":{},"stats":{},…}` —
    // Promises serialised as `{}`. Probed directly against the real handler with
    // a valid session: status 200, every one of those three fields `{}`. That is
    // a PRE-EXISTING defect, the same class as the /api/metrics ReferenceError
    // below, and it is NOT caused by the gate — the gate change is a line added
    // above the dispatch's own import. It is recorded rather than fixed here,
    // because fixing it is a separate change and silently bundling it would make
    // this diff unreadable. Asserting visibility through the GET would have
    // required fixing it first, so this control uses the two paths that do work.
    writeJson(authDir, "sessions.json", {
      sessions: { [TOKEN]: { userId: "u1", createdAt: 1, expiresAt: Date.now() + 3_600_000 } }
    })
    vi.resetModules()
    const auth = { authorization: `Bearer ${TOKEN}` }

    const injected = await call("POST", "/api/trading/notifications", {
      body: { title: "written by an authenticated caller", body: "the control depends on this persisting" },
      ...auth
    })
    expect(injected.status, `the gate must admit a real session: ${JSON.stringify(injected.body)}`).toBe(200)
    expect(injected.body?.ok).toBe(true)
    // The route does not `await` notify(), so the persist is in flight when the
    // 200 is written. Wait for it, or the control below would prove nothing.
    await settle()
    expect(
      readNotifications().notifications.map((n) => n.title),
      "an AUTHENTICATED inject MUST persist — if this fails, every 'wrote nothing' assertion above is vacuous"
    ).toContain("written by an authenticated caller")

    const cleared = await call("POST", "/api/trading/notifications", { body: { action: "clear" }, ...auth })
    expect(cleared.status, `authenticated clear must work: ${JSON.stringify(cleared.body)}`).toBe(200)
    expect(cleared.body?.ok).toBe(true)
    await settle()
    expect(
      readNotifications().notifications.map((n) => n.id),
      "an AUTHENTICATED clear MUST remove the row — if this fails, the refusal tests above prove nothing"
    ).not.toContain(NOTIFICATION_ID)
  })

  it("the seeded notification was really on disk, and really is clearable", async () => {
    // The other half of the control, and the reason the seed uses `createdAt: 1`.
    // The route's cutoff is `Number(body.olderThanMs) || 7 * 24 * 60 * 60 * 1000`
    // and clearOld() keeps `createdAt >= cutoff`, so a row created "now" would
    // SURVIVE a working clear — and "the row is still on disk" would then be
    // true for a store where nothing was ever deletable. Asserting the seed is
    // old enough closes that door.
    expect(readNotifications().notifications.map((n) => n.id)).toContain(NOTIFICATION_ID)
    const seeded = readNotifications().notifications.find((n) => n.id === NOTIFICATION_ID)
    expect(seeded.createdAt, "the seed must predate the 7-day cutoff or clearOld would keep it").toBeLessThan(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    )
  })

  it("the notification store really was redirected away from the live server/data", async () => {
    // Stated rather than assumed, for the same reason the round-4 auth incident
    // was serious: a test writing a real store through a misspelled variable.
    expect(notifyDir.includes("server") && notifyDir.includes("data"), `${notifyDir} must not be the live store`).toBe(
      false
    )
    expect(existsSync(notificationsFile()), "the seeded notification store must exist").toBe(true)
  })
})

describe("WS-7 slice C — a finding this sweep made: the Prometheus branch of /api/metrics is broken", () => {
  // DISCOVERED BY THE ALLOWLIST SWEEP, NOT BY THIS SLICE'S BRIEF, AND NOT FIXED
  // HERE. It is a metrics bug rather than an auth bug, so fixing it would be
  // scope creep into a file this slice does not otherwise touch; leaving it
  // unrecorded would be worse, because the sweep's ACCEPT entry above would then
  // be absorbing a 500 nobody had named.
  //
  // The defect: `prometheusMetrics()` in server/logger.mjs builds its histogram
  // lines from `durations` (logger.mjs:91) and `m.p99DurationMs` (logger.mjs:90).
  // `durations` is a local of `getMetrics()` at logger.mjs:52 and is not in scope
  // there; `p99DurationMs` is computed inside getMetrics() at :56 and never
  // returned. Both are ReferenceError/undefined on every scrape, so the text
  // branch of GET /api/metrics has never produced a body.
  //
  // THIS TEST IS A TRIPWIRE, and it fails the moment the bug is fixed — on
  // purpose. A silently-fixed bug would leave the ACCEPT entry above claiming a
  // 500 that no longer happens, and the note would become a lie. Fixing the bug
  // means deleting this test and narrowing the ACCEPT entry in the same commit.
  it("throws a ReferenceError on the Prometheus text branch today", async () => {
    const res = await call("GET", "/api/metrics", { headers: undefined })
    expect(res.thrown, "if this no longer throws, the bug is FIXED — delete this test and the ACCEPT entry").toBeDefined()
    expect(String(res.thrown?.message ?? "")).toContain("durations")
  })

  it("still answers anonymously on the JSON branch, so the ROUTE is reachable", async () => {
    // The auth-relevant half, and the part this slice is actually about: the
    // endpoint is not gated and does not refuse. The scrape bug is orthogonal.
    const { handleApi } = await import("../handlers.mjs?ws7-route-auth-behaviour")
    const res = makeRes()
    const req = makeReq("GET", "/api/metrics", { ip: nextIp() })
    req.headers.accept = "text/plain"
    await handleApi(req, res, "/api/metrics")
    expect(res.status, "the JSON branch must answer an anonymous caller").toBe(200)
  })
})

// ---------------------------------------------------------------------------
// The declared-public sweep
// ---------------------------------------------------------------------------

/**
 * The allowlist markers, read OUT OF THE GUARD FILE rather than restated here.
 *
 * A second copy is a list that drifts, which is the reason this project's store
 * contract lives in one file for two harnesses. If the guard's DECLARED_PUBLIC
 * gains or loses an entry, this sweep follows on the next run with no edit here,
 * and a marker the guard can no longer resolve fails the guard's own staleness
 * test rather than quietly disappearing from coverage.
 */
function readDeclaredPublicMarkers() {
  const text = readFileSync(new URL(`../__tests__/${GUARD_REL.split("/").pop()}`, import.meta.url), "utf8")
  const start = text.indexOf("const DECLARED_PUBLIC = [")
  const end = text.indexOf("\n/** Marker -> entry")
  if (start === -1 || end === -1) throw new Error("DECLARED_PUBLIC could not be located in the guard file")
  return [...declaredPublicSlice().matchAll(/marker: '([^']+)'/g)].map((m) => m[1])
}

/**
 * The raw DECLARED_PUBLIC array text, sliced out of the guard file by its own
 * delimiters. Split out from readDeclaredPublicMarkers so the anti-vacuity
 * assertion below can count the SAME slice with a DIFFERENT pattern.
 */
function declaredPublicSlice() {
  const text = readFileSync(new URL(`../__tests__/${GUARD_REL.split("/").pop()}`, import.meta.url), "utf8")
  const start = text.indexOf("const DECLARED_PUBLIC = [")
  const end = text.indexOf("\n/** Marker -> entry")
  if (start === -1 || end === -1) throw new Error("DECLARED_PUBLIC could not be located in the guard file")
  return text.slice(start, end)
}

/** Derive the (path, method) a dispatch line serves, from the line itself. */
function routeOf(marker) {
  const path =
    /path\s*===\s*["'`](\/api\/[^"'`]*)["'`]/.exec(marker)?.[1] ??
    /path\.startsWith\(\s*["'`](\/api\/[^"'`]*)["'`]/.exec(marker)?.[1]
  if (!path) throw new Error(`marker carries no /api path: ${marker}`)
  // The FIRST method the dispatch names. A `(GET || POST)` dispatch is one
  // site; firing either proves the same thing about the gate, which is that no
  // gate refuses.
  const method = /req\.method\s*===\s*["'`]([A-Z]+)["'`]/.exec(marker)?.[1] ?? "GET"
  return { path, method }
}

/**
 * The one route whose "public" claim is conditional on being loopback.
 *
 * `/api/streams/snapshot` POST carries its OWN control —
 * `if (!isLocalhostRequest(req)) { writeJson(res, 403, { error: "local only" }) }` —
 * so from a routable address it answers 403 by design. It is fired from
 * 127.0.0.1 instead, and the loopback bypass in requireAuth() does not apply to
 * it because it does not use a shared gate at all. Recorded here rather than
 * special-cased in the assertion, so the exception is visible.
 */
const LOOPBACK_ONLY = new Set(["/api/streams/snapshot"])

/**
 * Routes whose correct ANONYMOUS answer is itself a 401 or a 500.
 *
 * The sweep's default assertion is "the route did not answer 401 or 403", which
 * is the right claim for every route the owner might gate. It is the wrong claim
 * for three, and each is recorded here with the reason rather than being folded
 * into the condition — an exception nobody can see is how a sweep stops meaning
 * anything.
 */
const ACCEPT = {
  "/api/auth/login": {
    statuses: [400, 401],
    why:
      "401 here is the CREDENTIAL verdict, not a gate. The route is the login endpoint: it is reachable " +
      "without a session by definition, and a caller who supplies no email must be told so. Asserting " +
      "'not 401' on the login route would assert that login always succeeds, which is a worse lie."
  },
  "/api/auth/me": {
    statuses: [401, 503],
    why:
      "401 IS this route's public answer. It resolves the caller's own bearer token to a user and answers " +
      "401 when no valid token was presented; 503 is its deliberate answer for an unreadable session " +
      "store, so the client does not delete a still-valid session. 'No token' and 'no gate' are the " +
      "same 401 here, and the route is upstream of every other gate in the file."
  },
  "/api/metrics": {
    statuses: [200, 500],
    why:
      "KNOWN-BROKEN, DISCOVERED BY THIS SWEEP, NOT FIXED HERE. GET /api/metrics takes the Prometheus " +
      "branch and calls prometheusMetrics() in server/logger.mjs, which references `durations` at " +
      "logger.mjs:91 and `p99DurationMs` at logger.mjs:90 — neither is in scope there. `durations` is a " +
      "local of getMetrics() (logger.mjs:52) and p99DurationMs is never returned by it, so the text " +
      "branch throws a ReferenceError and the endpoint answers 500 for every scrape. That is a " +
      "pre-existing metrics bug, unrelated to route auth and out of this slice's scope, so it is " +
      "recorded here rather than fixed. The JSON branch (Accept: text/plain) still works. Tracked in the " +
      "task report as a finding of this sweep."
  }
}

const DEFAULT_REFUSAL = [401, 403]

/**
 * A per-test timeout for the sweep, and why the global default is untouched.
 *
 * The suite's global testTimeout stays at 5s, deliberately: raising it would let
 * a genuine hang in any of the suite's 3,800-odd tests hide behind a longer
 * budget. These probes are a different case. Several of the routes under test
 * declare their OWN network budget in the handler — `withTimeout(..., 8000)` on
 * /api/trading/status, 10s on the two /api/trading/demo reads, 20s on
 * /api/crypto/market, /api/yields, /api/trading/paper/analytics and the
 * /api/trading/watchlist read, and 30s on /api/trading/assist — so a 5s ceiling
 * is SHORTER THAN THE CONTRACT THE ROUTE ITSELF DECLARES, and the sweep would
 * fail on routes that are behaving exactly as written.
 *
 * This is the per-test argument to `it`, not the global config, and it is set on
 * these 98 probes alone. A route that hangs still fails here; it just has room
 * for a 20-second upstream rather than 5.
 */
const SWEEP_TIMEOUT_MS = 20_000

const MARKERS = readDeclaredPublicMarkers()

describe("WS-7 slice C — every declared-public route still answers an anonymous caller", () => {
  it("the sweep covers the whole allowlist", () => {
    // WS-7 T20R. THIS FLOOR USED TO BE A MAGIC NUMBER AND IT WENT STALE, which is
    // the failure mode worth naming: it read `toBeGreaterThan(90)` against a
    // 95-entry allowlist, and T20R's discharge of 24 decisions legitimately took
    // that to 74. Deleting the assertion or lowering it to fit would have been
    // exactly the "make the count match" move this file exists to prevent.
    //
    // IT IS NOW DERIVED INSTEAD OF GUESSED, and it is STRICTLY STRONGER than the
    // floor it replaces. Two INDEPENDENT patterns over the same slice must agree:
    // one counts `marker:` fields (what the sweep fires) and one counts
    // `owner:` fields (what the guard classifies). A parse that silently matched
    // nothing on one pattern cannot agree with the other, so the circularity of
    // comparing the sweep to itself is avoided rather than hidden. The hard floor
    // stays as a backstop for a parse that is wrong on BOTH patterns at once.
    // BOTH patterns are ANCHORED to the 4-space field indentation inside an entry,
    // and neither is a bare substring search. That matters: this file's own
    // comments discuss `owner: "decision"` in prose, and an unanchored pattern
    // would count a sentence as an entry. Anchoring also keeps the two patterns
    // independent in the way the check needs — they must fail differently.
    const slice = declaredPublicSlice()
    const markerCount = [...slice.matchAll(/^ {4}marker: '([^']+)',?\s*$/gm)].length
    const ownerCount = [...slice.matchAll(/^ {4}owner: "(?:declared|decision)",?\s*$/gm)].length

    expect(
      MARKERS.length,
      "the sweep must fire one probe per DECLARED_PUBLIC entry, so every entry is covered"
    ).toBe(markerCount)
    expect(
      markerCount,
      "every marker must belong to an entry the guard classifies — a marker with no owner is a fixture " +
        "or a comment, not coverage"
    ).toBe(ownerCount)
    expect(
      markerCount,
      "the allowlist sweep found no markers — a parse that found nothing would make every test below " +
        "vacuous, which is the exact failure this file exists to prevent"
    ).toBeGreaterThan(60)
  })

  for (const marker of MARKERS) {
    const { path, method } = routeOf(marker)
    const loopback = LOOPBACK_ONLY.has(path)
    const accept = ACCEPT[path]
    it(`${method} ${path} answers anonymously (${loopback ? "loopback-only control" : "not refused"})`, async () => {
      const res = await call(method, path, {
        ip: loopback ? "127.0.0.1" : nextIp(),
        body: method === "GET" || method === "DELETE" ? {} : { symbol: "EURUSD", assetId: "EURUSD", id: "x", tag: "t" }
      })
      const suffix = accept
        ? ` Accepted here because: ${accept.why}`
        : ""
      if (accept) {
        // The route's own public answer is a refusal-shaped status. Membership is
        // the assertion, so a CHANGE here fails: a status nobody listed fails too.
        expect(
          accept.statuses,
          `${method} ${path} answered ${res.status} to an anonymous caller: ${JSON.stringify(res.body)}.` +
            suffix
        ).toContain(res.status)
      } else {
        expect(
          DEFAULT_REFUSAL,
          `${method} ${path} answered ${res.status} to an anonymous caller: ${JSON.stringify(res.body)}.` +
            suffix +
            " An allowlist entry claims public access is intended and WORKING — if the route now refuses, " +
            "the entry is a lie. Either the gate is correct and the entry must be deleted, or the route is " +
            "broken and needs fixing; both mean this entry changes."
        ).not.toContain(res.status)
      }

      // ── THE ABSOLUTE-PATH DISCLOSURE CHECK, IN THE SAME SWEEP ──
      // A status assertion says a route is reachable. It says NOTHING about what
      // the reachable route hands out, and the review of round 1 found a
      // declared-public `decision` route returning
      //   "dir": "C:\\Users\\sharv\\Downloads\\freelance\\PICC\\infra\\n8n\\workflows"
      // — the OS user name and the home directory — to an anonymous caller, on
      // /api/opportunities/workflows. It is the same class the repo already
      // removed from /api/auth/status, whose handler comment records the rule: an
      // absolute path served over HTTP is a fingerprint of the machine.
      //
      // Checking it HERE, on every allowlisted route, rather than in a one-off
      // test for the one route found, is the point: the finding was made by hand
      // on two routes, and there are 99 allowlisted routes and no reviewer. This
      // is the rule that would have caught it the first time.
      const body = JSON.stringify(res.body ?? {})
      const leaks = [...new Set(body.match(/[A-Za-z]:\\\\[^"'\s]*|\\\\Users\\\\[^"'\s]*/g) ?? [])]
      expect(
        leaks,
        `${method} ${path} answered an anonymous caller with an ABSOLUTE FILESYSTEM PATH: ${leaks.join(", ")}.` +
          " That discloses the OS user name and the home directory to a caller with no session. Serve a" +
          " repo-relative label or a basename instead — the field can stay, its value must not be the" +
          " resolved path. See opportunities.mjs WORKFLOWS_DIR_LABEL and the /api/auth/status note."
      ).toEqual([])
    }, SWEEP_TIMEOUT_MS)
  }
})
