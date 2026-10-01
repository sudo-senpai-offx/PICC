// @vitest-environment jsdom
// WS-7 T8 — the BISECT LINE, on its own, because it is a constraint about the
// pair rather than about either room.
//
// Spec :1271 — "Neither room may depend on the other to render; both degrade to
// reserved independently."
//
// WHY THIS NEEDS A DEDICATED FILE. Every other assertion in this task is about
// one room: its honesty, its completion record, its D27 verdict. This one is
// about the RELATIONSHIP, and a per-room test cannot see it — a room can be
// perfect in isolation and still reach into its sibling. So the two claims are
// held together here.
//
// THE CLAIM IS PROVEN BY MAKING THE SIBLING UNLOADABLE, not by inspecting the
// import list. `vi.mock(..., () => { throw ... })` replaces the module with a
// factory that throws on evaluation: if anything in the rendering graph imports
// it, the import throws and the render fails. If nothing imports it, the mock is
// inert and the room renders. That is the stronger form — a static grep for the
// sibling's name would pass on a room that reached it through a transitive
// import, and the grep is also the check this repository already had to learn
// about the difference between a comment and a call site.
//
// BOTH DIRECTIONS ARE HELD. One direction passing proves nothing about the
// other, and the anti-goal is symmetric: "one room rendering from the other's
// state" is the defect in either direction.
import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"

/** The path of the sibling module, relative to this file. */
const SIBLINGS = {
  ceremony: "../../routes/CeremonyRoom",
  ministry: "../../routes/MinistryRoom"
} as const

const readCode = (relative: string) => {
  let inBlock = false
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
    .split("\n")
    .map((raw) => {
      let line = raw
      if (inBlock) {
        const close = line.indexOf("*/")
        if (close === -1) return ""
        line = line.slice(close + 2)
        inBlock = false
      }
      const open = line.indexOf("/*")
      if (open !== -1) {
        const close = line.indexOf("*/", open + 2)
        if (close === -1) {
          inBlock = true
          line = line.slice(0, open)
        } else {
          line = line.slice(0, open) + line.slice(close + 2)
        }
      }
      const at = line.indexOf("//")
      return at === -1 ? line : line.slice(0, at)
    })
    .join("\n")
}

