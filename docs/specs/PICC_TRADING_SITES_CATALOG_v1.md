# PICC Trading Sites Catalog (v1)

- **Status:** APPROVED (2026-09-12) — format, expansion priority, multiplex rule, SITE_INDEX handling all approved per §7. · **Resolution:** ACTIVE — still the referenced source of truth for venue/source data (governor spec anchors §5; kept studio-current by the D1 spec sweep); carried forward with §6 slices C1–C4 and §4 expansion unshipped and §7 questions still open (**Date:** 2026-09-19)
- **Classification:** DATA CATALOG — the trading ministry's site/venue/data-source catalog (EO + CCXT focus per Q4), research-only, no keys
- **Owner directives (this session):** C6/7 — reroute to multiple always-free sources with resettable rate limits or unlimited usage, multiplex every functionality across PICC suites, web-search to find these sources; D8 — remove Supabase, keep everything local; E9 — proceed with workflow pack, adhere to "country-ministry-resource concept"; E10 — all data in docs catalog, develop mini-(lite) AI/ML platform for PICC functionality
- **Anchors:** `PICC_SUITE_MINISTRY_MODEL_v1.md` (ministry model, advisory-first); `PICC_EARNINGS_AGENTIC_MINISTRY_v1.md` §11 (tiered infra, Cactus Needle Tier-0); `EXTENSION_CONNECTIVITY_ENGINE.md` (broker capability contract, resolution honesty); `PICC_SIGNAL_VENUE_POOL_DECISION.md` (liveEO-only venue narrowing); `PICC_TRADING_SUITE_UPGRADE.md` (REQ-1..REQ-11, T1-T11 ground work)

## 1. Purpose

One catalog that answers, per trading site/venue/data source: **what data does it give us, how do we read it, what does it cost, and what may PICC do with it?** Every entry carries its rate-limit class, key requirement, and honesty status. The catalog is the single source of truth for the trading suite's "where does this number come from" surface (SOURCE_BADGES, broker rows, venue deep-links) and for the C6/7 multiplexing rule (each PICC suite may reuse any catalog entry's data).

## 2. Catalog entry schema

Every entry has exactly these fields (missing optional fields are omitted, never zero-filled):

| Field | Type | Meaning |
|---|---|---|
| `id` | string | stable slug, e.g. `expertoption`, `ccxt:binance`, `yahoo`, `coingecko` |
| `kind` | enum | `venue` (trading site, session-based), `exchange` (CCXT market-data venue), `market-data` (free price feed), `news`, `research`, `capture` (studio capture path) |
| `data` | string[] | what it provides (candles, ticker, orderbook, news, research...) |
| `auth` | enum | `none` \| `session` (broker demo login) \| `key-public` (free API key) \| `key-private` (signed/paid) |
| `rateLimit` | enum | `unlimited` \| `resettable` (rate window resets, free tier) \| `paid` |
| `rpmCapDefault` | number | PICC's own default cap on calls/minute for this source (PICC never exceeds the venue's cap) |
| `multiplex` | string[] | which PICC suites may consume this source's data (C6/7) |
| `providesFor` | string[] | PICC features it feeds (chart, alert, signal, news digest, intel...) |
| `verified` | bool | `true` only if a live/observed probe or a pinned test proved it this session |
| `note` | string | honest caveats (ToS, key expiry, no-key degradation contract, human-only steps) |

A catalog row with `verified:false` is a **candidate**, not a claim — it renders as "research pending" wherever surfaced.

## 3. Verified catalog entries (this session)

### 3.1 expertoption — venue + capture (VERIFIED, session-based)

