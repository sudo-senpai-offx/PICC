import { describe, expect, test } from "vitest"
import { tradingHudNodes } from "../services/tradingHud.mjs"

const sample = {
  ts: 1700000000000,
  mode: "demo",
  status: "connected",
  viewed: 142,
  decisions: [
    {
      assetId: "142",
      asset: "EUR / USD",
      verdict: "TRADE",
      direction: "up",
      phase: "trend",
      expiry: 900,
      winProb: 0.62,
      ev: 0.4,
      payout: 90,
      payoutSource: "assumed",
      priceRR: 2.4,
      evRR: 4.1,
      mttdSec: 120,
      sampled: 25,
      bars: 400,
      volume: "12/min up",
      reasons: ["gates met"]
    },
    {
      assetId: "160",
      asset: "BTCUSD",
      verdict: "NEUTRAL",
      direction: "down",
      phase: "quiet_range",
      expiry: 60,
      winProb: 0.51,
      ev: -0.01,
      payout: 82,
      payoutSource: "assumed",
      priceRR: null,
      evRR: 0.9,
      mttdSec: 1,
      sampled: 24,
      bars: 400,
      volume: null,
      reasons: ["no candidate"]
    }
  ]
}

describe("trading HUD node builder", () => {
  test("builds one root overlay node with header, demo badge, rows and footer", () => {
    const nodes = tradingHudNodes({ id: "expertoption", name: "ExpertOption" }, sample)
    expect(nodes).toHaveLength(1)
    const root = nodes[0]
    expect(root.attrs?.["data-picc-hud"]).toBe("compact")
    const texts = collectTexts([root])
    expect(texts.join(" ")).toContain("PICC · ExpertOption")
    expect(texts.join(" ")).toContain("DEMO")
    expect(texts.join(" ")).toContain("Read-only")
  })

  test("emits one row per decision with a clock for expiry and mttd", () => {
    const nodes = tradingHudNodes({ name: "ExpertOption" }, sample)
    const rows = collectNodes(nodes, (n) => n.attrs?.["data-picc-hud-role"] === "row")
    expect(rows).toHaveLength(2)
    const clocks = collectNodes(nodes, (n) => n.attrs?.["data-picc-clock"] !== undefined)
    // EUR/USD: expiry 900s + mttd 120s ; BTCUSD: expiry 60s + mttd 1s
    expect(clocks).toHaveLength(4)
    const labels = clocks.map((c) => c.attrs?.["data-label"])
    expect(labels).toEqual(expect.arrayContaining(["expiry", "mttd"]))
  })

  test("clocks carry absolute future timestamps derived from the decision ts", () => {
    const nodes = tradingHudNodes({ name: "ExpertOption" }, sample)
    const clocks = collectNodes(nodes, (n) => n.attrs?.["data-picc-clock"] !== undefined && n.attrs?.["data-label"] === "expiry")
    expect(Number(clocks[0].attrs?.["data-at"])).toBe(sample.ts + 900 * 1000)
    expect(Number(clocks[1].attrs?.["data-at"])).toBe(sample.ts + 60 * 1000)
  })

  test("empty decision list renders a warming-up notice instead of rows", () => {
    const nodes = tradingHudNodes({ name: "ExpertOption" }, { ts: Date.now(), mode: "demo", status: "connected", decisions: [] })
    const texts = collectTexts(nodes)
    expect(texts.join(" ")).toContain("warming up")
  })
})

function collectTexts(nodes) {
  const out = []
  const walk = (n) => {
    if (n.text != null) out.push(String(n.text))
    for (const c of n.children ?? []) walk(c)
  }
  for (const n of nodes) walk(n)
  return out
}

function collectNodes(nodes, pred) {
  const out = []
  const walk = (n) => {
    if (pred(n)) out.push(n)
    for (const c of n.children ?? []) walk(c)
  }
  for (const n of nodes) walk(n)
  return out
}
