# B-PAP-1 — Paper-ledger vs real-money separation audit

> Read-only audit (B-PAP-1 of `docs/specs/PICC_TRADING_SUITE_REBUILD_v1.md`, §8).
> Every path/claim below was read; file:line is given for each. No code touched.

## 1. Paper ledger — exact location and shape

| Item | Value | Evidence |
|---|---|---|
| File | `apps/dashboard/server/data/trading-ledger.json` (env override `PICC_TRADING_DATA_DIR`) | `server/services/trading.mjs:27-28` (`DATA_DIR`), `:36` (`LEDGER_FILE = join(DATA_DIR, "trading-ledger.json")`) |
| Shape | `{ positions: [], closed: [], signals: [] }` | `trading.mjs:104` (`DEFAULT_LEDGER`), `:223-238` (`getLedger`/`saveLedger` normalise to those three arrays) |
| Position record | `{id, correlationId, signalId, symbol, side, entry, amount, takeProfit, stopLoss, modelVotes, openedAt, status:"open"}` | `trading.mjs:659-672` |
| Closed-trade record | position + `status:"closed", exit, pnl, reason, exitSource, closedAt, holdingMs` | `trading.mjs:692-701` |
| Caps | positions 200 / closed 500 / signals 200 (newest wins) | `trading.mjs:232-237` |
| Storage class | Plain JSON, NOT vault (only creds + venue tokens go through the at-rest vault) | `trading.mjs:45-48` (`SECRET_FILES`) |
| Concurrency | Single promise-chain lock around all mutating ops | `trading.mjs:240-251` (`withLedgerLock`) |
| API surface | `openPaperTrade` `trading.mjs:574`, `closePaperTrade` `:678`, `checkPaperExit` `:748`, `paperOverview` `:254-273`, `paperAnalytics` `:388-465`, `paperPositions`/`paperHistory` `:275-283`; HTTP: `handlers.mjs:1971-2051` | |
| Risk config | `paperStartingBalance` default 10000 (`:97,:159`), `riskPerTradePct` default 2, clamped 1–20 (`:98,:160`) | |
| Status envelope | `tradingStatus()` returns `mode:"paper"`, `paper:{...overview}` and a **separate** `expertOption:{balance,demoWallet,realWallet,...}` block | `trading.mjs:943-1019` (esp. `:1000`, `:1003-1017`) |

The paper ledger is a local simulated-money store. It is the only "trading" wallet PICC itself persists PnL for; nothing in the paper path places real orders (`trading.mjs:1-4`).

## 2. Real-venue money sources (enumerated)

There is **no real-money execution path**. Every venue surface is demo-only or a read-only balance observation:

1. **EO live-session balance via `liveEO`/broker snapshot** — `tradingStatus().expertOption.{balance,currency,demoWallet,realWallet}` from `fetchFreshAccount()` or `getBrokerData().account` fallback. `trading.mjs:954-980`, `:1003-1015`. Also `demoStatus().balance` from EO session `session.balance()`. `autopilot.mjs:983-989`.
2. **Account-metrics store** — `apps/dashboard/server/data/account-metrics.json`, keyed `{ [userId]: { [venueId]: record } }`. Demo vs real wallet parsed separately per observed WS profile frame. `services/accountMetrics.mjs:36-39`, `:18-24`, `:93-144` (`parseAccountFrame`), `:257-262` (frames from `liveEOAccountRaw`), `:205-234` (store). HTTP read: `handlers.mjs:1328-1334`.
3. **Demo-deals file** — `apps/dashboard/server/data/trading-demo-deals.json`, shape `{ deals: [...] }`; settled EO **demo** deals with `profit`/`result`/`payout`. `autopilot.mjs:32`, `:654-668` (`recordDealLocked`). Served via `demoDeals` `:1313`, `demoAnalytics` `:1324`, `demoStatus.settled` `:1001`.
4. **Live demo-session open deals** — `state.session.deals()` from the connected EO WS gateway. `autopilot.mjs:978`; consumed by the position manager `positionManager.mjs:60-73`.
5. **Connector snapshots (income side)** — `getLatestSnapshots()` (normalized balance/today/lifetime). `handlers.mjs:3616`; `services/connectors.mjs:337`, `:35-44` (snapshot shape), `connectors.mjs:109` (a connector *category* may be `"trading"`). The EO account metrics above do **not** flow through connectors.
6. **Demo-placement family — DEPRECATED.** `/api/trading/demo/place` → 410 "order execution removed — PICC is advisory-first" `handlers.mjs:2077-2079`; autopilot start/stop → 410 `handlers.mjs:2105-2113`; `autopilot.mjs:1006` `running: false, // execution removed — advisory-only`; execution functions deleted `autopilot.mjs:1381-1386`.

