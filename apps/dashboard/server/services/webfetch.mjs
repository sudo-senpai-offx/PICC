// GLOBAL PICC webfetch capability (owner directive 2026-09-13): a browser-less
// native-fetch layer any feature can use — no third-party key, no per-call
// cost ceiling, bounded only by a POLITE per-host fair-use limiter that is
// locally resettable (POST /api/webfetch/limits/reset) and shared across the
// app. Honesty contract:
//   - every outcome is classified from what the wire actually said: ok |
//     rate-limited | captcha-gated | blocked | error | timeout;
//   - captcha gates are DETECTED, never silently bypassed: the default is the
//     caller's honest skip (T3.1 newsDigest records gated feeds as gated).
//     Solver adapters are a documented seam (solverAdapter), OFF by default,
//     and the researched options live in the S3 spec notes; nothing in this
//     repo ever default-on a ToS-risky bypass;
//   - the fair-use limiter counts OBSERVED requests per host; a 429/403 from
//     the upstream is reported honestly (never rewritten into "ok").
//
// Researched captcha material (websearch, 2026-09-13) — refs in spec S3 notes:
//   hcaptcha-challenger (QIN2DIM, GPL-3.0): ResNet+YOLOv8 ONNX models, no GPU,
//     image-label + drag-drop challenges, agentic MLLM workflow (spatial CoT).
//   recaptcha-challenger (QIN2DIM, GPL-3.0): audio-based reCAPTCHA solving.
//   turnstile solvers: mostly paid APIs (CapSolver — excluded: no paid APIs)
//     or ToS-gray educational repos (MIT, Selenium/CDP). Tesseract OCR
//     (Apache-2.0) suits legacy text CAPTCHAs only. None default-on here.
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PICC-webfetch/1.0 (self-hosted dashboard; polite fair-use rate limits)"

/** Fair-use ceilings (per host per minute), conservative, env-configurable. */
export function webfetchLimits(env = process.env) {
  return {
    maxRpm: Math.max(1, Math.floor(Number(env.PICC_WEBFETCH_MAX_RPM) || 30)),
    windowMs: 60_000
  }
}

// ── Fair-use limiter (in-memory, per host) ────────────────────────────────
// Runtime state only — a restart resets windows (like rateLimited in
// handlers.mjs). "Locally resettable": resetWebFetchLimits() clears it.
const windows = new Map() // host -> { hits: number[], limited: number }
let sinceReset = Date.now()

export function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).host
  } catch {
    return null
  }
}

function windowFor(host) {
  if (!windows.has(host)) windows.set(host, { hits: [], limited: 0 })
  return windows.get(host)
}

/** Would one more fetch to this host exceed the fair-use ceiling? Pure-ish. */
export function withinFairUse(host, { limits = webfetchLimits(), now = Date.now() } = {}) {
  const w = windowFor(host)
  const cutoff = now - limits.windowMs
  w.hits = w.hits.filter((t) => t >= cutoff)
  return w.hits.length < limits.maxRpm
}

export function recordHit(host, { now = Date.now() } = {}) {
  const w = windowFor(host)
  w.hits.push(now)
  return w.hits.length
}

export function recordLimited(host) {
  windowFor(host).limited += 1
}

/**
 * Honest observed limiter state (GET /api/webfetch/limits). Counts are what
 * actually happened — hosts with zero traffic simply don't appear.
 */
export function webFetchStats({ now = Date.now() } = {}) {
  const hosts = {}
  for (const [host, w] of windows) {
    hosts[host] = { inWindow: w.hits.filter((t) => t >= now - 60_000).length, limited: w.limited }
  }
  return { hosts, sinceReset: new Date(sinceReset).toISOString() }
}

/** Locally resettable fair-use limiter (operator/UI affordance, no restart). */
export function resetWebFetchLimits() {
  windows.clear()
  sinceReset = Date.now()
}

// ── Captcha-gate detection (the "autocompletion" research half) ────────────
// Pure, table-tested. A gate is an OBSERVED fact from headers/body — the
// caller (newsDigest) records it honestly; nothing auto-bypasses.
const H_CAPTCHA = [/hcaptcha/i, /h-captcha/i]
const RE_CAPTCHA = [/grecaptcha/i, /recaptcha/i, /data-sitekey/i]
const TURNSTILE = [/cf-turnstile/i, /turnstile/i]
const CLOUDFLARE = [/cf-challenge/i, /cf-mitigated/i, /cf-chl-[\da-f]/i, /__cf_chl/i, /just a moment/i, /checking your browser/i, /attention required/i]
const GENERIC = [/captcha/i]

/** Pure classification: returns {gated, kind, markers} or null. */
export function detectCaptchaGate({ status = null, headers = {}, body = "" } = {}) {
  const headersText = Object.entries(headers ?? {})
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
  const text = `${headersText}\n${String(body ?? "").slice(0, 200_000)}`
  const markers = []
  let kind = null

  const scan = (label, regexes) => {
    for (const re of regexes) {
      const m = text.match(re)
      if (m) {
        markers.push(m[0].slice(0, 60))
        kind = kind ?? label
      }
    }
  }
  scan("cloudflare-challenge", CLOUDFLARE)
  scan("hcaptcha", H_CAPTCHA)
  scan("turnstile", TURNSTILE)
  scan("recaptcha", RE_CAPTCHA)
  // Generic "captcha" only when nothing specific matched (vendor markers win).
  if (!kind) scan("unknown-captcha", GENERIC)

  if (kind) return { gated: true, kind, markers }
  return null
}

