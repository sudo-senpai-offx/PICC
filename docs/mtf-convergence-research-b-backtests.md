# MTF Convergence Research — Backtest & "Industry Review" Claims Audit (B)

**Date:** August 28, 2026

**How to read this note:** Each section verifies one claim about multi-timeframe (MTF) convergence backtest/win-rate results. For every claim this note gives (a) the claim as stated, (b) what was actually searched/fetched, (c) what actually exists (with verbatim quotes and the URLs fetched), (d) a source-quality grade, and (e) a "Meaning for PICC" line. Grades are **PRIMARY** (peer-reviewed research or independently operated/live-verified system), **SECONDARY** (non-peer-reviewed but expert/institutional), **WEAK** (self-published backtests or broker marketing), **UNFOUND** (no trace of the claimed figures), and **UNVERIFIED** (exists but could not be read/confirmed in-session). Quotes marked *(via search listing)* come from search-engine snippets of the page and their wording is reliable but not byte-exact; everything else was fetched and read directly in-session. Anything that could not be pinned down is listed under "Could not be verified." Unverified does not equal false — but per PICC's research rules, self-published backtest win rates are treated as WEAK evidence regardless of how neatly they match a thesis.

---

## B1. ThinkMarkets / "Industry Review": MTFA win rate 60–75%, single-TF 45%, "Fractal alignment dramatically improves odds"

**(a) Claim as stated.** An "industry review" (ThinkMarkets trading academy) states that multi-timeframe analysis (MTFA) lifts win rate to 60–75% vs ~45% for single-timeframe entry, and that "fractal alignment dramatically improves odds."

**(b) What was searched.** The ThinkMarkets MTFA article, the numbers "60-75"/"45", the "fractal alignment" phrase, and semantic variations. Article body was attempted 3× (markdown + html), plus a Google-cache route; the QuantifiedStrategies page that carries the same figures was attempted directly.

**(c) What actually exists.**

- ThinkMarkets does have the article, but its body could not be read and the specific figures could not be confirmed on it:
  - URL: `https://www.thinkmarkets.com/en/trading-academy/technical-analysis/mtfa-in-trading-how-to-trade-using-multi-timeframe-analysis/` (published 2026-01-19 per search listing).
  - Meta description (fetched): *"Learn indicators, tools and trading platform features and trade with multi timeframe analysis to spot better trading opportunities and improve entries and exits."* The page is JavaScript-rendered; all fetch attempts returned only navigation/meta boilerplate, and the Google-cache route was blocked.
- The exact "60–75% vs 45%" sentence lives on **QuantifiedStrategies.com** (Oddmund Groette), "Multi-Timeframe Analysis (Trading Strategy and Backtest)", 2026-03-01 — a self-published backtest blog, not ThinkMarkets:
  - URL: `https://www.quantifiedstrategies.com/multi-timeframe-analysis/`
  - *(via search listing)* *"Multi-timeframe analysis can significantly improve win rates, with reported success rates of 60-75% compared to 45% for single-timeframe analysis."*
  - The same QS page reports its own backtest: *(via search listing)* *"316 trades, avg gain 0.28%, win rate 73%, max DD -10%, PF 2"* — i.e. a real, but self-published, backtest. Direct fetch of the QS page was bot-blocked in-session.
- ThinkMarkets' own site throws similar unsourced win rates around on other pages (marketing pattern, e.g. its algorithmic-trading page: *(via search listing)* *"studies have reported rates around 76% for some forex algorithmic strategies"*; scalping page: *"many FX scalper strategies aim for a winning rate of over 60–70%"*). None cite a study.
- **"Fractal alignment dramatically improves odds"** — not found anywhere in-session (searched the phrase and semantic variants).
- Reinforcing note: the "75%" wins-bit claims in this genre are exactly what Bailey et al. (see B7) show is trivially producible by backtest overfitting.

**(d) Grade.** **PARTIALLY-VERIFIED / WEAK.** The article exists; the 60–75 vs 45 numbers exist but trace to QuantifiedStrategies' self-published backtest, not (as far as readable) ThinkMarkets; the "fractal alignment" phrase is UNFOUND.

**(e) Meaning for PICC.** Do not cite this as "ThinkMarkets/industry review of 60–75% win rate." If cited at all, the honest attribution is a QuantifiedStrategies *self-published* backtest (316 trades, 73% WR, PF 2) — WEAK evidence, and the magic "fractal alignment" phrasing should be dropped. Use B4 and B7 to counter the "MTF dramatically improves odds" narrative instead.

---

## B2. MQL5: RSI confluence across 3 TFs on XAUUSD — 61% win rate, 1.8 PF, 127 trades, "live-tested real money, 18 months"

