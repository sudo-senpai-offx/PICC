import { useRef, useState } from "react"
import type { RefObject } from "react"
import { fetchCandles } from "@/hooks/useCandleData"
import { TIMEFRAME_LABELS } from "@/hooks/useCandleData"
import type { Timeframe } from "@/hooks/useCandleData"
import { fetchRegime, regimeIsMeasured, toWireCandles, expiryIsScored, fetchExpiry, fetchAdaptiveStops, stopsAreMeasured } from "@/lib/candleCalculators"
import type {
  AdaptiveStopsResponse,
  CandleOrigin,
  ExpiryResponse,
  LegacyRegime,
  RegimeResponse,
  RegimeUnknown,
  StopsDirection,
  WireCandle
} from "@/lib/candleCalculators"

/**
 * Candle calculator panels — the three routes that compute FROM a candle series
 * rather than about a symbol (UI-3, wave 2 of the surface-less endpoint audit):
 * `POST /api/trading/regime`, `/api/trading/expiry` and
 * `POST /api/trading/adaptive-stops`.
 *
 * THE ONE CANDLE SOURCE, AND WHY IT IS NOT THE HOOK
 *
 * `handlers.mjs:5703`, `:5711` and `:5740` all read the series out of the request
 * body. There is no server-side fetch for any of the three, so these panels are
 * the ones that must supply it.
 *
 * They supply it from `fetchCandles` — the function `src/hooks/useCandleData.ts`
 * exports at `:153`, which POSTs `/api/trading/candles` with the `{BASE}` prefix
 * and the bearer token. Its `CandleDatum[]` shape (`open/high/low/close/time`) is
 * what `detectRegime`, `optimizeExpiry` and `computeAdaptiveStops` read, so no
 * second candle source was invented and none is needed.
 *
 * THE HOOK ITSELF IS NOT USED, and that is the finding rather than a preference:
 * `useCandleData.ts:322` fetches unconditionally inside its first effect, so
 * mounting the hook would fire a candle request the moment the room rendered, and
 * `:365` would open the shared realtime tick subscription with it. Both of those
 * are precisely what an opt-in calculator must not do. Calling the exported
 * function at click time gets the same source, the same auth and the same
 * provenance tags with neither side effect. See `candleCalculators.ts` for the
 * full argument.
 *
 * WHY `regime` IS NOT CHAINED INTO `expiry`
 *
 * `regime` feeds `expiry`, and running one from the other is tempting: it saves a
 * question. It is declined here, for three reasons that are about honesty rather
 * than effort:
 *
 *  1. IT WOULD MAKE `expiry`'s REGIME INPUT IMPLICIT. `optimizeExpiry` scores
 *     every expiry differently per regime (`expiryOptimizer.mjs:47-56`), so a
 *     recommendation is meaningless without knowing which regime produced it. If
 *     that regime came from another panel, the number on this panel would be
 *     derived from something the reader cannot see from it.
 *  2. THE TWO ROUTES DISAGREE ABOUT WHAT A REGIME IS. `detectRegime` emits
 *     `trending`/`ranging`/`volatile`/`breakout`; `optimizeExpiry` branches on
 *     exactly those four; but `detectRegime`'s own `regimeEngine` block emits a
 *     DIFFERENT, uppercased vocabulary including `UNCERTAIN`, which
 *     `optimizeExpiry` would silently score down its ranging branch. A chain
 *     would have to pick one, and picking wrong is silent.
 *  3. THE TWO HAVE DIFFERENT GATES — 30 bars for `detectRegime`, 20 for
 *     `optimizeExpiry` — so a chain makes one number change meaning depending on
 *     which threshold the series happened to clear.
 *
 * Instead the expiry panel asks for its regime EXPLICITLY and displays the
 * regime and signal strength it sent, beside the score they produced. The
 * `regime` panel is the place to read a detected regime; the expiry panel is the
 * place to say which regime a recommendation was computed under.
 *
 * THE GOVERNING RULE, IN THREE CONCRETE PLACES
 *
 * NEVER PRESENT A COMPUTED NUMBER WITHOUT SAYING WHERE ITS INPUTS CAME FROM:
 *
 *  - `candle-origin` prints the series' asset, its requested bar count, the bars
 *    ACTUALLY sent (which differs from the request whenever `fetchCandles` filtered
 *    a bar, and those bars are counted, not swallowed), the source that served it,
 *    the resolution it was actually served at, and whether it is stale.
 *  - `expiry-inputs` prints the `regime` and `signalStrength` this panel sent.
 *    `optimizeExpiry(candles, regime = "ranging", signalStrength = 0.5)` invents
 *    both when absent, so an explicit choice is the only way the readout is
 *    attributable.
 *  - `stops-atrperiod` prints the ATR period the server will actually use.
 *
 * A refusal renders as a refusal CARRYING ITS REASON and clears any previous
 * readout, so a stale success can never be read as the answer to a failed
 * question. The inputs are UNCONTROLLED and read through refs at click time: this
 * harness is not configured for `act(...)`, so a controlled input needs the
 * native-setter dance, and a ref also makes the identity of the answer exact —
 * the value read at click time is the value sent.
 */

const DEFAULT_BARS = 120
const STALE_AFTER_MS = 15 * 60 * 1000

