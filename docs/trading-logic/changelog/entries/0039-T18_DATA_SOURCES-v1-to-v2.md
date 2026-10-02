# 0039 — WS-7 T18: D17's data sources, provenance on every datum, and the honest absent path

rule: T18_DATA_SOURCES
version: v1
supersededBy: v2 (this record: docs/trading-logic/changelog/entries/0039-T18_DATA_SOURCES-v1-to-v2.md)
date: 2026-10-03
historicalTradesAffected: none
source: >-
  WS-7 T18 at `docs/specs/PICC_TRADING_SUITE_WS7_TRADING_SUITE_MATURITY_v1.md:1379-1386`
  (Scope `:1380`, Files `:1382`, Acceptance `:1384`, Bisect `:1386`); AC-038 at `:1069-1075`;
  AC-039 at `:1077-1083`; R14 at `:455-458`; D17 at `:238-245`; AC-017 (T5) at `:901-907`;
  D15/D16/T13 handoff #6 in entry `0025-T13_MODEL_LAYER_SUPPLY_CHAIN_ROUTING-v1-to-v2.md`;
  T11 entry `0022-T11_DETERMINISTIC_COPILOT_ENGINE-v1-to-v2.md`; D22/D25 at `:316-325`.
reason: >-
  T18 owned the producer side of a seam T11 deliberately left unfilled and T13 recorded as a handoff
  ("No caller of the sentiment reader"). This entry records the source contract, the provenance shape,
  the removal of four fabricated neutrals, the resolution of Serper's status that AC-017 left to this
  task, and the exact conditions under which a credentialed run still cannot be claimed from this host.

- **Date:** 2026-10-03
- **Owner:** WS-7+
- **Kind:** implementation record
- **Supersedes:** nothing. Removes no guard, lowers no threshold, edits no T11 or T13 contract.

## What landed

Eleven files. Four are new, four are edited in place, three are tests, and the `.env.example` is a
comment rewrite.

| File | Role |
|---|---|
| `services/newsSources.mjs` | **new** — the D17 registry, the closed retrieval-mode vocabulary, the provenance constructor, the AC-039 prohibited-target matcher, and the Settings-room row derivation |
| `services/copilot/sentimentSources.mjs` | **new** — the producer for T11's seam. Discharges T13 handoff #6 |
| `__tests__/newsSources.test.mjs` | **new** — the contract: provenance construction, absence naming, the prohibited matcher |
| `services/copilot/__tests__/sentimentSources.test.mjs` | **new** — **the honest-absent proof** |
| `services/newsDigest.mjs` | every item becomes a provenanced datum; `digestVerdict()` separates ABSENT / UNAVAILABLE / DELIVERED; a prohibited feed URL is refused and named |
| `services/sentimentEngine.mjs` | Serper removed; four fabricated neutrals replaced with named absences; the composite reserves an absent leg's weight |
| `services/integrationRegistry.mjs` | the news rows are now **derived** from `newsSources.mjs`; the hand-written duplicate `gdelt` row is gone |
| `services/adaptiveConfluence.mjs` | four more fabricated neutrals on the path that consumes `getSentiment` — see the deviation record below |
| `services/trading.mjs` | `/api/trading/news` items and response now carry retrieval mode and a provenance record |
| `__tests__/importResolutionGuard.test.mjs` | **the import/dependency guard** — AC-039's prohibited-source sweep (three routes) and AC-038/R14.3's no-manual-input sweep |
| `src/pages/ministry/SettingsRoom.tsx`, `src/lib/integrations.ts` | the two columns D17's "licensed and labeled" obligation needs, on the table that already existed |
| `PICC.md` | the WS-7 registry row's live-claim corrected downward — see the deviation record below |
| `agents/picc_agents/.env.example` | Serper's role restated; the D17 source variables named |

## The source list — five families, four modes

Every source names a **retrieval mode**, because D17 trusts a source by *how it is reached*, not by
its brand. The vocabulary is closed at four and `makeDatum` throws on a mode outside it.