**(a) Claim as stated.** A live-tested (real money) MQL5 strategy trading RSI confluence across 3 timeframes on XAUUSD achieved 61% win rate, 1.8 profit factor over 127 trades, tested live over 18 months.

**(b) What was searched.** MQL5 for the claim's story (RSI convergence, XAUUSD, 127 trades, win rate). The exact article was found and fetched.

**(c) What actually exists.** The article **exists verbatim with these numbers**, but its real-world scope is smaller and its independent verifiability is lower than the claim implies:

- **"RSI Multi-Timeframe Analysis in MQL5: What Actually Works for Scalping"** by Jaume Sancho Serra, in the MQL5 **Traders' Blogs → Trading Systems** category, published **11 Feb 2026** — i.e. a self-published trader blog, *not* an MQL5 Market "live trading" signal with independently audited stats.
  - URL: `https://www.mql5.com/en/blogs/post/767332` (fetched; quotes confirmed on-page / via search listing of the page)
  - *(via search listing)* *"from 42% (single TF) to 61% (multi TF) between October and December last year"*
  - *(via search listing)* *"Real money, Pepperstone account"* and *"127 trades, profit factor of 1.8, max drawdown 4.2%"*
- The "18 months" in the claim overstates the sample behind the 61% figure: the author's *total* time experimenting with RSI strategies on XAUUSD is ~18 months, but the 42%→61% comparison and the 127 trades cover roughly a 3-month window (October–December).

**(d) Grade.** **PARTIALLY-VERIFIED / WEAK.** All claimed numbers exist verbatim in the source, but the source is a self-published blog, the window behind the headline figures is ~3 months, and there is no independent verification of the "real money" claim.

**(e) Meaning for PICC.** Fine as a *plausible real-world anecdote* (real trader, real broker account, direction of improvement single-TF→multi-TF matches the thesis) — but it must be presented as an anecdote: n=127, unverified, self-reported, short window. Never upgraded to "live-verified."

---

## B3. HSI: MTF RSI confluence backtest (TradingView) — 54.3% win rate, 1.49 PF

**(a) Claim as stated.** A TradingView backtest on Hang Seng Index trading simultaneous RSI extremes on Daily/4H/1H achieved 54.3% win rate and 1.49 profit factor.

**(b) What was searched.** TradingView scripts, "HSI MTF RSI confluence", "HSI RSI confluence backtest", and the strategy's numbers cross-referenced against a real MTF strategy leaderboard.

**(c) What actually exists.** **No TradingView (or other) source with 54.3% / 1.49 was found.** The closest real artifact is a similarly-named strategy with different numbers:

- **PineScriptForge HSI** ("A Research Project by SMP", Hang Seng Index strategy leaderboard, 310 strategies): `https://pinescriptforge.com/hsi`
  - *(via search listing)* ranks **"MTF RSI Confluence Multi-Timeframe"** at **#50**: **systematic win rate 51.3%, PF 1.69, max DD 5.0%, 380 trades, 85% confidence.** (Direct fetch of the sub-page returned only JS boilerplate; the leaderboard figures come from the search listing of the parent page.)
  - This is a third-party PineScript-analysis site, *not* a `tradingview.com/script/...` page.
- **Number-contamination red flag:** the same PineScriptForge HSI page lists a **"Klinger Oscillator"** HSI strategy at **53.2% win rate / 1.87 PF — numerically identical to Claim B5's BTC/USD 5m figures.** Identical win-rate/PF pairs appearing on unrelated instruments/strategies is a strong sign the claimed figures circulate and get recycled between sources rather than being measured per strategy.

**(d) Grade.** **UNFOUND** (for 54.3% / 1.49 as claimed); the nearest real artifact (Confluence Multi-Timeframe, 51.3% / 1.69) is **UNVERIFIED** in detail and WEAK (third-party site, backtest-based).

**(e) Meaning for PICC.** Do not use 54.3% / 1.49. The genuinely-existing "HSI MTF RSI Confluence" backtest (51.3% WR, 1.69 PF, 380 trades) is a better candidate to cite — but it is still a self-published backtest with no out-of-sample or cost modeling shown, so keep it WEAK. The 53.2%/1.87 coincidence with B5 is a useful cautionary detail.

---

## B4. Bitcoin ML study (2020–2025): 4-TF feature engineering — 0.6087 ROC-AUC, +35.97% gross return; ~0.20 look-ahead-bias inflation

