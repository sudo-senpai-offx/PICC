# Income Generalization (Q5) — Design — spec v1

**Status:** ACCEPTED — executed via the checklist · **Date:** 2026-09-03 · **Resolution:** COMPLETE — executed per the checklist (Tasks 1–13, commits `04381f0`…`ce4b3a0`, suite green). Verified: registry connector rows + `positionConnectorSignedIn("income")` tests; origin-routed ingest; 2m snapshot cadence; wsFrames relay; server-backed streams + migration; revenue-branded Overview. Deviation per D1 clean break: extension-derived income rows are inert/history (extension leg removed `9d7d460`). (**Date:** 2026-09-19)
**Grounding rule:** every claim carries a `file:line` read this session; anything not re-read is **UNVERIFIED** and must be re-checked at execution start.

This design reuses the server-side connector registry and the unused localstore CRUD before inventing anything. It is the backbone the user asked for: **config-driven site registry + autodetect + extension collection + unified server-backed income surface**.

---

## 0. The three hardest truths (read first)

1. **The extension's content script is read-only by construction and its `document.` surface is pinned** (`extensionIntegrity.test.mjs:82-100` — only `document.cookie` inside `readStoredKeys` and `document.visibilityState` are the allowed page reads; no `querySelector`/`getElementById`). Therefore the **declarative DOM extractors (selector reads) from `connectors.mjs` CANNOT run in the extension content script** without breaking the lock. Consequence — enforced in this design: the extension captures **storage-scan + WS-frame observations** (its existing read-only capability), and DOM **value extraction stays server-side** via the browser/CDP transport (`collectSource`/`browserCollect`, `connectors.mjs:99-192`). Both legs normalize to the same Earnings shape via the registry. This is the honest, lock-respecting divide.

2. **The MAIN-world WebSocket sniffer (`inject.js`) is inherently per-site code**, not config: `inject.js:19` hardcodes `EO_WS_RE = /expertoption\.(com|finance)/i`. The requirement lets us keep this as the optional `collect` hook (`REQ-G`). Config-driven default, code exception.

3. **`registerConnector` currently has no cadence field** (`connectors.mjs:81-88`); cadence lives only in the extension's `syncPolicy.js:14-28`, hardcoded to one policy. We add per-connector cadence as *config* while keeping the existing policy as the default/fallback so the extension generalizes without losing its tested behavior.

---

## 1. Declarative site-adaptor registry schema (extend, don't replace)

Extend `registerConnector`'s existing shape (`connectors.mjs:81-88`) with a first-class config surface. A new site is added by registering this object:

```js
registerConnector({
  slug: "grass",            // existing
  label: "Grass",
  category: "bandwidth",
  origins: ["app.getgrass.io", "getgrass.io"],   // NEW: extension host-matching list (was: single `url`)
  url: "https://app.getgrass.io/",
  transport: "browser",      // api | ws | browser
  // NEW — per-site cadence config (defaults to the extension policy constants):
  cadence: { base: "intermittent", realtimeMs: 15000, intermittentMs: 90000, longMs: 300000,
             activityWindowMs: 60000, prolongedMs: 600000 },
  // NEW — declarative extractors (server-side browser transport, existing):
  extractors: {
    balance:  "[class*='balance'], [class*='credits']",
    today:    "[class*='today'], [class*='daily']",
    lifetime: "[class*='total'], [class*='lifetime']",
    payoutThreshold: "[class*='minimum']"
  },
  // existing alias => mapped to extractors for back-compat (selectors stays valid)
  selectors: { /* same shape */ },
  defaults: { label: "Grass", currency: "USD" },
  // NEW — declarative storage/WS interception for the extension's read-only leg:
  scan: {
    mode: "storageKeys",          // 'storageKeys' | 'wsFrames' | null
    keys: [{ type: "cookie", key: "auth" }, { type: "localStorage", key: "user" }],
    profileKeys: "user|account|profile",       // reused from captureProfiles (content.js:349)
    wsUrlRe: "grass\\.(io|app)",              // for wsFrames mode (like inject.js:19)
    mapFrame: { balance: ["balance"], today: ["today", "earning"] }  // declarative frame→Earnings
  },
  tuned: false,                // autodetect proposals always start false (connectors.mjs:85,542)
  // NEW — optional hard-case escape hatch (unchanged semantics, connectors.mjs:183):
  collect: null
})
```

