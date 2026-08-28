# PICC Multi-Timeframe Convergence Engine Research Report

> **Date:** August 28, 2026
> **Purpose:** Verify the key claims behind PICC's planned "Multi-Timeframe Convergence Engine" — uncertain 4H regime gate, ADX/StochRSI semantics, MTF confluence scoring, timeframe hierarchy, and binary-options expiry matching — against primary/secondary sources. Model-team decision input, not a spec.

**How to read this note:** Each section answers one research question with (a) the claim, (b) what the source actually says (verbatim quotes), (c) a source-quality grade, and (d) a "What this means for PICC" line. Grades: **PRIMARY** (original definition / peer-reviewed paper), **SECONDARY** (authoritative educational docs that restate a primary source), **WEAK** (community content, may be republished/unvetted). Quotes marked "via search listing" come from search-result snippets of the page, not a full page fetch — treat wording as reliable but not byte-exact. Items that could not be verified in-session are listed at the end — they are *not* validated facts.

---

## Q1. Does MTF alignment / higher-timeframe filtering actually improve win rates?

**Claim:** Requiring higher timeframes to agree improves entry win rates / reduces losing trades.

**What the sources say:**

- **Taylor & Allen (1992), "The use of technical analysis in the foreign exchange market," J. Int. Money & Finance 11(3):304-314.** Bank of England questionnaire sent to chief foreign exchange dealers in London (Nov 1988; ~213 responses). Verbatim via citation: *"at least 90 per cent of respondents place some weight on this form of non-fundamental analysis when forming views at one or more time horizons. There is also a skew towards reliance on technical, as opposed to fundamentalist, analysis at shorter horizons, which becomes steadily reversed as the length of horizon considered is increased."* — https://ideas.repec.org/a/eee/jimfin/v11y1992i3p304-314.html
- **Brock, Lakonishok & LeBaron (1992), "Simple Technical Trading Rules...", J. Finance 47(5).** On the Dow 1897-1986 with 26 rules: *"Buy signals consistently generate higher returns than sell signals, and further, the returns following buy signals are less volatile than returns following sell signals... Moreover, returns following sell signals are negative, which is not easily explained by any of the currently existing equilibrium models."* — https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.1992.tb04681.x
- **Park & Irwin (2007), "What do we know about the profitability of technical analysis?", J. Economic Surveys 21(4).** Survey of the field: *"Early studies indicate that technical trading strategies are profitable in foreign exchange markets and futures markets, but not in stock markets. Modern studies indicate that technical trading strategies consistently generate economic profits in a variety of speculative markets at least until the early 1990s. Among a total of 95 modern studies, 56 studies find positive results regarding technical trading strategies, 20 studies obtain negative results, and 19 studies indicate mixed results."* Caveats they stress: data snooping, ex-post signal selection, and risk/cost misestimation. — https://doi.org/10.1111/j.1467-6419.2007.00519.x
- **"Technical Analysis with a Long Term Perspective: Trading Strategies and Market Timing Ability" (working paper, S&P 500 daily data).** Verbatim via listing: *"trading rules are more profitable when signals are generated over long horizons"* and use of consumer debt in the economy to time the market. — ResearchGate working paper
- **Lo, Mamaysky & Wang (2000), "Foundations of Technical Analysis," J. Finance 55(4).** US stocks 1962-1996: *"we find that over the 31-year sample period, several technical indicators do provide incremental information and may have some practical value."* Patterns computed via kernel regression. — https://web.mit.edu/Alo/www/Papers/1705-1765.pdf
- **Community backtest with explicit numbers (WISE_MAN_ALGO / WiseManAlgo MTF Confluence Dashboard, TradingView).** Claims: BTC-USD on 1H, Apr 2024–Apr 2026: *"ONLY trade when multi timeframe confluence..."* with stated win rates ≈ 71% (long, +24h hold) and ≈ 62% (short, +4h hold). This is a self-published backtest on a single pair/symbol — no methodology, no sample-size or transaction-cost detail. — via TradingView script listing

**Grade:** PRIMARY for Taylor & Allen, Brock et al., Park & Irwin, Lo et al. (peer-reviewed, quotes from publisher abstracts/citations). WEAK for the WiseManAlgo backtest (self-published, single pair).

