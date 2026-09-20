import { describe, expect, it } from "vitest"
import { EV_RR_MIN, fmtUptime, pillarGlyph } from "@/lib/v32"

describe("v3.2 frontend helpers", () => {
  it("exposes the cost-line floor the soak bay labels against", () => {
    expect(EV_RR_MIN).toBe(2)
  })

  it("formats uptime seconds humanly and honestly (null in → '—')", () => {
    expect(fmtUptime(null)).toBe("—")
    expect(fmtUptime(0)).toBe("0s")
    expect(fmtUptime(59)).toBe("59s")
    expect(fmtUptime(60)).toBe("1m")
    expect(fmtUptime(3661)).toBe("1h 1m")
  })

  it("glyphs a pillar by its directional read", () => {
    expect(pillarGlyph({ direction: "up" })).toBe("▲")
    expect(pillarGlyph({ direction: "down" })).toBe("▼")
    expect(pillarGlyph({ direction: "neutral" })).toBe("·")
    expect(pillarGlyph({ available: false })).toBe("—")
    expect(pillarGlyph({})).toBe("?")
  })
})