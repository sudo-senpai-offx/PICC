# PICC Multi-Timeframe Convergence — Adjacent Open-Source Systems (C-Systems) Research

> **Date:** August 28, 2026
> **Purpose:** Verify the actual existence and real functionality of six groups of open-source tools, systems, and extensions that PICC's "Multi-Timeframe Convergence Engine" might draw on or exist alongside: (1) live TradingView MTF decision-engine indicators, (2) MTF confluence backtests, (3) signal-notification projects (voice app, paper, GitHub bots, MCP server), (4) general TradingView→Telegram webhook alternatives, (5) AI browser extensions overlaid on TradingView, and (6) human-in-the-loop / human-alignment trading research. Model-team decision input, not a spec.

**How to read this note:** Each section covers one candidate system with (a) the claim, (b) what was searched, (c) what actually exists — with URLs and verbatim quotes, (d) a source-quality grade, and (e) a "Meaning for PICC" line. Grades: **PRIMARY** (peer-reviewed paper / original authored-source / official store listing), **SECONDARY** (authoritative doc restating a primary source), **WEAK** (community/marketing content, may be self-published or unvetted), **UNFOUND** (searched, does not exist as claimed), **UNVERIFIED** (could not be confirmed in-session). Quotes marked "via search listing" come from search-result snippets, not a full page fetch — treat wording as reliable but not byte-exact. Items that could not be verified are listed at the end — they are *not* validated facts.

---

## 1. Dresteghamat — Adaptive Multi-TF Decision Engine (TradingView)

**(a) Claim:** An open-source TradingView indicator that aggregates Regime / Direction / Exhaustion across multiple timeframes into a weighted decision score, with dynamic higher-timeframe selection.

**(b) Searched:** TradingView script search for the listed script ID; the discovered secondary script was also fetched.

**(c) Actual existence — VERIFIED (both scripts live on TradingView):**

- **Primary script — `CmiDql3r-Dresteghamat-Adaptive-Multi-TF-Decision-Engine`** (author dr-esteghamat; OPEN-SOURCE badge; published **Nov 22, 2025**; ~45,555 views / ~5,720 likes). Description confirms the three-plane design and an "Adaptive Context Engine" that dynamically maps higher timeframes off `timeframe.multiplier` (source lines 245–270), plus a "Weighted Scoring Engine" (lines 275–285). Page: `https://www.tradingview.com/script/CmiDql3r-Dresteghamat-Adaptive-Multi-TF-Decision-Engine/`
- **Secondary script — `4wTf55tD-Dresteghamat-Multi-timeframe-Regime-Exhaustion`** (OPEN-SOURCE, published **Nov 19, 2025**, 2,911 views / 861 likes). Fetched directly. Verbatim: *"This script is a custom decision-support dashboard that aggregates volatility, momentum, and structural data across multiple timeframes to filter market noise. It addresses the problem of 'Analysis Paralysis' by automating the correlation between lower timeframe momentum and higher timeframe structure using a weighted scoring algorithm."* And on the adaptive selection: *"If Current TF < 5min, the script analyzes 15m and 1H data. If Current TF < 1H, it shifts to 4H and Daily data."* Dashboard outputs a MODE row — `BUY/SELL ONLY` (current-TF momentum aligns with HTF structure AND Exhaustion Score below threshold, default 70), `PULLBACK`, `HTF EXHAUST` (safety override), `WAIT`. Note the core scoring engine is **Protected/hidden** ("The logic is hidden (Protected) to preserve the proprietary weighting algorithm"), so despite the "open-source" badge only the dashboard/description is genuinely transparent. (via direct fetch)

No GitHub repository was found for this author's MTF engine (site `dresteghamat.com` + YouTube/Facebook/Instagram links only).

**(d) Grade:** PRIMARY (exists, open-source badge, description fetched directly) for *existence and mechanics-as-described*; note the proprietary hidden core and the total absence of any published backtest/win-rate — so the *edge* claim is unproven.

**(e) Meaning for PICC:** Confirms the "weighted multi-signal score per TF across Regime/Direction/Exhaustion planes, HTF dynamically anchored to the active chart TF" is a genuine, popular community pattern (5.7k likes). PICC's engine is NOT novel in concept. Differentiators worth keeping: PICC's own scoring weights, its explicit 4H regime gate, and (critically) *published, REPRODUCIBLE results* none of these scripts provide. All scripts are feature-inspectable as design references.

