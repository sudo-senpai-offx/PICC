// Global PICC webfetch capability (owner directive 2026-09-13): honest outcome
// classification + polite per-host fair-use limiter (locally resettable) +
// captcha-gate DETECTION with no silent bypass. The detection table and the
// status mapping are the core of the honesty contract — table-tested here with
// no network (mock fetch, hermetic). See spec S3 notes for the researched
// captcha-solver material (hcaptcha-challenger, tesseract, turnstile solvers).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  detectCaptchaGate,
  hostOf,
  webfetchLimits,
  withinFairUse,
  recordHit,
  recordLimited,
  webFetchStats,
  resetWebFetchLimits,
  solverAdapter,
  webFetch
} from "../services/webfetch.mjs"

function rawRes(status, { body = "", headers = {}, text = null } = {}) {
  return {
    status,
    headers: { get: (k) => headers[k] ?? null, entries: () => Object.entries(headers) },
    text: async () => (text != null ? text : body)
  }
}

beforeEach(() => {
  resetWebFetchLimits()
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("detectCaptchaGate — pure classification table (no bypass, honest detection)", () => {
  it("hCaptcha widget body → hcaptcha", () => {
    const r = detectCaptchaGate({ status: 200, body: '<div class="h-captcha" data-sitekey="x"></div>' })
    expect(r.gated).toBe(true)
    expect(r.kind).toBe("hcaptcha")
    expect(r.markers.length).toBeGreaterThan(0)
  })

  it("reCAPTCHA body → recaptcha", () => {
    const r = detectCaptchaGate({ status: 403, body: 'grecaptcha.render("x")' })
    expect(r.kind).toBe("recaptcha")
  })

  it("Cloudflare Turnstile body → turnstile", () => {
    const r = detectCaptchaGate({ status: 403, body: '<div class="cf-turnstile" data-sitekey="0x4AAAA"></div>' })
    expect(r.kind).toBe("turnstile")
  })

  it('Cloudflare interstitial "Just a moment" → cloudflare-challenge (any status)', () => {
    const r = detectCaptchaGate({ status: 200, body: "<html>Just a moment... verifying your browser</html>" })
    expect(r.kind).toBe("cloudflare-challenge")
  })

  it("generic lowercase 'captcha' alone → unknown-captcha", () => {
    const r = detectCaptchaGate({ status: 403, body: "please verify you are not a bot by completing the captcha" })
    expect(r.kind).toBe("unknown-captcha")
  })

  it("a vendor marker wins over the generic catch", () => {
    const r = detectCaptchaGate({ status: 403, body: "hCaptcha challenge captcha" })
    expect(r.kind).toBe("hcaptcha")
  })

  it("cf-challenge header alone classifies (even with no body)", () => {
    const r = detectCaptchaGate({ status: 403, body: "", headers: { "cf-challenge": "captcha" } })
    expect(r.kind).toBe("cloudflare-challenge")
  })

  it("plain 403/404 bodies without captcha markers → null (NOT a gate)", () => {
    expect(detectCaptchaGate({ status: 403, body: "<html>forbidden</html>" })).toBeNull()
    expect(detectCaptchaGate({ status: 200, body: "<rss><channel><title>ok</title></channel></rss>" })).toBeNull()
  })
})

describe("fair-use limiter — polite per-host ceiling, resettable locally", () => {
  it("limits parse with conservative defaults", () => {
    delete process.env.PICC_WEBFETCH_MAX_RPM
    expect(webfetchLimits().maxRpm).toBe(30)
    process.env.PICC_WEBFETCH_MAX_RPM = "6"
    expect(webfetchLimits().maxRpm).toBe(6)
    process.env.PICC_WEBFETCH_MAX_RPM = "0" // invalid → default, never 0 (a 0 ceiling would block everything)
    expect(webfetchLimits().maxRpm).toBe(30)
  })

  it("withinFairUse respects the sliding window; hits expire after the window", () => {
    const now = 1_000_000
    const host = "feeds.example.com"
    for (let i = 0; i < 3; i++) recordHit(host, { now: now + i })
    expect(withinFairUse(host, { limits: { maxRpm: 3, windowMs: 60_000 }, now: now + 3 })).toBe(false)
    // after the window the old hits expire — 3 fresh slots free again
    expect(withinFairUse(host, { limits: { maxRpm: 3, windowMs: 60_000 }, now: now + 60_001 })).toBe(true)
  })

  it("resetWebFetchLimits clears windows and stamps sinceReset", () => {
    recordHit("a.example.com")
    recordLimited("a.example.com")
    expect(webFetchStats().hosts["a.example.com"].limited).toBe(1)
    resetWebFetchLimits()
    expect(webFetchStats().hosts).toEqual({})
  })
})

describe("webFetch — honest outcome mapping (no network, mock fetch)", () => {
  it("invalid URL → error invalid-url, never hits the wire", async () => {
    const fetcher = vi.fn()
    const r = await webFetch("not a url", { fetcher })
    expect(r.ok).toBe(false)
    expect(r.kind).toBe("error")
    expect(r.reason).toBe("invalid-url")
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("200 feed → ok with body + contentType", async () => {
    const fetcher = vi.fn(async () => rawRes(200, { body: "<?xml?><rss></rss>", headers: { "content-type": "application/rss+xml" } }))
    const r = await webFetch("https://feeds.example.com/news", { fetcher })
    expect(r.ok).toBe(true)
    expect(r.kind).toBe("ok")
    expect(r.status).toBe(200)
    expect(r.contentType).toBe("application/rss+xml")
    expect(r.body).toContain("<rss>")
  })

  it("429 → rate-limited upstream-429, retry-after surfaced", async () => {
    const fetcher = vi.fn(async () => rawRes(429, { headers: { "retry-after": "120" } }))
    const r = await webFetch("https://feeds.example.com/news", { fetcher })
    expect(r.ok).toBe(false)
    expect(r.kind).toBe("rate-limited")
    expect(r.retryAfterMs).toBe(120_000)
    expect(r.reason).toContain("upstream-429")
  })

  it("403 with a Cloudflare challenge → captcha-gated (kind cloudflare-challenge)", async () => {
    const fetcher = vi.fn(async () => rawRes(403, { body: "Checking your browser before accessing." }))
    const r = await webFetch("https://gated.example.com/news", { fetcher })
    expect(r.ok).toBe(false)
    expect(r.kind).toBe("captcha-gated")
    expect(r.captcha.kind).toBe("cloudflare-challenge")
  })

  it("200 interstitial body ('Just a moment') → captcha-gated, not ok (honest)", async () => {
    const fetcher = vi.fn(async () => rawRes(200, { body: "<html>Just a moment... enabling your browser.</html>" }))
    const r = await webFetch("https://gated.example.com/feed", { fetcher })
    expect(r.ok).toBe(false)
    expect(r.kind).toBe("captcha-gated")
    expect(r.reason).toContain("interstitial-challenge")
  })

  it("plain 403 → blocked (no captcha markers — an explicit denial)", async () => {
    const fetcher = vi.fn(async () => rawRes(403, { body: "<html>Access forbidden</html>" }))
    const r = await webFetch("https://feeds.example.com/private", { fetcher })
    expect(r.ok).toBe(false)
    expect(r.kind).toBe("blocked")
    expect(r.reason).toBe("http-403")
  })

  it("404 → error http-404 (a missing resource, not a block)", async () => {
    const fetcher = vi.fn(async () => rawRes(404, { body: "" }))
    const r = await webFetch("https://feeds.example.com/old", { fetcher })
    expect(r.kind).toBe("error")
    expect(r.reason).toBe("http-404")
  })

  it("network abort → timeout", async () => {
    const fetcher = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" })
    })
    const r = await webFetch("https://feeds.example.com/news", { fetcher })
    expect(r.kind).toBe("timeout")
  })

  it("other transport failure → error, no fabrication", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("ECONNRESET")
    })
    const r = await webFetch("https://feeds.example.com/news", { fetcher })
    expect(r.kind).toBe("error")
    expect(r.reason).toContain("ECONNRESET")
  })

  it("local fair-use ceiling trips BEFORE the wire (fetcher never called)", async () => {
    process.env.PICC_WEBFETCH_MAX_RPM = "2"
    const fetcher = vi.fn(async () => rawRes(200, { body: "<rss/>" }))
    const limits = webfetchLimits()
    resetWebFetchLimits()
    await webFetch("https://busy.example.com/1", { fetcher, limits })
    await webFetch("https://busy.example.com/2", { fetcher, limits })
    const r = await webFetch("https://busy.example.com/3", { fetcher, limits })
    expect(r.kind).toBe("rate-limited")
    expect(r.reason).toBe("local-fair-use-limit")
    expect(fetcher).toHaveBeenCalledTimes(2) // the third call never reached fetch
    expect(webFetchStats().hosts["busy.example.com"].limited).toBe(1)
    resetWebFetchLimits()
    delete process.env.PICC_WEBFETCH_MAX_RPM
  })
})

describe("solverAdapter — declared seam, OFF by default, never a silent bypass", () => {
  it("unset → configured false, solve() resolves null", async () => {
    delete process.env.PICC_WEBFETCH_SOLVER
    const s = solverAdapter()
    expect(s.configured).toBe(false)
    expect(s.kind).toBe("none")
    expect(await s.solve()).toBeNull()
  })

  it("declared but unwired → configured true yet solve() still returns null (honest skip)", async () => {
    process.env.PICC_WEBFETCH_SOLVER = "hcaptcha-challenger"
    const s = solverAdapter()
    expect(s.configured).toBe(true)
    expect(await s.solve()).toBeNull()
    delete process.env.PICC_WEBFETCH_SOLVER
  })
})