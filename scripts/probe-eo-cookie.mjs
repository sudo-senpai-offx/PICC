// Does a WS connection with the session cookie receive live candle pushes?
import { expertoptionWsUrl } from "../apps/dashboard/server/services/expertoption.mjs"
import { wsConnect } from "../apps/dashboard/server/services/wsclient.mjs"

const TOKEN = "6dc12a98582558c0581c56bdc27f8c8c"
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

let pushes = 0
wsc.onMessage = (t) => {
  if (t.includes('"candles"')) {
    pushes += 1
    if (pushes <= 2) console.log("[push]", t.slice(0, 180))
  }
}
wsc.sendText(JSON.stringify({ action: "setContext", token: TOKEN, message: { is_demo: 1 }, ns: 1 }))
await new Promise((r) => setTimeout(r, 2000))
wsc.sendText(
  JSON.stringify({
    action: "assetHistoryCandles",
    message: { assetid: 553, periods: [[Math.floor(Date.now() / 1000) - 600, Math.floor(Date.now() / 1000)]], timeframes: [5] },
    token: TOKEN,
    ns: 13
  })
)
await new Promise((r) => setTimeout(r, 15000))
console.log("pushes with cookie header:", pushes)
wsc.close()
process.exit(0)