Note: the EO `realWallet` is only ever an *observed balance* (account-metrics / status), never a traded PnL — there are no real trades anywhere in the codebase.

## 3. Separation status

**Verdict: paper PnL and real-venue money are separated in storage and in every surface EXCEPT one deliberate aggregate that sums paper + EO-demo.** There is no merge between paper and a real-cash number, because no real-cash PnL exists.

Merges found (all paper ⊗ venue-**demo**, never paper ⊗ real-cash):

- **`combinedTodayPnl()` — server-side merge.** Returns `{ paper: {...}, expertoption: {...}, total: { pnl, trades } }` where `total.pnl = paperPnl + demoPnl`. `server/services/positionManager.mjs:126-153` (merge at `:151`).
- **`aggregateOpenPositions()` — server-side exposure merge.** Pushes paper open positions plus EO demo-session open deals into one `positions[]` and one `totals.notional`, while preserving a per-venue breakdown (`positions[i].venue`, `byVenue`). `positionManager.mjs:40-119` (`:44-74` sources, `:98-118` totals + byVenue).
- **Portfolio-aggregate UI renders the merged total as one number.** `aggregatePanelModel` sets `todayPnl: res.todayPnl?.total` `src/lib/integrationPanels.ts:60-65`; the panel paints a single "Today P&L (+$N) (n trades)" chip `src/components/PortfolioAggregatePanel.tsx:78-85`. Comment at `integrationPanels.ts:63` calls it "a real observed ledger aggregation".
- **`portfolioRiskCheck()`** consumes the merged exposure and merged `todayPnl.total`. `positionManager.mjs:160-210` (`:198-206`).

Separation that already holds (checked, no merge):

- **Status cards**: paper numbers and venue numbers are distinct cards, never summed. `TradingSuite.tsx:1040-1094` (paper cards `:1040-1061`, demo "Today" card `:1062-1075`, broker demo/real wallet card `:1076-1094`).
- **Paper analytics**: computes over `ledger.closed` only. `trading.mjs:388-465`.
- **Income overview**: summary = connector snapshots + stream rows only; no trading service imported. `handlers.mjs:884-909` (`incomeSummaryFromServer`), `:3605-3630` (`/api/income/overview`). Client shape `income.ts:173-179`.
- **Account metrics**: demoWallet and realWallet are distinct fields, never summed. `accountMetrics.mjs:133-137`.
- **Autopilot demo analytics**: metrics over the deals file only. `autopilot.mjs:1324-1378`.
- **Trading ledger stats**: decision hit/miss ledger, no money at all. `accuracyLedger.mjs:1-16`, `:25`; `handlers.mjs:1259-1264`.

Consumption scan for paper APIs (only these call them): paper HTTP endpoints `handlers.mjs:1974/1999/2045`, scheduler mark-to-market `scheduler.mjs:142`, interventions approve→`openPaperTrade` `interventions.mjs:367-371`, `:542-543`, `adaptiveConfluence.mjs:930`. **None feed income, connectors, or account metrics.**

Catalog caveat: `ExpertOption` is classified `category:"trading"` (`streamCatalog.ts:155`) but the block explicitly documents "Not income streams — these are active trading platforms" (`streamCatalog.ts:148-153`; category union at `:21`). A user could still create a **manual** stream row of category `"trading"` (user-entered; coerced in `income.ts:255-272`) — that is manual data, not automatic paper-PnL ingestion.