function clockOf(when: number): string {
  return new Date(when).toLocaleTimeString()
}

/**
 * A measured number, or the word `absent`.
 *
 * `Number.isFinite` IS THE TEST, not truthiness and not `!= null`, so a measured
 * `0` still prints as `0`. That distinction is the whole point of the `| null`
 * types in `candleCalculators.ts`: `0` is a measurement and `null` is the absence
 * of one.
 */
function formatNum(value: number | null): string {
  return Number.isFinite(value) ? String(value) : "absent"
}

/** The value, or `absent — <reason>`. Never a bare dash: a dash reads as "fine". */
function measured(value: number | null, reason: string): string {
  return Number.isFinite(value) ? String(value) : `absent — ${reason}`
}

// ---------------------------------------------------------------------
// The shared candle fetch, and the origin readout every panel carries
// ---------------------------------------------------------------------

interface PanelInputs {
  assetId: string
  timeframeSeconds: Timeframe
  /** The label `detectRegime` needs; `optimizeExpiry`/stops need the number. */
  timeframeLabel: string
  bars: number
}

type Refs = Record<string, HTMLInputElement | HTMLSelectElement | null>

/**
 * Everything the panels know about WHERE THE SERIES CAME FROM.
 *
 * `requestedBars` AND `sentBars` ARE BOTH HERE because they can differ, and a
 * readout that printed only the request would misstate what the server was asked
 * to compute over.
 */
export interface SeriesOrigin extends CandleOrigin {
  assetId: string
  timeframeLabel: string
  requestedBars: number
  sentBars: number
  droppedBars: number
}

interface RunState<T> {
  data: T
  origin: SeriesOrigin
  measuredAt: number
}

interface Calculator<E, T> {
  state: RunState<T> | null
  busy: boolean
  error: string | null
  run: (inputs: PanelInputs, extra: E) => Promise<void>
  refuse: (reason: string) => void
}

/**
 * THE OPT-IN STATE MACHINE, SHARED BY ALL THREE PANELS.
 *
 * A FAILURE CLEARS THE READOUT. The readout is per-series and per-moment, so a
 * second question that was refused must not leave the first question's answer
 * standing under the new label.
 *
 * The candle fetch is INSIDE the try, which is what makes "the candle source
 * failed" and "the calculator refused" one refusal surface rather than two that
 * can disagree.
 *
 * `extra` carries whatever a route needs BEYOND the series — the expiry panel's
 * regime and signal strength. It is threaded through rather than closed over,
 * because the value kept beside the result must be the value sent, and a closure
 * captured at render could be the previous question's.
 */
function useCalculator<E, T>(
  compute: (candles: WireCandle[], origin: SeriesOrigin, extra: E) => Promise<T>
): Calculator<E, T> {
  const [state, setState] = useState<RunState<T> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(inputs: PanelInputs, extra: E) {
    setBusy(true)
    setError(null)
    try {
      const fetched = await fetchCandles(inputs.assetId, inputs.timeframeSeconds, inputs.bars)
      const { candles, dropped } = toWireCandles(fetched.rows)
      // ZERO USABLE BARS IS A REFUSAL BY NAME, not a request that returns a
      // well-formed answer about an empty market. `fetchCandles` filters
      // non-positive and non-numeric OHLC (`:169`), so a symbol that resolved but
      // held nothing usable arrives here as an empty array. Refusing names the
      // symbol and the range; sending it would let `optimizeExpiry` answer with
      // its constant `"1m"` and be indistinguishable from a short series.
      if (candles.length === 0) {
        throw new Error(
          `the candle source returned 0 usable bars for ${inputs.assetId} at ${inputs.timeframeLabel} — nothing was sent`
        )
      }
      const origin: SeriesOrigin = {
        assetId: inputs.assetId,
        timeframeLabel: inputs.timeframeLabel,
        requestedBars: inputs.bars,
        sentBars: candles.length,
        droppedBars: dropped,
        timeframeSeconds: inputs.timeframeSeconds,
        servedBy: fetched.source,
        feed: fetched.feed,
        servedTimeframe: fetched.resolvedTimeframe,
        resolved: fetched.resolved,
        stale: fetched.stale,
        verifySources: fetched.verifySources,
        verifiedCount: fetched.verifiedCount,
        sourceMode: fetched.sourceMode
      }
      const data = await compute(candles, origin, extra)
      setState({ data, origin, measuredAt: Date.now() })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState(null)
    } finally {
      setBusy(false)
    }
  }

  /** A refusal raised BEFORE anything is sent. Same channel, same clearing. */
  function refuse(reason: string) {
    setError(reason)
    setState(null)
    setBusy(false)
  }

  return { state, busy, error, run, refuse }
}

