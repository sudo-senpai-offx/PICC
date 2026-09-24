import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import isolatedEnv, {
  assertIsolatedEnv,
  ISOLATION_TMP_ROOT,
} from "./helpers/isolatedEnv.mjs"

assertIsolatedEnv(isolatedEnv, ISOLATION_TMP_ROOT)

test.setTimeout(90_000)

type Credentials = {
  email: string
  password: string
  name: string
}

function freshCredentials(prefix: string): Credentials {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    email: `${prefix}-${nonce}@example.test`,
    password: "e2e-local-password-9",
    name: `E2E ${prefix}`,
  }
}

async function signupAndLogin(
  page: Page,
  request: APIRequestContext,
  prefix: string,
): Promise<Credentials> {
  const credentials = freshCredentials(prefix)
  const response = await request.post("/api/auth/signup", {
    data: credentials,
  })
  expect(response.status()).toBe(200)

  await page.goto("/login")
  await page.getByLabel("Email").fill(credentials.email)
  await page.getByLabel("Password").fill(credentials.password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:$|\?)/)
  return credentials
}

type AuditRow = {
  at?: number
  kind?: string
  data?: Record<string, unknown>
}

function readAuditRows(auditFile: string): AuditRow[] {
  return readFileSync(auditFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditRow)
}

function serverIsolation(testInfo: TestInfo) {
  const webServer = testInfo.config.webServer
  const env = webServer?.env
  if (!env?.PICC_COMMAND_CENTRE_DATA_DIR) {
    throw new Error(
      "The resolved Playwright webServer env has no isolated command-centre data directory",
    )
  }
  const root = dirname(env.PICC_COMMAND_CENTRE_DATA_DIR)
  assertIsolatedEnv(env, root)
  return { env, root }
}

async function verifyServerAudit(testInfo: TestInfo, runStartedAt: number) {
  serverIsolation(testInfo)
  const isolationBase = dirname(ISOLATION_TMP_ROOT)
  const candidates = readdirSync(isolationBase, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      join(
        isolationBase,
        entry.name,
        "command-centre",
        "command-centre-audit.jsonl",
      ),
    )
    .filter((auditFile) => existsSync(auditFile))
    .map((auditFile) => ({ auditFile, rows: readAuditRows(auditFile) }))
  const current = candidates
    .filter(({ rows }) =>
      rows.some(
        (row) =>
          row.kind === "kill-switch" &&
          row.data?.kill === true &&
          Number(row.at) >= runStartedAt,
      ),
    )
    .sort(
      (a, b) => statSync(b.auditFile).mtimeMs - statSync(a.auditFile).mtimeMs,
    )
  expect(
    current.length,
    "the current run must leave an isolated audit trail",
  ).toBeGreaterThan(0)

  const { auditFile, rows } = current[0]
  const root = dirname(dirname(auditFile))
  expect(root.startsWith(isolationBase)).toBe(true)

  const previousDataDir = process.env.PICC_COMMAND_CENTRE_DATA_DIR
  process.env.PICC_COMMAND_CENTRE_DATA_DIR = dirname(auditFile)
  try {
    const auditModule =
      await import("../server/services/commandCentre/auditTrail.mjs")
    return { auditFile, root, rows, verification: auditModule.verifyAudit() }
  } finally {
    if (previousDataDir === undefined)
      delete process.env.PICC_COMMAND_CENTRE_DATA_DIR
    else process.env.PICC_COMMAND_CENTRE_DATA_DIR = previousDataDir
  }
}

test("command-centre order flow refuses at every live-trade boundary", async ({
  page,
  request,
}, testInfo) => {
  const runStartedAt = Date.now()
  const { env } = serverIsolation(testInfo)
  expect(Object.keys(env).some((name) => name.startsWith("PICC_CCXT_"))).toBe(
    false,
  )

  await signupAndLogin(page, request, "command-centre")
  await page.goto("/suites/trading/command-centre")

  const room = page.locator('[data-room="command-centre"]')
  await expect(room).toBeVisible()
  await expect(
    page.getByText("Workability: not-wired", { exact: false }).first(),
  ).toBeVisible()

  const globalKill = page.getByRole("switch", { name: "global kill switch" })
  await expect(globalKill).toHaveAttribute("aria-checked", "false")
  await globalKill.click()
  await expect(globalKill).toHaveAttribute("aria-checked", "true")
  await expect(
    page.getByText(
      "GLOBAL KILL ACTIVE — every site below is BLOCKED until the human rearms",
    ),
  ).toBeVisible()

  // The aggregate risk strip is present, but its halt cell is NOT the kill switch: `risk.halted`
  // is the WS-2 risk-engine trip (day-loss / drawdown / heat), a different control that cannot be
  // tripped from this credential-less run. Asserting `/halted:/` here would encode a product
  // assumption that source inspection contradicts. The kill switch's real effect is proven above
  // (aria-checked + banner) and by the gate deny below (blockedBy === "kill-switch").
  const riskStrip = page.getByLabel("aggregate risk strip")
  await expect(riskStrip).toBeVisible()
  await expect(riskStrip).toContainText("Aggregate risk")

  const blockedProposal = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/command-centre/orders") &&
      response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "gate this order" }).click()
  const blockedProposalResponse = await blockedProposal
  const blockedProposalBody = (await blockedProposalResponse.json()) as {
    ok: boolean
    gate: { allow: boolean; blockedBy: string | null; reason?: string | null }
  }
  expect(blockedProposalResponse.status()).toBe(200)
  expect(blockedProposalBody.ok).toBe(false)
  expect(blockedProposalBody.gate.allow).toBe(false)
  expect(blockedProposalBody.gate.blockedBy).toBe("kill-switch")
  await expect(
    page.getByText(/blocked at the gate: kill-switch/i),
  ).toBeVisible()

  await globalKill.click()
  await expect(globalKill).toHaveAttribute("aria-checked", "false")

  const credentialLessProposal = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/command-centre/orders") &&
      response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "gate this order" }).click()
  const credentialLessResponse = await credentialLessProposal
  const credentialLessBody = (await credentialLessResponse.json()) as {
    ok: boolean
    gate: { allow: boolean; blockedBy: string | null; reason?: string | null }
  }
  expect(credentialLessResponse.status()).toBe(200)
  expect(credentialLessBody.ok).toBe(false)
  expect(credentialLessBody.gate.allow).toBe(false)
  expect(credentialLessBody.gate.blockedBy).toBe("fresh-data")
  expect(credentialLessBody.gate.reason).toMatch(/ccxt|balance|feed/i)
  await expect(page.getByText(/blocked at the gate:/i)).toBeVisible()
  await expect(
    page.getByRole("button", { name: /execute via picc/i }),
  ).toHaveCount(0)

  const { auditFile, root, rows, verification } = await verifyServerAudit(
    testInfo,
    runStartedAt,
  )
  expect(root).toContain(".playwright-tmp")
  expect(
    rows.some((row) => row.kind === "kill-switch" && row.data?.kill === true),
  ).toBe(true)
  expect(
    rows.some(
      (row) =>
        row.kind === "safety-gate:deny" &&
        row.data?.blockedBy === "kill-switch",
    ),
  ).toBe(true)
  expect(rows.some((row) => row.kind === "execution:executed")).toBe(false)
  expect(verification).toEqual({ ok: true, brokenAt: null, reason: null })
  expect(auditFile.startsWith(root)).toBe(true)
})
