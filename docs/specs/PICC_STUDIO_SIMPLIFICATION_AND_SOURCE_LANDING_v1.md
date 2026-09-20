# PICC Studio Simplification + Free-Source Landing — Plan v1

**Status:** PLAN — awaiting owner approval (review in plan canvas). · **Resolution:** COMPLETE — executed as part of the D1 clean break: viewport slideshow + unwanted studio settings removed, extension language purged end-to-end, studio slimmed to a subtle manager of streaming + suite linking (`6536176`); suite regime/fusion/execution gates + paper/real separation alongside (`bf99e09`); spec annotation `6046b63`. The "awaiting approval" PLAN status is superseded by execution. (**Date:** 2026-09-19)
**Date:** 2026-09-16
**Owner directive (verbatim intent):** keep the browser studio simplified and optimized; remove the viewport slideshow and unwanted studio settings (fullscreen toggle); make the studio a subtle manager of streaming + suite linking; every setting has clean, clear separation — no setting overlap unless explicitly requested; proceed with planning everything unverified, with suggestions.

**Grounding rule (PICC convention):** every `file:line` below was read this session or is marked **UNVERIFIED**.

---

## Part A — Studio simplification

### A.1 Goal

`StudioPage` stops being a live-browser picture frame and becomes a subtle **stream manager** (tabs, address, nav, live status) plus **suite-linking surface**. The viewport slideshow and the fullscreen toggle (which reached into server settings) are removed. **The studio UI must never write to any server setting** — settings are owned by Settings.tsx (perfMode) and the session-capture kill-switch settings surface; nothing else touches them.

### A.2 Scope

**In scope**
- Remove the viewport slideshow: rAF painter effect (`StudioPage.tsx:123-137`), `frameRef`/`frameImgRef`/`framePaintedRef`, `frameVisible` state, the `<img data-testid="studio-frame">` (`:318-323`), the `.studio-viewport` container + placeholders (`:315-336`), click→normalized-coords forwarding (`:230-248`, uses `computeContainedRect`), wheel isolation (`:209-228`), `WHEEL_THROTTLE_MS` (`:35`), `viewportRef`.
- Remove the fullscreen toggle: `fullscreen` state (`:47`), `enterFullscreen`/`exitFullscreen` (`:172-189`) — **these mutate `perfMode` via `saveBrowserSettings` (setting overlap, now banned)** —, Esc handler (`:196-201`), unmount-restore effect (`:203-205`), `savedPerfRef`, the `studio-fullscreen` button (`:306`) and class (`:261`).
- Keep: auto-open on mount (`:66-71`), SSE stream subscription for **data events only** (`status|tabs|assist|error`; frame events ignored), tab bar (switch/close/new), address bar + Go, back/forward/reload, open/close, status footer (site/vault/browser state, `:338-346`).
- Add (subtle): a "live" indicator fed by the stream (subscriber/last-heartbeat, honest — derived from observed `status` events only), and a current-suite chip linking back to the suite home when an `assist` event carries `suite` (suite-linking feature).
- CSS prune: viewport/letterbox/fullscreen rules in `src/index.css` (only those left unreferenced after removal).
- Tests: remove the 8 viewport/fullscreen tests (`StudioPage.test.tsx:126-423` subsets), keep data-plane tests, add contract tests: no fullscreen button, no `studio-frame` element, and **`saveBrowserSettings` never called** (assert via mock).

**Out of scope**
- Server streaming pipeline: unchanged. The frame pump stays subscriber-driven (`browserStudio.mjs:1243`, `:1403`); stream data events remain. PerfMode stays a Settings.tsx-only concern.
- Ministry/`useExternalLinkRouter` behavior (external links still open the shared browser) — unchanged.
- Phase C extension removal (EXECUTED 2026-09-17 via the D1 clean break — nothing left to remove), capture/rearm, ADR-0001 handling — untouched by this plan.

### A.3 Acceptance criteria

| ID | Criterion (observable) | Verification |
|----|------------------------|--------------|
| A-AC1 | Mounting StudioPage renders tab bar, address bar, nav controls, open/close, status footer; **no** `studio-frame` img, **no** `studio-fullscreen` button, **no** `.studio-viewport` element. | jsdom test: `querySelector("[data-testid='studio-frame']")` → null; `studio-fullscreen` → null; commit-cadence Profiler test dropped with the viewport. |
| A-AC2 | The studio never writes settings: after mount, stream events, tab actions, and unmount, `saveBrowserSettings` is **never** called (fullscreen path removed = the only caller is gone). | jsdom test asserting mock call count 0 across the lifecycle. |
| A-AC3 | Data-plane streaming still live: `status`/`tabs`/`assist` events update footer/tab bar/site/vault as today; `frame` events are received and ignored (no state commit from them). | jsdom: push a frame event → no commit (Profiler) / no DOM change; push status/tabs → updates apply. |
| A-AC4 | Suite linking: an `assist` event with `suite` renders a "back to <suite>" chip that navigates to the suite home; absent `suite` → no chip. | jsdom test asserting chip presence/absence and navigation target. |
| A-AC5 | `src/index.css` contains no rules referencing removed classes (`studio-viewport`, `studio-placeholder`, `studio-fullscreen`, letterbox helpers) unless still used elsewhere. | grep + `npm test` green. |
| A-AC6 | Suite entrypoints intact: `/suites/trading/studio` (and earnings/intelligence) still mount the shared studio. | **UNVERIFIED** — confirm prior-slice MinistryShell wiring exists (gate: grep `MinistryShell.tsx` for `studio`); extend with a route smoke test if absent. |

### A.4 Suggested sequence