/** Reads the uncontrolled inputs at click time, or names what is wrong with them. */
function readInputs(refs: RefObject<Refs>, prefix: string): PanelInputs | { error: string } {
  const assetId = (refs.current.asset?.value ?? "").trim()
  if (!assetId) return { error: `asset is blank — nothing was sent to the ${prefix} route` }

  const tfRaw = refs.current.tf?.value ?? ""
  const seconds = Number(tfRaw)
  if (!Number.isFinite(seconds)) {
    return { error: `timeframe "${tfRaw}" is not a finite number of seconds — nothing was sent` }
  }
  const timeframeSeconds = seconds as Timeframe

  const barsRaw = (refs.current.bars?.value ?? "").trim()
  const bars = barsRaw === "" ? DEFAULT_BARS : Number(barsRaw)
  if (!Number.isFinite(bars) || bars <= 0) {
    return { error: `bar count "${barsRaw}" is not a positive number — nothing was sent` }
  }

  return {
    assetId,
    timeframeSeconds,
    timeframeLabel: TIMEFRAME_LABELS[timeframeSeconds] ?? String(timeframeSeconds),
    bars
  }
}

function CandleInputs({
  refs,
  testIdBase,
  label,
  timeframes
}: {
  refs: RefObject<Refs>
  testIdBase: string
  label: string
  /** Omitted means every label `TIMEFRAME_LABELS` carries. */
  timeframes?: readonly Timeframe[]
}) {
  const allowed = timeframes ? new Set<number>(timeframes) : null
  const options = Object.entries(TIMEFRAME_LABELS)
    .map(([seconds, name]) => ({ seconds: Number(seconds), name: name as string }))
    .filter((o) => allowed === null || allowed.has(o.seconds))
    .sort((a, b) => a.seconds - b.seconds)

  return (
    <>
      <input
        ref={(el) => { refs.current.asset = el }}
        type="text"
        placeholder="EURUSD"
        aria-label={`${label} asset`}
        data-testid={`${testIdBase}-asset`}
      />
      <select
        ref={(el) => { refs.current.tf = el }}
        defaultValue="60"
        aria-label={`${label} timeframe`}
        data-testid={`${testIdBase}-tf`}
      >
        {options.map((o) => (
          <option key={o.seconds} value={o.seconds}>
            {o.name} ({o.seconds}s)
          </option>
        ))}
      </select>
      <input
        ref={(el) => { refs.current.bars = el }}
        type="number"
        defaultValue={DEFAULT_BARS}
        aria-label={`${label} bar count`}
        data-testid={`${testIdBase}-bars`}
      />
    </>
  )
}

/**
 * THE ORIGIN LINE, AND IT IS NOT INCIDENTAL.
 *
 * Every number a panel prints was computed over these bars, by these services,
 * from this source, at this resolution. `requestedBars` and `sentBars` are both
 * printed because `fetchCandles` filters unusable bars (`:169`) and a panel that
 * showed only the request would describe a series the server never saw. The
 * count of bars dropped ON TOP of that is the non-finite-time/OHLC drop, so the
 * two figures together account for the whole request.
 */
function OriginLine({ origin, testId }: { origin: SeriesOrigin; testId: string }) {
  return (
    <p className="muted small" data-testid={testId}>
      {origin.assetId} · {origin.timeframeLabel} · {origin.sentBars} of{" "}
      {origin.requestedBars} requested bar(s) sent
      {origin.droppedBars > 0 ? ` (${origin.droppedBars} unusable bar(s) dropped)` : ""} ·
      served by {origin.servedBy ?? "an unnamed source"}
      {origin.feed ? ` via ${origin.feed}` : ""} · served at{" "}
      {origin.servedTimeframe === null ? "an unnamed resolution" : `${origin.servedTimeframe}s`}
      {origin.resolved ? " (NOT the resolution asked for)" : ""} ·{" "}
      {origin.stale ? "STALE — the source flagged this series" : "not flagged stale"} ·{" "}
      {origin.sourceMode ? `source selection ${origin.sourceMode}` : "source selection unnamed"}
      {origin.sourceMode === "fallback"
        ? " — the source preference did not serve this, so a different one did"
        : ""}{" "}
      {/* THE TWO CROSS-VERIFICATION FIGURES ARE NOT THE SAME SENTENCE. These
          panels call `fetchCandles` with `verify` left at its default `false`, so
          the server takes the plain fan-in and can only ever report zero. Printed
          unconditionally that zero reads as a verdict on the source ("nothing
          agreed") when it is a verdict on us ("nobody was asked"). The two are
          separated so the panel never claims a cross-check it did not perform. */}
      {origin.verifySources > 0
        ? `${origin.verifiedCount}/${origin.sentBars} bar(s) cross-verified across ${origin.verifySources} source(s)`
        : "not cross-verified — this run did not ask a second source"}
    </p>
  )
}

/**
 * `now` IS A PROP SO THE STALENESS CLAUSE IS REACHABLE.
 *
 * `STALE_AFTER_MS` is fifteen minutes, so inside a test run `Date.now() - at` is
 * always a few hundred milliseconds and the "may be out of date" branch can never
 * commit. A branch no test can reach is a branch nothing holds, so the clock is
 * injectable and the test drives the real render path rather than a copy of it.
 */
export function MeasuredAt({ at, now, testId }: { at: number; now?: number; testId: string }) {
  const stale = (now ?? Date.now()) - at > STALE_AFTER_MS
  return (
    <p className="muted small" data-testid={testId}>
      fetched {clockOf(at)}
      {stale ? " — may be out of date, re-run to refresh" : ""}
    </p>
  )
}

// ---------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------

