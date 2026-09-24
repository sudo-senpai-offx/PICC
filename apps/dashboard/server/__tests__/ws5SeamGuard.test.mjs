import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const BASELINE = "d400c70"
const TEST_PATH = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(TEST_PATH), "../../../..")
const TRADING_SUITE = resolve(ROOT, "apps/dashboard/src/components/TradingSuite.tsx")
const AUTOPILOT_SUITE = resolve(ROOT, "apps/dashboard/src/components/AutopilotSuite.tsx")
const AUTOPILOT_ROOM = resolve(ROOT, "apps/dashboard/src/pages/ministry/AutopilotRoom.tsx")

const readSource = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
const normalize = (value) => value.replaceAll("\\", "/")
const relativeToRoot = (value) => normalize(relative(ROOT, value))

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })

const stripComments = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")

const importSpecifiers = (code) => {
  const out = []
  const re = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|import\(\s*|export\s+[\s\S]*?\s+from\s+)["']([^"']+)["']/g
  let match
  while ((match = re.exec(code)) !== null) out.push(match[1])
  return out
}

const walkCodeFiles = (dir) => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "coverage", ".playwright-tmp"].includes(entry.name)) continue
    const abs = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkCodeFiles(abs))
    else if (/\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(entry.name)) out.push(abs)
  }
  return out
}

const isExcludedTest = (rel) => rel.includes("/__tests__/") || /\.(?:test|spec)\.[^.]+$/.test(rel.split("/").pop() ?? "")

const codeFilesForScope = () =>
  walkCodeFiles(resolve(ROOT, "apps/dashboard"))
    .map((abs) => ({ abs, rel: relativeToRoot(abs), code: readFileSync(abs, "utf8") }))
    .filter(({ rel }) => isExcludedTest(rel) ? rel.startsWith("apps/dashboard/e2e/") : true)

const tokenHits = (files, pattern) =>
  files.flatMap(({ rel, code }) => (stripComments(code).match(pattern) ?? []).map((token) => ({ rel, token })))

const DENY_CORPUS = [
  {
    rel: "../services/commandCentre/perpsGates.mjs",
    text: "`invalid-environment: PICC_CCXT_LEVERAGE_MIN=${minEnv.value}; PICC_CCXT_LEVERAGE_MAX=${maxEnv.value} — min > max`"
  },
  {
    rel: "../services/commandCentre/perpsExecution.mjs",
    text: "`invalid-environment: PICC_CCXT_MARGIN_PER_POSITION_CAP_USD=${rawCap}`"
  },
  {
    rel: "../services/venues/hyperliquidPerps.mjs",
    text: "\"perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)\""
  },
  {
    rel: "../services/venues/hyperliquidPerps.mjs",
    text: "\"perps-rail-off: WS-1 is testnet-only — sandbox mode was not requested (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1); PICC_CCXT_PERPS_MAINNET_ENABLED alone is insufficient until the WS-3 ceremony\""
  },
  {
    rel: "../__tests__/ceremonyVenueUnlock.test.mjs",
    text: "\"perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)\""
  },
  {
    rel: "../services/ccxtOrdering.mjs",
    text: "`ccxt ordering seam: no ${envKey(id)} credentials configured — set either PICC_CCXT_APIKEY_${envKey(id)} + PICC_CCXT_SECRET_${envKey(id)} (CEX-style) or PICC_CCXT_WALLETADDRESS_${envKey(id)} + PICC_CCXT_PRIVATEKEY_${envKey(id)} (Hyperliquid-style) — the execution leg is inoperable without them`"
  }
]

