// WS-7 T8 — `GET /api/trading/ministry` at the HTTP boundary.
//
// THE GATE IS ASSERTED HERE, NOT LEFT TO THE STATIC SCAN. `ws7RouteAuthCoverageGuard`
// proves a gate call exists in the route's own block; this proves the route
// answers 401 to an anonymous caller and discloses nothing. A scan can be
// satisfied by a gate that never runs — that is T7R-B's stated reason for
// writing `copilotDecisionRoute.test.mjs` — and this is the assertion that
// cannot be.
//
// GATED, AND DELIBERATELY NOT ALLOWLISTED. The route exposes the governance
// vocabulary (authority ids, room keys, separation codes). None of it is
// declared-public, so it gets NO `DECLARED_PUBLIC` entry and NO
// `owner: "decision"` entry: the 86 unruled decision entries awaiting the owner
// are not a pool to draw from. That is the T7R-B precedent, copied.
//
// IT COMPUTES NOTHING AND INVENTS NOBODY. The readout is
// `services/authority/governance.mjs`, which calls T16's own
// `describeRoomSeparation` and emits D10's own `unassignedAuthorityLabel()`. The
// tests below assert the values that come OUT of those two modules rather than
// restating T16's collision condition, because a second copy of the condition in
// a test is how a drift becomes invisible (plan §3.5 Risk 6).
//
// Hermetic: the handler is booted through the SHARED store-isolation helper, so
// no store resolves to the real `server/data`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"
import { GOVERNANCE_ROOM_KEYS, MINISTRY_GOVERNANCE_VERSION } from "../services/authority/governance.mjs"

const ROUTE = "/api/trading/ministry"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    // DELIBERATELY NO `socket`. `requireAuth` admits a request outright when
    // `isLocalhostRequest(req)` is true (`handlers.mjs:5854`), and that
    // predicate reads `peerAddress(req)` — the real TCP peer. An earlier
    // version of this harness supplied `socket: { remoteAddress: "127.0.0.1" }`
    // and therefore took that bypass, so the anonymous caller was admitted and
    // the 401 assertions failed. That was a defect in the HARNESS, not in the
    // route, and it is recorded here because the bypass is real and correct:
    // a loopback caller is inside the trust boundary by definition. An
    // assertion that the route refuses an anonymous caller must therefore
    // present a NON-loopback caller, which is what omitting `socket` does. This
    // mirrors `copilotDecisionRoute.test.mjs`, whose harness does the same.
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

async function call(api, method, path, body, headers) {
  const res = makeRes()
  await api(makeReq(method, path, body, headers), res, path)
  return res
}

/** A bearer token whose value is irrelevant to the assertions below. */
const TOKEN = "b".repeat(64)