export function CandleCalculatorSection() {
  return (
    <section className="panel" data-testid="candle-calc-section">
      <header className="panel-head">
        <h3>Candle calculators</h3>
      </header>
      <p className="muted small" data-testid="candle-calc-note">
        Three readouts computed from a candle series you supply. Unlike the symbol
        panels above, these routes fetch nothing server-side, so each one reads the
        dashboard&apos;s own candle source on demand. Nothing here reads on mount.
      </p>
      <RegimePanel />
      <ExpiryPanel />
      <AdaptiveStopsPanel />
    </section>
  )
}

// ---------------------------------------------------------------------
// Regime
// ---------------------------------------------------------------------

/**
 * THE EIGHT LABELS `detectRegime` CAN ACTUALLY ROUND-TRIP, AND WHY THE LIST IS
 * SHORTER THAN `TIMEFRAME_LABELS`.
 *
 * THE ROUTE READS A LABEL, NOT A NUMBER, AND ITS LOOKUP IS A STRING ROUND-TRIP.
 * `tfSecondsOf` (`regimeDetection.mjs:31-35`) lowercases the label, strips every
 * non-alphanumeric character and then looks the result up in a fixed map. The
 * dashboard's labels do not all survive that:
 *
 *  - `5s`, `15s`, `30s` normalise to `5s`/`15s`/`30s`, and none of those is a key,
 *    so `tfSecondsOf` returns `null`. `regimeDetection.mjs:80` then writes
 *    `planes: { [tf ?? 60]: candles }` — the bias plane silently becomes 60s.
 *  - `1M` (2592000) normalises to `1m`, which IS a key: 60. A request for MONTHLY
 *    bars is answered with a 1-MINUTE bias plane.
 *
 * So three of those four cannot be honoured at all and the fourth collides with
 * `1m`. Offering them would put two contradictory numbers on one panel, because
 * the response echoes the label back as `metrics.timeframe` ("read at timeframe
 * 1M") while `regimeEngine.latency.planes` reports the plane it actually used
 * ("plane(s) at 60s"). The panel cannot print both and stay attributable, so the
 * options the route cannot round-trip are NOT OFFERED here rather than offered
 * and flagged.
 *
 * The other two panels keep the full list, and need it: `computeAdaptiveStops`
 * receives these seconds as an ATR smoothing window, where `5s` is a perfectly
 * meaningful number of bars (`handlers.mjs:5748`), and `optimizeExpiry` never
 * reads the timeframe at all — it infers the bar interval from the candle times.
 * Filtering is therefore a REGIME-only restriction.
 *
 * `CandleCalculatorSection.test.tsx` proves the round-trip against the service's
 * own `tfSecondsOf`, so a future label change cannot quietly re-open the hole.
 */
export const REGIME_TIMEFRAMES: readonly Timeframe[] = [
  60, 300, 900, 1800, 3600, 14400, 86400, 604800
]

function RegimePanel() {
  const refs = useRef<Refs>({})
  const { state, busy, error, run, refuse } = useCalculator<undefined, RegimeResponse>(
    (candles, origin) =>
      // THE TIMEFRAME IS A LABEL HERE, AND ONLY THE EIGHT LABELS ABOVE REACH THIS
      // LINE. `tfSecondsOf` (`regimeDetection.mjs:31`) only understands strings like
      // "1m"/"5m"; an unrecognised one resolves to null, which silently drops the
      // bias plane to 60s rather than failing, and "1M" collides with "1m".
      fetchRegime(candles, origin.timeframeLabel)
  )

  function onRun() {
    const inputs = readInputs(refs, "regime")
    if ("error" in inputs) {
      refuse(inputs.error)
      return
    }
    void run(inputs, undefined)
  }

  return (
    <div className="panel" data-testid="cc-regime">
      <div className="panel-head">
        <strong>Market regime</strong>
        <button type="button" onClick={onRun} disabled={busy} data-testid="cc-regime-run">
          {busy ? "detecting…" : state ? "re-detect regime" : "detect regime"}
        </button>
      </div>
      <p className="muted small">
        ADX and ATR consensus over the bars below, plus a separate multi-plane
        convergence read. The two can disagree — they are different classifiers and
        the panel shows both rather than picking one.
      </p>
      {/* The label limit is disclosed here to the reader rather than imposed
          silently; `REGIME_TIMEFRAMES` above carries the reason for a maintainer. */}
      <p className="muted small">
        Only timeframes the regime route can resolve are offered: it reads the
        choice as a label rather than a bar count. A second-resolution label is not
        a key in its lookup, so it falls back to a 60-second plane and carries no
        bias weight; the monthly label collides with one minute outright. Either
        way the panel would show two contradictory numbers at once. The expiry and
        stops panels below take the same list in full, because they read it as a
        number.
      </p>
      <CandleInputs
        refs={refs}
        testIdBase="cc-regime"
        label="regime"
        timeframes={REGIME_TIMEFRAMES}
      />

      {error ? (
        <div className="panel muted" data-testid="cc-regime-error">
          <p>regime unavailable — {error}</p>
        </div>
      ) : null}

      {!state && !error ? (
        <p className="muted small" data-testid="cc-regime-idle">
          not yet detected.
        </p>
      ) : null}

      {state ? <MeasuredAt at={state.measuredAt} testId="cc-regime-measured-at" /> : null}
      {state ? <OriginLine origin={state.origin} testId="cc-regime-origin" /> : null}
      {state ? <RegimeResult data={state.data} sentBars={state.origin.sentBars} /> : null}
    </div>
  )
}

