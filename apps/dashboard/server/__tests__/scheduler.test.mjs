import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

let scheduler

async function loadScheduler() {
  vi.resetModules()
  scheduler = await import("../services/scheduler.mjs")
}

beforeEach(() => {
  // Fake timers per test so the scheduler never ticks real time; production
  // jobs keep ≥10 s first delays, which these tests never reach.
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("scheduler (slice 5d coverage)", () => {
  test("module registers production jobs without starting them", async () => {
    await loadScheduler()
    const status = scheduler.schedulerStatus()
    expect(status.ok).toBe(true)
    expect(status.running).toBe(false)
    const names = status.jobs.map((j) => j.name)
    expect(names).toContain("ccxt-market-data")
    expect(names).toContain("headless-session-refresh")
    // Nothing has run yet — honest nulls, not fabricated zeros.
    for (const j of status.jobs) {
      expect(j.lastRunAt).toBeNull()
      expect(j.lastOk).toBeNull()
    }
    expect(status.rateLimits).toBeTruthy()
  })

  test("every() registers with the 10s minimum interval clamp", async () => {
    await loadScheduler()
    let runs = 0
    scheduler.every("ut-custom", 1000, async () => {
      runs += 1
    })
    const job = scheduler.schedulerStatus().jobs.find((j) => j.name === "ut-custom")
    expect(job).toBeTruthy()
    expect(job.intervalMs).toBe(10_000)
    expect(runs).toBe(0)
  })

  test("startScheduler fires a staggered job on schedule and records its run", async () => {
    await loadScheduler()
    let runs = 0
    scheduler.every(
      "ut-first",
      1000,
      async () => {
        runs += 1
      },
      { staggerMs: 1 } // fires almost immediately — production jobs stay ≥10 s away
    )
    scheduler.startScheduler()
    expect(scheduler.schedulerStatus().running).toBe(true)

    await vi.advanceTimersByTimeAsync(5) // past the 1 ms stagger
    expect(runs).toBe(1)
    const job = scheduler.schedulerStatus().jobs.find((j) => j.name === "ut-first")
    expect(job.lastOk).toBe(true)
    expect(job.runningNow).toBe(false)
    expect(job.lastRunMs).toBeGreaterThanOrEqual(0)
  })

  test("sessionUptime24h reports empty state before the liveness monitor feeds it", async () => {
    await loadScheduler()
    expect(scheduler.sessionUptime24h()).toEqual({ samples: 0, connectedPct: null, livePct: null, windowHours: 0 })
  })

  test("ccxtSchedulerStatus wraps ccxt stats honestly", async () => {
    await loadScheduler()
    const s = scheduler.ccxtSchedulerStatus()
    expect(s.ok).toBe(true)
    expect(typeof s.stats.pairs).toBe("number")
    expect(typeof s.stats.buffers).toBe("number")
  })
})