**Seam:** `registerConnector` normalizes the definition once (add `origins`, `cadence`, `extractors`, `scan`, and a `normalizeOrigins()` helper so legacy `url` alone still produces a single-origin list). `getConnector/listConnectors` (`:90-92`) stay the read surface. `normalizeEarnings` (`:50-66`) is unchanged — the single currency of the system. The 20+ existing registrations need only the *optional* new fields added over time; they continue to work via existing `url`/`selectors`/`transports` fields (mapped to the new names on registration).

**Extension-facing snapshot shape** (what `GET /api/connectors` returns for the extension, extended at `handlers.mjs:3717-3730`):

```
{ ok, browser, generatedAt,
  registry: [{ slug, label, category, origins[], transport, cadence, scan, tuned }],
  latest: { <slug>: Earnings } }      // snapshot persistence, connectors.mjs:249-262
```

Only `origins`, `cadence`, `scan` (key NAMES, never values — mirrors the `capture-profiles` token rule at `handlers.mjs:4580-4596`) are sent to the extension. `extractors`/`selectors`/`url` stay server-only (the extension never runs DOM extraction).

## 2. Autodetect capability (config + a discovery endpoint)

Fingerprint a URL and *propose* an adaptor. Serverside, one module `apps/dashboard/server/services/autodetect.mjs` with a pure function + one endpoint.

**Pure proposal builder** — input `{ url, domNodes?, storageKeys?, wsUrls? }`, output `{ slug?, origins[], proposed: { origins, cadence, scan, extractors }, confidence, tuned:false }`:
1. **Match existing:** if `url` hostname ∈ an existing connector's `origins` → return `{ matched:true, slug }` (fast, cheap, avoids duplicate proposals).
2. **Propose origins:** derive a canonical origin list from the hostname (strip `www.`, take the registrable domain). `confidence` rises when the page is interactable.
3. **Propose `scan`:** from what the page exposes — `storageKeys` = key *names* the page reads (mirror `readStoredKeys`, `content.js:400-424`), `profileKeys` = the standard profile-key regex; mode `wsFrames` + `wsUrlRe` when a page WebSocket targets a same-host gateway.
4. **Propose `extractors`** (server browser transport): a heuristic candidates list of number-bearing, prompt-text-nearby DOM nodes (the `tune-connectors.mjs` study pattern — `scripts/tune-connectors.mjs:15` writes a tuner report). Always `tuned:false` and `status` honest: a proposal is a *suggestion*, never a trusted adaptor.

**Endpoint** `POST /api/connectors/autodetect` (= existing auth/rate-limit pattern at `handlers.mjs:3806-3811`, requires `verifyUser`) → `{ ok, result: <proposal> }`. Body `{ url, dom?, storageKeys?, wsUrls? }`. A `tuned:true` adaptor is **only** reachable by a human turning `tuned` on (manual edit to the registration), never by the endpoint.

**Guard rails:** rate-limited; returns the *proposal* alone (no write). User acceptance = the human copies the proposal into a `registerConnector({...})` definition (or a config file) — there is no "autodetect self-commits code" path.

## 3. Extension fetches + dispatches against the registry

The existing `capture-profiles` channel (`background.js:354-359`, `content.js:513-530`, `handlers.mjs:4584-4596`) is the seam to extend — it already fetches a per-origin config with a built-in fallback (the hybrid-independence rule). Generalize it to the full registry snapshot:

- **`background.js`** — extend `ensureVenueConfig` (`:387-400`) / add the registry fetch (reuse `serverFetch`, `:114-155`): on each sync beat + the `VENUE_CFG_TTL` (`:385`), fetch `GET /api/connectors?forExtension=1` (or reuse the same `/api/connectors` GET shape). Build `venueConfigs` from each connector's `origins` + `cadence` (fall back to `SYNC` constants when a connector omits `cadence`). **No change to `syncPolicy.js`** — it stays the pure default; per-connector `cadence` `min`-bounded by `cadenceFor` (`:36-41`) so a config can't exceed the beat floor.
- **`content.js`** — `venueScanConfig` (`:513-530`) already caches and falls back to `PICC_CAPTURE_BUILTIN` (`:332-351`). Extend the built-in to seed from the *registry broadcast* — but refactor so the built-in is a static COPY of the first registered `scan`-capable connector, still pinned equal by `extensionIntegrity.test.mjs`. The sensor's `scanVenueSession` (`:532-564`) stays exactly as-is: `via` (`liveEO` vs `storageKeys`) dispatches to shape-scan vs exact-key read; add the `wsFrames` `via` (declarative `mapFrame`) as a small executor that already shares `onFrame` plumbing.
- **Generalized ingest** `POST /api/extension/ingest` (`handlers.mjs:4520-4545`): keep the EO `ingestAppFrame` path for back-compat (the trading candle bus must not regress), and **add a payload branch** for income observations: `{ origin, slug?, frames?:[], storage?:{key,value}[] }`. Route to the matching connector's normalizer via a new `normalizeExtensionPayload(connector, payload)` in `connectors.mjs` that folds declarative `scan.mapFrame`-shaped reads into `normalizeEarnings`, then `persistSnapshot` (`:242-264`). Localhost-only + rate limits preserved (`handlers.mjs:4522-4526`).

**Independence:** built-in fallback (`content.js:520-527`) guarantees extension-alone capture; web-app-alone collection uses `GET /api/connectors/:slug/collect` (`handlers.mjs:3801-3833`) via the server browser transport.

## 4. Income command-centre aggregation (unified daily/monthly/total + holdings)

Reuse `streamSummary` (`src/lib/streams.ts:156-182`) — don't reinvent aggregation. Add a server aggregation endpoint that merges the two sources of truth:

- **Authoritative server Earnings** — from `getLatestSnapshots()` (`connectors.mjs:266-268`, `connector_latest.json`).
- **User-tracked streams** — from `/api/data/income_streams` (the localstore table, `localstore.mjs:20-31`), migrated from today's `localStorage` (`streams.ts:5-7`).

**New endpoint** `GET /api/income/overview` (auth, `handlers.mjs:3229` pattern):
```
{ ok,
  snapshots: { <slug>: Earnings },                    // normalized, honest status per source
  streams: IncomeStream[] ,                            // server-backed user streams
  holdings: { nft: nft_holdings[], depin: depin_nodes[],
              accounts: financial_accounts[], transactions: transactions[] },
  summary: <StreamSummary> }                          // streamSummary({streams}, earningsFromBoth)
```
Client `useIncomeOverview()` hook wraps `fetch` + `authHeaders` (reuse `localdata.ts:31-34`). The Income page (`Income.tsx`) and `IncomeStreams.tsx` tabs (`StreamsTab` + a new unified `OverviewTab`) render from it.

**Reuse vs replace summary:**

| Surface | Today | This spec |
|---|---|---|
| Server site registry | `connectors.mjs` (20+ in-code) | **Reuse + extend** (origins/cadence/extractors/scan, config-driven; new sites by config) |
| Client localStorage income | `streams.ts:5-7` + `streamCatalog.ts` | **Replace persistence with `/api/data` (REQ-L)**; keep `streamSummary` math + catalog as UI/catalog |
| Extension collection | EO-hardcoded (`content.js`, `inject.js`, `background.js`) | **Generalize** via registry snapshot + generalized ingest; keep EO as first `scan.wsFrames` connector; keep integrity lock |
| Unified aggregate + holdings | none | **New** `Income.OverviewTab` fed by `GET /api/income/overview` |
| Payment channels | exist | untouched |

## 5. File-by-file minimal edits (the seam map)

**Server services**
- `connectors.mjs` — extend `registerConnector` to normalize `origins/cadence/extractors/scan`; add `normalizeExtensionPayload(connector, payload)`; add `snapshotForExtension()` (the registry view from §1). `normalizeEarnings` unchanged.
- `autodetect.mjs` (new) — pure `fingerprint()` proposal builder (§2).
- `localstore.mjs` — **no change** (tables already exist, `:12-32`). Optionally add `upsertRows`/bulk if REQ-M migration needs it (else reuse `appendRow/upsertRow`).
- `handlers.mjs` — extend `/api/connectors` GET for `forExtension` view (`:3717-3730`); add `POST /api/connectors/autodetect`; extend `/api/extension/ingest` income branch (`:4520-4545`); add `GET /api/income/overview` (auth + rate limit).

**Server tests** (`apps/dashboard/server/__tests__/`)
- `autodetect.test.mjs`, `registry.generalization.test.mjs`, `incomeOverview.test.mjs`; extend `connectors.test.mjs`, `extensionIntegrity.test.mjs` (broadcast view), a handler-level ingest test.