---

## 2. MTF Stochastic Confluence (FibonacciFlux) — TradingView

**(a) Claim:** An open-source TradingView script computing a multi-timeframe Stochastic confluence score across 15m/1H/4H with a threshold-based trade trigger, and publishing its own backtest (5,982 bars, 2026-06-25→08-26, threshold 70, "62% win").

**(b) Searched:** TradingView script by name/ID; both EN and RU pages.

**(c) Actual existence — VERIFIED:**

- **Script — `dYxSAc89-MTF-Stochastic-Confluence-FibonacciFlux`** (author FibonacciFlux). Fetched (RU `ru.tradingview.com/script/dYxSAc89-...`). Description (translated) confirms: Stochastic %K computed on **15m / 1H / 4H**; a weighted mean forms a **composite confluence line**; **score = 100 × position × (0.30 + 0.25·coherence + 0.30·turn + 0.15·cross)**; a trigger requires **3 conditions**; and the script self-reports a backtest over **5,982 bars of 15m data, 2026-06-25 → 2026-08-26, threshold 70**.

**(d) Grade:** PRIMARY for existence (direct fetch of the authored script page). The *backtest claim* (62% win) is only as strong as the script's own self-report — no independent methodology, costs, or out-of-sample detail — so treat the specific win-rate as WEAK.

**(e) Meaning for PICC:** This is the closest public analogue to PICC's multi-plane confluence scoring: same "weighted composite of indicator planes, then threshold into a trigger" shape, plus a published test window. Use it as a design reference for score normalization (the position × weight formula is a clean example). But PICC should not borrow its "62%" as evidence — self-reported, single-symbol, no costs.

---

## 3. "HSI MTF RSI Confluence Backtest" — as a TradingView script

**(a) Claim:** An HSI (Hang Seng) multi-timeframe RSI confluence *backtest* exists as a TradingView script.

**(b) Searched:** TradingView script search; the only match was `pinescriptforge.com/hsi/mtf-rsi-confluence/backtest`.

**(c) Actual existence — UNFOUND as a TradingView script:** The listed URL is on **PineScriptForge.com**, which is a **Pine-script (AI) generator / SaaS marketing site**, not a TradingView-hosted indicator. Fetched page delivered generic landing content (commission boilerplate, entry-strategy text), not a verifiable backtest or script source. There is no evidence this is a real, usable, backtested script rather than marketing copy for a code-generation service.

**(d) Grade:** UNFOUND (as a TradingView script). The page exists (PRIMARY that the *site* exists) but does not substantiate a genuine backtest tool; the "backtest" is at best WEAK marketing.

**(e) Meaning for PICC:** Do not cite or rely on this as an existing MTF backtest. PICC's own multi-timeframe confluence backtest is, as far as this research shows, *not* readily available as a vetted open-source analogue — which strengthens the case for PICC building-and-validating its own rather than adapting.

---

## 4. Signal-notification projects

### 4a. SignalVoice (voice-first signal app)

**(a) Claim:** A voice-first Android app for receiving trading signals; webhook backend → Firebase; Kotlin/Jetpack Compose client.

**(b) Searched:** The listed `sommerengineering.com/signalvoice.html`.

**(c) Actual existence — VERIFIED:** Fetched directly. Confirms: voice-first Android app; **webhook backend (Python) → Firebase Realtime DB**; **Kotlin/Jetpack Compose** client with **Room** persistence, **FCM** push, and a **TTS foreground service** for spoken alerts. Hosted on **Sommer Engineering's personal site** (with a Play Store link), **not on GitHub**.

