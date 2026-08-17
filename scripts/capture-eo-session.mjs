// Open the in-app browser, drive it to ExpertOption, wait for the SPA to load
// (and auto-login via the imported Google profile, when it applies), then
// capture a fresh session token and save it to the trading credentials.
// Run: node scripts/capture-eo-session.mjs
import { openStudio, studioGoto, captureExpertOptionSession, studioStatus, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await openStudio({ homepage: "" })
console.log("[capture] browser open; navigating to ExpertOption…")
await studioGoto("https://app.expertoption.com/")

// The SPA + any auto-login need a few beats. Poll the URL until it either
// leaves the login/register page or we time out.
let landed = false
for (let i = 0; i < 24; i++) {
  await sleep(1500)
  const url = studioStatus().tabs?.find((t) => t.id === studioStatus().activeTabId)?.url ?? ""
  const lower = url.toLowerCase()
  if (lower.includes("app.expertoption.com") && !/login|register|signin|authorize|choose-account|/i.test(lower)) {
    landed = true
    break
  }
  if (/accounts\.google\.com|signin|authorize/i.test(lower)) {
    console.log("[capture] Google sign-in page is showing — the profile is not signed in on Google here yet.")
    landed = false
    break
  }
}
console.log("[capture] landed on trading platform:", landed, "| url:", studioStatus().tabs?.find((t) => t.id === studioStatus().activeTabId)?.url)

const cap = await captureExpertOptionSession()
if (cap?.ok) {
  console.log("[capture] TOKEN CAPTURED:", cap.token.slice(0, 14) + "…::" + cap.token.slice(-6))
} else {
  console.log("[capture] no token found yet. Sign in to ExpertOption once inside the PICC browser window, then run the capture again (or use the Trading Suite button).")
}
await closeStudio().catch(() => {})
process.exit(0)
