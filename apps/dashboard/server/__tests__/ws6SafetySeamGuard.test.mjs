// WS-6 T9 — safety seam guard (RED, AC-007/008/012/013/015/017).
//
// This is the bisect matrix's "Safety/Blueprint" checkpoint. It must pass
// BEFORE any room is visually promoted, because every other slice can make the
// terminal look finished while a safety boundary is still open.
//
// Each guard here corresponds to a locked owner decision or a P0 acceptance
// criterion. They are source-level assertions, so they fail loudly on a
// regression rather than depending on a runtime path being exercised.
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const repoFile = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")

const PKG = repoFile("../../package.json")
const TERMINAL_DIR = fileURLToPath(new URL("../../src/terminal/", import.meta.url))
const CHANGELOG_DIR = fileURLToPath(new URL("../../../../docs/trading-logic/changelog/", import.meta.url))

function terminalSources(dir = TERMINAL_DIR, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) terminalSources(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

const TERMINAL_SOURCES = terminalSources()
const TERMINAL_CODE = TERMINAL_SOURCES.map((f) => stripComments(readFileSync(f, "utf8"))).join("\n")

describe("AC-013 — paper-only command surface", () => {
  it("declares no live-money execution mode in the terminal", () => {
    // `ExecutionMode` may only be "paper" | "reserved" (D12).
    expect(TERMINAL_CODE).not.toMatch(/["']live["']\s*as\s+const/)
    const contracts = repoFile("../../src/terminal/contracts.ts")
    expect(contracts).toMatch(/ExecutionMode\s*=\s*"paper"\s*\|\s*"reserved"/)
  })

  it("renders no live/live-trading toggle in any terminal component", () => {
    for (const banned of ["Live Trading", "live trading", "Enable live", "go live", "GO LIVE"]) {
      expect(TERMINAL_CODE, `terminal must not render "${banned}"`).not.toContain(banned)
    }
  })

  it("requests no venue credential, API key, or private key from shipped client code", () => {
    // Secret-shaped names are allowed in exactly two places: the redaction
    // deny-list, whose job is to name what it strips, and test files, which
    // must be able to construct secret-shaped fixtures to prove redaction works.
    // Neither ships to the browser, so the property under test is the SHIPPED
    // terminal modules.
    const shipped = TERMINAL_SOURCES.filter((f) => {
      const p = f.replace(/\\/g, "/")
      return !p.endsWith("/adapters/redaction.ts") && !p.includes("/__tests__/")
    })
    const offenders = shipped.filter((f) => {
      const code = stripComments(readFileSync(f, "utf8"))
      return ["privateKey", "apiKey", "secretKey", "PICC_CCXT_", "walletAddress"].some((b) => code.includes(b))
    })
    expect(offenders.map((f) => f.replace(/\\/g, "/").split("/src/")[1]), "shipped terminal modules must not handle credentials").toEqual([])
  })

  it("keeps the credential deny-list confined to the redaction adapter", () => {
    const others = TERMINAL_SOURCES.filter(
      (f) => !f.replace(/\\/g, "/").endsWith("/adapters/redaction.ts")
    )
    for (const f of others) {
      const code = stripComments(readFileSync(f, "utf8"))
      expect(code, `${f} must not re-implement a credential deny-list`).not.toMatch(/DENY_(EXACT|CONTAINS)/)
    }
  })
})

describe("AC-017 — no secret boundary in the terminal tree", () => {
  it("contains no hardcoded 0x private key material", () => {
    expect(TERMINAL_CODE).not.toMatch(/0x[0-9a-fA-F]{64}/)
  })

  it("contains no bare 64-hex literal that could be key material", () => {
    expect(TERMINAL_CODE).not.toMatch(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/)
  })

  it("routes rendered values through the redaction boundary", () => {
    expect(existsSync(join(TERMINAL_DIR, "adapters/redaction.ts"))).toBe(true)
    expect(TERMINAL_CODE).toContain("redactSecrets")
  })
})

describe("AC-008 — no candle-derived bar-only value in the terminal", () => {
  it("does not compute order-flow delta from candle structure", () => {
    for (const banned of ["bodyRatio", "buyPct", "sellPct"]) {
      expect(TERMINAL_CODE, `terminal must not derive ${banned} from candles`).not.toContain(banned)
    }
  })

  it("exposes no numeric placeholder on a non-live availability", () => {
    const availability = repoFile("../../src/terminal/domain/availability.ts")
    const unavailableBranch = availability.slice(
      availability.indexOf("export function unavailable"),
      availability.indexOf("export function reserved")
    )
    for (const forbidden of ["value:", "delta:", "cumulative: 0", "netPnl:"]) {
      expect(unavailableBranch, `unavailable must not expose ${forbidden}`).not.toContain(forbidden)
    }
  })
})

describe("D13 / D16 — forbidden dependencies stay absent", () => {
  it("has not added cmdk", () => {
    expect(PKG).not.toContain('"cmdk"')
  })

  it("has not added a WebGL/particle/aurora/3D animation dependency", () => {
    for (const banned of ["three", "react-three-fiber", "@react-three/drei", "ogl", "pixi.js", "tsParticles", "gsap", "animejs", "framer-motion"]) {
      expect(PKG, `forbidden animation dependency ${banned} must stay absent`).not.toContain(`"${banned}"`)
    }
  })

  it("has not added a second chart library", () => {
    for (const banned of ["highcharts", "chart.js", "plotly.js", "@nivo", "echarts", "recharts"]) {
      expect(PKG, `second chart library ${banned} must stay absent`).not.toContain(`"${banned}"`)
    }
  })
})

describe("AC-012 / AC-017 — no second transport or credentialed transport", () => {
  it("opens no new WebSocket or EventSource in the terminal tree", () => {
    for (const banned of ["new WebSocket", "new EventSource", "wss://", "ws://"]) {
      expect(TERMINAL_CODE, `terminal must not open its own transport (${banned})`).not.toContain(banned)
    }
  })

  it("does not fetch a credential-bearing endpoint from the terminal", () => {
    expect(TERMINAL_CODE).not.toMatch(/fetch\([^)]*(credential|private-key|vault)/i)
  })
})

describe("AC-015 — blueprint provenance and supersession changelog", () => {
  it("has a trading-logic changelog directory", () => {
    expect(existsSync(CHANGELOG_DIR)).toBe(true)
  })

  it("records a blueprint provenance entry that is present OR explicitly UNVERIFIED", () => {
    const provenance = join(CHANGELOG_DIR, "blueprint-v4-provenance.md")
    expect(existsSync(provenance), "blueprint provenance record must be checked in").toBe(true)
    const text = readFileSync(provenance, "utf8")
    const marked = /provenance:\s*UNVERIFIED/i.test(text) || /provenance:\s*VERIFIED/i.test(text)
    expect(marked, "provenance must be explicitly marked VERIFIED or UNVERIFIED").toBe(true)
  })

  it("documents the supersession record schema", () => {
    const readme = join(CHANGELOG_DIR, "README.md")
    expect(existsSync(readme)).toBe(true)
    const text = readFileSync(readme, "utf8")
    for (const field of ["supersededBy", "date", "historicalTradesAffected"]) {
      expect(text, `changelog schema must require ${field}`).toContain(field)
    }
  })
})
