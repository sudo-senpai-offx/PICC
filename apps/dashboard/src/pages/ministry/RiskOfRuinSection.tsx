import { useRef, useState } from "react"
import { fetchRiskOfRuin } from "@/lib/riskOfRuin"
import type {
  RiskOfRuinInput,
  RiskOfRuinInputState,
  RiskOfRuinMeasured,
  RiskOfRuinProvenanceEntry,
  RiskOfRuinRequest,
  RiskOfRuinResponse
} from "@/lib/riskOfRuin"
import { MeasuredAt } from "./CandleCalculatorSection"

/**
 * The risk-of-ruin panel (UI-4): four inputs, and a readout that says which of
 * them the operator chose.
 *
 * THE GOVERNING RULE, AND IT IS THE SAME ONE THE REST OF THIS WORKFOLIO KEEPS:
 * NEVER PRESENT A COMPUTED NUMBER WITHOUT SAYING WHERE ITS INPUTS CAME FROM.
 * Here it has a sharper edge than anywhere else in the room, because until this
 * task the SERVER had substituted four of the four and said nothing. The client
 * was not permitted to be honest about that, because it had nothing to be
 * honest with — the fix had to be at the source, and this panel is what renders
 * what the source now discloses.
 *
 * THREE CONSEQUENCES ARE VISIBLE IN THE MARKUP BELOW.
 *
 *  - THE ASSUMPTION TRAVELS WITH ITS NUMBER. Each input is one `<li>` holding
 *    both the value and the sentence about where that value came from. A panel
 *    that renders four confident numbers and one footnote reading "some inputs
 *    were assumed" is a panel whose caveat is read after the numbers, or never;
 *    the assertion in `RiskOfRuinSection.test.tsx` that the assumption text and
 *    the number share an element is the machine-checkable form of that.
 *  - THE GATE IS ON `state`, NEVER ON A VALUE. `state` is a closed union of
 *    three and `substitute`/`clamp` are `null` when they did not happen, so key
 *    presence is the test throughout. Gating on the number instead would be the
 *    `riskParity.mjs:154` defect again: a substituted `avgPayout` of 0.8 is
 *    indistinguishable from a typed 0.8 by value, and a measured `0` would
 *    collapse into the same branch as an absent one.
 *  - AN ASSUMED INPUT MAY STILL SHOW ITS NUMBER. It is not hidden, and it is not
 *    greyed into uselessness — a caller who wants to see "what does this look
 *    like at 2% risk" needs the number. What it may not do is appear without the
 *    assumption attached to it.
 *
 * NOTHING FETCHES ON MOUNT, for the reason every other section in this room
 * gives: this room is an order-execution surface (see `CommandCentreRoom`'s own
 * header) and a panel that read on arrival would add a request to every visit.
 * The inputs are UNCONTROLLED and read through refs at click time, which is also
 * what makes the identity of the answer exact — the value read at click time is
 * the value sent, so the keys the server reports as assumed cannot drift from
 * what this panel actually asked.
 *
 * `MeasuredAt` is IMPORTED from the candle-calculator section rather than
 * written a fourth time. It is the repo's own exported component, in this same
 * directory, and three copies of a staleness stamp is the kind of drift the
 * workspace has been auditing out of the server for three waves.
 */

/** The four inputs, in the order the readout renders them. */
const FIELDS: ReadonlyArray<{
  key: RiskOfRuinInput
  label: string
  unit: string
  placeholder: string
}> = [
  { key: "winRate", label: "win rate", unit: "%", placeholder: "blank = server's ledger" },
  { key: "avgPayout", label: "avg payout", unit: "x", placeholder: "blank = 0.8" },
  { key: "riskPct", label: "risk per trade", unit: "%", placeholder: "blank = 2" },
  { key: "balance", label: "balance", unit: "", placeholder: "blank = 1000" }
]

