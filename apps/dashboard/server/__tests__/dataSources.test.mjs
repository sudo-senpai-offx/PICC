import { describe, expect, test } from "vitest"
import {
  REQUIRED_SOURCES,
  isValidStatus,
  classifySource,
  collectSourceStatuses
} from "../services/dataSources.mjs"

const now = 1_800_000_000_000

describe("dataSources (slice 5d coverage)", () => {
  test("status vocabulary is closed and validated", () => {
    expect(["live", "local", "stale", "unconfigured"].every(isValidStatus)).toBe(true)
    expect(isValidStatus("connected")).toBe(false)
    expect(isValidStatus(undefined)).toBe(false)
  })

  test("classifySource: fresh < 30s → live, 30-60s → local, > 60s → stale", () => {
    expect(classifySource(now - 10_000, now)).toMatchObject({ status: "live", age: 10 })
    expect(classifySource(now - 45_000, now)).toMatchObject({ status: "local", age: 45 })
    expect(classifySource(now - 90_000, now)).toMatchObject({ status: "stale", age: 90 })
  })

  test("classifySource: no timestamp → unconfigured, never a crash", () => {
    expect(classifySource(null, now)).toEqual({ status: "unconfigured", lastUpdate: null, age: null })
    expect(classifySource(0, now).status).toBe("unconfigured")
    expect(classifySource("bogus", now).status).toBe("unconfigured")
  })

  test("collectSourceStatuses returns every required source with a valid status", () => {
    const out = collectSourceStatuses(now)
    for (const key of REQUIRED_SOURCES) {
      expect(out[key], `missing source ${key}`).toBeTruthy()
      expect(isValidStatus(out[key].status), `${key} had invalid status`).toBe(true)
    }
  })
})
