// Dismiss the deposit overlay and inspect the trade room's asset picker.
import { openStudio, studioGoto, studioEvalPage, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await openStudio({ homepage: "" })
await studioGoto("https://app.expertoption.com/")
await sleep(12000)

await studioEvalPage(() => {
  const click = (el) => {
    try {
      el.click()
    } catch {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    }
  }
  // close any deposit/finances overlay via its close/back affordance
  const candidates = [
    document.querySelector('[data-testid="at_go_back_arrow"]'),
    ...[...document.querySelectorAll("[data-testid]")].find((e) => /close/i.test(e.getAttribute("data-testid") || "")),
    ...[...document.querySelectorAll("button, [role=button]")].find((e) => /later|skip|not now|no thanks/i.test(e.textContent || ""))
  ]
  for (const c of candidates) if (c) click(c)
  return null
}).catch(() => null)
await sleep(4000)

const dom = await studioEvalPage(() => {
  const tids = []
  for (const el of document.querySelectorAll("[data-testid]")) {
    const tid = el.getAttribute("data-testid")
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)
    if (/trade|asset|search|list|select|category|market/i.test(tid)) tids.push({ tid, text })
  }
  const assetButtons = []
  for (const el of document.querySelectorAll("div,span,button,li")) {
    const t = (el.textContent || "").trim().replace(/\s+/g, " ")
    if (/^(EUR\/USD|Gold|BTC\/USD|Coffee|Apple|US 500|S&P|Bitcoin|Crypto)\b/i.test(t) && t.length < 60) assetButtons.push({ tag: el.tagName, t })
  }
  return { url: location.href, tids: tids.slice(0, 40), assetButtons: assetButtons.slice(0, 25) }
})
console.log("URL:", dom.url)
console.log("TIDS:", dom.tids.map((x) => `${x.tid}=${x.text}`).join("\n  "))
console.log("ASSET BTNS:", dom.assetButtons.map((x) => `${x.tag}:${x.t}`).join("\n  "))
await closeStudio().catch(() => {})
process.exit(0)