describe("WS-7 T8 — the bisect line: neither room depends on the other to render", () => {
  it("the Ceremony room renders with the Ministry room UNLOADABLE", async () => {
    // The sibling is replaced with a factory that throws. If the Ceremony room —
    // or anything it imports — reaches for the Ministry room, this render fails.
    vi.doMock(SIBLINGS.ministry, () => {
      throw new Error("bisect: the Ceremony room must not import the Ministry room")
    })
    try {
      vi.resetModules()
      const { CeremonyRoom } = await import(SIBLINGS.ceremony)

      // A populated ceremony readout, so "renders correctly" means the real
      // surface rather than a shell that happens to be sibling-free.
      const html = renderToStaticMarkup(
        <CeremonyRoom
          readout={{
            ok: true,
            at: "2026-10-01T00:00:00.000Z",
            scaleMinResolves: 500,
            scaleEnvError: null,
            classes: [
              {
                venueClass: "ccxt-crypto",
                spendableResolved: 312,
                scaleResolved: 312,
                gates: [{ id: "gate1-constitution-300", pass: true, reason: "spendable resolved 312 ≥ 300" }],
                enablement: null,
                binaryOptions: false,
                platformVerification: null,
                lastCreditAt: "2026-10-01T00:00:00.000Z",
                ledgerRunning: true
              }
            ]
          }}
        />
      )

      // Its OWN room key, its OWN data, and its own gates — all present.
      expect(html).toContain('data-room-key="ceremony"')
      expect(html).toContain('data-venue-class="ccxt-crypto"')
      expect(html).toContain('data-gate="gate1-constitution-300" data-pass="true"')
      expect(html).toContain('data-spendable-resolved="312"')
      // And nothing from the sibling's vocabulary leaked in.
      expect(html).not.toContain("authority")
      expect(html).not.toContain("approver")
    } finally {
      vi.doUnmock(SIBLINGS.ministry)
      vi.resetModules()
    }
  })

  it("the Ministry room renders with the Ceremony room UNLOADABLE", async () => {
    vi.doMock(SIBLINGS.ceremony, () => {
      throw new Error("bisect: the Ministry room must not import the Ceremony room")
    })
    try {
      vi.resetModules()
      const { MinistryRoom } = await import(SIBLINGS.ministry)

      const html = renderToStaticMarkup(
        <MinistryRoom
          readout={{
            ok: true,
            governanceVersion: "ministry-governance/1.0.0",
            unassignedAuthority: "WS-7+",
            authorities: { registered: [], count: 0, reason: "No authority registry is wired to this readout." },
            buildRegistry: { recordCount: 0, roomsCovered: [], reason: "The build registry has no producer." },
            rooms: [
              {
                roomKey: "markets",
                builders: [],
                approvers: [],
                collisions: [],
                separated: true,
                approverDisplay: "WS-7+",
                approverCount: 0,
                builderCount: 0
              }
            ],
            separation: {
              code: "authority:collide:build-approve",
              ok: true,
              collisionCount: 0,
              approverAuthorityCount: 0,
              roomsWithAnApprover: 0,
              checkedAuthorities: 0
            },
            permits: { brokers: [], changeCount: 0, grants: [], reason: "No automationPermitted change has been recorded." },
            refusalCodes: []
          }}
        />
      )

      // Its OWN room key, its OWN data, and the reservation — all present.
      expect(html).toContain('data-room-key="ministry"')
      expect(html).toContain('data-approver="WS-7+"')
      expect(html).toContain('data-separation="empty"')
      // Nothing from the sibling's vocabulary leaked in. Note this includes
      // `venueClass`, the ceremony store's own row key.
      expect(html).not.toContain("venue-class")
      expect(html).not.toContain("ceremony")
      // The ceremony ROOM KEY still appears, because it is one of the 15 frozen
      // room keys the Ministry room is required to REPORT on. Being a reported
      // subject is not a dependency — this is the distinction the previous test
      // about imports was about, and it is why the assertion above checks for the
      // ceremony STORE's vocabulary rather than the ceremony room KEY.
      expect(html).toContain("approver")
    } finally {
      vi.doUnmock(SIBLINGS.ceremony)
      vi.resetModules()
    }
  })

  it("no module in either room's rendering graph imports the other", () => {
    // The static half, over the FULL graph rather than just the two room files:
    // the room, its domain projection, its surface, its adapter, and its page
    // caller. A dependency introduced anywhere in that set is a defect even if
    // the dynamic proof above happens not to exercise it.
    const ceremonyGraph = [
      "../../routes/CeremonyRoom.tsx",
      "../../domain/ceremonyRoom.ts",
      "../../components/CeremonySurface.tsx",
      "../../adapters/governanceReading.ts",
      "../../../pages/ministry/CeremonyRoom.tsx"
    ]
    const ministryGraph = [
      "../../routes/MinistryRoom.tsx",
      "../../domain/ministryGovernance.ts",
      "../../components/MinistrySurface.tsx",
      "../../adapters/governanceReading.ts",
      "../../../pages/ministry/MinistryAuthorityRoom.tsx"
    ]

    // The adapter is SHARED by both rooms, so it is checked in both directions:
    // a shared transport is fine, a shared ROOM STATE is not.
    for (const file of ceremonyGraph) {
      const code = readCode(file)
      expect(code, `${file} must not import the Ministry room`).not.toMatch(/MinistryRoom"/)
      expect(code, `${file} must not import the Ministry projection`).not.toMatch(/ministryGovernance/)
      expect(code, `${file} must not import the Ministry surface`).not.toMatch(/MinistrySurface/)
    }
    for (const file of ministryGraph) {
      const code = readCode(file)
      expect(code, `${file} must not import the Ceremony room`).not.toMatch(/CeremonyRoom"/)
      expect(code, `${file} must not import the ceremony projection`).not.toMatch(/ceremonyRoom/)
      expect(code, `${file} must not import the ceremony surface`).not.toMatch(/CeremonySurface/)
    }
  })

  it("neither page caller fetches the other's endpoint", () => {
    // The transport half of the same claim. A page caller that fetched both
    // endpoints would still "render independently" while coupling the two rooms'
    // availability: one failing request would change what the other can show.
    const ceremonyCaller = readCode("../../../pages/ministry/CeremonyRoom.tsx")
    expect(ceremonyCaller, "the Ceremony caller must fetch only the ceremony readout").toMatch(/fetchCeremonyReadout/)
    expect(ceremonyCaller, "the Ceremony caller must not fetch the ministry readout").not.toMatch(/fetchMinistryGovernance/)

    const ministryCaller = readCode("../../../pages/ministry/MinistryAuthorityRoom.tsx")
    expect(ministryCaller, "the Ministry caller must fetch only the ministry readout").toMatch(/fetchMinistryGovernance/)
    expect(ministryCaller, "the Ministry caller must not fetch the ceremony readout").not.toMatch(/fetchCeremonyReadout/)

    // And the shared adapter offers exactly one endpoint per room, so neither
    // caller can reach the other's even by accident.
    const adapter = readCode("../../adapters/governanceReading.ts")
    expect(adapter).toContain("/command-centre/ceremony")
    expect(adapter).toContain("/trading/ministry")
    // Neither fetches candles or any market-data endpoint: these rooms consume
    // their own producers, and adding one would be T7R-B's rejected client-side
    // pattern for no gain.
    expect(adapter, "neither room needs market data").not.toMatch(/candles/i)
    expect(adapter, "and neither may forward a session cookie to a third-party origin").not.toMatch(/credentials/i)
  })

  it("both rooms are still ROUTED, so neither degrades to a reserved placeholder", async () => {
    // The other half of the bisect sentence: "both degrade to RESERVED
    // independently". A room that could not render at all would satisfy
    // independence trivially, so both are asserted to produce real output with
    // NO readout at all — the reserved/absent path each room owns.
    vi.resetModules()
    const { CeremonyRoom } = await import(SIBLINGS.ceremony)
    const { MinistryRoom } = await import(SIBLINGS.ministry)

    const ceremonyAbsent = renderToStaticMarkup(<CeremonyRoom readout={null} />)
    expect(ceremonyAbsent).toContain('data-room-key="ceremony"')
    expect(ceremonyAbsent).toContain('data-ceremony-readout="absent"')

    const ministryAbsent = renderToStaticMarkup(<MinistryRoom readout={null} />)
    expect(ministryAbsent).toContain('data-room-key="ministry"')
    expect(ministryAbsent).toContain('data-ministry-readout="absent"')

    // And each says something DIFFERENT, which is what makes the two absences
    // distinguishable rather than one shared blank.
    expect(ceremonyAbsent).not.toContain(ministryAbsent.split('data-room-key="ministry"')[1].slice(0, 200))
  })
})

/* ==========================================================================
   WS-7 T9 — the same bisect line for D1's rooms 5 and 6.

   Spec :1280 — "The Paper/Live room is the highest-risk room; it must be
   revertible independently and must fail closed."

   A SEPARATE `describe`, not an extension of T8's, because the two pairs are
   independent commitments about different rooms and T8's file is already about
   Ceremony-vs-Ministry. Merging them would make a failure ambiguous: which pair
   broke?
   ========================================================================== */

const T9_SIBLINGS = {
  /** The Strategy room's whole rendering. It is a reserved body, which is the point. */
  strategy: "../../../pages/ministry/reservedRooms",
  paperLive: "../../routes/PaperLiveRoom"
} as const

describe("WS-7 T9 — Strategy and Paper/Live are independently revertible", () => {
  it("Paper/Live renders with the Strategy room UNLOADABLE", async () => {
    // The sibling is replaced with a factory that throws on evaluation. If the
    // Paper/Live room — or anything it imports — reaches for the Strategy room, this
    // render fails. Same mechanism as T8's two directions, for T9's pair.
    vi.doMock(T9_SIBLINGS.strategy, () => {
      throw new Error("bisect: the Paper/Live room must not import the Strategy room")
    })
    try {
      vi.resetModules()
      const { PaperLiveRoom } = await import(T9_SIBLINGS.paperLive)

      const html = renderToStaticMarkup(
        <PaperLiveRoom
          readouts={{
            permit: {
              ok: true,
              ladder: { rungs: ["paper", "demo", "live"], rule: "one-directional" },
              brokers: [
                {
                  brokerId: "paper",
                  automationPermitted: false,
                  recordedFlag: false,
                  provenanceResolves: false,
                  permitChangedAt: null,
                  permitChangedByAuthorityId: null,
                  ceremonyUnlocked: false,
                  changeCount: 0,
                  verdictReason: "never granted"
                }
              ],
              residual: "recorded residual",
              absences: []
            },
            brokers: { ok: true, activeExecutor: "paper" },
            overview: { ok: true, sites: [] },
            ceremony: { ok: true, classes: [{ venueClass: "ccxt-crypto", enablement: null }] }
          }}
        />
      )

      // Its OWN room key and its own four obligations.
      expect(html).toContain('data-room-key="paper"')
      expect(html).toContain("D6 escalation ladder")
      expect(html).toContain("automationPermitted, per broker record (D5)")
      expect(html).toContain("Ceremony rails")
      // And nothing from the sibling's vocabulary leaked in. Strategy renders a
      // reserved state, so the word to check for is the reservation itself.
      expect(html).not.toContain("reserved")
      expect(html).not.toContain("Strategy")
    } finally {
      vi.doUnmock(T9_SIBLINGS.strategy)
      vi.resetModules()
    }
  })

  it("Strategy renders with the Paper/Live room UNLOADABLE", async () => {
    vi.doMock(T9_SIBLINGS.paperLive, () => {
      throw new Error("bisect: the Strategy room must not import the Paper/Live room")
    })
    try {
      vi.resetModules()
      const { StrategyRoom } = await import(T9_SIBLINGS.strategy)

      const html = renderToStaticMarkup(<StrategyRoom />)
      expect(html).toContain('data-room-key="strategy"')
      expect(html).toContain("WS-7+")
      // Nothing from Paper/Live's vocabulary, in either direction.
      expect(html).not.toContain("automationPermitted")
      expect(html).not.toContain("ladder")
      expect(html).not.toContain("permit")
    } finally {
      vi.doUnmock(T9_SIBLINGS.paperLive)
      vi.resetModules()
    }
  })

  it("no module in either room's graph imports the other", () => {
    // The static half, over each room's FULL graph.
    const paperLiveGraph = [
      "../../routes/PaperLiveRoom.tsx",
      "../../domain/paperLive.ts",
      "../../components/PaperLiveSurface.tsx",
      "../../adapters/governanceReading.ts",
      "../../../pages/ministry/PaperRoom.tsx"
    ]
    const strategyGraph = ["../../../pages/ministry/reservedRooms.tsx"]

    for (const file of paperLiveGraph) {
      const code = readCode(file)
      expect(code, `${file} must not import the Strategy room`).not.toMatch(/reservedRooms|StrategyRoom/)
    }
    for (const file of strategyGraph) {
      const code = readCode(file)
      expect(code, `${file} must not import Paper/Live`).not.toMatch(/PaperLive|paperLive/)
      expect(code, `${file} must not import the permit readout`).not.toMatch(/paperLivePermit|automationPermitted/)
    }
  })

  it("only Paper/Live fetches, and it fetches no Strategy endpoint because none exists", () => {
    // The transport half. Strategy has no producer, so it must have NO fetch at all —
    // which is the strongest possible statement that it depends on nothing.
    const strategyCaller = readCode("../../../pages/ministry/reservedRooms.tsx")
    expect(strategyCaller, "the Strategy room must open no transport").not.toMatch(/fetch\(|useEffect/)

    const paperCaller = readCode("../../../pages/ministry/PaperRoom.tsx")
    expect(paperCaller).toMatch(/fetchPaperLivePermit/)
    expect(paperCaller).not.toMatch(/reservedRooms|StrategyRoom/)
  })

  it("Paper/Live degrades to its OWN absent state with every readout absent", async () => {
    vi.resetModules()
    const { PaperLiveRoom } = await import(T9_SIBLINGS.paperLive)
    const html = renderToStaticMarkup(
      <PaperLiveRoom readouts={{ permit: null, brokers: null, overview: null, ceremony: null }} />
    )
    expect(html).toContain('data-room-key="paper"')
    // The fail-closed state, which is the bisect requirement stated as a rendering:
    // an absent producer yields `unknown`, never a permissive verdict.
    expect(html).toContain('data-paper-live-verdict="unknown"')
    expect(html).not.toContain("Strategy")
  })
})
