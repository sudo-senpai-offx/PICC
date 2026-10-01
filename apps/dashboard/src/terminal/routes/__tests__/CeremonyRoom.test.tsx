// @vitest-environment node
// WS-7 T8 room instance 3 of 22 (D1's order): Ceremony.
//
// WHY `node` AND NOT `jsdom`, which every other room test in this directory uses.
//
// This file imports the REAL WS-3 producer. `ceremonyState.mjs:7-9` resolves its
// data directory at module scope with `fileURLToPath(new URL("../data", import.meta.url))`,
// and under jsdom `import.meta.url` is an http:// URL — so the import throws
// "The URL must be of scheme file". That exact failure is documented at
// `testSupport/storeIsolation.mjs:79-83`, where the same constraint forced the
// isolation helper to resolve lazily.
//
// jsdom is not needed here anyway: the room is asserted through
// `renderToStaticMarkup`, which emits a string and requires no DOM. The node
// environment is therefore strictly better for this file — it is the only
// environment in which the assertion can be made against the real store instead
// of a fixture that imitates one, which is the whole point of R1.4 here.
//
// AC-020 for this room: it renders real data with honest provenance, holds no
// reserved placeholder a later task was expected to fill, and its own invariants
// are green. Its D27 obligation is that `CEREMONY_COMPLETION` EXPLICITLY states
// whether the room is genuinely complete or whether scope logically belongs to
// WS-8, naming that scope — asserted here, because a verdict that lives only in
// a markdown file is one nobody re-reads.
//
// R1.4 IS THE HEADLINE, AND IT IS ASSERTED AGAINST THE PRODUCER'S OWN SOURCE.
//
// Spec :384 requires that "ceremony/handshake unlock requirements on the real
// rails are asserted, not assumed". The block below therefore does three things
// a hand-written fixture cannot:
//
//   1. READS `ceremonyState.mjs` and asserts the unlock seam really does refuse
//      outside a test run, with the code the room advertises. If someone deleted
//      that refusal, this test fails — which is what makes "the room cannot
//      render an unlock it has not earned" a fact about the CURRENT producer
//      rather than a promise about a past one.
//   2. RUNS the real `evaluateCeremony` against the real store with an EMPTY
//      store, so the "populated vs empty" answers come from the producer.
//   3. Renders a store whose gates ALL PASS but which holds NO enablement record,
//      and asserts the room still renders "not unlocked". That is the specific
//      fabrication R1.4 forbids, and it is the case a naive implementation gets
//      wrong — inferring the unlock from the gates.
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { CeremonyRoom, CEREMONY_COMPLETION, buildCeremonyView } from "../CeremonyRoom"
import { ceremonyView, CEREMONY_ACTION_UNREACHABLE_CODE } from "../../domain/ceremonyRoom"
import { fetchCeremonyReadout } from "../../adapters/governanceReading"
// The REAL WS-3 producer, imported so this file can drive the actual store rather
// than a fixture. Under vitest the store boots empty: `canTouchDisk()` returns
// true (the isolation harness points PICC_COMMAND_CENTRE_DATA_DIR at a temp
// root) but `ceremony-state.json` does not exist there, so `boot()` takes its
// `emptyStore()` branch. That is what makes the "empty store" case below a REAL
// empty store rather than a hand-written approximation of one.
import { KNOWN_VENUE_CLASSES } from "../../../../server/services/commandCentre/ceremonyState.mjs"
import { evaluateCeremony } from "../../../../server/services/commandCentre/ceremonyGates.mjs"

const PRODUCER_STATE = fileURLToPath(new URL("../../../../server/services/commandCentre/ceremonyState.mjs", import.meta.url))
const PRODUCER_GATES = fileURLToPath(new URL("../../../../server/services/commandCentre/ceremonyGates.mjs", import.meta.url))

