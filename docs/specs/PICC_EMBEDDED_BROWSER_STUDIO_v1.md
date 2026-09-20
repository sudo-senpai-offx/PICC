# PICC Embedded Browser Studio — spec v1

**Status:** PROPOSED — Phase 0 (window-first browser model) LANDED 2026-09-16. **Phase C (extension removal + test migration) EXECUTED 2026-09-17 via the D1 clean break** (`docs/specs/PICC_EXTENSION_ERADICATION_AND_SUITES_REBUILD_v1.md`, slices A-1…A-6) — the extension, its server routes, and its tests are gone; the studio is the only browser leg. Phase A (UI surface) + Phase B (studio-owned capture/rearm) — see Resolution below. **Resolution:** COMPLETE — Phase 0 (`52091a3` studio as outer-sidebar universal resource; `47fbe3d` in-app browser rerouting) + Phase A (`dbe3481`) + Phase C (`6536176`/`6046b63` D1 clean break, slices A-1…A-6) all landed; the extension, its routes, and its tests are gone (`b85e83e`, `9d7d460`). Phase B's mechanism shipped via the headless capture engine (studio leg); B-1…B-3 manual verification remain human-gated. Minor deviation: feature key shipped as `"browser"`, not `"studio"`. (**Date:** 2026-09-19)
**Date:** 2026-09-15 (updated 2026-09-16; Phase C status updated 2026-09-17)

**Scope:** Make the existing PICC browser studio the central, shared browser surface: it opens as a **real, separate, visible, trackable browser window** (not an embedded page) that PICC fully intercepts (inputs, console, network, DOM, dialogs, navigation) and keeps in **bidirectional tab sync** with the webapp UI; the webapp gains a top-level outer-sidebar navlink, a full studio page (a live CDP-screencast mirror of the real window), suite-level entrypoints, and studio-owned capture/rearm (replacing the manual re-log). Extension removal (the original Phase C) was executed ahead of schedule via the D1 clean break (2026-09-17) — see Status.

**Extends / relates to:** `PICC.md` (§0 positioning: "studio browser with read-only metrics overlay"; §1 honesty contract), `docs/adr/0001-session-capture-kill-switch-precedence.md` (AND-semantics kill-switch; observation never auto-resumes), `docs/adr/0002-bandwidth-suite-rejected.md` (bandwidth suite excluded), `docs/specs/PICC_SUITE_MINISTRY_MODEL_v1.md` (ministry IA, outer/inner rail, REQ-10/REQ-11), `docs/specs/PICC_PACK1_LOCAL_TRADING_CORE_v1.md` (pack registry, P1-1 EO capture step).

**Grounding rule (per PICC convention):** every `file:line` below was read this session or is explicitly marked **UNVERIFIED**. Anything not re-read this session is **UNVERIFIED** and must be re-verified as a gate in its slice.

---

## Browser model — window-first (Phase 0, LANDED)

The studio browser contract was reversed 2026-09-16 from embedded-first to **window-first**:

- **Default is a REAL window.** `resolveStudioHeadless` (`browserStudio.mjs:1447-1459`) returns `false` unless the caller explicitly passes `headless: true` (background automation such as `liveEO.mjs:675` keeps passing it) or `PICC_STUDIO_HEADLESS=1` (CI/E2E forced-headless escape). `PICC_STUDIO_HEADLESS=0` lets an explicit arg win.
- **Truth table** (pinned by `browserHeadless.mode.test.mjs`, 5 tests, GREEN): `undefined` → `false` (window); `true` → `true`; `false` → `false`; env `=1` → `true` always; env `=0` → follows explicit arg.
- **Bidirectional tab sync** (pinned by `browserStudio.tabSync.test.mjs`, 5 tests, GREEN):
  - Window → PICC: a tab closed in the real window is pruned via the `page.on("close")` handler in `wirePage` (`browserStudio.mjs:894-944`); closing the active tab moves activation to a neighbor; a user switching tabs fires a `document.visibilitychange`/`focus` listener injected per-tab (`__piccTabVisible` exposed function + `addInitScript`) that flips `studio.activeId`.
  - PICC → window: `studioTab` "switch" now calls `target.page.bringToFront()` (`browserStudio.mjs:2067-2068`) so the real window follows; `studioTab` "close" re-finds the tab after `page.close()` fires the close event, so the splice never double-removes.
- **Status exposure:** `studioStatus()` already reports `headless: studio.headless`; client `openBrowser()` (no arg) now yields the window.
- **Comment surface updated:** `handlers.mjs:4209-4213` (`/api/browser/open`) documents window-first; `DEFAULT_SETTINGS` comment (`browserStudio.mjs:181-183`) and the `openStudio` inline comment (`browserStudio.mjs:1465-1468`) too.

