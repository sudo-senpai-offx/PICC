/**
 * WS-7 T10 — the shared read-only room contract: NINE keys, SIXTEEN instances.
 *
 * ===========================================================================
 * WHY ONE MODULE AND NOT SIXTEEN COMPONENTS
 * ===========================================================================
 *
 * `MinistryRoom.tsx:18-62` declares 22 route instances across 15 room keys. T7
 * took two (`markets`, `risk`), T8 two (`ceremony`, `ministry`), T9 two
 * (`strategy`, `paper`). What is left is SIXTEEN instances across NINE distinct
 * keys:
 *
 *     dashboard  3   autopilot  1
 *     settings   3   command-centre  1
 *     studio     3   dispatch  1
 *     simulator  2   governor  1
 *                     guidance  1
 *
 * Sixteen room components would be sixteen copies of ONE shape, and two copies of
 * a shape drift — which is exactly what the WS-7 plan's Risk 6 names, and what
 * the duplication this task was briefed about is guarding. So the read-only
 * guarantee, the absence vocabulary and the verdict vocabulary live HERE, once,
 * and every instance is a row of data against it.
 *
 * ===========================================================================
 * THE TWO REQUIREMENTS AT `:1287`, AND HOW EACH IS MADE UNFORGETTABLE
 * ===========================================================================
 *
 * "UNAVAILABLE IS UNAVAILABLE, NOT ZERO" is enforced at the TYPE level, not by
 * convention:
 *
 *   - `ReadOnlyFact.observed` is `boolean | null`, and `null` means NOT OBSERVED.
 *     That is T16's `authorityById(authorities, "WS-7+") === null` precedent: an
 *     absence is a DISTINGUISHABLE STATE, not a default value. `false` means
 *     "observed, and it is false"; `null` means "nobody asked".
 *   - `ReadOnlyFact.value` is `string | null`, NEVER a number. A projection
 *     therefore CANNOT put a fabricated `0` in a fact — there is nowhere to put
 *     one. This is stronger than a test that greps for `0`: it is a type the
 *     compiler checks.
 *   - The section keeps `readoutObtained` separate from its facts, so "the
 *     producer was reached and found nothing" (`readoutObtained: true`, empty
 *     collection) is a different fact from "the producer was unreachable"
 *     (`readoutObtained: false`). Collapsing those two is how a room asserts a
 *     count it never read.
 *
 * "READ-ONLY ROOMS NEVER ACQUIRE A WRITE AFFORDANCE" is enforced three ways:
 *   - `READ_ONLY_INTERACTIVE_AFFORDANCES` is exported EMPTY FROZEN DATA, because
 *     a comment saying "no affordances here" cannot fail a test.
 *   - `READ_ONLY_VERDICTS` has no permissive member. These rooms assert nothing
 *     permissive, so there is no member meaning "ready" to be misused.
 *   - The test ENUMERATES the rendered markup for interactive elements rather
 *     than checking one known-bad control is absent — checking for a named
 *     control passes on a control nobody thought of.
 *
 * A NOTE ON WHAT "READ-ONLY" DOES AND DOES NOT MEAN HERE, because it is the one
 * place this task could have lied. Seven of the sixteen instances ALREADY carry
 * write affordances in their legacy page composition — "Create payment link",
 * "Run research crew", `markDispatchRead`, `UnlockCeremony`, and so on — all of
 * which pre-date WS-7. D1's order calls these the "read-only rooms", which is a
 * statement about what WS-7 BUILDS FOR THEM (a display surface and a verdict),
 * not a claim that the shipped pages are inert. This module contributes no write
 * path; the pre-existing ones are named per instance in
 * `readOnlyRoomCompletions.ts` rather than silently removed (removing product
 * functionality is a product decision, exactly as inventing the Strategy room's
 * producer was — see `reservedRooms.tsx`), and rather than silently denied.
 *
 * PURE. No clock, no transport, no credential. Every value is copied from a
 * response and formatted to text here, so a rendered room is reproducible.
 */

/* ==========================================================================
   THE CONTRACT
   ========================================================================== */

/**
 * D10's reservation, not a task name. AC-042 requires the literal `WS-7+` for an
 * unowned capability, and T9 made this exact correction to Strategy: a task id is
 * a schedule, not an owner, and a reader seeing "WS-7 T10" could reasonably
 * conclude someone was building it. T10 finished and did not, so `WS-7+` is the
 * honest owner of whatever remains unclaimed.
 */
