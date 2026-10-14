import { useRef, useState } from "react"
import { fetchOrderFlow, fetchRiskParity, fetchSentiment, fetchVolatility } from "@/lib/marketAnalysis"
import type {
  OrderFlowResponse,
  RiskParityResponse,
  SentimentResponse,
  VolAtr,
  VolEstimator,
  VolGarch,
  VolatilityResponse
} from "@/lib/marketAnalysis"

/**
 * Symbol analysis panels — the four analysis routes the frontend never called
 * (UI-2, wave 1 of the surface-less endpoint audit): volatility, sentiment,
 * risk-parity and order flow.
 *
 * NOTHING HERE FETCHES ON MOUNT, and the reason is not politeness. Three of the
 * four routes make the SERVER fetch data: `volatility` runs
 * `withTimeout(getHistory(symbol, "3mo"), 10000)` per symbol
 * (`handlers.mjs:5148`), `risk-parity` does it once per symbol in a list
 * (`handlers.mjs:5177`), and `sentiment` runs a news digest. Four panels firing
 * those on mount is four multi-second network calls nobody asked for, on a room
 * that already loads its own. Each panel is opt-in behind its own input and
 * button.
 *
 * EVERY RESULT KEEPS ITS SYMBOL AND ITS TIME. The symbol asked is kept beside
 * the symbol the server answered with, and the readout is stamped with when it
 * was fetched, because a panel that silently re-reads under the same label is
 * lying about when. Market data goes stale in minutes, so a stale hint rides
 * along after fifteen.
 *
 * THE GOVERNING RULE: NEVER PRESENT A COMPUTED NUMBER WITHOUT SAYING WHERE ITS
 * INPUTS CAME FROM. Three consequences are visible in the markup below:
 *
 *  - A refusal renders as a refusal CARRYING ITS REASON. A `400`, a `502`, an
 *    auth failure and the route's own 200-with-`ok:false` all produce a named
 *    reason and no readout region at all. A refusal clears any previous readout
 *    rather than sitting beside it, so a stale success can never be read as the
 *    answer to a failed question.
 *  - `orderflow.available === false` renders as NOT MEASURED. Its `cumulative`
 *    and `avgDelta` are `null` and its `imbalance` is the literal
 *    `"unavailable"`, and a renderer that reached for `0` would be inventing a
 *    flat tape nobody observed.
 *  - `risk-parity` DROPS SYMBOLS WITHOUT SAYING SO. The coverage line computes
 *    the requested set against the key set of `weights` — the only statement of
 *    coverage the payload makes — and names the difference rather than letting a
 *    quiet omission read as a complete portfolio.
 *
 * The inputs are UNCONTROLLED, read through a ref at click time. That is a test
 * decision as much as a design one: the harness these tests run in is not
 * configured for `act(...)`, so a controlled input needs the native-setter dance
 * to drive it from jsdom, and a ref removes that whole class of flake. It also
 * makes the identity of the answer exact — the value read at click time is the
 * value sent, so the symbol kept with the result cannot become a second source
 * of truth that drifts from what the server was asked.
 */

const STALE_AFTER_MS = 15 * 60 * 1000

function clockOf(when: number): string {
  return new Date(when).toLocaleTimeString()
}

/**
 * A measured number, or the word `absent`.
 *
 * `Number.isFinite` IS THE TEST, not truthiness and not `!= null`, so a measured
 * `0` still prints as `0` and never becomes `absent`. That distinction is the
 * whole point of the `| null` types: `0` is a measurement, `null` is the absence
 * of one, and a `value ?? 0` anywhere between here and the DOM destroys it.
 */
function formatNum(value: number | null): string {
  return Number.isFinite(value) ? String(value) : "absent"
}

/** The value, or `absent — <reason>`. Never a bare dash: a dash reads as "fine". */
function measured(value: number | null, reason: string): string {
  return Number.isFinite(value) ? String(value) : `absent — ${reason}`
}

interface OptIn<A, T> {
  state: { data: T; measuredAt: number } | null
  busy: boolean
  error: string | null
  run: (arg: A) => Promise<void>
  refuse: (reason: string) => void
}

