// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest"
import { getMinistrySettings, saveMinistrySettings, type AutopilotMode } from "@/lib/ministrySettings"

describe("ministry settings", () => {
  beforeEach(() => localStorage.clear())

  const defaults = { mode: "auto" as AutopilotMode, confidenceThreshold: 0.6 }

  it("returns defaults for a fresh ministry", () => {
    expect(getMinistrySettings("trading")).toEqual(defaults)
  })

  it("persists a mode flip to copilot", () => {
    saveMinistrySettings("trading", { mode: "copilot" })
    expect(getMinistrySettings("trading").mode).toBe("copilot")
  })

  it("clamps confidenceThreshold to [0,1]", () => {
    saveMinistrySettings("earnings", { confidenceThreshold: 1.5 })
    expect(getMinistrySettings("earnings").confidenceThreshold).toBe(1)
    saveMinistrySettings("earnings", { confidenceThreshold: -3 })
    expect(getMinistrySettings("earnings").confidenceThreshold).toBe(0)
  })
})