export const READ_ONLY_OWNER = "WS-7+"

/**
 * What a read-only room can conclude about its own observation.
 *
 * DELIBERATELY CLOSED AT THREE, and none of them means "ready", "available",
 * "connected", "healthy" or "complete". A read-only room observes; it does not
 * assert that something is in a good state, so a permissive member would be a
 * member with no honest producer. The test enumerates these against the type's
 * own declared values, so widening the vocabulary is a deliberate act with a red
 * test — the same device T9 used on `PaperLiveVerdict`.
 */
export type ReadOnlyVerdict = "observed" | "partially-observed" | "unobserved"

export const READ_ONLY_VERDICTS: readonly ReadOnlyVerdict[] = Object.freeze([
  "observed",
  "partially-observed",
  "unobserved"
] as const)

/**
 * ONE named observation about ONE producer.
 *
 * `observed: null` is the absence carrier and is the whole of `:1287`'s second
 * clause. `value: string | null` is the guarantee: a fact has nowhere to put a
 * `0`, so "unavailable rendered as zero" is not a convention this module follows,
 * it is a shape this module cannot express.
 */
export type ReadOnlyFact = {
  /** What was looked at, named. */
  fact: string
  /** `true`/`false` = observed. `null` = NOT OBSERVED. Never collapsed to `false`. */
  observed: boolean | null
  /** The producer's own value, as text. `null` whenever `observed` is `null`. */
  value: string | null
}

/** A named absence with a reason and an owner. Never a task id (AC-042). */
export type ReadOnlyAbsence = {
  what: string
  detail: string
  owner: string
}

/** ONE producer, as ONE section of a read-only room. */
export type ReadOnlySection = {
  /** The readout id this section is fed by. Stable, and the instance's own. */
  id: string
  title: string
  /**
   * The route this section's facts came from — ALWAYS present, including when the
   * readout was not obtained. Provenance is part of honesty: a reader must be
   * able to check where a claim came from, and an absent producer is still a
   * producer with an address.
   */
  route: string
  /**
   * Whether the producer was REACHED. Distinct from whether it had anything to
   * say: `true` with no facts is a producer that ran and found nothing, which is
   * not the same fact as `false`.
   */
  readoutObtained: boolean
  /** The producer's own refusal/error text, when it sent one. Copied, not summarised. */
  producerError: string | null
  /** Named when `readoutObtained` is false. `null` when it is true. */
  absence: ReadOnlyAbsence | null
  /**
   * Absences that hold even when the producer DOES answer — the trading
   * simulator's twin is the case, because it has no read route at all. Kept
   * separate from `absence` so a transient failure and a permanent structural
   * gap are not reported in the same voice.
   */
  permanentAbsences: readonly ReadOnlyAbsence[]
  facts: readonly ReadOnlyFact[]
}

export type ReadOnlyRoomKey =
  | "dashboard"
  | "settings"
  | "studio"
  | "simulator"
  | "autopilot"
  | "command-centre"
  | "dispatch"
  | "governor"
  | "guidance"

export type ReadOnlySuiteId = "trading" | "earnings" | "intelligence"

/** The nine distinct keys the sixteen instances collapse to. */
export const READ_ONLY_ROOM_KEYS: readonly ReadOnlyRoomKey[] = Object.freeze([
  "autopilot",
  "command-centre",
  "dashboard",
  "dispatch",
  "governor",
  "guidance",
  "settings",
  "simulator",
  "studio"
] as const)

export type ReadOnlyRoomView = {
  key: ReadOnlyRoomKey
  suite: ReadOnlySuiteId
  title: string
  capabilityLabel: string
  verdict: ReadOnlyVerdict
  /** The one-line sentence the surface shows. Never "everything is fine". */
  verdictReason: string
  sections: readonly ReadOnlySection[]
  /** Every absence across every section, flattened. Empty only when nothing is absent. */
  absences: readonly ReadOnlyAbsence[]
  affordances: readonly { id: string; whyPermitted: string }[]
  affordanceReason: string
  /** True only when every declared section's producer was reached. */
  complete: boolean
}

/* ==========================================================================
   THE AFFORDANCE AUDIT
   ========================================================================== */