- **kind:** `venue`, `capture`; **auth:** `session` (demo account, human login); **rateLimit:** `resettable` (PICC-side gate, venue is free demo)
- **data:** live candles `[60,300,900,3600]` (`expertoption.mjs:17` serves 1m/5m/15m/1h; 5s requests resolve to 1m, 4h resolves null — `EXTENSION_CONNECTIVITY_ENGINE.md` T5 chain), price frames via `liveEO` capture bridge
- **capture path:** `capture.via:"liveEO"`, every scan key `verified:true` (`captureProfiles.mjs:62,730-735`); EO is the ONLY venue with a live data bridge + `reconnectTriggered` (`captureProfiles.mjs:564-571,584`); `browserStudio.mjs:573-581` resolves EO to `mode:"venue"`, url `<root>` — this makes EO the only liveEO-verified venue in `resolveAlertVenue` (`PICC_SIGNAL_VENUE_POOL_DECISION.md`)
- **PICC cap:** `PICC_EO_GATEWAY_RPM` default 120 (rateLimited(), `handlers.mjs:321`); 429 → honest local rule engine (no fake data)
- **multiplex:** trading (chart/signal/venue deep-link), earnings (demo-session proof for go-live gate, `PICC_EARNINGS_AGENTIC_MINISTRY_v1.md` §10)
- **verified:** yes — capture keys, live bridge presence, adapter contract pin tests; the one HUMAN-only step is the demo session login (studio-browser capture when logged in; headless-only otherwise)
- **note:** demo balance must end higher than start for the trading trust gate; PICC never opens a headed browser, never places real orders (advisory-only, `PICC_UNIVERSAL_4FA_ENGINE.md`)

### 3.2 ccxt:<exchange> — exchange market-data (VERIFIED, key-less public data)

- **kind:** `exchange`; **auth:** `none` for public OHLCV/ticker/orderbook on listed exchanges; **rateLimit:** `resettable` (per-exchange public limits; PICC paces reads)
- **data:** real candles `[60,300,900,1800,3600,14400]` from `ccxtAdapter` (`EXTENSION_CONNECTIVITY_ENGINE.md:67` T6 curve); connector is **read-only** (`READ_ONLY_BLOCKED` order methods verified in `ccxtConnector.mjs` — no execution weld, `PICC_MULTISOURCE_ENGINE.md` pin)
- **configuration:** `ccxtExchanges` pairs on `TradingCredentials` — `{exchange, symbol, timeframe?, limit?}`; validated+stored by `sanitizePatch` (`trading.mjs:181-183`): exchange lowercased, limit clamped 1..1000 default 200, slice cap 12 pairs; wholesale replace via `POST /api/trading/credentials`, blank token keeps saved one
- **PICC cap:** `trading:ccxt` envelope (~10 USD venue minimum, `HYPERLIGUID_CONNECT_RUNBOOK.md:134`); per-source fetch cadence never exceeds `DECISION_INTERVAL_MS 15_000` (`adaptiveConfluence.mjs:54`)
- **multiplex:** trading (chart history, signal pre-checks), earnings (rates/payout digests via ccxt legs — `PICC_EARNINGS_AGENTIC_MINISTRY_v1.md` §12.2)
- **verified:** yes — sanitizer + round-trip tests (8 parser + 2 credential tests), adapter fixture tests
- **note:** Hyperliquid stage-4 proof waits on owner restart of the demo session; never connect a funded wallet (claim-usd.com advisory)

### 3.3 yahoo — market-data daily (VERIFIED, unlimited/no key)

- **kind:** `market-data`; **auth:** `none`; **rateLimit:** `unlimited` (public endpoint; PICC honors cache TTL)
- **data:** daily bars `[86400,604800,2592000]` (`yahooAdapter.mjs` `availableTimeframes`); interval/range mapping `1d/1wk/1mo`, partial bars dropped (never fakes gaps), errors propagate so the bus falls through to honest `source:"none"` (`EXTENSION_CONNECTIVITY_ENGINE.md` T7)
- **PICC cap:** cache TTL 600000 ms (`yahoo.mjs:7`) — one fetch per symbol per 10 min
- **multiplex:** trading (chart daily+), earnings, bandwidth (any suite needing delayed daily prices)
- **verified:** yes — `yahooAdapter.test.mjs` (5 fixture tests), intraday in `PICC_TRADING_SUITE_UPGRADE.md` REQ-1 (5m/15m/30m ~60d, 1h ~730d — API contract under test fixtures, not live network probe)
- **note:** Yahoo intraday interval passthrough exists (`yahoo.mjs:28`); 4h is NEVER served by Yahoo (resolver declines honestly — `PICC_TRADING_SUITE_UPGRADE.md` Decision B)

### 3.4 coingecko — crypto market-data (VERIFIED, unlimited/no key)

