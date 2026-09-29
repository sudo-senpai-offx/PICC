// WS-7 slice C — the rate limiter's KEY is a client identity, and the identity is
// only as good as its source.
//
// TWO DEFECTS, ONE LAYER APART.
//
//   B1. `rateLimited(key, limit, windowMs)` keys purely on the string it is given,
//       and `rateBuckets` is one process-wide Map. Eleven call sites exist; seven of
//       them interpolate `clientIp(req)` and FOUR are bare literals — "packs",
//       "packs-ack", "webfetch-limits", "webfetch-limits-reset". Those four are
//       therefore ONE server-wide bucket each, shared by every user of the process.
//       `PackRegistryStrip` polls /api/packs/registry every 30s
//       (PackRegistryStrip.tsx:27,127), so a handful of concurrent users on one host
//       spends the 30/min budget among themselves with no abuse anywhere.
//
//   B2. `clientIp(req)` was `req.socket?.remoteAddress ?? "unknown"`, with no
//       proxy-header handling at all. So the seven "per-IP" limiters are per-IP
//       only for DIRECT connections: behind any reverse proxy or load balancer
//       every client collapses to one address and they are global too.
//
// THE SECURITY TRADE-OFF, STATED BEFORE THE FIX. Honouring X-Forwarded-For
// blindly lets ANY caller escape every per-IP limiter by sending a different
// header value per request — which converts the limiter from a control into
// decoration. So the header is read only when the immediate peer is a CONFIGURED
// TRUSTED PROXY. The allowlist defaults to EMPTY, so an unconfigured deployment
// behaves exactly as it does today rather than becoming newly vulnerable the
// moment this lands.
//
// WHAT IS DELIBERATELY NOT IN clientIp(). The loopback bypass.
//
// `requireAuth` admits any request whose peer address is loopback
// (isLocalhostRequest), so the two functions must not be the same function. A
// forwarded `X-Forwarded-For: 127.0.0.1` arriving from a TRUSTED proxy would
// otherwise walk straight through the auth gate. The bypass keeps reading the
// socket address, which is the one thing the server observed rather than was
// told; the limiter gets the resolved identity. That split is asserted below
// ("a forwarded loopback address is not a localhost request"), because it is the
// most damaging way this change could have been written.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const PROXY_ENV = "PICC_TRUSTED_PROXY_IPS"

const ACK = { packId: "pack1-local-trading-core", stepId: "p1-1-eo-session-capture" }
const PACKS = "/api/packs/registry"
const LIMITS = "/api/webfetch/limits"

// The per-IP limiter the B2 cases use, and the reason it is not the same route as
// the B1 cases: POST /api/auth/login is already keyed `auth:${clientIp(req)}` at
// 10/60s, and with no account in the store it answers 401 without ever reaching
// scrypt. So it isolates the key namespace at a tenth of the request cost, which
// is what lets each of the table-driven cases below run inside the suite's 5s
// per-test budget without that budget being raised — raising a global timeout to
// fit a new test would hide the next genuine hang.
const LOGIN = "/api/auth/login"
const LOGIN_BUDGET = 10

function makeReq(method, path, { remoteAddress = "127.0.0.1", headers = {}, body } = {}) {
  const raw = body === undefined ? null : JSON.stringify(body)
  return {
    method,
    url: path,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: remoteAddress === null ? {} : { remoteAddress },
    raw,
    // The body stream is delivered SYNCHRONOUSLY, which is the same idiom
    // packRegistryApi.test.mjs uses and is load-bearing: handleApi awaits the
    // stream's "end" on the shared body read, so a req whose `on` never fires
    // makes every route hang rather than answer.
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

async function call(handleApi, method, path, opts = {}) {
  const res = makeRes()
  await handleApi(makeReq(method, path, opts), res, path)
  return res
}

/** `n` requests from one identity; returns the LAST response. */
async function burst(handleApi, method, path, opts, n) {
  let last
  for (let i = 0; i < n; i += 1) last = await call(handleApi, method, path, opts)
  return last
}

const from = (ip) => ({ remoteAddress: ip })
const viaProxy = (peer, forwarded) => ({ remoteAddress: peer, headers: { "x-forwarded-for": forwarded } })

let dir
let handleApi

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "picc-ratelimit-identity-"))
  process.env.PICC_DATA_DIR = dir
  delete process.env[PROXY_ENV]
  vi.resetModules()
  handleApi = (await import("../handlers.mjs")).handleApi
})