/**
 * EVERY interactive control this room's own surface can render: NONE.
 *
 * Exported as frozen EMPTY data rather than asserted in a comment, because a
 * comment cannot fail a test. `ReadOnlyRoom.test.tsx` asserts this is empty AND
 * independently enumerates the rendered markup for every interactive element, so
 * neither this list nor the markup can drift without a red test.
 *
 * WHY THE CEILING IS ZERO, in the terms T9 already established for the
 * Paper/Live room, which this extends rather than restates:
 *
 *  - These rooms ASSERT OBSERVATION. They compute no tier, no threshold, no gate
 *    and no permit, so there is nothing here whose result a control could change.
 *    A control on a display surface is a control over the display, which is
 *    either cosmetic or a lie.
 *  - Every real action in these nine rooms belongs to a producer that already has
 *    its own gated route and its own owner — `POST /api/trading/autopilot/start`
 *    and `/stop` are the sharpest case, because both already refuse with HTTP 410
 *    and the body "order execution removed — PICC is advisory-first"
 *    (handlers.mjs:3068-3076). A room offering a control whose route refuses
 *    would be inviting an operator to press a button that cannot work.
 *  - D19's outcome (B) is the same reasoning T9 applied: an amended claim about
 *    rails that exist is not an authorisation to offer a control that advances
 *    execution to them. These rooms do not even claim a rail.
 */
export const READ_ONLY_INTERACTIVE_AFFORDANCES: readonly { id: string; whyPermitted: string }[] =
  Object.freeze([])

/** Why the ceiling is zero, in words a reader of the room can be shown. */
export const READ_ONLY_AFFORDANCE_REASON =
  "This room exposes no interactive control, and the ceiling is zero rather than incidental. These nine rooms assert " +
  "observation, not permission: none of them computes a tier, a threshold, a gate or a permit, so there is nothing here " +
  "whose result a control could change — a control on a display surface is either cosmetic or a lie. Every real action " +
  "behind this surface belongs to a producer that already has its own auth-gated route and its own owner, and the " +
  "sharpest case proves it: POST /api/trading/autopilot/start and /stop already refuse with HTTP 410 and the body " +
  "\"order execution removed — PICC is advisory-first\" (handlers.mjs:3068-3076), so a start/stop control in this room " +
  "would invite an operator to press a button that cannot succeed. This is D19's outcome (B) applied to display: an " +
  "amended claim about rails that exist does not authorise a control that advances execution to them, and these rooms " +
  "do not claim a rail at all. Write affordances that pre-date WS-7 in these rooms' page compositions are not removed " +
  "here — they are named per instance in the completion record, because removing shipped product functionality is a " +
  "product decision and this task must not take it silently."

/* ==========================================================================
   THE NINE KEYS' SECTIONS — one entry per (key, producer)
   ========================================================================== */

type SectionSpec = {
  id: string
  title: string
  route: string
  /** Which suites instantiate this section. Absent means all three. */
  suites?: readonly ReadOnlySuiteId[]
  /** Reads this producer's own response into named facts. Must not fabricate. */
  project: (readout: unknown) => { facts: ReadOnlyFact[]; absences?: ReadOnlyAbsence[] }
  /** Shown when the producer could not be reached. */
  absentWhat: string
  absentDetail: string
}

const OWNED = READ_ONLY_OWNER

/* ---------------------------------------------------------------- helpers */

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** A fact that was NOT observed. The only shape an absent producer produces. */
function unobserved(fact: string): ReadOnlyFact {
  return { fact, observed: null, value: null }
}

function observed(fact: string, value: unknown, note?: string): ReadOnlyFact {
  if (value === null || value === undefined) return unobserved(fact)
  const text = typeof value === "string" ? value : String(value)
  return { fact, observed: true, value: note ? `${text} — ${note}` : text }
}

/** A boolean fact. `false` is an OBSERVED false; absence stays `null`. */
function observedBool(fact: string, value: unknown, absentLabel: string): ReadOnlyFact {
  if (typeof value !== "boolean") return unobserved(fact)
  return { fact, observed: true, value: value ? "yes" : absentLabel }
}