/** The word each of the three states renders as. A closed map, so a fourth state cannot render. */
const STATE_WORDS: Record<RiskOfRuinInputState, string> = {
  supplied: "supplied",
  substituted: "assumed",
  clamped: "clamped"
}

/**
 * WHAT EACH SOURCE ID MEANS TO A READER.
 *
 * THE SERVER'S OWN TOKEN IS ALSO PRINTED, verbatim, beside this gloss. The token
 * is the fact — it is what `trading.mjs` recorded and what another client will
 * see — and a panel that translates it away has replaced the server's words with
 * its own, which is the defect this whole task is about one layer up. The gloss
 * is additive: a `signal-accuracy-ledger` means nothing to an operator, and an
 * unreadable token is no better than no provenance at all.
 *
 * An id with no entry here renders with no gloss rather than being hidden or
 * guessed at, so a source the server adds later is visible before it is
 * understood.
 */
const SOURCE_GLOSS: Record<string, string> = {
  "signal-accuracy-ledger": "your recorded accuracy ledger",
  "server-constant": "a server default"
}

/**
 * A number, or the word `absent`.
 *
 * `Number.isFinite` IS THE TEST, not truthiness, so a supplied `0` prints as `0`
 * and never becomes `absent` — which matters here more than in the other panels,
 * because `avgPayout: 0` is a real answer the server reached deliberately.
 */
function formatNum(value: number | null): string {
  return Number.isFinite(value) ? String(value) : "absent"
}

type Refs = Record<RiskOfRuinInput, React.RefObject<HTMLInputElement | null>>

/**
 * READ THE FOUR INPUTS, OR SAY WHICH ONE IS UNUSABLE.
 *
 * A BLANK BOX IS ABSENT, NOT ZERO. `Number("")` is `0`, so parsing a blank into
 * `0` would make this client send a number the operator never typed — which is
 * the same silent substitution the server was just fixed for, moved one layer up
 * and harder to see. A blank stays absent, which is what lets the server assume
 * honestly and report doing so.
 *
 * A NON-NUMERIC BOX IS REFUSED BEFORE ANYTHING IS SENT, and by name. The server
 * would happily substitute for `"two percent"` and record it, but a panel that
 * silently turns a typo into an assumption is the defect in miniature.
 */
function readInputs(refs: Refs): { inputs: RiskOfRuinRequest } | { error: string } {
  const inputs: RiskOfRuinRequest = {}
  for (const field of FIELDS) {
    const raw = (refs[field.key].current?.value ?? "").trim()
    if (raw === "") continue
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      return { error: `${field.label} "${raw}" is not a finite number — nothing was sent` }
    }
    inputs[field.key] = value
  }
  return { inputs }
}

/**
 * THE SENTENCE ABOUT ONE INPUT, composed from its own record and nothing else.
 *
 * `state` decides the headline word. The subordinate clauses are appended from
 * `substitute` and `clamp` INDEPENDENTLY, because the two compose: an input that
 * was assumed from the ledger and then clamped up to a floor needs both, and
 * either one alone leaves a reader with a number they would not have arrived at
 * on their own.
 */
function provenanceSentence(entry: RiskOfRuinProvenanceEntry, unit: string): string {
  const parts: string[] = [STATE_WORDS[entry.state]]

  if (entry.substitute) {
    const gloss = SOURCE_GLOSS[entry.substitute.source]
    const from = `${entry.substitute.source}${gloss ? ` (${gloss})` : ""}`
    parts.push(
      `assumed ${formatNum(entry.substitute.value)}${unit} from ${from} — ${entry.substitute.reason}`
    )
  }

  if (entry.clamp) {
    parts.push(
      `clamped from ${formatNum(entry.clamp.from)}${unit} to ${formatNum(entry.clamp.to)}${unit} — ${entry.clamp.bound}` +
        (entry.clamp.note ? ` (${entry.clamp.note})` : "")
    )
  }

  if (entry.state === "supplied") parts.push("used as you typed it")
  return parts.join(" · ")
}