**(a) Claim as stated.** A machine-learning study (Jan 2020–Nov 2025) using 4-timeframe features achieved 0.6087 ROC-AUC and +35.97% gross return; multi-timeframe look-ahead bias inflated performance by ~0.20 ROC-AUC points; transaction costs erase the net profit.

**(b) What was searched/fetched.** DOI, the MDPI article page (returned empty), the full abstract via search listings, and the preprints.org full text (rendered through search listings); journal identity cross-checked against a library catalog.

**(c) What actually exists.** This claim is **the real, peer-reviewed study** — every figure checks out:

- **Sobreiro, P., Martinho, D., Martins, R., & Vardasca, R. (2026). "Multi-Timeframe Feature Engineering for Bitcoin Market Prediction: A Price-Level-Agnostic Machine Learning Approach." *Forecasting* (MDPI), 8(3), 40.** DOI: `https://doi.org/10.3390/forecast8030040` (online 2026-05-18; journal identity confirmed via Business Source Ultimate catalog: *Forecasting*, Jun2026, Vol. 8 Issue 3, p. 40, 27p). Preprint: `https://doi.org/10.20944/preprints202603.0994.v1` (2026-03-12).
- Full abstract (via search listing of DOI page / preprint):
  - *"evaluate five machine learning classifiers using a 37-feature hierarchical multi-timeframe pipeline with price-level-agnostic normalization across four temporal resolutions (15-min, 4-h, daily, and 3-day), spanning January 2020 to November 2025"*; 6,951 balanced samples (48.5% positive class); Random Forest best cross-validated ROC-AUC **0.6086** (all models 0.57–0.61); LR **0.6087 ROC-AUC** on 1,136 independently generated 2025 out-of-sample samples.
  - Look-ahead bias (paper text via preprint): *"the uncorrected alignment produced mean fold ROC-AUC values of 0.73–0.81 across models, whereas the corrected alignment reduced these to 0.57–0.61, a decrease of approximately 0.20 points."* (Mechanism: higher-timeframe candles were advanced one period before the as-of merge so only fully-closed higher-TF candles enter the feature vector — López de Prado's "information barrier.")
  - Event-driven backtest (paper text via preprint): best config SL=1%, TP=2%, threshold=0.7 → *"a +35.97% return with 185 trades and a maximum drawdown of -17.56%"*, win rate **39.5%**, Sharpe 0.14. The authors stress these are *"a gross upper bound on achievable returns, obtained before any transaction costs"*; at 0.2% round-trip over 185 trades *"which would reduce net returns by approximately 37 percentage points … likely erasing the entirety of the observed profit."* Central finding: *"models with ROC-AUC ≈ 0.60 cannot reliably generate economically significant returns once transaction costs are accounted for."*
  - Honesty caveat inside the paper (via preprint): the backtest evaluates a **hybrid rule-based filter + ML probability gate**, not a pure ML signal.

**(d) Grade.** **VERIFIED — PRIMARY.** Peer-reviewed journal, genuinely out-of-sample 2025 holdout, cost modeling, and an explicit look-ahead-bias audit. (It is the *only* PRIMARY source in this batch.)

**(e) Meaning for PICC.** This is the two-edged sword: it *confirms* the 4-TF design produces measurable signal (0.6087 AUC, all four timeframes contribute, 4H Bollinger/RSI dominant), but its headline finding **undercuts** the "MTF confluence meaningfully improves results" thesis — the edge is tiny, and net of realistic costs it disappears. PICC should use B4 as the credibility anchor *and* the warning: MTF feature stacking is real research practice, but its measured benefit is small and cost-fragile.

---

## B5. TradingView: BTC/USD 5m multi-TF MACD/RSI — 53.2% win rate, 1.87 PF

**(a) Claim as stated.** A TradingView strategy trading BTC/USD 5m using multi-TF MACD & RSI achieved 53.2% win rate and 1.87 profit factor.

**(b) What was searched/fetched.** TradingView for a multi-TF MACD/RSI backtest on BTC; the matching script was found and fetched directly.

**(c) What actually exists.** The script exists and the numbers are verbatim on its page — but the page itself discloses it is a heavily-optimized backtest:

- **"Multi-TF MACD/RSI Pro Strategy v6"** by elideleon5298, TradingView, published Jul 31, 2025, **PROTECTED SOURCE** script.
  - URL: `https://www.tradingview.com/script/FzcmjGXp-Multi-TF-MACD-RSI-Pro-Strategy-v6/` (fetched directly)
  - On-page text: *"Test results after 2000 runs on BTC/USD 5m: Win rate: 53.2%, Profit factor: 1.87, ROI: 27.4% (6 months), Max drawdown: 11.3%"*
- **"After 2000 runs"** is the giveaway: thousands of parameter-search iterations on a single symbol, then the best result reported — the exact recipe Bailey et al. (B7) formally shows produces inflated backtests with no edge left out-of-sample. Protected source = unverifiable.
- Note the numeric twin of B3's HSI Klinger entry (53.2% / 1.87) — recycled numbers across unrelated pages.

**(d) Grade.** **VERIFIED** (the claim reproduces the page verbatim) **but WEAK evidence** — self-published, protected source, 2000-run optimization, no OOS/costs.

**(e) Meaning for PICC.** Treat as illustrative of *how MTF strategies get marketed*, not as evidence of an edge. If used at all, pair it with the "2000 runs" disclosure and B7's overfitting math. PICC's own testing must report the number of parameter configurations tried (Bailey et al.'s key missing stat) and a true OOS slice.

---

## B6. GitHub: multi-TF EMA/ALMA — 80–96.7% win rates across 1m–4h

**(a) Claim as stated.** A GitHub multi-timeframe EMA/ALMA strategy backtested across timeframes 1m to 4h shows 80–96.7% win rates.

**(b) What was searched.** Multiple phrasings — EMA/ALMA multi-TF repos, win rates "80%", "90%", "96%", confluence-based signals, 1m–4h coverage.

**(c) What actually exists.** **No such repo or win-rate range was found.** What *does* exist is a set of GitHub repos that report far lower, more honest numbers:

- `github.com/phadmahadev-ops/intraday-ema-backtest` ("Intraday EMA crossover backtest … by Monetry.in") — tests EMA combos and an explicit **SMA vs EMA vs WMA vs HMA vs ALMA** comparison (9/21). Best intraday timeframe: **30min = 40.8% win rate** (279 trades); 15min 36.8%, 5min 33.4%, 1H 24.2%. Best combo 13v21 ≈ 35.1%. Honest, low win rates.
- `github.com/bino282/binance-trading-bot` — multi-timeframe (5m→4h) indicator-score signal engine; no claimed win rates of this magnitude.
- `github.com/hasnocool/tradingview-pine-scripts` — "High-Low Channel Multi averages Crypto Swing"; uses SMA/EMA/VWMA/ALMA/SMMA/LSMA on high/low channels, 8h+ swing; no such win rates.
- `gist.github.com/Shane-333` (ALMA+EMA+MACD-V, Gaussian trailing stop) — does proper walk-forward from a 2015–2021 in-sample grid to a 2022–2025 out-of-sample test; in-sample win rate **51.0%** — a good *counter-example* of credible methodology.
- `github.com/amin-sharifi-github/alphafx-trading-system` — shows **80% and 100% win rates** — but on **5 and 11 trades**, respectively: a textbook illustration that headline win rates without trade counts prove nothing.
- `github.com/marcos99b/moving-average-strategies` — example backtest: 47 trades, 55.3% WR, PF 1.82.
- `github.com/Mohammed-AB/forex-strategy-lab` — an explicitly anti-overfitting validation lab (10 strategies incl. a Multi-TF EMA; in-sample/OOS splits, walk-forward, Monte Carlo, *"any strategy whose out-of-sample Sharpe collapses below 50% of its in-sample Sharpe is explicitly flagged as overfit"*).

**(d) Grade.** **UNFOUND** for the claimed 80–96.7% range. (The repos above are real but all report ≤ ~55% win rates, or astronomically high rates on tiny n.)

**(e) Meaning for PICC.** The claim has no verifiable source. More usefully, the honest repos (especially phadmahadev-ops' ALMA-vs-EMA table and Shane-333's walk-forward gists) support PICC's working assumption that real intraday MTF win rates for MA-based signals sit in the 30–55% band before costs — and B7 explains why anything reported much higher should be treated as suspect.

---

## B7. Honest consensus on backtest overfitting / win-rate inflation

**(a) Question.** What do credible references actually say about backtest win rates overstating live results?

**(b) What was searched/fetched.** Backtest-overfitting literature; key papers fetched or listing-verified for quotes.

**(c) What actually exists.**

- **Bailey, Borwein, Lopez de Prado & Zhu (2014), "Pseudo-Mathematics and Financial Charlatanism: The Effects of Backtest Overfitting on Out-of-Sample Performance," *Notices of the American Mathematical Society*, 61(5), 458–471.**
  - PDF: `https://www.ams.org/notices/201405/rnoti-p458.pdf` · Institutional record (abstract fetched directly): `https://scholarworks.wmich.edu/math_pubs/40/` · SSRN: `papers.ssrn.com/sol3/papers.cfm?abstract_id=2308659`
  - Abstract (directly fetched from ScholarWorks): *"We prove that high simulated performance is easily achievable after backtesting a relatively small number of alternative strategy configurations, a practice we denote 'backtest overfitting'. The higher the number of configurations tried, the greater is the probability that the backtest is overfit. Because most financial analysts and academics rarely report the number of configurations tried for a given backtest, investors cannot evaluate the degree of overfitting in most investment proposals."* and *"Under memory effects, backtest overfitting leads to negative expected returns out-of-sample, rather than zero performance."*
- **Bailey, Borwein, Lopez de Prado & Zhu (2015), "The Probability of Backtest Overfitting," *Journal of Computational Finance* 20(4).** SSRN: `papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253` (found via search listing; abstract not fetched directly).
- **Harvey & Liu (2015), "Backtesting," *Journal of Portfolio Management* 42(1), 13–28.**
  - PDF: `https://people.duke.edu/~charvey/Research/Published_Papers/P120_Backtesting.PDF` (fetch returned the PDF as binary — quote reliability from search listing of the same document)
  - *(via search listing)* *"common practice in evaluating backtests of trading strategies is to discount the reported Sharpe ratios by 50% … The discount is a result of data mining … Our framework relies on the statistical concept of multiple testing."*

**(d) Grade.** **PRIMARY / SECONDARY.** Peer-reviewed finance perspectives (JCF, JPM) plus a widely-cited AMS piece by the same group. Solid consensus: high backtest win rates/Sharpe are to be expected under parameter mining; out-of-sample lives worse, often negative; you must know *how many configurations were tried* and haircut reported performance.

**(e) Meaning for PICC.** These three are the honest counterweight for the whole backtest claims batch. B2 (2000 runs), B5 (self-published), B1 (45%→60–75% marketing), and B3/B6 (unfindable extreme win rates) are all exactly the phenomena B7 explains. PICC's own strategy validation should report: number of configurations tried, an untouched OOS slice, cost modeling, and haircut assurance.

---

## Confidence summary

| # | Claim | Verdict | Evidence quality |
|---|-------|---------|------------------|
| B1 | ThinkMarkets MTFA 60–75% vs 45%; "fractal alignment" | PARTIALLY-VERIFIED (fractal phrase UNFOUND) | WEAK — numbers trace to a QuantifiedStrategies self-published backtest, not a readable ThinkMarkets body |
| B2 | MQL5 RSI confluence: 61% WR, 1.8 PF, 127 trades, live | PARTIALLY-VERIFIED | WEAK — verbatim, but self-published blog, ~3-month window behind the figures |
| B3 | HSI MTF RSI confluence: 54.3% / 1.49 | UNFOUND | N/A — nearest real artifact differs (51.3% / 1.69, WEAK) |
| B4 | Bitcoin ML: 0.6087 ROC-AUC, +35.97%, ~0.20 look-ahead inflation | VERIFIED | PRIMARY — peer-reviewed (MDPI *Forecasting* 8(3):40), OOS + cost modeling |
| B5 | BTC 5m MACD/RSI: 53.2% / 1.87 | VERIFIED (verbatim) | WEAK — protected source, "after 2000 runs" |
| B6 | GitHub EMA/ALMA: 80–96.7% | UNFOUND | N/A — real repos report ≤ ~55% or tiny-n |
| B7 | Overfitting consensus | VERIFIED | PRIMARY/SECONDARY — Bailey et al. 2014/2015, Harvey & Liu 2015 |

## Could not be verified

- **ThinkMarkets MTFA article body** — site is JS-rendered; 3 fetch attempts (markdown + html) and a Google-cache route returned only boilerplate. Only title + meta description readable. So the claim's *attribution* to ThinkMarkets could not be confirmed or denied; the figures were found on QuantifiedStrategies instead.
- **"Fractal alignment dramatically improves odds"** — searched multiple times, no hit anywhere.
- **HSI 54.3% / 1.49** — no TradingView or other page carries these exact figures; the closest real strategy is PineScriptForge's "MTF RSI Confluence Multi-Timeframe" (51.3% / 1.69).
- **GitHub EMA/ALMA 80–96.7%** — no repo or backtest with that win-rate range for 1m–4h EMA/ALMA could be located, under any search phrasing tried.
- **Harvey & Liu "Backtesting" exact wording** — the Duke PDF fetched as raw binary; quote retained from a search listing of the same document (reliable wording, not byte-exact).
- **Bailey et al. 2015 JCF abstract** — found as an SSRN listing; the SSRN abstract page itself was not fetched directly.
- **MQL5 "real money" claim's independent verification** — the blog asserts a Pepperstone account; no third-party audit exists.