**What this means for PICC:** The strongest defensible claim is *practitioner* (≥90% of professional FX dealers weight charts, more at short horizons) plus *higher-horizon signal profitability* — NOT a rigorous "MTF alignment ⇒ +X% win rate" figure. Park & Irwin is the honest anchor: the academic literature is marginally positive (56/95), conditional on data-snooping and cost caveats. PICC docs should present the 90%-of-dealers statistic (Taylor/Allen) and long-horizon profitability (Brock et al.), and treat any specific "75% win rate" as marketing, not fact.

---

## Q2. Is the ADX 25 / 20 threshold actually Wilder's rule?

**Claim:** "ADX above 25 = strong trend, below 20 = no trend" is a Wilder definition.

**What the sources say:**

- **StockCharts ChartSchool, Average Directional Index (ADX).** Verbatim: *"At its most basic, the Average Directional Index (ADX) can be used to determine if a security is trending or not. This determination helps traders choose between a trend-following system or a non-trend-following system. Wilder suggests that a strong trend is present when ADX is above 25 and no trend is present when ADX is below 20. There appears to be a gray zone between 20 and 25... Many technical analysts use 20 as the key level for ADX."* Also: *"+DI/-DI measure trend direction; the ADX measures the strength of the trend (regardless of direction)."* — https://school.stockcharts.com/doku.php?id=technical_indicators:average_directional_index_adx (direct page fetch blocked in-session; quote from search listing)
- **TradingView Support, ADX.** Verbatim: *"A trend shows the most strength when the Average Directional Index is above 25 (potential signal to buy), and a trend is weak or the price is considered trendless if the ADX reaches below 20 - according to the concept creator, Wilder."* — https://www.tradingview.com/support/solutions/43000589099-average-directional-index-adx/ (via search listing) *Note: TradingView's "(potential signal to buy)" phrasing is loose — ADX has no direction; buying from high ADX alone is not a Wilder rule.*
- **Wilder's own text (New Concepts in Technical Trading Systems, 1978, Trend Research, 141 pp),** archive.org copy: https://archive.org/details/newconceptsintec00wild — **access-restricted in-session; the verbatim 25/20 passage could not be directly confirmed.** Both stockcharts.com and tradingview.com attribute the threshold to Wilder, but they are restatements.

**Grade:** SECONDARY (authoritative educational restatements attributed to Wilder; primary text not directly readable in-session).

**What this means for PICC:** The 25/20 convention is safe to ship — it is the standard interpretation in the two most authoritative retail indicator references — but on paper it should be labeled "convention attributed to Wilder (1978)" rather than "per Wilder." Practically: use ADX>25 up-phased as a *trend-strength/trend-mode* gate, never as a directional signal. Consider ADX 20–25 = "gray zone": treat as neutral in a range/breakout engine.

---

## Q3. StochRSI: are 0.80/0.20 the canonical extremes, and where does "60/40" come from?

**Claim:** StochRSI reads overbought >0.80 / oversold <0.20; the MTF convergence engine should treat a 0.60–0.40 "zone" as meaningful.

**What the sources say:**

- **Chande & Kroll definition.** TradingView Support (Stochastic RSI): *"The Stochastic RSI (Stoch RSI) indicator was developed by Tushard Chande and Stanley Kroll. They introduced their indicator in their 1994 book The New Technical Trader."* Formula: *"Stoch RSI = (RSI - Lowest Low RSI) / (Highest High RSI - Lowest Low RSI)"*. On thresholds: *"Stoch RSI are typically .80 and .20 respectively"* for overbought/oversold; the indicator's own benchmark scale is 1 / 0.8 / 0.5 / 0.2 / 0. — https://www.tradingview.com/support/solutions/43000502333-stochastic-rsi-stoch-rsi/ (fetched directly)
- **Chande & Kroll, "Stochastic RSI And Dynamic Momentum Index," Technical Analysis of Stocks & Commodities, V.11:5, pp.189-199.** Purpose: adapt RSI readings to recent RSI range; author-editorial claims the StochRSI is *"better at flagging overbought and oversold conditions than RSI itself."* — https://store.traders.com/-v11-c05-stochas-pdf.html (via listing)
- **Where "60/40" actually appears (this is important):** In MTF dashboard **with RSI**, not StochRSI — giua64's *Adaptive Multi-TF Indicator Table* "Intraday" preset uses **RSI 14 with Overbought 60 / Oversold 40** (vs Scalping's 70/30 and Swing's 65/35) — https://it.tradingview.com/script/aCY3m4X7-Adaptive-Multi-TF-Indicator-Table-with-Presets/ (fetched directly). Separately, the FMZQuant/Medium community schema uses StochRSI at 0.40/0.60 as **signal-trigger lines** (long when 15m %K≥%D and %K<0.40; short when %K≤%D and %K>0.60) — a *cross-confirmation trigger*, not an overbought/oversold band.