/** Counts read from a collection, with the collection's absence kept distinct. */
function counted(items: unknown, noun: string): ReadOnlyFact {
  if (!Array.isArray(items)) return unobserved(`${noun} recorded`)
  return {
    fact: `${noun} recorded`,
    observed: true,
    // A genuinely empty collection is a REAL zero and says so: "0 recorded" is a
    // fact the producer stated. The failure this guards is a zero for a producer
    // that was never reached, which reaches `unobserved` instead.
    value: `${items.length} recorded`
  }
}

function objectCount(value: unknown, noun: string): ReadOnlyFact {
  if (!isObject(value)) return unobserved(`${noun} reported`)
  return { fact: `${noun} reported`, observed: true, value: `${Object.keys(value).length} reported` }
}

/** The producer's own error string, copied verbatim when it sent one. */
function producerErrorOf(readout: unknown): string | null {
  if (!isObject(readout)) return null
  if (typeof readout.error === "string" && readout.error.trim().length > 0) return readout.error
  return null
}

/* --------------------------------------------------------- the nine keys */

/**
 * `dashboard` — the copilot loop band, per suite.
 *
 * The trading instance reads the trading status producer; the earnings and
 * intelligence instances read the health producer, which is the one that reports
 * providers and the agents service. `trading/dashboard`'s legacy page renders
 * `status?.riskPerTradePct ?? 2` (`DashboardRoom.tsx:40`) — an absent producer
 * rendered as a believable 2%. The `riskPerTradePct` fact below exists to show
 * that shape refusing to happen: absent yields `observed: null, value: null`, and
 * the legacy default is recorded as a finding rather than inherited.
 */
const DASHBOARD_SECTIONS: SectionSpec[] = [
  {
    id: "trading-status",
    title: "Trading status",
    route: "/api/trading/status",
    suites: ["trading"],
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      return {
        facts: [
          isObject(readout.paper)
            ? counted(readout.paper.positions, "Open paper positions")
            : unobserved("Paper overview"),
          observed("Risk per trade (%)", readout.riskPerTradePct),
          observed("Autopilot demo account", readout.demo === null ? "absent" : "present")
        ]
      }
    },
    absentWhat: "TRADING STATUS PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/trading/status did not answer, so this room knows nothing about the trading status band. Nothing is " +
      "shown for it: in particular the risk-per-trade figure is NOT defaulted to the 2% the legacy page used, because a " +
      "plausible default for an unobserved risk number is the exact zero-fill this room exists to refuse."
  },
  {
    id: "health",
    title: "Service health",
    route: "/api/health",
    suites: ["earnings", "intelligence"],
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      return {
        facts: [
          observed("PICC version", readout.version),
          objectCount(readout.providers, "Payment providers configured"),
          agentsFact(readout.agents)
        ]
      }
    },
    absentWhat: "SERVICE HEALTH PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/health did not answer. The dashboard therefore reports nothing about the version, the configured " +
      "payment providers, or the agents service — rather than reporting them as zero, which would be a claim nobody made."
  }
]

/**
 * `settings` — configuration readout, per suite.
 *
 * The trading instance reads the LLM settings view and the integrations list; the
 * earnings instance reads the health producer's provider configuration, which is
 * what its payment channels are actually configured from; the intelligence
 * instance reads the agents settings proxy.
 */
