// Decode the app's live candle push frames fully.
import { openStudio, studioGoto, studioOnFrame, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await openStudio({ homepage: "" })
const off = studioOnFrame((f) => {
  if (f.dir !== "recv") return
  const p = f.payload
  if (!Buffer.isBuffer(p) && !p?.includes?.('"candles"')) return
  const text = Buffer.isBuffer(p) ? p.toString("utf8") : p
  if (!text.includes('"candles"')) return
  console.log("---")
  console.log(text.slice(0, 500))
})
await studioGoto("https://app.expertoption.com/")
await sleep(15000)
off()
await closeStudio().catch(() => {})
process.exit(0)
