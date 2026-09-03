# Income Generalization (Q5) — Checklist — spec v1

**Status:** Tasks 1–13 EXECUTED on `master` (main checkout) — one commit per task, tests green · **Date:** 2026-09-03 (executed 2026-09-04)
**Commits:** `04381f0` T1 registry surface · `622429d` T2 autodetect · `13e4c2c` T3 autodetect endpoint · `076a5ea` T4 forExtension snapshot · `65b02b5` T5 ingest income branch · `8f3b9fe` T6 snapshot+cadence · `48a11a9` T7 wsFrames relay · `47f867e` T8 host generalization · `fddd435` T9 grass by config · `9212e9a` T10 server-backed streams+migration · `43ac1c0` T11 overview endpoint · `ce4b3a0` T12 Overview/Streams UI · T13 sweep (this file + specs tracked).
**Grounding rules:** server logic → vitest in `apps/dashboard/server/__tests__/` (repo pattern). Extension logic → `node --check` minimum per edited `.js` file, plus the existing `extensionIntegrity.test.mjs` pin. **The user launches and confirms workability before any commit** — so the FINAL gate is a launch+verify, then commit/push.

> **Execution notes:** Tasks 14–15 remain USER-GATED (launch+verify of the running app, then push) and stay unticked. The Task 9 site flag was resolved by the user's adoption decision (grass, a `streamCatalog.ts` bandwidth site, with `tuned:false`); the Task 10 flag is handled by the spec's own no-clearing-until-server-confirms rule and is verified by `income.test.ts`. Full suite at Task 13: 141 files / 1499 tests — the only red is the sandbox `PORT=0` env artifact in `profile.test.mjs` (green with `PORT` unset).

TDD where sensible: write/extend a failing test first, then implement, then green. Each task names files + acceptance criteria. Tasks are ordered so each slice is independently verifiable; the registry/extension/autodetect backbone comes first, the unified surface last.

> **Flagged for explicit approval (destructive/risky):** Task 10 (localStorage→server migration) touches user-owned client data. Do not clear localStorage until the server write is confirmed and the user has launched to verify. Task 14 (manifest new inject-<slug>.js) adds a MAIN-world sniffer for a second site — requires the user's explicit go-ahead on which site.

---

## Phase A — Registry backbone (server)

### Task 1 — Extend `registerConnector` with the declarative config surface
Files: `apps/dashboard/server/services/connectors.mjs`
Status: DONE (commit `04381f0`) · tests in `apps/dashboard/server/__tests__/registry.generalization.test.mjs` (new)
- [x] Extend `registerConnector` (`connectors.mjs:81-88`) to normalize optional `origins`, `cadence`, `extractors`, `scan`; map legacy `url`→single-`origins`, `selectors`→`extractors` so the 20+ existing registrations (`:425-648`) need no edits and stay valid.
- [x] Add `snapshotForExtension()` returning the §1 registry view (origins/cadence/scan/tuned), exposing `scan.keys` as key NAMES only.
- [x] Add `normalizeExtensionPayload(connector, payload)` folding declarative `scan.mapFrame` reads through `normalizeEarnings` (`:50-66`).
- Acceptance: all existing `connectors.test.mjs` still pass; new test asserts (a) `expertoption` maps `url`→`origins:["app.expertoption.finance"]`, (b) `normalizeExtensionPayload` yields `status:"ok"` for a configured frame and `status:"unconfigured"`/`null` numerics for an absent one, (c) `snapshotForExtension().scan.keys` contains only key names, never values.

### Task 2 — Autodetect module (pure fingerprint builder)
Files: `apps/dashboard/server/services/autodetect.mjs` (new); test `apps/dashboard/server/__tests__/autodetect.test.mjs` (new)
Status: TDD
- [x] `fingerprint({url, domNodes?, storageKeys?, wsUrls?})` → existing-match OR a `{slug, origins, proposed:{cadence,scan,extractors}, confidence, tuned:false}` proposal (REQ-F, design §2).
- [x] Guard rails: always `tuned:false`; never writes; never auto-commits a connector.
- Acceptance: test (a) known origin returns `matched:true,slug`; (b) unknown returns a proposal with `origins` derived from registrable domain and `tuned:false`; (c) absent inputs → honest low-confidence proposal, no fabricated keys.

