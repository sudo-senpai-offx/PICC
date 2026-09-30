// WS-7 T16 — the authority record. D12 / R12.1 / AC-035's substrate.
//
// D12:193-200 — "Authority model `{ id, title, scope[], canApprove[] }` with
// separation of duties":
//   Context:     D5 requires "ministry-authority sign-off". The repository has
//                no authority model.
//   Decision:    Authorities are records of exactly that shape.
//                Separation of duties is enforced mechanically: no authority may
//                both build and approve the same room.
//   Why:         An authority that builds a room and then approves it is not a
//                control.
//   Consequence: The separation rule is a test, not a convention. A
//                build/approve collision is a hard failure with the offending
//                pair named. AC-035.
//
// R12.1:446 — "Authorities are `{ id, title, scope[], canApprove[] }` records."
//
// §4.3:642-648 gives the same four fields and annotates exactly one of them:
// `canApprove: string[];  // room keys`, with the note "D12: this authority must
// not appear in both its built rooms and canApprove".
//
// WHAT `scope` IS NOT. §4.3 annotates `canApprove` as room keys and says
// nothing about `scope`, and D12's collision is stated in terms of BUILDS, never
// in terms of scope. So `scope` is the authority's declared remit — opaque
// strings this module validates and carries, and NOTHING MORE. It is
// deliberately NOT read as a build set: reading it as one would make the
// collision condition a field comparison instead of the build/approve
// comparison AC-035:1046 specifies ("also appears as that room's builder"), and
// it would invent a constraint the spec never states. The build side arrives
// from a build registry — see `separationOfDuties.mjs`.

import { describe, expect, it } from "vitest"

import {
  AUTHORITY_FIELDS,
  UNASSIGNED_RESERVATION,
  authorityById,
  approversForRoom,
  canApprove,
  createAuthority,
  defineAuthorities,
  unassignedAuthorityLabel
} from "../authorityModel.mjs"

const A_BUILDING = {
  id: "auth:build-lead",
  title: "Trading build lead",
  scope: ["trading", "execution-surface"],
  canApprove: ["risk", "ceremony"]
}

const A_REVIEWING = {
  id: "auth:review-lead",
  title: "Trading review lead",
  scope: ["trading", "release-governance"],
  canApprove: ["markets", "risk", "ceremony"]
}

describe("T16 authority record — D12's shape, exactly", () => {
  it("carries exactly id, title, scope[], canApprove[] and nothing else", () => {
    const authority = createAuthority(A_BUILDING)
    expect(Object.keys(authority).sort()).toEqual(["canApprove", "id", "scope", "title"])
    expect(AUTHORITY_FIELDS).toEqual(["id", "title", "scope", "canApprove"])
  })

  it("refuses a record with an extra field, because the shape is 'exactly that shape'", () => {
    // D12:196 says "records of exactly that shape". An extra field would be a
    // fifth thing to keep in agreement with §4.3:642-648 and the client
    // contract, and the most likely candidate is a `builtRooms` list — which
    // would silently become a second source of truth for the detector.
    expect(() =>
      createAuthority({ ...A_BUILDING, builtRooms: ["markets"], note: "extra" })
    ).toThrow(/authority/i)
  })

  it("refuses a record that is missing any of the four fields", () => {
    for (const field of AUTHORITY_FIELDS) {
      const incomplete = { ...A_BUILDING }
      delete incomplete[field]
      expect(() => createAuthority(incomplete)).toThrow(new RegExp(field))
    }
  })

  it("freezes the record and both arrays, so a caller cannot widen its own approval", () => {
    const authority = createAuthority(A_BUILDING)
    expect(Object.isFrozen(authority)).toBe(true)
    expect(Object.isFrozen(authority.scope)).toBe(true)
    expect(Object.isFrozen(authority.canApprove)).toBe(true)
    expect(() => authority.canApprove.push("markets")).toThrow()
  })

  it("copies its input arrays rather than aliasing the caller's", () => {
    const input = { ...A_BUILDING, canApprove: ["risk"] }
    const authority = createAuthority(input)
    input.canApprove.push("markets")
    expect(authority.canApprove).toEqual(["risk"])
  })

  it("requires id and title to be non-empty strings", () => {
    expect(() => createAuthority({ ...A_BUILDING, id: "" })).toThrow(/id/)
    expect(() => createAuthority({ ...A_BUILDING, id: 7 })).toThrow(/id/)
    expect(() => createAuthority({ ...A_BUILDING, title: "   " })).toThrow(/title/)
  })

  it("requires scope and canApprove to be arrays of unique, non-empty strings", () => {
    expect(() => createAuthority({ ...A_BUILDING, scope: "trading" })).toThrow(/scope/)
    expect(() => createAuthority({ ...A_BUILDING, canApprove: "risk" })).toThrow(/canApprove/)
    expect(() => createAuthority({ ...A_BUILDING, scope: ["trading", ""] })).toThrow(/scope/)
    expect(() => createAuthority({ ...A_BUILDING, canApprove: ["risk", "risk"] })).toThrow(/canApprove/)
    // An authority that approves nothing is a legitimate record; `[]` is honest
    // and must not be confused with "unknown".
    expect(createAuthority({ ...A_BUILDING, canApprove: [] }).canApprove).toEqual([])
  })

  it("rejects a non-object, so `undefined` cannot become an authority", () => {
    expect(() => createAuthority(null)).toThrow(TypeError)
    expect(() => createAuthority("auth:x")).toThrow(TypeError)
  })
})