const SETTINGS_SECTIONS: SectionSpec[] = [
  {
    id: "llm-settings",
    title: "LLM provider configuration",
    route: "/api/settings/llm",
    suites: ["trading"],
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      const providers = readout.providers ?? readout.settings
      return {
        facts: [
          Array.isArray(providers)
            ? counted(providers, "LLM providers configured")
            : objectCount(providers, "LLM provider settings reported")
        ]
      }
    },
    absentWhat: "LLM SETTINGS PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/settings/llm did not answer. No statement is made about which model providers are configured — in " +
      "particular it is NOT reported as none configured, which would be indistinguishable from an operator who has " +
      "configured nothing."
  },
  {
    id: "integrations",
    title: "Data-source integrations",
    route: "/api/integrations",
    suites: ["trading"],
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      const list = Array.isArray(readout.integrations) ? readout.integrations : null
      return {
        facts: list
          ? [
              counted(list, "Integrations listed"),
              counted(
                list.filter((i) => isObject(i) && i.state === "connected"),
                "Integrations connected"
              )
            ]
          : [unobserved("Integrations listed")]
      }
    },
    absentWhat: "INTEGRATIONS PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/integrations did not answer. The room reports no integration count at all, rather than reporting zero " +
      "integrations — a zero here would read as a product with no data sources, which is a different and false claim."
  },
  {
    id: "health",
    title: "Payment channel configuration",
    route: "/api/health",
    suites: ["earnings"],
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      return { facts: [objectCount(readout.providers, "Payment channels configured")] }
    },
    absentWhat: "PAYMENT CHANNEL PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/health did not answer, so no payment channel is reported as configured and none is reported as " +
      "unconfigured. The distinction matters commercially: a buyer cannot be told a channel is not configured when the " +
      "answer was never obtained."
  },
  {
    id: "agents-settings",
    title: "Agents service configuration",
    route: "/api/agents/settings",
    suites: ["intelligence"],
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      const settings = isObject(readout.settings) ? readout.settings : null
      if (settings === null) return { facts: [unobserved("Agents settings reported")] }
      return { facts: [objectCount(settings, "Agents settings reported")] }
    },
    absentWhat: "AGENTS SETTINGS PRODUCER REFUSED",
    absentDetail:
      "GET /api/agents/settings returns HTTP 503 with an error when PICC_AGENTS_URL is unset (handlers.mjs:5061-5062). " +
      "That is an ABSENCE — the settings were never read — so the room renders the refusal and its own text, and does " +
      "not render an empty settings object that would read as an agents service configured with nothing in it."
  }
]

/** `studio` — the browser studio's own status, for all three suites at once. */
const STUDIO_SECTIONS: SectionSpec[] = [
  {
    id: "browser-status",
    title: "Browser studio status",
    route: "/api/browser/status",
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      return {
        facts: [
          observedBool("Studio runtime available", readout.available, "no"),
          observedBool("A studio session is open", readout.running, "no"),
          observed("Saved sites in the vault", readout.vaultSites)
        ]
      }
    },
    absentWhat: "BROWSER STUDIO PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/browser/status did not answer. The studio room reports no runtime availability, no open session and no " +
      "vault size. It does not report 'no studio available': not knowing is not the same as knowing there is none."
  }
]

/** `simulator` — sandbox/model outputs. Note the trading twin has NO read producer. */
const SIMULATOR_SECTIONS: SectionSpec[] = [
  {
    id: "streams",
    title: "Income streams modelled",
    route: "/api/streams/snapshot",
    suites: ["earnings"],
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      return {
        facts: [
          counted(readout.streams, "Income streams"),
          counted(readout.earnings, "Earnings observations")
        ]
      }
    },
    absentWhat: "STREAM SNAPSHOT PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/streams/snapshot did not answer, so no stream or earnings count is reported. Zero is not substituted: a " +
      "room reporting 0 earnings would be indistinguishable from a room reporting an unproductive month."
  },
  {
    id: "twin-run",
    title: "Financial Twin runs",
    route: "/api/twin/run",
    suites: ["trading"],
    project: () => ({
      facts: [unobserved("Financial Twin run history")],
      absences: [
        {
          what: "NO READ-ONLY PRODUCER FOR THE FINANCIAL TWIN",
          detail:
            "The trading Simulator room's only producer, POST /api/twin/run (handlers.mjs:1335), is WRITE-ONLY: there is " +
            "no GET twin route and no run store, so a twin result cannot be read back. A read-only room cannot display a " +
            "run it cannot fetch, so this section reports the absence permanently rather than inventing a run history. " +
            "Note this is NOT the same as 'the twin has never run' — it is 'no run can be read'. Adding a GET twin route " +
            "would also be a second surface over a store whose only lifecycle is the write, so it is not this task's to add.",
          owner: OWNED
        }
      ]
    }),
    absentWhat: "FINANCIAL TWIN HAS NO READ-ONLY PRODUCER",
    absentDetail:
      "There is no route that returns a Financial Twin result. The twin's only endpoint runs a simulation and returns it " +
      "to that caller, so there is nothing here to read and nothing to render. The room says so, permanently, instead of " +
      "rendering an empty twin panel that would read as 'not run yet'."
  }
]