| Family | Mode | Licensed basis | Credential | Configured by |
|---|---|---|---|---|
| RSS / Atom | `licensed-feed` | the publisher's own feed over HTTP GET — a feed is the publisher's sanctioned distribution channel, so a feed URL is a licence grant rather than a scrape | none | `PICC_NEWS_FEEDS` |
| GDELT DOC 2.0 | `licensed-api` | open data over a documented, key-less HTTP API | none | `PICC_NEWS_GDELT=on` |
| NewsAPI | `licensed-api` | commercial licensed news API with published developer terms | `NEWSAPI_API_KEY` | `PICC_NEWS_NEWSAPI=on` **and** the key |
| CryptoPanic | `licensed-websocket` | licensed crypto news/asset API with a realtime stream | `CRYPTOPANIC_AUTH_TOKEN` | `PICC_NEWS_CRYPTOPANIC=on` **and** the token |
| PICC's own browser | `picc-own-browser` | PICC's own Chromium reading a page the operator's own session can see — **PICC's infrastructure, and it carries PICC's labeling obligations** (D17:245), which is why the mode is recorded on every datum obtained this way | none | `PICC_NEWS_BROWSER_SOURCES` |

A credential alone is **not** a decision: NewsAPI with a key and no flag stays unconfigured, because a
key in the environment is not a decision to publish news from it. That is asserted, not assumed.

The browser seam stays injected. This task adds no capture layer, no click and no submit; the seam
that would drive the browser is the existing, already-gated `browserBridge.mjs`, and nothing in
`newsSources.mjs` imports it.

## The provenance shape, and how a source-less datum differs from a real zero

```
{ source, sourceName, sourceFamily, retrievalMode, licensedBasis,
  retrievedAt, verified, text, sourceUrl, publishedAt }
```

- `retrievalMode` — one of the four, never absent.
- `licensedBasis` — a sentence stating *why this source is trusted*, inherited from the **family** so an
  operator pasting a URL cannot mint a licence claim by naming it.
- `retrievedAt` — ISO-8601, or `null` meaning **not retrieved**.
- `verified` — `boolean | null`. Never a number. T10's `observed: boolean | null` discipline: a `0` here
  is indistinguishable from a measured `false` on the far side.

**A source-less datum is `null`.** `makeDatum` throws rather than emitting a datum with a hole, so the
absence cannot be represented at all — there is no `score: 0`, no `items: []` meaning "live and found
nothing" when nothing was configured, and no `text: ""` that pattern-matches "no signal" in every
consumer. `hasProvenance` / `provenanceGap` are exported so AC-038's "every datum carries source and
retrieval mode" is a **predicate**, not a convention.

The digest distinguishes three states where it previously had one (`digestVerdict`):

| State | Means | `items` |
|---|---|---|
| `absent` | no D17 source configured. Nothing was asked | `null` |
| `unavailable` | configured, a pass ran, it produced nothing. A MEASURED zero about publishers | `0` |
| `delivered` | at least one fully-provenanced datum | `n > 0` |

## Serper's status — resolved per T5, and NOT re-decided

AC-017 (T5) resolved Serper by making the **documentation tell the truth** rather than by deleting the
import: it is live in `amazon.mjs`, `/api/trading/news`, the handler research paths and
`agents/picc_agents/crew.py`, and T5b (commit `78ab322`) corrected `PICC.md` to say so. T18 honours
that and adds nothing to it.

