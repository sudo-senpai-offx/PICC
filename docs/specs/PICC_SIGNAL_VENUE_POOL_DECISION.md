# Signal venue pool — decision (T5 / Decision D follow-up)

**Status:** DECISION. **Resolution:** COMPLETE — narrow-to-liveEO-verified executed (`99a1b06`); filter live in code (**Date:** 2026-09-19)

## Question
Should `resolveAlertVenue`'s exactly-one candidate pool narrow to liveEO-verified venues only, or keep IS-mode (integration-speculative) venues as candidates?

## Evidence (read this session)

> **D1 note (2026-09-17):** the catalog anchor below is `studioCaptureCatalog()` since the A-slices; the former `extensionCaptureConfigs()` was renamed with the extension removal (the capture catalog is now studio-browser-owned). Resolution behavior is unchanged.

- `signalEngine.mjs:81-89` — `resolveAlertVenue` maps `studioCaptureCatalog()` candidates through `instrumentUrl`, filters `mode !== "none" && url`, emits on exactly-one else `undefined`.
- `captureProfiles.mjs:591-593,714-743` `studioCaptureCatalog()` — emits every profile with `capture.via` + `hostRe`; carries `via` per venue. Today that set = `expertoption` (via `liveEO`) + `iqoption` (via `storageScan`).
- `captureProfiles.mjs:62,730-735` — EO `capture.via:"liveEO"`, scan keys all `verified:true`.
- `captureProfiles.mjs:81-95` — IQ `capture.via:"storageScan"`, ssid `verified:false` (`:89`, NON-PRIMARY reverse-engineered), `metrics.extractVia:[]` (`:95`), no live leg.
- `captureProfiles.mjs:564-571,584` — EO is the ONLY venue with a live bridge (`reconnectTriggered`); storage-scan venues report `liveLeg:false`.
- `browserStudio.mjs:573-581` — both EO (`:504`) and IQ (`:511`) are trading `SITE_INDEX` rows; neither in `VENUE_SYMBOLS`/`VENUE_TRADE_URL` (`:555-565`, only binance/kucoin/okx) → both resolve `mode:"venue"`, `url: <root>`.
- `signalEngine.test.mjs:80-86` — asserts real catalog (EO+IQ) → 2 candidates → venue `undefined`. `:110-113` — PRE_TRADE `call.venue` `toBeUndefined()`.
- Spec `PICC_NOTIFICATION_AND_ALERT_UX_v1.md:43` — Decision D intent: "ties the deep link to venues PICC can actually open with the sensor (today: ExpertOption live via liveEO)".

## Decision — NARROW to liveEO-verified venues only
The pool filters to venues whose capture path is a *verified live-session* path. Only EO qualifies today (`via === "liveEO"`, keys verified, live data bridge). This matches Decision D's stated intent, keeps the honest invariant (never deep-link a user onto a venue PICC has no live feed for — REQ-6 / G2), and is the ONLY option under which the T5 acceptance ("venue field present for an EO-resolvable asset") is ever satisfiable against the real catalog. Keeping IQ would make the exactly-one branch permanently dead AND land users on a venue the signal engine cannot act on.

### Exact filter rule (recommended)
> From `studioCaptureCatalog()`, retain only candidates with `capture` mode `"liveEO"` (equivalently: every scan key in the candidate `keys` is `verified:true`), then resolve each survivor via `instrumentUrl` and keep those with `mode !== "none" && url`; emit when EXACTLY ONE survives, else omit. Apply the same `"liveEO"`-only pre-filter to injected `candidateConfigs` so the test seam stays in lockstep with the real catalog.

## Acceptance criteria (a future slice must test)
- Real catalog: `resolveAlertVenue({assetId})` returns `{venueId:"expertoption", tradeUrl:"https://app.expertoption.finance/"}` for EO-resolvable assets (mode `venue`, `browserStudio.mjs:580`).
- PRE_TRADE dispatch carries that `venue`; the old "undefined under real catalog" assertions are replaced.
- An injected pool with only IQ-style `storageScan` candidates → venue `undefined` (IQ alone must NOT produce a deep link).
- An injected pool with an unrelated `mode:"none"` venue → `undefined`.
- `windowLabel` (TS) and the rest of `signalEngine` are untouched.

## Risk notes / tests that change if narrowed
- `signalEngine.test.mjs:80-86` ("omits under real catalog") FLIPS → must assert EO wins.
- `signalEngine.test.mjs:110-113` (`call.venue` `toBeUndefined()`) FLIPS → assert exact EO payload.
- `signalEngine.test.mjs:72-78` (single-EO, REAL resolver) stays green and becomes the real-catalog exemplar.
- `signalEngine.test.mjs:88-98` — catalog-only / multiple-venue cases keep `undefined`, but the `candidateConfigs` injection must apply the same `"liveEO"` filter first or its multi-candidate semantics diverge from the real catalog.
- Not affected: `browserStudio.test.mjs:66-90`, the studio bridge contract tests (successor to the extension integrity pins, which were removed with the extension), feed/headless paths.

## Resolution (2026-09-19)

**Disposition:** COMPLETE — the DECISION was executed, not merely recorded.

**Evidence:** `99a1b06` "narrow signal venue pool to liveEO-verified" landed. `signalEngine.mjs:76-90` `resolveAlertVenue` filters `studioCaptureCatalog()` candidates to `c.via === "liveEO"` and emits on exactly-one liveEO candidate with `mode !== "none"` and a `url`; otherwise `undefined` (no fabricated venue). The flipped assertions from this spec's risk notes are live: `signalEngine.test.mjs:80-86` (EO wins), `:110-113` (IQ-alone → undefined), `:72-78` (single-EO real-catalog exemplar). `captureProfiles.mjs:62,730-735` enumerates `captureProfile`/liveEO sessions. Per this spec's D1 note (2026-09-17) the catalog anchor is now `studioCaptureCatalog()` — resolution behavior unchanged.

**Successor:** none — the narrowed pool is the live behavior and stays consistent with the v3.2 rebuild (EO remains the verified live capture venue).