/**
 * The opt-in state machine every panel here uses.
 *
 * A FAILURE CLEARS THE READOUT (`setState(null)`), which is the one place this
 * departs from the pre-mortem section's pattern. There a failure left the
 * previous readout on screen beside the error and the two could be read as one
 * answer; here the readout is per-symbol and per-moment, so a second question
 * that was refused must not leave the first question's answer standing under the
 * new label.
 */
function useOptIn<A, T>(load: (arg: A) => Promise<T>): OptIn<A, T> {
  const [state, setState] = useState<{ data: T; measuredAt: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(arg: A) {
    setBusy(true)
    setError(null)
    try {
      const data = await load(arg)
      setState({ data, measuredAt: Date.now() })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState(null)
    } finally {
      setBusy(false)
    }
  }

  /**
   * A REFUSAL RAISED BEFORE ANYTHING IS SENT, for an input this panel can tell is
   * unusable without asking. It clears the readout for the same reason `run`'s catch
   * does — the operator asked a second question and it was refused — and it goes
   * through the same `error` channel so there is one refusal surface per panel rather
   * than two that can disagree.
   */
  function refuse(reason: string) {
    setError(reason)
    setState(null)
    setBusy(false)
  }

  return { state, busy, error, run, refuse }
}

/**
 * The stamp every panel carries with its result, and the only place `Date.now()`
 * is read during render — so a stale hint appears on a subsequent render rather
 * than freezing a verdict at the moment of the read.
 */
function MeasuredAt({ at, testId }: { at: number; testId: string }) {
  const stale = Date.now() - at > STALE_AFTER_MS
  return (
    <p className="muted small" data-testid={testId}>
      fetched {clockOf(at)}
      {stale ? " — may be out of date, re-run to refresh" : ""}
    </p>
  )
}

export function MarketAnalysisSection() {
  return (
    <section className="panel" data-testid="market-analysis-section">
      <header className="panel-head">
        <h3>Symbol analysis</h3>
      </header>
      <p className="muted small" data-testid="market-analysis-note">
        Four server-fetched readouts the dashboard had no surface for. Each is
        opt-in and none reads on mount. An absent measurement renders as absent
        with its reason; it is never a zero, a dash or an empty row.
      </p>
      <VolatilityPanel />
      <SentimentPanel />
      <RiskParityPanel />
      <OrderFlowPanel />
    </section>
  )
}

// ---------------------------------------------------------------------
// Volatility
// ---------------------------------------------------------------------

function VolatilityPanel() {
  const input = useRef<HTMLInputElement>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const { state, busy, error, run } = useOptIn<string, VolatilityResponse>(fetchVolatility)

  function onRun() {
    const symbol = (input.current?.value ?? "").trim().toUpperCase()
    if (!symbol) return
    setAsked(symbol)
    void run(symbol)
  }

  return (
    <div className="panel" data-testid="market-vol">
      <div className="panel-head">
        <strong>Volatility</strong>
        <button type="button" onClick={onRun} disabled={busy} data-testid="market-vol-run">
          {busy ? "reading…" : state ? "re-read volatility" : "read volatility"}
        </button>
      </div>
      <p className="muted small">
        The server fetches three months of history itself (`handlers.mjs:5148`),
        so this is a read of the server&apos;s snapshot, not of anything this page
        computed.
      </p>
      <input
        ref={input}
        type="text"
        placeholder="EURUSD"
        aria-label="symbol"
        data-testid="market-vol-symbol"
      />

      {error ? (
        <div className="panel muted" data-testid="market-vol-error">
          <p>volatility unavailable — {error}</p>
          <p className="muted small">
            no readout is shown rather than an empty one that would read as
            &quot;nothing to report&quot;.
          </p>
        </div>
      ) : null}

      {!state && !error ? (
        <p className="muted small" data-testid="market-vol-idle">
          not yet read.
        </p>
      ) : null}

      {state ? <MeasuredAt at={state.measuredAt} testId="market-vol-measured-at" /> : null}

      {state ? <VolatilityResult data={state.data} asked={asked} /> : null}
    </div>
  )
}

function VolatilityResult({
  data,
  asked
}: {
  data: VolatilityResponse
  asked: string | null
}) {
  // THE ROUTE'S OWN REFUSAL, SERVED WITH HTTP 200. `volatilitySnapshot` declines
  // below 30 candles and the route spreads that after `ok: true`, so `ok` is the
  // only thing that distinguishes this from a measurement. Rendering it as an
  // empty panel would be the worst outcome available here: the panel would look
  // like it had been read and found quiet.
  if (data.ok === false) {
    return (
      <div className="panel muted" data-testid="market-vol-refused">
        <p>volatility refused — {data.error}</p>
        <p className="muted small" data-testid="market-vol-refused-symbol">
          asked for {asked ?? "—"}; the server resolved {data.symbol}
          {data.name ? ` (${data.name})` : ""}. No estimator is shown below,
          because none was computed.
        </p>
      </div>
    )
  }

  return (
    <div data-testid="market-vol-result">
      <p>
        <strong>{data.symbol}</strong>
        {data.name ? ` — ${data.name}` : ""}
      </p>
      {/* THE SAMPLE, BESIDE EVERY NUMBER BELOW IT. Four estimators that can each
          decline independently, printed bare, would let a reader take whichever
          one happened to produce a number as the volatility of the asset. */}
      <p className="muted small" data-testid="market-vol-sample">
        asked for {asked ?? "—"} · server answered {data.symbol} · {data.candleCount}{" "}
        usable candles · last price {data.lastPrice}
      </p>
      <p className="muted small" data-testid="market-vol-stamp">
        snapshot stamped {data.timestamp}
      </p>

      <div data-testid="market-vol-atr">
        <strong>ATR regime: </strong>
        <AtrReadout atr={data.atr} />
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {(
          [
            ["realized", "close-close", data.realized],
            ["parkinson", "parkinson (high/low)", data.parkinson],
            ["garmanKlass", "garman-klass (OHLC)", data.garmanKlass],
            ["yangZhang", "yang-zhang (overnight gaps)", data.yangZhang]
          ] as const
        ).map(([key, label, est]) => (
          <li key={key} className="muted small" data-testid={`market-vol-est-${key}`}>
            {label} annual: <EstimatorReadout est={est} />
          </li>
        ))}
      </ul>

      <div data-testid="market-vol-garch">
        <strong>GARCH(1,1): </strong>
        <GarchReadout garch={data.garch} />
      </div>
    </div>
  )
}

function EstimatorReadout({ est }: { est: VolEstimator }) {
  if (est.annual === null) {
    // NO REASON IS INVENTED HERE. The server returns the requested `period` and
    // two nulls; it sends no reason string, so the panel says what it has.
    return <>absent — too few closes for a {est.period}-bar window (route sends no reason)</>
  }
  return (
    <>
      {est.annual} ({est.annualPct}) · daily {formatNum(est.daily)} · over {est.period} bars
      {est.sampleSize === undefined ? "" : ` · ${est.sampleSize} log returns`}
    </>
  )
}

function AtrReadout({ atr }: { atr: VolAtr }) {
  if (atr.atr === null) {
    return <>{atr.regime} — atr absent, percentile absent (the route sends no reason)</>
  }
  return (
    <>
      {atr.regime} · atr {atr.atr} ({atr.atrPctPct} of price) · {atr.percentile}th percentile
      of its own history · avg atr {atr.avgAtr} ·{" "}
      {atr.shrinking ? "atr is shrinking" : "atr is not shrinking"}
      {atr.breakoutWarning ? " · breakout warning" : ""}
    </>
  )
}

function GarchReadout({ garch }: { garch: VolGarch }) {
  // A GARCH that did not fit is a model that did not fit. `ok: false` carries four
  // nulls and an empty forecast, and printing those as `omega 0` would assert a
  // coefficient nobody estimated.
  if (garch.ok === false) {
    return <>absent — the model did not fit (needs 70+ closes); every parameter is null, not zero</>
  }
  return (
    <>
      current vol {garch.currentVol} ({garch.currentVolPct}) · omega {garch.omega} · alpha{" "}
      {garch.alpha} · beta {garch.beta} · persistence {garch.persistence} · long-run vol{" "}
      {garch.longRunVol} · fitted over {garch.sampleSize} log returns
      {garch.forecast.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {garch.forecast.map((f) => (
            <li key={f.step} className="muted small" data-testid="market-vol-garch-forecast">
              +{f.step} step(s): {f.volatility} ({f.volatilityPct})
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------

function SentimentPanel() {
  const input = useRef<HTMLInputElement>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const { state, busy, error, run } = useOptIn<string, SentimentResponse>(fetchSentiment)

  function onRun() {
    const symbol = (input.current?.value ?? "").trim()
    if (!symbol) return
    setAsked(symbol)
    void run(symbol)
  }

  return (
    <div className="panel" data-testid="market-sent">
      <div className="panel-head">
        <strong>Sentiment</strong>
        <button type="button" onClick={onRun} disabled={busy} data-testid="market-sent-run">
          {busy ? "reading…" : state ? "re-read sentiment" : "read sentiment"}
        </button>
      </div>
      <p className="muted small">
        News plus a self-derived volume leg. This engine has no neutral default:
        a score it cannot compute is reported absent with a reason, because a `0`
        on the band is indistinguishable from a measured neutral.
      </p>
      <input
        ref={input}
        type="text"
        placeholder="EUR/USD or 12345"
        aria-label="symbol"
        data-testid="market-sent-symbol"
      />

      {error ? (
        <div className="panel muted" data-testid="market-sent-error">
          <p>sentiment unavailable — {error}</p>
        </div>
      ) : null}

      {!state && !error ? (
        <p className="muted small" data-testid="market-sent-idle">
          not yet read.
        </p>
      ) : null}

      {state ? <MeasuredAt at={state.measuredAt} testId="market-sent-measured-at" /> : null}

      {state ? (
        <div data-testid="market-sent-result">
          {/* `unavailableReading` ECHOES THE ORIGINAL SYMBOL back as `symbol`, so a
              null `symbol` does not identify the unsearchable reading — the fact
              that does is `normalizedSymbol: null`, meaning the engine could not
              reduce the input to a canonical ticker and therefore never asked a
              source anything. Reading the wrong field here would print
              "server answered 12345" beside a reading that named nothing. */}
          <p className="muted small" data-testid="market-sent-head">
            asked for {asked ?? "—"} · server answered{" "}
            {"normalizedSymbol" in state.data && state.data.normalizedSymbol === null
              ? "nothing — the symbol is not searchable"
              : state.data.symbol ?? "nothing — the server named no symbol"}
          </p>

          {/* THE ABSENCE CARRIES ITS REASON AND NOTHING ELSE. No score cell, no
              zero, no "neutral" — the engine refused to produce one. */}
          {state.data.composite === null ? (
            <div className="panel muted" data-testid="market-sent-composite-absent">
              <p>
                no composite — {state.data.reason ?? "the route sent no reason"}
              </p>
            </div>
          ) : (
            <div data-testid="market-sent-composite">
              <p>
                composite {state.data.composite.score} · {state.data.composite.label}
                {state.data.composite.extreme ? " · extreme" : ""}
              </p>
              {/* THE BAND THE LABEL WAS DRAWN FROM. With the derived social leg
                  absent the composite reaches only the news leg's declared 0.6,
                  and the engine deliberately does not renormalise — so the label
                  is NOT on the 0.6+0.4 scale and must not be read as if it were. */}
              <p className="muted small" data-testid="market-sent-weight">
                reached {state.data.composite.declaredLegWeightReached} of the declared leg
                weight · legs present: {state.data.composite.legsPresent.join(", ")} · news
                contribution {state.data.composite.weighted.news} · social contribution{" "}
                {measured(
                  state.data.composite.weighted.social,
                  state.data.socialUnavailableReason ?? "the route sent no reason"
                )}
              </p>
            </div>
          )}

          {state.data.news === null ? (
            <div className="muted small" data-testid="market-sent-news-absent">
              news leg absent —{" "}
              {state.data.newsUnavailableReason ?? "the route sent no reason"}
            </div>
          ) : (
            <div className="muted small" data-testid="market-sent-news">
              news leg {state.data.news.score} over {state.data.news.sampleSize} item(s):{" "}
              {state.data.news.bullish} bullish / {state.data.news.bearish} bearish /{" "}
              {state.data.news.neutral} neutral · sources{" "}
              {state.data.news.sources.length > 0 ? state.data.news.sources.join(", ") : "none named"}{" "}
              · licence checked:{" "}
              {state.data.news.verified === null ? "no" : String(state.data.news.verified)}
            </div>
          )}

          {state.data.social === null ? (
            <div className="muted small" data-testid="market-sent-social-absent">
              social leg absent —{" "}
              {state.data.socialUnavailableReason ?? "the route sent no reason"}
            </div>
          ) : (
            <div className="muted small" data-testid="market-sent-social">
              social-derived leg {state.data.social.score} · velocity {state.data.social.velocity}{" "}
              · {state.data.social.historySize} measured composite(s) in its history
            </div>
          )}

          {/* `observedAt` AND `timestamp` ARE DIFFERENT FACTS. The first is when
              sentiment was last MEASURED and is null whenever no composite has
              ever been produced; the second is when the engine last ran. Reading
              `timestamp` as the first is what makes an unused engine look live. */}
          <div className="muted small" data-testid="market-sent-observed">
            {state.data.observedAt === null
              ? "never observed — no composite has been measured"
              : `measured at ${clockOf(state.data.observedAt)}`}{" "}
            · engine last ran at {clockOf(state.data.timestamp)}
          </div>

          {"unprovenanced" in state.data && state.data.unprovenanced.length > 0 ? (
            <div className="muted small" data-testid="market-sent-unprovenanced">
              {state.data.unprovenanced.length} digest item(s) arrived without
              provenance and were not scored: {state.data.unprovenanced.join(" · ")}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------
// Risk parity
// ---------------------------------------------------------------------

function parseSymbols(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
}

function RiskParityPanel() {
  const input = useRef<HTMLInputElement>(null)
  const [asked, setAsked] = useState<string[] | null>(null)
  const { state, busy, error, run } = useOptIn<string[], RiskParityResponse>(fetchRiskParity)

  function onRun() {
    const symbols = parseSymbols(input.current?.value ?? "")
    if (symbols.length === 0) return
    setAsked(symbols)
    void run(symbols)
  }

  return (
    <div className="panel" data-testid="market-rp">
      <div className="panel-head">
        <strong>Risk parity</strong>
        <button type="button" onClick={onRun} disabled={busy} data-testid="market-rp-run">
          {busy ? "allocating…" : state ? "re-allocate" : "allocate"}
        </button>
      </div>
      <p className="muted small">
        Comma-separated symbols. The list is required: leaving it blank makes the
        server substitute its own watchlist, and the response does not enumerate
        what it substituted, so coverage could not be stated at all.
      </p>
      <input
        ref={input}
        type="text"
        placeholder="EURUSD, BTCUSD, ETHUSD"
        aria-label="symbols"
        data-testid="market-rp-symbols"
      />

      {error ? (
        <div className="panel muted" data-testid="market-rp-error">
          <p>risk parity unavailable — {error}</p>
          <p className="muted small">
            no allocation is shown rather than an empty one that would read as
            &quot;nothing to allocate&quot;.
          </p>
        </div>
      ) : null}

      {!state && !error ? (
        <p className="muted small" data-testid="market-rp-idle">
          not yet allocated.
        </p>
      ) : null}

      {state ? <MeasuredAt at={state.measuredAt} testId="market-rp-measured-at" /> : null}

      {state ? <RiskParityResult data={state.data} asked={asked} /> : null}
    </div>
  )
}

function RiskParityResult({
  data,
  asked
}: {
  data: RiskParityResponse
  asked: string[] | null
}) {
  if (data.ok === false) {
    return (
      <div className="panel muted" data-testid="market-rp-refused">
        <p>risk parity refused — {data.error}</p>
        <p className="muted small">
          {data.weights === null
            ? "the route refused before any allocation ran"
            : "the allocator refused after fetching"}
          , so no weights exist and none are shown.
        </p>
      </div>
    )
  }

  const present = Object.keys(data.weights).sort((a, b) => a.localeCompare(b))
  const requested = asked ?? []
  const absent = requested.filter((s) => !present.includes(s))

  return (
    <div data-testid="market-rp-result">
      <p data-testid="market-rp-method">
        method {data.method}
        {data.iterations === null ? "" : ` · ${data.iterations} solver iterations`}
      </p>

      {/* THE COVERAGE LINE, WHICH IS THE POINT OF THIS PANEL.
          `weights`' key set is the ONLY statement of coverage the payload makes.
          The route drops a symbol whose history fetch failed or held under 30
          closes, and the allocator then keeps only symbols with 65+ closes in its
          60-close window — and neither drop is reported. So the panel states how
          many requested symbols are actually present, names the ones that are
          not, and says plainly that the mechanism is unknown. A reader who is not
          told which assets are missing will size a portfolio that is missing
          assets and call it diversified. */}
      <div className="panel muted" data-testid="market-rp-coverage">
        <p data-testid="market-rp-coverage-count">
          coverage: {present.length} of {requested.length} requested symbol(s) carry a weight
        </p>
        <p data-testid="market-rp-coverage-present">
          in the allocation: {present.length > 0 ? present.join(", ") : "none"}
        </p>
        {absent.length > 0 ? (
          <p data-testid="market-rp-coverage-absent">
            requested but NOT in the allocation: {absent.join(", ")}. The route drops a
            symbol whose three-month history failed or held fewer than 30 closes, and
            the allocator keeps only symbols with 65 or more closes in its 60-close
            window. The response reports neither, so which mechanism applied to any of
            these is unknown.
          </p>
        ) : (
          <p className="muted small" data-testid="market-rp-coverage-absent-none">
            every requested symbol carries a weight.
          </p>
        )}
        {data.symbolCount !== null && data.symbolCount !== present.length ? (
          <p data-testid="market-rp-count-mismatch">
            the allocation also reports symbolCount {data.symbolCount} against{" "}
            {present.length} weight(s) — the difference had no usable volatility and was
            dropped from the weights without being named.
          </p>
        ) : null}
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {present.map((symbol) => (
          <li key={symbol} className="muted small" data-testid={`market-rp-weight-${symbol}`}>
            {symbol}: weight {data.weights[symbol]} · annual vol{" "}
            {data.vols === null ? "absent — this branch reports no vols" : formatNum(data.vols[symbol])}
          </li>
        ))}
      </ul>

      {/* THE 0 ON THE WIRE IS NOT ALWAYS A MEASUREMENT.
          `riskParity.mjs:154` returns `{ok:true, weights:{X:1}, method:"single-asset",
          portfolioVol: 0}` — that `0` is a LITERAL CONSTANT sitting above the
          covariance build at `:157`, returned before any volatility is computed,
          and the same branch omits `vols` entirely. So `measured(0, ...)` passes its
          own `Number.isFinite` test and prints `portfolio vol: 0` two lines below
          `X: weight 1 · annual vol absent`. Two lines apart, one unmeasured thing is
          called an absence and the other a measurement. An operator allocating a
          single asset would read that as "this position carries no risk".

          THE GATE IS ON `method`, NEVER ON THE VALUE. The ERC branch really does
          compute a portfolio vol (`riskParity.mjs:100`, floored at `1e-12` and
          rounded to 4dp), so an ERC response can legitimately serve `portfolioVol: 0`
          — and a measured zero must still print as `0`. Collapsing zeros by value
          would trade this defect for the opposite one. */}
      <div className="muted small" data-testid="market-rp-portfolio">
        portfolio vol:{" "}
        {data.method === "single-asset" ? (
          <span data-testid="market-rp-portfolio-absent">
            absent — the single-asset branch sends the literal 0 without computing a
            volatility
          </span>
        ) : (
          <span data-testid="market-rp-portfolio-vol">
            {measured(data.portfolioVol, "this branch reports no portfolio vol")}
          </span>
        )}
        {data.portfolioVolPct === null ? "" : ` (${data.portfolioVolPct})`}
      </div>

      {data.riskContributions === null ? null : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {data.riskContributions.map((rc) => (
            <li key={rc.symbol} className="muted small" data-testid={`market-rp-rc-${rc.symbol}`}>
              {rc.symbol}: weight {rc.weight} · risk contribution {rc.riskContribution}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Order flow
// ---------------------------------------------------------------------

function OrderFlowPanel() {
  const input = useRef<HTMLInputElement>(null)
  const { state, busy, error, run, refuse } = useOptIn<number | undefined, OrderFlowResponse>(
    fetchOrderFlow
  )

  /**
   * THE LOOKBACK IS VALIDATED, BUT ONLY AGAINST WHAT JSON CANNOT CARRY.
   *
   * `JSON.stringify({lookback: NaN})` is `{"lookback":null}`, and this route never
   * validates what it is given — `orderFlow.mjs` reads `lookback` only to echo it
   * back on both branches. So an unvalidated panel turned an operator's typo into a
   * server-side null that came home as a silently-absent echo, indistinguishable
   * from the server having no lookback at all. Refusing by name beats that.
   *
   * NO RANGE RULE IS INVENTED HERE. The server has none — a negative or fractional
   * lookback is echoed straight back — so this checks only that the value is a
   * finite number. Anything stricter would be a client-side policy the server does
   * not share, and a panel that refuses inputs the server accepts is its own kind
   * of dishonesty.
   */
  function onRun() {
    const raw = (input.current?.value ?? "").trim()
    // Blank is the documented "server default" and stays a real request.
    if (raw === "") {
      void run(undefined)
      return
    }
    const lookback = Number(raw)
    if (!Number.isFinite(lookback)) {
      refuse(`lookback "${raw}" is not a finite number — nothing was sent`)
      return
    }
    void run(lookback)
  }

  return (
    <div className="panel" data-testid="market-of">
      <div className="panel-head">
        <strong>Order flow</strong>
        <button type="button" onClick={onRun} disabled={busy} data-testid="market-of-run">
          {busy ? "reading…" : state ? "re-read order flow" : "read order flow"}
        </button>
      </div>
      {/* NO SYMBOL INPUT, AND THAT IS THE POINT. This route takes no symbol, and
          it deliberately refuses a client-supplied `trades` series
          (`handlers.mjs:5727`): a caller could otherwise manufacture an
          `available: true` readout out of invented fills. So the only thing this
          panel can send is a lookback, and what it gets back is a refusal that
          names itself. */}
      <p className="muted small" data-testid="market-of-contract">
        No symbol and no trades are sent. This route takes neither: OHLCV bars carry
        no aggressor-side information, so delta, CVD and absorption cannot be derived
        from candle structure, and a client-supplied trade series would let any caller
        manufacture an available readout. Expect a refusal until a server-side
        signed-trades feed exists.
      </p>
      <input
        ref={input}
        type="text"
        placeholder="lookback (blank = 20)"
        aria-label="lookback"
        data-testid="market-of-lookback"
      />

      {error ? (
        <div className="panel muted" data-testid="market-of-error">
          <p>order flow unavailable — {error}</p>
        </div>
      ) : null}

      {!state && !error ? (
        <p className="muted small" data-testid="market-of-idle">
          not yet read.
        </p>
      ) : null}

      {state ? <MeasuredAt at={state.measuredAt} testId="market-of-measured-at" /> : null}

      {state ? (
        <div data-testid="market-of-result">
          {state.data.available === false ? (
            <div className="panel muted" data-testid="market-of-unavailable">
              {/* AN ABSENCE IS NOT A ZERO. `cumulative` and `avgDelta` are null and
                  `imbalance` is the literal "unavailable". Rendering `0` here would
                  assert a flat tape nobody observed, and printing the imbalance
                  would put the word "neutral" on the page — which is the exact
                  fabrication the `orderFlow.mjs` contract removed. */}
              <p>NOT MEASURED — order flow is an absence, not a neutral tape.</p>
              <p className="muted small" data-testid="market-of-reason">
                {state.data.reason}
              </p>
              <p className="muted small" data-testid="market-of-fidelity">
                data fidelity: {state.data.dataFidelity} · cumulative{" "}
                {formatNum(state.data.cumulative)} · average delta{" "}
                {formatNum(state.data.avgDelta)} · imbalance {state.data.imbalance}
              </p>
            </div>
          ) : (
            <div data-testid="market-of-measured">
              <p>
                cumulative {state.data.cumulative} · average delta {state.data.avgDelta} ·
                imbalance {state.data.imbalance}
              </p>
              <p className="muted small" data-testid="market-of-fidelity">
                data fidelity: {state.data.dataFidelity} · source {state.data.source} ·{" "}
                {state.data.delta.length} print(s)
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {state.data.signals.map((s, i) => (
                  <li key={`${s.type}-${i}`} className="muted small" data-testid="market-of-signal">
                    {s.type}: {s.desc}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted small" data-testid="market-of-lookback-echo">
            lookback {formatNum(state.data.lookback)}
          </p>
        </div>
      ) : null}
    </div>
  )
}