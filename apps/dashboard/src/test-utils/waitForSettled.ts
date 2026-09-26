// WS-7: condition-based waiting for React state settled from a promise.
//
// WHY THIS EXISTS
// A growing number of tests settled async hook state with a FIXED sleep:
//
//     await new Promise((r) => setTimeout(r, 10))
//     flushSync(() => {})
//
// That is a guess about machine speed, not a condition. It passed while the
// suite ran serially on an idle box and failed roughly one run in four once the
// suite ran in parallel (b78f5a2): under load, 10ms is no longer enough for the
// fetch -> parse -> setState chain, so the assertion reads the PRE-update value
// and reports `expected false to be true` with no obvious cause.
//
// The fix is to wait for the CONDITION rather than for a duration. `waitForSettled`
// keeps flushing React and re-reading the observed value until a predicate passes
// or a generous deadline expires, so the result is correct regardless of load.
//
// A fixed sleep is not replaced by a bigger fixed sleep: a longer timeout only
// lowers the flake rate, it does not remove the race.

import { flushSync } from "react-dom"

export type WaitOptions = {
  /** Generous by design - the point is to wait for a condition, not a clock. */
  timeoutMs?: number
  pollMs?: number
  description?: string
}

export class WaitForTimeoutError extends Error {
  constructor(description: string, timeoutMs: number) {
    super(`timed out after ${timeoutMs}ms waiting for: ${description}`)
    this.name = "WaitForTimeoutError"
  }
}

/**
 * Flushes React, re-reads `read`, and returns once `done(read)` holds.
 *
 * @param read   re-reads the CURRENT value (must not be memoised by the caller)
 * @param done   the actual condition being waited on
 */
export async function waitForSettled<T>(
  read: () => T,
  done: (value: T) => boolean,
  { timeoutMs = 5_000, pollMs = 5, description = "condition" }: WaitOptions = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    // Drain React's scheduler before reading, so we observe committed state.
    flushSync(() => {})
    const value = read()
    if (done(value)) return value
    if (Date.now() > deadline) {
      throw new WaitForTimeoutError(description, timeoutMs)
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

/**
 * Convenience wrapper for the common "settle, then read once" case.
 *
 * Keeps the original settle() call sites working, but gives them a way to state
 * what they are actually waiting for instead of hoping 10ms was enough.
 */
export async function settleUntil<T>(
  read: () => T,
  done: (value: T) => boolean,
  description: string
): Promise<T> {
  return waitForSettled(read, done, { description })
}
