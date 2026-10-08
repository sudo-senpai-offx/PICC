// @vitest-environment jsdom
// Wave 1.4 — NotificationPrefsSection: channel toggles + numeric thresholds,
// with a permission-aware webpush toggle. Style lock matches Settings.test:
// numeric inputs carry .input, checkboxes stay native, action button .btn.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { saveNotificationPrefs } from "@/lib/api"
import { NotificationPrefsSection } from "@/components/NotificationPrefsSection"

vi.mock("@/lib/api", () => ({
  getNotificationPrefs: vi.fn(async () => ({
    ok: true,
    prefs: { minConfidence: 65, leadMinutes: 3, windowMinutes: 15, channels: { inApp: true, webpush: true, telegram: false, webhook: true } }
  })),
  saveNotificationPrefs: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    prefs: {
      minConfidence: 65, leadMinutes: 3, windowMinutes: 15,
      channels: { inApp: true, webpush: true, telegram: false, webhook: true }, ...input
    }
  }))
}))

const mockedSave = saveNotificationPrefs as unknown as ReturnType<typeof vi.fn>

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => {
    root.render(<NotificationPrefsSection />)
  })
  return {
    host,
    root,
    unmount() {
      flushSync(() => { root.unmount() })
      document.body.removeChild(host)
    }
  }
}

async function settled() {
  await new Promise((r) => setTimeout(r, 0))
  flushSync(() => {})
}

const hadNotification = "Notification" in globalThis
const savedNotification = (globalThis as Record<string, unknown>).Notification

function stubNotification(permission: string, requestPermission?: () => Promise<string>) {
  Object.defineProperty(globalThis, "Notification", {
    value: { permission, requestPermission: requestPermission ?? (async () => permission) },
    configurable: true,
    writable: true
  })
}

function unstubNotification() {
  if (hadNotification) {
    Object.defineProperty(globalThis, "Notification", { value: savedNotification, configurable: true, writable: true })
  } else {
    delete (globalThis as Record<string, unknown>).Notification
  }
}

function checkboxFor(host: HTMLElement, name: string): HTMLInputElement | null {
  const labels = Array.from(host.querySelectorAll("label"))
  const label = labels.find((l) => l.textContent?.toLowerCase().includes(name.toLowerCase()))
  return (label?.querySelector('input[type="checkbox"]') as HTMLInputElement) ?? null
}

describe("NotificationPrefsSection permission states", () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { unstubNotification() })

  it("granted: all four channel toggles render, webpush enabled and checked per server prefs", async () => {
    stubNotification("granted")
    const m = mount()
    await settled()
    for (const name of ["in-app", "web push", "telegram", "webhook"]) {
      expect(checkboxFor(m.host, name), `missing toggle: ${name}`).toBeTruthy()
    }
    const webpush = checkboxFor(m.host, "web push")!
    expect(webpush.disabled).toBe(false)
    expect(webpush.checked).toBe(true)
    const telegram = checkboxFor(m.host, "telegram")!
    expect(telegram.checked).toBe(false)
    m.unmount()
  })

  it("denied: webpush toggle explains, renders OFF and disabled — it does not pretend", async () => {
    stubNotification("denied")
    const m = mount()
    await settled()
    const webpush = checkboxFor(m.host, "web push")!
    // Server says webpush:true; the browser refused. The toggle must not show on.
    expect(webpush.checked).toBe(false)
    expect(webpush.disabled).toBe(true)
    expect(m.host.textContent).toMatch(/blocked/i)
    m.unmount()
  })

  it("default: toggling webpush requests permission first and enables only on granted", async () => {
    stubNotification("default", async () => "granted")
    const m = mount()
    await settled()
    const webpush = checkboxFor(m.host, "web push")!
    expect(webpush.disabled).toBe(false)
    expect(webpush.checked).toBe(false)
    webpush.click()
    await settled()
    expect(checkboxFor(m.host, "web push")!.checked).toBe(true)
    m.unmount()
  })

  it("default + permission refused: the toggle stays off with an honest note", async () => {
    stubNotification("default", async () => "denied")
    const m = mount()
    await settled()
    checkboxFor(m.host, "web push")!.click()
    await settled()
    expect(checkboxFor(m.host, "web push")!.checked).toBe(false)
    expect(m.host.textContent).toMatch(/blocked|not granted|denied/i)
    m.unmount()
  })

  it("unsupported (no Notifications API): webpush disabled with an explanation", async () => {
    unstubNotification()
    expect("Notification" in globalThis).toBe(false)
    const m = mount()
    await settled()
    const webpush = checkboxFor(m.host, "web push")!
    expect(webpush.disabled).toBe(true)
    expect(webpush.checked).toBe(false)
    expect(m.host.textContent).toMatch(/not support/i)
    m.unmount()
  })

  it("numeric thresholds render with .input and save PATCHes numbers + channels", async () => {
    stubNotification("granted")
    const m = mount()
    await settled()
    const minConf = m.host.querySelector('input[aria-label="Minimum confidence"]') as HTMLInputElement
    expect(minConf).toBeTruthy()
    expect(minConf.className.split(/\s+/).includes("input")).toBe(true)
    // Change a threshold, then save (native setter so React's tracker fires).
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    setter.call(minConf, "80")
    minConf.dispatchEvent(new Event("input", { bubbles: true }))
    await settled()
    const save = Array.from(m.host.querySelectorAll("button")).find((b) => b.textContent?.match(/save/i))!
    expect(save).toBeTruthy()
    expect(save.className.split(/\s+/).includes("btn")).toBe(true)
    save.click()
    await settled()
    expect(mockedSave).toHaveBeenCalled()
    const payload = mockedSave.mock.calls[0][0] as Record<string, unknown>
    expect(payload.minConfidence).toBe(80)
    expect((payload.channels as Record<string, boolean>).webpush).toBe(true)
    m.unmount()
  })
})
