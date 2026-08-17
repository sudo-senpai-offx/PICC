// Dump ExpertOption web storage to locate the real session-token key.
import { openStudio, studioGoto, closeStudio, studioEvalPage } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await openStudio({ homepage: "" })
await studioGoto("https://app.expertoption.com/")
await sleep(12000)

const dump = await studioEvalPage(() => {
  const pattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}::[A-Za-z0-9+/=_\-]+/
  const ls = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    const v = localStorage.getItem(k) ?? ""
    if (v.length > 400) continue
    ls[k] = { len: v.length, token: pattern.test(v), head: v.slice(0, 60) }
  }
  const ss = {}
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i)
    const v = sessionStorage.getItem(k) ?? ""
    if (v.length > 400) continue
    ss[k] = { len: v.length, token: pattern.test(v), head: v.slice(0, 60) }
  }
  const cookies = document.cookie.split(";").map((c) => c.trim()).filter(Boolean)
  return { url: location.href, title: document.title, ls, ss, cookies: cookies.map((c) => ({ c: c.slice(0, 80), token: pattern.test(c) })) }
})

console.log("URL:", dump.url)
console.log("TITLE:", dump.title)
console.log("\n-- localStorage --")
for (const [k, v] of Object.entries(dump.ls)) console.log(`  ${k} (len=${v.len}) token=${v.token} head=${v.head}`)
console.log("\n-- sessionStorage --")
for (const [k, v] of Object.entries(dump.ss)) console.log(`  ${k} (len=${v.len}) token=${v.token} head=${v.head}`)
console.log("\n-- cookies --")
for (const c of dump.cookies) console.log(`  ${c.token ? "TOKEN " : ""}${c.c}`)

await closeStudio().catch(() => {})
process.exit(0)