afterEach(() => {
  delete process.env.PICC_DATA_DIR
  delete process.env[PROXY_ENV]
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

describe("WS-7 slice C — the four bare limiter keys are per-CLIENT, not per-process", () => {
  it("a second user's poll of /api/packs/registry is not spent by the first user's", async () => {
    // The PackRegistryStrip scenario, at its real numbers: 30 reads per 60s.
    await burst(handleApi, "GET", PACKS, from("198.51.100.10"), 30)
    const second = await call(handleApi, "GET", PACKS, from("198.51.100.11"))
    expect(
      second.status,
      'a bare "packs" key is one bucket for the whole process, so one user\'s 30-read poll budget is ' +
        "gone by the time the next user polls — with no abuse anywhere"
    ).toBe(200)
  })

  it("a second user's poll of /api/webfetch/limits is not spent by the first user's", async () => {
    await burst(handleApi, "GET", LIMITS, from("198.51.100.10"), 30)
    const second = await call(handleApi, "GET", LIMITS, from("198.51.100.11"))
    expect(second.status, 'the "webfetch-limits" key is bare, so it is server-wide').toBe(200)
  })

  it("a second user's POST to /api/packs/ack is not spent by the first user's", async () => {
    // 10 per 60s. The limiter runs BEFORE requireAuth, so an anonymous caller
    // consumes the budget — which is the point of it, and also why a shared
    // bucket lets one caller lock every other user out of a route.
    await burst(handleApi, "POST", "/api/packs/ack", { ...from("198.51.100.10"), body: ACK }, 10)
    const second = await call(handleApi, "POST", "/api/packs/ack", { ...from("198.51.100.11"), body: ACK })
    expect(
      second.status,
      'the "packs-ack" key is bare, so a shared budget of 10/min is a denial of service on every ' +
        "other user of the process"
    ).not.toBe(429)
  })

  it("a second user's POST to /api/webfetch/limits/reset is not spent by the first user's", async () => {
    await burst(handleApi, "POST", "/api/webfetch/limits/reset", from("198.51.100.10"), 10)
    const second = await call(handleApi, "POST", "/api/webfetch/limits/reset", from("198.51.100.11"))
    expect(second.status, 'the "webfetch-limits-reset" key is bare, so it is server-wide').not.toBe(429)
  })

  it("CONTROL: the four routes are still four budgets, and each caps its OWN identity", async () => {
    // If the four were collapsed into a SINGLE interpolated key this would still
    // pass, so it is the control for the fix above rather than evidence for it.
    await burst(handleApi, "GET", PACKS, from("198.51.100.10"), 30)
    expect(
      (await call(handleApi, "GET", PACKS, from("198.51.100.10"))).status,
      "30/60s must still throttle the identity that spent it"
    ).toBe(429)
    expect(
      (await call(handleApi, "GET", LIMITS, from("198.51.100.10"))).status,
      "the sibling route has its own budget"
    ).toBe(200)
  })
})

describe("WS-7 slice C — X-Forwarded-For is honoured ONLY from a configured trusted proxy", () => {
  /** A fresh module graph, so the in-process limiter map starts empty. */
  const reload = async (proxies) => {
    if (proxies === undefined) delete process.env[PROXY_ENV]
    else process.env[PROXY_ENV] = proxies
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
  }

  it("THE DEFAULT: with no allowlist configured the header is ignored, exactly as today", async () => {
    // The unconfigured deployment must behave as it did: an environment that
    // never set the variable gains no new attack surface from this change.
    await reload(undefined)
    await burst(handleApi, "GET", PACKS, viaProxy("203.0.113.9", "198.51.100.1"), 30)
    const spoofed = await call(handleApi, "GET", PACKS, viaProxy("203.0.113.9", "198.51.100.2"))
    expect(
      spoofed.status,
      "an EMPTY allowlist must behave like today's code: the socket address is the identity, so a " +
        "spoofed header cannot buy a fresh budget"
    ).toBe(429)
  })

  it("THE CRITICAL CASE: an UNTRUSTED peer cannot buy a fresh budget with a spoofed header", async () => {
    // The allowlist is populated and the caller's peer is NOT on it. Honouring the
    // header here would let ANY caller mint unlimited limiter identities by
    // varying one header — so this must be the socket address's bucket, and 30
    // distinct forged values must still land in ONE bucket.
    await reload("10.0.0.1")
    const peer = "203.0.113.9"
    for (let i = 0; i < 30; i += 1) {
      const res = await call(handleApi, "GET", PACKS, viaProxy(peer, `198.51.100.${i}`))
      expect(res.status, `request ${i} must be inside the budget`).toBe(200)
    }
    const thirtyFirst = await call(handleApi, "GET", PACKS, viaProxy(peer, "198.51.100.999"))
    expect(
      thirtyFirst.status,
      "thirty distinct forged X-Forwarded-For values from an untrusted peer must share ONE bucket. A " +
        "200 here means the header is trusted from an arbitrary caller, which disables every per-IP " +
        "limiter in the file."
    ).toBe(429)
  })

  it("a TRUSTED peer with one hop is resolved from the header", async () => {
    await reload("10.0.0.1")
    const peer = "10.0.0.1"
    await burst(handleApi, "GET", PACKS, viaProxy(peer, "198.51.100.20"), 30)
    expect(
      (await call(handleApi, "GET", PACKS, viaProxy(peer, "198.51.100.20"))).status,
      "the forwarded identity is the one that gets limited"
    ).toBe(429)
    expect(
      (await call(handleApi, "GET", PACKS, viaProxy(peer, "198.51.100.21"))).status,
      "behind a trusted proxy every client collapses onto the proxy's address, so the seven existing " +
        "per-IP limiters are server-wide too — this is the defect the allowlist exists to fix"
    ).toBe(200)
  })

  it("a TRUSTED peer with SEVERAL hops takes the entry for the number of trusted hops", async () => {
    // Two proxies: the immediate peer is 10.0.0.2 and the header carries
    // `client, 10.0.0.1`. Walking right-to-left and stopping at the first entry
    // that is NOT a trusted proxy is what makes this correct: the leftmost entry
    // is the client, and the proxy-append on its right is what vouches for it.
    await reload("10.0.0.1, 10.0.0.2")
    const peer = "10.0.0.2"
    const oneHop = viaProxy(peer, "198.51.100.30, 10.0.0.1")
    const twoHops = viaProxy(peer, "198.51.100.30, 10.0.0.1, 10.0.0.2")
    await burst(handleApi, "GET", PACKS, oneHop, 30)
    expect((await call(handleApi, "GET", PACKS, oneHop)).status, "the one-hop form is limited after 30").toBe(429)
    expect(
      (await call(handleApi, "GET", PACKS, twoHops)).status,
      "a LONGER list naming the same client must resolve to the SAME identity, not a fresh budget — " +
        "taking the leftmost entry unconditionally is how a proxy chain hands out unlimited identities"
    ).toBe(429)
    expect(
      (await call(handleApi, "GET", PACKS, viaProxy(peer, "198.51.100.31, 10.0.0.1"))).status,
      "a different client behind the same proxy chain is a different identity"
    ).toBe(200)
  })

  it("an all-trusted header list falls back to the socket address", async () => {
    // Every entry is a trusted proxy, so there is no client in the list to name.
    // Answering "some entry" here would be a guess, and a guess about identity
    // feeds a security control.
    await reload("10.0.0.1, 10.0.0.2")
    const peer = "10.0.0.2"
    await burst(handleApi, "GET", PACKS, viaProxy(peer, "10.0.0.1"), 30)
    expect(
      (await call(handleApi, "GET", PACKS, viaProxy(peer, "10.0.0.2, 10.0.0.1"))).status,
      "a list with no untrusted entry cannot identify a client, so the socket address is used"
    ).toBe(429)
  })

  it.each([
    ["not an address at all", "not-an-ip"],
    ["an out-of-range octet", "999.999.999.999"],
    ["an address with a port", "198.51.100.7:port"],
    ["whitespace only", "   "],
    ["a trailing separator", "198.51.100.7,"]
  ])("a MALFORMED header (%s) from a trusted peer falls back to the socket address", async (_label, malformed) => {
    // A permissive parse here is how a malformed header turns into an identity
    // nobody can reason about, and a limiter keyed on an unparseable value is a
    // limiter keyed on whatever the parser happened to return.
    await reload("10.0.0.1")
    const peer = "10.0.0.1"
    await burst(handleApi, "POST", LOGIN, { ...viaProxy(peer, malformed), body: {} }, LOGIN_BUDGET)
    expect(
      (await call(handleApi, "POST", LOGIN, { ...from(peer), body: {} })).status,
      `a malformed header ${JSON.stringify(malformed)} must fall back to the socket address, so the ` +
        "socket bucket is shared with it"
    ).toBe(429)
  })

  it("an ABSENT header from a trusted peer is the socket address", async () => {
    await reload("10.0.0.1")
    const peer = "10.0.0.1"
    await burst(handleApi, "GET", PACKS, from(peer), 30)
    expect(
      (await call(handleApi, "GET", PACKS, viaProxy(peer, ""))).status,
      "an empty X-Forwarded-For is an absent header, not an identity"
    ).toBe(429)
  })

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["separators only", ",,,"],
    ["a single unparseable entry", "not-an-ip"],
    ["an unparseable entry beside a real one", "10.0.0.1, ,10.0.0.2"]
  ])("an unparseable allowlist (%s) trusts nothing rather than everything", async (_label, value) => {
    // The fail-closed direction for configuration. A variable that cannot be
    // parsed must not be treated as "no restriction" — that is the difference
    // between a typo costing a deployment its per-IP accuracy and a typo handing
    // every caller a fresh limiter identity.
    await reload(value)
    await burst(handleApi, "POST", LOGIN, { ...viaProxy("10.0.0.1", "198.51.100.40"), body: {} }, LOGIN_BUDGET)
    expect(
      (await call(handleApi, "POST", LOGIN, { ...viaProxy("10.0.0.1", "198.51.100.40"), body: {} })).status,
      `allowlist ${JSON.stringify(value)} must not resolve to "trust everything"; a typo in a ` +
        "deployment variable must fail closed"
    ).toBe(429)
  })

  it("a forwarded LOOPBACK address does not become a localhost request", async () => {
    // The dangerous one. requireAuth() admits a loopback PEER, and
    // isLocalhostRequest() must therefore keep reading the socket address rather
    // than the resolved identity: a client that can send X-Forwarded-For through a
    // trusted proxy must not be able to talk its way past the auth gate.
    //
    // A real account is created first, so requireAuth's first-user bootstrap
    // bypass is closed. Without it the gate legitimately admits anyone and the
    // assertion would pass for the wrong reason — the guard this file is really
    // pinning is the one that distinguishes a loopback peer from a forwarded
    // loopback, and an open first-run store hides exactly that difference.
    const { createAccount } = await import("../services/auth.mjs")
    const seeded = await createAccount({ email: "loopback@example.test", password: "loopback-pass-1", name: "L" })
    expect(seeded?.token, "the seed account must exist, or the bootstrap bypass is open").toBeTruthy()

    await reload("10.0.0.1")
    const res = await call(handleApi, "POST", "/api/packs/ack", { ...viaProxy("10.0.0.1", "127.0.0.1"), body: ACK })
    expect(
      res.status,
      "a trusted proxy forwarding 127.0.0.1 walked through the auth gate. The loopback bypass must " +
        "read the SOCKET address; only the rate-limit key may be header-resolved."
    ).toBe(401)
  })

  it("a peer with NO address cannot be pushed into the address-less bucket by a header", async () => {
    // `clientIp` used to answer the literal "unknown" when the socket carried no
    // address, which put every such caller in one shared bucket — a server-wide
    // bucket by another name. It is kept (a limiter with no identity has to be
    // conservative, not permissive), but it must be UNREACHABLE from a header, so
    // nobody can choose to hide in it.
    await reload("10.0.0.1")
    const noPeer = (forwarded) => ({
      remoteAddress: null,
      headers: { "x-forwarded-for": forwarded }
    })
    await burst(handleApi, "GET", PACKS, noPeer("198.51.100.50"), 30)
    expect(
      (await call(handleApi, "GET", PACKS, noPeer("198.51.100.51"))).status,
      "a request with no peer address must not be able to select its own limiter bucket with a header"
    ).toBe(429)
  })
})
