import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("dispatch realtime section", () => {
  let dir, section, dispatch
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-dispatch-rt-"))
    process.env.PICC_DISPATCH_DATA_DIR = dir
    vi.resetModules()
    section = await import("../services/dispatchSection.mjs")
    dispatch = await import("../services/dispatch.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DISPATCH_DATA_DIR
    dispatch._resetDispatchForTest()
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("reports empty honestly", () => {
    expect(section.dispatchSection()).toEqual({ unread: 0, entries: [] })
  })

  it("reports unread + recent entries", () => {
    dispatch.pushDispatch({ title: "fast", kind: "decision" })
    const s = section.dispatchSection()
    expect(s.unread).toBe(1)
    expect(s.entries.map((e) => e.title)).toEqual(["fast"])
  })

  it("caps the section at 10 entries", () => {
    for (let i = 0; i < 14; i++) dispatch.pushDispatch({ title: `t${i}`, kind: "system" })
    expect(section.dispatchSection().entries.length).toBe(10)
  })

  it("exposes a live subscribe passthrough on the section module", async () => {
    const seen = []
    const off = section.onDispatchLive((e) => seen.push(e.title))
    dispatch.pushDispatch({ title: "live fire", kind: "venue" })
    expect(seen).toEqual(["live fire"])
    off()
  })
})