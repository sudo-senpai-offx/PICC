// M1 — segment model + validator + persistence (PICC_BANDWIDTH_SUITE_design_v1 §3 M1).
// TDD: these tests were written BEFORE the service existed and watched fail.
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  SegmentExistsError,
  SegmentOccupiedError,
  assignProvider,
  getSegment,
  listSegments,
  registerSegment,
  setConnectionState
} from "../services/bandwidthSuite/segments.mjs"

describe("bandwidth segments (memory-backed, VITEST)", () => {
  it("registerSegment creates a segment with honest default state", () => {
    const seg = registerSegment({ segmentId: "mobile-4g", kind: "mobile" })
    expect(seg).toMatchObject({
      segmentId: "mobile-4g",
      kind: "mobile",
      provider: null,
      status: "idle",
      connectionState: "unknown"
    })
    expect(listSegments()).toContainEqual(seg)
    expect(getSegment("mobile-4g")).toEqual(seg)
  })

  it("registerSegment refuses a duplicate segment id", () => {
    registerSegment({ segmentId: "dup", kind: "mobile" })
    expect(() => registerSegment({ segmentId: "dup", kind: "mobile" })).toThrow(SegmentExistsError)
  })

  it("registerSegment rejects an invalid kind", () => {
    expect(() => registerSegment({ segmentId: "x", kind: "satellite" })).toThrow(/kind/)
  })

  it("registerSegment rejects a blank segment id", () => {
    expect(() => registerSegment({ segmentId: "  ", kind: "mobile" })).toThrow(/segmentId/)
  })

  it("assignProvider assigns to an idle segment and activates it", () => {
    registerSegment({ segmentId: "seg-a", kind: "mobile" })
    const seg = assignProvider("seg-a", "earnapp")
    expect(seg.provider).toBe("earnapp")
    expect(seg.status).toBe("active")
  })

  it("assignProvider REFUSES a second provider on an occupied segment (the ban-pattern gate)", () => {
    registerSegment({ segmentId: "seg-b", kind: "mobile" })
    assignProvider("seg-b", "earnapp")
    expect(() => assignProvider("seg-b", "honeygain")).toThrow(SegmentOccupiedError)
  })

  it("assignProvider is idempotent for the same provider", () => {
    registerSegment({ segmentId: "seg-c", kind: "broadband" })
    assignProvider("seg-c", "pawns")
    expect(assignProvider("seg-c", "pawns").provider).toBe("pawns")
  })

  it("assignProvider throws on an unknown segment", () => {
    expect(() => assignProvider("nope", "earnapp")).toThrow(/unknown segment/i)
  })

  it("setConnectionState updates the honest connection state", () => {
    registerSegment({ segmentId: "seg-d", kind: "mobile" })
    expect(setConnectionState("seg-d", "stable").connectionState).toBe("stable")
  })

  it("setConnectionState rejects a gibberish state and leaves the segment honest", () => {
    registerSegment({ segmentId: "seg-e", kind: "vps" })
    expect(() => setConnectionState("seg-e", "wobbly")).toThrow(/connectionState/)
    expect(getSegment("seg-e").connectionState).toBe("unknown")
  })
})

describe("persistence (PICC_BANDWIDTH_DATA_DIR override, atomic tmp+rename)", () => {
  let dir

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "picc-bw-"))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it("persists segments to disk and re-boots them on a fresh import", async () => {
    vi.stubEnv("PICC_BANDWIDTH_DATA_DIR", dir)
    vi.stubEnv("VITEST", "true")
    vi.resetModules()
    const first = await import("../services/bandwidthSuite/segments.mjs")
    first.registerSegment({ segmentId: "mobile-4g", kind: "mobile" })
    first.assignProvider("mobile-4g", "earnapp")
    first.setConnectionState("mobile-4g", "stable")

    vi.resetModules()
    const second = await import("../services/bandwidthSuite/segments.mjs")
    expect(second.getSegment("mobile-4g")).toMatchObject({
      segmentId: "mobile-4g",
      kind: "mobile",
      provider: "earnapp",
      status: "active",
      connectionState: "stable"
    })
  })
})