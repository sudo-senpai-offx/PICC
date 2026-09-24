const LOCK_TIMEOUT_MS = 8000
const LOCK_REQUEST_OPTIONS: LockOptions & { timeout: number } = { timeout: LOCK_TIMEOUT_MS }

export async function withActionLock<T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    throw new Error("suite:deny:lock-unavailable")
  }

  try {
    return await navigator.locks.request(
      `picc:action:${name}`,
      LOCK_REQUEST_OPTIONS,
      async () => fn()
    )
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`suite:deny:lock-held (another tab holds the ${name} lock — wait or close the other tab)`)
    }
    throw error
  }
}
