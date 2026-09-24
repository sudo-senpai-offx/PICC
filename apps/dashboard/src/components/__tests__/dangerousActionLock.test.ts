// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { withActionLock } from "@/lib/dangerousActionLock"

type LockCallback = (lock: unknown) => Promise<unknown>
type LockRequest = (name: string, options: { timeout: number }, callback: LockCallback) => Promise<unknown>

const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks")

function setLocks(request: LockRequest) {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request }
  })
}

afterEach(() => {
  if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks)
  else Reflect.deleteProperty(navigator, "locks")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("withActionLock", () => {
  it("acquires the named lock, runs the action, then releases it", async () => {
    const events: string[] = []
    const request = vi.fn(async (_name: string, _options: { timeout: number }, callback: LockCallback) => {
      events.push("acquire")
      try {
        return await callback({})
      } finally {
        events.push("release")
      }
    })
    setLocks(request)

    const result = await withActionLock("kill-switch", async () => {
      events.push("run")
      return "saved"
    })

    expect(result).toBe("saved")
    expect(request).toHaveBeenCalledWith("picc:action:kill-switch", { timeout: 8000 }, expect.any(Function))
    expect(events).toEqual(["acquire", "run", "release"])
  })

  it("throws the verbatim held deny without running the action or calling fetch", async () => {
    setLocks(async () => {
      throw new DOMException("timed out", "TimeoutError")
    })
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const action = vi.fn(async () => {
      await fetch("/api/danger")
      return "posted"
    })

    const error = await withActionLock("kill-switch", action).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("suite:deny:lock-held (another tab holds the kill-switch lock — wait or close the other tab)")
    expect(action).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("throws the verbatim unavailable deny instead of passing through", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined })
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const action = vi.fn(async () => {
      await fetch("/api/danger")
      return "posted"
    })

    const error = await withActionLock("autopilot-config", action).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("suite:deny:lock-unavailable")
    expect(action).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("allows a retry after the platform auto-releases the lock when the holding tab closes", async () => {
    const events: string[] = []
    const waiters: (() => void)[] = []
    let owner: object | null = null
    let signalQueued!: () => void
    let signalFirstRunning!: () => void
    let finishFirst!: () => void
    const queued = new Promise<void>((resolve) => { signalQueued = resolve })
    const firstRunning = new Promise<void>((resolve) => { signalFirstRunning = resolve })
    const firstCanFinish = new Promise<void>((resolve) => { finishFirst = resolve })

    setLocks(async (_name, _options, callback) => {
      while (owner !== null) {
        signalQueued()
        await new Promise<void>((resolve) => { waiters.push(resolve) })
      }
      const lockOwner = {}
      owner = lockOwner
      events.push("acquire")
      try {
        return await callback({})
      } finally {
        if (owner === lockOwner) {
          owner = null
          events.push("release")
          waiters.shift()?.()
        }
      }
    })

    const first = withActionLock("kill-switch", async () => {
      events.push("first-run")
      signalFirstRunning()
      await firstCanFinish
      events.push("first-finish")
    })
    await firstRunning

    const retry = withActionLock("kill-switch", () => {
      events.push("retry-run")
      return "retried"
    })
    await queued

    owner = null
    waiters.shift()?.()
    await expect(retry).resolves.toBe("retried")
    expect(events).toEqual(["acquire", "first-run", "acquire", "retry-run", "release"])

    finishFirst()
    await expect(first).resolves.toBeUndefined()
  })
})