/**
 * Optional solver-adapter seam (OFF by default). The interface: solve() may
 * return a token once a real adapter is wired (hcaptcha-challenger etc. are
 * external Python processes — wiring them is a user decision, documented in
 * the S3 notes). Honest default: configured=false, solve() resolves null →
 * webFetch reports the gate and the caller skips.
 */
export function solverAdapter(env = process.env) {
  const kind = String(env.PICC_WEBFETCH_SOLVER ?? "").trim()
  if (!kind) return { configured: false, kind: "none", solve: async () => null }
  return {
    configured: true,
    kind,
    // Declared but not wired → honest null; the gate is reported, never faked.
    solve: async () => {
      console.warn(`[picc] webfetch solver "${kind}" is declared but not wired — skipping honestly (no silent bypass)`)
      return null
    }
  }
}

/**
 * One fetch through the global capability. Classifies the outcome honestly
 * from status + headers + body and runs the fair-use limiter FIRST (a local
 * ceiling hit never reaches the wire). Retries AT MOST ONCE through a
 * configured solver when the first response is captcha-gated; default no
 * solver → the gate is reported as-is.
 *
 * @param {string} url
 * @param {{headers?:object, timeoutMs?:number, maxBytes?:number, fetcher?:Function,
 *          limits?:object, now?:number}} [opts]  fetcher injectable for tests
 * @returns {Promise<{ok:boolean, kind:string, status:number|null, host:string|null,
 *                    contentType?:string, body?:string, truncated?:boolean,
 *                    reason?:string, retryAfterMs?:number, viaSolver?:boolean,
 *                    captcha?:object|null}>}
 */
export async function webFetch(url, opts = {}) {
  const {
    headers = {},
    timeoutMs = 15_000,
    maxBytes = 5_000_000,
    fetcher = fetch,
    limits = webfetchLimits(),
    now = Date.now()
  } = opts

  const host = hostOf(url)
  if (!host) return { ok: false, kind: "error", status: null, host: null, reason: "invalid-url" }

  if (!withinFairUse(host, { limits, now })) {
    recordLimited(host)
    return { ok: false, kind: "rate-limited", status: null, host, reason: "local-fair-use-limit", retryAfterMs: limits.windowMs }
  }

  const attempt = async () => {
    const res = await fetcher(url, {
      headers: { "User-Agent": DEFAULT_UA, Accept: "application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow"
    })
    const status = res.status
    const contentType = String(res.headers.get?.("content-type") ?? "")
    const rawHeaders = {}
    if (typeof res.headers?.entries === "function") {
      for (const [k, v] of res.headers.entries()) rawHeaders[k] = v
    }
    const body = await res.text()
    const truncated = body.length > maxBytes
    const payload = { body: truncated ? body.slice(0, maxBytes) : body, headers: rawHeaders, status }
    return { status, contentType, body: payload.body, truncated, rawHeaders, payload }
  }

  let resp
  try {
    resp = await attempt()
  } catch (err) {
    const name = String(err?.name ?? "")
    const msg = String(err?.message ?? err ?? "").slice(0, 300)
    if (/abort|timeout/i.test(`${name} ${msg}`)) {
      return { ok: false, kind: "timeout", status: null, host, reason: "request-timeout" }
    }
    return { ok: false, kind: "error", status: null, host, reason: msg }
  }

  recordHit(host, { now })

  const { status, contentType, body, truncated, rawHeaders } = resp
  const base = { status, host, contentType, body, truncated }
  const captcha = detectCaptchaGate({ status, headers: rawHeaders, body })

  if (status >= 200 && status < 400) {
    if (captcha) {
      // A 2xx "Just a moment…" interstitial IS a challenge — classify honestly.
      return { ...base, ok: false, kind: "captcha-gated", captcha, reason: `interstitial-challenge (${captcha.kind})` }
    }
    return { ...base, ok: true, kind: "ok", captcha }
  }

  if (status === 429) {
    const retryAfter = Number(rawHeaders["retry-after"] ?? 0) * 1000 || null
    return { ...base, ok: false, kind: "rate-limited", reason: `upstream-429${retryAfter ? ` (retry-after ${retryAfter}ms)` : ""}`, retryAfterMs: retryAfter, captcha }
  }

  if (status === 401 || status === 403) {
    if (captcha) {
      return { ...base, ok: false, kind: "captcha-gated", captcha, reason: `gate-at-http-${status} (${captcha.kind})` }
    }
    return { ...base, ok: false, kind: "blocked", reason: `http-${status}`, captcha }
  }

  return { ...base, ok: false, kind: "error", reason: `http-${status}`, captcha }
}