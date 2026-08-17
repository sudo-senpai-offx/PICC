// Full-fidelity WS sniff: print every WS url + sent/received frame for the
// ExpertOption platform, so we can mirror the app's exact auth handshake.
// Run: node scripts/sniff-eo-ws.mjs
import { openStudio, studioGoto, studioOnFrame, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await openStudio({ homepage: "" })
const off = studioOnFrame((f) => {
  console.log(`[${f.dir}${f.url ? " " + f.url : ""}] ${String(f.payload).slice(0, 400)}`)
})
await studioGoto("https://app.expertoption.com/")
await sleep(20000)
off()
await closeStudio().catch(() => {})
process.exit(0)