/** `autopilot` — the demo engine's own config and decision log. */
const AUTOPILOT_SECTIONS: SectionSpec[] = [
  {
    id: "autopilot-config",
    title: "Autopilot configuration",
    route: "/api/trading/autopilot",
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      const config = isObject(readout.config) ? readout.config : null
      if (config === null) return { facts: [unobserved("Autopilot configuration reported")] }
      return {
        facts: [
          observedBool("Autopilot enabled", config.enabled, "no"),
          counted(config.assets, "Assets in autopilot scope")
        ]
      }
    },
    absentWhat: "AUTOPILOT CONFIG PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/trading/autopilot did not answer, so neither the enabled state nor the scope is reported. The room " +
      "does not report the autopilot as disabled: `POST /api/trading/autopilot/start` already refuses with HTTP 410 " +
      "(handlers.mjs:3068-3070), so this room has nothing to enable and must not imply an off switch that matters."
  },
  {
    id: "autopilot-decisions",
    title: "Autopilot decision log",
    route: "/api/trading/autopilot/decisions",
    project: (readout) => {
      const decisions = Array.isArray(readout)
        ? readout
        : isObject(readout) && Array.isArray(readout.decisions)
          ? readout.decisions
          : null
      if (decisions === null) return { facts: [] }
      return { facts: [counted(decisions, "Decisions recorded")] }
    },
    absentWhat: "AUTOPILOT DECISION LOG UNREACHABLE",
    absentDetail:
      "GET /api/trading/autopilot/decisions did not answer. No decision count is reported — and specifically not zero, " +
      "which is the state `AutopilotRoom.tsx:161` already renders honestly as 'no decisions recorded yet' and which this " +
      "room therefore distinguishes from 'the log could not be read'."
  }
]

/** `command-centre` — the site gate set and the signal list. */
const COMMAND_CENTRE_SECTIONS: SectionSpec[] = [
  {
    id: "command-centre-overview",
    title: "Venue sites and gates",
    route: "/api/command-centre/overview",
    project: (readout) => {
      if (!isObject(readout) || !Array.isArray(readout.sites)) return { facts: [] }
      const sites = readout.sites.filter(isObject)
      return {
        facts: [
          counted(readout.sites, "Venue sites"),
          counted(
            sites.flatMap((s) => (Array.isArray(s.gates) ? s.gates : [])).filter(isObject),
            "Gates evaluated"
          )
        ]
      }
    },
    absentWhat: "COMMAND CENTRE OVERVIEW UNREACHABLE",
    absentDetail:
      "GET /api/command-centre/overview did not answer. This is the same producer T9's Paper/Live room reads for its " +
      "consent rails, so its absence here is reported the same way — as an unobserved rail set, not as zero gates."
  },
  {
    id: "signals",
    title: "Trading signals",
    route: "/api/trading/signals",
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      return { facts: [counted(readout.signals, "Signals listed")] }
    },
    absentWhat: "SIGNALS PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/trading/signals did not answer, so no signal count is reported. `CommandCentreRoom.tsx:13` initialises " +
      "its signal state to `[]`, which is indistinguishable from a producer that ran and found none; this section keeps " +
      "the two apart."
  }
]

/** `dispatch` — the notification inbox. */
const DISPATCH_SECTIONS: SectionSpec[] = [
  {
    id: "dispatch",
    title: "Dispatch inbox",
    route: "/api/trading/dispatch",
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      return {
        facts: [counted(readout.entries, "Dispatch entries"), observed("Unread entries", readout.unread)]
      }
    },
    absentWhat: "DISPATCH PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/trading/dispatch did not answer, so neither the entry count nor the unread count is reported. The " +
      "unread badge in the suite header (DispatchBell.tsx:8) reads `?? null` and hides itself in this case; this section " +
      "names the absence instead of leaving only a hidden badge."
  }
]

/** `governor` — the agents service's own configuration, which is what governs the crew. */
const GOVERNOR_SECTIONS: SectionSpec[] = [
  {
    id: "agents-settings",
    title: "Agent crew configuration",
    route: "/api/agents/settings",
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      const settings = isObject(readout.settings) ? readout.settings : null
      if (settings === null) return { facts: [unobserved("Crew settings reported")] }
      return {
        facts: [
          objectCount(settings, "Crew settings reported"),
          counted(settings.models, "Models selectable")
        ]
      }
    },
    absentWhat: "GOVERNOR HAS NO REACHABLE PRODUCER",
    absentDetail:
      "GET /api/agents/settings returns HTTP 503 with an error whenever PICC_AGENTS_URL is unset (handlers.mjs:5061-5062) " +
      "— which is the default state of a fresh checkout. The Governor room therefore reports no crew configuration, no " +
      "model count and no governance thresholds, and names the reason. It does NOT report 0 models, which would read as " +
      "a governed crew with nothing to govern."
  },
  {
    id: "health",
    title: "Agents service reachability",
    route: "/api/health",
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      return { facts: [agentsFact(readout.agents)] }
    },
    absentWhat: "AGENTS REACHABILITY UNREACHABLE",
    absentDetail:
      "GET /api/health did not answer, so the agents service's reachability is unknown. This room distinguishes three " +
      "states — not configured, configured but unreachable, reachable — and none of them is rendered as zero."
  }
]

