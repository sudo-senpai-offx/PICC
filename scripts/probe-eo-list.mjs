// Try opening the EO asset list and see which candle pushes flow.
import { openStudio, studioGoto, studioOnFrame, studioEvalPage, closeStudio } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await openStudio({ homepage: "" })

const pushed = new Map() // assetId -> count
const off = studioOnFrame((f) => {
  if (f.dir !== "recv") return
  const t = Buffer.isBuffer(f.payload) ? f.payload.toString("utf8") : String(f.payload ?? "")
  if (!t.includes('"candles"') || t.includes("assetHistoryCandles")) return
  try {
    const obj = JSON.parse(t)
    const id = obj.message?.assetId
    if (id != null) pushed.set(id, (pushed.get(id) || 0) + 1)
  } catch {}
})

await studioGoto("https://app.expertoption.com/")
await sleep(10000)

// dump all nav-related testids
const nav = await studioEvalPage(() =>
  [...document.querySelectorAll("[data-testid]")]
    .map((el) => el.getAttribute("data-testid"))
    .filter((t) => /nav|trade|menu|list|select|asset/i.test(t || ""))
    .slice(0, 40)
)
console.log("NAV TIDS:", nav.join(", "))

// try clicking a "Trade"/asset-list trigger
await studioEvalPage(() => {
  const click = (el) => {
    try {
      el.click()
    } catch {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    }
  }
  const el =
    document.querySelector('[data-testid="at_nav_trade_button"]') ||
    [...document.querySelectorAll("[data-testid]")].find((e) => /trade/i.test(e.getAttribute("data-testid") || "")) ||
    [...document.querySelectorAll("button, [role=button]")].find((e) => /^Trade$/i.test((e.textContent || "").trim()))
  if (el) {
    click(el)
    return el.getAttribute("data-testid")
  }
  return null
}).catch(() => null)
await sleep(6000)

const listOpen = await studioEvalPage(() => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ")
  return { url: location.href, hasList: /Forex|Crypto|Indices|Stocks|Commodities/i.test(t), sample: t.slice(0, 200) }
}).catch(() => null)
console.log("after click:", JSON.stringify(listOpen))
console.log("pushed assets:", JSON.stringify([...pushed.entries()]))

off()
await closeStudio().catch(() => {})
process.exit(0)