describe("WS-7 T8 — GET /api/trading/ministry is gated", () => {
  let dir

  beforeEach(() => {
    // Through the SHARED helper, never `process.env` by hand:
    // `ws7TestStoreIsolation.test.mjs` enumerates via `git ls-files`, so it
    // cannot see an untracked file, and a hand-rolled
    // `process.env.PICC_*_DATA_DIR =` is what that guard exists to refuse. The
    // helper mints, canonicalises, asserts the target is NOT the real
    // `server/data`, and throws on a variable name the contract does not know.
    useIsolatedStoreDir("PICC_TRADING_DATA_DIR")
    useIsolatedStoreDir("PICC_DATA_DIR")
    dir = useIsolatedStoreDir("PICC_AUTH_DATA_DIR")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  async function loadHandlers({ withUser = true } = {}) {
    // A user exists so auth is ENFORCED. With an empty store `requireAuth`
    // takes its first-run bootstrap branch, which admits everyone — pinned
    // explicitly below rather than left to be discovered.
    if (withUser) {
      writeFileSync(
        join(dir, "users.json"),
        JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] })
      )
    }
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?ministry-governance-route-test")
    return handleApi
  }

  /**
   * An AUTHENTICATED, non-loopback caller.
   *
   * The payload assertions below must exercise the route's success path, and
   * with the localhost bypass correctly absent that requires a real session —
   * so a `users.json` AND a `sessions.json` carrying a bearer token, exactly as
   * `copilotDecisionRoute.test.mjs`'s `authed()` does. Writing only the user
   * would make the gate refuse, which is the point of the two refusal tests and
   * not a way to reach a 200 here.
   */
  async function authed() {
    writeFileSync(
      join(dir, "users.json"),
      JSON.stringify({ users: [{ id: "u1", email: "a@b.c", password: "x", salt: "y" }] })
    )
    writeFileSync(
      join(dir, "sessions.json"),
      JSON.stringify({
        sessions: { [TOKEN]: { userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } }
      })
    )
    vi.resetModules()
    const { handleApi } = await import("../handlers.mjs?ministry-governance-authed-test")
    const res = makeRes()
    await handleApi(makeReq("GET", ROUTE, undefined, { authorization: `Bearer ${TOKEN}` }), res, ROUTE)
    return res
  }

  it("refuses an anonymous caller with 401 and discloses no governance vocabulary", async () => {
    const api = await loadHandlers()
    const res = await call(api, "GET", ROUTE)

    expect(res.status).toBe(401)
    // A refusal body naming the governance vocabulary would be the disclosure
    // the gate prevents: an anonymous caller must learn nothing about which
    // authorities exist, which rooms they approve, or which refusals exist.
    const text = JSON.stringify(res.body ?? {}).toLowerCase()
    for (const leak of ["authority", "approver", "builder", "separat", "collision", "ws-7+", "permit"]) {
      expect(text, `${leak} must not leak through a 401`).not.toContain(leak)
    }
  })

  it("inherits requireAuth's first-run bootstrap, and that is pinned rather than assumed", async () => {
    // INHERITED, NOT INTRODUCED — the shared gate admits a first-run install.
    // The consequence is that a fresh install with no accounts exposes the
    // governance readout. That is a property of `requireAuth`, so the honest
    // place to change it is the gate and not this route; what this file owes is
    // to make the property visible rather than accidental.
    const api = await loadHandlers({ withUser: false })
    const admitted = await call(api, "GET", ROUTE)
    expect(admitted.status).toBe(200)

    // The SAME request, once one account exists.
    const withUser = await loadHandlers({ withUser: true })
    const refused = await call(withUser, "GET", ROUTE)
    expect(refused.status).toBe(401)
  })

  it("reports every frozen room key from WS-6 §0.3(a), once each", async () => {
    const res = await authed()

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.governanceVersion).toBe(MINISTRY_GOVERNANCE_VERSION)
    expect(res.body.roomKeys).toEqual([...GOVERNANCE_ROOM_KEYS])
    // 22 route instances across 15 DISTINCT keys is the frozen figure the
    // owner's 2026-09-30 amendment set. A room the room-key inventory names and
    // this readout does not is a governance blind spot, so the count is pinned.
    expect(GOVERNANCE_ROOM_KEYS).toHaveLength(15)
    expect(new Set(GOVERNANCE_ROOM_KEYS).size).toBe(15)
    expect(res.body.rooms.map((room) => room.roomKey)).toEqual([...GOVERNANCE_ROOM_KEYS])
  })

  it("marks every room's approver as D10's WS-7+ literal, and never as a record", async () => {
    const res = await authed()

    // The reservation is emitted from T16's own `unassignedAuthorityLabel()`.
    // It is a DISPLAY value: T16 asserts `authorityById(authorities, "WS-7+")`
    // is `null`, so this string can never name an authority record.
    expect(res.body.unassignedAuthority).toBe("WS-7+")
    expect(res.body.authorities.count).toBe(0)
    expect(res.body.authorities.registered).toEqual([])

    for (const room of res.body.rooms) {
      // UNASSIGNED IS AN ANSWER, AND IT IS DISTINGUISHABLE FROM ABSENCE.
      // `approvers` is the raw answer (an empty array) and `approverDisplay` is
      // what a surface shows. Collapsing the two would make "nobody may approve
      // this" indistinguishable from "this room was not evaluated".
      expect(room.approvers, `${room.roomKey} has no approvers`).toEqual([])
      expect(room.approverDisplay, `${room.roomKey} displays the reservation`).toBe("WS-7+")
      expect(room.approverCount).toBe(0)
      // A synthesised authority record would have shown up here.
      expect(room.approvers.some((id) => id === "WS-7+")).toBe(false)
    }
  })

  it("reports an EMPTY separation state as its own reason, not as evidence", async () => {
    const res = await authed()

    // `describeRoomSeparation` answers `separated: true` for an empty registry,
    // which is correct — a collision needs an approval to collide with — and is
    // reported verbatim rather than back-projected. The BUILD REGISTRY's reason
    // is what stops that boolean being read as "separation verified".
    expect(res.body.buildRegistry.recordCount).toBe(0)
    expect(res.body.buildRegistry.reason).toMatch(/no producer/i)
    expect(res.body.authorities.reason).toMatch(/no authority registry/i)

    for (const room of res.body.rooms) {
      expect(room.builders, `${room.roomKey} has no build evidence`).toEqual([])
      expect(room.collisions).toEqual([])
      expect(room.separated).toBe(true)
      expect(room.builderCount).toBe(0)
    }
  })

  it("copies T16's aggregate collision verdict rather than re-deriving it", async () => {
    const res = await authed()

    expect(res.body.separation.code).toBe("authority:collide:build-approve")
    expect(res.body.separation.collisionCount).toBe(0)
    expect(res.body.separation.ok).toBe(true)
    // The two numbers a reader compares the readout against a registry that
    // should exist. Both being zero is the current, true, named fact.
    expect(res.body.separation.approverAuthorityCount).toBe(0)
    expect(res.body.separation.roomsWithAnApprover).toBe(0)
  })

  it("reports the permit store as holding no broker and no change", async () => {
    const res = await authed()

    expect(res.body.permits.brokers).toEqual([])
    expect(res.body.permits.changeCount).toBe(0)
    expect(res.body.permits.grants).toEqual([])
    // Entry 0024 handoff #4: the permit store has no caller. The reason names
    // the task that owns the wiring rather than leaving the absence silent.
    expect(res.body.permits.reason).toMatch(/no broker record is wired/i)
  })

  it("carries T16's refusal codes verbatim, so the surface cannot drift from the writer", async () => {
    const res = await authed()

    const codes = res.body.refusalCodes.map((entry) => entry.code)
    // Copied from the producing modules' own exported constants rather than
    // retyped, so a rename in T16 surfaces here instead of leaving the room
    // advertising a code nothing throws.
    expect(codes).toContain("authority:collide:build-approve")
    expect(codes).toContain("authority:error:unknown-authority")
    expect(codes).toContain("authority:error:invalid-build-record")
    expect(codes).toContain("authority:deny:automation-permit-no-approving-authority")
    expect(codes).toContain("authority:deny:unknown-broker")
    expect(codes).toContain("authority:error:invalid-permit-change")
    for (const entry of res.body.refusalCodes) {
      expect(typeof entry.message, `${entry.code} carries a message`).toBe("string")
      expect(entry.message.length).toBeGreaterThan(0)
    }
  })

  it("answers 405-shaped rejections as the dispatch's own, and never on POST", async () => {
    // One dispatch spelling, GET only. A POST to the same path must fall through
    // rather than be served by a read route — a governance surface that accepted
    // a write nobody authorised would be the AC-024 direction T16 warns about.
    const api = await loadHandlers()
    const posted = await call(api, "POST", ROUTE, { roomKey: "markets" })
    expect(posted.status).not.toBe(200)
  })

  it("does not depend on the Ceremony route or its store to answer", async () => {
    // The bisect line at spec :1271 — "neither room may depend on the other to
    // render; both degrade to reserved independently". On the server this is the
    // same claim: the Ministry readout reads only `services/authority/`, so it
    // answers with the ceremony store absent from the module graph entirely. A
    // cross-import here would make a Ceremony outage take Ministry down with it.
    //
    // ASSERTED ON CODE, NOT ON RAW TEXT, and that is the point rather than a
    // convenience. This module's header explains WHY it does not depend on the
    // ceremony readout, so the word "ceremony" necessarily appears in it — which
    // is exactly the failure `ws7RouteAuthCoverageGuard.test.mjs` documents: a
    // raw scan reads a comment as a call site and then reports a documented
    // property as an unfixed defect. The same lesson, applied here, is that a
    // comment is prose and a cross-import is structure; only the latter is a
    // dependency.
    const fs = await import("node:fs")
    const raw = fs.readFileSync(new URL("../services/authority/governance.mjs", import.meta.url), "utf8")
    const code = raw
      .split("\n")
      .map((line) => {
        // Strip a trailing `//` comment only when the `//` is not inside a
        // string. The module's own literals contain no `//`, so the simple
        // spelling below is exact for this file and does not need the full
        // string-aware lexer the route guard grew.
        const at = line.indexOf("//")
        return at === -1 ? line : line.slice(0, at)
      })
      .join("\n")

    // No import of the ceremony store, gates or route. The CLAIM is about
    // imports specifically, because `ceremony` is legitimately one of the 15
    // frozen room keys in `GOVERNANCE_ROOM_KEYS` — asserting the word is absent
    // would forbid the Ministry room from reporting on the Ceremony room, which
    // is the opposite of what the freeze requires. Data is not a dependency.
    expect(code, "governance.mjs must not import the ceremony modules").not.toMatch(/commandCentre/)
    const imports = [...code.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((m) => m[1])
    expect(imports.length, "the readout must declare its imports").toBeGreaterThan(0)
    for (const specifier of imports) {
      // Every import is a SIBLING in its own directory. A specifier that
      // reached up into `commandCentre/` would be the cross-dependency T8's
      // bisect line forbids, and this is checked structurally rather than by
      // reading a list of module names — so a NEW import to any other directory
      // fails here without anyone having to remember to extend the assertion.
      expect(
        specifier.startsWith("./"),
        `governance.mjs may only import its own siblings; it imported ${specifier}`
      ).toBe(true)
    }
    // And the ceremony room is still REPORTED, which is what the freeze wants.
    expect(code).toMatch(/"ceremony"/)
  })
})
