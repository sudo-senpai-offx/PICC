// @vitest-environment jsdom
// WS-7 slice B — the CLIENT sign-out discriminator, asserted BEHAVIOURALLY.
//
// WHAT THIS REPLACES, AND WHY THE REPLACEMENT WAS NECESSARY. Round 4 pinned the
// elapsed measurement with a source-text regex:
//
//     expect(src).toMatch(/elapsedMs:[\s\S]{0,80}performance\.now\(\) - startedAt/)
//
// which stayed green against code whose `startedAt` was a mount-time `useRef`
// that nothing ever reset (`useAuth.ts:88` on 5885f53; `setInconclusive(0)` at
// :118 and :127 clears the counter but not the ref). The discriminator the
// number is supposed to drive — "~0.4s on a 401" versus "~23000ms on the sixth
// consecutive inconclusive" — is unsound for any sign-out that is not
// immediately after mount, because the number is time-since-MOUNT, not
// time-since-the-chain-it-is-describing.
//
// A source regex cannot detect that: the expression IS present, and the
// expression was never the problem. So the elapsed claim now lives here, where
// the hook is actually driven.
//
// THE TWO NUMBERS, TOGETHER. These are the two ends of the discriminator and
// they only mean something as a pair:
//
//   reason "rejected",              elapsedMs ~0      -> a 401 destroyed a held
//                                                      session, on the first
//                                                      attempt of a fresh chain
//   reason "inconclusive-exhausted", elapsedMs ~23000 -> six inconclusive answers
//                                                      in a row, backoff included
//
// The second test below pins the ~23000 end, which round 4 never had. A single
// "elapsed is small" assertion would be satisfied by a permanently-zero clock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { useAuth } from "@/hooks/useAuth"

const KEY = "picc.auth"
const USER = { id: "u1", email: "e@example.test", name: "E" }
const TOKEN = "tok-for-the-trace-test"

let latest: { session: { access_token: string; user?: unknown } | null; loading: boolean } | null = null

function Probe() {
  latest = useAuth()
  return null
}

function mountProbe() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<Probe />)
  })
  return {
    unmount() {
      act(() => root.unmount())
      document.body.removeChild(host)
    }
  }
}

async function advance(totalMs: number) {
  const STEP_MS = 25
  let elapsed = 0
  do {
    const step = Math.min(STEP_MS, Math.max(totalMs - elapsed, 0))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step)
    })
    elapsed += step
  } while (elapsed < totalMs)
}

// ── the /me answer queue ────────────────────────────────────────────────────
// `rejected` is a real 401, `confirmed` a real 200 carrying the user,
// `inconclusive` a 503 ("could not tell"). The queue is EXHAUSTED, not cycled:
// a miscount must throw rather than silently reuse an answer and pass.
type Answer = "rejected" | "confirmed" | "inconclusive"
let answers: Answer[] = []

function answerFor(answer: Answer) {
  if (answer === "rejected") return { ok: false, status: 401, json: async () => ({ error: "not authenticated" }) }
  if (answer === "confirmed") return { ok: true, status: 200, json: async () => ({ ok: true, user: USER }) }
  return { ok: false, status: 503, json: async () => ({ error: "auth store unavailable" }) }
}

let calls = 0
function installFetch() {
  calls = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const answer = answers.shift()
      calls += 1
      if (answer === undefined) {
        throw new Error(`the /me answer queue ran dry after ${calls} calls; the test's script is wrong`)
      }
      return answerFor(answer)
    })
  )
}

// ── the trace capture ───────────────────────────────────────────────────────
let traceLines: { reason: string; inconclusivePass: number; elapsedMs: number }[] = []

function signOut(reason: "rejected" | "inconclusive-exhausted") {
  return traceLines.find((line) => line.reason === reason)
}

