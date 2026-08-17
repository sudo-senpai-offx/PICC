// Side-by-side: count app-side pushes AND our-socket pushes simultaneously.
import { openStudio, studioGoto, studioOnFrame, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"
import { expertoptionWsUrl } from "../apps/dashboard/server/services/expertoption.mjs"
import { wsConnect } from "../apps/dashboard/server/services/wsclient.mjs"

const TOKEN = "6dc12a98582558c0581c56bdc27f8c8c"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await openStudio({ homepage: "" })
let appPushes = 0
let appFrames = 0
const off = studioOnFrame((f) => {
  if (f.dir !== "recv") return
  appFrames += 1
  const t = Buffer.isBuffer(f.payload) ? f.payload.toString("utf8") : f.payload
  if (t.includes('"candles"') && !t.includes("assetHistoryCandles")) appPushes += 1
})
await studioGoto("https://app.expertoption.com/")
await sleep(10000)
console.log("app frames:", appFrames, "app candle pushes:", appPushes)

const url = expertoptionWsUrl("wss://fr24g1eu.expertoption.com/ws/v45")
const wsc = await wsConnect(url, {
  headers: {
    Origin: "https://app.expertoption.com",
    Referer: "https://app.expertoption.com/",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: `token=${TOKEN}; tokenDemo=b456f4a90adc1fbbf0b557151a0dea2e; language=en`
  },
  timeoutMs: 12000
})
let ourPushes = 0
wsc.onMessage = (t) => {
  if (t.includes('"candles"') && !t.includes("assetHistoryCandles")) {
    ourPushes += 1
    if (ourPushes <= 2) console.log("[our push]", t.slice(0, 160))
  }
}
wsc.sendText(JSON.stringify({ action: "setContext", token: TOKEN, message: { is_demo: 1 }, ns: 1 }))
await sleep(1500)
wsc.sendText(
  JSON.stringify({
    action: "assetHistoryCandles",
    message: { assetid: 553, periods: [[Math.floor(Date.now() / 1000) - 600, Math.floor(Date.now() / 1000)]], timeframes: [5] },
    token: TOKEN,
    ns: 13
  })
)
await sleep(12000)
console.log("our pushes:", ourPushes, "| app pushes during our window:", appPushes)
wsc.close()
off()
await closeStudio().catch(() => {})
process.exit(0)
