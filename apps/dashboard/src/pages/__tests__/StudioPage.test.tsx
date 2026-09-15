// @vitest-environment jsdom
// Embedded browser studio page (spec PICC_EMBEDDED_BROWSER_STUDIO_v1.md, Phase A):
//  - auto-opens the shared Chromium on mount when closed
//  - renders live screencast frames from the SSE stream
//  - tab bar: switch + close; address bar: goto; nav controls: back/forward/reload
//  - cleans up the SSE stream on unmount
import { describe, expect, it, vi, beforeEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { StudioPage } from "@/pages/StudioPage"
import type { StudioStreamEvent } from "@/lib/api"

const openBrowser = vi.fn().mockResolvedValue({ ok: true, open: true, headless: false, tabs: [], activeTabId: null, viewport: { width: 1440, height: 900 }, subscriberCount: 1 })
const closeBrowser = vi.fn().mockResolvedValue({ ok: true, open: false, headless: false, tabs: [], activeTabId: null, viewport: { width: 1440, height: 900 }, subscriberCount: 0 })
const browserGoto = vi.fn().mockResolvedValue({ ok: true, url: "", title: "" })
const browserNav = vi.fn().mockResolvedValue({ ok: true, url: "", title: "" })
const browserTab = vi.fn().mockResolvedValue({ ok: true, open: true, headless: false, tabs: [], activeTabId: null, viewport: { width: 1440, height: 900 }, subscriberCount: 1 })
const streamClose = vi.fn()
const getBrowserStatus = vi.fn()

vi.mock("@/lib/api", () => ({
  getBrowserStatus: (...a: unknown[]) => getBrowserStatus(...a),
  openBrowser: (...a: unknown[]) => openBrowser(...a),
  closeBrowser: (...a: unknown[]) => closeBrowser(...a),
  browserGoto: (...a: unknown[]) => browserGoto(...a),
  browserNav: (...a: unknown[]) => browserNav(...a),
  browserTab: (...a: unknown[]) => browserTab(...a),
  streamBrowser: (onEvent: (e: StudioStreamEvent) => void) => {
    onEventRef = onEvent
    return { close: streamClose }
  }
}))

let onEventRef: ((e: StudioStreamEvent) => void) | null = null

function pushEvent(e: StudioStreamEvent) {
  flushSync(() => { onEventRef?.(e) })
}

const OPEN_STATUS = {
  ok: true,
  available: true,
  open: true,
  headless: false,
  startedAt: "2026-09-15T00:00:00.000Z",
  tabs: [{ id: 1, url: "https://app.expertoption.com", title: "ExpertOption", active: true, auth: null }],
  activeTabId: 1,
  currentUrl: "https://app.expertoption.com",
  currentTitle: "ExpertOption",
  viewport: { width: 1440, height: 900 },
  latestFrameAt: null,
  subscriberCount: 1
}

function mountStudio() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(<StudioPage />)
  })
  return {
    host,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

/** Let the async getBrowserStatus().then() settle before asserting. */
async function settle() {
  await new Promise((r) => setTimeout(r, 0))
  flushSync(() => {})
}

describe("StudioPage (embedded browser studio, Phase A)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onEventRef = null
    getBrowserStatus.mockResolvedValue({ ...OPEN_STATUS })
  })

  it("auto-opens the shared browser on mount when it is closed", async () => {
    getBrowserStatus.mockResolvedValue({ ...OPEN_STATUS, open: false })
    const m = mountStudio()
    try {
      await settle()
      expect(getBrowserStatus).toHaveBeenCalledTimes(1)
      expect(openBrowser).toHaveBeenCalledTimes(1)
      expect(openBrowser).toHaveBeenCalledWith()
    } finally {
      m.unmount()
    }
  })

  it("does not open the browser again when it is already open", async () => {
    const m = mountStudio()
    try {
      await settle()
      expect(openBrowser).not.toHaveBeenCalled()
    } finally {
      m.unmount()
    }
  })

  it("subscribes to the SSE stream and closes it on unmount", () => {
    const m = mountStudio()
    m.unmount()
    expect(onEventRef).toBeTruthy()
    expect(streamClose).toHaveBeenCalledTimes(1)
  })

  it("renders a live screencast frame from the stream into the viewport", async () => {
    const m = mountStudio()
    try {
      await settle()
      pushEvent({ type: "frame", data: "aGVsbG8=", ts: 1, vp: { width: 1440, height: 900 } })
      const img = m.host.querySelector<HTMLImageElement>("img[data-testid='studio-frame']")
      expect(img).toBeTruthy()
      expect(img?.src).toContain("data:image/jpeg;base64,aGVsbG8=")
      expect(img?.style.width).toBe("1440px")
    } finally {
      m.unmount()
    }
  })

  it("renders the tab bar from tabs events and switches tabs on click", () => {
    const m = mountStudio()
    try {
      pushEvent({
        type: "tabs",
        tabs: [
          { id: 1, url: "https://a.com", title: "A", active: false, auth: null },
          { id: 2, url: "https://b.com", title: "B", active: true, auth: null }
        ],
        activeTabId: 2
      })
      const tabs = m.host.querySelectorAll("[data-testid='studio-tab']")
      expect(tabs.length).toBe(2)
      const tabB = m.host.querySelector("[data-testid='studio-tab'][data-tab-id='2']")
      expect(tabB?.className).toContain("active")
      const tabA = m.host.querySelector<HTMLElement>("[data-testid='studio-tab'][data-tab-id='1']")
      tabA?.click()
      expect(browserTab).toHaveBeenCalledWith({ action: "switch", id: 1 })
    } finally {
      m.unmount()
    }
  })

  it("closes a tab from the tab bar close button", () => {
    const m = mountStudio()
    try {
      pushEvent({
        type: "tabs",
        tabs: [{ id: 7, url: "https://c.com", title: "C", active: true, auth: null }],
        activeTabId: 7
      })
      const closeBtn = m.host.querySelector<HTMLElement>("[data-testid='studio-tab-close']")
      closeBtn?.click()
      expect(browserTab).toHaveBeenCalledWith({ action: "close", id: 7 })
    } finally {
      m.unmount()
    }
  })

  it("navigates from the address bar", () => {
    const m = mountStudio()
    try {
      const input = m.host.querySelector<HTMLInputElement>("input[data-testid='studio-address']")
      if (!input) throw new Error("address input not found")
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "https://example.com")
      input.dispatchEvent(new Event("input", { bubbles: true }))
      flushSync(() => {})
      const go = m.host.querySelector<HTMLElement>("button[data-testid='studio-goto']")
      go?.click()
      expect(browserGoto).toHaveBeenCalledWith("https://example.com")
    } finally {
      m.unmount()
    }
  })

  it("uses the nav controls for back / forward / reload", () => {
    const m = mountStudio()
    try {
      m.host.querySelector<HTMLElement>("button[data-testid='studio-back']")?.click()
      m.host.querySelector<HTMLElement>("button[data-testid='studio-forward']")?.click()
      m.host.querySelector<HTMLElement>("button[data-testid='studio-reload']")?.click()
      expect(browserNav).toHaveBeenNthCalledWith(1, "back")
      expect(browserNav).toHaveBeenNthCalledWith(2, "forward")
      expect(browserNav).toHaveBeenNthCalledWith(3, "reload")
    } finally {
      m.unmount()
    }
  })

  it("shows the detected site and vault status from assist events", () => {
    const m = mountStudio()
    try {
      pushEvent({
        type: "assist",
        assist: { site: { id: "expertoption", name: "ExpertOption", category: "trading", payoutThreshold: 10, url: "app.expertoption.com", note: "", host: "app.expertoption.com" }, suite: { id: "trading", label: "Trading", icon: "📈" }, hasSavedCredentials: true, tabId: 1 }
      })
      const site = m.host.querySelector("[data-testid='studio-site']")
      expect(site?.textContent).toContain("ExpertOption")
      const vault = m.host.querySelector("[data-testid='studio-vault']")
      expect(vault?.textContent).toContain("saved")
    } finally {
      m.unmount()
    }
  })

  it("offers open/close of the browser", async () => {
    const m = mountStudio()
    try {
      await settle()
      m.host.querySelector<HTMLElement>("button[data-testid='studio-close-browser']")?.click()
      expect(closeBrowser).toHaveBeenCalledTimes(1)
    } finally {
      m.unmount()
    }
  })
})