describe("T16 authority set — duplicate ids are a referential-integrity failure", () => {
  it("rejects two authorities sharing an id", () => {
    // The collision report names authorities by id. Two authorities with one id
    // would make that name ambiguous, and "the approving authority" on a permit
    // record would resolve to whichever loaded last.
    expect(() => defineAuthorities([A_BUILDING, { ...A_REVIEWING, id: A_BUILDING.id }])).toThrow(
      /auth:build-lead/
    )
  })

  it("returns a frozen set and looks records up by id", () => {
    const authorities = defineAuthorities([A_BUILDING, A_REVIEWING])
    expect(Object.isFrozen(authorities)).toBe(true)
    expect(authorities).toHaveLength(2)
    expect(authorityById(authorities, "auth:review-lead").title).toBe("Trading review lead")
  })

  it("returns null for an unknown id rather than inventing one", () => {
    const authorities = defineAuthorities([A_BUILDING])
    expect(authorityById(authorities, "auth:nobody")).toBeNull()
  })
})

describe("T16 approvals — who may approve a room", () => {
  const authorities = defineAuthorities([A_BUILDING, A_REVIEWING])

  it("answers per authority", () => {
    expect(canApprove(authorityById(authorities, "auth:build-lead"), "risk")).toBe(true)
    expect(canApprove(authorityById(authorities, "auth:build-lead"), "markets")).toBe(false)
  })

  it("collects every approver of a room, and an empty list for a room nobody may approve", () => {
    expect(approversForRoom(authorities, "risk")).toEqual(["auth:build-lead", "auth:review-lead"])
    expect(approversForRoom(authorities, "markets")).toEqual(["auth:review-lead"])
    expect(approversForRoom(authorities, "no-such-room")).toEqual([])
  })

  it("does not treat a missing authority as a permission", () => {
    expect(canApprove(null, "risk")).toBe(false)
  })
})

describe("T16 D10 — an unassigned owner is the literal reservation, never a record", () => {
  it("has no authority record, so a lookup returns null", () => {
    // D10:175-182 — every reserved capability displays the literal `WS-7+`. A
    // synthesised record carrying that string as its id would be a fabricated
    // owner: it would satisfy `authorityById` and could then satisfy a
    // separation check and a permit approval with a name nobody holds.
    const authorities = defineAuthorities([A_BUILDING])
    expect(authorityById(authorities, UNASSIGNED_RESERVATION)).toBeNull()
  })

  it("offers the literal for display instead", () => {
    expect(unassignedAuthorityLabel()).toBe("WS-7+")
  })
})
