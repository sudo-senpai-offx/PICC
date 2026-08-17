// Deep sniff: how many sockets, which URLs, and the full received stream.
import { openStudio, studioGoto, studioOnFrame, studioStatus, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await openStudio({ homepage: "" })
const sockets = new Map()
const all = []
const off = studioOnFrame((f) => {
  const key = f.url || "?"
  sockets.set(key, (sockets.get(key) || 0) + 1)
  all.push(f)
})
await studioGoto("https://app.expertoption.com/")
await sleep(25000)
off()

console.log("sockets:", JSON.stringify([...sockets.entries()], null, 0))
const recvCandles = all.filter((f) => f.dir === "recv" && f.payload?.includes('"candles"'))
const sentActions = [...new Set(all.filter((f) => f.dir === "sent").map((f) => {
  try { return JSON.parse(f.payload)?.action } catch { return "?" }
}))]
console.log("sent actions:", sentActions.join(", "))
console.log("candle pushes received:", recvCandles.length, "| sample payload:", recvCandles[0]?.payload?.slice(0, 200))
await closeStudio().catch(() => {})
process.exit(0)
