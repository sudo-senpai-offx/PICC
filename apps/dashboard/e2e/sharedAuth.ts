// Shared authenticated session for read-only e2e specs.
//
// WHY THIS EXISTS
// The local auth endpoint is rate limited to 10 attempts per minute per IP, and
// BOTH signup and login draw from that same budget. Four specs each doing their
// own signup+login consumed 8 of 10, and adding one more spec tipped the whole
// suite into HTTP 429.
//
// The limiter is a real security control against credential brute force, so it
// is NOT relaxed, bypassed, or special-cased for tests. Instead this module
// stops wasting the budget: specs that only need to READ the terminal share ONE
// account and authenticate by injecting the session directly, so they cost a
// single signup for the entire run and make zero login calls.
//
// Specs that assert on per-user state (autopilot's empty state, the order flow)
// must keep their own isolated accounts and should NOT use this helper - sharing
// a user would let one spec's data leak into another's assertions.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const AUTH_KEY = "picc.auth"
const RATE_LIMITED = 429

type SharedSession = { access_token: string }

/**
 * The cache MUST be scoped to this run, never to the machine.
 *
 * e2e runs against an isolated data dir (see playwright.config.ts /
 * isolatedEnv.mjs), so accounts created by one run do NOT exist in the next
 * one. A cache kept in a stable machine location would hand every later run a
 * token for an account that no longer exists - which is exactly the failure
 * this scoping prevents. Keying the path on the run's data dir means the cache
 * is shared between specs WITHIN a run and is unreachable across runs.
 */
function cachePath(): string {
  const runScope =
    process.env.PICC_COMMAND_CENTRE_DATA_DIR ??
    process.env.PICC_E2E_RUN_ID ??
    // No run marker available: fall back to a per-process path rather than a
    // shared one, so an unscoped run can never reuse another run's token.
    `pid-${process.pid}`
  const safe = runScope.replace(/[^a-zA-Z0-9._-]/g, "_")
  return join(tmpdir(), "picc-e2e-shared-auth", `${safe}.json`)
}

function readCache(): SharedSession | null {
  try {
    const file = cachePath()
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, "utf8")) as SharedSession
    return parsed?.access_token ? parsed : null
  } catch {
    // A corrupt or unreadable cache is not fatal: fall through and sign up
    // again rather than failing the suite on a stale temp file.
    return null
  }
}

function writeCache(session: SharedSession) {
  try {
    const file = cachePath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(session), "utf8")
  } catch {
    // Caching is an optimisation. If it fails we simply sign up next time.
  }
}

function clearCache() {
  try {
    const file = cachePath()
    if (existsSync(file)) writeFileSync(file, "", "utf8")
  } catch {
    // Best effort only.
  }
}

/**
 * Signs up the shared account, retrying through the rate limiter.
 *
 * The retry is bounded and reports the real status if it never gets through, so
 * a genuine lockout surfaces as a failure rather than being papered over.
 */
async function signupShared(request): Promise<SharedSession> {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const credentials = {
    email: `e2e-shared-${nonce}@example.test`,
    password: "e2e-local-password-9",
    name: "E2E shared"
  }

  const deadline = Date.now() + 75_000
  for (;;) {
    const response = await request.post("/api/auth/signup", { data: credentials })
    if (response.status() === 200) {
      const body = (await response.json()) as { access_token?: string; token?: string }
      // The signup/login endpoints return `token`; the client stores it under
      // the `access_token` key. Accept either so this helper does not silently
      // break if that response shape is ever aligned.
      const access_token = body?.access_token ?? body?.token
      if (!access_token) {
        throw new Error(`shared e2e signup returned no token (keys: ${Object.keys(body ?? {}).join(",")})`)
      }
      return { access_token }
    }
    if (response.status() !== RATE_LIMITED) {
      throw new Error(`shared e2e signup failed with ${response.status()}`)
    }
    if (Date.now() > deadline) {
      throw new Error("shared e2e signup stayed rate limited (429) past the retry budget")
    }
    // Wait out the limiter rather than weakening it.
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
}

/**
 * Gives `page` an authenticated session, creating the shared account at most
 * once per run. Costs one signup for the whole run and no logins at all.
 *
 * If the session turns out to be rejected (a stale token from an earlier state
 * of the run), the cache is dropped and a fresh account is created once, so a
 * stale cache degrades into one extra signup rather than a red suite.
 */
export async function useSharedSession(page, request) {
  let session = readCache()
  if (!session) {
    session = await signupShared(request)
    writeCache(session)
  }

  await seedSession(page, session)

  // One self-heal attempt: if the app bounced us to /login, this token is no
  // longer valid, so rebuild it rather than failing the run.
  await page.goto("/markets")
  if (/\/login(?:$|\?)/.test(page.url())) {
    clearCache()
    session = await signupShared(request)
    writeCache(session)
    await seedSession(page, session)
  }
}

async function seedSession(page, session: SharedSession) {
  // Seed the session before any app code runs, so the app never has to log in.
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string)
    },
    [AUTH_KEY, JSON.stringify({ access_token: session.access_token })] as const
  )
}
