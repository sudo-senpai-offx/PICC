# PICC Embedded Browser Studio — spec v1

**Status:** PROPOSED — no code landed from this spec.
**Date:** 2026-09-15

**Scope:** Embed the existing PICC browser studio as the central, shared browser surface inside the webapp: a top-level outer-sidebar navlink, a full studio page, suite-level entrypoints, studio-owned capture/rearm (replacing the manual re-log), and eventual extension removal. Three-phase sequence; Phase C gates on Phase B proving the studio capture leg works.

**Extends / relates to:** `PICC.md` (§0 positioning: "studio browser with read-only metrics overlay"; §1 honesty contract), `docs/adr/0001-session-capture-kill-switch-precedence.md` (AND-semantics kill-switch; observation never auto-resumes), `docs/adr/0002-bandwidth-suite-rejected.md` (bandwidth suite excluded), `docs/specs/PICC_SUITE_MINISTRY_MODEL_v1.md` (ministry IA, outer/inner rail, REQ-10/REQ-11), `docs/specs/PICC_PACK1_LOCAL_TRADING_CORE_v1.md` (pack registry, P1-1 EO capture step).

**Grounding rule (per PICC convention):** every `file:line` below was read this session or is explicitly marked **UNVERIFIED**. Anything not re-read this session is **UNVERIFIED** and must be re-verified as a gate in its slice.

---

## Requirements

