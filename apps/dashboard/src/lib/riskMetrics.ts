import {
  calculateCalmarRatio,
  calculateHistoricalVaR,
  calculateMaxDrawdown,
  calculateMonteCarloVaR,
  calculateParametricVaR,
  calculateSharpeRatio,
  calculateSortinoRatio
} from "@railpath/finance-toolkit"

/**
 * Minimum number of per-trade returns before any risk metric can be
 * reported. The paper equity curve needs >= MIN_OBSERVATIONS + 1 points so
 * that at least MIN_OBSERVATIONS consecutive per-trade returns exist (the
 * first equity point is the starting balance). The default paper history
 * limit (50 closed trades) comfortably exceeds this; below it the wrapper
 * returns null so the card can show an honest "insufficient history" state
 * instead of fabricated zeros.
 */
export const MIN_OBSERVATIONS = 20

export interface RiskMetrics {
  /** Number of per-trade returns that produced these metrics. */
  n: number
  /** Historical VaR at 95% — positive-loss magnitude (percent of equity). */
  historicalVaR: number
  /** Historical CVaR at 95% — positive-loss magnitude. */
  historicalCVaR: number
  /** Parametric (normal) VaR at 95% — positive-loss magnitude. */
  parametricVaR: number
  /** Parametric (normal) CVaR at 95% — positive-loss magnitude. */
  parametricCVaR: number
  /** Monte-Carlo VaR at 95% — positive-loss magnitude. Stochastic (seedless). */
  monteCarloVaR: number
  /** Sharpe ratio — per trade (annualizationFactor=1). */
  sharpe: number
  /** Sortino ratio — per trade. */
  sortino: number
  /** Calmar ratio (per-trade mean return / max drawdown) — per trade. */
  calmar: number
  /** Maximum drawdown, expressed as a positive percent (e.g. 12.5 = 12.5%). */
  maxDrawdownPct: number
}

/**
 * The toolkit's annualization factor scales a per-period (here per-trade)
 * metric up to an annual figure. The paper ledger records irregular,
 * per-trade intervals — annualizing would fabricate a yearly claim the data
 * cannot support — so every ratio is computed with annualizationFactor=1 and
 * never labelled "annualized" anywhere.
 */
const PER_TRADE = 1

/**
 * Derive a synthetic price path from per-trade returns by compounding from
 * starting price 1. Returns null if any price is non-finite or <= 0 (a price
 * <= 0 would break drawdown/Calmar and has no real-world meaning for a
 * compounding equity curve).
 */
function pricesFromReturns(returns: number[]): number[] | null {
  const prices: number[] = [1]
  for (const r of returns) {
    const next = prices[prices.length - 1] * (1 + r)
    if (!isFinite(next) || next <= 0) return null
    prices.push(next)
  }
  return prices
}

/**
 * Compute the paper-ledger risk metrics from a list of per-trade returns.
 *
 * Returns null when there is not enough history (fewer than MIN_OBSERVATIONS
 * returns), when any internal toolkit result is non-finite or degenerate
 * (standard deviation == 0, prices <= 0, etc.), or when no variance exists.
 * It NEVER returns NaN/Infinity to the UI — the card renders honest states
 * instead.
 *
 * VaR convention: the toolkit reports `value` and `cvar` as POSITIVE loss
 * magnitudes (absolute values of the worst tail losses). This wrapper keeps
 * that convention — consumers should display them as positive percentages.
 */
export function computeRiskMetrics(returns: number[]): RiskMetrics | null {
  if (!Array.isArray(returns) || returns.length < MIN_OBSERVATIONS) return null
  if (returns.some((r) => typeof r !== "number" || !isFinite(r))) return null

  const prices = pricesFromReturns(returns)
  if (prices === null) return null

  const CONF = 0.95

  const hist95 = calculateHistoricalVaR(returns, CONF)
  const param95 = calculateParametricVaR(returns, CONF)
  const mc95 = calculateMonteCarloVaR(returns, CONF, 10000)
  const sharpe = calculateSharpeRatio({ returns, riskFreeRate: 0, annualizationFactor: PER_TRADE })
  const sortino = calculateSortinoRatio({ returns, riskFreeRate: 0, targetReturn: 0, annualizationFactor: PER_TRADE })
  const calmar = calculateCalmarRatio({ prices, returns, annualizationFactor: PER_TRADE })
  const maxDd = calculateMaxDrawdown({ prices })

  // All ratio fields must at least be finite numbers before we report them.
  const ratioValues = [
    hist95.value, hist95.cvar, param95.value, param95.cvar, mc95.value,
    sharpe.sharpeRatio, sortino.sortinoRatio, calmar.calmarRatio,
    maxDd.maxDrawdownPercent
  ]

  const confLevelsOk =
    hist95.confidenceLevel === CONF &&
    param95.confidenceLevel === CONF &&
    mc95.confidenceLevel === CONF

  const histCvar = hist95.cvar
  const paramCvar = param95.cvar

  // The VaR family's `cvar` is optional; both historical and parametric runs
  // below always populate it, but TypeScript can only narrow the union when
  // we test for undefined on each value directly.
  if (histCvar == null || paramCvar == null) return null

  const allFinite =
    confLevelsOk &&
    hist95.value != null &&
    param95.value != null &&
    mc95.value != null &&
    ratioValues.every((v) => typeof v === "number" && isFinite(v))

  // The VaR family and max drawdown are positive-loss magnitudes; require
  // them to be >= 0 (a negative value would be a toolkit/guard bug).
  const positiveLossOk =
    hist95.value >= 0 && param95.value >= 0 && mc95.value >= 0 &&
    histCvar >= 0 && paramCvar >= 0 && maxDd.maxDrawdownPercent >= 0

  // Degenerate: an all-equal returns series has exactly zero variance, so
  // none of the ratios are meaningful. Due to floating point the toolkit's
  // sample std dev of N identical values can come out as a tiny non-zero
  // number, so detect degeneracy precisely via a zero range rather than a
  // near-zero std guard (a genuinely low-volatility but varying series is
  // still reportable).
  if (Math.max(...returns) - Math.min(...returns) === 0) return null

  if (!allFinite || !positiveLossOk) return null

  return {
    n: returns.length,
    historicalVaR: hist95.value,
    historicalCVaR: histCvar,
    parametricVaR: param95.value,
    parametricCVaR: paramCvar,
    monteCarloVaR: mc95.value,
    sharpe: sharpe.sharpeRatio,
    sortino: sortino.sortinoRatio,
    calmar: calmar.calmarRatio,
    maxDrawdownPct: maxDd.maxDrawdownPercent * 100
  }
}