1. `StudioPage.tsx` edit (remove painter/frame/fullscreen; add live chip + suite chip).
2. `StudioPage.test.tsx` rewrite (drop 8 tests, add A-AC1..4).
3. `index.css` prune; grep for orphans.
4. Verify: `npx vitest run src/pages/__tests__/StudioPage.test.tsx` narrow, then full suite + typecheck.

---

## Part B — Free-source landing (everything unverified, with suggestions)

Filters applied: (1) **keyless** sources only for auto-landing (per research + catalog "verified:false until a live probe succeeds"), (2) key-gated sources → operator-config pattern (honest unconfigured default), (3) sources with **no consuming suite** → catalog note only, never wired.

### B.1 Keyless + already wired (no action)

| Source | Seam | Evidence |
|--------|------|----------|
| DefiLlama yields/TVL | `connectors.mjs:683`, `opportunities.mjs:43` | `verified: true` (session read) |
| Yahoo Finance RSS, Seeking Alpha, Fed press | `VERIFIED_FREE_FEEDS` (`newsDigest.mjs:32-48`) | Live-probed 200+RSS this session |
| OANDA demo venue | `SITE_INDEX` (`browserStudio.mjs:502`) | Registered + test this session |
| Binance/Kraken/OKX/Coinbase WS, CoinGecko | existing crypto connectors | Research-verified; no change |

### B.2 Keyless + proven, not yet wired — RECOMMENDED LANDING

| Candidate | Seam target | Probe gate | Suggestion |
|-----------|-------------|------------|------------|
| **Nasdaq earnings JSON** (`api.nasdaq.com/api/calendar/earnings`) | New `earningsCalendar.mjs` service behind the earnings suite | Live probe returns 200 + valid JSON (research saw 17 entries, 2026-09-15) | **Wire next**: keyless, proven, directly feeds the earnings suite's calendar. Honest contract: probe failure → empty row + source-kind recorded, never fabricated dates. |
| **Fed speeches + testimony RSS** (`feeds/speeches.xml`, `feeds/testimony.xml`) | `VERIFIED_FREE_FEEDS` (same family as fed-press) | Live probe 200 + real RSS (monetary_policy.xml already 404s — excluded, comment at `newsDigest.mjs:46-47`) | Probe both; register whichever returns 200+RSS; keep the 404 note honest. |

### B.3 Keyless + needs a probe before any decision

| Candidate | Fit | Risk | Suggestion |
|-----------|-----|------|------------|
| **StockTwits** (public API v2 trending/sentiment, 200 req/hr unauth) | Intelligence suite social signal | Dev registration closed; scraping ToS grey zone | Probe `api.stocktwits.com` public endpoints **before** any wiring. If probe clean → plan an intelligence-suite social panel as a SEPARATE slice; do not land in this round. |
| **Forex Factory economic calendar** (HTML/JSON embed) | Intelligence suite calendar | Cloudflare block risk | Probe with the PICC webfetch capability. If blocked → record the observed gate, leave unconfigured (honest). No key, so no operator burden — but no bypass either. |

### B.4 Key-gated — operator-key pattern, NOT wired by default

Twelve Data, Finnhub, Alpha Vantage, FRED (all require a free API key). Suggestion: **do not add seams now**. When an operator wants one, it gets a config-key seam exactly like `PICC_NEWS_FEEDS` (empty default → honest unconfigured state). No keys, no accounts, no secrets enter the repo.

### B.5 No consuming suite — catalog note only

**Slickdeals RSS** (retail intel): the bandwidth/retail suite is rejected (ADR-0002). Suggestion: record in the catalog spec as a candidate for a future retail suite; **do not wire** into `newsDigest` (category mismatch — the digest is market/trading/economic news). Same for CamelCamelCamel/Keepa/Parse Bot.

### B.6 Suggested sequence

1. Probe Fed speeches + testimony (30 min, zero code).
2. Land Nasdaq earnings JSON service + probe-gated registry + earnings-suite surface (test-first, honest empties).
3. Probe StockTwits + Forex Factory; record results in the catalog spec §4 regardless of outcome.
4. Re-verify: full suite + typecheck after each landing.

---

## Part C — Settings separation contract (applies to both parts)

- **perfMode**: owned by Settings.tsx only. Studio UI never reads or writes it. (Fullscreen's raise/restore was the overlap — removed in A.)
- **Session-capture kill-switch**: owned by Settings.tsx + ADR-0001 AND-semantics. Untouched.
- **Feed/venue registries**: server-owned static data; the studio is read-only over `/api/browser/*`.
- Rule: a UI surface may only write the setting whose section it renders. **No cross-surface writes unless the owner explicitly requests them.** Enforced by test (A-AC2 pattern).

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Streaming consumers of frame events exist beyond the studio — **premise MOOT since the D1 clean break (2026-09-17)**: the extension (the only non-studio frame consumer) was removed | Removing the client viewport must not kill the server pump for other consumers | Server untouched; pump stays subscriber-driven. Verify with `browserStudio.automation/goto/touch` tests (frame plane tests remain server-side). |
| Committing a common popup/positioning nav pins StudioPage's old frame-plane test count on the suite page | Suite pages that embed StudioPage lose the viewport | Sweep tests referencing `studio-frame`/`studio-fullscreen`; grep after removal. |
| Nasdaq probe returns 429/JS-gated on the day of landing | Service must not hardcode "works" | Probe-gate: on failure, register empty honestly (`verified:false`), retry later. |

## Open questions (non-blocking)

1. Should the suite chip (A.2) link to the suite **home** or to the suite's own **studio room** (`/suites/<id>/studio`)? Default suggestion: suite home.
2. After the viewport removal, should the **top-level** `/studio` outer-rail entry stay (recommended: yes — subtle manager page), or be reduced to suite rooms only?