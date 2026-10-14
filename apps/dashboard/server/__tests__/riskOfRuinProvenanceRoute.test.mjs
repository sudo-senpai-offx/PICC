// UI-4 — the risk-of-ruin ROUTE over the wire: the provenance the function
// builds must actually reach the caller, through the real auth gate.
//
// THE FUNCTION CONTRACT IS PROVEN IN `riskOfRuinProvenance.test.mjs`. This file
// exists because that one calls `riskOfRuin` directly, and the defect being
// fixed was never only in the function: the ROUTE substituted four numbers of its
// own first, and a function that records provenance perfectly is worth nothing if
// the layer in front of it has already replaced the caller's values. So the two
// directions the brief demands are proved HERE, over HTTP, with a real session:
//
//   * POST NOTHING          → every input marked assumed, each substitute named.
//   * POST EXPLICIT VALUES  → nothing marked assumed.
//
// The second direction is the one that catches a client rendering "assumed" over
// a number the user actually typed, which is its own dishonesty in the opposite
// direction. Neither can be asserted against the function alone, because the
// route's own substitution is precisely what would break it.
//
// ── THE HARNESS ──────────────────────────────────────────────────────────────
// Same shape as `routeAuthRuling24Gates.test.mjs`, for the same two reasons,
// both load-bearing and both recorded there:
//   * NO `socket` on the request. `requireAuth` admits a request outright when
//     `isLocalhostRequest(req)` is true and that predicate reads the real TCP
//     peer, so a harness supplying a loopback address takes that bypass and the
//     "anonymous" caller ends up inside the trust boundary.
//   * A SEEDED USER. With an empty user store `requireAuth` takes its first-run
//     bootstrap branch and admits everyone, which would make every assertion here
//     pass for the wrong reason.
// And the seed is per TEST, because the shared `vitestStoreIsolation.setup.mjs`
// empties every helper-minted scratch directory in its own `beforeEach`, which
// runs before this file's.
//
// Hermetic: every store is redirected through the SHARED `useIsolatedStoreDir`
// helper, never by assigning `process.env`, because `ws7TestStoreIsolation`
// enumerates the suite via `git ls-files` and refuses a hand-rolled assignment.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"

const TOKEN = "d".repeat(64)
const USER_ROW = {
  id: "u-roe",
  email: "roe@example.test",
  name: "Roe",
  salt: "s",
  passwordHash: "h",
  createdAt: 1
}

function makeReq(method, path, body, headers = {}) {
  const raw = body === null || body === undefined ? null : JSON.stringify(body)
  return {
    method,
    url: path,
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

const INPUT_FIELDS = ["winRate", "avgPayout", "riskPct", "balance"]

let api = null
let authDir = null
let tradingDir = null
const dirs = []

function writeJson(dir, name, value) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(value), "utf8")
}

/** One account plus a live session, in the redirected auth store. */
function seedSession() {
  mkdirSync(authDir, { recursive: true })
  writeJson(authDir, "users.json", { users: [USER_ROW] })
  writeJson(authDir, "sessions.json", {
    sessions: { [TOKEN]: { userId: "u-roe", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 } }
  })
}

/**
 * A resolved-signal ledger whose win rate is 75 — DELIBERATELY not 50.
 *
 * The server's own constant default for `winRate` is 50, so a ledger-sourced
 * answer that happens to equal 50 would make "the ledger was used" and "the
 * constant was used" indistinguishable, and this file's whole point is telling
 * those two apart. 3 wins in 4 resolved signals.
 */
function seedLedger(winRate) {
  const resolved =
    winRate === undefined
      ? []
      : Array.from({ length: 4 }, (_, i) => ({
          id: `s${i}`,
          status: "resolved",
          resolution: i < winRate / 25 ? "win" : "loss",
          createdAt: Date.now()
        }))
  writeJson(tradingDir, "trading-ledger.json", { positions: [], closed: [], signals: resolved })
}

async function post(body, headers = { authorization: `Bearer ${TOKEN}` }) {
  const res = makeRes()
  const path = "/api/trading/risk-of-ruin"
  await api(makeReq("POST", path, body, headers), res, path)
  return res
}

