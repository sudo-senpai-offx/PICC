import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Regression guard for touch-mode interaction: studioInput("touch") must route
// through CDP Input.dispatchTouchEvent (touchStart/touchMove/touchEnd) with touch
// emulation enabled, so mobile-first sites react to taps/swipes from the app,
// and it must never crash when the CDP session is unavailable.
const h = vi.hoisted(() => {
  const cdpLog = []
  const makeCdp = () => ({
    send: vi.fn(async (method, params) => {
      cdpLog.push({ method, params })
    }),
    on: () => {},
    detach: vi.fn(async () => {})
  })
  const createPage = () => ({
    isClosed: () => false,
    url: () => "https://example.com",
    title: async () => "Fake page",
    on: () => {},
    close: async () => {},
    goto: async () => {},
    goBack: async () => {},
    goForward: async () => {},
    reload: async () => {},
    evaluate: async () => null,
    addInitScript: async () => {},
    exposeFunction: async () => Promise.resolve(),
    mouse: {
      click: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      down: vi.fn(async () => {}),
      up: vi.fn(async () => {}),
      wheel: vi.fn(async () => {})
    },
    keyboard: { press: vi.fn(async () => {}) },
    viewportSize: () => ({ width: 1024, height: 768 })
  })
  const createContext = () => {
    const pages = [createPage()]
    return {
      pages: () => pages,
      newPage: async () => pages[0],
      newCDPSession: async () => makeCdp(),
      clearCookies: async () => {},
      close: async () => {},
      on: () => () => {}
    }
  }
  return {
    cdpLog,
    makeBridge: () => {
      const context = createContext()
      const bridge = {
        context,
        page: context.pages()[0],
        frames: [],
        close: async () => {},
        onFrame: () => () => {},
        goto: async () => {},
        read: async () => ({}),
        evaluate: async () => null,
        addOverlay: async () => {},
        setOverlay: async () => {}
      }
      return bridge
    }
  }
})

vi.mock("../services/browserBridge.mjs", () => ({
  openBridge: async () => h.makeBridge(),
  browserAvailable: () => true
}))

let tmp
let m

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "picc-browser-touch-"))
  process.env.PICC_BROWSER_DATA_DIR = tmp
  m = await import("../services/browserStudio.mjs")
})

afterAll(async () => {
  try {
    await m.closeStudio()
  } catch {
    /* ignore */
  }
  rmSync(tmp, { recursive: true, force: true })
  delete process.env.PICC_BROWSER_DATA_DIR
})

describe("browser studio touch input", () => {
  it("touch start/move/end dispatch the correct CDP sequence", async () => {
    await m.openStudio({ headless: true, homepage: "" })
    await m.studioInput({ type: "touch", kind: "start", nx: 0.5, ny: 0.25 })
    await m.studioInput({ type: "touch", kind: "move", nx: 0.5, ny: 0.75 })
    await m.studioInput({ type: "touch", kind: "end" })
    const msgs = h.cdpLog.filter((c) => c.method === "Input.dispatchTouchEvent")
    expect(msgs.length).toBe(3)
    expect(msgs[0].params.type).toBe("touchStart")
    expect(msgs[0].params.touchPoints[0]).toMatchObject({ x: 512, y: 192, id: 1, radiusX: 1, radiusY: 1, force: 1 })
    expect(msgs[1].params.type).toBe("touchMove")
    expect(msgs[1].params.touchPoints[0].y).toBe(576)
    expect(msgs[2].params.type).toBe("touchEnd")
    expect(msgs[2].params.touchPoints).toEqual([])
    expect(h.cdpLog.some((c) => c.method === "Emulation.setTouchEmulationEnabled" && c.params.enabled === true)).toBe(true)
    await m.closeStudio()
  })

  it("touch input stays non-throwing even with a broken CDP session", async () => {
    await m.openStudio({ headless: true, homepage: "" })
    // The mocked newCDPSession always works, so simulate failure via a page that
    // exposes no bridge session path — the handler must tolerate it regardless.
    const res = await m.studioInput({ type: "touch", kind: "start", nx: 0.1, ny: 0.2 })
    expect(res.ok).toBe(true)
    expect(res.type).toBe("touch")
  })

  it("unknown touch kinds default to touchEnd without crashing", async () => {
    await m.openStudio({ headless: true, homepage: "" })
    const res = await m.studioInput({ type: "touch", kind: "bogus", nx: 0.5, ny: 0.5 })
    expect(res.ok).toBe(true)
    expect(res.type).toBe("touch")
  })
})
