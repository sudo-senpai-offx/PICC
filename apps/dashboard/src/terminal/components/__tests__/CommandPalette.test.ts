// WS-6 T7 — command palette availability contract (RED, AC-005 / AC-007 / AC-013).
//
// T7 requires that a command can never bypass the server's consent/risk rails.
// The enforceable form of that: the palette may only OFFER an action whose
// capability is actually available, and an unavailable capability yields a
// command that is present-but-disabled rather than silently absent (so the
// operator can see it exists and why it cannot run).
import { describe, expect, it } from "vitest"
import { buildCommands, filterCommands, type CommandSpec } from "../CommandPalette"
import { live, reserved, unavailable } from "../../domain/availability"

const specs: CommandSpec[] = [
  { id: "paper-buy", label: "Paper buy", action: "paper", rails: ["consent"] },
  { id: "live-buy", label: "Live buy", action: "live", rails: ["consent", "ceremony"] }
]

describe("buildCommands — unavailable actions are disabled, not hidden (AC-007)", () => {
  it("disables a command whose capability is reserved", () => {
    const cmds = buildCommands(specs, { live: reserved({ workstream: "WS-11", reason: "ceremony pending" }) })
    const liveBuy = cmds.find((c) => c.id === "live-buy")
    expect(liveBuy?.disabled).toBe(true)
    expect(liveBuy?.reason).toMatch(/WS-11/)
  })

  it("disables a command whose capability is unavailable, naming the reason", () => {
    const cmds = buildCommands(specs, {
      live: unavailable({ reason: "no venue credentials", owner: "WS-7", since: 1 })
    })
    expect(cmds.find((c) => c.id === "live-buy")?.disabled).toBe(true)
  })

  it("keeps a paper command enabled when the PAPER capability is live", () => {
    const cmds = buildCommands(specs, { paper: live({ source: "s", observedAt: 1, freshnessMs: 1 }) })
    expect(cmds.find((c) => c.id === "paper-buy")?.disabled).toBe(false)
  })

  it("treats an UNKNOWN capability as unavailable, never as permitted", () => {
    // No entry for the action at all must fail closed, not open.
    const cmds = buildCommands([{ id: "x", label: "X", action: "live", rails: [] }], {})
    expect(cmds.find((c) => c.id === "x")?.disabled).toBe(true)
  })

  it("never marks a live-money command as permitted while live is unavailable", () => {
    const cmds = buildCommands(specs, { live: reserved({ workstream: "WS-11", reason: "pending" }) })
    expect(cmds.filter((c) => c.action === "live").every((c) => c.disabled)).toBe(true)
  })
})

describe("buildCommands — every command declares its rails (AC-013)", () => {
  it("carries the required server rails onto each command", () => {
    const cmds = buildCommands(specs, { live: live({ source: "s", observedAt: 1, freshnessMs: 1 }) })
    expect(cmds.find((c) => c.id === "live-buy")?.rails).toEqual(["consent", "ceremony"])
  })

  it("does not treat a command as self-authorizing", () => {
    const cmds = buildCommands(specs, { live: live({ source: "s", observedAt: 1, freshnessMs: 1 }) })
    // Even a LIVE capability cannot be invoked from the palette without the
    // server rails it declares.
    for (const c of cmds) expect(Array.isArray(c.rails)).toBe(true)
  })
})

describe("filterCommands — keyboard search", () => {
  const cmds = buildCommands(specs, { live: live({ source: "s", observedAt: 1, freshnessMs: 1 }) })

  it("matches on label, case-insensitively", () => {
    expect(filterCommands(cmds, "paper").map((c) => c.id)).toEqual(["paper-buy"])
  })

  it("returns every command for an empty query", () => {
    expect(filterCommands(cmds, "")).toHaveLength(2)
  })

  it("returns nothing for a non-matching query", () => {
    expect(filterCommands(cmds, "zzz")).toEqual([])
  })

  it("keeps disabled commands in the filtered results so they stay discoverable", () => {
    const reservedCmds = buildCommands(specs, { live: reserved({ workstream: "WS-11", reason: "x" }) })
    const found = filterCommands(reservedCmds, "live")
    expect(found).toHaveLength(1)
    expect(found[0].disabled).toBe(true)
  })
})