/**
 * ONE RUN'S ANSWER, TIMESTAMP AND ALL.
 *
 * The timestamp lives in the same object as the payload so the stamp cannot
 * drift from the answer it belongs to.
 */
type RoReading = { data: RiskOfRuinResponse; measuredAt: number }

/** The same, narrowed to the branch that actually computed something. */
type RoMeasured = { data: RiskOfRuinMeasured; measuredAt: number }

/**
 * NARROW ONCE, HERE, RATHER THAN AT FOUR USE SITES.
 *
 * Testing `state.data.ok === true` in JSX narrows `state.data` but NOT the
 * `state` binding, so the result component would have to take the union and
 * re-narrow it, or the call site would need a non-null assertion. Doing the
 * narrowing in one function means the stamp, the readout and the refusal branch
 * all agree about what counts as measured, and the prop types say so instead of
 * a comment claiming it.
 */
function measuredReading(state: RoReading | null): RoMeasured | null {
  if (state === null || state.data.ok !== true) return null
  return { data: state.data, measuredAt: state.measuredAt }
}

export function RiskOfRuinSection() {
  const winRate = useRef<HTMLInputElement>(null)
  const avgPayout = useRef<HTMLInputElement>(null)
  const riskPct = useRef<HTMLInputElement>(null)
  const balance = useRef<HTMLInputElement>(null)
  const refs: Refs = { winRate, avgPayout, riskPct, balance }

  const [state, setState] = useState<RoReading | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onRun() {
    setBusy(true)
    setError(null)
    const read = readInputs(refs)
    if ("error" in read) {
      // REFUSED BEFORE ANYTHING IS SENT, and it clears the readout for the same
      // reason a failed fetch does: the operator asked a second question and it
      // was refused, so the first question's answer must not stand under the new
      // label. It goes through the one `error` channel rather than a second
      // surface that could disagree with it.
      setError(read.error)
      setState(null)
      setBusy(false)
      return
    }
    try {
      const data = await fetchRiskOfRuin(read.inputs)
      setState({ data, measuredAt: Date.now() })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState(null)
    } finally {
      setBusy(false)
    }
  }

  const reading = measuredReading(state)

  return (
    <section className="panel" data-testid="risk-of-ruin-section">
      <header className="panel-head">
        <h3>Risk of ruin</h3>
      </header>
      <p className="muted small" data-testid="roe-note">
        Leave a field blank and the server will choose that input itself — from your
        own recorded accuracy ledger where one exists, from a fixed default
        otherwise — and it will say which, on which field, and why, underneath the
        number. A blank box is not a zero: it is the absence of a number, and the
        two produce different readouts.
      </p>

      <div className="panel">
        <div className="panel-head">
          <strong>Inputs</strong>
          <button type="button" onClick={onRun} disabled={busy} data-testid="roe-run">
            {busy ? "computing…" : state ? "re-run" : "run"}
          </button>
        </div>

        <div data-testid="roe-fields">
          {FIELDS.map((field) => (
            <p key={field.key}>
              <label htmlFor={`roe-field-${field.key}`}>{field.label}</label>{" "}
              <input
                id={`roe-field-${field.key}`}
                ref={refs[field.key]}
                type="text"
                placeholder={field.placeholder}
                data-testid={`roe-field-${field.key}`}
              />
            </p>
          ))}
        </div>

        {error ? (
          <div className="panel muted" data-testid="roe-error">
            <p>risk of ruin unavailable — {error}</p>
            <p className="muted small">
              no readout is shown rather than an empty one that would read as
              &quot;nothing to report&quot;.
            </p>
          </div>
        ) : null}

        {!state && !error ? (
          <p className="muted small" data-testid="roe-idle">
            not yet run.
          </p>
        ) : null}

        {reading ? <MeasuredAt at={reading.measuredAt} testId="roe-measured-at" /> : null}

        {state && reading === null ? (
          <div className="panel muted" data-testid="roe-refused">
            <p>risk of ruin refused — {state.data.ok === false ? state.data.error : "unknown"}</p>
            <p className="muted small" data-testid="roe-refused-note">
              the route answered without computing anything, so no input was assumed
              and no ruin figure exists. None is shown.
            </p>
          </div>
        ) : null}

        {reading ? <RiskOfRuinResult reading={reading} /> : null}
      </div>
    </section>
  )
}

