// Research probe: does the live app WS stream carry any payout/percent/profit
// data that a decision engine could read without placing a trade?
import { studioIsOpen, openStudio, studioGoto, studioOnFrame, studioStatus } from "../apps/dashboard/server/services/browserStudio.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!studioIsOpen()) {
    console.log("studio closed — opening (needs the app.expertoption.com tab)")
    await openStudio({ homepage: "" })
  }
  const onEO = () => {
    try {
      const status = studioStatus()
      const active = status?.tabs?.find((t) => t.id === status.activeTabId)
      return active && /app\.expertoption\.com/i.test(active.url ?? "")
    } catch {
      return false
    }
  }
  if (!onEO()) {
    console.log("no app.expertoption.com tab active — navigating")
    await studioGoto("https://app.expertoption.com/").catch(() => {})
  }

  const hits = []
  const actions = new Map()
  const un = studioOnFrame((f) => {
    if (f.dir !== "recv") return
    const t = Buffer.isBuffer(f.payload) ? f.payload.toString("utf8") : String(f.payload ?? "")
    const a = (() => {
      try {
        return JSON.parse(t)?.action ?? "?"
      } catch {
        return "non-json"
      }
    })()
    actions.set(a, (actions.get(a) ?? 0) + 1)
    const lt = t.toLowerCase()
    if (/payout|profit|percent|percent_profit|yield|win_amount/.test(lt)) {
      hits.push({ a, t: t.slice(0, 220) })
      if (hits.length > 6) un()
    }
  })

  await sleep(40000)
  un()
  console.log("actions seen:", [...actions.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => `${k}×${v}`).join(", "))
  console.log("payout-ish frames:", hits.length ? hits.map((h) => `\n  [${h.a}] ${h.t}`).join("") : "NONE")
  process.exit(0)
}

main().catch((e) => {
  console.log("probe error:", e?.message ?? e)
  process.exit(1)
})