What T18 decides is narrower, and D17's own list forces it: **Serper is not a news/sentiment source.**
It is absent from D17:241's enumeration ("NewsAPI, GDELT, CryptoPanic, RSS/Atom"), the 2026-09-13 owner
decision recorded at `newsDigest.mjs:1-15` had already replaced it for the digest ("Serper is REPLACED,
never supplemented"), and it is a general web-research provider rather than a licensed news feed.

So:

- the 5% Sentiment expert's inputs come from `newsSources.mjs`, and Serper is not in it —
  `sentimentEngine.mjs` no longer imports `serper.mjs` at all, and a test reads the file's import list
  to prove it;
- Serper **stays live** for `/api/trading/news`, `amazon.mjs`, and the crewai search tool;
- `/api/trading/news` gained what D17:245 requires of it — `retrievalMode: "licensed-api"`, a
  `licensedBasis` sentence an operator can read and contest, and per-item provenance. It is a licensed
  API, not a scrape of a prohibited publisher, and the route now says so rather than asserting it;
- `agents/picc_agents/.env.example` records the distinction instead of leaving a bare `SERPER_API_KEY`
  that reads as a news-source credential.

## The four fabricated neutrals, and the four they dragged down with them

`sentimentEngine.mjs` returned a neutral in four places it had nothing: an unnormalisable symbol, a
thrown fetch, an empty history's mean, and a one-entry history's velocity. Each became a named absence.
Its composite did the same to three downstream: a missing symbol, a timeout, and a throw.

The fourth file is the deviation record. **`adaptiveConfluence.mjs` is not in T18's `:1382` file list**,
and T18 edited it anyway. The reason is mechanical, not discretionary: `sentimentScore` read
`result.composite?.score ?? 0` and `evaluateAsset` defaulted to `{ score: 0, source: "none" }`, so an
honest engine returning `composite: null` would have been laundered back into a neutral one layer up —
on the leg that reaches the Copilot's confidence. Leaving it would have made this task's central change
cosmetic. `adaptiveConfluence.mjs` is inside the file-touch union at `spec:73(d)`
(`apps/dashboard/server/services/**`), its three fabricated neutrals are now `{ score: null, reason }`, and
`round(null, 4) → 0` at `:619` was the specific laundering point fixed. This is recorded here rather
than absorbed silently, on the T17 precedent.

## The honest-absent proof

`services/copilot/__tests__/sentimentSources.test.mjs`, 26 assertions, over the **real** engine and the
**real** expert. With zero D17 sources configured:

| Fact | Value |
|---|---|
| `sentimentInput` on the derived state | `null` (never a number) |
| expert `available` | `false` |
| expert `unavailableReason` | T11's own `NO_MODEL_INPUT_REASON`, byte-identical and unedited |
| expert `rawDelta` | `null`, and asserted `.not.toBe(0)` |
| penalty | **exactly 5** — the missing expert's own declared `WEIGHT_PCT` |
| `coveragePct` | **95** — a hole of 5, not a reshuffle |
| survivors' declared weights | `20/20/20/15/20`, unchanged |
| survivors' weighted points | identical to the Sentiment-present case, expert by expert |
| control | dividing by 95 yields a **different, larger** total; asserted as a real number, not a truthy check |
| confidence | `high` with sentiment, `medium` without |
| producer's own reason | `NEWS_SOURCES_ABSENT_REASON`, naming all five env knobs |

T11's expert is **not edited**. Its `NO_MODEL_INPUT_REASON` and its own
`expertDegradation.test.mjs` are untouched and still green; T18's source-level reason travels *beside*
it rather than replacing it, so a reader who wants the engine's contract and a reader who wants the
actionable half each get the one that answers their question. Both are real absences and they are not
the same absence.

The digest's composite applies the same rule one layer down: an absent leg contributes **nothing** and
its declared weight stays **reserved**. `declaredLegWeightReached` reports `0.6` when only the news leg
exists and `legWeightsRenormalised` is literally `false`. The social leg is a projection of the
module's own composite history, so it is absent by construction on a symbol's first reading; requiring
both legs would have made the composite permanently unreachable, and re-weighting the survivor would
have produced a number on a scale nobody measured.

## The guard, extended rather than duplicated

T18's `Files` clause names "the import/dependency guard" as the place a source is added, so AC-039's
check lives in `importResolutionGuard.test.mjs` and **imports `newsSources.mjs`'s matcher** rather than
declaring a second copy. Three routes, because the prohibited thing can arrive three ways:

1. **a dependency name** in any tracked `package.json` / `requirements.txt`;
2. **an import/require/`vi.mock` specifier**, read from the AST by the parser that guard already uses;
3. **an http(s) URL literal** in comment-stripped production source — the runtime half, which catches a
   hardcoded `forexfactory.com/calendar` with no manifest entry at all.

The matcher works on whole tokens of a package name plus adjacent token pairs, deliberately **wide**,
because AC-039 says "a package that wraps it is still caught": `apify-twitter`, `@vendor/bloomberg`,
`bloomberg-terminal-sdk`, `forex_factory` and `ForexFactoryPy` are all caught, and none of this
repository's real dependencies fires. Comments are stripped so the several hundred D2 removal RECORDS
that name what they removed are not findings.

**AC-038 / R14.3's UI test** is a sweep of every tracked client file for a text-entry control whose
labelled neighbourhood is a news/sentiment concept, plus a server check that no route accepts a
headline in its body. It found exactly one control — `TradingSuite.tsx:1392`, the Market-news **search**
box — which is a query string PICC hands to a licensed source and cannot supply a headline. It is
recorded as a **named exclusion** keyed to one file, with the property that makes it safe asserted
separately (its value reaches the wire as `query`, never as an item body) and with the exclusion itself
asserted to have matched, so a dead exclusion cannot start covering a headline box later.

## The configuration surface — reused, not duplicated

No new form, no new route, no new store. The Settings room's existing Integrations table
(`/api/integrations` → `integrationRegistry.mjs` → `SettingsRoom.tsx:163-188`) already renders source,
purpose, free tier, rate limit, key and status; T18 **appends the five D17 rows derived from
`newsSources.mjs`** and adds the two columns the "licensed and labeled" obligation needs —
`retrievalMode` and `licensedBasis` — plus the named absence reason and, for a configured source, what
configured it. `state` is derived from configuration and is **never `connected`**, because nothing in
this tree has ever fetched a news source; a configured source reads `degraded` ("configured by
`PICC_NEWS_FEEDS=set` — never probed"), which is the discipline T5 applied to Serper's badge.

The hand-written `gdelt` row was **removed** from the static catalog rather than left beside the derived
one: two rows for one source would render twice with two states, and a test asserts the id appears
exactly once.

## The registry-row edit is a FILE-TOUCH DEVIATION, recorded rather than absorbed

`PICC.md` is **not** in the file-touch union at `spec:73(d)`, and T18 edited it. The reason is that the
row's own rule requires it: the row carries a live claim — "the live claim is now T18 (1 of 21)" — which
is measured against `ws7-seam-probe.mjs`, and `ws7SeamGuard.test.mjs:863-867` states the rule in as many
words: "a prose claim that outran git is the failure this whole row exists to prevent, so the row must be
corrected downward the moment a task lands rather than left to rot." After T18 the measured list is `[]`;
leaving the row at "1 of 21" would leave a checked-in claim that git has just falsified.

This is left as an **open deviation needing a dated `spec:73(d)` amendment**, on the same footing as
entry 0025's `.github/workflows/**` deviation and entry 0038's. T18 did not amend the spec itself: that
amendment is the owner's call and has historically been its own commit (`42dfaac` amended `:73` for
`handlers.mjs`). A reviewer who would rather the row stay stale should say so, and the alternative is to
revert `PICC.md` and accept a falsified checked-in claim until an amendment lands.

## Verification

- `npm run typecheck` clean.
- `npm run test --workspace @picc/dashboard`: **5371 passed / 1 skipped / 0 failed** (382 files), up from
  the 5265 baseline. Run three times: twice before the commit and once after.
- `scripts/ws7-seam-guard.mjs`: **verdict fail, 3 failing checks, unchanged** — expertoption residue
  `28`, unused dependency `1`, D26 catalog `1`. All three are T21 findings, all three were red before
  T18 started, and T18 touched none of the files they measure. The guard's own guards for
  `engine.weight-sum-exactly-100`, `model.no-pickle-load-path` and
  `perps.cancelOrder-blocked-and-seam-exposed` (both halves) pass.
- `scripts/cross-room-invariant-gate.mjs`: **GREEN**, exit `0` over the real twenty-two rooms, verified
  through `crossRoomInvariantGate.test.mjs`'s "is GREEN as a real PROCESS over the real facts — exit 0"
  plus its all-22-rooms and per-room-scoping sweeps. T18 adds no room and supplies no room facts.
- `ws7SeamGuard.test.mjs`'s unlanded-list pin moved from `["T18"]` to `[]`, and `ws7-seam-probe.mjs`'s
  `ws7-tasks-without-a-commit` item now reports an empty list. A `WS-7` commit subject carrying a bare
  `T18` credits the task as landed (`ws7-seam-probe.mjs:1203-1207`) — correct here, and confirmed by
  reading the list afterwards rather than by assuming.
- `git diff --check` clean; nothing written under `server/data/` or `.playwright-tmp/`; exactly one
  tracked lockfile (`package-lock.json`).
- The guard pins **statics 72 / dynamics 83 / `requireAuth` sites 126 do not move**: T18 added no route
  and made no edit to `handlers.mjs`.

## Not done, and not claimed

- **No live fetch was proven, and none can be on this host.** T13 established there is no network egress
  and there is no credential for anything. Every assertion here is about the *contract*. A green suite is
  not a claim that any source answered.
- **A credentialed run requires**, and this entry does not pretend otherwise: network egress; at minimum
  `PICC_NEWS_FEEDS` set to one or more absolute http(s) feed URLs (the only source needing no
  credential); `NEWSAPI_API_KEY` **plus** `PICC_NEWS_NEWSAPI=on` for NewsAPI;
  `CRYPTOPANIC_AUTH_TOKEN` **plus** `PICC_NEWS_CRYPTOPANIC=on` for CryptoPanic; `PICC_NEWS_GDELT=on` for
  GDELT; `PICC_NEWS_BROWSER_SOURCES` for PICC's own browser; a real Chromium install for that browser
  path; and — for the 5% expert to actually light — a Needle 3 inference backend, which has no Windows
  build and therefore no in-process runtime. Without the backend the Copilot's sentiment input is still
  absent, and it says so.
- **The Copilot's decision route was NOT rewired.** `decision.mjs` is not in T18's file list and putting
  a live digest fetch on a decision path is a separate decision with its own budget and provenance
  surface. The producer is instead called from `sentimentEngine.getSentiment` over the digest items that
  module already fetched — no second fetch, no second store — and the route's response carries
  `copilot: { sentimentInput, reason, provenance }`. T11's expert therefore still reports `unavailable`
  on `POST /api/trading/copilot`, exactly as before, and the handoff T13 recorded is discharged at the
  producer rather than at the decision path.
- **The licensed-API and websocket legs have no parser.** GDELT, NewsAPI and CryptoPanic are declared
  with their modes, bases and configuration so the registry is complete and the room can show them, but
  `newsLeg` reads only RSS/Atom. A run configured with only `PICC_NEWS_GDELT=on` reports the named
  absence "none of them is an RSS/Atom feed" rather than fetching nothing and reporting a zero. Writing
  three more parsers was not this task's scope and is not claimed.
- **No `verifiable` claim about any publisher's licence.** `verified` is `null` on every datum this task
  produces, because nothing in this tree verified one.
- **`PICC.md`'s registry row and `docs/` were not updated for the Settings-room columns.** The
  cross-room completion records own room completion verdicts (D27) and T18 changed no room's definition
  of COMPLETE; a reviewer who wants the new columns reflected in the product docs has not had that done.
- **No CI workflow change**, for the same reason entry 0038 records: `spec:73(d)`'s union excludes
  `.github/workflows/**`. T18 did not touch CI.