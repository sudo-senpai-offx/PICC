import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Bidirectional tab sync (owner directive 2026-09-16): the studio opens a REAL
// visible trackable browser window by default, and tabs sync BOTH ways:
//   PICC -> window : studioTab new/close/switch drives the real context; switch
//                    brings the target page to front in the window.
//   window -> PICC : a tab the user closes in the real window is pruned from
//                    studio.tabs; a tab the user clicks becomes active via the
//                    injected visibility/focus callback (__piccTabVisible).
// The fake bridge below records page event handlers and exposeFunction
// callbacks so a test can fire them exactly like a user acting in the window.
const h = vi.hoisted(() => {
  const createPage = (seed) => {
    let url = "about:blank"
    let bringToFrontCalls = 0
    const events = []
    const exposed = {}
    return {
      seed,
      _events: events,
      _exposed: exposed,
      _bringToFrontCalls: () => bringToFrontCalls,
      isClosed: () => false,
      url: () => url,
      title: async () => `Fake ${seed}`,
      on: (name, cb) => {
        events.push([name, cb])
        return () => {}
      },
      emit: (name, ...args) => {
        for (const [n, cb] of events) if (n === name) cb(...args)
      },
      exposeFunction: async (name, cb) => {
        exposed[name] = cb
      },
      bringToFront: async () => {
        bringToFrontCalls += 1
      },
      goto: async (u) => {
        url = String(u)
      },
      close: async () => {},
      evaluate: async () => null,
      addInitScript: async () => {},
      viewportSize: () => ({ width: 1440, height: 900 })
    }
  }
  const createContext = () => {
    const pages = []
    const handlers = []
    let closed = false
    return {
      pages: () => pages,
      newPage: async () => {
        const p = createPage(pages.length + 1)
        pages.push(p)
        return p
      },
      newCDPSession: async () => ({
        send: async () => {},
        on: () => {},
        detach: async () => {}
      }),
      clearCookies: async () => {},
      close: async () => {
        closed = true
      },
      isClosed: () => closed,
      on: (name, cb) => {
        handlers.push([name, cb])
        return () => {}
      },
      emit: (name, ...args) => {
        for (const [n, cb] of handlers) if (n === name) cb(...args)
      },
      _handlers: handlers
    }
  }
  return {
    bridges: [],
    createPage,
    createContext,
    makeBridge: () => {
      const context = createContext()
      const bridge = {
        context,
        page: null,
        frames: [],
        close: async () => {},
        onFrame: () => () => {},
        goto: async () => {},
        read: async () => ({}),
        evaluate: async () => null,
        addOverlay: async () => {},
        setOverlay: async () => {}
      }
      h.bridges.push({ bridge, context })
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
  tmp = mkdtempSync(join(tmpdir(), "picc-browser-tabsync-"))
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

describe("browser studio — window-first + bidirectional tab sync", () => {
  it("openStudio with NO headless flag opens a REAL window (headless:false)", async () => {
    await m.openStudio({ homepage: "" })
    expect(m.studioStatus().headless).toBe(false)
  })

  it("a NON-active tab closed in the real window is pruned; the active tab stays", async () => {
    await m.closeStudio()
    await m.openStudio({ headless: true, homepage: "" })
    await m.studioTab({ action: "new" })
    await m.studioTab({ action: "new" })
    const status = m.studioStatus()
    expect(status.tabs.length).toBe(3)
    const activeId = status.activeTabId // last-created tab is active
    const victim = status.tabs.find((t) => t.id !== activeId)

    const ctx = h.bridges.at(-1).context
    const page = ctx.pages().find((p) => p.seed === victim.id)
    expect(page).toBeTruthy()
    page.emit("close")

    const after = m.studioStatus()
    expect(after.tabs.map((t) => t.id)).not.toContain(victim.id)
    expect(after.tabs.length).toBe(2)
    expect(after.activeTabId).toBe(activeId)
  })

  it("closing the ACTIVE tab in the real window moves activation to a neighbor", async () => {
    await m.closeStudio()
    await m.openStudio({ headless: true, homepage: "" })
    await m.studioTab({ action: "new" })
    const active = m.studioStatus().activeTabId
    const ctx = h.bridges.at(-1).context
    const page = ctx.pages().find((p) => p.seed === active)
    page.emit("close")
    const after = m.studioStatus()
    expect(after.tabs.length).toBe(1)
    expect(after.activeTabId).toBeTruthy()
    expect(after.activeTabId).not.toBe(active)
  })

  it("a tab the user switches to in the real window becomes active (visibility callback)", async () => {
    await m.closeStudio()
    await m.openStudio({ headless: true, homepage: "" })
    await m.studioTab({ action: "new" })
    await m.studioTab({ action: "new" })
    // studioTab new auto-activates the newest tab; switch to the FIRST tab so
    // the visibility callback lets the user's real-window click win.
    await m.studioTab({ action: "switch", id: 1 })
    let status = m.studioStatus()
    const target = status.tabs[2]
    expect(status.activeTabId).not.toBe(target.id)

    const ctx = h.bridges.at(-1).context
    const page = ctx.pages().find((p) => p.seed === target.id)
    expect(typeof page._exposed.__piccTabVisible).toBe("function")
    await page._exposed.__piccTabVisible(target.id)

    const after = m.studioStatus()
    expect(after.activeTabId).toBe(target.id)
  })

  it("studioTab switch brings the target page to front in the real window", async () => {
    await m.closeStudio()
    await m.openStudio({ headless: true, homepage: "" })
    await m.studioTab({ action: "new" })
    await m.studioTab({ action: "new" })
    const status = m.studioStatus()
    const target = status.tabs[2]
    const ctx = h.bridges.at(-1).context
    const page = ctx.pages().find((p) => p.seed === target.id)
    const before = page._bringToFrontCalls()

    await m.studioTab({ action: "switch", id: target.id })
    expect(m.studioStatus().activeTabId).toBe(target.id)
    expect(page._bringToFrontCalls()).toBe(before + 1)
  })

  it("studioTab open finds an existing tab for the same URL instead of stacking a duplicate", async () => {
    await m.closeStudio()
    await m.openStudio({ headless: true, homepage: "" })
    await m.studioTab({ action: "open", url: "https://app.expertoption.finance/" })
    const ctx = h.bridges.at(-1).context
    const created = m.studioStatus().tabs.at(-1)
    // Simulate a real window navigation: framenavigated refreshes tab.url, so
    // the next open matches the venue tab.
    ctx.pages().find((p) => p.seed === created.id).emit("framenavigated")

    // Same URL (trailing-slash insensitive) focuses the existing tab.
    await m.studioTab({ action: "open", url: "https://app.expertoption.finance" })
    let status = m.studioStatus()
    expect(status.tabs.length).toBe(2)
    expect(status.activeTabId).toBe(created.id)
    const toFront = ctx.pages().find((p) => p.seed === created.id)._bringToFrontCalls()
    expect(toFront).toBeGreaterThan(0)

    // A different URL opens a second venue tab.
    await m.studioTab({ action: "open", url: "https://www.binance.com/en/trade/BTCUSDT" })
    status = m.studioStatus()
    expect(status.tabs.length).toBe(3)
    expect(status.activeTabId).toBe(status.tabs.at(-1).id)
  })
})