**Grade:** PRIMARY for the 0.8/0.2 convention + authorship (TradingView Support is the official spec reference tracking Chande/Kroll 1994); WEAK for any "0.60–0.40 zone" significance.

**What this means for PICC:** Treat StochRSI **>0.8 = overbought, <0.2 = oversold** (0.5 = neutral center — the natural "no-zone"). The "60/40" framing does NOT have a canonical StochRSI meaning; it likely leaked in from **RSI** overbought/oversold presets in dashboards (see Q4) or from StochRSI *trigger-line* usage in community strategy code. If the engine needs a "dead zone," use 0.3–0.7 or 0.2–0.8 for StochRSI — but be aware it is a design choice, not a sourced rule. Do not cite Inventopedia's 0.30/0.70 — it was un-fetchable this session and is likely a secondary rehash.

---

## Q4. How do real TradingView MTF dashboards actually score confluence?

**Claim:** A single weighted +/− score per timeframe, summed into a composite, is the standard MTF-convergence design.

**What the sources say** (two open-source scripts fetched verbatim + one GitHub repo):

- **igaudette, "MTF Bias Dashboard"** (open-source, published 13 May 2026). Design: a dashboard across **1m / 5m / 15m / 30m / 1H / 4H / 1D**; each TF contributes +1/0/−1; outputs an **ACTION** state — *"NO TRADE, WAIT, LONG WATCH, SHORT WATCH, LONG ONLY, SHORT ONLY, LONG BIAS, SHORT BIAS"* — plus a **WHY** rationale (*"H1/4H disagree", "Low volatility", "HTF risk", "Strong bull confluence", "Bear regime only"*) and **"SCORE — a confluence score from −100 to +100"**. Presets: Aggressive / Balanced / Conservative — **in Conservative mode an H1/4H disagreement blocks trades** (i.e., higher TFs get veto power). Sessions (London/NY/overlap/Asia) get a multiplier. — https://www.tradingview.com/script/D7eTGhD9-MTF-Bias-Dashboard/ (fetched directly)
- **giua64, "Adaptive Multi-TF Indicator Table with Presets"** (open-source, published 23 May 2025). Five TFs (**5m/15m/30m/1h/4h**), three indicators (**MA crossovers, RSI, MACD**) each emitting bullsih/bearish/flat symbols per TF; *"Each signal is assigned a numerical score. These are aggregated per timeframe to compute a combined score that reflects the directional bias for that specific time window."* Outputs combined sentiment for **3TF (5m/15m/30m), 4TF (+1h), 5TF (+4h): SIGNAL → LONG / SHORT / NEUTRAL and Confidence (%) based on score aggregation and signal consistency.** Presets: Scalping (RSI7 OB70/OS30, MACD 5/13/3), **Intraday (RSI14 OB60/OS40, MACD 12/26/9)**, Swing (RSI14 OB65/OS35), Manual. — https://it.tradingview.com/script/aCY3m4X7-Adaptive-Multi-TF-Indicator-Table-with-Presets/ (fetched directly)
- **eliasvictor-trading/multi-time-frame (GitHub, active repo).** A "Multi-Timeframe Checklist Dashboard": 6 TFs (default 1m–4h), **confluence requires a minimum number of aligned TFs (default 5)**; optional **"Require HTF Confirmation" (min 2 HTFs)**; filters for ORB (opening range), sessions, ATR, volume. — https://github.com/eliasvictor-trading/multi-time-frame (via listing)

**Grade:** PRIMARY for mechanics (open-source code with descriptions), WEAK for any claimed edge (none of these publish validated, multi-symbol, cost-adjusted backtests).

**What this means for PICC:** The pattern is consistent and simple: per-plane direction (+1/0/−1 from an indicator or price/EMA relationship), summed per TF into a signed composite, then collapsed to a state (NO-TRADE / WATCH / ONLY / BIAS) with a "why" string, and optionally a **conservative mode where HTF conflict vetoes**. Notably: the two flagship dashboards do **NOT** use ADX as their regime gate — they use MA/EMA + RSI + MACD planes and veto-by-HTFs. PICC's planned "ADX>25 on 4H as the regime gate" is *not* the de-facto dashboard convention; conformance pressure is toward simple +1/0/−1 DFS summed with HTF-veto.

