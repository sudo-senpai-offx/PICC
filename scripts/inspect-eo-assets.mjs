// Inspect the EO trade room DOM for the asset selector mechanism.
import { openStudio, studioGoto, studioEvalPage, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await openStudio({ homepage: "" })
await studioGoto("https://app.expertoption.com/")
await sleep(12000)

const dom = await studioEvalPage(() => {
  const els = []
  for (const el of document.querySelectorAll("[data-testid]")) {
    const tid = el.getAttribute("data-testid")
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50)
    els.push({ tid, text })
  }
  // find elements containing asset-like names
  const assetRows = []
  for (const el of document.querySelectorAll("div, span, li")) {
    const t = (el.textContent || "").trim().replace(/\s+/g, " ")
    if (/EUR\/USD|Coffee|BTC\/USD|Gold/i.test(t) && t.length < 60) assetRows.push({ tag: el.tagName, t })
  }
  return { testids: els.slice(0, 60), assetRows: assetRows.slice(0, 20) }
})
console.log("TESTIDS:", dom.testids.map((x) => `${x.tid}=${x.text}`).join("\n  "))
console.log("\nASSET ROWS:", dom.assetRows.map((x) => `${x.tag}:${x.t}`).join("\n  "))
await closeStudio().catch(() => {})
process.exit(0)
