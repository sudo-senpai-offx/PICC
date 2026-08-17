import { describe, expect, it, vi } from "vitest"

// Prevent the production server from binding a port when this test imports it.
vi.hoisted(() => {
  process.env.PICC_NO_LISTEN = "1"
})

import { resolveStatic } from "../index.mjs"

describe("resolveStatic (static-file path containment)", () => {
  it("maps the root and normal assets inside dist", () => {
    expect(resolveStatic("/")).toMatch(/index\.html$/)
    const p = resolveStatic("/app.js")
    expect(p).toMatch(/app\.js$/)
  })

  it("rejects path traversal attempts that would escape dist", () => {
    for (const probe of [
      "/../.env",
      "/..%2f.env",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/../server/data/users.json",
      "/assets/../../.env",
      "/..%2Fserver%2Fdata%2Fsessions.json"
    ]) {
      expect(resolveStatic(probe), probe).toBeNull()
    }
  })

  it("returns null for malformed percent-encoding instead of crashing", () => {
    expect(resolveStatic("/%zz")).toBeNull()
    expect(resolveStatic("/%c0%af")).toBeNull()
    expect(resolveStatic("/%")).toBeNull()
  })
})