---

## Requirements

| ID | Requirement (user-visible, testable) |
|----|---------------------------------------|
| REQ-1 | **Studio as top-level outer-sidebar navlink.** A new entry appears in the outer rail (the `<nav>` inside `AppShell.tsx`'s sidebar) alongside Dashboard, Trading, Earnings, Intelligence, Settings, and Profile. It is a first-class navlink, not a submenu item. The link reads "Browser Studio" with an appropriate icon. Clicking it navigates to `/studio`. Feature-gated by a new `"studio"` feature key (default ON, same pattern as `"trading"` / `"earnings"` at `AppShell.tsx:49-72`). |
| REQ-2 | **Studio page mirrors the live window.** The `/studio` route renders a page that mirrors the real, separate browser window via the live CDP screencast (SSE stream from `/api/browser/stream`) in a content area that fills the main content region of AppShell, with browser controls (address bar, back/forward/reload, new tab, close tab, active-tab bar). Because the studio is window-first, the mirror and the real window stay in sync both ways (`browserStudio.tabSync.test.mjs`): closing a tab in the window prunes it from the mirror, and switching tabs on either side flips the other. It reuses existing client API functions (`openBrowser`, `browserGoto`, `browserTab`, `browserNav`, `streamBrowser` — `api.ts:936-1378`) and existing SSE stream helpers. No new server endpoint is needed. |
| REQ-3 | **Suite-level studio entrypoint.** Each suite's `MinistryShell.tsx` inner-nav (currently trading/earnings/intelligence) gains a "Studio" link (`to: "studio"`). Clicking it opens the shared studio inside the ministry content area, allowing any suite to observe through the browser. The studio page component is shared — it does not have per-suite variants. |
| REQ-4 | **All suites observe the same browser.** There is exactly ONE Chromium process, ONE studio instance, ONE screencast stream. Every suite and every page that opens the studio reads from the same `studio` singleton in `browserStudio.mjs:585-625`. The studio is never duplicated per-suite. When a user is in the trading suite looking at the studio, and switches to the intelligence suite, the same browser continues running with its same tabs. |
| REQ-5 | **Studio-owned automatic capture/rearm.** The studio's EO tab stays logged-in continuously. The 30-minute EO token refresh (`captureProfiles.mjs:68` — `cadence.tokenMs: 30 * 60 * 1000`) is read by the studio's own `refreshTabLogin` (`browserStudio.mjs:3159-3206`) whenever navigation happens on an EO tab. The existing `captureExpertOptionSession` (`:3575-3651`) runs automatically when a login is detected on an EO tab, and the `headless-session-refresh` scheduler job (`scheduler.mjs:328-342`) reads the refreshed token via `captureVenue` (`captureProfiles.mjs:811-938`). The human no longer needs to manually re-log; the studio's browser stays alive and logged-in, and the observation loop reads the fresh token on its own — **on the assumption that the EO SPA renews its session token in tab storage while the tab is open** (the expected behavior of a live trading terminal; the studio never fabricates a token). If the EO session genuinely expires, P1-1 honestly reports `needs: re-login` and the human re-logs in the studio — existing declared behavior, see Risks row 2. The pack-observation tick (`scheduler.mjs:357-413`) surveys `headlessSessionStatus` and `liveEOStats` as today — no new survey logic. |
| REQ-6 | **ADR-0001 compliance preserved.** The observation cycle continues to respect ADR-0001: stopped-at-human steps are NEVER auto-resumed (`packRegistry.mjs:36-37` — legal map). Since the D1 clean break (2026-09-17) there is NO extension toggle — the PICC-side settings kill-switch is the ONLY switch (`sessionCaptureSettings.mjs`), and `observeEoCapture` honors `sessionCaptureEnabled` alone (`packObservers.mjs`). The `captureEnabled` extension-heartbeat seam was removed (A-4). The human ack path (`ackStep` at `packRegistry.mjs:243-265`) is the ONLY exit from stopped-at-human. |
| REQ-7 | **Extension removal — DONE (D1 clean break, 2026-09-17).** The browser extension (`extensions/picc-overlay/` → archived as `apps/extension-archived/`), the server-side extension routes (`/api/extension/*`, `/api/extension/ingest`, `/api/extension/heartbeat`, `/api/extension/tab-changed`, `/api/casting/*`, `/api/trading/capture-session` extension leg), and the extension tests are removed. Executed earlier than this spec's Phase-C gate allowed (the D1 decision overrode the deferral; `sourceLeg: "studio"` was already the observed EO capture leg). See `PICC_EXTENSION_ERADICATION_AND_SUITES_REBUILD_v1.md` slices A-1…A-6 for the audit trail. |
| REQ-8 | **No bandwidth/depin dependency.** Nothing in this spec touches or depends on the bandwidth/depin suite (ADR-0002: rejected). |
| REQ-9 | **Settings toggle remains.** The PICC-side session-capture kill-switch toggle (`sessionCaptureSettings.mjs`, `/api/settings/session-capture`) stays in Settings.tsx. Its role is now entirely "gate the studio capture leg" — there is no extension leg to gate anymore (D1 clean break). Same boolean, same AND-semantics collapsed to this single switch, same honesty contract (absent setting = capture allowed; never treated as off). |

---

## Design

### The seam being cut

The browser studio already exists as a fully-featured server-side service (`browserStudio.mjs`, 3746 lines) with ~30 API endpoints (`handlers.mjs:4479-5113`) and a client library (`api.ts:936-1378`). Since 2026-09-16 the studio opens a **real, separate, visible browser window by default** (window-first; see Browser model above) with bidirectional tab sync; what is missing is entirely on the **UI surface**: there is no route, no page component, and no outer-sidebar navlink that opens the studio's screencast mirror. The studio is a hidden capability that can only be reached through `useExternalLinkRouter` (clicking `_blank` links) or through implicit background operations (the scheduler's `headless-sessionRefresh`).

