// Keep the studio app open and streaming for N seconds (used as a background helper).
import { openStudio, studioGoto, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const secs = Number(process.argv[2] || 30)
await openStudio({ homepage: "" })
await studioGoto("https://app.expertoption.com/")
await new Promise((r) => setTimeout(r, secs * 1000))
await closeStudio().catch(() => {})
process.exit(0)
