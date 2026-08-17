import { subscribeLiveEO, liveSnapshot, liveEOStats, stopLiveEO } from "../apps/dashboard/server/services/liveEO.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ticks = 0
const off = subscribeLiveEO((m) => {
  if (m.type === "tick") ticks++
  else if (m.type === "snapshot") {
    console.log("snapshot:", m.assets.map((a) => `${a.name}=${a.price} (${a.spark.length} pts)`).join(" | "))
  }
})
await sleep(22000)
const stats = liveEOStats()
console.log(`status=${liveSnapshot().status} watched=${JSON.stringify(stats.watched)} ticks=${ticks} viewed=${stats.viewed} err=${stats.error || "-"}`)
off()
await sleep(500)
await stopLiveEO()
process.exit(0)
