// Inspect the EO platform's asset routing + bundle URLs from the open page.
import { openStudio, studioGoto, studioEvalPage, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await openStudio({ homepage: "" })
await studioGoto("https://app.expertoption.com/")
await sleep(10000)

const info = await studioEvalPage(() => {
  const links = [...document.querySelectorAll("a")]
    .map((a) => a.getAttribute("href"))
    .filter((h) => h && /trading|asset|chart/i.test(h))
    .slice(0, 15)
  const buttons = [...document.querySelectorAll("[data-testid], [class*=asset]")]
    .slice(0, 10)
    .map((el) => ({ tag: el.tagName, text: (el.textContent || "").trim().slice(0, 40), testid: el.getAttribute("data-testid") }))
  const scripts = performance
    .getEntriesByType("resource")
    .map((e) => e.name)
    .filter((n) => /\.js/.test(n))
    .slice(0, 6)
  const bodyText = (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300)
  return { url: location.href, links, buttons, scripts, bodyText }
})
console.log(JSON.stringify(info, null, 1))
await closeStudio().catch(() => {})
process.exit(0)
