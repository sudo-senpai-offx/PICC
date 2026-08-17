// List the app's fetch/XHR endpoints (potential REST candle/quotes API).
import { openStudio, studioGoto, studioEvalPage, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await openStudio({ homepage: "" })
await studioGoto("https://app.expertoption.com/")
await sleep(12000)
const res = await studioEvalPage(() =>
  performance
    .getEntriesByType("resource")
    .filter((e) => /fetch|xhr/i.test(e.initiatorType))
    .map((e) => e.name)
    .slice(0, 40)
)
console.log(res.join("\n"))
await closeStudio().catch(() => {})
process.exit(0)
