import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("dispatch inbox", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-dispatch-"))
    process.env.PICC_DISPATCH_DATA_DIR = dir
    vi.resetModules()
    mod = await import("../services/dispatch.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DISPATCH_DATA_DIR
    mod._resetDispatchForTest()
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("defaults an entry (unknown kind/severity coerce to info)", () => {
    const e = mod.pushDispatch({ title: "hello", kind: "nope", severity: "loud" })
    expect(e.kind).toBe("info")
    expect(e.severity).toBe("info")
    expect(e.title).toBe("hello")
    expect(e.read).toBe(false)
    expect(typeof e.id).toBe("string")
  })

  it("lists newest-first and counts unread", () => {
    mod.pushDispatch({ title: "a", kind: "decision" })
    mod.pushDispatch({ title: "b", kind: "venue" })
    const all = mod.listDispatch()
    expect(all.map((e) => e.title)).toEqual(["b", "a"])
    expect(mod.unreadDispatchCount()).toBe(2)
  })

  it("marks one entry read without touching the rest", () => {
    const a = mod.pushDispatch({ title: "a", kind: "decision" })
    const b = mod.pushDispatch({ title: "b", kind: "decision" })
    expect(mod.markDispatchRead(a.id)).toBe(true)
    expect(mod.markDispatchRead("missing")).toBe(false)
    expect(mod.unreadDispatchCount()).toBe(1)
    expect(mod.listDispatch().find((e) => e.id === b.id).read).toBe(false)
  })

  it("filters by unreadOnly and truncates to limit", () => {
    for (let i = 0; i < 6; i++) mod.pushDispatch({ title: `t${i}`, kind: "system" })
    expect(mod.listDispatch({ limit: 3 }).length).toBe(3)
    mod.markDispatchRead(mod.listDispatch()[0].id)
    expect(mod.listDispatch({ unreadOnly: true }).length).toBe(5)
  })

  it("notifies subscribers on push", () => {
    const seen = []
    const off = mod.onDispatch((e) => seen.push(e.title))
    mod.pushDispatch({ title: "ping", kind: "milestone" })
    off()
    mod.pushDispatch({ title: "after-unsub", kind: "milestone" })
    expect(seen).toEqual(["ping"])
  })

  it("caps the inbox at 500", () => {
    for (let i = 0; i < 510; i++) mod.pushDispatch({ title: `t${i}`, kind: "system" })
    expect(mod.listDispatch({ limit: 500 }).length).toBe(500)
  })

  it("persists and reloads from disk", async () => {
    mod.pushDispatch({ title: "durable", kind: "venue" })
    mod._resetDispatchForTest()
    vi.resetModules()
    const reloaded = await import("../services/dispatch.mjs")
    expect(reloaded.listDispatch().map((e) => e.title)).toContain("durable")
  })
})