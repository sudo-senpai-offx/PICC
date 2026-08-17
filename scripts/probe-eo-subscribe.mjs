// Try subscribeCandles variants against the v45 gateway on a headless socket.
import { expertoptionWsUrl } from "../apps/dashboard/server/services/expertoption.mjs"
import { wsConnect } from "../apps/dashboard/server/services/wsclient.mjs"

const TOKEN = "6dc12a98582558c0581c56bdc27f8c8c"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const url = expertoptionWsUrl("wss://fr24g1eu.expertoption.com/ws/v45")
const wsc = await wsConnect(url, {
  headers: { Origin: "https://app.expertoption.com", Referer: "https://app.expertoption.com/", "Accept-Language": "en-US,en;q=0.9" },
  timeoutMs: 12000
})

let pushes = 0
wsc.onMessage = (t) => {
  if (t.includes('"candles"') && !t.includes("assetHistoryCandles")) {
    pushes += 1
    if (pushes <= 3) console.log("[push]", t.slice(0, 160))
  }
}
wsc.sendText(JSON.stringify({ action: "setContext", token: TOKEN, message: { is_demo: 1 }, ns: 1 }))
await sleep(1500)

// variant 1: subscribeCandles with v45 assetid + timeframes
wsc.sendText(
  JSON.stringify({ action: "subscribeCandles", message: { assetid: 553, timeframes: [5] }, token: TOKEN, ns: 21 })
)
await sleep(2500)
console.log("after subscribeCandles(v45 shape):", pushes)

// variant 2: subscribeCandles with asset_id + timeframe
wsc.sendText(
  JSON.stringify({ action: "subscribeCandles", message: { asset_id: 553, timeframes: [5] }, token: TOKEN, ns: 22 })
)
await sleep(2500)
console.log("after subscribeCandles(asset_id shape):", pushes)

// variant 3: history request then watch
wsc.sendText(
  JSON.stringify({
    action: "assetHistoryCandles",
    message: { assetid: 553, periods: [[Math.floor(Date.now() / 1000) - 600, Math.floor(Date.now() / 1000)]], timeframes: [5] },
    token: TOKEN,
    ns: 13
  })
)
await sleep(8000)
console.log("after history request:", pushes)
wsc.close()
process.exit(0)
