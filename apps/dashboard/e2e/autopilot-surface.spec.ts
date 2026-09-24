import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test"
import isolatedEnv, {
  assertIsolatedEnv,
  ISOLATION_TMP_ROOT,
} from "./helpers/isolatedEnv.mjs"

assertIsolatedEnv(isolatedEnv, ISOLATION_TMP_ROOT)

type Credentials = {
  email: string
  password: string
  name: string
}

function freshCredentials(): Credentials {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    email: `autopilot-${nonce}@example.test`,
    password: "e2e-local-password-9",
    name: "E2E autopilot",
  }
}

async function signupAndLogin(
  page: Page,
  request: APIRequestContext,
): Promise<void> {
  const credentials = freshCredentials()
  const response = await request.post("/api/auth/signup", {
    data: credentials,
  })
  expect(response.status()).toBe(200)

  await page.goto("/login")
  await page.getByLabel("Email").fill(credentials.email)
  await page.getByLabel("Password").fill(credentials.password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:$|\?)/)
}

test("autopilot renders its honest empty state without console errors", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await signupAndLogin(page, request)
  const decisionsResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/trading/autopilot/decisions") &&
      response.request().method() === "GET",
  )
  await page.goto("/suites/trading/autopilot")
  await decisionsResponse
  await expect(page.locator('[data-room="autopilot"]')).toBeVisible()
  await expect(
    page.getByText(
      "No autopilot decisions recorded yet — decisions appear once the demo engine evaluates a tick.",
      { exact: true },
    ),
  ).toBeVisible()
  await page.waitForTimeout(1_000)
  expect(consoleErrors).toEqual([])
})