describe("WS-7 T8 — Ceremony room: R1.4, asserted against the real rails", () => {
  it("the store's unlock seam really does refuse outside a test run", () => {
    // R1.4's first half, read off the producer rather than assumed. This is what
    // licenses the room to offer no unlock control: if the seam were reachable,
    // the room would be withholding an action the product supports.
    const source = readFileSync(PRODUCER_STATE, "utf8")
    expect(
      source,
      "the room advertises that no ceremony-action route is wired in production. If that is no longer true, " +
        "CEREMONY_NO_UNLOCK_AFFORDANCE_REASON is a false statement and the affordance question must be reopened."
    ).toContain(CEREMONY_ACTION_UNREACHABLE_CODE)
    // The refusal is conditioned on `VITEST !== "true"`, so it is the PRODUCTION
    // rail that refuses. Asserting the literal alone would pass if the guard had
    // been inverted into a test-only refusal.
    expect(source).toMatch(/if\s*\(process\.env\.VITEST\s*!==\s*"true"\)\s*\{/)
  })

  it("the gates really do fail on an empty store, rather than passing vacuously", () => {
    // R1.4's second half. `evaluateCeremony` short-circuits on gate1 and names a
    // `ceremony:deny:*` reason; an empty store therefore yields failing gates. If
    // a future change made an empty store PASS, the room's honest-absence
    // rendering would be wrong and this fails before a reader is misled.
    const gates = readFileSync(PRODUCER_GATES, "utf8")
    expect(gates).toContain("ceremony:deny:gate1-short")
    expect(gates).toMatch(/if\s*\(!g1\.pass\)\s*return finish\(false\)/)
  })

  it("renders an EMPTY store as failing gates and no unlock", () => {
    // The real store, empty: `evaluateCeremony` over a class with no credited
    // rows. Every gate fails with the producer's own reason.
    const classes = KNOWN_VENUE_CLASSES.map((venueClass) => {
      const e = evaluateCeremony(venueClass)
      return {
        venueClass,
        spendableResolved: e.spendableResolved,
        scaleResolved: e.scaleResolved,
        gates: e.gates.map((g) => ({ id: g.id, pass: g.pass === true, reason: g.reason ?? null })),
        enablement: null,
        binaryOptions: false,
        platformVerification: null,
        lastCreditAt: e.lastCreditAt,
        ledgerRunning: true
      }
    })

    const readout = { ok: true, at: "2026-10-01T00:00:00.000Z", scaleMinResolves: 500, scaleEnvError: null, classes }
    const html = renderToStaticMarkup(<CeremonyRoom readout={readout} />)

    // Every known venue class is present — this is the store's real inventory,
    // not a subset chosen for a tidy screenshot.
    for (const venueClass of KNOWN_VENUE_CLASSES) {
      expect(html, `${venueClass} must be rendered`).toContain(`data-venue-class="${venueClass}"`)
    }
    // NOT unlocked, and no unlock anywhere on the page.
    expect(html).not.toContain("UNLOCKED")
    expect(html).toContain('data-unlock="not-unlocked"')
    expect(html).toContain('data-enablement="none"')
    // The producer's own deny reason is rendered verbatim.
    expect(html).toContain("ceremony:deny:gate1-short")
    expect(html).toContain("have 0, require 300")
    // No fabricated zero: the row reports the real count and no pass is claimed.
    expect(html).toContain('data-pass="false"')
  })

  it("does NOT infer an unlock from passing gates — the R1.4 fabrication", () => {
    // The specific failure mode: a store that has satisfied every gate but holds
    // no enablement record. The gates say the requirements are met; the RECORD is
    // what an unlock is. This room reads the record and only the record, so a
    // passing gate set alone renders "not unlocked".
    const readout = {
      ok: true,
      at: "2026-10-01T00:00:00.000Z",
      scaleMinResolves: 500,
      scaleEnvError: null,
      classes: [
        {
          venueClass: KNOWN_VENUE_CLASSES[0],
          spendableResolved: 900,
          scaleResolved: 900,
          gates: [
            { id: "gate1-constitution-300", pass: true, reason: "spendable resolved 900 ≥ 300" },
            { id: "gate2-flip-gate-100", pass: true, reason: "flip gate passes" },
            { id: "gate3-streak-50-ratio", pass: true, reason: "streak ratio 1.0000 ∈ [0.7,1.3]" },
            { id: "gate4-trading-days-30", pass: true, reason: "35 distinct trading days ≥ 30" }
          ],
          // NO enablement record — deliberately.
          enablement: null,
          binaryOptions: false,
          platformVerification: null,
          lastCreditAt: "2026-10-01T00:00:00.000Z",
          ledgerRunning: true
        }
      ]
    }

    const html = renderToStaticMarkup(<CeremonyRoom readout={readout} />)

    // Every gate passed…
    expect(html).toContain('data-gate-passed="4"')
    expect(html).not.toContain('data-pass="false"')
    // …and the room STILL renders not-unlocked, because no record exists.
    expect(html).toContain('data-unlocked="false"')
    expect(html).toContain('data-unlock="not-unlocked"')
    expect(html).not.toContain("UNLOCKED")
    // And it says why, rather than leaving a silent absence.
    expect(html).toContain("No enablement record")
  })

  it("renders an unlock ONLY from a real store record, naming who and when", () => {
    // The positive case. `enablement.unlocked === true` is the producer's own
    // shape, and the room surfaces the record's `at` and `by` so a reader can see
    // the provenance rather than a bare word.
    const readout = {
      ok: true,
      at: "2026-10-01T00:00:00.000Z",
      scaleMinResolves: 500,
      scaleEnvError: null,
      classes: [
        {
          venueClass: KNOWN_VENUE_CLASSES[0],
          spendableResolved: 900,
          scaleResolved: 900,
          gates: [{ id: "gate1-constitution-300", pass: true, reason: "spendable resolved 900 ≥ 300" }],
          enablement: { unlocked: true, at: "2026-09-30T12:00:00.000Z", by: "operator" },
          binaryOptions: false,
          platformVerification: null,
          lastCreditAt: "2026-10-01T00:00:00.000Z",
          ledgerRunning: true
        }
      ]
    }

    const html = renderToStaticMarkup(<CeremonyRoom readout={readout} />)
    expect(html).toContain('data-unlock="unlocked"')
    expect(html).toContain("UNLOCKED")
    expect(html).toContain('data-enablement-at="2026-09-30T12:00:00.000Z"')
    expect(html).toContain('data-enablement-by="operator"')
  })

  it("an enablement object WITHOUT unlocked:true is not an unlock", () => {
    // An object that merely EXISTS is not an unlock. `projectEnablement` requires
    // the flag, so a shape drift that dropped it renders as an absence instead of
    // as a silently-granted permission.
    const readout = {
      ok: true,
      at: "2026-10-01T00:00:00.000Z",
      scaleMinResolves: 500,
      scaleEnvError: null,
      classes: [
        {
          venueClass: KNOWN_VENUE_CLASSES[0],
          spendableResolved: 0,
          scaleResolved: 0,
          gates: [],
          enablement: { at: "2026-09-30T12:00:00.000Z", by: "operator" } as never,
          binaryOptions: false,
          platformVerification: null,
          lastCreditAt: null,
          ledgerRunning: true
        }
      ]
    }
    const view = buildCeremonyView({ readout })
    expect(view.classes[0].unlocked).toBe(false)
    expect(view.classes[0].enablement).toBeNull()
  })

  it("renders a POPULATED store with its real counts and per-gate reasons", () => {
    const readout = {
      ok: true,
      at: "2026-10-01T00:00:00.000Z",
      scaleMinResolves: 500,
      scaleEnvError: null,
      classes: [
        {
          venueClass: KNOWN_VENUE_CLASSES[0],
          spendableResolved: 312,
          scaleResolved: 312,
          gates: [
            { id: "gate1-constitution-300", pass: true, reason: "spendable resolved 312 ≥ 300 (PICC_CEREMONY_GATE1_MIN_RESOLVES)" },
            { id: "gate2-flip-gate-100", pass: false, reason: "ceremony:deny:flip-unmet (legacy has 60 trades, need 100)" }
          ],
          enablement: null,
          binaryOptions: false,
          platformVerification: null,
          lastCreditAt: "2026-10-01T00:00:00.000Z",
          ledgerRunning: true
        }
      ]
    }
    const html = renderToStaticMarkup(<CeremonyRoom readout={readout} />)

    // The room shows the STORE'S number, not a rounded or recomputed one.
    expect(html).toContain('data-spendable-resolved="312"')
    // Both gates rendered with the producer's own reasons, one passing and one
    // denied — the partial state is the common state and must read as partial.
    expect(html).toContain('data-gate="gate1-constitution-300" data-pass="true"')
    expect(html).toContain('data-gate="gate2-flip-gate-100" data-pass="false"')
    // The deny reason is rendered VERBATIM, which is the honesty contract: the
    // room does not summarise "not satisfied" into its own words.
    expect(html).toContain("ceremony:deny:flip-unmet (legacy has 60 trades, need 100)")
    // And the whole reason string survives React's escaping unchanged, so the
    // reader sees what the producer said rather than a truncated paraphrase.
    expect(html).toContain("spendable resolved 312 ≥ 300 (PICC_CEREMONY_GATE1_MIN_RESOLVES)")
  })
})

describe("WS-7 T8 — Ceremony room: honesty and the D27 verdict", () => {
  it("labels the readout's ok as 'the readout ran', never as a pass", () => {
    // `ok: true` from the route means the READOUT EXECUTED — an unhealthy store
    // still answers ok with every gate naming `ceremony:deny:store-unhealthy`.
    // A reader who took it as "the ceremony is fine" would be wrong exactly when
    // the store is broken, so the surface labels it narrowly.
    const html = renderToStaticMarkup(
      <CeremonyRoom readout={{ ok: true, at: "2026-10-01T00:00:00.000Z", scaleMinResolves: 500, scaleEnvError: null, classes: [] }} />
    )
    expect(html).toContain("Readout executed")
    expect(html).toContain("not a claim that any gate passed")
  })

  it("renders an absent readout as a named absence claiming nothing about the store", () => {
    const html = renderToStaticMarkup(<CeremonyRoom readout={null} />)
    expect(html).toContain('data-readout-executed="false"')
    expect(html).toContain('data-ceremony-readout="absent"')
    expect(html).toContain("Nothing here is a statement about the store")
    // Zero rows, and no class claimed.
    expect(html).toContain('data-class-rows="0"')
    expect(html).not.toContain("data-venue-class=")
  })

  it("renders an unreachable store honestly: an unhealthy store still names its denies", () => {
    // The route answers 200 with all gates failing when the store is unhealthy —
    // by design, never a hard 500 and never a silent pass. The room must show
    // those named denies rather than collapsing them into "unavailable".
    const readout = {
      ok: true,
      at: "2026-10-01T00:00:00.000Z",
      scaleMinResolves: 500,
      scaleEnvError: null,
      classes: [
        {
          venueClass: KNOWN_VENUE_CLASSES[0],
          spendableResolved: null,
          scaleResolved: null,
          gates: KNOWN_VENUE_CLASSES.map(() => ({
            id: "gate1-constitution-300",
            pass: false,
            reason: "ceremony:deny:store-unhealthy"
          })),
          enablement: null,
          binaryOptions: false,
          platformVerification: null,
          lastCreditAt: null,
          ledgerRunning: true
        }
      ]
    }
    const html = renderToStaticMarkup(<CeremonyRoom readout={readout} />)
    expect(html).toContain("ceremony:deny:store-unhealthy")
    expect(html).toContain('data-spendable-resolved="unavailable"')
  })

  it("surfaces a platform-verification record as recorded, and its absence as an absence", () => {
    const withRecord = renderToStaticMarkup(
      <CeremonyRoom
        readout={{
          ok: true,
          at: "2026-10-01T00:00:00.000Z",
          scaleMinResolves: 500,
          scaleEnvError: null,
          classes: [
            {
              venueClass: KNOWN_VENUE_CLASSES[0],
              spendableResolved: 0,
              scaleResolved: 0,
              gates: [],
              enablement: null,
              binaryOptions: false,
              platformVerification: {
                verified: true,
                at: "2026-09-30T12:00:00.000Z",
                by: "operator",
                regulator: "the regulator recorded at the time",
                payoutFloorPct: 92,
                withdrawalTested: true
              },
              lastCreditAt: null,
              ledgerRunning: true
            }
          ]
        }}
      />
    )
    // A verification is rendered as PICC's own record with its provenance, not as
    // PICC making a licensing claim about a third party — the D26 line. It says
    // "recorded", names who recorded it and when, and prints the regulator
    // verbatim as stored.
    expect(withRecord).toContain('data-platform-verified="true"')
    expect(withRecord).toContain('data-payout-floor="92"')
    expect(withRecord).toContain('data-withdrawal-tested="true"')
    expect(withRecord).toContain("regulator recorded as the regulator recorded at the time")

    const withoutRecord = renderToStaticMarkup(
      <CeremonyRoom
        readout={{
          ok: true,
          at: "2026-10-01T00:00:00.000Z",
          scaleMinResolves: 500,
          scaleEnvError: null,
          classes: [
            {
              venueClass: KNOWN_VENUE_CLASSES[0],
              spendableResolved: 0,
              scaleResolved: 0,
              gates: [],
              enablement: null,
              binaryOptions: false,
              platformVerification: null,
              lastCreditAt: null,
              ledgerRunning: true
            }
          ]
        }}
      />
    )
    expect(withoutRecord).toContain('data-platform-verified="false"')
    expect(withoutRecord).toContain("not a statement that the venue is unsafe")
  })

  it("the REAL adapter turns a 401 into an absence, not into an unlock", async () => {
    // The transport seam, driven through `fetchCeremonyReadout` itself with the
    // fetch injected. A 401 is the gate's answer; treating it as anything other
    // than an absence would render the store's contents to an anonymous caller,
    // which is precisely the disclosure the gate exists to prevent.
    const refused = await fetchCeremonyReadout({
      fetchImpl: (async () => new Response(JSON.stringify({ error: "authentication required" }), { status: 401 })) as never
    })
    expect(refused.readout).toBeNull()
    expect(refused.error).toContain("401")

    // And the room renders that absence without claiming anything about a venue.
    const view = ceremonyView(refused.readout)
    expect(view.complete).toBe(false)
    expect(view.classes).toEqual([])
  })

  it("the REAL adapter passes a route-shaped body through to the projection", async () => {
    // The other half of the seam: a 200 whose body is projected by the same code
    // the page caller uses. The body below is in the route's own shape
    // (`handlers.mjs:1868-1909`) with the empty store's real deny reason.
    const { readout } = await fetchCeremonyReadout({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            ok: true,
            at: "2026-10-01T00:00:00.000Z",
            scaleMinResolves: 500,
            scaleEnvError: null,
            classes: [
              {
                venueClass: KNOWN_VENUE_CLASSES[0],
                spendableResolved: 0,
                scaleResolved: 0,
                gates: [{ id: "gate1-constitution-300", pass: false, reason: "ceremony:deny:gate1-short (have 0, require 300)" }],
                enablement: null,
                binaryOptions: false,
                platformVerification: null,
                lastCreditAt: null,
                ledgerRunning: true
              }
            ]
          }),
          { status: 200 }
        )) as never
    })

    const view = ceremonyView(readout)
    expect(view.readoutExecuted).toBe(true)
    expect(view.classes).toHaveLength(1)
    expect(view.classes[0].unlocked).toBe(false)
    expect(view.classes[0].gates[0].reason).toContain("ceremony:deny:gate1-short")
  })

  it("the D27 verdict is present, names its boundary, and leaves ws8Handoff null", () => {
    // AC-020's verification is "the completion record contains an explicit
    // completeness verdict". D27 adds that a `complete` verdict with an UNNAMED
    // boundary is a defect, so the record must carry prose, not just a flag.
    expect(CEREMONY_COMPLETION.room).toBe("ceremony")
    expect(CEREMONY_COMPLETION.d1Order).toBe(3)
    expect(CEREMONY_COMPLETION.verdict).toBe("complete")
    // `null` is correct HERE and is asserted as a present key: the brief requires
    // a present `null` if complete, not an absent field.
    expect(CEREMONY_COMPLETION).toHaveProperty("ws8Handoff")
    expect(CEREMONY_COMPLETION.ws8Handoff).toBeNull()
    expect(CEREMONY_COMPLETION.reason.length).toBeGreaterThan(200)
    // The verdict must be explicit about the one runtime absence, and about which
    // task owns what — otherwise an unflagged trim is exactly what this reads as.
    expect(CEREMONY_COMPLETION.reason).toMatch(/No scope in this room logically belongs to WS-8/)
    expect(CEREMONY_COMPLETION.reason).toMatch(/ceremonyState\.mjs/)
  })
})