- **kind:** `market-data`; **auth:** `none`; **rateLimit:** `unlimited` (public API)
- **data:** crypto rates/prices; `providers()` reports `crypto:true` unconditionally (`config.mjs:98` — "CoinGecko public API — free, no key required")
- **PICC cap:** honored public cadence; no paid tier needed
- **multiplex:** trading, earnings (rates in payout digests), dashboard (any suite price widget)
- **verified:** yes — public API free tier is the designed no-key path (`config.mjs:98`)

### 3.5 browserStudio SITE_INDEX — venue deep-link registry (VERIFIED presence, per-venue data UNVERIFIED)

- **kind:** `venue` registry; **auth:** `none` for the registry itself; **rateLimit:** n/a
- **data:** per-venue base URLs + payout thresholds for `category:"trading"` venues: expertoption, binance, bybit, kucoin, okx, etoro, plus500, iqoption, olymptrade, deriv (`browserStudio.mjs:477-521`, map at `:513-521`)
- **PICC use:** "Trade on {venue}" deep-link redirects (studio-collect / web-app-decide model, `NEXT_WAVE_generalization.md` R5/R8 — collect side now the studio browser, post-D1); only `mode:"venue"` rows with a live capture leg produce deep links (`PICC_SIGNAL_VENUE_POOL_DECISION.md`)
- **multiplex:** trading (venue redirect), compliance (honesty labels "opens {venue} — you are leaving PICC's advisory view")
- **verified:** presence yes; per-venue capture-feasibility NOT verified this session (only EO has a verified live leg) — each row therefore stays a `candidate` until its own live-capture proof exists

## 4. Expansion slot — C6/7 candidate sources (RESEARCH PENDING)

Owner directive: reroute news/research/Amazon-intel features to **multiple always-free sources with resettable rate limits or unlimited usage**, found via web-search, multiplexed across suites. This is the Serper replacement work. Candidate classes to research (none verified yet — web-search is the next slice):

| Class | Needed for | Candidate shapes (to verify by web-search) |
|---|---|---|
| News feeds | news digest, alert context | RSS/Atom (no key), free-tier news APIs with resettable hourly/daily windows, exchange-native news endpoints |
| Research | guidance briefs, opportunity vetting | free-tier research APIs, public indices, exchange announcements |
| Amazon/retail intel | earnings intel (Serper replacement) | public tracking/wishlist endpoints, market APIs with resettable free tiers |
| Trading social/flow | "mimicking professional trades/traders is welcomed" (C6/7) | public analytics/leaderboard surfaces with no-key access |

Rule for every expansion candidate: `verified:false` until a live probe succeeds; a key-less degradation path must exist (the Serper lesson — 400 with no key is honest, but a 24/7 rotation never depends on a single source, `PICC_EARNINGS_AGENTIC_MINISTRY_v1.md` §11.2).

## 5. Multiplexing contract (C6/7)

- Any catalog entry's data is consumable by **any suite** that declares it in `multiplex` — no per-suite data silos.
- Rate-limit budget is **shared, governed**: total PICC calls/min across suites never exceeds the sum of per-source caps; the resource governor (§ `PICC_RESOURCE_GOVERNOR_v1.md`) owns the budget sheet.
- A suite consuming a source must render its honesty status from the catalog row (`verified`, `auth`, `rateLimit`), never from an assumption.

## 6. Slices

