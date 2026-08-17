import { connectSession } from "../apps/dashboard/server/services/expertoption.mjs"
import { getCredentials } from "../apps/dashboard/server/services/trading.mjs"

const { expertoptionToken: token, expertoptionDemo } = await getCredentials()
const s = await connectSession({ token, isDemo: expertoptionDemo !== false })
const off = s.onFrame((f) => {
  if (f.action === "assetHistoryCandles") {
    console.log("history frame keys:", Object.keys(f).join(","), "id=", JSON.stringify(f.id), "action=", f.action)
  }
})
const now = Math.floor(Date.now() / 1000)
const resp = await s.sendRaw
  ? await new Promise((res, rej) => {
      let timer = setTimeout(() => rej(new Error("timeout")), 8000)
      const un = s.onFrame((f) => {
        if (f.action === "assetHistoryCandles" && (f.id === "probe-ns-1" || f.id == null)) {
          clearTimeout(timer)
          un()
          res(f)
        }
      })
      s.sendRaw({ action: "assetHistoryCandles", message: { assetid: 142, periods: [[now - 600, now]], timeframes: [60] }, token, ns: "probe-ns-1" })
    }).catch((e) => e.message)
  : "no sendRaw"
console.log("probe result:", typeof resp === "string" ? resp : JSON.stringify({ id: resp.id, keys: Object.keys(resp) }))
off()
s.close()
process.exit(0)
