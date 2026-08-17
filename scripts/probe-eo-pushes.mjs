// Does the v45 gateway push live candles to our own WS session when the
// platform app is also open on the same token? Connect ours, request history
// for asset 553 (the app's active asset) and for BTCUSD, then watch pushes.
import { connectSession } from "../apps/dashboard/server/services/expertoption.mjs"

const TOKEN = "6dc12a98582558c0581c56bdc27f8c8c"

const s = await connectSession({ token: TOKEN, isDemo: true, timeoutMs: 12000 })
const seen = {}
const off = s.onCandles((live) => {
  for (const c of live.candles) {
    const k = `${live.assetId}@${c.timeframe}`
    seen[k] = (seen[k] || 0) + 1
    if (seen[k] <= 3) console.log(`[push] asset=${live.assetId} tf=${c.timeframe} t=${c.time} close=${c.close}`)
  }
})
for (const [sym, aid] of [["XAUUSD", "553"], ["BTCUSD", "160"]]) {
  const t0 = Date.now()
  try {
    const h = await s.candles(sym, 60, 60)
    console.log(`requested ${sym} (#${aid}) tf=60 -> ohlc=${h.ohlc.length} in ${Date.now() - t0}ms`)
  } catch (e) {
    console.log(`requested ${sym} FAILED: ${e.message}`)
  }
}
await new Promise((r) => setTimeout(r, 20000))
console.log("\npush counts:", JSON.stringify(seen))
off()
s.close()
process.exit(0)
