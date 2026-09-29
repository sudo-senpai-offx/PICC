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
//
// WHAT NO TEST HERE CAN PROVE, stated up front so nobody reads the passing suite
// as more than it is. A proxy that forwards the CLIENT'S OWN X-Forwarded-For,
// rather than overwriting it or appending to it, is a universal per-IP bypass and
// this code cannot detect it. With `PICC_TRUSTED_PROXY_IPS=10.0.0.1` and peer
// 10.0.0.1, a header of `1.0.0.1, 10.0.0.1` resolves to 1.0.0.1 and
// `2.0.0.1, 10.0.0.1` resolves to 2.0.0.1 — a caller appending a
// trusted-looking entry to its own address gets a fresh limiter identity per
// request. The walk is bounded by allowlist membership and the left-hand entries
// are the client's to write, so a CORRECT chain and a PADDED forgery are
// indistinguishable here by construction. It is the nginx
// `proxy_set_header X-Forwarded-For $http_x_forwarded_for;` misconfiguration, and
// the only thing that prevents it is the deployment contract documented in
// .env.example. The test below pins that the server half is right; the proxy half
// is an operator obligation, and this file is not evidence of it.
import { readFileSync } from "node:fs"
import { isIP } from "node:net"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useIsolatedStoreDir } from "../../testSupport/storeIsolation.mjs"
// WS-7 slice A: the store is redirected through the SHARED CONTRACT rather than
// by hand. The previous version of this file hand-assigned the PICC_DATA_DIR
// variable in its own beforeEach, which ws7TestStoreIsolation flags (DETECTOR
// 2) for good reason: a hand-rolled redirect is a redirect nothing accounts for,
// so a misspelling or a real-store value in one is silent. The helper mints the
// directory, asserts it is not the real server/data, and REFUSES a name the
// contract does not know.
//
// The wording above is deliberately not the assignment itself. DETECTOR 2 scans
// raw source and does not strip comments, so writing the old expression out here
// to explain it would make this file a finding again — the same
// comment-vs-code trap ws7AuthBootstrapGateGuard documents at length.
//
// Minted ONCE at module scope, before any handler import, and the harness empties
// helper-minted directories between tests — so each case still starts with an
// empty store without this file owning a teardown. The return value is not bound:
// the harness re-points PICC_DATA_DIR itself, and a local name for it here would
// only suggest this file manages the store, which is exactly the thing it must
// not do.
useIsolatedStoreDir("PICC_DATA_DIR", { prefix: "picc-ratelimit-identity" })

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

let handleApi

// Re-import handlers.mjs per test, and delete the proxy variable rather than
// setting it: the rate-limit bucket map is module-scope state, so a fresh module
// graph is what gives each case an empty one. PICC_DATA_DIR is NOT touched here —
// the harness owns it, and the helper's directory is emptied between tests.
beforeEach(async () => {
  delete process.env[PROXY_ENV]
  vi.resetModules()
  handleApi = (await import("../handlers.mjs")).handleApi
})