/** `guidance` — the crew's own advice, and whether it can be asked. */
const GUIDANCE_SECTIONS: SectionSpec[] = [
  {
    id: "health",
    title: "Crew availability",
    route: "/api/health",
    project: (readout) => {
      if (!isObject(readout)) return { facts: [] }
      return { facts: [agentsFact(readout.agents)] }
    },
    absentWhat: "CREW AVAILABILITY PRODUCER UNREACHABLE",
    absentDetail:
      "GET /api/health did not answer, so the crew's availability is unknown rather than offline."
  }
]

/* -------------------------------------------------------------------------- */

/**
 * The agents fact, which carries THREE distinguishable states.
 *
 * `/api/health` sends `agents: null` when `PICC_AGENTS_URL` is unset
 * (handlers.mjs:1321-1330) — the crew was never configured. When it IS set, the
 * route attempts the call and sends `{ url, ok: false }` when it fails — the crew
 * is configured and unreachable. And `{ ok: true }` — reachable.
 *
 * Collapsing the first into the second would tell an operator their configured
 * crew is broken when it was never installed, and collapsing either into a count
 * of zero offline agents would be the zero-fill. All three are named, and the
 * first two are distinguishable in the markup, which the test asserts by rendering
 * both and comparing.
 */
function agentsFact(agents: unknown): ReadOnlyFact {
  if (agents === null || agents === undefined) {
    return {
      fact: "Agents service",
      observed: true,
      value: "not configured — PICC_AGENTS_URL is unset, so the crew was never installed"
    }
  }
  if (!isObject(agents)) return unobserved("Agents service")
  if (agents.ok === true) {
    return { fact: "Agents service", observed: true, value: `reachable at ${String(agents.url ?? "an unset URL")}` }
  }
  return {
    fact: "Agents service",
    observed: true,
    value: `configured but unreachable at ${String(agents.url ?? "an unset URL")}`
  }
}

const SECTIONS_BY_KEY: Record<ReadOnlyRoomKey, SectionSpec[]> = {
  dashboard: DASHBOARD_SECTIONS,
  settings: SETTINGS_SECTIONS,
  studio: STUDIO_SECTIONS,
  simulator: SIMULATOR_SECTIONS,
  autopilot: AUTOPILOT_SECTIONS,
  "command-centre": COMMAND_CENTRE_SECTIONS,
  dispatch: DISPATCH_SECTIONS,
  governor: GOVERNOR_SECTIONS,
  guidance: GUIDANCE_SECTIONS
}

const TITLES: Record<ReadOnlyRoomKey, { title: string; capabilityLabel: string }> = {
  dashboard: { title: "Dashboard", capabilityLabel: "observed suite status" },
  settings: { title: "Settings", capabilityLabel: "observed configuration" },
  studio: { title: "Studio", capabilityLabel: "observed browser-studio status" },
  simulator: { title: "Simulator", capabilityLabel: "observed sandbox outputs" },
  autopilot: { title: "Autopilot", capabilityLabel: "observed demo-engine state" },
  "command-centre": { title: "Command Centre", capabilityLabel: "observed venue gates and signals" },
  dispatch: { title: "Dispatch", capabilityLabel: "observed notification inbox" },
  governor: { title: "Governor", capabilityLabel: "observed crew configuration" },
  guidance: { title: "Guidance", capabilityLabel: "observed crew availability" }
}

/* ==========================================================================
   THE PROJECTION — the single entry point, pure
   ========================================================================== */

/**
 * The producers ONE instance declares — its section ids and their routes.
 *
 * Exported because the adapter must fetch exactly what the projection will read,
 * and because duplicating the route list in the adapter is precisely how a client
 * starts fetching something the projection never shows. One list, two consumers.
 */