const LEADER_CORPUS = [
  ["../handlers.mjs", "\"leader:deny:payload-too-large\""],
  ["../handlers.mjs", "\"leader:deny:empty-payload\""],
  ["../handlers.mjs", "\"leader:deny:unparsable-feed\""],
  ["../handlers.mjs", "\"leader:deny:unsupported-payload\""],
  ["../handlers.mjs", "\"leader:deny:platform-adversarial\""],
  ["../handlers.mjs", "\"leader:deny:store-unhealthy\""],
  ["../handlers.mjs", "\"leader:deny:missing-leader-id\""],
  ["../handlers.mjs", "\"leader:deny:invalid-trust-value\""],
  ["../handlers.mjs", "\"leader:deny:trust-evidence-required\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "storeUnhealthy: \"leader:deny:store-unhealthy\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "unknownLeader: \"leader:deny:unknown-leader\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "notQualified: \"leader:deny:not-qualified\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "missingId: \"leader:deny:import-missing-id\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "invalidTrustValue: \"leader:deny:invalid-trust-value\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "trustEvidenceRequired: \"leader:deny:trust-evidence-required\""],
  ["../services/copytrade/csvFeedImport.mjs", "\"leader:deny:malformed-feed\""],
  ["../services/copytrade/csvFeedImport.mjs", "\"leader:deny:empty-feed\""],
  ["../services/copytrade/csvFeedImport.mjs", "\"leader:deny:costs-unaccounted\""],
  ["../services/copytrade/csvFeedImport.mjs", "\"leader:deny:unknown-asset\""],
  ["../services/copytrade/csvFeedImport.mjs", "\"leader:deny:malformed-row\""],
  ["../services/copytrade/leaderFeedContract.mjs", "\"leader:deny:hip-not-wired — endpoint contract unverified\""],
  ["../services/copytrade/leaderQualification.mjs", "`leader:deny:trades-short (have ${trades}, require ${LEADER_MIN_TRADES})`"],
  ["../services/copytrade/leaderQualification.mjs", "`leader:deny:mdd-over (have ${mdd}%, require <${LEADER_MAX_MDD_PCT})`"],
  ["../services/copytrade/leaderQualification.mjs", "`leader:deny:expectancy-nonpositive (have ${expectancy})`"],
  ["../services/copytrade/leaderGuard.mjs", "`leader:deny:invalid-environment (PICC_LEADER_AUTO_UNFOLLOW_DAYS=${env.raw})`"],
  ["../services/copytrade/leaderGuard.mjs", "\"leader:auto-unfollow:no-positions-21d\""],
  ["../services/copytrade/leaderGuard.mjs", "`leader:deny:invalid-environment (PICC_LEADER_7D_STOP_PCT=${env.raw})`"],
  ["../services/copytrade/leaderGuard.mjs", "\"leader:deny:equity-unavailable\""],
  ["../services/copytrade/leaderGuard.mjs", "\"leader:idea-suppressed:7d-stop\""],
  ["../services/commandCentre/leaderIdeasState.mjs", "`leader:import:${id}`"],
  ["../services/commandCentre/leaderIdeasState.mjs", "`leader:follow:${id}`"],
  ["../services/commandCentre/leaderIdeasState.mjs", "`leader:trust:${id}`"]
]

const CEREMONY_CORPUS = [
  ["../services/commandCentre/ceremonyState.mjs", "\"ceremony:deny:not-decided\""],
  ["../services/commandCentre/ceremonyState.mjs", "\"ceremony:deny:sim-row\""],
  ["../services/commandCentre/ceremonyState.mjs", "\"ceremony:deny:untagged-provenance\""],
  ["../services/commandCentre/ceremonyState.mjs", "\"ceremony:deny:untagged-class\""],
  ["../services/commandCentre/ceremonyState.mjs", "\"ceremony:deny:ceremony-action-unreachable (no ceremony-action route is wired in production — the gate/route modules own the unlock check)\""],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:gate1-short (have ${have}, require ${env.value})`"],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:flip-unmet (${flip.reason})`"],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:streak-short (have ${window.length} rows, require ${needed})`"],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:streak-winprob-missing (window row ${seq} has null winProb)`"],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:streak-out-of-band (ratio ${shown}, band [${loEnv.value}, ${hiEnv.value}])`"],
  ["../services/commandCentre/ceremonyGates.mjs", "`ceremony:deny:days-short (have ${days} trading days, require ${env.value})`"],
  ["../services/commandCentre/ceremonyGates.mjs", "\"ceremony:deny:platform-unverified\""],
  ["../services/commandCentre/ceremonyGates.mjs", "\"ceremony:deny:payout-below-floor\""],
  ["../services/commandCentre/ceremonyGates.mjs", "\"ceremony:deny:store-unhealthy\""],
  ["../services/commandCentre/ceremonyGates.mjs", "\"ceremony:deny:ledger-stale\""]
]

