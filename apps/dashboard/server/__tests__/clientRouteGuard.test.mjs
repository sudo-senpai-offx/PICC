// WS-7 T2 - client-call-path -> server-route guard.
//
// WHY THIS EXISTS. The ExpertOption removal deleted five routes and left FOUR
// client call sites pointing at them:
//
//   trading.ts  analyzeAsset()        -> /trading/analyze           (deleted)
//   trading.ts  proAnalyze()          -> /trading/pro/expertoption  (deleted)
//   trading.ts  getBrokerDemoStatus() -> /trading/demo             (deleted)
//   api.ts      browserCaptureSession()-> /browser/capture-session  (deleted)
//
// Two of those (analyzeAsset, proAnalyze) sit behind click handlers and never
// fired on page load. The third, getBrokerDemoStatus, is called on mount by
// AutopilotSuite and produced live 404s on /suites/trading/autopilot. It was
// caught ONLY by the e2e assertion `expect(consoleErrors).toEqual([])` - the
// unit suite was fully green, because nothing in unit scope mounts that
// component and performs that call. The import-resolution guard could not see it
// either: that guard resolves MODULE paths, and this is an HTTP path. The seam
// guard inspects venue files, not routes.
//
// A red e2e is not a guard. It runs last, it is slow, and it only covers the
// pages someone thought to visit. This pins the class directly.
//
// SCOPE, STATED EXPLICITLY SO IT IS NOT OVERCLAIMED. This guard checks ONE
// thing: a static, non-interpolated, root-relative string literal passed as the
// FIRST argument to one of the client's own HTTP helpers.
//
// It deliberately does NOT check:
//   - any other string literal in the client (router paths, asset paths, UI
//     copy, CSS classes, query strings). Flagging those is noise, and noise is
//     how guards get switched off.
//   - template literals containing `${...}`; the path is not knowable statically.
//   - absolute or protocol-relative URLs. `https://expertoption.com` in a
//     browser-studio helper is an external site, not a PICC route.
//   - anything not starting with `/`. The helpers take a path WITHOUT the `/api`
//     prefix and add it, so `/trading/demo` is checked as `/api/trading/demo`;
//     a literal already starting with `/api` is checked as written.
//   - routes registered outside `handlers.mjs` (static assets, the Vite dev
//     server, SSE endpoints registered in another module). The route set is
//     harvested from handlers.mjs, so such a route would read as missing. That
//     is the known bound of this guard and it is stated, not hidden.
//
// The honest claim is therefore narrow: every static first-argument path passed
// to the client's HTTP helpers resolves to a route registered in handlers.mjs.

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const CLIENT_ROOT = join(REPO_ROOT, "apps/dashboard/src")
const HANDLERS = join(REPO_ROOT, "apps/dashboard/server/handlers.mjs")

const HTTP_HELPERS = ["get", "post", "put", "patch", "del", "delete", "request"]

// A path named in prose is not a route. Comments are stripped before harvesting,
// which is what stopped an earlier revision of this analysis from concluding the
// removed routes still existed - their names survive in the
// "D2/AC-005: the X route is REMOVED" comments.
const deComment = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function serverRoutes() {
  const routes = new Set()
  for (const m of deComment(readFileSync(HANDLERS, "utf8")).matchAll(/["'`](\/api\/[A-Za-z0-9_\-/:]*)["'`]/g)) {
    routes.add(m[1])
  }
  return routes
}

function clientFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "build", "coverage"].includes(entry.name)) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) clientFiles(abs, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(abs)
  }
  return out
}

/** Static first-argument paths passed to one of the HTTP helpers. */
function clientCallPaths(src) {
  const out = []
  const helpers = HTTP_HELPERS.join("|")
  const re = new RegExp(
    `\\b(?:${helpers})\\s*(?:<[^>]*>\\s*)?\\(\\s*(["'\`])(\\/(?!api)[A-Za-z0-9_\\-/:]+|\\/api[A-Za-z0-9_\\-/:]*)\\1`,
    "g"
  )
  for (const m of src.matchAll(re)) {
    const literal = m[2]
    out.push(literal.startsWith("/api") ? literal : `/api${literal}`)
  }
  return out
}

const routes = serverRoutes()
const files = clientFiles(CLIENT_ROOT)
const calls = []
for (const abs of files) {
  const rel = abs.slice(REPO_ROOT.length + 1).replaceAll("\\", "/")
  for (const path of clientCallPaths(deComment(readFileSync(abs, "utf8")))) {
    calls.push({ rel, path })
  }
}
const orphans = calls.filter((c) => !routes.has(c.path))

describe("WS-7 T2 - every client HTTP call path resolves to a registered server route", () => {
  it("proves the scan set is real, so a silently-empty sweep cannot pass", () => {
    // Server side must be substantial, or "no orphans" is meaningless.
    expect(routes.size).toBeGreaterThan(150)
    // Client side must actually be scanned and must yield call sites.
    expect(files.length).toBeGreaterThan(50)
    expect(calls.length).toBeGreaterThan(50)
    // Spot-pin that harvesting works on known routes, so a future change to the
    // regex cannot quietly reduce this to zero matches.
    expect(routes.has("/api/trading/decisions")).toBe(true)
    expect(routes.has("/api/auth/login")).toBe(true)
  })

  it("reports zero client call paths with no matching server route", () => {
    const inventory = orphans.map((o) => `${o.rel} -> ${o.path}`).join("\n")
    expect(
      orphans,
      `client call path(s) with no server route:\n${inventory}\n` +
        `(checked ${calls.length} call path(s) against ${routes.size} route(s))`
    ).toEqual([])
  })

  it("would have caught the four orphans this removal created", () => {
    // The regression, restated as a fixture. These are the exact
    // route/call-site pairs that shipped broken and were only found by e2e.
    // Pinning them here means the same mistake is caught by a unit test.
    const pairs = [
      ["/trading/analyze", "/api/trading/analyze"],
      ["/trading/pro/expertoption", "/api/trading/pro/expertoption"],
      ["/trading/demo", "/api/trading/demo"],
      ["/browser/capture-session", "/api/browser/capture-session"]
    ]
    for (const [clientPath, serverPath] of pairs) {
      expect(routes.has(serverPath), `${serverPath} must NOT be a registered route after the removal`).toBe(false)
      expect(
        calls.some((c) => c.path === serverPath),
        `no client call site may still request ${serverPath}`
      ).toBe(false)
    }
  })
})
