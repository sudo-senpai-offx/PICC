// T12/M8 — the `type:"u4fa"` SSE event must route through the client stream
// parser as a u4fa event, NEVER into the generic `ready` fall-through (which
// would silently drop the payload and re-flip stream state on every tick).

import { afterEach, describe, expect, it, vi } from "vitest"
import { streamLiveTrading } from "../liveTrading"
import type { LiveU4faSignal } from "../liveTrading"

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

let controller: ReadableStreamDefaultController<Uint8Array> | null = null

function stubSseFetch() {
  controller = null
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      }
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } }))
  ))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function pump(event: string, payload: unknown) {
  controller?.enqueue(new TextEncoder().encode(frame(event, payload)))
  await new Promise((r) => setTimeout(r, 10)) // let the reader drain
}

describe("u4fa event over the realtime stream", () => {
  it("delivers a type:\"u4fa\" payload on the u4fa name (not the ready fall-through)", async () => {
    stubSseFetch()
    const seen: Array<{ type?: string } & Record<string, unknown>> = []
    const handle = streamLiveTrading(
      (e) => seen.push(e as { type?: string } & Record<string, unknown>),
      () => {},
      () => {}
    )
    const payload: Record<string, unknown> = {
      ts: 1780000000000,
      assetId: "EURUSD",
      style: "2",
      direction: "up",
      verdict: "TRADE",
      expiry: 900,
      risk: { riskPct: 0.5, dailyLossLimitPct: 5, maxDailyTrades: 10 },
      compliance: { requiresHumanApproval: true, proposalId: null },
      honesty: { spreadSource: null, structureSource: "fixture", calendarSource: "fixture", candleSource: "fixture" }
    }
    await pump("u4fa", payload)
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe("u4fa")
    expect(seen[0].assetId).toBe("EURUSD")
    expect((seen[0] as unknown as LiveU4faSignal).verdict).toBe("TRADE")
    expect(seen.some((e) => e.type === "ready")).toBe(false)
    handle.close()
  })

  it("keeps routing decisions and ticks while u4fa rides the same socket", async () => {
    stubSseFetch()
    const seen: Array<{ type?: string } & Record<string, unknown>> = []
    const handle = streamLiveTrading(
      (e) => seen.push(e as { type?: string } & Record<string, unknown>),
      () => {},
      () => {}
    )
    await pump("u4fa", { ts: 1, assetId: "EURUSD", verdict: "OBSERVE", compliance: { requiresHumanApproval: true, proposalId: null } })
    await pump("decision", { ts: 2, status: "connected", decisions: [] })
    await pump("tick", { assetId: "BTCUSD", price: 64000, ts: 3 })
    // u4fa + decision events carry their type; tick rides the T8 bus as a bare
    // payload (assetId/price fields, no type key — existing transport contract).
    expect(seen.map((e) => e.type)).toEqual(["u4fa", "decision", undefined])
    expect(seen[2]).toEqual(expect.objectContaining({ assetId: "BTCUSD", price: 64000 }))
    handle.close()
  })
})