afterEach(() => {
  delete process.env[PROXY_ENV]
  vi.resetModules()
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

/**
 * THE SHIPPED DOCUMENTATION IS PART OF THE INTERFACE.
 *
 * `.env.example` is the only place an operator learns how to configure this, and
 * it is the file they copy from. So a predicate that silently rejects half of the
 * value its own example ships is a defect with a distribution channel: the
 * operator sets what the docs say, the entry is dropped without a word, and per-IP
 * limits stay merged behind their proxy — which is the B1 defect, in the one
 * deployment the feature exists to fix.
 *
 * That is exactly what happened. `isPlausibleAddress`'s old IPv6 shape required
 * at least one hextet before the first colon, so every `::`-containing address
 * was rejected while `.env.example` documented
 * `PICC_TRUSTED_PROXY_IPS=127.0.0.1,::1`. The example's own IPv6 half was a
 * silent no-op. Both tests below are the ones that would have caught it.
 */
describe("WS-7 slice C — the allowlist predicate agrees with the platform and with .env.example", () => {
  /**
   * The predicate, lifted out of handlers.mjs as SOURCE and evaluated here.
   *
   * Reading it as text rather than importing it, because handlers.mjs exports no
   * address predicate and adding an export to reach a test would widen a
   * production surface for test convenience. The slice is delimited by the two
   * docstring anchors that bracket it, and the differential test below is what
   * makes the extraction trustworthy: it compares the extracted source against
   * `net.isIP` over a corpus, so a bad slice shows up as a corpus of false
   * negatives rather than as a silently passing test.
   */
  const HANDLERS = fileURLToPath(new URL("../handlers.mjs", import.meta.url))
  const ENV_EXAMPLE = fileURLToPath(new URL("../../.env.example", import.meta.url))
  const SRC = readFileSync(HANDLERS, "utf8")

  // Delimited by a PHRASE rather than by a whole line, deliberately. The
  // predicate's own docstring is expected to change when the predicate changes,
  // and an anchor pinned to its exact wording would make this test fail on
  // reworded prose rather than on wrong behaviour — the trap
  // ws7AuthBootstrapGateGuard documents. "An IPv4 dotted quad" is the phrase both
  // the previous and the current implementations open with, so a slice taken
  // against the old source compiles the OLD predicate and the assertions below
  // fail for the reason they were written. That is what makes the red half of
  // this file real rather than reconstructed.
  const SLICE_START_PHRASE = "An IPv4 dotted quad"
  const SLICE_END = "/**\n * Peer addresses whose X-Forwarded-For is honoured"

  /** The predicate under test, compiled from handlers.mjs's own text. */
  const predicateUnderTest = () => {
    const phrase = SRC.indexOf(SLICE_START_PHRASE)
    const end = SRC.indexOf(SLICE_END)
    expect(phrase, "the address predicate's opening phrase must still exist in handlers.mjs").not.toBe(-1)
    expect(end, "the address predicate's closing anchor must still exist in handlers.mjs").not.toBe(-1)
    expect(end, "the anchors must bracket the predicate, in order").toBeGreaterThan(phrase)
    // Walk back to the start of the docstring so the slice is the whole
    // declaration, comments and all — a half-slice would silently drop a
    // constant the predicate needs and fail as a ReferenceError instead.
    const start = SRC.lastIndexOf("/**", phrase)
    expect(start, "the predicate's opening docstring must precede its phrase").not.toBe(-1)
    // eslint-disable-next-line no-new-func
    return new Function(`${SRC.slice(start, end)}\nreturn isPlausibleAddress;`)()
  }

  it.each([
    ["IPv4 loopback", "127.0.0.1", true],
    ["IPv6 loopback", "::1", true],
    ["an IPv4-mapped IPv6 address", "::ffff:127.0.0.1", true],
    ["a compressed IPv6 address", "2001:db8::1", true],
    ["the unspecified IPv6 address", "::", true],
    ["a zone-scoped link-local address", "fe80::1%eth0", true],
    ["a full eight-hextet IPv6 address", "2001:db8:0:0:0:0:0:1", true],
    ["a trailing-compressed address", "1:2:3:4:5:6:7::", true],
    ["a leading-compressed address", "::1:2:3:4:5:6:7", true],
    ["a dotted quad as the final hextet pair", "::ffff:1.2.3.4", true],
    ["an octet above 255", "256.1.1.1", false],
    ["an octet with a leading zero", "10.0.0.01", false],
    ["a hostname", "localhost", false],
    ["free text", "not-an-ip", false],
    ["an address with a port", "198.51.100.7:port", false],
    ["whitespace", "   ", false],
    ["the empty string", "", false],
    ["seven hextets with no compression", "1:2:3:4:5:6:7", false],
    ["nine hextets", "1:2:3:4:5:6:7:8:9", false],
    ["two compressed runs", "1::2::3", false]
  ])("%s is %s", (_label, value, expected) => {
    // The differential half. Every row below agrees with `net.isIP` on this
    // runtime — asserted separately — so what is being tested here is the
    // PREDICATE, not the platform's opinion.
    expect(
      predicateUnderTest()(value),
      `isPlausibleAddress(${JSON.stringify(value)}) must be ${expected}. A wrong answer here drops ` +
        "a legitimate proxy from the allowlist with no diagnostic, which silently re-creates the " +
        "server-wide bucket this slice removed."
    ).toBe(expected)
  })

  it("agrees with net.isIP on the whole corpus, so the table above is a sample and not the claim", () => {
    const CORPUS = [
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
      "10.0.0.01",
      "10.0.0.1",
      "::",
      "fe80::1%eth0",
      "0.0.0.0",
      "255.255.255.255",
      "256.1.1.1",
      "2001:db8:0:0:0:0:0:1",
      "2001:db8:0:0:0:0:2:1",
      "1:2:3:4:5:6:7:8",
      "1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:8:9",
      "1::2::3",
      "::ffff:0:0",
      "1.2.3.4.5",
      "not-an-ip",
      "999.999.999.999",
      "198.51.100.7:port",
      "   ",
      "",
      "localhost",
      "1.0.0.1, 10.0.0.1",
      "01.2.3.4",
      "1.2.3.04",
      "0.0.0.00",
      "::1%",
      "::1%bad zone",
      "1:2:3:4:5:6:1.2.3.4",
      "1:2:3:4:5:6:7:1.2.3.4",
      "::1.2.3.4",
      "fe80::1%25eth0",
      "1:2:3:4:5:6:7::",
      "::1:2:3:4:5:6:7"
    ]
    const mismatches = CORPUS.filter((value) => predicateUnderTest()(value) !== (isIP(value) !== 0))
    expect(
      mismatches,
      "the hand-written predicate in handlers.mjs must agree with net.isIP on every corpus entry. It is " +
        "hand-written rather than imported so this file keeps its 73 static imports — correctness is bought " +
        "with this comparison, so a disagreement is a defect, not a platform quirk."
    ).toEqual([])
  })

  it("EVERY entry of the .env.example allowlist example is honoured as written", () => {
    // The assertion that would have caught the compressed-IPv6 bug, and it is
    // written against the DOCUMENT rather than a literal: if the example changes,
    // this follows it, which is the point — the failure mode being guarded is
    // documentation and code disagreeing.
    const example = readFileSync(ENV_EXAMPLE, "utf8")
    const line = example.split("\n").find((l) => /^#\s*PICC_TRUSTED_PROXY_IPS=/.test(l))
    expect(line, ".env.example must still document PICC_TRUSTED_PROXY_IPS, or this test is vacuous").toBeDefined()

    const value = line.replace(/^#\s*PICC_TRUSTED_PROXY_IPS=/, "").trim()
    const entries = value.split(",").map((e) => e.trim()).filter(Boolean)
    expect(entries.length, "the example must still carry more than one entry, or it proves nothing").toBeGreaterThan(1)

    const rejected = entries.filter((entry) => !predicateUnderTest()(entry))
    expect(
      rejected,
      `the .env.example allowlist example ${JSON.stringify(value)} contains entries the predicate ` +
        "REJECTS. An operator who copies this value gets those proxies silently dropped, every client " +
        "collapses onto the proxy address, and the per-IP limits this slice added stay server-wide — a " +
        "failure with no diagnostic, in the exact deployment the setting exists for."
    ).toEqual([])

    // And the corpus the two forms above would break on, so a future narrowing of
    // the predicate cannot pass by only re-testing loopback.
    expect(
      entries.some((e) => e.includes(":")),
      "the example should include an IPv6 entry, which is the form the old predicate rejected"
    ).toBe(true)
  })

  it("the deployment contract .env.example carries names the forwarding requirement", () => {
    const example = readFileSync(ENV_EXAMPLE, "utf8")
    const section = example.slice(
      example.indexOf("# --- Trusted reverse proxies"),
      example.indexOf("# --- Error logging")
    )
    expect(section, "the .env.example trusted-proxy section must exist").not.toBe("")
    // The words that carry the contract, checked as separate assertions because
    // each is a claim a reader could otherwise miss: MUST for the requirement,
    // and a named failure for the consequence.
    expect(section, "the contract must require the proxy to set the header itself").toMatch(/MUST/i)
    expect(section, "the contract must forbid forwarding the client's own copy").toMatch(/not\s+forward|NEVER|do not/i)
    expect(section, "the contract must name the bypass consequence").toMatch(/bypass/i)
  })
})
