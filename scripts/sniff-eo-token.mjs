// Drive the in-app browser onto the ExpertOption platform and sniff the exact
// WS setContext token the app sends, so PICC can authenticate its own read-only
// session. Prints the token (and WS URL) when captured.
// Run: node scripts/sniff-eo-token.mjs
import { openStudio, studioGoto, studioOnFrame, studioEvalPage, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await openStudio({ homepage: "" })
await studioGoto("https://app.expertoption.com/")

const frames = []
const off = studioOnFrame((f) => {
  if (f.payload?.includes("setContext") || f.payload?.includes("buyOption") || f.payload?.includes('"action"')) {
    frames.push(f)
    console.log(`[ws:${f.dir}] ${String(f.payload).slice(0, 180)}`)
  }
})

// The SPA may sit on /deposit interstitials — try to reach the trading platform.
for (let i = 0; i < 40; i++) {
  await sleep(1500)
  const url = await studioEvalPage(() => location.href).catch(() => "")
  const low = url.toLowerCase()
  if (/trading|chart|main|app\.expertoption\.com\/?(#|\?|$)/.test(low) && !low.includes("deposit")) {
    const hasWS = frames.some((f) => f.payload?.includes("setContext"))
    if (hasWS) break
  }
  if (i === 3 && low.includes("deposit")) {
    // dismiss the deposit modal if present, then force the platform route
    await studioEvalPage(() => {
      for (const t of ["Later", "Maybe later", "Skip", "Close", "Not now", "×", "✕", "X"]) {
        const el = [...document.querySelectorAll("button, [role=button], a")].find((e) => (e.textContent || "").trim().replace(/\s+/g, " ").toLowerCase().startsWith(t.toLowerCase()))
        if (el) {
          el.click()
          return t
        }
      }
      return null
    }).catch(() => null)
    await studioGoto("https://app.expertoption.com/en/trading/")
    await studioGoto("https://app.expertoption.com/trading/")
  }
}

off()
const setCtx = frames.find((f) => f.payload?.includes("setContext"))
if (setCtx) {
  try {
    const obj = JSON.parse(setCtx.payload)
    const token = obj.token || obj.message?.token
    console.log("\nCAPTURED setContext token:", token ? token.slice(0, 14) + "…" + token.slice(-6) : "(none in frame)")
    if (token) console.log("FULL TOKEN:", token)
    console.log("WS URL source page:", await studioEvalPage(() => location.href).catch(() => "?"))
  } catch {
    console.log("frame not JSON:", String(setCtx.payload).slice(0, 300))
  }
} else {
  console.log("\nno setContext frame captured in " + frames.length + " frames")
}
await closeStudio().catch(() => {})
process.exit(0)
