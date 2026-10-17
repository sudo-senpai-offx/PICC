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

import { stripComments } from "../scripts/guard-primitives.mjs"

const repoFile = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

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

  // THE MIGRATION HAZARD, PINNED ON THIS GUARD'S OWN SCAN SURFACE. This file used
  // to carry its own lexer, which DELETED comments. Deleting a multi-line block
  // comment removes its newlines, so every line index after the first one named the
  // wrong source line — and 51 of the 71 terminal files collapsed. Invisible while
  // every assertion is a whole-corpus substring match, fatal the first time a
  // finding reports a position. The shared lexer blanks comments to spaces.
  //
  // THE COMPANION HALF, which runs the other way and is the reason this is worth
  // stating rather than assuming: the local lexer left regex BODIES readable, and
  // the shared lexer blanks them. On this corpus that is 206 lines the old
  // instrument showed and this one does not — including the two deny-list regexes
  // in `adapters/redaction.ts`. Both are the deliberate direction (a regex body is
  // not code), but "the scan can no longer see the pattern text" is exactly the
  // blind spot that made the regex blanking load-bearing for the connectors
  // enumeration elsewhere, so it is measured here rather than left unsaid.
  it("the stripped view keeps every source line at its own index, across the terminal tree", () => {
    expect(TERMINAL_SOURCES.length, "the terminal tree must not be empty, or this proves nothing").toBeGreaterThan(10)
    for (const f of TERMINAL_SOURCES) {
      const src = readFileSync(f, "utf8")
      const view = stripComments(src)
      expect(view.length, `${f}: length changed, so a column offset would point at the wrong token`).toBe(src.length)
      expect(view.split("\n"), `${f}: line count changed, so a file:line finding would name the wrong line`).toHaveLength(
        src.split("\n").length
      )
    }
  })

  it("a regex BODY is blanked on its own line, and the code around it survives", () => {
    // The complement of the assertion above, stated in the direction that matters:
    // a regex body must not read as code, and blanking it must not take the call
    // site with it. This is the shape that made the two ws7 guards pass vacuously.
    //
    // PINNED TO A LINE, and located rather than written down. `redaction.ts` carries
    // two deny-list regexes whose bodies enumerate credential names, and it also
    // carries those same names as legitimate STRING literals — so a whole-file
    // `not.toContain` would be asserting the wrong thing and would have failed
    // here. The claim is about the regex line alone, found by the assignment whose
    // body is the enumeration, so it survives reformatting and stays exact.
    const src = readFileSync(join(TERMINAL_DIR, "adapters/redaction.ts"), "utf8")
    const raw = src.split("\n")
    const view = stripComments(src).split("\n")
    const assignment = raw.findIndex((l) => /^const SECRET_ASSIGNMENT =\s*$/.test(l))
    const body = assignment + 1
    expect(assignment, "redaction.ts must still carry the SECRET_ASSIGNMENT regex").toBeGreaterThan(-1)
    expect(raw[body], "the pinned line must really be the regex body this asserts on").toContain("mnemonic")
    expect(view[body], `line ${body + 1}: the regex body must not be readable as code`).not.toContain("mnemonic")
    expect(view[assignment], `line ${assignment + 1}: the binding itself must survive`).toContain("SECRET_ASSIGNMENT")
    expect(view.join("\n"), "code after a blanked regex must survive").toContain("containsSecretMaterial")
    expect(view.join("\n"), "the call sites must survive").toContain("SECRET_ASSIGNMENT.test(text)")
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