- **C1 — Catalog module (TDD):** `server/services/siteCatalog.mjs` exporting the §3 rows + `catalogEntry(id)`, `catalogByKind(kind)`, `multiplexFor(suiteId)`; unit tests assert field presence, no-undefined entries (same rule as trading catalog endpoint test), and the honest `verified:false` default for candidates. Acceptance: catalog rounds-trips through a vitest suite referencing this spec's table as ground truth.
- **C2 — Expansion research (web-search):** fill §4 with verified always-free/resettable sources; each gets a probe test (live HTTP check at test time where possible, fixture otherwise). Acceptance: ≥3 news + ≥2 research + ≥1 trading-flow source verified, each with a documented key-less path and PICC rpm cap.
- **C3 — Governor wiring:** resource governor reads the catalog for per-source rpm caps (only the `PICC_RESOURCE_GOVERNOR_v1.md` spec's budget sheet knows the shared envelope).
- **C4 — UI surface:** trading suite "Data sources" panel renders from the catalog (source, auth, rate-limit class, multiplex, verified badge) instead of hardcoded rows; SERPER badge row removed (Serper is dead — `serper.mjs` degrades honestly with no key, `news()` → `[]`).

## 7. Open questions — owner approval needed

1. **Format OK?** This doc-based catalog spec (schema §2 + verified entries §3 + candidate expansion §4) — or prefer the catalog as a **code module first** (C1) with this spec as its contract?
2. **Expansion priority order** for §4 web-search: news → research → trading-flow → amazon-intel, or a different order?
3. **Multiplex rule** (§5): confirm any suite may consume any entry — or should some data stay trading-only (e.g., EO venue data)?
4. **SITE_INDEX expansion** (§3.5): keep binary/okx/kucoin/bybit as registry rows in the catalog despite no verified capture leg today, or trim to EO-only until each gains a live leg?

## 8. Country-ministry-resource adherence (E9)

This catalog is the trading ministry's resource ledger, consistent with the ministry model: every entry names what it *automates* (data reads) and what it *never touches* (execution, keys, signed sends). Data reads are RUN-class; anything beyond reads (orders, withdrawals) is L-class and stops at the human. The catalog is also the instrument the Celeron-N resource floor uses: at any rpm budget, the cheapest verified source wins (Yahoo/CoinGecko before CCXT-burst before EO-poll), matching the tiny→cheap→heavy policy in `PICC_RESOURCE_GOVERNOR_v1.md` §3.

---

## Resolution (2026-09-19)

**Disposition: ACTIVE — carried forward.** The catalog is approved (`2026-09-12`) and remains the referenced source of truth for venue/source facts.

**Evidence it is still the source of truth:** `PICC_RESOURCE_GOVERNOR_v1.md:13,61` anchors its shared rpm-envelope / multiplexing contract to this file's §5; the D1-era spec sweep in `PICC_EXTENSION_ERADICATION_AND_SUITES_REBUILD_v1.md:100` **fixed** this file to studio reality (it was treated as current, not historical); `PICC_PACK1_LOCAL_TRADING_CORE_v1.md:48` defers news-source hookup to this catalog's §4 candidates. Verified §3 rows (`expertoption`, `ccxt:<exchange>`, `yahoo`, `coingecko`, browserStudio SITE_INDEX) match live code (`ccxtAdapter`, `yahooAdapter`, `captureProfiles.mjs`, `browserStudio.mjs:479-577` SITE_INDEX).

**What could NOT be verified (carried forward, not closed):**
- **§6 C1** — `server/services/siteCatalog.mjs` does **not** exist (grep: zero hits for `siteCatalog`/`catalogByKind`/`multiplexFor` across code and docs; the PACK-1 spec itself confirms "no siteCatalog.mjs"). The catalog's data was never materialized as a code module.
- **§6 C2** — §4 expansion candidates remain `verified:false` / RESEARCH PENDING; no expansion probe tests exist.
- **§6 C3/C4** — no governor wiring to per-source caps and no catalog-driven "Data sources" UI (Serper badge removal claim unverifiable — `serper.mjs` status not checked this pass).
- **§7** — the four open questions (format-ok, expansion priority, multiplex rule, SITE_INDEX trim-to-EO) still have no recorded answer in the repo.

Because its *data content* is current and actively referenced while its *implementation slices* and *open questions* are outstanding, this spec is carried forward rather than archived, superseded, or closed.

## Resolution note (2026-09-23 · WS-4)

The §2 `verified:false` default for social/leaderboard candidates (C6/7, §4 `verified:false`) is operationalized by the WS-4 follower store: per-leader `platformTrust` (`UNVERIFIED|VERIFIED|ADVERSARIAL`, operator-recorded, audit-backed) lives in `apps/dashboard/server/services/commandCentre/leaderIdeasState.mjs` (spec `docs/specs/PICC_TRADING_SUITE_WS4_COPYTRADING_IDEA_SOURCING_v1.md` §3.2). This note records the linkage only — the catalog schema remains untouched (WS-4 D5).