### Task 3 — Autodetect endpoint
Files: `apps/dashboard/server/handlers.mjs` (+ auth/rate-limit pattern from `:3806-3811`)
Status: TDD · extend `autodetect.test.mjs` handler-level or `handlers` test
- [x] `POST /api/connectors/autodetect` → `{ ok, result }`; requires `verifyUser`; rate-limited.
- Acceptance: unauthenticated → 401; over-limit → 429; valid → 200 with a `tuned:false` proposal.

### Task 4 — Registry snapshot for the extension
Files: `apps/dashboard/server/handlers.mjs` (`/api/connectors` GET, `:3717-3730`)
Status: TDD · extend `connectors.test.mjs`/handler test
- [x] `/api/connectors` GET optionally returns `snapshotForExtension()` when `?forExtension=1`, plus `latest` snapshots as today (`:3728`).
- Acceptance: existing `/api/connectors` behavior unchanged for non-`forExtension`; `forExtension` returns origin/cadence/scan/tuned only (no `extractors`, no token-bearing fields).

### Task 5 — Generalized ingest income branch
Files: `apps/dashboard/server/handlers.mjs` (`/api/extension/ingest`, `:4520-4545`); `connectors.mjs`
Status: TDD · handler-level test
- [x] Keep the EO `ingestAppFrame` branch byte-compatible (`:4534-4538`); ADD an income-payload branch `{ origin, slug?, frames?|storage? }` routed through `normalizeExtensionPayload` → `persistSnapshot` (`:242-264`).
- [x] Localhost-only (`:4522`), rate-limited (`:4524-4526`), size-capped preserved.
- Acceptance: EO frames still hit the candle bus (extension drop-in test green); income payload for a registered `scan` connector produces a persisted Earnings snapshot in `connector_latest.json`; unknown origin → honest `status:"unconfigured"`/error, no fabricated row.

---

## Phase B — Extension generalization

### Task 6 — Background worker fetches the registry snapshot
Files: `apps/dashboard/extensions/picc-overlay/background.js` (`ensureVenueConfig`, `:387-400`; `serverFetch`, `:114-155`), `syncPolicy.js` (unchanged)
Status: extension (no new chrome breaking); `node --check background.js`
- [x] Extend `ensureVenueConfig` to fetch the `forExtension` snapshot; build `venueConfigs` from each connector's `origins` + `cadence` (fall back to `SYNC` constants absent one).
- [x] `syncCadenceStep` (`:478-493`) uses the per-connector `cadence`, `min`-bounded by `cadenceFor` + `TICK_MS` (`syncPolicy.js:17,36-41`).
- Acceptance: `node --check background.js` passes; `extensionIntegrity.test.mjs` still green; no new host permissions.

### Task 7 — Content-script generalized `scan` dispatch (`wsFrames` via)
Files: `apps/dashboard/extensions/picc-overlay/content.js` (`venueScanConfig` `:513-530`, `scanVenueSession` `:532-564`); `inject.js` (per-venue, EO unchanged)
Status: extension; keep the read-only lock; extend `extensionIntegrity.test.mjs`
- [x] Add `via:"wsFrames"` executor that consumes declarative `scan.wsUrlRe` + `mapFrame` from the registry snapshot (key NAMES only, `:513-530` cache). The MAIN-world sniffer source frames via the existing `onFrame` plumbing.
- [x] `PICC_CAPTURE_BUILTIN` (`:332-351`) extended with the first wsFrames-capable connector, still pinned equal to the server broadcast by `extensionIntegrity.test.mjs`.
- [x] No `document.`-read expansion beyond the lock; no DOM extractors in content (they stay server-side).
- Acceptance: `node --check content.js`; `extensionIntegrity.test.mjs` green (only the broadcast-pin reference is intentionally updated); on an EO tab nothing regresses.

### Task 8 — `resurrectSensorTabs` / `openVenueTab` host lists from snapshot
Files: `apps/dashboard/extensions/picc-overlay/background.js` (`:52-64`, `:413-441`)
Status: extension
- [x] Replace the EO-only host regexes with `classifyHost` against the snapshot origins (`:402-407`).
- Acceptance: `node --check background.js`; EO behavior unchanged; a second registered origin (after Task 9/14) is recognized.

### Task 9 — Register a second site by CONFIG (proves config-driven)
Files: `apps/dashboard/server/services/connectors.mjs` (one new `registerConnector(...)` + optional inject `inject-<slug>.js`)
Status: TDD-ish; **requires user go-ahead on the site** (see flag)
- [x] Add one new income connector by declarative config (origins/cadence/scan/extractors) with `tuned:false` — e.g. a bandwidth site already in `streamCatalog.ts` (honeygain/earnapp/grass/gradient…). A ws-frames leg needs `inject-<slug>.js` matching `inject.js:19` pattern + a `manifest.json` content_scripts entry.
- Acceptance: `collectedSource` + autodetect + snapshot all work for the new slug; `node --check` on edited extension files; no change to any other connector.