**Extension** (`apps/dashboard/extensions/picc-overlay/`)
- `manifest.json` — add `inject-<slug>.js` per MAIN-world ws-sniff connector (EO keeps `inject.js`; a new ws-frames site adds one). The *generic* `content_scripts http(s)://*/*` (`manifest.json:20-31`) already runs everywhere and needs only its config-driven `scan` dispatch.
- `background.js` — extend `ensureVenueConfig` to the registry snapshot (origins+cadence); generalize `resurrectSensorTabs`/`openVenueTab` host lists from the snapshot.
- `content.js` — extend `PICC_CAPTURE_BUILTIN` (still pinned equal to server broadcast); add `wsFrames` `via` executor + declarative `mapFrame`; no change to the DOM-read lock.
- `syncPolicy.js` — unchanged (pure default; per-site `cadence` min-bounded upstream).

**Frontend**
- `src/lib/localdata.ts` — now-consumed (REQ-L): wire `listData/appendData/upsertData/removeData` for `income_streams`/`transactions`/`nft_holdings`/`depin_nodes`/`financial_accounts`.
- `src/lib/income.ts` (new, thin) — `getIncomeOverview()`, `upsertStream`, `removeStream` → server CRUD; + a migration helper `migrateLocalStreams()` (reads `streams.ts:29-31` + `:60-62` once, upserts to server, keeps localStorage until server write confirms — no data loss).
- `src/components/IncomeStreams.tsx` — `StreamsTab` reads from server; add `OverviewTab` (unified aggregates + holdings) rendering `income/overview`.
- `src/pages/Income.tsx` — render the new tab; keep `ChannelsTab` untouched.

## 6. Data shapes (contracts to hold)

- **Earnings** — `{ provider, platform, balance, today, lifetime, payoutThreshold, estimatedDaily, currency, source, status, error, lastChecked, extra }` (`connectors.mjs:50-66`). Honest: `status` ∈ `ok|error|stale|unconfigured`; absent numerics `null` (REQ honesty).
- **Registry view for extension** — `{ slug, label, category, origins[], transport, cadence, scan, tuned }`; `scan.keys` = key NAMES only.
- **IncomeStream** (server row) — mirrors `types.ts:199-218` fields; `collector` extended (optional) to accept `"registry"`, `id` from localStorage `uid()` (`streams.ts:3,38`) so migration is idempotent.
- **/api/income/overview** — §4 shape; `summary` is the existing `StreamSummary` (`streams.ts:146-154`).
- **autodetect proposal** — §2; always `tuned:false`.

## 7. Honesty + gates coverage for the new code

- Numeric honesty: new code must not fabricate zeros — reuse `num()`-style strict parsing idiom (`accountMetrics.mjs:46-51`); `normalizeEarnings` already nulls absent (`connectors.mjs:55-60`).
- Extension read-only lock: new `scan`/`wsFrames` execute within the pinned surface; the DOM-read extractors stay server-only. `extensionIntegrity.test.mjs` must keep passing.
- Demo/live gate: no new automated execution leg; ingest remains localhost-only + rate-limited (`handlers.mjs:4522-4526`).

---

## Risks (what could break + the test guarding it)

1. **Breaking the extension integrity lock** when adding `wsFrames`/`scan` dispatch. Guard: `extensionIntegrity.test.mjs` unchanged and green; new dispatch code added under the same `document.`-surface constraints; `chrome.storage` reads stay pinned.
2. **Trading candle bus regression from a generalized `/api/extension/ingest`.** Guard: keep the EO `ingestAppFrame` branch byte-compatible; `handlers.mjs:4520-4545` splitting is additive-only; `e2eExtensionFeedChain.test.mjs` stays green.
3. **localStorage → server migration data loss.** Guard: `migrateLocalStreams()` only clears localStorage after a confirmed server upsert; a write to `income_streams` that fails leaves localStorage intact.
4. **Autodetect proposing untrusted adaptors.** Guard: `tuned:false` by construction; endpoint is rate-limited + auth; nothing auto-commits.
5. **Cadence change speeding up collection** (privacy/perf). Guard: per-connector `cadence` is `min`-bounded by `cadenceFor` + the `TICK_MS` beat floor (`syncPolicy.js:17,36-41`); extension-alone fallback unchanged.