/**
 * TWO CLASSIFIERS, TWO VOCABULARIES, SHOWN SIDE BY SIDE.
 *
 * `detectRegime`'s legacy `regime` is `trending`/`ranging`/`volatile`/`breakout`
 * and is the one `expiry`'s scorer understands. Its `regimeEngine` block is a
 * different classifier with an UPPERCASE vocabulary that also includes
 * `UNCERTAIN`. They are computed from the same candles and can disagree, which is
 * a fact about the read and not a defect to be smoothed over.
 */
function RegimeResult({ data, sentBars }: { data: RegimeResponse; sentBars: number }) {
  if (!regimeIsMeasured(data)) {
    return <RegimeUnknownResult data={data} sentBars={sentBars} />
  }
  return (
    <div data-testid="cc-regime-result">
      <p data-testid="cc-regime-reading">
        <strong>{data.regime}</strong> · confidence {data.confidence} · suggested{" "}
        {data.suggestedStrategy}
      </p>
      <p className="muted small" data-testid="cc-regime-metrics">
        adx {data.metrics.adx} · atr ratio {data.metrics.atrRatio}x · read at timeframe{" "}
        {data.metrics.timeframe}
      </p>
      <p className="muted small" data-testid="cc-regime-factors">
        factors:{" "}
        {data.factors.length > 0 ? data.factors.join(" · ") : "the service named none"}
      </p>
      <EngineLine data={data} />
    </div>
  )
}

/**
 * THE UNDER-30-BARS BRANCH, WHICH IS A SERVICE REFUSAL SERVED WITH `ok: true`.
 *
 * `detectRegime` returns `regime: "unknown", confidence: 0` (`regimeDetection.mjs:39`)
 * and the route spreads that after `ok: true` (`handlers.mjs:5704`), so the body
 * arrives `ok: true` on a 200. A client that branched on the transport alone would
 * render an empty panel.
 *
 * `confidence: 0` HERE IS A LITERAL CONSTANT, not a measurement — the same defect
 * as `riskParity.mjs:154`'s `portfolioVol: 0`. It is not printed, and no
 * `metrics`/`suggestedStrategy` block is rendered, because those keys are ABSENT
 * from this branch.
 */
function RegimeUnknownResult({ data, sentBars }: { data: RegimeUnknown; sentBars: number }) {
  return (
    <div data-testid="cc-regime-result">
      <div className="panel muted" data-testid="cc-regime-refused">
        <p data-testid="cc-regime-refused-reason">
          NOT MEASURED — regime is unknown: {data.regimeEngine.factors.join(" · ") || data.regimeEngine.reason || "the service named no reason"}
        </p>
        <p className="muted small" data-testid="cc-regime-refused-count">
          {sentBars} bar(s) were sent; `detectRegime` needs 30 before it will classify
          anything. The `confidence` on this branch is a literal 0 in the service, not a
          measurement, so it is not shown.
        </p>
      </div>
      {/* The engine block IS still rendered: it abstained, and an abstention is
          information. It is shown as an abstention, from its own `regime` label. */}
      <EngineLine data={data} />
    </div>
  )
}

/**
 * THE ENGINE BLOCK, AND THE ZERO THAT IS NOT AN ABSENCE.
 *
 * `regimeEngine.mjs` returns `confidence: 0` in TWO different situations: an
 * engine that abstained (`regime: "unknown"`), and a genuinely measured
 * "directionless observed market" (`regime: "RANGING"`). Gating on the number
 * would collapse the second into the first. So this gates on the LABEL, and the
 * RANGING-at-zero case renders as a measurement.
 */