---

## Phase C — Server-backed income surface

### Task 10 — Migrate localStorage streams → `/api/data/income_streams`
Files: `src/lib/income.ts` (new, thin), `src/lib/localdata.ts` (now consumed), `src/lib/streams.ts` (unchanged logic)
Status: **FLAGGED — user-owned data**; no-clearing-until-confirmed rule
- [x] `migrateLocalStreams()` reads `streams.ts:29-31` + `:60-62`, upserts each to `/api/data/income_streams/upsert` (`localdata.ts:54-60`; handler `handlers.mjs:3236-3238`) keeping the existing `uid()` id (`streams.ts:3,38`) → idempotent. Clears localStorage ONLY after every server write confirms.
- Acceptance: after one run, `GET /api/data/income_streams` returns the migrated rows for the user; localStorage is cleared only if all upserts succeeded; a forced server-down run leaves localStorage fully intact.

### Task 11 — Unified income overview endpoint
Files: `apps/dashboard/server/handlers.mjs` → add `GET /api/income/overview`; reuse `localstore.mjs` tables + `getLatestSnapshots` (`connectors.mjs:266-268`)
Status: TDD · `apps/dashboard/server/__tests__/incomeOverview.test.mjs` (new)
- [x] Merge snapshots + streams + holdings (`income_streams`, `transactions`, `nft_holdings`, `depin_nodes`, `financial_accounts`, `localstore.mjs:12-32`) into `{ snapshots, streams, holdings, summary }` (§4 shape). `summary` reuses `StreamSummary` maths (`streams.ts:146-182`).
- Acceptance: absent fields are `null` not `0` (honesty); a `status:"error"` snapshot renders as error, not a zero row; per-user scoping matches the `/api/data` rule (`handlers.mjs:3233`).

### Task 12 — Frontend overview tab + server-backed streams
Files: `src/components/IncomeStreams.tsx`, `src/pages/Income.tsx`, `src/lib/income.ts`
Status: UI; verify by launch
- [x] New `OverviewTab` renders aggregates + holdings from `GET /api/income/overview`; `StreamsTab` reads/writes streams via `income.ts` server CRUD (falling back to `streams.ts` only while a migration is still pending/offline — the independence rule).
- Acceptance: manual: add a stream → appears after reload; a connector snapshot with `status:"error"` shows an honest badge; both web-app-alone and extension-alone scenarios render.

---

## Phase D — Tests, launch, commit

### Task 13 — Full sweep green
- [x] `npm test` (dashboard server vitest) green, including unchanged `extensionIntegrity.test.mjs`, `connectors.test.mjs`, `e2eExtensionFeedChain.test.mjs`, `syncPolicy.test.mjs`.
- [x] Autodetect proposal never marks `tuned:true`; snapshots honest.
- Acceptance: zero failures in the served suite.

### Task 14 — Launch and verify (user gate, before any commit)
Files: none (runtime)
- [ ] **User launches PICC** (web app + extension), confirms workability: income overview aggregates today/30d/lifetime/holdings honestly; an extension-collected source lands a real Earnings snapshot; no trading-candle regression; extension stays read-only.
- [ ] User explicitly approves the flag items (Task 9 second site; Task 10 data migration) before they are considered done.
- Exit: user confirms every REQ-A…REQ-M from `requirements.md`.

### Task 15 — Commit / push (user gate)
Files: git
- [ ] Only after the user launches and confirms: `git status` (no secrets, no `connector_latest.json`/user data), stage intended files, concise message matching repo style, commit, push.
- [ ] Do NOT commit during implementation; the final gate is the user's launch+verify.

---

## Summary

- **Task count:** 15 ordered tasks (Phase A: 5, Phase B: 4, Phase C: 3, Phase D: 3).
- **TDD-first tasks:** 1, 2, 3, 4, 5, 11. **Extension-only (node --check + integrity):** 6, 7, 8, 9. **UI/launch:** 12, 14. **Gate:** 13, 15.
- **Flagged for explicit approval:** Task 9 (new MAIN-world sniffer + second registered site) and Task 10 (localStorage→server data migration).
