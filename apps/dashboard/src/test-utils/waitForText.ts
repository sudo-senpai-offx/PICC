// WS-7: condition-based waiting for DOM text produced by an async load.
//
// WHY THIS EXISTS
// Component tests settled their async load with a fixed sleep:
//
//     await new Promise((r) => setTimeout(r, 10))
//     flushSync(() => {})
//     expect(text).toContain("BTCUSD x ETHUSD")
//
// The sleep is a guess about machine speed. On an idle box running serially it
// usually covered the fetch -> setState chain; under parallel load it did not,
// and the assertion then read the component's PLACEHOLDER (for example
// "Correlation screenRefreshDiversificat...") instead of loaded data, failing
// with a content mismatch that looks nothing like a timing problem.
//
// `act(async () => {})` is NOT the fix here. It flushes React's queue for
// microtasks already pending, but these panels load through longer chains
// (fetch -> setState -> effect -> refetch), so a single act() pass leaves the
// placeholder in place. Converting 25 of these mechanically to act() was tried
// and refuted by 8 real failures; it was rolled back.
//
// The correct primitive is to wait for a CONDITION the test already implies.
// Callers pass an ASCII marker that only appears once the load has committed.
// Every assertion after the wait is left completely untouched, so this changes
// only WHEN the test reads the DOM, never WHAT it asserts.
//
// A longer sleep would only lower the flake rate without removing the race.

import { flushSync } from "react-dom"

/** Minimal shape: anything exposing a host element to read text from. */
type Hosted = { host: HTMLElement }

export type WaitForTextOptions = {
  timeoutMs?: number
  pollMs?: number
}

/**
 * Flushes React and polls `host.textContent` until it contains `marker`.
 *
 * @throws naming the marker and the last rendered text, so a timeout reports the
 *         real cause instead of a downstream content mismatch.
 */
export async function waitForText(
  mounted: Hosted,
  marker: string,
  { timeoutMs = 5_000, pollMs = 5 }: WaitForTextOptions = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = ""
  for (;;) {
    flushSync(() => {})
    last = mounted.host.textContent ?? ""
    if (last.includes(marker)) return
    if (Date.now() > deadline) {
      throw new Error(
        `waitForText timed out after ${timeoutMs}ms waiting for ${JSON.stringify(marker)}. ` +
          `Last rendered: ${JSON.stringify(last.slice(0, 200))}`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