## 4. Per-surface inventory for the seven B-PAP-2 surfaces

| Surface | Buckets today | Evidence |
|---|---|---|
| **Status cards** | Two (paper cards vs demo/broker cards, never one number) | `TradingSuite.tsx:1040-1094` |
| **Paper analytics** | One (paper only) | `TradingSuite.tsx:1912-2019`; `trading.mjs:388-465` |
| **Income overview** | One, and trading PnL is *not in it at all* | `income.ts:173-179`; `handlers.mjs:884-909`, `:3605-3630` |
| **Account metrics** | One per (user, venue), demo/real wallets kept as separate fields | `accountMetrics.mjs:93-144`, `:205-234`; `handlers.mjs:1328-1334` |
| **Portfolio aggregate** | **Merged** — paper + EO-demo in one total (both exposure and today PnL) | `positionManager.mjs:40-119`, `:126-153`; `integrationPanels.ts:60-65`; `PortfolioAggregatePanel.tsx:78-85` |
| **Autopilot demo analytics** | One (demo-deals only) | `autopilot.mjs:1324-1378`; `handlers.mjs:2145-2162` |
| **Trading ledger stats** | One, money-less (decision hit/miss) | `accuracyLedger.mjs:1-16`; `handlers.mjs:1259-1264`; `LedgerPanel` (`TradingSuite.tsx:260`) |

Suite panel stack (26-ish panels, for context): `TradingSuite.tsx:218-283` (StatusCards → NewsCard; note: the stack block actually sits at `:218-283`, not `:176-206` as the spec guessed).

## 5. Recommendations for B-PAP-2 / 3 / 4

- **Status cards** — No change needed; separation already holds. Optional: keep the explicit "Paper / EO demo / Broker account" card split as-is (`TradingSuite.tsx:1040-1094`).
- **Paper analytics** — No change needed.
- **Income overview** — No ingestion change needed (paper PnL correctly excluded). B-PAP-3 option: decide whether manual user-entered streams of category `"trading"` should be flagged/excluded from the income total (`income.ts:255-272`).
- **Account metrics** — No change needed; wallets already split (`accountMetrics.mjs:133-137`).
- **Portfolio aggregate** — **The only required change.** B-PAP-2 must stop rendering a single merged number:
  - Server: `combinedTodayPnl()` already returns `paper` and `expertoption` slices — the merge exists only in `total` (`positionManager.mjs:148-152`). Choose to surface both slices; reconsider summing simulated (paper) and venue-demo PnL at all.
  - `aggregateOpenPositions()` already carries `byVenue` + per-position `venue`; B-PAP-2 should render per-venue exposure instead of only merged `totals.notional` (or label it "simulated + venue-demo").
  - UI: stop mapping `todayPnl.total` to the single chip (`integrationPanels.ts:63-65`, `PortfolioAggregatePanel.tsx:78-85`); show paper vs EO-demo separately.
  - `portfolioRiskCheck()` should not mix simulated and venue-demo exposure into one notional check (`positionManager.mjs:160-210`), or should weight venues by how "real" they are.
- **Autopilot demo analytics** — No change needed; already demo-deals-only. Cosmetic rename to "EO demo analytics" would sharpen the bucket boundary (`autopilot.mjs:1324`).
- **Trading ledger stats** — No change needed; decision ledger carries no money.

## Honesty notes

- This audit found **no surface that merges paper PnL with real-cash PnL**, because no real-cash PnL exists (no real execution path: `handlers.mjs:2077-2107`, `autopilot.mjs:1381-1386`; EO realWallet is an observed balance only).
- The one merge found is paper + EO-**demo** in the portfolio aggregate. If B-PAP-2's intent is strictly "separate simulated paper money from the live venue (demo account) money", that is exactly the surface to change.
- Unverified items (not asserted here): whether `account-metrics.json` / `trading-demo-deals.json` / `trading-ledger.json` physically exist on this machine (they are created lazily on demand); the in-memory accuracy ledger has no disk file (`accuracyLedger.mjs:25`).