beforeAll(async () => {
  for (const [name, prefix] of [
    ["PICC_AUTH_DATA_DIR", "roe-auth"],
    ["PICC_TRADING_DATA_DIR", "roe-trading"],
    ["PICC_DATA_DIR", "roe-data"]
  ]) {
    const dir = useIsolatedStoreDir(name, { prefix })
    dirs.push(dir)
    if (name === "PICC_AUTH_DATA_DIR") authDir = dir
    if (name === "PICC_TRADING_DATA_DIR") tradingDir = dir
  }
  const mod = await import("../handlers.mjs?roe-provenance")
  api = mod.handleApi
})

beforeEach(() => {
  // Re-seed AFTER the shared harness has emptied the directory, and write an
  // EMPTY ledger so the default case under test is "this instance has recorded
  // nothing yet" — the honest fresh-install state.
  seedSession()
  seedLedger(undefined)
})

afterAll(() => {
  for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe("UI-4 over the wire: posting NOTHING marks every input assumed", () => {
  it("a POST with an empty body answers 200 and names all four substitutes", async () => {
    const res = await post({})

    expect(res.status, `expected 200, got ${JSON.stringify(res.body)}`).toBe(200)
    expect(res.body.ok).toBe(true)

    // DIRECTION ONE. Every input is the server's, and the response says so.
    expect(res.body.provenance.assumedInputs.sort()).toEqual([...INPUT_FIELDS].sort())
    for (const field of INPUT_FIELDS) {
      const p = res.body.provenance[field]
      expect(p.state, `${field} state`).toBe("substituted")
      expect(p.supplied, `${field} supplied`).toBe(false)
      expect(p.substitute, `${field} names its substitute`).not.toBeNull()
      expect(typeof p.substitute.reason).toBe("string")
      expect(p.substitute.reason).toMatch(/caller sent/)
    }

    // AND THE SUBSTITUTES ARE THE ONES THE SERVER ACTUALLY USED — a record that
    // named a substitute the arithmetic ignored would be worse than none.
    expect(res.body.inputs.winRate).toBe(50)
    expect(res.body.inputs.avgPayout).toBe(0.8)
    expect(res.body.inputs.riskPct).toBe(2)
    expect(res.body.inputs.balance).toBe(1000)

    // AND THE PRE-EXISTING FIELDS ARE ALL STILL THERE. Additive only: a client
    // written against the old payload must keep working.
    for (const key of [
      "ok",
      "riskOfRuin",
      "riskOfRuinPct",
      "edge",
      "unitsToRuin",
      "expectedGrowthPct",
      "kellyFraction",
      "halfKellyPct",
      "inputs"
    ]) {
      expect(res.body, `${key} must survive`).toHaveProperty(key)
    }
  })

  it("a POST with NO BODY AT ALL behaves the same as an empty object", async () => {
    // `body` is undefined rather than `{}`, which is a different thing on the
    // wire and used to reach `Number(body?.winRate)` as `Number(undefined)`.
    const res = await post(undefined)
    expect(res.status).toBe(200)
    expect(res.body.provenance.assumedInputs.sort()).toEqual([...INPUT_FIELDS].sort())
  })

  it("an empty ledger is reported as a SERVER CONSTANT, not as a ledger reading", async () => {
    // `signalAccuracy()` answers `winRate: null` when nothing has resolved, so
    // this is the fresh-install case and it must not be dressed up as "your
    // recorded win rate". The `acc.winRate ?? 50` the route used to write could
    // not tell the two apart.
    const res = await post({})
    expect(res.body.provenance.winRate.substitute.source).toBe("server-constant")
    expect(res.body.provenance.winRate.substitute.value).toBe(50)
    expect(res.body.provenance.balance.substitute.source).toBe("server-constant")
  })

  it("a RECORDED ledger win rate is offered by name, and beats the constant", async () => {
    seedLedger(75)
    const res = await post({})
    const p = res.body.provenance.winRate
    expect(p.substitute.source).toBe("signal-accuracy-ledger")
    expect(p.substitute.value).toBe(75)
    expect(p.used).toBe(75)
    expect(res.body.inputs.winRate).toBe(75)
    // Still an assumption, and still named as one.
    expect(p.state).toBe("substituted")
    expect(res.body.provenance.assumedInputs).toContain("winRate")
  })

  it("a caller who sends winRate wins over the ledger", async () => {
    seedLedger(75)
    const res = await post({ winRate: 42 })
    expect(res.body.inputs.winRate).toBe(42)
    expect(res.body.provenance.winRate.state).toBe("supplied")
    expect(res.body.provenance.winRate.substitute).toBeNull()
  })
})

describe("UI-4 over the wire: posting EXPLICIT values marks nothing assumed", () => {
  it("all four in range → every input supplied, assumedInputs empty", async () => {
    const sent = { winRate: 55, avgPayout: 1, riskPct: 5, balance: 1000 }
    const res = await post(sent)

    expect(res.status).toBe(200)
    // DIRECTION TWO. This is the assertion a function-only test cannot make: the
    // route used to replace these with its own numbers before the function ever
    // saw them, so "supplied" here proves the route stopped substituting.
    expect(res.body.provenance.assumedInputs, "nothing was assumed").toEqual([])
    expect(res.body.provenance.clampedInputs, "nothing was clamped either").toEqual([])
    for (const field of INPUT_FIELDS) {
      expect(res.body.provenance[field].state, `${field} state`).toBe("supplied")
      expect(res.body.provenance[field].supplied, `${field} supplied`).toBe(true)
    }

    // AND `used` IS THE NUMBER THAT WAS TYPED — THE HALF `assumedInputs` ALONE
    // CANNOT SEE, AND IT IS THE HALF THAT MATTERS. Measured, not asserted: a
    // mutation that made the ROUTE discard two caller-supplied fields left
    // `assumedInputs` empty and every `state` reading "supplied", because the
    // function was faithfully reporting on values the route had already replaced
    // upstream of it. `state` answers "did the caller send this?"; `used`
    // answers "is this the number they sent?", and only the second one catches a
    // substitution that happened before the recorder was ever reached.
    for (const field of INPUT_FIELDS) {
      expect(res.body.provenance[field].used, `${field} must be the value that was sent`).toBe(sent[field])
    }

    // The arithmetic is the pre-existing one, unchanged.
    expect(res.body.unitsToRuin).toBe(20)
    expect(res.body.edge).toBe("10%")
  })

  it("a partial post names EXACTLY the fields that were absent", async () => {
    const res = await post({ riskPct: 5 })
    expect(res.body.provenance.assumedInputs.sort()).toEqual(["avgPayout", "balance", "winRate"])
    expect(res.body.provenance.riskPct.state).toBe("supplied")
  })

  it("an explicit null is an ABSENCE, and the response does not call it a zero", async () => {
    // `Number(null)` is 0. The old route read it as a measured 0% win rate and
    // reported it as supplied, so the two most different facts a caller can send
    // were indistinguishable on the wire.
    const res = await post({ winRate: null, avgPayout: 1, riskPct: 5, balance: 1000 })
    const p = res.body.provenance.winRate
    expect(p.supplied).toBe(false)
    expect(p.state).toBe("substituted")
    expect(p.substitute.reason).toMatch(/null/)
    expect(res.body.provenance.assumedInputs).toEqual(["winRate"])
  })

  it("an explicit 0 is a SUPPLIED value, and where it cannot be used the response says so", async () => {
    const res = await post({ winRate: 55, avgPayout: 0, riskPct: 0, balance: 1000 })
    expect(res.status).toBe(200)

    // riskPct 0 — no finite units-to-ruin, so it is clamped AND it says why.
    const rp = res.body.provenance.riskPct
    expect(rp.supplied).toBe(true)
    expect(rp.state).toBe("clamped")
    expect(rp.clamp).toMatchObject({ from: 0, to: 0.1 })
    expect(rp.clamp.note).toMatch(/unbounded|no finite/i)

    // avgPayout 0 — honoured exactly, because a trade that pays nothing is a real
    // thing and the old 0.01 floor could not express it.
    const ap = res.body.provenance.avgPayout
    expect(ap.state).toBe("supplied")
    expect(ap.used).toBe(0)
    expect(res.body.inputs.avgPayout).toBe(0)

    // A typed 0 is not an assumption in either field.
    expect(res.body.provenance.assumedInputs).toEqual([])
  })

  it("the route's gate is untouched: an anonymous POST still answers 401", async () => {
    // Stated here rather than only in `routeAuthRuling24Gates.test.mjs` because
    // this task rewrote the block the gate lives in, and a rewrite that quietly
    // moved or dropped a gate would be invisible to a test that never posts
    // anonymously.
    const res = await post({ winRate: 55 }, {})
    expect(res.status).toBe(401)
    expect(JSON.stringify(res.body ?? {}).toLowerCase()).not.toContain("riskofruin")
    expect(res.body.provenance, "a refusal carries no provenance at all").toBeUndefined()
  })
})