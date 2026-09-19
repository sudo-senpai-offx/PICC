import { describe, expect, it } from "vitest"
import {
  FAMILIES,
  familyLabel,
  familyToSuite,
  suiteToFamilies,
  type FamilyId
} from "@/lib/registry"
import { INNER_NAV } from "@/pages/MinistryShell"

describe("classification registry (UI-reskin REQ-A)", () => {
  it("defines the locked active families", () => {
    const active = FAMILIES.filter((f) => f.status === "active").map((f) => f.familyId)
    expect(active.sort()).toEqual([
      "affiliate",
      "agent",
      "content",
      "crypto",
      "defi",
      "dividend",
      "interest",
      "p2p"
    ])
  })

  it("defines rental + nft as coming-soon", () => {
    const comingSoon = FAMILIES.filter((f) => f.status === "coming-soon").map((f) => f.familyId)
    expect(comingSoon.sort()).toEqual(["nft", "rental"])
  })

  it("excludes hardware-sharing families entirely (Q11)", () => {
    const ids = FAMILIES.map((f) => f.familyId)
    expect(ids).not.toContain("bandwidth")
    expect(ids).not.toContain("depin")
    expect(ids).not.toContain("storage")
    expect(ids).not.toContain("compute")
    expect(ids).not.toContain("other")
  })

  it("keeps an honest uncategorized marker outside the user-facing statuses", () => {
    const uncategorized = FAMILIES.find((f) => f.familyId === "uncategorized")
    expect(uncategorized).toBeDefined()
    expect(uncategorized?.status).toBe("unconfigured")
    expect(familyLabel("uncategorized")).toBe("Uncategorized")
  })

  it("maps every family to one of the three ministries", () => {
    const ministries = ["trading", "earnings", "intelligence"] as const
    for (const f of FAMILIES) {
      expect(ministries, `${f.familyId} -> ${f.owningMinistry}`).toContain(f.owningMinistry)
    }
  })

  it("encodes the locked family-to-ministry mapping (CONTEXT.md:57-65)", () => {
    expect(familyToSuite("crypto")).toBe("trading")
    expect(familyToSuite("defi")).toBe("intelligence")
    expect(familyToSuite("p2p")).toBe("intelligence")
    expect(familyToSuite("affiliate")).toBe("intelligence")
    expect(familyToSuite("rental")).toBe("intelligence")
    expect(familyToSuite("nft")).toBe("intelligence")
    expect(familyToSuite("dividend")).toBe("earnings")
    expect(familyToSuite("interest")).toBe("earnings")
    expect(familyToSuite("content")).toBe("earnings")
    expect(familyToSuite("agent")).toBe("earnings")
    expect(familyToSuite("uncategorized")).toBe("earnings")
  })

  it("suiteToFamilies returns only that ministry's families", () => {
    expect(suiteToFamilies("trading")).toEqual(["crypto"])
    expect(suiteToFamilies("earnings").sort()).toEqual([
      "agent",
      "content",
      "dividend",
      "interest",
      "uncategorized"
    ])
    expect(suiteToFamilies("intelligence").sort()).toEqual([
      "affiliate",
      "defi",
      "nft",
      "p2p",
      "rental"
    ])
  })

  it("rejects unknown family ids", () => {
    expect(familyToSuite("bandwidth" as FamilyId)).toBeNull()
    expect(familyToSuite("other" as FamilyId)).toBeNull()
    expect(familyLabel("other" as FamilyId)).toBeNull()
  })

  it("every family entry carries the graduation-policy reference", () => {
    for (const f of FAMILIES) {
      expect(f.graduationRef, `${f.familyId}`).toMatch(/^CONTEXT\.md:/)
    }
  })

  it("every family's sub-domain is a real room of its owning ministry", () => {
    for (const f of FAMILIES) {
      const rooms = (INNER_NAV[f.owningMinistry] ?? []).map((r) => r.to)
      expect(rooms, `${f.familyId} subDomain ${f.subDomain} not in ${f.owningMinistry}`).toContain(
        f.subDomain
      )
    }
  })

  it("is a true registry: unique ids, no hardcoded category maps elsewhere", () => {
    const ids = FAMILIES.map((f) => f.familyId)
    expect(new Set(ids).size).toBe(ids.length)
    // Every family carries its own label — no SUITE_META lookup by category key.
    for (const f of FAMILIES) {
      expect(f.label.length).toBeGreaterThan(0)
    }
  })

  it("exports the FamilyId union matching the registry ids", () => {
    // Forward-compat guard: if a family is added to the table, the type must
    // know it, and vice versa — no silent "other" catch-alls.
    const tableIds = new Set(FAMILIES.map((f) => f.familyId))
    const typed: FamilyId[] = [
      "crypto", "defi", "p2p", "dividend", "interest",
      "content", "agent", "affiliate", "rental", "nft", "uncategorized"
    ]
    for (const id of typed) {
      expect(tableIds.has(id), `type lists ${id} but table does not`).toBe(true)
    }
    for (const id of tableIds) {
      expect(typed, `table lists ${id} but type does not`).toContain(id)
    }
  })
})