This spec cuts the seam between "studio exists as a server capability" and "studio is visible as a first-class UI surface". The design is almost entirely additive — a new route, a new page, and two small wiring additions (outer-rail navlink + inner-rail navlinks).

### Phase A — UI Surface (route + page + outer navlink + suite entrypoints)

#### A1. Route registration

Add `/studio` as a top-level route under the `AppShell` route group in `App.tsx:41-68`:

```tsx
<Route path="studio" element={<StudioPage />} />
```

The `StudioPage` component lives at `src/pages/StudioPage.tsx` (new file). It is NOT feature-gated in the route definition — the feature gate is in the outer-rail navlink only (same pattern as `/opportunities` at `App.tsx:53`).

#### A2. Outer-rail navlink

Add to the `NAV` array in `AppShell.tsx:49-72`, under a new section or inside "Command":

```tsx
{ section: "Command", items: [
    { to: "/", label: "Dashboard", icon: "▦", feature: null },
    { to: "/opportunities", label: "Opportunities", icon: "🧭", feature: "opportunities" },
    { to: "/studio", label: "Browser Studio", icon: "🌐", feature: "studio" }  // NEW
] }
```

The `"studio"` feature key is added to the `FeatureKey` type in `src/lib/settings.ts` — UNVERIFIED: need to check the FeatureKey type definition and settings module.

#### A3. StudioPage component

`src/pages/StudioPage.tsx` (new file). Responsibilities:
1. On mount, call `getBrowserStatus()` — if `!status.open`, call `openBrowser()` to start the Chromium process.
2. Establish the SSE stream via `streamBrowser(onEvent)`.
3. Render:
   - A **tab bar** across the top showing all open tabs (`StudioTab[]` from stream events), with active-tab highlighting and close buttons.
   - An **address bar** with URL input + Go button (calls `browserGoto`).
   - **Navigation controls**: back, forward, reload (calls `browserNav`).
   - A **screencast viewport**: the `<img>` tag receiving base64 JPEG frames from the stream event `{type:"frame", data}`. The image is rendered at the viewport dimensions reported in the stream (`vp.width × vp.height`).
   - A **status bar** showing the detected site (`assist.site` from stream), vault status (`hasSavedCredentials`), and a minimal control panel for the studio (open/close).
4. Cleans up the SSE stream on unmount (`close()` from `streamBrowser`).

This is a thin React component over the existing client library. No new server work.

#### A4. Suite-level inner-nav entries

Add `"studio"` to each suite's `INNER_NAV` in `MinistryShell.tsx:4-25`:

```tsx
trading: [
    { to: "dashboard", label: "Dashboard" },
    // ... existing entries
    { to: "studio", label: "Browser Studio" }  // NEW
],
earnings: [
    { to: "dashboard", label: "Dashboard" },
    { to: "simulator", label: "Simulator" },
    { to: "settings", label: "Settings" },
    { to: "studio", label: "Browser Studio" }  // NEW
],
intelligence: [
    { to: "dashboard", label: "Dashboard" },
    { to: "governor", label: "Governor" },
    { to: "guidance", label: "Guidance" },
    { to: "settings", label: "Settings" },
    { to: "studio", label: "Browser Studio" }  // NEW
]
```