export function readOnlySectionsFor(
  key: ReadOnlyRoomKey,
  suite: ReadOnlySuiteId
): { id: string; route: string }[] {
  return SECTIONS_BY_KEY[key]
    .filter((s) => !s.suites || s.suites.includes(suite))
    .map((s) => ({ id: s.id, route: s.route }))
}

/**
 * Build one instance's view from its OWN readouts.
 *
 * THE ONLY EXPORTED PROJECTION IN THIS MODULE, and a test asserts that. Sixteen
 * instances sharing one entry point is what "nine surfaces, not sixteen
 * components" means in code; sixteen exported builders would be sixteen shapes
 * free to drift.
 *
 * A readout is `unknown`: a route response, or `null`/`undefined` for "not
 * obtained". It is NEVER replaced by a locally-built placeholder, which is the
 * rule T9's Paper/Live module states and the one this shares.
 */
export function buildReadOnlyRoomView(input: {
  key: ReadOnlyRoomKey
  suite: ReadOnlySuiteId
  readouts: Readonly<Record<string, unknown>> | null | undefined
}): ReadOnlyRoomView {
  const { key, suite } = input
  const readouts = input.readouts ?? {}
  const specs = SECTIONS_BY_KEY[key].filter((s) => !s.suites || s.suites.includes(suite))

  const sections: ReadOnlySection[] = specs.map((spec) => {
    const raw = Object.prototype.hasOwnProperty.call(readouts, spec.id) ? readouts[spec.id] : null
    const producerError = producerErrorOf(raw)
    // A readout that IS an object carrying a producer error is a REFUSAL, not a
    // result: `/api/agents/settings` answers with JSON carrying only an error when
    // PICC_AGENTS_URL is unset. Reading its (absent) settings would report an
    // unconfigured-but-empty crew, so the error path IS the absence path.
    const obtained = isObject(raw) && producerError === null

    // A spec may declare absences that hold even when its producer answers — the
    // simulator's twin is the case: there is no read route, so its absence is a
    // permanent property of the room rather than a transient fetch failure.
    const permanent = (spec.project({}).absences ?? []).map((a) => Object.freeze({ ...a }))

    if (!obtained) {
      // The facts still get their NAMES from the projection, with every value
      // forced to `observed: null`. Naming what was looked for is the point: the
      // room says which figure it could not read, not merely that it is empty.
      const names = spec.project({}).facts.map((f) => unobserved(f.fact))
      return {
        id: spec.id,
        title: spec.title,
        route: spec.route,
        readoutObtained: false,
        producerError,
        absence: Object.freeze({ what: spec.absentWhat, detail: spec.absentDetail, owner: OWNED }),
        permanentAbsences: Object.freeze(permanent),
        facts: names
      }
    }
    const projected = spec.project(raw)
    return {
      id: spec.id,
      title: spec.title,
      route: spec.route,
      readoutObtained: true,
      producerError: null,
      absence: null,
      permanentAbsences: Object.freeze(permanent),
      facts: projected.facts
    }
  })

  const obtainedCount = sections.filter((s) => s.readoutObtained).length
  const verdict: ReadOnlyVerdict =
    obtainedCount === 0 ? "unobserved" : obtainedCount === sections.length ? "observed" : "partially-observed"

  const verdictReason =
    verdict === "observed"
      ? `All ${sections.length} of this room's producers answered. What is shown is what they said; nothing is added to it.`
      : verdict === "unobserved"
        ? `None of this room's ${sections.length} producers answered, so this room states what it does not know and shows no value for it.`
        : `${obtainedCount} of this room's ${sections.length} producers answered. The absent ones are named, and no value is shown for them.`

  const absences: ReadOnlyAbsence[] = sections.flatMap((s) =>
    s.absence ? [s.absence, ...s.permanentAbsences] : [...s.permanentAbsences]
  )

  return {
    key,
    suite,
    title: TITLES[key].title,
    capabilityLabel: TITLES[key].capabilityLabel,
    verdict,
    verdictReason,
    sections,
    absences,
    affordances: READ_ONLY_INTERACTIVE_AFFORDANCES,
    affordanceReason: READ_ONLY_AFFORDANCE_REASON,
    complete: obtainedCount === sections.length
  }
}