const EXPORT_SURFACE = [
  "MarketsSuite",
  "AutopilotSuite",
  "SignalNotificationsCard",
  "StatusCards",
  "PredictionCard",
  "ProAnalysisCard",
  "PaperTradingCard",
  "TradePlannerCard",
  "WatchlistScannerCard",
  "NewsCard",
  "PaperAnalyticsCard",
  "SignalsCard"
]

const VENUE_PATHS = new Set([
  "apps/dashboard/server/services/captureProfiles.mjs",
  "apps/dashboard/server/services/expertoption.mjs",
  "apps/dashboard/server/services/liveEO.mjs",
  "apps/dashboard/server/services/ccxtOrdering.mjs",
  "apps/dashboard/server/services/commandCentre/policyGraphCatalog.mjs",
  "apps/dashboard/server/services/venues/venueAdapterContract.mjs"
])

const isVenuePath = (path) => path.startsWith("apps/dashboard/server/services/venues/") || VENUE_PATHS.has(path)

const statusPaths = (text) =>
  text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((path) => path.includes(" -> ") ? path.split(" -> ").at(-1) : path)
    .map((path) => path.replace(/^"|"$/g, ""))

describe("WS-5 seam guard", () => {
  describe("AC-8a deny-corpus regression", () => {
    it("pins the pre-existing venue and environment deny vocabulary", () => {
      for (const { rel, text } of DENY_CORPUS) expect(readSource(rel), `${rel} must retain ${text}`).toContain(text)
    })

    it("pins the WS-4 leader deny and guard vocabulary", () => {
      for (const [rel, text] of LEADER_CORPUS) expect(readSource(rel), `${rel} must retain ${text}`).toContain(text)
    })

    it("pins the ceremony deny compounds", () => {
      for (const [rel, text] of CEREMONY_CORPUS) expect(readSource(rel), `${rel} must retain ${text}`).toContain(text)
    })
  })

  describe("AC-8b additive string scoping and flat stack", () => {
    it("allows suite denies only in the lock, startup-health, and e2e surfaces", () => {
      const files = codeFilesForScope()
      const hits = tokenHits(files, /suite:deny:[A-Za-z0-9-]+/g)
      const allowed = new Set([
        "apps/dashboard/server/services/commandCentre/startupHealth.mjs",
        "apps/dashboard/src/lib/dangerousActionLock.ts",
        "apps/dashboard/e2e/autopilot-surface.spec.ts",
        "apps/dashboard/e2e/command-centre-order-flow.spec.ts"
      ])
      expect(hits.filter(({ rel }) => !allowed.has(rel))).toEqual([])
      expect(hits.some(({ rel }) => rel === "apps/dashboard/server/services/commandCentre/startupHealth.mjs")).toBe(true)
      expect(hits.some(({ rel }) => rel === "apps/dashboard/src/lib/dangerousActionLock.ts")).toBe(true)
    })

    it("allows audit:startup-health only in the startup-health module", () => {
      const files = codeFilesForScope()
      const hits = tokenHits(files, /audit:startup-health/g)
      expect(new Set(hits.map(({ rel }) => rel))).toEqual(new Set(["apps/dashboard/server/services/commandCentre/startupHealth.mjs"]))
      expect(hits.length).toBeGreaterThan(0)
    })

    it("keeps the trading suite surface free of new route or router components", () => {
      const files = [TRADING_SUITE, AUTOPILOT_SUITE, AUTOPILOT_ROOM]
      for (const file of files) {
        expect(stripComments(readFileSync(file, "utf8")), `${file} must not add route primitives`).not.toMatch(/\b(?:Route|Routes|Router|useNavigate|useLocation)\b/)
      }
      const trading = readFileSync(TRADING_SUITE, "utf8")
      const start = trading.indexOf("export function MarketsSuite()")
      const end = trading.indexOf("export { AutopilotSuite }", start)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeGreaterThan(start)
      // Compare the set of cards actually MOUNTED across the trading surface against the pre-WS-5
      // baseline. The ratified claim "MarketsSuite mounts all 12 exports + AssistantCard" does not
      // survive source inspection: `WatchlistScannerCard` and `PaperAnalyticsCard` are exported but
      // were never mounted, at d400c70 or now — verified via `git show`. Asserting they are mounted
      // would therefore be unsatisfiable even at the baseline. What WS-5 must guarantee is that the
      // mounted set is UNCHANGED, which is what this pins.
      const mountedCards = (code) =>
        [...EXPORT_SURFACE, "AssistantCard"]
          .filter((name) => new RegExp(`<${name}\\b`).test(stripComments(code)))
          .sort()
      const before = mountedCards(git("show", `${BASELINE}:apps/dashboard/src/components/TradingSuite.tsx`))
      const after = mountedCards(
        [trading, readFileSync(AUTOPILOT_SUITE, "utf8")].join("\n")
      )
      expect(after).toEqual(before)
      expect(before.length).toBeGreaterThan(0)
    })

    it("keeps the documented export surface intact", () => {
      const trading = readFileSync(TRADING_SUITE, "utf8")
      for (const name of EXPORT_SURFACE) {
        const re = name === "AutopilotSuite"
          ? /export\s*\{\s*AutopilotSuite\s*\}\s*from\s*["']\.\/AutopilotSuite["']/
          : new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b|export\\s*\{[^}]*\\b${name}\\b`)
        expect(trading, `${name} export must remain`).toMatch(re)
      }
    })
  })

  describe("AC-1b extraction seam", () => {
    it("has no AutopilotSuite import that resolves to TradingSuite", () => {
      const source = readFileSync(AUTOPILOT_SUITE, "utf8")
      const specs = importSpecifiers(source)
      const tradingText = readFileSync(TRADING_SUITE, "utf8")
      const resolvedTradingSuite = specs.some((specifier) => {
        if (specifier.includes("TradingSuite")) return true
        if (!specifier.startsWith(".")) return false
        const base = resolve(dirname(AUTOPILOT_SUITE), specifier)
        return [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`].some((candidate) => existsSync(candidate) && candidate === TRADING_SUITE)
      })
      expect(resolvedTradingSuite).toBe(false)
      expect(tradingText).toMatch(/export\s*\{\s*AutopilotSuite\s*\}\s*from\s*["']\.\/AutopilotSuite["']/)
    })

    it("passes SignalNotificationsCard as the single sanctioned injected collaborator", () => {
      const source = readFileSync(AUTOPILOT_SUITE, "utf8")
      const room = readFileSync(AUTOPILOT_ROOM, "utf8")
      expect(importSpecifiers(source).some((specifier) => specifier.includes("TradingSuite"))).toBe(false)
      expect(source).toContain("SignalNotificationsCard: ElementType")
      const callSites = room.match(/<AutopilotSuite\b[^>]*SignalNotificationsCard=\{SignalNotificationsCard\}/g) ?? []
      expect(callSites).toHaveLength(1)
    })
  })

  describe("AC-7a venue whitelist", () => {
    it("has no committed or working-tree edits to the venue surface", () => {
      const committed = git("diff", "--name-only", `${BASELINE}..HEAD`).split(/\r?\n/).filter(Boolean)
      const unstaged = git("diff", "--name-only").split(/\r?\n/).filter(Boolean)
      const status = statusPaths(git("status", "--porcelain=v1", "--untracked-files=all"))
      const changedVenue = [...new Set([...committed, ...unstaged, ...status].map(normalize))].filter(isVenuePath)
      expect(changedVenue).toEqual([])
    })
  })

  describe("AC-2c package scope", () => {
    it("adds only the Playwright dev dependency and e2e script", () => {
      const before = JSON.parse(git("show", `${BASELINE}:apps/dashboard/package.json`))
      const after = JSON.parse(readFileSync(resolve(ROOT, "apps/dashboard/package.json"), "utf8"))
      const { "@playwright/test": playwright, ...devDependencies } = after.devDependencies
      const { "test:e2e": e2e, ...scripts } = after.scripts
      expect(playwright).toBe("^1.49.1")
      expect(e2e).toBe("playwright test")
      expect(devDependencies).toEqual(before.devDependencies)
      expect(scripts).toEqual(before.scripts)
      expect({ ...after, scripts, devDependencies }).toEqual(before)
    })
  })
})
