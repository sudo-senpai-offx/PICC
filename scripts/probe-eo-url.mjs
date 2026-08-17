// Can URL navigation drive the EO app's viewed asset?
import { openStudio, studioGoto, studioOnFrame, studioEvalPage, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await openStudio({ homepage: "" })

const pushed = new Map()
const off = studioOnFrame((f) => {
  if (f.dir !== "recv") return
  const t = Buffer.isBuffer(f.payload) ? f.payload.toString("utf8") : String(f.payload ?? "")
  if (!t.includes('"candles"') || t.includes("assetHistoryCandles")) return
  try {
    const id = JSON.parse(t).message?.assetId
    if (id != null) pushed.set(id, (pushed.get(id) || 0) + 1)
  } catch {}
})

await studioGoto("https://app.expertoption.com/")
await sleep(9000)

const candidates = [
  "https://app.expertoption.com/trading/160",
  "https://app.expertoption.com/en/trading/160",
  "https://app.expertoption.com/trade/160",
  "https://app.expertoption.com/?asset=160",
  "https://app.expertoption.com/#/trading/160"
]
for (const u of candidates) {
  const before = [...pushed.keys()]
  await studioGoto(u).catch(() => {})
  await sleep(5000)
  const after = [...pushed.keys()]
  const newlyPushed = after.filter((k) => !before.includes(k))
  const urlNow = await studioEvalPage(() => location.href).catch(() => "?")
  console.log(`${u}\n   -> url now: ${urlNow}\n   -> newly pushed assets: ${JSON.stringify(newlyPushed)}`)
}
off()
await closeStudio().catch(() => {})
process.exit(0)