---

## Q5. What is the standard timeframe hierarchy / resolution?

**Claim:** HTF gives context/bias, LTF gives entry; there is a defined "4H = the intraday swing plane."

**What the sources say:**

- **ICT-style top-down analysis** (community canon, enshrined in modern SMC okr/ICT courses): *"Monthly/Weekly = trend context, Daily = bias, 4H = draw on liquidity, 1H = model confirmation, 15M/5M = entry"* and *"Never start analysis at the entry timeframe."* — https://www.theinnercircletraders.com/ict-top-down-analysis/ and SMC materials (Weak — community, affiliation unverified)
- **Pine/v6 official reference** on how HTF is pulled down to the chart (relevant to any PICC indicator): `request.security()` fetches a higher (or same) TF value for the chart's bar; HTF results **repaint** live and must be used with `expression[1]` + `barmerge.lookahead_on` for non-repainting reads; lower-TF reads "as-of" the last closed LTF bar; note there is **no standardized 1/4/15/60×4 hierarchy in the language** — hierarchy is convention, not API. — https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/ and https://www.tradingview.com/pine-script-docs/concepts/timeframes/ (via docs listings)
- **Taylor & Allen (1992)** (see Q1) is the empirical anchor: professionals mix horizons and weight technical analysis *more* at short horizons. This is a *usage* fact, not a rule for which exact ladder to pick.

**Grade:** WEAK for the exact 1W/1D/4H/1H/15M/5M ladder phrase (community canon); PRIMARY for "practitioners blend horizons" (Taylor & Allen).

**What this means for PICC:** Adopt the ladder as a *convention* (weekly/monthly → daily → 4H → 1H → 15M/5M for entries), and hard-code the PICC semantic labels "context / bias / swing / confirm / entry" for those planes. Steal the repaint-safe `request.security(..., expr[1], lookahead_on)` pattern for any MTF indicator code — a dashboard that shows changing 4H ADX intraday is a liability.

---

## Q6. Binary options: is there a source rule for matching expiry to timeframe?

**Claim:** PICC should map expiry (e.g. 30s/1m/5m) to a matching analysis timeframe, since binary options are structurally against the retail trader.

**What the sources say:**

- **ESMA binary options ban (27 March 2018).** Verbatim-from-release: ESMA agreed to *"prohibit the marketing, distribution or sale of binary options to retail investors"* — the *"products... have a structural expected negative return and an embedded conflict of interest between providers and their clients."* This is the authoritative regulatory backdrop for any binary-options targeting/claim. — https://www.esma.europa.eu/press-news/esma-news/esma-agrees-prohibit-binary-options-and-restrict-cfds-protect-retail-investors
- **PocketOption educational blog, "Stochastic RSI Mastery" (2025).** Example system: StochRSI **0.8 / 0.2** extremes as trigger, dual-oscillator filter (+RSI/MACD), **5-minute chart, EUR/USD**, binary trades — i.e., broker materials implicitly align a 5m chart with short-expiry trades but publish **no explicit expiry↔timeframe table**. — https://pocketoption.com/blog/en/interesting/trading-strategies/stochastic-rsi/ (via listing)

**Grade:** PRIMARY for the ESMA ban; WEAK for the expiry-matching (broker blog, no rule).

**What this means for PICC:** No authoritative expiry↔timeframe mapping exists; any published "30s expiry ↔ 1m chart" rules are broker community folklore. Ground truth to respect: binary options to retail are **banned in the EU/EEA** and carry a structural negative expected return — PICC should treat such an engine as tooling that must not imply profitability, and keep expiry matching a *user-configurable heuristic*, cracked with caveat language. Conformant copy: "higher analysis-TF ⇒ longer hold; match expiry to the plane your entry fires on" without citing an authoritative rule.

---

## Q7. Source-quality grading of everything above

