import { describe, expect, it, vi, afterEach } from "vitest"
import { fetchDispatch, markDispatchRead } from "../dispatch"

afterEach(() => vi.restoreAllMocks())

describe("dispatch lib", () => {
  it("fetchDispatch GETs /api/trading/dispatch and parses the inbox", async () => {
    const stub = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ok: true, unread: 1, entries: [{ id: "x", kind: "decision", severity: "info", title: "t", body: "", ref: null, ts: 1, read: false }] })
    })
    vi.stubGlobal("fetch", stub)
    const inbox = await fetchDispatch(25, true)
    expect(stub.mock.calls[0][0]).toContain("/api/trading/dispatch?limit=25&unreadOnly=true")
    expect(inbox.unread).toBe(1)
    expect(inbox.entries[0].title).toBe("t")
  })

  it("markDispatchRead POSTs and returns ok", async () => {
    const stub = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, id: "x", read: true }) })
    vi.stubGlobal("fetch", stub)
    const out = await markDispatchRead("x")
    expect(out.ok).toBe(true)
    const [, init] = stub.mock.calls[0]
    expect(init.method).toBe("POST")
  })

  it("markDispatchRead throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ ok: false }) }))
    await expect(markDispatchRead("nope")).rejects.toThrow()
  })
})