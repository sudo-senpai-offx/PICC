// PICC selector tuner — verifies and repairs the DOM selectors of browser
// transport connectors against the live site. For each target it opens a real
// Chrome/Edge via the browser bridge, loads the dashboard, and reports (a) what
// the connector's current selectors matched and (b) candidate elements that look
// like balances/earnings/APY/floors, so the selectors in connectors.mjs can be
// fixed from observed structure.
//
// Usage:
//   node scripts/tune-connectors.mjs                   # all browser connectors
//   node scripts/tune-connectors.mjs opensea yearn     # specific slugs
//   node scripts/tune-connectors.mjs --timeout 25000   # longer DOM wait
//   node scripts/tune-connectors.mjs --headful         # visible browser
//   node scripts/tune-connectors.mjs --url https://…   # override URL (single target)
//
// Output: apps/dashboard/server/data/tuner-report.json
import { parseArgs } from "node:util"
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { openBridge, browserAvailable } from "../apps/dashboard/server/services/browserBridge.mjs"
import { listConnectors } from "../apps/dashboard/server/services/connectors.mjs"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    timeout: { type: "string", default: "20000" },
    headful: { type: "boolean", default: false },
    url: { type: "string" }
  }
})
const timeoutMs = Math.max(3000, Number(values.timeout) || 20000)
const slugFilter = positionals.length > 0 ? new Set(positionals) : null
const targets = listConnectors()
  .filter((c) => c.transports.includes("browser"))
  .filter((c) => !slugFilter || slugFilter.has(c.slug))

const OUT_FILE = join(fileURLToPath(new URL("../apps/dashboard/server/data", import.meta.url)), "tuner-report.json")

async function scanPage(bridge) {
  const candidates = await bridge.evaluate(() => {
    const labelRe = /balance|earnings|earned|payout|credits|profit|apy|yield|floor|volume|today|threshold|available|pending|reward/i
    const out = []
    const seen = new Set()
    for (const el of document.querySelectorAll("span, div, strong, p, td, a, h1, h2, h3, label")) {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ")
      if (!text || text.length > 90 || seen.has(text)) continue
      const cls = String(el.className ?? "")
      if (labelRe.test(text) && /\d/.test(text)) {
        seen.add(text)
        out.push({
          tag: el.tagName.toLowerCase(),
          text,
          cls: cls.slice(0, 120),
          aria: el.getAttribute("aria-label") ?? ""
        })
      }
    }
    return out.slice(0, 40)
  })
  return candidates
}

async function main() {
  if (!(await browserAvailable())) {
    console.error("No browser found — install Chrome/Edge or set PICC_BROWSER_PATH.")
    process.exit(1)
  }
  if (targets.length === 0) {
    console.error("No browser-transport connectors matched. Usage: node scripts/tune-connectors.mjs [slug...]")
    process.exit(1)
  }

  const report = {}
  for (const c of targets) {
    const url = values.url && targets.length === 1 ? values.url : c.url
    process.stdout.write(`\nTuning ${c.slug} (${c.transport}) ${url} … `)
    let bridge = null
    try {
      bridge = await openBridge({ profile: c.slug, headless: !values.headful })
      await bridge.goto(url)
      const deadline = Date.now() + timeoutMs
      let current = null
      while (Date.now() < deadline) {
        current = await bridge.read({ selectors: c.selectors })
        if (Object.values(current).some((v) => v != null && String(v).trim() !== "")) break
        await new Promise((r) => setTimeout(r, 1000))
      }
      const candidates = await scanPage(bridge)
      report[c.slug] = { url, tuned: c.tuned, current, candidates }
      const matched = Object.entries(current ?? {}).filter(([, v]) => v != null && String(v).trim() !== "").length
      console.log(`ok (${matched} current selectors matched, ${candidates.length} candidates)`)
    } catch (err) {
      report[c.slug] = { url, tuned: c.tuned, error: err.message }
      console.log(`error: ${String(err.message).slice(0, 90)}`)
    } finally {
      if (bridge) await bridge.close().catch(() => {})
    }
  }

  mkdirSync(fileURLToPath(new URL("../apps/dashboard/server/data", import.meta.url)), { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(report, null, 2))
  console.log(`\nReport written to ${OUT_FILE}`)
  for (const [slug, r] of Object.entries(report)) {
    const err = r.error ? ` · error: ${r.error}` : ` · ${r.candidates.length} candidates`
    console.log(`  - ${slug}${err}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