/**
 * THE READOUT, AND THE FOUR INPUTS IT WAS COMPUTED FROM.
 *
 * Split out so the measured branch needs no non-null assertion and no re-narrow
 * at its use site: `measuredReading` has already narrowed the payload before
 * this is reached, and the prop type carries that guarantee.
 */
function RiskOfRuinResult({ reading }: { reading: RoMeasured }) {
  const data = reading.data

  return (
    <div data-testid="roe-result">
      {/* THE HEADLINE COUNTS, FROM THE SERVER'S OWN LISTS. Not re-derived from
          values: a substituted `avgPayout` of 0.8 is indistinguishable from a
          typed 0.8, so counting values here would report a typed number as
          assumed — the false-accusation direction of this same defect. The names
          are shown, not just the totals, because "2 of 4" does not say which two.

          THE DENOMINATOR IS COUNTED, NOT TYPED. `inputs` is the server's own
          block listing exactly the inputs it computed over, so `4` is a fact the
          server reports rather than a literal this panel would have to keep in
          step by hand. It was the only figure here not derived from the
          payload, which made it the one figure that could quietly become false
          the day a fifth input was added. */}
      <p className="muted small" data-testid="roe-summary">
        {data.provenance.assumedInputs.length} of {Object.keys(data.inputs).length} input(s) were not supplied
        {data.provenance.assumedInputs.length > 0
          ? ` — assumed: ${data.provenance.assumedInputs.join(", ")}`
          : " — every input is the number you sent"}
        {data.provenance.clampedInputs.length > 0
          ? ` · clamped to this calculator's range: ${data.provenance.clampedInputs.join(", ")}`
          : " · none out of range"}
      </p>

      {/* THE READOUT. Every figure below was computed over the four inputs listed
          immediately after it, and each of those carries its own provenance. */}
      <p data-testid="roe-figures">
        risk of ruin {data.riskOfRuinPct} · edge {data.edge} · {data.unitsToRuin}{" "}
        unit(s) to ruin · expected growth {data.expectedGrowthPct} · kelly{" "}
        {data.kellyFraction} · half kelly {data.halfKellyPct}
      </p>

      {/* THE FOUR INPUTS AND WHAT BECAME OF EACH. ONE element per input, so the
          assumption cannot be separated from its number by layout: a footnote
          below the table is read after the numbers, or never. */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {FIELDS.map((field) => {
          const entry = data.provenance[field.key]
          return (
            <li key={field.key} className="muted small" data-testid={`roe-input-${field.key}`}>
              {field.label} {formatNum(entry.used)}
              {field.unit} · {provenanceSentence(entry, field.unit)}
            </li>
          )
        })}
      </ul>

      {/* THE ROUNDED ECHO, KEPT VISIBLE beside the exact per-input values it
          rounds. The two differ by rounding — a ledger 47.5% reads 48 here — and
          hiding either one would leave a reader comparing two numbers with no
          statement of which is which. */}
      {/* THE ROUNDED ECHO, KEPT VISIBLE beside the exact per-input values it
          rounds. The two differ by rounding — a ledger 47.5% reads 48 here — and
          hiding either one would leave a reader comparing two numbers with no
          statement of which is which. Asserted by
          `RiskOfRuinSection.test.tsx`: deleting this paragraph was invisible to
          the suite until that test existed. */}
      <p className="muted small" data-testid="roe-echo">
        the server&apos;s own rounded echo of the four inputs:{" "}
        {FIELDS.map((f) => `${f.label} ${formatNum(data.inputs[f.key])}`).join(" · ")}
      </p>
    </div>
  )
}