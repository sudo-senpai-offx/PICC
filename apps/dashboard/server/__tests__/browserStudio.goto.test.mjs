import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Regression: "Cannot read properties of null (reading 'goto')" surfaced in
// the in-app browser whenever the studio was open but no tab was registered.
// The fake bridge below reports ZERO pages (context.pages() -> []) exactly like
// the real browser can during the open->sync window, so syncTabs finds nothing
// and the old code called page.goto() on a null page. The studio must
// self-heal by creating a page instead.
const h = vi.hoisted(() => {
  const createPage = () => {
    let url = "about:blank"
    return {
      isClosed: () => false,
      url: () => url,
      title: async () => "Fake page",
      on: () => {},
      close: async () => {},
      goto: vi.fn(async (u) => {
        url = String(u)
      }),
      goBack: vi.fn(async () => {}),
      goForward: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
      evaluate: async () => null,
      addInitScript: async () => {},
      exposeFunction: async () => Promise.resolve(),
      viewportSize: () => ({ width: 1440, height: 900 })
    }
  }
  const createContext = () => {
    const pages = []
    const handlers = []
    return {
      pages: () => pages,
      newPage: async () => {
        const p = createPage()
        pages.push(p)
        return p
      },
      newCDPSession: async () => ({
        send: async () => {},
        on: () => {},
        detach: async () => {}
      }),
      clearCookies: async () => {},
      close: async () => {},
      on: (name, cb) => {
        handlers.push([name, cb])
        return () => {}
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
        page: null, // no registered page yet — reproduces the empty-tabs race
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
  tmp = mkdtempSync(join(tmpdir(), "picc-browser-goto-"))
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

describe("browser studio goto — null-page self-heal", () => {
  it("openStudio creates a page even when the bridge reports zero pages", async () => {
    const status = await m.openStudio({ headless: true, homepage: "" })
    expect(status.open).toBe(true)
    expect(status.tabs.length).toBeGreaterThan(0)
    expect(status.currentUrl).toBe("about:blank")
  })

  it("studioGoto navigates instead of crashing when no tab was registered", async () => {
    const res = await m.studioGoto("https://example.com")
    expect(res.ok).toBe(true)
    expect(res.url).toBe("https://example.com")
    const active = m.studioStatus().tabs.find((t) => t.id === m.studioStatus().activeTabId)
    expect(active).toBeTruthy()
    expect(active.url).toBe("https://example.com")
  })

  it("studioNav back/reload work on the self-healed page", async () => {
    const back = await m.studioNav("back")
    expect(back.ok).toBe(true)
    const reload = await m.studioNav("reload")
    expect(reload.ok).toBe(true)
  })

  it("goto is rejected cleanly while the studio is closed", async () => {
    await m.closeStudio()
    await expect(m.studioGoto("https://example.com")).rejects.toThrow(/not open/)
  })

  it("studioIsOpen self-heals when the browser context died", async () => {
    await m.openStudio({ headless: true, homepage: "" })
    const { context } = h.bridges.at(-1)
    context.pages = () => {
      throw new Error("Target page, context or browser has been closed")
    }
    expect(m.studioIsOpen()).toBe(false)
    expect(m.studioStatus().open).toBe(false)
    expect(m.studioStatus().tabs.length).toBe(0)
  })

  it("commands after the browser died fail as BROWSER_CLOSED, not 400-style", async () => {
    await m.openStudio({ headless: true, homepage: "" })
    const { context } = h.bridges.at(-1)
    context.pages = () => {
      throw new Error("Target page, context or browser has been closed")
    }
    await expect(m.studioGoto("https://example.com")).rejects.toMatchObject({ code: "BROWSER_CLOSED" })
    await expect(m.studioGoogleSession({ navigate: true })).rejects.toMatchObject({ code: "BROWSER_CLOSED" })
  })

  it("the context close event resets the open state immediately", async () => {
    await m.openStudio({ headless: true, homepage: "" })
    const { context } = h.bridges.at(-1)
    const closeCb = context._handlers.find(([n]) => n === "close")?.[1]
    expect(closeCb).toBeTypeOf("function")
    closeCb()
    expect(m.studioStatus().open).toBe(false)
    expect(m.studioStatus().tabs.length).toBe(0)
  })

  it("studioGoogleSession tolerates a synchronous page.url()", async () => {
    await m.openStudio({ headless: true, homepage: "" })
    const page = h.bridges.at(-1).context.pages()[0]
    await page.goto("https://accounts.google.com")
    // Regression: `page.url().catch(...)` threw "page.url(...).catch is not a
    // function" because Playwright's url() is synchronous — it must resolve.
    const res = await m.studioGoogleSession({ navigate: false })
    expect(res.ok).toBe(true)
    expect(res.onGooglePage).toBe(true)
  })
})
