// Probe the redesigned browser-driven liveEO layer.
import { subscribeLiveEO, liveSnapshot, liveEOStats, stopLiveEO } from "../apps/dashboard/server/services/liveEO.mjs"
import { saveCredentials } from "../apps/dashboard/server/services/trading.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await saveCredentials({
  expertoptionToken: "6dc12a98582558c0581c56bdc27f8c8c",
  expertoptionDemo: true
})

let ticks = 0
const byAsset = new Map()
const off = subscribeLiveEO((msg) => {
  if (msg.type === "tick") {
    ticks++
    const k = `${msg.assetId}:${msg.period}`
    byAsset.set(k, (byAsset.get(k) || 0) + 1)
    if (ticks % 20 === 0) console.log("  tick sample:", JSON.stringify(msg))
  } else if (msg.type === "status") {
    console.log("status:", JSON.stringify(msg))
  } else if (msg.type === "snapshot") {
    console.log("snapshot assets:", msg.assets?.map((a) => `${a.name}@${a.price}`).join(", "))
  }
})

for (let i = 0; i < 12; i++) {
  await sleep(5000)
  const snap = liveSnapshot()
  const stats = liveEOStats()
  console.log(
    `[${i * 5}s] status=${snap.status} mode=${snap.mode} error=${snap.error || "-"} viewed=${snap.viewed} watched=${JSON.stringify(stats.watched)} ticks=${ticks}`
  )
  if (snap.status === "connected") {
    const s = liveEOStats()
    console.log("  tick map:", [...byAsset.entries()].slice(0, 12).map(([k, n]) => `${k}=${n}`).join(" "))
  }
  if (snap.error) break
}

off()
await sleep(1000)
await stopLiveEO()
process.exit(0)