Add the matching room to `MinistryRoom.tsx:14-41`:

```tsx
// In all three room maps:
"studio": StudioRoom  // import StudioRoom from a shared component
```

`StudioRoom` is a thin wrapper that renders the same `StudioPage` content (or a shared `StudioView` component extracted from it). Since the studio is always the same singleton, the component just mounts the same view inside the ministry content area.

#### A5. Feature key

Add `"studio"` to the `FeatureKey` union type and the settings module. Default: ON.

### Phase B — Studio-owned Capture/Rearm

#### B1. No new capture logic — reuse existing seams

The capture/rearm mechanism already exists in the studio:

- `refreshTabLogin` (`browserStudio.mjs:3159-3206`) fires on every navigation event on every wired page (`:880-887`). When it detects a logged-in EO tab (`:3179-3180`), it calls `captureExpertOptionSession` (`:3181`) with a cooldown (`EO_CAPTURE_COOLDOWN_MS`).
- `captureExpertOptionSession` (`:3575-3651`) reads the EO tab's cookies/localStorage/sessionStorage for the 32-hex session token, saves it via `trading.saveCredentials`, and returns.
- `headlessSessionRefresh` (`captureProfiles.mjs:970-988`) runs every 60s (`scheduler.mjs:328-342`), calls `captureVenue("expertoption")` which reads the studio's live pages (`resolveCapturePage` at `:948-963`) and runs the same hook.
- `finalizeCapturedToken` (`:559-586`) compares before/after and triggers `restartLiveEO({force:true})` when the token changed.

What changes: today the human must manually log in to EO in the studio. With the studio as the persistent browser surface, the EO tab stays open and logged-in. The 30-minute token lifecycle is handled by the EO server — as long as the tab is active and not frozen, the browser's cookies remain fresh. The `refreshTabLogin` hook captures the fresh token whenever navigation fires, and the scheduler's 60s pass picks it up.

#### B2. Prevent EO tab freezing

The studio's background tab freeze logic (`tabFreezeMs: 90_000`, `browserStudio.mjs:209-211`) must NOT freeze the EO tab. The `isLiveStreamTab` check at `:1029-1036` already exempts EO tabs from freezing (line 1076: `if (isLiveStreamTab(tab)) return`). No change needed — verified this session.

#### B3. Observation cycle unchanged