**(d) Grade:** PRIMARY for existence (direct fetch of the author's own page). WEAK as a reusable asset — no public repo, single-author, no independent validation.

**(e) Meaning for PICC:** Confirms the "webhook → backend → push/speak alert" delivery pattern end-to-end (the same shape PICC needs for binary-options expiry nudges). Voice/TTS + FCM foreground service is a proven architecture. But because it isn't open-source on GitHub it is a *pattern reference*, not a component PICC can fork.

### 4b. QuantSys — stock breakout prediction + Telegram (IGCA paper)

**(a) Claim:** A peer-reviewed system integrating SMA/EMA breakout detection with a Telegram bot for stock alerts.

**(b) Searched:** IJCA archive; the paper PDF; GitHub for the paper's repo.

**(c) Actual existence — VERIFIED (paper) / UNFOUND (official repo):** The paper is real: Kashyap Mavani, Rahul M. Samant, Pranjal Mulay, Vaishnavi Jadhav, **"QuantSys: A Stock Breakout Value Prediction System using an Algorithmic Approach," Int. J. Computer Applications 187(16):12–18 (June 2025), DOI 10.5120/ijca2025925163**, PDF at `ijcaonline.org/archives/volume187/number16/mavani-2025-ijca-925163.pdf`. Abstract confirms: *"built using Python and leverages the yfinance module... monitors stock movement across various timeframes, such as 1-minute, 5-minute, daily, and weekly intervals... One of the standout features of QuantSys is its seamless integration with a Telegram bot... sends a detailed and instant alert."* Reported result (Table 1, Nifty50, daily, EMA(2) vs EMA(10)): **35 predictions, 19 correct / 17 incorrect, "Prediction Accuracy 54.29%"** (table internals are internally inconsistent — 19+17≠35 — and Table 2 repeats "54.29%" for a different 14-prediction run; treat the figure as sloppy). **No official GitHub repo by the authors exists** — GitHub hits (`Zeppelinpp/QuantSys` = unrelated Chinese A-share system; `ethanxli/QuantSys` = unrelated 2013 C# platform, 27 stars) are NOT this paper's code.

**(d) Grade:** PRIMARY for the published paper (peer-reviewed indexing via IJCA + DOI). UNFOUND for the specific "overbought/oversold Telegram bot" framing — this paper is about **SMA/EMA breakout prediction**, not overbought/oversold oscillators.

**(e) Meaning for PICC:** A citable precedent that "moving-average breakout detection + cross-timeframe monitoring + Telegram push" is publishable and real. But it is **not** an MTF overbought/oversold confluence engine, and its reported accuracy (~54%) is near-chance and internally inconsistent — do not use it as evidence of edge. Its architecture (yfinance + multi-timeframe scan + Telegram) maps directly onto PICC's signal-delivery layer.

### 4c. Pinecone Trading Alerts (GitHub)

**(a) Claim:** A production-ready GitHub system receiving real-time TradingView + Deriv signals and routing them to Discord/Telegram via dual bots.

**(b) Searched:** README of `github.com/Doc-Scripter/pinecone-trading-alerts`.

**(c) Actual existence — VERIFIED:** README fetched directly. Confirms: **"Real-time Processing: Sub-second alert delivery"**; **15+ candlestick patterns with confidence scoring**; **"Multi-Platform Support: TradingView + Deriv integration"**; **"Dual Bot Architecture: Discord + Telegram with intelligent routing"**; AI news sentiment + a "Smart Consensus Engine"; enterprise security (IP whitelisting, signature verification, rate limiting); Docker/Kubernetes/CI-CD. Top-level file structure (`pinecone_scripts/tradingview/...`, `bot_services/telegram`, etc.) is present in the repo.

**(d) Grade:** PRIMARY for existence and feature scope (README fetched directly). The "Sub-second" and "AI" claims are self-reported; no benchmarks, star count is modest, no independent validation.

**(e) Meaning for PICC:** The most complete open-source **signal-delivery** reference in this batch: webhook intake → pattern classification → multi-channel router → Discord/Telegram. Directly relevant to PICC's notification layer (esp. the consensus-of-signals and IP-whitelisting/secret patterns).

### 4d. crypto-signal-mcp (GitHub, MCP server)

**(a) Claim:** A Model Context Protocol (MCP) server exposing multi-exchange crypto signals to AI agents, with AI-enhanced signals, portfolio optimization, and context-aware notifications.

**(b) Searched:** README of `github.com/myownipgit/crypto-signal-mcp`.

**(c) Actual existence — VERIFIED:** Repo exists (`myownipgit/crypto-signal-mcp`, created 2025-07-05, ~2 stars, 3 commits). README/description confirms: **MCP server (JSON-RPC 2.0, stdio + HTTP/WebSocket transports)**; **multi-exchange intelligence (15+ exchanges)**; **AI-enhanced signals**; **portfolio optimization**; **"Context-aware notifications with social sentiment integration."**

**(d) Grade:** PRIMARY for existence (README/doc confirmed). Very low adoption (~2 stars, 3 commits) — thin empirical base; treat as an early-stage reference, not a hardened dependency.

**(e) Meaning for PICC:** The interesting idea for PICC is **exposing trading signals as an MCP tool so AI agents can query/consume them** (JSON-RPC + stdio/HTTP). A pattern to consider if PICC wants an agent-facing signal API, not a scale reference.

### 4e. Overbought/oversold Telegram bot + data mining (paper + GitHub)

**(a) Claim:** A real implementation of data-mining + a Telegram bot pushing RSI overbought/oversold notifications for crypto.

**(b) Searched:** The Jurnal TeIKa paper page (fetched); GitHub alternatives.

**(c) Actual existence — VERIFIED (paper) / VERIFIED (alternatives):** Jurnal TeIKa article **"Implementation of Data Mining Technology and Bot Notifications to Support Cryptocurrency Trading Decisions"** (authors R. Parlika et al., UPN "Veteran" Jawa Timur; **TeIKa 15(2):97–108, Oct 2025; DOI 10.36342/n7afej11**; CC-BY-SA; PDF at `jurnal.unai.edu/teika/article/view/4379/2775`). Abstract (fetched verbatim): *"This system uses the public API of Indodax to obtain real-time price data and analyzes it using the RSI indicator dynamically... The analysis results are then connected to a Telegram bot, enabling it to send automatic notifications when overbought or oversold conditions occur."* — i.e., exactly the "RSI oversold/overbought → Telegram" pattern, on Indodax data. GitHub alternatives for the same pattern: `dagimgen/-stock-alert-bot` (RSI overbought/oversold + golden/death cross alerts), `Stell0/financealerts` (Telegram overbought/oversold from a list), `agntdev/rsi-watcher-bot` (IQ Option candles, RSI <30/>70 alerts) — all modest-star, unvalidated.

**(d) Grade:** PRIMARY for the paper's existence (peer-reviewed-indexed journal, fetched directly). No published performance metrics in the abstract; the GitHub bots are WEAK-to-SECONDARY (small, self-published).

**(e) Meaning for PICC:** The "RSI over/oversold threshold event → Telegram bot push" loop is a *recurring, verifiable* open-source pattern (paper + ≥3 GitHub repos), which de-risks PICC's notification design. Note it uses *single-timeframe RSI* — not MTF confluence — so it validates the delivery loop, not PICC's confluence logic.

### 4f. General TradingView→Telegram webhook alternatives (well-starred)

**(a) Claim:** Well-adopted open-source TradingView→Telegram webhook relay bots exist beyond the low-star found earlier.

**(b) Searched:** GitHub search for TradingView webhook/Telegram alert bots.

**(c) Actual existence — VERIFIED (multiple, including well-starred):**
- **`fabston/TradingView-Webhook-Bot`** (README fetched via listing): *"Send TradingView alerts to Telegram, Discord, Slack, Twitter and Email"* — **1,842 stars / 502 forks, MIT, created 2020-04-21**, Flask + python-telegram-bot, `{{close}}`/`{{exchange}}` variable support, per-channel routing, shared-secret auth. `https://github.com/fabston/TradingView-Webhook-Bot`
- **`soranoo/TradingView-Free-Webhook-Alerts`** (via listing): **424 stars, GPL-3.0**, started 2022-02-01; designed for **basic (non-premium) TradingView plans**; supports Discord monitoring and (Dec 2024) **Telegram broadcast**. `https://github.com/soranoo/TradingView-Free-Webhook-Alerts`
- Smaller/other: `trendoscope-algorithms/Tradingview-Telegram-Bot` (41 stars, adds **chart screenshot** to the Telegram alert), `Wlddzuk/TradingView-to-Telegram` (0 stars, FastAPI/Docker), `cyberapper/tradingview-webhook-bot` (1 star), `Caramelos/telegram-trading-bot` (0 stars), `Mauro-Dev-T/tradingview-telegram-bot` (0 stars).

**(d) Grade:** PRIMARY for the two high-star repos (1.8k / 424 stars — real, adopted, citable); SECONDARY-to-WEAK for the small ones.

**(e) Meaning for PICC:** Adoption is mature: fabston's bot (1.8k★) is the de-facto reference for **TradingView-webhook → Telegram** relay with auth and variable interpolation; soranoo's covers the **non-premium** (email-scrape) path — directly relevant because PICC's 4H/1H alerts on a premium-unclear plan can choose webhook (fabston) or email-scrape (soranoo). Both are forkable delivery layers.

---

## 5. AI browser extensions overlaid on TradingView

### 5a. Orbital Trade — AI Stock Scanner & Signals

**(a) Claim:** Chrome extension doing real-time anomaly detection, thesis generation, and an AI copilot for US/SGX/HK markets; "600+ stock anomalies."

**(b) Searched:** Chrome Web Store listing `kfndmcgcalllbgjiebgjhmefhfoiimde` (fetched directly).

**(c) Actual existence — VERIFIED:** Official listing confirms *"AI-powered trading intelligence overlay. Real-time anomaly detection, thesis generation, and AI copilot for US, SGX, and HK markets."* Scans NYSE/NASDAQ (plus AMEX), SGX, HKEX; detects *"breakouts on volume, oversold large caps, sector rotation, RSI extremes, and pullback-in-uptrend setups"*; AI theses with entry/stop/target; multi-timeframe panel on TradingView (Weekly/Daily/4H/1H) and a "SIGNAL ENGINE" using **EMA(8), VWAP, RSI(3), MACD**; on-page signal badge. Version 0.3.0, updated 2026-06-30, **7 users, 0 ratings**, by Epiphyte (EPYPHITE PTE. LTD., Singapore); freemium (Trader S$15 / Active S$35 / Pro S$99 per month). The "**600+ stocks**" claim is in the description ("monitors 600+ stocks across three exchanges") — confirmed in listing text.

**(d) Grade:** PRIMARY for existence/features (official store listing fetched). **WEAK on adoption/validation** (7 users, 0 ratings; commercial paid tiers).

**(e) Meaning for PICC:** Closest commercial analogue in the extension space — multi-timeframe (incl. 4H) + anomaly + AI thesis + TradingView overlay. Confirms PICC's product shape (scan → thesis → play with entry/stop/target, MTF confirmation) is market-recognized. Very low adoption + paywall means it isn't a strong validation signal — and the RSI(3)/EMA(8)/VWAP signal engine is a useful, simple technical model to contrast with PICC's confluence scoring.

### 5b. TradingView Remix: AI Chart Copilot

**(a) Claim:** Popular Chrome extension adding an AI chatbot copilot to TradingView (chart automation, alerts, paper trading).

**(b) Searched:** Chrome Web Store listing `fchmejnoncmdhlebgdgifdnehoibalnd`.

**(c) Actual existence — VERIFIED:** Official listing confirms **4.3★ (125 ratings), ~100,000 users**, publisher tvremix.xyz with a "good record" badge; overview "AI-powered chatbot interface for TradingView" covering chart automation, alerts management, paper trading. (Fetched via listing/related excerpt this session; the store card text is confirmed.)

**(d) Grade:** PRIMARY for existence + popularity (official store listing with ~100k users / 4.3★).

**(e) Meaning for PICC:** Demonstrates real user demand (100k users) for an **AI chat copilot inside TradingView** that manages charts/alerts/paper trading. Supports the "AI assistant over the chart" product direction; PICC's niche would be the MTF-confluence *engine* under that copilot, versus Remix's general chatbot.

### 5c. FinSignal — AI Finance Agents

**(a) Claim:** Chrome extension producing BUY/SELL/HOLD signals from 8 specialist AI agents (Claude / local Ollama / Chrome AI) with confidence-scored verdicts and cited analysis.

**(b) Searched:** Chrome Web Store listing `epcgnknaidobnklhlhdohlbdainbbegl` (fetched directly).

**(c) Actual existence — VERIFIED:** Official listing (fetched verbatim): *"Buy/sell signals powered by Claude, Ollama (local), or Chrome AI — 8 specialist financial agents with cited analysis"*; *"runs eight specialist financial agents over each ticker and combines their findings into one confidence-scored verdict, a price target, and a plain-English thesis."* The 8 agents are named (Technical — RSI/MACD/Bollinger, Fundamental, News & Sentiment, Analyst, Risk, Earnings Reviewer, Market Researcher, KYC & Compliance). On-page signal badge on Yahoo Finance / **TradingView** / Robinhood / Schwab / Google Finance. No servers/analytics; BYO API key. Version 0.2.0, updated 2026-06-17, **5 users, 0 ratings**, by CyanProtocol LLC.

**(d) Grade:** PRIMARY for existence/features (official listing fetched). **WEAK on adoption** (5 users, 0 ratings).

**(e) Meaning for PICC:** Validates the **multi-agent ensemble → single confidence-scored verdict** design (each agent votes, consensus → conviction + price target), which is a strong template for PICC's confluence scoring + thesis generation. The RSI/MACD/Bollinger "Technical" agent + TradingView on-page signal overlap precisely with PICC's indicator planes. Near-zero adoption = no performance evidence, as expected.

### 5d. TV Co-Pilot

**(a) Claim:** Extension that reads the current TradingView chart, evaluates setups against the user's own playbook, and returns LONG/SHORT/SKIP verdicts with HTF bias included.

**(b) Searched:** Chrome Web Store listing `kdgpjifighhheplkckdekkegigjcfpki` (fetched directly).

**(c) Actual existence — VERIFIED:** Official listing (fetched verbatim): *"Talk to your chart. Symbol, interval, recent bars, and indicators are pulled from the chart automatically. No screenshots, no copy-paste."*; *"Evaluate setups against your own playbook... get a one-shot verdict for the current chart: LONG / SHORT / SKIP with confluences and invalidations listed."*; **"Multi-timeframe context, automatic. The HTF bias is included in the prompt by default so the evaluation isn't blind to the daily."** Also: Pine script write/fix-loop; verdicts persist per symbol:interval; Claude 4.7 backend by default. Version 0.4.5, updated 2026-07-02, **9 users, 0 ratings**.

**(d) Grade:** PRIMARY for existence/features (official listing fetched). **WEAK on adoption** (9 users, 0 ratings).

**(e) Meaning for PICC:** The single most aligned extension reference for PICC's *engine* semantics: **reads MTF automatically, injects HTF bias, emits a directed verdict (LONG/SHORT/SKIP) with confluences + invalidations**, and supports user-supplied playbooks (ICT/Wyckoff/supply-demand). PICC's confluence engine is essentially the deterministic, reproducible core of what TV Co-Pilot does with an LLM. PICC's differentiator: its verdicts are computed from explicit scorer weights (auditable, backtestable) rather than black-box LLM judgment; and it can *generate* Pine against the same engine.

---

## 6. Human-in-the-loop / human-alignment trading research

**(a) Claim:** The literature supports (i) multi-agent LLM trading frameworks and (ii) aligning RL trading agents to a human trader's behaviour producing measurable outperformance.

**(b) Searched:** arXiv, ScienceDirect/Elsevier, Crossref/DOI lookups for the listed papers and metric extraction.

**(c) Actual existence — VERIFIED (peer-reviewed literature, with metrics):**

- **TradingAgents — Xiao, Sun, Luo, Wang (2025), arXiv:2412.20138, "TradingAgents: Multi-Agents LLM Financial Trading Framework"** (q-fin.TR; Oral @ "Multi-Agent AI in the Real World"). Framework of specialized LLM agents (fundamental/sentiment/technical analysts; Bull/Bear researchers; risk team; traders) with agentic debate. Results (fetched): *"TradingAgents achieves at least a 23.21% cumulative return"* over **Jan 1 – Mar 29 2024**, on AAPL/NVDA/MSFT/META/GOOGL (60 technical indicators per asset); *"notable improvements in cumulative returns, Sharpe ratio, and maximum drawdown"* vs baselines. Author caveat: *"The highest Sharpe Ratio exceeds our expected empirical range (SR above 2 – very good, above 3 – excellent)... resulted from... few pullbacks in TradingAgents during that period."* Open source: `github.com/TauricResearch/TradingAgents` (actively maintained).
- **Ye & Schuller (2023), "Human-aligned trading by imitative multi-loss reinforcement learning," Expert Systems with Applications 234:120939 (Dec 30, 2023), DOI 10.1016/j.eswa.2023.120939** (open access CC-BY-NC-ND). Proposes an **imitative multi-loss DQN** aligning the machine to a human trader; *"introduce a realistic backtesting setup and a holding position-aware profit calculation scheme under which the machine algorithm conducts intra-day trading using minute tick data over a group of U.S. stocks... Our model's overall out-performance over a group of baseline models as well as our ablation study results justify the inclusion of individual model features."* (Abstract fetched; exact win-rate/Sharpe figures sit in the full text — paywalled, not extracted in-session.)
- **Huang et al. (2024), "Improving algorithmic trading consistency via human alignment and imitation learning," Expert Systems with Applications (Nov 2024)** — ScienceDirect ref S0957417424012168; cited as the companion "consistency" result to Ye et al. (full text not fetched this session).
- **Ye et al. (2024), "A multi-agent reinforcement learning framework for optimizing financial trading strategies based on TimesNet," ESWA (2024)** — cited in the crypto-DRL survey; multi-agent RL for trading (TimesNet-based) — shows the multi-agent RL trend feeding into this space.
- **Retzlaff et al. (2024), "Human-in-the-Loop Reinforcement Learning: A Survey," J. Artificial Intelligence Research** — the standard HITL-RL survey (context on why to keep a human in the loop); plus a 2025 arXiv (2504.17006) on real-world HITL DRL design.
- **Concrete win-rate numbers from adjacent DRL trading work (arXiv:2411.07585, "Reinforcement Learning Framework for Quantitative Trading")**: PPO produced a **27% win rate** with negative return; tuned DQN reached **45.9% win rate / Sharpe 0.24 / 13.5% return (2-yr)**, and an aggressively-tuned DQN hit **100% win rate but on a single trade** — flagged by the authors as a likely **overfitting** concern. This is a useful caution against trusting headline win-rates.

**(d) Grade:** PRIMARY for the peer-reviewed items (arXiv + Elsevier ESWA, with fetched abstracts/citations). Metrics for Ye & Schuller 2023 and Huang 2024 (exact Sharpe/win) are **UNVERIFIED-in-full** (paywalled full texts).

**(e) Meaning for PICC:** Three supported conclusions. (1) **Multi-agent LLM ensembles measurably beat single/rule baselines in backtests** (TradingAgents: ≥23.21% cumulative over 3 months on mega-caps) — this is the strongest published validation for PICC's "AI thesis + confluence" direction, with the caveat that the authors themselves flag the stratospheric Sharpe and the short window. (2) **Aligning an agent to a human's behaviour improves trading** (Ye & Schuller) — supports a "human-confirmed / human-playbook" mode in PICC rather than fully-autonomous. (3) **Win-rate claims are fragile** (27%→46%→100% under hyper-parameter change, last one overfit), so PICC should publish robust, cost-adjusted, OOS results — and treat any third-party "75% win" as suspect unless methodology is shown.

---

## Confidence summary

| # | Item | Verdict | Key evidence |
|---|------|---------|--------------|
| 1 | Dresteghamat Adaptive MTF Decision Engine | **VERIFIED** | Live open-source TradingView scripts (45.5k views / 2.9k views) fetched verbatim; Regime/Direction/Exhaustion + adaptive HTF |
| 2 | MTF Stochastic Confluence (FibonacciFlux) | **VERIFIED** | Script + self-reported 5,982-bar backtest fetched (Russian page); specific win-rate self-reported only |
| 3 | "HSI MTF RSI Confluence Backtest" | **UNFOUND** (as a TradingView script) | Only exists as PineScriptForge marketing/landing text, not a real hosted script/backtest |
| 4a | SignalVoice | **VERIFIED** | Author page fetched: webhook→Firebase→Kotlin/Compose app, FCM + TTS; not on GitHub |
| 4b | QuantSys | **VERIFIED** (paper); repo **UNFOUND** | IJCA 187(16):12–18 (2025), DOI, abstract fetched; a real paper, not repo-backed; SMA/EMA breakout, not overbought/oversold |
| 4c | Pinecone Trading Alerts | **VERIFIED** | README fetched: TV+Deriv webhook → router → Discord/Telegram dual bots |
| 4d | crypto-signal-mcp | **VERIFIED** | README fetched: MCP server, JSON-RPC stdio/HTTP; 15+ exchanges |
| 4e | OB/OS Telegram bot + data mining | **VERIFIED** | TeIKa 15(2) paper fetched (Indodax API + RSI → Telegram); + ≥3 GitHub repos |
| 4f | TV→Telegram webhook alternatives | **VERIFIED** | fabston 1,842★; soranoo 424★ (free-plan path) |
| 5a | Orbital Trade | **VERIFIED** | Official store listing fetched (600+ stocks, US/SGX/HK, MTF overlay); 7 users/0 ratings |
| 5b | TradingView Remix | **VERIFIED** | ~100k users, 4.3★ official listing |
| 5c | FinSignal | **VERIFIED** | Official listing fetched: 8 agents → confidence verdict; 5 users |
| 5d | TV Co-Pilot | **VERIFIED** | Official listing fetched: MTF/HTF-bias LONG/SHORT/SKIP verdicts; 9 users |
| 6 | Human-in-loop / alignment research | **VERIFIED** (literature); some metrics **UNVERIFIED** | TradingAgents ≥23.21% ret; Ye & Schuller ESWA 2023; exact Sharpe for some papers paywalled |

## What could NOT be verified (with what was tried)

- **QuantSys official source repo.** Searched GitHub for the IJCA paper's code; no repo by the authors. Closest GitHub matches are unrelated projects. The paper itself (PDF) is verified; its code is not public.
- **Dresteghamat's actual Pine source.** The script carries an "OPEN-SOURCE" badge, but the core scoring engine is described as **Protected/hidden** ("The logic is hidden (Protected) to preserve the proprietary weighting algorithm"). Only the dashboard/description is inspectable; no GitHub repo found. The *claims about its mechanics* are thus verified from its own description, not the code.
- **Exact win-rate / Sharpe numbers for Ye & Schuller 2023 (ESWA 234:120939) and Huang 2024 (S0957417424012168).** Abstracts confirm outperformance over baselines and buy-and-hold; the concrete test-statistic tables sit in Elsevier full text, which returned a 400 / paywall in-session. Verdict: papers verified, headline metric values NOT directly extracted.
- **A direct full-page fetch of either QuantSys's reported accuracy tables or TradingAgents' full result tables** — both retrieved via search-listed snippets of the PDF/HTML rather than byte-exact page fetches; numbers are reliable per the source text but the QuantSys tables have an internal inconsistency (35 predictions vs 19+17=36 listed; two different runs both labeled "54.29%").
- **"600+ stock anomalies" as a live scanned count** — confirmed as the listing's *description* ("monitors 600+ stocks across three exchanges"), not an independently verifiable runtime figure.
- **Metrics for the S0957417424012168 / S0957417423014410 permutations beyond the fetched abstracts** — same paywall caveat as above.

---

## Bottom line for the PICC engine (verified-claim summary)

1. **The "weighted MTF confluence scored into a trigger/verdict" pattern is a real, popular, and fully open community standard** (Dresteghamat, FibonacciFlux, TV Co-Pilot's engine role) — PICC is not first here. Its differentiator must be **published, reproducible, cost-adjusted results**, which none of the fetched scripts provide.
2. **No vetted, genuinely-backtested "MTF confluence backtest" exists as a reusable TradingView script** ("HSI MTF RSI Confluence Backtest" is marketing on a Pine-generator site). PICC building its own (and open-sourcing it) is the defensible move.
3. **Signal delivery is a solved, mature open-source problem**: webhook→Telegram/Discord relay is well-adopted (fabston 1.8k★), has a free-plan path (soranoo 424★), and is documented end-to-end in papers (TeIKa, IJCA QuantSys) and repos (Pinecone). PICC should fork/augment rather than rebuild its delivery layer; add MCP exposure (crypto-signal-mcp pattern) if it wants an agent-facing API.
4. **The AI-over-TradingView extension space validates PICC's product shape** (scan → MTF thesis → play with SL/TP → on-chart overlay) and an AI copilot with **HTF-bias-aware** verdicts (TV Co-Pilot). All materials are near-zero-adoption or unvalidated — none are evidence of edge.
5. **The strongest evidence for the overall AI direction is academic**: multi-agent LLM frameworks beat baselines in backtests (TradingAgents ≥23.21% cumulative over 3 months, with the authors' own too-good-Sharpe caveat), and human-alignment/imitation improves RL trading (Ye & Schuller 2023). In *every* source, headline win-rates are fragile and overfit-prone — PICC should ship auditable scores, OOS validation, and honest disclaimers, not a cherry-picked "win rate."

*Report compiled August 28, 2026. All quotes taken from pages fetched or search-listed during this session; source-quality grades reflect verifiability in-session, not general reputability.*