| # | Source | Grade | Why |
|---|--------|-------|-----|
| Q1 | Taylor & Allen 1992 (JIMF) | PRIMARY | Peer-reviewed; practitioner survey, BoE-backed |
| Q1 | Brock, Lakonishok & LeBaron 1992 | PRIMARY | Peer-reviewed, bootstrap-tested DJIA study |
| Q1 | Park & Irwin 2007 survey | PRIMARY | Peer-reviewed meta-analysis; the honest answer |
| Q1 | Lo, Mamaysky & Wang 2000 | PRIMARY | Peer-reviewed, US stocks 1962–1996 |
| Q1 | WiseManAlgo backtest (TradingView) | WEAK | Self-published, single pair, no methodology |
| Q2 | Wilder 1978 book (archive.org) | PRIMARY (text) | **Access-restricted — NOT directly readable; 25/20 rule NOT confirmed verbatim in-session** |
| Q2 | StockCharts ChartSchool ADX | SECONDARY | Authoritative edu reference, attributes 25/20 to Wilder |
| Q2 | TradingView Support ADX | SECONDARY | Official docs, attributes 25/20 to Wilder (loose "buy" phrasing) |
| Q3 | Chande & Kroll 1994 / TradingView StochRSI docs | PRIMARY | Original definition via official spec reference |
| Q3 | TASC V.11:5 (Chande & Kroll) | PRIMARY | Author-published article |
| Q3 | "60/40 StochRSI zone" folklore | WEAK | Traces to RSI presets (giua64) or trigger-lines (community strategy); no canonical StochRSI meaning |
| Q4 | igaudette MTF Bias Dashboard | PRIMARY (mechanics) | Open-source description fetched directly |
| Q4 | giua64 Adaptive Multi-TF Table | PRIMARY (mechanics) | Open-source description fetched directly |
| Q4 | eliasvictor multi-time-frame repo | PRIMARY (mechanics) | GitHub repo, active |
| Q5 | ICT top-down ladder | WEAK | Community canon, affiliation unverified |
| Q5 | Pine Script Timeframes/other-timeframes docs | PRIMARY | Official v6 reference |
| Q6 | ESMA ban 2018 | PRIMARY | Official regulator release |
| Q6 | Broker expiry-matching folklore | WEAK | No authoritative table exists |
| Q7 | Investopedia StochRSI (0.30/0.70) | — | **Un-fetchable in-session (HTTP 402); do not cite** |

---

## What could NOT be verified (with what was tried)

- **Wilder 1978 verbatim "25 / 20" passage.** archive.org item `newconceptsintec00wild` is access-restricted (borrow-only); full-text search unavailable to the agent. Verdict: rule is *attributed to Wilder by two authoritative secondary references*, not confirmed against the primary text. Do not phrase as "Wilder (1978), p.XX" in docs without a human eyeballing a borrowed copy.
- **Investopedia StochRSI page** (which cites 0.30/0.70 alongside 0.80/0.20). Direct fetch returned HTTP 402; not re-attempted via cache. Verdict: skip — the 0.8/0.2 convention is already confirmed via TradingView/Chande-Kroll, and the 0.3/0.7 variant is a secondary rehash.
- **StockCharts ChartSchool and TradingView ADX pages, direct fetch.** Both failed transport/404 in-session; quotes taken from search listings of the same pages (URLs above are the canonical ones). Wording reliable, not byte-exact.
- **A specific authoritative "expiry ↔ timeframe" table for binary options.** None exists in any fetched source; only broker blog folklore. ESMA ban confirmed.
- **WiseManAlgo backtest internals.** Numbers 71%/62% appear in the script description, but no methodology, costs, or sample detail and no direct page fetch (listing only). Treat as marketing.
- **The exact phrase "4H = timeframe of the week."** Community usage only; the ICT ladder (Q5) is the closest citable convention.
- **A citable scholarly "MTF alignment adds +X win rate."** No such figure exists; Pearson/Park-Irwin caveats govern. The best citable evidence is practitioner adoption (90% of FX dealers, Taylor & Allen) + long-horizon profitability (Brock et al.).

---

## Bottom line for the PICC engine (verified-claim summary)

1. Ship a **simple per-TF +1/0/−1 score summed into a composite** — that is the uniform dashboard convention (igaudette, giua64, eliasvictor).
2. Give **higher TFs veto power** in a "conservative" mode (H1/4H conflict ⇒ no trade) — matches igaudette's Conservative preset.
3. **ADX>25 on 4H** is safe as a *trend-mode gate* (attributed convention, direction-blind) — but it is not the dashboard norm; adding it on TOP of the sign-sum convention is the differentiator, not a restatement.
4. **StochRSI 0.8/0.2** are the canonical extremes; drop "0.6–0.4 zone" claims or re-label as RSI-based presets (giua64 Intraday) or StochRSI trigger lines.
5. Use the **1W/1D/4H/1H/15M + 5M** ladder with semantic labels; implement HTF reads **repaint-safe** (`[1]` + `lookahead_on`).
6. No expiry↔timeframe rule is citable; keep it user-configurable, and keep ESMA-compliant disclaimers that binary options structurally lose to the house.

