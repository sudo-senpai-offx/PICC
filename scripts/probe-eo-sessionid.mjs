// Hypothesis test: replicate the app's connection exactly — same app_session_id,
// same cookies, same bootstrap — and see if live pushes flow to our socket.
import { openStudio, studioGoto, studioOnFrame, closeStudio, studioEvalPage } from "../apps/dashboard/server/services/browserStudio.mjs"
import { wsConnect } from "../apps/dashboard/server/services/wsclient.mjs"

const TOKEN = "6dc12a98582558c0581c56bdc27f8c8c"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await openStudio({ homepage: "" })

// 1) capture the app's live app_session_id
let appSessionId = null
const off = studioOnFrame((f) => {
  if (!appSessionId && f.url?.includes("app_session_id=")) {
    appSessionId = f.url.split("app_session_id=")[1].split("&")[0]
  }
})
await studioGoto("https://app.expertoption.com/")
for (let i = 0; i < 30 && !appSessionId; i++) await sleep(1000)
console.log("app_session_id:", appSessionId ?? "(none)")
off()

if (appSessionId) {
  // 2) open our own socket with the SAME app_session_id + cookies
  const url = `wss://fr24g1eu.expertoption.com/ws/v45?app_os=win&app_source=web&app_type=web&app_version=34.0.2&app_build_number=32785&app_brand=expertoption&app_theme=dark&app_device_info=desktop&app_session_id=${appSessionId}`
  const wsc = await wsConnect(url, {
    headers: {
      Origin: "https://app.expertoption.com",
      Referer: "https://app.expertoption.com/",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: `token=${TOKEN}; tokenDemo=b456f4a90adc1fbbf0b557151a0dea2e; language=en`
    },
    timeoutMs: 12000
  })
  let pushes = 0
  wsc.onMessage = (t) => {
    if (t.includes('"candles"') && !t.includes('assetHistoryCandles')) {
      pushes += 1
      if (pushes <= 2) console.log("[push]", t.slice(0, 160))
    }
  }
  wsc.sendText(JSON.stringify({ action: "setContext", token: TOKEN, message: { is_demo: 1 }, ns: 1 }))
  await sleep(2000)
  wsc.sendText(
    JSON.stringify({
      action: "assetHistoryCandles",
      message: { assetid: 553, periods: [[Math.floor(Date.now() / 1000) - 600, Math.floor(Date.now() / 1000)]], timeframes: [5] },
      token: TOKEN,
      ns: 13
    })
  )
  await sleep(12000)
  console.log("pushes with same app_session_id:", pushes)
  wsc.close()
}
await closeStudio().catch(() => {})
process.exit(0)