function EngineLine({ data }: { data: RegimeResponse }) {
  const engine = data.regimeEngine
  const abstained = engine.regime === "unknown"
  return (
    <div className="muted small" data-testid="cc-regime-engine">
      <p>
        <strong>regimeEngine:</strong> {engine.regime} · confidence {engine.confidence}
        {engine.volatile ? " · flagged volatile" : ""} ·{" "}
        {abstained
          ? "ABSTAINED — nothing was classified, so its confidence is not a measurement"
          : "measured consensus"}
        {engine.latency.planes.length > 0
          ? ` · plane(s) at ${engine.latency.planes.join(", ")}s`
          : ""}
      </p>
      <p data-testid="cc-regime-engine-factors">
        engine factors:{" "}
        {engine.factors.length > 0 ? engine.factors.join(" · ") : "the engine named none"}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------

/**
 * THE FOUR LABELS `optimizeExpiry`'s OWN SCORER BRANCHES ON
 * (`expiryOptimizer.mjs:47-56`): `trending`, `volatile` and `breakout` each get
 * their own curve and everything else falls to the ranging branch. `ranging` is
 * listed rather than left implicit so the choice is always a visible one.
 */
const EXPIRY_REGIMES: readonly LegacyRegime[] = ["ranging", "trending", "volatile", "breakout"]

interface ExpirySent {
  regime: LegacyRegime
  signalStrength: number
}

interface ExpiryResult {
  data: ExpiryResponse
  /** What was actually sent, kept so the readout can attribute the score to it. */
  sent: ExpirySent
}

function ExpiryPanel() {
  const refs = useRef<Refs>({})
  const { state, busy, error, run, refuse } = useCalculator<ExpirySent, ExpiryResult>(
    async (candles, _origin, sent) => ({
      data: await fetchExpiry(candles, sent.regime, sent.signalStrength),
      sent
    })
  )

  /**
   * THE TWO UPSTREAM INPUTS ARE READ AND VALIDATED HERE, NOT DELEGATED.
   *
   * `optimizeExpiry(candles, regime = "ranging", signalStrength = 0.5)` supplies
   * both itself when they are absent, and the response does not record which it
   * used — so a panel that sent neither would render a scored recommendation
   * whose regime the operator never chose. Both are therefore always sent, and
   * both are displayed beside the score they produced.
   *
   * A non-finite strength is refused BY NAME. `JSON.stringify({signalStrength:
   * NaN})` is `{"signalStrength":null}`, and every strength branch in the service
   * is a comparison (`> 0.7`, `> 0.8`), so a null would score as though no
   * strength applied at all — silently, and differently from any real value.
   */
  function onRun() {
    const inputs = readInputs(refs, "expiry")
    if ("error" in inputs) {
      refuse(inputs.error)
      return
    }
    const regime = (refs.current.regime?.value ?? "ranging") as LegacyRegime
    const raw = (refs.current.strength?.value ?? "").trim()
    const signalStrength = raw === "" ? 0.5 : Number(raw)
    if (!Number.isFinite(signalStrength)) {
      refuse(`signal strength "${raw}" is not a finite number — nothing was sent`)
      return
    }
    void run(inputs, { regime, signalStrength })
  }

  return (
    <div className="panel" data-testid="cc-expiry">
      <div className="panel-head">
        <strong>Expiry</strong>
        <button type="button" onClick={onRun} disabled={busy} data-testid="cc-expiry-run">
          {busy ? "scoring…" : state ? "re-score expiry" : "score expiry"}
        </button>
      </div>
      {/* WHY THE REGIME IS AN INPUT AND NOT A RESULT. `regime` above can DETECT a
          regime; this panel will not silently take it. The two routes disagree
          about the vocabulary — `detectRegime`'s legacy read is the four labels
          below, while its own `regimeEngine` block is uppercased and includes
          `UNCERTAIN`, which `optimizeExpiry` would score down its ranging branch
          without saying so — so a chain would have to pick one and picking wrong
          is silent. The regime a score was computed under is named on the
          score, which is what makes it attributable. */}
      <p className="muted small">
        The regime and signal strength below are inputs to this calculation, not
        outputs of it, and they are what the scores below were drawn under.
      </p>
      <CandleInputs refs={refs} testIdBase="cc-expiry" label="expiry" />
      <select
        ref={(el) => { refs.current.regime = el }}
        defaultValue="ranging"
        aria-label="expiry regime"
        data-testid="cc-expiry-regime"
      >
        {EXPIRY_REGIMES.map((r) => (
          <option key={r} value={r}>
            regime {r}
          </option>
        ))}
      </select>
      <input
        ref={(el) => { refs.current.strength = el }}
        type="text"
        defaultValue="0.5"
        aria-label="signal strength"
        data-testid="cc-expiry-strength"
      />

      {error ? (
        <div className="panel muted" data-testid="cc-expiry-error">
          <p>expiry unavailable — {error}</p>
        </div>
      ) : null}

      {!state && !error ? (
        <p className="muted small" data-testid="cc-expiry-idle">
          not yet scored.
        </p>
      ) : null}

      {state ? <MeasuredAt at={state.measuredAt} testId="cc-expiry-measured-at" /> : null}
      {state ? <OriginLine origin={state.origin} testId="cc-expiry-origin" /> : null}
      {state ? <ExpiryReadout result={state.data} sentBars={state.origin.sentBars} /> : null}
    </div>
  )
}

function ExpiryReadout({
  result,
  sentBars
}: {
  result: ExpiryResult
  sentBars: number
}) {
  // `sent` is read off the RESULT, not off anything captured at click time, so
  // the regime and strength printed here are the ones that travelled with THIS
  // response rather than the ones a re-render happened to leave lying around.
  const { data, sent } = result
  return (
    <div data-testid="cc-expiry-result">
      {/* THE INPUTS, BESIDE EVERY SCORE BELOW THEM. `optimizeExpiry` invents a
          regime and a strength when they are absent and never reports which it
          used, so a score without these two lines is unattributable advice. */}
      <p className="muted small" data-testid="cc-expiry-inputs">
        sent regime {sent.regime} · sent signal strength {sent.signalStrength}
      </p>

      {expiryIsScored(data) ? (
        <>
          <p data-testid="cc-expiry-recommended">
            recommended expiry {data.recommended.label} · score{" "}
            {measured(data.recommended.score, "the service scored nothing")} · expected move{" "}
            {measured(data.recommended.expectedMove ?? null, "this option carries no expected move")}
          </p>
          {/* `formatNum`, NOT a truthiness test: a flat series makes both of these
              exactly 0 (`expiryOptimizer.mjs:25-26`) and that 0 is a real
              measurement. Collapsing it to "absent" would be the opposite defect
              from the one the unscored branch below guards against. */}
          <p className="muted small" data-testid="cc-expiry-vol">
            volatility {formatNum(data.volatility)} · average move {formatNum(data.avgMove)}
          </p>
          <div data-testid="cc-expiry-scores">
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.all.map((o) => (
                <li key={o.label} className="muted small" data-testid={`cc-expiry-score-${o.label}`}>
                  {o.label} ({o.seconds}s): score {o.score} · expected move{" "}
                  {formatNum(o.expectedMove ?? null)}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <ExpiryUnscoredResult data={data} sent={sent} sentBars={sentBars} />
      )}
    </div>
  )
}

/**
 * UNDER 20 BARS — THE SERVICE'S REFUSAL, RENDERED AS A REFUSAL.
 *
 * This branch used to receive the service's own `"1m"` table entry under the
 * field name `recommended`, with every option carrying a literal `score: 50`,
 * and it used to render that constant back as an explanation of where the 1m
 * came from. Nothing was computed over those bars, so the panel's refusal to
 * call it a recommendation was the ONLY thing between a literal and an operator
 * told to take a 1-minute trade.
 *
 * `optimizeExpiry` now refuses at the source: `recommended` is `null`, every
 * option's `score` is `null`, and `recommendation.reason` names the count that
 * arrived. This panel prints THAT sentence, so the sentence on screen is the one
 * in the payload rather than a restatement of it that could drift from it.
 */
function ExpiryUnscoredResult({
  data,
  sent,
  sentBars
}: {
  data: ExpiryResponse
  sent: ExpirySent
  sentBars: number
}) {
  return (
    <div className="panel muted" data-testid="cc-expiry-unscored">
      <p data-testid="cc-expiry-unscored-reason">NOT SCORED — no expiry is recommended</p>
      <p className="muted small">
        {/* THE SERVICE'S OWN WORDS, NOT A RESTATEMENT OF THEM. This branch used to
            receive the service's own `"1m"` table entry under the field name
            `recommended` and print it back as an explanation of where the 1m came
            from. The service now refuses, so there is no constant left to explain
            and the sentence to print is the reason IT gave — which is the only
            version that can be checked against the payload. */}
        {data.recommendation.reason}. {sentBars} bar(s) were sent and it needs{" "}
        {data.recommendation.requiredCandles} before it scores anything. On this branch every
        option carries no score at all, and the response carries no volatility or average move,
        so no score, no volatility and no table are shown. It was asked for regime {sent.regime}{" "}
        at signal strength {sent.signalStrength}, and neither could be applied.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------
// Adaptive stops
// ---------------------------------------------------------------------

/**
 * THE ANSWER CARRIES THE DIRECTION IT WAS COMPUTED FOR.
 *
 * `StopsReadout` used to be handed `refs.current.direction.value` at RENDER time,
 * which is not the direction that was sent: the select is uncontrolled, so
 * flipping it while a run is in flight left the panel printing "direction down"
 * beside take-profit and stop-loss levels computed for an UP trade — and for a
 * short, a take profit above the stop loss is an internally contradictory order.
 * Reading the ref therefore breaks this file's own invariant at the header ("the
 * value read at click time is the value sent"), so the direction is captured into
 * the RESULT beside the levels it produced, exactly as `ExpiryResult` already does
 * with `sent`.
 */
interface StopsResult {
  data: AdaptiveStopsResponse
  /** The direction these levels were computed FOR, not the one now selected. */
  direction: StopsDirection
}

function AdaptiveStopsPanel() {
  const refs = useRef<Refs>({})
  const { state, busy, error, run, refuse } = useCalculator<StopsDirection, StopsResult>(
    async (candles, origin, direction) => ({
      // `timeframe` IS THE SMOOTHING WINDOW HERE. `handlers.mjs:5748` passes it as
      // `{ atrPeriod: timeframe }`, so the number below is not a bar size and not
      // a label — it is how many bars the ATR is averaged over.
      data: await fetchAdaptiveStops(candles, direction, origin.timeframeSeconds),
      direction
    })
  )

  function onRun() {
    const inputs = readInputs(refs, "adaptive stops")
    if ("error" in inputs) {
      refuse(inputs.error)
      return
    }
    const direction = (refs.current.direction?.value ?? "up") as StopsDirection
    void run(inputs, direction)
  }

  return (
    <div className="panel" data-testid="cc-stops">
      <div className="panel-head">
        <strong>Adaptive stops</strong>
        <button type="button" onClick={onRun} disabled={busy} data-testid="cc-stops-run">
          {busy ? "computing…" : state ? "recompute stops" : "compute stops"}
        </button>
      </div>
      {/* THE NAME COLLISION, STATED WHERE AN OPERATOR WILL MEET IT. The route
          reads `body.timeframe` and hands it to `computeAdaptiveStops` as
          `atrPeriod`, so the bar size chosen here is also how many bars the ATR
          is averaged over — and the regime route above reads a `timeframe` in the
          same request family as a string label. The window needs that many bars
          before it produces anything, which is why the readout below names it. */}
      <p className="muted small">
        Take profit and stop loss at regime-adaptive multiples of the ATR. The bar
        size below doubles as the ATR smoothing window, so a wide window over a
        short series can produce no stops at all.
      </p>
      <CandleInputs refs={refs} testIdBase="cc-stops" label="stops" />
      <select
        ref={(el) => { refs.current.direction = el }}
        defaultValue="up"
        aria-label="trade direction"
        data-testid="cc-stops-direction"
      >
        <option value="up">direction up (long)</option>
        <option value="down">direction down (short)</option>
      </select>

      {error ? (
        <div className="panel muted" data-testid="cc-stops-error">
          <p>adaptive stops unavailable — {error}</p>
        </div>
      ) : null}

      {!state && !error ? (
        <p className="muted small" data-testid="cc-stops-idle">
          not yet computed.
        </p>
      ) : null}

      {state ? <MeasuredAt at={state.measuredAt} testId="cc-stops-measured-at" /> : null}
      {state ? <OriginLine origin={state.origin} testId="cc-stops-origin" /> : null}
      {state ? <AtrPeriodLine origin={state.origin} /> : null}
      {state ? <StopsReadout result={state.data} /> : null}
    </div>
  )
}

/**
 * THE WINDOW THE SERVER WILL ACTUALLY USE, AND WHETHER THE SERIES CAN FEED IT.
 *
 * `smma` returns null for its first `period - 1` bars, so an ATR over a window
 * wider than the series is null throughout and the service answers
 * `atr-unobservable`. Saying that here turns a confusing refusal into a legible
 * one, and the warning is derived from the bars actually sent rather than the
 * bars requested.
 */
function AtrPeriodLine({ origin }: { origin: SeriesOrigin }) {
  const tooShort = origin.sentBars < origin.timeframeSeconds
  return (
    <p className="muted small" data-testid="cc-stops-atrperiod">
      ATR period {origin.timeframeSeconds} — the route passes the timeframe as the
      smoothing window, so the ATR needs {origin.timeframeSeconds} bars before it
      yields anything, and {origin.sentBars} bar(s) were sent.
      {tooShort ? " That window is too short for this series, so no ATR can exist." : ""}
    </p>
  )
}

/**
 * GATED ON `reason`, WHICH IS THE SERVICE'S OWN DISCRIMINATOR.
 *
 * NOT on whether an ATR arrived, and not on whether the stops are zero: the
 * `adx-unobservable` branch returns a real, non-null `atr` beside two null stops,
 * so an ATR-first gate would print a measured number where the operator needed a
 * stop. The ATR is still SHOWN on that branch — it was really measured — but it
 * is shown beside a statement that no stop was produced, so neither can be read
 * as the other.
 */
function StopsReadout({ result }: { result: StopsResult }) {
  // `direction` is read off the RESULT rather than off the live select, so the
  // levels on screen are always labelled with the direction they were computed
  // for — including while a later run is in flight against a different one.
  const { data, direction } = result
  if (!stopsAreMeasured(data)) {
    return (
      <div data-testid="cc-stops-result">
        <div className="panel muted" data-testid="cc-stops-refused">
          <p data-testid="cc-stops-refused-reason">
            NO STOPS — {data.reason}
          </p>
          <p className="muted small">
            The service measured what it could and refused the rest: an unobserved
            read never counts as a neutral vote, so it declines to pick multipliers
            for a trend it cannot see. No level is shown above because none was
            produced.
          </p>
        </div>
        <AtrAttribution data={data} />
      </div>
    )
  }

  return (
    <div data-testid="cc-stops-result">
      <p data-testid="cc-stops-measured">
        take profit {data.takeProfit} · stop loss {data.stopLoss} · direction{" "}
        {direction} · regime {data.regime}
      </p>
      <p className="muted small" data-testid="cc-stops-multipliers">
        drawn at take profit {data.multipliers.tp}x ATR and stop loss{" "}
        {data.multipliers.sl}x ATR — the {data.regime} row of the service&apos;s
        multiplier table
      </p>
      <AtrAttribution data={data} />
    </div>
  )
}

/**
 * THE TWO MEASUREMENTS BESIDE THE VERDICT, WITH THEIR ABSENCES KEPT APART.
 *
 * `atr` is measured on the `adx-unobservable` branch and absent on the other two;
 * `adx` is the reverse. Both use `Number.isFinite` rather than truthiness, so a
 * measured `0` — a real ranging read — prints as `0` and never as `absent`.
 */
function AtrAttribution({ data }: { data: AdaptiveStopsResponse }) {
  const hasAtr = Number.isFinite(data.atr)
  return (
    <>
      <p className="muted small" data-testid="cc-stops-atr">
        atr{" "}
        {hasAtr
          ? `${data.atr} — measured, and the levels above are multiples of it`
          : "absent — no measurable ATR on these candles, so no level could be drawn"}{" "}
        · {hasAtr && !stopsAreMeasured(data) ? "measured while no stop was produced" : ""}
      </p>
      <p className="muted small" data-testid="cc-stops-adx">
        adx{" "}
        {Number.isFinite(data.adx)
          ? String(data.adx)
          : "absent — ADX has not warmed up, so no trend regime is claimed"}{" "}
        · atr ratio{" "}
        {Number.isFinite(data.atrRatio) ? `${data.atrRatio}x` : "absent — this branch reports none"}
      </p>
    </>
  )
}