*Report compiled August 28, 2026. All quotes taken from pages fetched or search-listed during this session; source-quality grades reflect verifiability in-session, not general reputability.*

---

# Supplementary verification (second pass, 2026-08-28)

A second research pass verified the additional claims appended to the MTF framework document ("hard numbers", academic DSS studies, open-source systems, browser extensions). Full per-claim notes with URLs and verbatim quotes live in three companion files:

- `docs/mtf-convergence-research-a-academic.md` — nine academic/literature claims (C1–C9)
- `docs/mtf-convergence-research-b-backtests.md` — seven backtest/win-rate claims + the overfitting consensus (B1–B7)
- `docs/mtf-convergence-research-c-systems.md` — open-source tools, notification systems, browser extensions, human-in-the-loop literature

## Verdict summary

| # | Claim (as appended) | Verdict | Grade |
|---|---|---|---|
| C1 | Kondruk & Hetsko (2025) DSS System C = multi-TF classification → **+3,283.69% return / 2.07% max DD** | **VERIFIED** — bytes exact; asset is **XAU/USD** (omitted from the appendix) | PRIMARY (Uzhhorod Bulletin 47(2):168-176, peer-reviewed) |
| C2 | Fuzzy DSS (60.81% WR, +58%, Sharpe 1.33) vs binary (34.16%, −95.46%, −5) | **VERIFIED** — same authors (Kondruk & Hetsko), numbers byte-exact | PRIMARY (Cybernetics & Computer Technologies, DOI 10.34229/2707-451X.25.4.11) |
| C3 | AutoTrader-AgentEdge (Sharpe 0.856 vs 0.841, 51.4% vs 31.9% WR) | **VERIFIED as stated, but weak venue** — doctoral showcase abstract (author-reported), not peer-reviewed; no costs modeled | PRIMARY as origin / WEAK as evidence |
| C4 | TradingGroup pipeline `Data→Signal Agent→Time Frame Fusion→…→Executor` | **PARTIALLY-VERIFIED** — paper real (arXiv 2508.17565, ICAIF'25) but the appendix's pipeline does not exist in it | PRIMARY (paper) / claim rejected |
| C5 | Neuro-Symbolic Traders affect markets in semi-autonomous mode | **PARTIALLY-VERIFIED** — real paper (arXiv 2410.14587) but a virtual-market simulation, not real-venue impact | PRIMARY (paper) |
| C6 | BTC/USDT volatility scales by **Δ^0.4899**; Nyquist-optimal timeframe selection | **UNFOUND** — no source states it; closest real results: D5 Hurst 0.489 on wavelets (Aydoğdu & Meder Çakır 2025) and √t scaling. **Do not ship the exponent as sourced** | UNFOUND |
| C7 | MDPI 2026 DevOps-ML framework; 1 Hz telemetry for micro-bursts | **VERIFIED** | PRIMARY (Systems 14(5):549, genuinely 2026) |
| C8 | Microservices "preferred" for trading systems (RabbitMQ/gRPC push) | **PARTIALLY-VERIFIED/overstated** — one real peer-reviewed example; the stack list traces to practitioner repos, not academic consensus | SECONDARY at best |
| C9 | Cuttlefish fair cloud execution environment | **VERIFIED** | PRIMARY (LIPIcs AFT 2025, DOI 10.4230/LIPIcs.AFT.2025.33) |
| B1 | ThinkMarkets MTFA 60–75% vs 45%; "fractal alignment" | **PARTIALLY-VERIFIED/WEAK** — numbers trace to QuantifiedStrategies' self-published backtest, not a readable ThinkMarkets body; the "fractal alignment" phrase is UNFOUND | WEAK |
| B2 | MQL5 XAUUSD RSI confluence 61% / 1.8 PF / 127 trades / "18 months live" | **PARTIALLY-VERIFIED/WEAK** — numbers verbatim (mql5.com blog), but ~3-month window behind the figures, self-reported | WEAK (anecdote only) |
| B3 | HSI MTF RSI confluence 54.3% / 1.49 | **UNFOUND** — closest real artifact differs (51.3% / 1.69, PineScriptForge); 53.2%/1.87 appears on an unrelated instrument (recycling red flag) | UNFOUND |
| B4 | Bitcoin ML 4-TF: 0.6087 ROC-AUC, +35.97% gross, costs erase net profit, ~0.20 look-ahead inflation | **VERIFIED — the credibility anchor of this batch** (Sobreiro et al., MDPI *Forecasting* 8(3):40) | PRIMARY |
| B5 | TradingView BTC 5m MACD/RSI 53.2% / 1.87 | **VERIFIED verbatim / WEAK evidence** — script itself discloses "after 2000 runs" (overfit recipe) | WEAK |
| B6 | GitHub EMA/ALMA 80–96.7% win rates | **UNFOUND** — real repos report ≤ ~55% (or 80–100% on 5–11 trades) | UNFOUND |
| B7 | Overfitting consensus (backtest win rates overstate live) | **VERIFIED** — Bailey/Borwein/López de Prado/Zhu 2014 (Notices AMS) + 2015 (JCF); Harvey & Liu 2015 (JPM) | PRIMARY |
| S1 | Dresteghamat Adaptive MTF Decision Engine (Regime/Direction/Exhaustion) | **VERIFIED** — live TradingView scripts (45.5k views); core scoring engine hidden ("Protected"); no published backtest | PRIMARY for existence |
| S2 | MTF Stochastic Confluence (15m/1H/4H) | **VERIFIED** — script exists; win-rate self-reported only | WEAK edge |
| S3 | HSI MTF RSI Confluence Backtest as TradingView script | **UNFOUND** | UNFOUND |
| S4 | SignalVoice / QuantSys / Pinecone Trading Alerts / crypto-signal-mcp / Telegram OB-OS bots | **VERIFIED (each)** — real, with caveats: SignalVoice not on GitHub; QuantSys is SMA/EMA breakout (not OB/OS) with a real IJCA 2025 paper; Pinecone router pattern; MCP server tiny (2★); TeIKa 15(2) paper + real GitHub bots for Telegram | PRIMARY/SECONDARY |
| S5 | Browser extensions (Orbital Trade, TradingView Remix, FinSignal, TV Co-Pilot) | **VERIFIED (exist)** — user counts tell the story: Remix ~100k users; Orbital 7, FinSignal 5, TV Co-Pilot 9. TV Co-Pilot's HTF-bias LONG/SHORT/SKIP verdict is the closest UI reference to PICC's convergence panel | PRIMARY (store listings) |
| S6 | Human-in-the-loop trading research | **VERIFIED (literature)** — TradingAgents (≥23.21% cum. ret., Jan–Mar 2024), Ye & Schuller ESWA 234:120939 (2023); some exact Sharpe figures paywalled/UNVERIFIED | PRIMARY / UNVERIFIED-in-full |

## Bottom line of the second pass (verified-claim summary)

1. **The headline MTF numbers in the appended doc are mostly real but mostly weak.** Only B4 (Sobreiro et al.) and C1/C2 (Kondruk & Hetsko) are peer-reviewed; C1/C2 come from a single lab, B4 *undercuts* the "MTF dramatically improves results" narrative (the measured edge is small and cost-erased).
2. **A realistic honest expectation band** for a well-built MTF confluence filter on live data cluster around **~54–61% win rate** on self-published/live reports and **~0.61 ROC-AUC** academically — i.e., a *filtration* tool, not a prediction machine. "90%+" figures are backtest artifacts (B6/B7).
3. **Fuzzy/soft aggregation (C2) genuinely outperformed hard binary gates in the only direct comparison found** — supports PICC's confidence/quality shaping over strict all-or-nothing state cutoffs.
4. **Look-ahead bias is the poison**: Sobreiro et al. measured ~0.20 ROC-AUC of inflation from using un-closed higher-TF candles — the spec's closed-bar/time-alignment invariant (R9) is now directly evidence-backed.
5. **Backtest-honesty obligations (B7)**: report the number of configurations tried, hold out an untouched OOS slice, model costs, haircut claims — these become part of slice 9's acceptance criteria.
6. **The Δ^0.4899 / Nyquist timeframe-selection claim must not be shipped** as sourced (C6). Reference-grade material for the panel UI exists (TV Co-Pilot, Dresteghamat) but none publish reproducible results — PICC's differentiator stays "published, reproducible results."