/** 1 + 2 + 4 + 8 + 8 seconds of backoff: see useAuth.ts's own comment. */
const EXHAUSTED_CHAIN_MS = 23_000

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  window.localStorage.setItem(KEY, JSON.stringify({ access_token: TOKEN, user: USER }))
  latest = null
  traceLines = []
  answers = []
  const real = console.debug
  vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
    const [tag, payload] = args
    if (tag === "[auth] sign-out" && payload && typeof payload === "object") {
      traceLines.push(payload as { reason: string; inconclusivePass: number; elapsedMs: number })
    }
    return real(...args)
  })
  installFetch()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe("WS-7 slice B — the sign-out trace's elapsed measurement", () => {
  it("measures from the START OF THE CURRENT CHAIN, not from mount", async () => {
    // A long inconclusive chain, then a recovery (which resets the counter to 0),
    // then a 401. The 401 is NOT the first attempt of the hook's life — it is the
    // first attempt of a fresh chain that began ~23s and two render passes after
    // mount. If the start were the mount time, this line would read ~23000 and be
    // indistinguishable from the exhausted-chain case below, which is the whole
    // failure the review found.
    answers = [
      "inconclusive", // pass 1
      "inconclusive", // pass 2
      "inconclusive", // pass 3
      "inconclusive", // pass 4
      "inconclusive", // pass 5  -> counter = 5
      "confirmed", //    pass 6  -> counter resets to 0, chain restarts
      "rejected" //      pass 7  -> the sign-out under test
    ]

    const probe = mountProbe()
    await advance(EXHAUSTED_CHAIN_MS + 1_000)

    const line = signOut("rejected")
    expect(
      line,
      `no rejected sign-out was traced after ${calls} /me calls; the 401 never landed`
    ).toBeTruthy()
    expect(line!.inconclusivePass, "a fresh chain signs out on pass 0").toBe(0)
    expect(
      line!.elapsedMs,
      `elapsedMs must be measured from the recovery, not from mount. Got ${line!.elapsedMs}ms, which ` +
        "is the length of the inconclusive chain that ENDED before this 401 - exactly the number the " +
        "trace exists to keep separate from it. If this fails, the chain start is not being reset when " +
        "the inconclusive counter resets."
    ).toBeLessThan(1_000)

    probe.unmount()
  })

  it("still reports ~23s when the chain really is six inconclusive answers in a row", async () => {
    // The control for the test above. Without it, "elapsed is small" is satisfied
    // by a clock that never advances, and the discriminator would be meaningless
    // rather than merely wrong.
    answers = ["inconclusive", "inconclusive", "inconclusive", "inconclusive", "inconclusive", "inconclusive"]

    const probe = mountProbe()
    await advance(EXHAUSTED_CHAIN_MS + 1_000)

    const line = signOut("inconclusive-exhausted")
    expect(line, `no exhausted-chain sign-out was traced after ${calls} /me calls`).toBeTruthy()
    expect(line!.inconclusivePass).toBe(5)
    expect(
      line!.elapsedMs,
      `the backoff ladder is 1+2+4+8+8s, so the chain must report about ${EXHAUSTED_CHAIN_MS}ms. ` +
        `Got ${line!.elapsedMs}ms. A number far from it means the start moved, not that the chain is fast.`
    ).toBeGreaterThan(EXHAUSTED_CHAIN_MS - 500)
    expect(line!.elapsedMs).toBeLessThan(EXHAUSTED_CHAIN_MS + 5_000)

    probe.unmount()
  })

  it("keeps the two branches apart: a 401 first pass is a sub-second line, a 401 after an outage is not", async () => {
    // The discriminator stated as an inequality on ONE number, which is how a
    // human will read a captured line in the wild.
    answers = ["rejected"]

    const probe = mountProbe()
    await advance(2_000)

    const line = signOut("rejected")
    expect(line).toBeTruthy()
    expect(line!.inconclusivePass).toBe(0)
    expect(line!.elapsedMs).toBeLessThan(1_000)
    expect(latest!.session, "a 401 is the ONLY branch that destroys the session").toBeNull()
    expect(window.localStorage.getItem(KEY)).toBeNull()

    probe.unmount()
  })

  it("carries no token and no user payload on the line", async () => {
    // The same property round 4's source test asserted, checked on the emitted
    // object rather than on the text, so a future `token` field fails here.
    answers = ["rejected"]

    const probe = mountProbe()
    await advance(2_000)

    const serialised = JSON.stringify(traceLines)
    expect(serialised, "a bearer token in a browser console diagnostic is a credential leak").not.toContain(TOKEN)
    expect(serialised).not.toContain(USER.email)
    expect(Object.keys(traceLines[0]).sort()).toEqual(["elapsedMs", "inconclusivePass", "reason"])

    probe.unmount()
  })

  it("the round-4 SOURCE assertion still passes against the broken behaviour — which is why it was worthless", async () => {
    // Kept deliberately, and asserted to be true. This is the anti-rot property
    // for the deleted regex: a reader who wonders whether the old test had any
    // value at all can see, in one green assertion, that it matches the shipped
    // source AND that the shipped source's elapsed number is wrong (the first
    // test above fails against it). The regex was never the problem; the value
    // it was subtracted from was.
    //
    // `?raw` rather than fs.readFileSync(import.meta.url): under jsdom the module
    // URL is an http URL and fileURLToPath throws, which is the same trap
    // testSupport/storeIsolation.mjs documents at length.
    const { default: src } = await import("../useAuth.ts?raw")
    expect(src).toMatch(/elapsedMs:[\s\S]{0,80}performance\.now\(\) - startedAt/)
  })
})