| ID | Requirement (user-visible, testable) |
|----|---------------------------------------|
| REQ-1 | **Studio as top-level outer-sidebar navlink.** A new entry appears in the outer rail (the `<nav>` inside `AppShell.tsx`'s sidebar) alongside Dashboard, Trading, Earnings, Intelligence, Settings, and Profile. It is a first-class navlink, not a submenu item. The link reads "Browser Studio" with an appropriate icon. Clicking it navigates to `/studio`. Feature-gated by a new `"studio"` feature key (default ON, same pattern as `"trading"` / `"earnings"` at `AppShell.tsx:49-72`). |
| REQ-2 | **Studio page renders the live browser.** The `/studio` route renders a page that displays the live CDP screencast (SSE stream from `/api/browser/stream`) in a content area that fills the main content region of AppShell, with browser controls (address bar, back/forward/reload, new tab, close tab, tab bar). It reuses existing client API functions (`openBrowser`, `browserGoto`, `browserTab`, `browserNav`, `streamBrowser` — `api.ts:936-1378`) and existing SSE stream helpers. No new server endpoint is needed. |
| REQ-3 | **Suite-level studio entrypoint.** Each suite's `MinistryShell.tsx` inner-nav (currently trading/earnings/intelligence) gains a "Studio" link (`to: "studio"`). Clicking it opens the shared studio inside the ministry content area, allowing any suite to observe through the browser. The studio page component is shared — it does not have per-suite variants. |
| REQ-4 | **All suites observe the same browser.** There is exactly ONE Chromium process, ONE studio instance, ONE screencast stream. Every suite and every page that opens the studio reads from the same `studio` singleton in `browserStudio.mjs:585-625`. The studio is never duplicated per-suite. When a user is in the trading suite looking at the studio, and switches to the intelligence suite, the same browser continues running with its same tabs. |
| REQ-5 | **Studio-owned automatic capture/rearm.** The studio's EO tab stays logged-in continuously. The 30-minute EO token refresh (`captureProfiles.mjs:68` — `cadence.tokenMs: 30 * 60 * 1000`) is read by the studio's own `refreshTabLogin` (`browserStudio.mjs:3159-3206`) whenever navigation happens on an EO tab. The existing `captureExpertOptionSession` (`:3575-3651`) runs automatically when a login is detected on an EO tab, and the `headless-session-refresh` scheduler job (`scheduler.mjs:328-342`) reads the refreshed token via `captureVenue` (`captureProfiles.mjs:811-938`). The human no longer needs to manually re-log; the studio's browser stays alive and logged-in, and the observation loop reads the fresh token on its own — **on the assumption that the EO SPA renews its session token in tab storage while the tab is open** (the expected behavior of a live trading terminal; the studio never fabricates a token). If the EO session genuinely expires, P1-1 honestly reports `needs: re-login` and the human re-logs in the studio — existing declared behavior, see Risks row 2. The pack-observation tick (`scheduler.mjs:357-413`) surveys `headlessSessionStatus` and `liveEOStats` as today — no new survey logic. |
| REQ-6 | **ADR-0001 compliance preserved.** The observation cycle continues to respect ADR-0001: stopped-at-human steps are NEVER auto-resumed (`packRegistry.mjs:36-37` — legal map); the kill-switch AND-semantics (PICC settings + extension toggle, `packObservers.mjs:138-170`) remain intact; when the studio's capture is the only leg (extension removed in Phase C), the `captureEnabled` heartbeat relay (`:5090`) becomes always-true or the observer defaults it to unobserved (null = default-ON). The human ack path (`ackStep` at `packRegistry.mjs:243-265`) is the ONLY exit from stopped-at-human. |
| REQ-7 | **Extension removal deferred to Phase C.** The browser extension (`extensions/picc-overlay/`) is NOT removed until Phase B proves the studio capture leg works. Phase C removes the extension, migrates tests, and cleans up server-side extension routes (`/api/extension/*`, `/api/extension/ingest`, `/api/extension/heartbeat`, `/api/extension/tab-changed`, `/api/casting/*`). This is gated on: (a) the `sourceLeg` in `headlessSessionStatus()` showing `"studio"` for EO capture, (b) all extension-related tests passing in their migrated form. |
| REQ-8 | **No bandwidth/depin dependency.** Nothing in this spec touches or depends on the bandwidth/depin suite (ADR-0002: rejected). |
| REQ-9 | **Settings toggle remains.** The PICC-side session-capture kill-switch toggle (`sessionCaptureSettings.mjs`, `/api/settings/session-capture`) stays in Settings.tsx. Its role changes from "gate the extension leg" to "gate the studio capture leg" — the same boolean, the same AND-semantics, the same honesty contract. |

---

## Design

### The seam being cut

The browser studio already exists as a fully-featured server-side service (`browserStudio.mjs`, 3746 lines) with ~30 API endpoints (`handlers.mjs:4479-5113`) and a client library (`api.ts:936-1378`). What is missing is entirely on the **UI surface**: there is no route, no page component, and no outer-sidebar navlink that opens the studio. The studio is a hidden capability that can only be reached through `useExternalLinkRouter` (clicking `_blank` links) or through implicit background operations (the scheduler's `headless-sessionRefresh`).

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

What changes: today the human must manually log in to EO in the studio (or their own browser via the extension). With the studio as the persistent browser surface, the EO tab stays open and logged-in. The 30-minute token lifecycle is handled by the EO server — as long as the tab is active and not frozen, the browser's cookies remain fresh. The `refreshTabLogin` hook captures the fresh token whenever navigation fires, and the scheduler's 60s pass picks it up.

#### B2. Prevent EO tab freezing

The studio's background tab freeze logic (`tabFreezeMs: 90_000`, `browserStudio.mjs:209-211`) must NOT freeze the EO tab. The `isLiveStreamTab` check at `:1029-1036` already exempts EO tabs from freezing (line 1076: `if (isLiveStreamTab(tab)) return`). No change needed — verified this session.

#### B3. Observation cycle unchanged

The pack-observation tick (`scheduler.mjs:357-413`) surveys the same seams:
- `headlessSessionStatus()` — reads `captureProfiles.lastReports` (which the studio's `captureVenue` writes to)
- `liveEOStats()` — reads the liveEO connection state
- `getCredentials()` — reads the saved token

When the extension is removed (Phase C), the `captureEnabled` heartbeat relay (`:5090`) becomes permanently null (no extension to report). The observer (`packObservers.mjs:138-170`) treats null as "not observed, default-ON" (`:149`: `if (sessionCaptureEnabled === false)` — null is not false). The AND-semantics work: PICC-side settings toggle stays; extension toggle becomes permanently unobserved (null = default-ON); capture proceeds.

#### B4. ADR-0001 compliance path

ADR-0001 requires:
1. **AND-semantics:** either switch OFF blocks capture. With the extension gone, only the PICC settings toggle is observable. An unobserved extension toggle (null) is default-ON. So: PICC settings OFF → capture blocked; PICC settings ON → capture allowed. The AND-semantics collapse to a single switch (PICC settings) when the other is absent.
2. **Observation never auto-resumes:** `coerceObservationForStoppedStep` (`packObservers.mjs:87-117`) continues to hold: when the step is `stopped-at-human` and the seam reports `running`, the coercion rewrites to `stopped-at-human` (same-status, fresh evidence). The human ack via `ackStep` is the only exit.
3. **Kill-switch skip on stopped step:** a `sessionCaptureDisabled` skip on a `stopped-at-human` step is coerced to same-status (`:101-115`). This path is unchanged.
4. **Pathway prompt:** the login pathway (`loginPathway` at `:32-46`) and the capture pathway (`capturePathway` at `:52-62`) continue to show structured steps directing the user. The pathway steps change in Phase C: "Open the ExpertOption app tab for the capture leg you use (studio browser, or your own browser with the PICC extension)" becomes "Open the Browser Studio and navigate to ExpertOption" — but the format is unchanged.

### Phase C — Extension Removal + Test Migration

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

#### C3. packObserver kill-switch simplification

After Phase C, the `captureEnabled` input to `observeEoCapture` (`packObservers.mjs:142-143`) is always null (no extension heartbeat). The AND-gate at `:164-170` (`if (captureEnabled === false)`) is dead code (never triggered). Two options:

- **Option A (minimal):** Leave the dead code path. It still works correctly (null is not false, so it's skipped). Tests that exercise the extension kill-switch path can be updated to explicitly inject `captureEnabled: false` to verify the coercion logic still holds, even though the runtime never sends it.
- **Option B (cleanup):** Remove the `captureEnabled` branch and the `SKIP_REASONS.extensionCaptureDisabled` vocabulary. Simplify `observeEoCapture` to only check `sessionCaptureEnabled`.

Recommendation: Option A for Phase C. Clean up in a later sweep. The dead code is harmless and preserves test coverage of the AND-semantics path.

#### C4. captureProfiles extension leg removal

`captureSessionFromExtension` (`captureProfiles.mjs:604-680`; `sourceLeg: "extension"` at `:680`) is the extension leg of venue session capture. After Phase C, the only capture leg is the studio leg (`captureVenue` at `:811-938`). Two options:

- **Option A (minimal):** Leave `captureSessionFromExtension` in place. It is no longer called at runtime (no extension to POST to `/api/trading/capture-session`). Tests exercise it as a pure function.
- **Option B (remove):** Delete `captureSessionFromExtension` and its test file (`extensionSessionCapture.test.mjs`). Also remove the `/api/trading/capture-session` handler.

Recommendation: Option B — it is dead code after extension removal.

#### C5. Test migration

The following test files reference the extension and must be migrated or removed:

| Test file | Action | Reason |
|-----------|--------|--------|
| `extensionIntegrity.test.mjs` (330 lines) | **Remove entirely** — tests extension file presence, manifest contracts, DOM-mutation-free sensor, chrome.* guards. All fail after extension deletion. | Extension deleted |
| `syncPolicy.test.mjs` | **Review** — tests the extension's sync policy logic. If it imports extension files, remove or migrate to studio-side equivalent. | UNVERIFIED: did not read this file |
| `captureContracts.test.mjs` | **Review** — tests capture contracts (extension kill-switch, storage keys). Update to test studio-only path. | Extension capture leg removed |
| `sensorContentLifecycle.test.mjs` | **Remove entirely** — tests the content script lifecycle. | Extension deleted |
| `extensionSessionCapture.test.mjs` | **Remove** — tests `captureSessionFromExtension`. | Function removed |
| `extensionSelectors.test.mjs` | **Remove** — tests extension selector contracts. | Extension deleted |
| `extensionIngestEndpoint.test.mjs` | **Remove** — tests `/api/extension/ingest` endpoint. | Endpoint removed |
| `extensionIngest.test.mjs` | **Remove** — tests extension frame ingestion logic. | Function removed |
| `extensionBoundary.test.mjs` | **Remove** — tests extension boundary contracts. | Extension deleted |
| `backgroundServerStatus.test.mjs` | **Remove** (if exists — UNVERIFIED: not found in glob, may be named differently or may not exist) | Extension deleted |

The studio-side tests (`browserStudio.test.mjs`, `browserStudio.login.test.mjs`, `captureVenue.test.mjs`, `captureProfiles.test.mjs`, `packObservers.test.mjs`, `sessionCaptureSettings.test.mjs`) remain green as-is — they test the studio capture leg and the observer, which are unchanged.

#### C6. `sourceLeg` cleanup

After Phase C, `headlessSessionStatus()` (`captureProfiles.mjs:447-481`) reports `sourceLeg: "studio"` for EO (the only capture leg). The `"extension"` sourceLeg is never produced. The UI that displays `sourceLeg` (if any — UNVERIFIED: did not grep for sourceLeg rendering in the frontend) can optionally simplify to show nothing or "studio" only.

---

## Non-goals

- **No new server endpoint.** The studio page uses existing `/api/browser/*` routes. No new API surface.
- **No new Chromium process management.** The studio reuses the existing `openStudio`/`closeStudio` lifecycle.
- **No per-suite browser isolation.** There is ONE browser for all suites (REQ-4). Per-suite browser sessions are explicitly not in scope.
- **No extension functionality replacement.** The extension's frame-ingestion relay (`/api/extension/ingest` → `liveEO.mjs` broker data) is removed in Phase C without replacement. The studio's CDP-based intelligence feed (console/network/DOM/WS at `browserStudio.mjs:664-984`) replaces the extension's passive relay. If the user wants real-browser frame data after Phase C, the studio is the only path.
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
- **What:** Add an entry for this spec: `PICC_EMBEDDED_BROWSER_STUDIO_v1` — `docs/specs/PICC_EMBEDDED_BROWSER_STUDIO_v1.md`, status PROPOSED, date 2026-09-15, scope "embedded studio surface + studio-owned capture + extension removal". Flip status to IMPLEMENTED when the full three-phase sequence lands.
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

#### C-4. Remove `captureSessionFromExtension`
- **Files:** `apps/dashboard/server/services/captureProfiles.mjs`
- **What:** Remove `captureSessionFromExtension` (`:604`), `captureSessionFromExtensionCore` (`:616`), and `sanitizeExtensionAccount`, plus the `sourceLeg: "extension"` finalize path at `:680`. Remove the exports.
- **Acceptance:** `grep -r "captureSessionFromExtension" apps/dashboard/` returns zero hits.

#### C-5. Clean up `useExternalLinkRouter`
- **Files:** `src/components/AppShell.tsx`
- **What:** The `useExternalLinkRouter` hook at `AppShell.tsx:18-47` currently reroutes `_blank` links into the in-app browser via `openBrowser()`/`browserTab()`. With the studio as the central surface, this behavior is still correct — external links should open in the studio. No change needed, but verify the behavior is preserved after the extension removal.
- **Acceptance:** Clicking a `_blank` link in the dashboard still opens it in the studio browser.

#### C-6. Verify full observation cycle
- **Files:** None (verification task)
- **What:** With the extension removed and the studio running: (a) verify `headlessSessionStatus()` shows `sourceLeg: "studio"` for EO, (b) verify pack P1-1 is `running`, (c) verify `observeEoCapture` with `captureEnabled: null` (the new default) produces the correct observation, (d) verify the kill-switch still works.
- **Acceptance:** All observation paths work without the extension.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Studio browser crash / OOM kills the capture leg.** | P1-1 goes to `no-tab` or `error`; token goes stale; liveEO disconnects. | The studio already handles Chromium death (`browserStudio.mjs:1483-1486` — `context.on("close")` calls `resetStudioAfterDeath`). The scheduler retries every 60s. The pack step shows honest `no-tab` status. |
| **EO tab cookie expiry without user re-login.** | Token expires; `refreshTabLogin` detects degraded `expired` kind; P1-1 goes to `stopped-at-human`. | This is the EXISTING behavior — the human re-logs in the studio (now the central surface) and acks the pack step. The pathway prompt directs them to the studio. |
| **Extension removal breaks frame-ingestion relay.** | `liveEO.mjs` loses the extension's broker frame relay; realtime EO data stops. | The studio's CDP intelligence feed (`network` intel at `:806-818`) captures the same WS frames the extension relayed. The liveEO module already has a studio-side path. Verify this works in Phase C-6. |
| **Test migration misses a hidden extension dependency.** | Test suite fails after Phase C. | Run `npm test` after each Phase C task. Grep for `extension`, `picc-overlay`, `chrome.storage`, `chrome.runtime` in test files. |
| **ADR-0001 compliance regression.** | Capture auto-resumes a stopped-at-human step. | The legal map (`packRegistry.mjs:31-37`) is the guard — `stopped-at-human` can ONLY transition to itself. `coerceObservationForStoppedStep` is tested (`packObservers.test.mjs`). No code change touches the legal map or the coercion logic. |
| **`isLocalhostRequest` guard removal exposes localhost-only routes.** | External clients hit extension routes. | Phase C removes the routes entirely, not just the guard. No orphan routes remain. |

---

## Honesty notes

- **Demo/live gates touched:** Phase B-1 is a manual verification gate — the human must log in to EO in the studio and verify the capture leg works. This is recorded as human observation, not CI assertion. Phase C-6 is another manual gate — verify the full cycle after extension removal.
- **Fabricated-state risks:** None. The studio capture leg (`captureExpertOptionSession`) reads REAL cookies/storage from a REAL Chromium tab. The token value is never invented. The `guest` detection (`:3627-3644`) reads DOM signals honestly. The observer (`packObservers.mjs`) never fabricates a `running` status — it maps real seam outputs.
- **ADR-0001 precision:** The kill-switch AND-semantics collapse to a single switch when the extension is removed. This is an honest simplification, not a weakening: the unobserved extension toggle is default-ON (null ≠ false), so the PICC settings toggle becomes the sole gate. The spec explicitly documents this collapse.

---

## Open questions for owner approval

1. **Studio page layout:** Should the studio page fill the ENTIRE content area (no padding/margins — the screencast viewport should be as large as possible), or should it have the standard `stack stack-lg` padding that other pages use? The screencast viewport is already constrained to the browser's viewport dimensions (`DEFAULT_VIEWPORT: { width: 1440, height: 900 }` at `browserStudio.mjs:30`), so full-bleed makes visual sense.
2. **Feature gate default:** Should `"studio"` be default-ON for all users, or should it require an explicit opt-in (like `"opportunities"` which is feature-gated)? The owner's requirement says "the PICC browser becomes a separate outer-sidebar navlink" — this implies default-ON.
3. **Extension removal timing:** Should Phase C land in the same PR as Phase A+B, or in a separate follow-up PR after manual verification of Phase B? The owner's requirement says "remove the extension" but also says "only after the embed is proven." A separate PR is safer.
4. **`captureSessionFromExtension` removal:** Option B (full removal) is cleanest but removes a pure function that could serve as a reference implementation. Option A (dead code) preserves it. Which does the owner prefer?