The pack-observation tick (`scheduler.mjs:357-413`) surveys the same seams:
- `headlessSessionStatus()` — reads `captureProfiles.lastReports` (which the studio's `captureVenue` writes to)
- `liveEOStats()` — reads the liveEO connection state
- `getCredentials()` — reads the saved token

The extension is gone (D1 clean break, 2026-09-17): there is no extension heartbeat, and no `captureEnabled` relay (the seam was removed in A-4). The observer (`packObservers.mjs`) honors `sessionCaptureEnabled` alone — `true`=allow, `false`=block (skip), absent=default-ON (never treated as off). The AND-semantics collapsed to this single switch.

#### B4. ADR-0001 compliance path

ADR-0001 requires:
1. **Single-switch semantics (post-D1).** With the extension gone (2026-09-17), only the PICC settings toggle is observable. PICC settings OFF → capture blocked; PICC settings ON → capture allowed. There is no second switch to AND against anymore.
2. **Observation never auto-resumes:** `coerceObservationForStoppedStep` (`packObservers.mjs:87-117`) continues to hold: when the step is `stopped-at-human` and the seam reports `running`, the coercion rewrites to `stopped-at-human` (same-status, fresh evidence). The human ack via `ackStep` is the only exit.
3. **Kill-switch skip on stopped step:** a `sessionCaptureDisabled` skip on a `stopped-at-human` step is coerced to same-status (`:101-115`). This path is unchanged.
4. **Pathway prompt:** the login pathway (`loginPathway` at `:32-46`) and the capture pathway (`capturePathway` at `:52-62`) continue to show structured steps directing the user. The pathway step is already the D1-era wording: "Open the Browser Studio and navigate to ExpertOption" (updated in A-4).

### Phase C — Extension Removal + Test Migration — **EXECUTED 2026-09-17 (D1 clean break)**

> This phase's plan below is retained as a historical record. All of it was executed
> ahead of the original Phase-B gate by `PICC_EXTENSION_ERADICATION_AND_SUITES_REBUILD_v1.md`
> (owner decision D1), slices A-1…A-6: extension dir archived (not deleted) at
> `apps/extension-archived/`, all server extension routes + capture leg removed, all
> extension tests removed, `captureEnabled` seam and `captureSessionFromExtension`
> deleted, `sourceLeg` is studio-only. The file paths below describe the pre-removal code.

#### C1. Extension file removal

Delete the entire `extensions/picc-overlay/` directory:
- `background.js` — the service worker that relays extension heartbeats, ingests frames, and performs venue-session scans.
- `content.js` — the MAIN-world sensor that reads cookies/storage on venue tabs and relays to the worker.
- `popup.html` / `popup.js` — the popup UI.
- `inject.js` — the EO frame sniffer.
- `manifest.json` — the MV3 manifest.
- `sidepanel.html` / `sidepanel.js` — the side panel.
- `autopilotPanel.js` — legacy (already removed from manifest per `extensionIntegrity.test.mjs:41`).
- `icons/` — extension icons.

#### C2. Server-side extension route removal

Remove or deprecate these handlers from `handlers.mjs:4868-5113`:
- `"/api/browser/metrics"` — extension page metrics ingestion (`:4869-4897`).
- `"/api/casting/frame"` — extension screen casting (`:4900-4922`).
- `"/api/casting/status"` — casting status (`:4924-4934`).
- `"/api/extension/status"` — extension installation status (`:4936-4949`).
- `"/api/extension/ingest"` — broker frame ingestion from extension (`:4955-5008`).
- `"/api/trading/capture-session"` — extension session capture leg (`:5021-5041`). NOTE: the `/api/browser/capture-session` route (`:4596-4603`) stays — it calls `captureExpertOptionSession` directly and is used by the studio.
- `"/api/trading/capture-profiles"` — extension scan config (`:5047-5066`).
- `"/api/extension/heartbeat"` — extension heartbeat (`:5069-5096`).
- `"/api/extension/tab-changed"` — extension tab change (`:5098-5113`).

Also remove the `isLocalhostRequest`-gated extension routes from the `EXTENSION_POLL_ROUTES` set if present (need to verify — UNVERIFIED: this route set was mentioned in handlers.mjs:1067 area but I did not read that section this session).

#### C3. packObserver kill-switch simplification — **DONE (Option B, A-4)**

Executed as this section's **Option B (cleanup)** in slice A-4: the `captureEnabled` input to `observeEoCapture` was removed entirely (it was always null post-removal), the `SKIP_REASONS.extensionCaptureDisabled` vocabulary was folded out of `packRunner.mjs` (SKIP_REASONS now 8 keys), and `killSwitchSkip` checks `sessionCaptureEnabled` only. The AND-gate simplification this section speculates about is what shipped.

#### C4. captureProfiles extension leg removal — **DONE (Option B, A-1/A-5)**

Executed as this section's **Option B (remove)** in slices A-1/A-5: `captureSessionFromExtension` and the `/api/trading/capture-session` extension leg are gone; `captureVenue` (studio leg) is the only capture path. `extensionSessionCapture.test.mjs` was removed.

#### C5. Test migration — **DONE (A-5/A-6)**

The following test files referenced the extension. **All are now removed** (verified 2026-09-17):

| Test file | Status |
|-----------|--------|
| `extensionIntegrity.test.mjs` (330 lines) | **Removed** — extension deleted |
| `syncPolicy.test.mjs` | **Removed** — extension sync policy logic deleted with the extension |
| `captureContracts.test.mjs` | **Kept, updated** — studio-side contract tests retained |
| `sensorContentLifecycle.test.mjs` | **Removed** |
| `extensionSessionCapture.test.mjs` | **Removed** — `captureSessionFromExtension` gone |
| `extensionSelectors.test.mjs` | **Removed (A-5)** — 13 tests, imported only `extension-archived/` |
| `extensionIngestEndpoint.test.mjs` | **Removed** |
| `extensionIngest.test.mjs` | **Removed (A-1)** — regression coverage ported to `feedMode.test.mjs` |
| `extensionBoundary.test.mjs` | **Removed (A-5)** — 2 tests, imported only `extension-archived/` |
| `backgroundServerStatus.test.mjs` | **Removed** |

The studio-side tests (`browserStudio.test.mjs`, `browserStudio.login.test.mjs`, `captureVenue.test.mjs`, `captureProfiles.test.mjs`, `packObservers.test.mjs`, `sessionCaptureSettings.test.mjs`) stayed green through the removal. New D1 absence-pinning regression test: `extensionAbsence.test.mjs` (50 tests, A-6).

#### C6. `sourceLeg` cleanup — **DONE (A-1/A-5)**

`headlessSessionStatus()` (`captureProfiles.mjs:447-481`) reports `sourceLeg: "studio"` for EO — the only capture leg. `"extension"` is never produced (the phrase "extension" is absent from `server/` entirely per the A-6 absence test; `feedMode.test.mjs` intentionally retains the legacy-coercion coverage).

---

## Non-goals

- **No new server endpoint.** The studio page uses existing `/api/browser/*` routes. No new API surface.
- **No new Chromium process management.** The studio reuses the existing `openStudio`/`closeStudio` lifecycle.
- **No per-suite browser isolation.** There is ONE browser for all suites (REQ-4). Per-suite browser sessions are explicitly not in scope.
- **No extension functionality replacement.** The extension's frame-ingestion relay (`/api/extension/ingest` → `liveEO.mjs` broker data) was removed in the D1 clean break without replacement (2026-09-17). The studio's CDP-based intelligence feed (console/network/DOM/WS at `browserStudio.mjs:664-984`) is the only real-browser frame path now.
- **No changes to the pack runner, registry, or envelope gate.** The pack observation cycle is read-only over existing seams.
- **No changes to the Command Centre truth table.** ExpertOption stays `automationPermission: "forbidden"`, `demoOnly: true`.
- **No live-money trading.** The studio's read-only-by-default bridge (`browserStudio.mjs:17`) is unchanged.

---

## Tasks

### Phase A — UI Surface

#### A-1. Add `"studio"` feature key
- **Files:** `src/lib/settings.ts` (UNVERIFIED: exact file location), `src/components/AppShell.tsx`
- **What:** Add `"studio"` to the `FeatureKey` type union. Add it to the default-on features set.
- **Acceptance:** TypeScript compiles; `"studio"` appears in the feature gate filter at `AppShell.tsx:165`.

#### A-2. Outer-rail navlink
- **Files:** `src/components/AppShell.tsx`
- **What:** Add `{ to: "/studio", label: "Browser Studio", icon: "🌐", feature: "studio" }` to the `NAV` array under the "Command" section.
- **Acceptance:** The navlink appears in the outer sidebar between "Opportunities" and the "Suites" section. Clicking it navigates to `/studio`. The feature gate hides it when `"studio"` is OFF.

#### A-3. Route registration
- **Files:** `src/App.tsx`
- **What:** Add `<Route path="studio" element={<StudioPage />} />` inside the authenticated `AppShell` route group, after the `opportunities` route and before `settings`.
- **Acceptance:** Navigating to `/studio` renders the `StudioPage` component. Navigating to `/suites/trading/studio` also renders it (via the MinistryShell inner route — see A-5).

#### A-4. StudioPage component
- **Files:** `src/pages/StudioPage.tsx` (new)
- **What:** Build the studio page using existing client API:
  - Auto-open browser on mount if not open.
  - SSE stream connection for frames, tabs, status, assist, intel.
  - Render: tab bar, address bar, navigation controls, screencast viewport (base64 JPEG `<img>`), minimal status overlay.
  - Cleanup on unmount.
- **Acceptance:**
  - On first visit, the browser opens automatically.
  - Live screencast frames render in the viewport.
  - Address bar navigates to typed URL.
  - Tab bar shows open tabs; clicking switches tabs; close button closes tabs.
  - Back/forward/reload controls work.
  - Switching away and back reconnects the SSE stream.

#### A-5. Suite-level inner-nav + room routing
- **Files:** `src/pages/MinistryShell.tsx`, `src/pages/ministry/MinistryRoom.tsx`
- **What:** Add `{ to: "studio", label: "Browser Studio" }` to each suite's `INNER_NAV`. Add `"studio": StudioRoom` to each `MINISTRY_ROOMS` map (a thin wrapper or the same `StudioPage` component).
- **Acceptance:** Navigating to `/suites/trading/studio`, `/suites/earnings/studio`, `/suites/intelligence/studio` all render the shared studio view. The inner sidebar shows the "Browser Studio" link.

#### A-6. Update PICC.md §10 specs registry
- **Files:** `PICC.md` (§10 specs registry)
- **What:** Add an entry for this spec: `PICC_EMBEDDED_BROWSER_STUDIO_v1` — `docs/specs/PICC_EMBEDDED_BROWSER_STUDIO_v1.md`, status PROPOSED (Phase 0 window-first LANDED 2026-09-16; Phase C extension removal EXECUTED 2026-09-17 via D1 clean break), date 2026-09-15, scope "window-first studio browser + webapp studio surface + studio-owned capture + extension removal". Flip status to IMPLEMENTED when the full sequence lands.
- **Acceptance:** `PICC.md` §10 lists the spec with its five-WH elements consistent with the file.

### Phase B — Studio-owned Capture/Rearm

#### B-1. Verify capture path works end-to-end
- **Files:** None (verification task)
- **What:** Manually verify: (a) open the studio, navigate to `app.expertoption.com`, log in. (b) Wait 30+ minutes. (c) Check `headlessSessionStatus()` reports `sourceLeg: "studio"` with a fresh `lastCaptureAt`. (d) Check the pack registry P1-1 step shows `running` with a token.
- **Acceptance:** The `sourceLeg` is `"studio"`, the token was captured without manual re-log, and the pack step is healthy.

#### B-2. Verify kill-switch still works
- **Files:** None (verification task)
- **What:** Toggle the session-capture kill-switch OFF in Settings. Verify P1-1 goes to `skipped-unconfigured` with `SKIP_REASONS.sessionCaptureDisabled`. Toggle back ON. Verify P1-1 recovers (after ack if it was stopped-at-human).
- **Acceptance:** Kill-switch toggle controls the capture leg as before.

#### B-3. Verify pack observation is unchanged
- **Files:** None (verification task)
- **What:** With the studio running and EO logged in, verify the pack-observation tick (`scheduler.mjs:357`) runs without errors, P1-1 status is `running`, and `coerceObservationForStoppedStep` is not invoked (the step is not stopped).
- **Acceptance:** Pack observation tick green, P1-1 running.

### Phase C — Extension Removal + Test Migration

#### C-1. Remove extension directory
- **Files:** `extensions/picc-overlay/` (entire directory)
- **What:** Delete all files.
- **Acceptance:** Directory no longer exists; `git status` shows the deletion.

#### C-2. Remove extension server routes
- **Files:** `apps/dashboard/server/handlers.mjs`
- **What:** Remove or comment out the handlers for `/api/browser/metrics`, `/api/casting/frame`, `/api/casting/status`, `/api/extension/status`, `/api/extension/ingest`, `/api/trading/capture-session`, `/api/trading/capture-profiles`, `/api/extension/heartbeat`, `/api/extension/tab-changed`. Keep `/api/browser/capture-session` (the studio's own capture endpoint).
- **Acceptance:** `grep -r "extension/heartbeat\|extension/ingest\|extension/tab-changed\|extension/status\|casting/frame\|casting/status\|trading/capture-session\|trading/capture-profiles\|browser/metrics" apps/dashboard/server/` returns zero hits outside comments.

#### C-3. Remove extension test files
- **Files:** `server/__tests__/extensionIntegrity.test.mjs`, `server/__tests__/syncPolicy.test.mjs` (if extension-only), `server/__tests__/captureContracts.test.mjs` (if extension-only), `server/__tests__/sensorContentLifecycle.test.mjs`, `server/__tests__/extensionSessionCapture.test.mjs`, `server/__tests__/extensionSelectors.test.mjs`, `server/__tests__/extensionIngestEndpoint.test.mjs`, `server/__tests__/extensionIngest.test.mjs`, `server/__tests__/extensionBoundary.test.mjs`
- **What:** Delete the files that test extension-only logic. For `captureContracts.test.mjs` — review first; if it has studio-side contract tests, keep those and remove only the extension-specific cases.
- **Acceptance:** `npm test` passes with zero failures related to missing extension files/modules.

#### C-4. Remove `captureSessionFromExtension` — **DONE (A-1/A-5)**
- **Files:** `apps/dashboard/server/services/captureProfiles.mjs`
- **What:** Remove `captureSessionFromExtension` (`:604`), `captureSessionFromExtensionCore` (`:616`), and `sanitizeExtensionAccount`, plus the `sourceLeg: "extension"` finalize path at `:680`. Remove the exports.
- **Acceptance:** `grep -r "captureSessionFromExtension" apps/dashboard/` returns zero hits. — **satisfied; the A-6 absence test pins "extension" absent from `captureProfiles.mjs`.**

#### C-5. Clean up `useExternalLinkRouter` — **NO CHANGE NEEDED (verified)**
- **Files:** `src/components/AppShell.tsx`
- **What:** The `useExternalLinkRouter` hook at `AppShell.tsx:18-47` currently reroutes `_blank` links into the in-app browser via `openBrowser()`/`browserTab()`. With the studio as the central surface, this behavior is still correct — external links should open in the studio. No change needed, but verify the behavior is preserved after the extension removal.
- **Acceptance:** Clicking a `_blank` link in the dashboard still opens it in the studio browser.

#### C-6. Verify full observation cycle — **DONE (A-2/A-4; `sourceLeg: "studio"` observed in the live shape)**
- **Files:** None (verification task)
- **What:** With the extension removed and the studio running: (a) verify `headlessSessionStatus()` shows `sourceLeg: "studio"` for EO, (b) verify pack P1-1 is `running`, (c) verify `observeEoCapture` (session-only kill-switch — the `captureEnabled` parameter was removed in A-4) produces the correct observation, (d) verify the kill-switch still works.
- **Acceptance:** All observation paths work without the extension.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Studio browser crash / OOM kills the capture leg.** | P1-1 goes to `no-tab` or `error`; token goes stale; liveEO disconnects. | The studio already handles Chromium death (`browserStudio.mjs:1483-1486` — `context.on("close")` calls `resetStudioAfterDeath`). The scheduler retries every 60s. The pack step shows honest `no-tab` status. |
| **EO tab cookie expiry without user re-login.** | Token expires; `refreshTabLogin` detects degraded `expired` kind; P1-1 goes to `stopped-at-human`. | This is the EXISTING behavior — the human re-logs in the studio (now the central surface) and acks the pack step. The pathway prompt directs them to the studio. |
| **Extension removal broke the frame-ingestion relay.** | `liveEO.mjs` lost the extension's broker frame relay; realtime EO data stops. | RESOLVED 2026-09-17: the studio's CDP intelligence feed (`network` intel at `:806-818`) captures the same WS frames the extension relayed; `liveEO` has a studio-side path. Verified by the full test gate (204 files / 2133 tests) + `extensionAbsence.test.mjs`. |
| **Test migration misses a hidden extension dependency.** | Test suite fails after Phase C. | CLOSED 2026-09-17: full gate green (204 files / 2133 tests); the A-6 `extensionAbsence.test.mjs` pins the dead tokens (`chrome.runtime`, `content.js`, `__piccCommand`, `extensionCaptureDisabled`, `captureEnabled`, "extension" word) in all 25 key modules. |
| **ADR-0001 compliance regression.** | Capture auto-resumes a stopped-at-human step. | The legal map (`packRegistry.mjs:31-37`) is the guard — `stopped-at-human` can ONLY transition to itself. `coerceObservationForStoppedStep` is tested (`packObservers.test.mjs`). No code change touches the legal map or the coercion logic. |
| **`isLocalhostRequest` guard removal exposes localhost-only routes.** | External clients hit extension routes. | DONE — the extension routes were removed entirely (not just the guard); `/api/extension/*` matches zero route registrations (A-6 verification). No orphan routes remain. |

---

## Honesty notes

- **Demo/live gates touched:** Phase B-1 is a manual verification gate — the human must log in to EO in the studio and verify the capture leg works. This is recorded as human observation, not CI assertion. Phase C's manual gate (verify the full cycle after extension removal) was executed as part of the D1 clean break suite — the observation path is verified by `packObservers.test.mjs` + `feedMode.test.mjs` + the full gate, awaiting a live-studio manual pass.
- **Fabricated-state risks:** None. The studio capture leg (`captureExpertOptionSession`) reads REAL cookies/storage from a REAL Chromium tab. The token value is never invented. The `guest` detection (`:3627-3644`) reads DOM signals honestly. The observer (`packObservers.mjs`) never fabricates a `running` status — it maps real seam outputs.
- **ADR-0001 precision:** The kill-switch AND-semantics collapsed to a single switch when the extension was removed (2026-09-17). This is an honest simplification, not a weakening — the extension toggle is gone entirely, so the PICC settings toggle is the sole gate. The spec documents this collapse.

---

## Open questions for owner approval

1. **Studio page layout:** Should the studio page fill the ENTIRE content area (no padding/margins — the screencast viewport should be as large as possible), or should it have the standard `stack stack-lg` padding that other pages use? The screencast viewport is already constrained to the browser's viewport dimensions (`DEFAULT_VIEWPORT: { width: 1440, height: 900 }` at `browserStudio.mjs:30`), so full-bleed makes visual sense.
2. **Feature gate default:** Should `"studio"` be default-ON for all users, or should it require an explicit opt-in (like `"opportunities"` which is feature-gated)? The owner's requirement says "the PICC browser becomes a separate outer-sidebar navlink" — this implies default-ON.
3. **Extension removal timing:** RESOLVED — the owner chose the D1 clean break (2026-09-17): the extension was removed as a standalone eradication effort (`PICC_EXTENSION_ERADICATION_AND_SUITES_REBUILD_v1.md`), separate from the studio UI-surface work this spec plans.
4. **`captureSessionFromExtension` removal:** RESOLVED — Option B (full removal) was executed in slices A-1/A-5 at the owner's D1 direction.
