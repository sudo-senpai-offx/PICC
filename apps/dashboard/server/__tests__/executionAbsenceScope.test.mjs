// WS-7 T0 — the scope half of the D4 no-auto-execute pin.
//
// executionAbsence.test.mjs proves that a HAND-MAINTAINED list of ten suite
// modules contains no order calls. This file proves something the hand-list
// cannot: that the hand-list is not the only place capability could hide.
//
// The failure it guards is specific and real. A module can call .createOrder( and
// the existing guard still passes, because the guard only reads the ten modules
// somebody remembered to list. The audit that shaped WS-7 found two such
// modules — services/ccxtOrdering.mjs and services/venues/hyperliquidPerps.mjs —
// and the repo's documented "paper-only" claim was therefore unpinned.
//
// The discovery rule requires a receiver, a method name, and an opening paren, so
// prose, deprecation comments, and data keys named `order` do not register as
// capability. Test fixtures and the absence-scope script itself are skipped.
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  INTENTIONAL_ORDER_CAPABLE,
  INTENTIONAL_PAPER_SEAMS,
  discoverOrderCapableModules,
  findUndeclaredOrderCapability
} from "../scripts/absence-scope.mjs"

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

describe("WS-7 T0 — absence scope is discovered, not hand-listed", () => {
  it("discovers the order-capable modules the hand-list omitted", () => {
    const discovered = discoverOrderCapableModules(SERVER_ROOT)
    // These two are the audit finding. If either disappears the scope shrank, and
    // that is a change someone should make on purpose rather than discover later.
    expect(discovered).toContain("services/ccxtOrdering.mjs")
    expect(discovered).toContain("services/venues/hyperliquidPerps.mjs")
  })

  it("reports no undeclared order capability", () => {
    const { undeclared, discovered } = findUndeclaredOrderCapability(SERVER_ROOT)
    expect(
      undeclared,
      `order-capable modules not on the reviewed intentional list: ${undeclared.join(", ")} (discovered: ${discovered.join(", ")})`
    ).toEqual([])
  })

  it("keeps every venue entry real — no stale allow-list entries", () => {
    // The failure mode of an allow-list is silent rot: a module gets deleted and
    // its name lingers, so a future module reusing that name would be waved
    // through. Discovery must find every declared venue-capable module.
    const discovered = discoverOrderCapableModules(SERVER_ROOT)
    for (const declared of INTENTIONAL_ORDER_CAPABLE) {
      expect(
        discovered,
        `${declared} is declared venue order-capable but discovery does not find it in the source tree`
      ).toContain(declared)
    }
  })

  it("declares every declared paper seam as an existing module", () => {
    // Paper seams are not venue-shaped so discovery does not find them, but they
    // must still exist on disk — a deleted seam must not linger as a declaration.
    for (const seam of INTENTIONAL_PAPER_SEAMS) {
      expect(
        existsSync(resolve(SERVER_ROOT, seam)),
        `${seam} is declared an intentional paper seam but does not exist on disk`
      ).toBe(true)
    }
  })

  it("does not treat a bare `order` identifier as capability", () => {
    // The scan must not fire on the shapes and prose that legitimately contain
    // the word order, or the scope would be noise and get ignored.
    const { undeclared } = findUndeclaredOrderCapability(SERVER_ROOT)
    expect(undeclared.filter((m) => /orderFlow|orderflow/.test(m))).toEqual([])
  })

  it("excludes test files and the scope script itself from the scan", () => {
    const discovered = discoverOrderCapableModules(SERVER_ROOT)
    expect(discovered.filter((m) => m.includes("__tests__"))).toEqual([])
    expect(discovered).not.toContain("scripts/absence-scope.mjs")
  })
})
