import { useRef, useState } from "react"
import type { RefObject } from "react"
import { fetchCandles } from "@/hooks/useCandleData"
import { TIMEFRAME_LABELS } from "@/hooks/useCandleData"
import type { Timeframe } from "@/hooks/useCandleData"
import { fetchRegime, regimeIsMeasured, toWireCandles } from "@/lib/candleCalculators"
import type {
  CandleOrigin,
  RegimeResponse,
  RegimeUnknown,
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

interface Calculator<A, T> {
  state: RunState<T> | null
  busy: boolean
  error: string | null
  run: (inputs: PanelInputs) => Promise<void>
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
 */
function useCalculator<T>(
  compute: (candles: WireCandle[], origin: SeriesOrigin) => Promise<T>
): Calculator<PanelInputs, T> {
  const [state, setState] = useState<RunState<T> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(inputs: PanelInputs) {
    setBusy(true)
    setError(null)
    try {
      const fetched = await fetchCandles(inputs.assetId, inputs.timeframeSeconds, inputs.bars)
      const { candles, dropped } = toWireCandles(fetched.rows)
      // ZERO USABLE BARS IS A REFUSAL BY NAME, not a request that returns a
      // well-formed answer about an empty market. `fetchCandles` filters
      // non-positive and non-numeric OHLC (`:169`), so a symbol that resolved but
      // held nothing usable arrives here as an empty array. Refusing names the
      // symbol and the range; sending it would let `detectRegime` answer
      // `regime: "unknown"` and be indistinguishable from a short series.
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
      const data = await compute(candles, origin)
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
  label
}: {
  refs: RefObject<Refs>
  testIdBase: string
  label: string
}) {
  const options = Object.entries(TIMEFRAME_LABELS)
    .map(([seconds, name]) => ({ seconds: Number(seconds), name: name as string }))
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
      {origin.verifiedCount}/{origin.sentBars} bar(s) cross-verified across{" "}
      {origin.verifySources} source(s)
    </p>
  )
}

function MeasuredAt({ at, testId }: { at: number; testId: string }) {
  const stale = Date.now() - at > STALE_AFTER_MS
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

function RegimePanel() {
  const refs = useRef<Refs>({})
  const { state, busy, error, run, refuse } = useCalculator<RegimeResponse>((candles, origin) =>
    // THE TIMEFRAME IS A LABEL HERE. `tfSecondsOf` (`regimeDetection.mjs:31`)
    // only understands strings like "1m"/"5m", and an unrecognised one resolves to
    // null — which silently drops the bias plane to 60s rather than failing.
    fetchRegime(candles, origin.timeframeLabel)
  )

  function onRun() {
    const inputs = readInputs(refs, "regime")
    if ("error" in inputs) {
      refuse(inputs.error)
      return
    }
    void run(inputs)
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
      <CandleInputs refs={refs} testIdBase="cc-regime" label="regime" />

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

function ExpiryPanel() {
  return <div className="panel" data-testid="cc-expiry-stub" />
}

// ---------------------------------------------------------------------
// Adaptive stops
// ---------------------------------------------------------------------

function AdaptiveStopsPanel() {
  return <div className="panel" data-testid="cc-stops-stub" />
}