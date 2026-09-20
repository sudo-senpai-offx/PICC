# PICC Extension & Selenium IDE Research — Findings v1

Status: FINDINGS (aggregated analysis for suite improvement) · **Resolution:** RESEARCH-ARCHIVE — static research record on four third-party MV3 extensions/Selenium IDE; consumed by the extension connectivity engine (now superseded by D1 clean-break) and the headless-capture engine (studio-evolved); no successor to the findings themselves (**Date:** 2026-09-19)
Sources (all extracted under `C:\Users\sharv\AppData\Local\Temp\opencode\re\` — kept outside the repo):
- `selenium-ide/` — Selenium IDE 4.0.1-beta.14 source (pnpm monorepo, 21 packages)
- `ext-a/` — Requestly v26.7.27 (MV3)
- `ext-b/` — Postman Interceptor v3.2.1 (MV3)
- `ext-c/` — Simple WebSocket Client v0.3.14 (MV3)

Everything below is observed from files on disk (manifests, package layout, source maps).

---

## 1. Why these four

They cover the four integration shapes PICC's suite needs:

1. **Selenium IDE** — record/replay of browser flows → template for our own walkthrough/capture engine (already specced: `PICC_HEADLESS_CAPTURE_ENGINE.md`).
2. **Requestly** — a full MV3 request-modification runtime (DNR static rules + webRequest + proxy + side panel). Reference for client-side network testing and for the "network recording" concept in our extension connectivity engine (`EXTENSION_CONNECTIVITY_ENGINE.md`).
3. **Postman Interceptor** — nativeMessaging bridge from browser to a desktop app. Exactly the shape needed if PICC's browser layer must talk to a local daemon (broker adapters, MT5 bridge).
4. **Simple WebSocket Client** — bare-bones MV3 service-worker WebSocket client. Reference for real-time quote/feed connections from an extension context.

---

## 2. Selenium IDE 4.0.1-beta.14 — monorepo analysis

### 2.1 Package layout (observed)

```
packages/
  browser-info            — browser capability detection
  code-export-*           — 7 exporters: csharp (commons/nunit/xunit), java-junit,
                            javascript-mocha, python-pytest, ruby-rspec
  get-driver              — webdriver binary resolution
  selenium-ide            — the IDE app itself
  side-api                — API layer over project files
  side-cli                — CLI runner
  side-code-export        — codegen core (consumes exporters above)
  side-commons            — shared utilities
  side-example-suite      — example side project
  side-migrate            — legacy format migration (Selenese → .side)
  side-model              — the .side project/command model (canonical)
  side-runner             — headless runner for .side files
  side-runtime            — runtime engine executing commands
  side-testkit            — test scaffolding
  webdriver-testkit       — webdriver helpers
scripts/  tests/  docs/
```

### 2.2 What it proves

- The `.side` format is a **serializable command model** (side-model) shared by IDE, CLI, and runtime — one model, many surfaces. PICC's capture engine should adopt the same principle: one recorded-flow model, replayable in-browser (IDE) and headless (runner), and exportable to code (exporters).
- Exporters are **per-language plugins** (csharp-nunit vs csharp-xunit vs java-junit...). A shared codegen core (`side-code-export`) consumes them — clean seam for adding new targets (e.g., our own Playwright exporter).
- `side-runner` + `side-cli` give a headless path — the basis for CI-replayable flows, which our `PICC_HEADLESS_CAPTURE_ENGINE.md` and browser-qa skill both assume.

### 2.3 Borrow list

1. **.side model ≈ our recorded-flow schema** — commands with args + target, locator strategy, non-breaking superset semantics. Check `side-model` for the command catalog we can map onto our capture engine's flow format.
2. **side-code-export plugin seam** — per-language exporter registration. We already have a code-export concept for capture→Playwright; mirror this seam.
3. **side-migrate** — versioned migration path for recorded flows. Adopt versioned flow files from day one.

### 2.4 Caveat

This is beta-14 source; the repo's own `docs/` (on disk) is the authoritative reference if deeper borrowing is needed. No code was executed — analysis is static.

---

## 3. Requestly v26.7.27 (ext-a) — MV3 request toolkit

### 3.1 Observed surface

- **Manifest:** MV3, service worker `serviceWorker.js`, perms `browsingData, contextMenus, declarativeNetRequest, proxy, scripting, sidePanel, storage, tabs, unlimitedStorage, webNavigation, webRequest`; `host_permissions: <all_urls>`.
- **DNR static rules:** `delay_rules.json` (request delay) + `header_rules.json` (header modification) preloaded.
- **Side panel:** `sidepanel/network-recording/index.html` — network recording lives in the side panel.
- Full request-modification feature set implied: proxy routing, header rules, delay, modify/block, session replay.

### 3.2 Why it matters to PICC

- It's the **reference implementation of a modern MV3 request-modification engine** — DNR-static for common rules (fast, declarative) + dynamic rules/webRequest/proxy for advanced cases. That two-tier split (declarative when possible, imperative when needed) is the correct MV3 architecture for our own `EXTENSION_CONNECTIVITY_ENGINE.md` ambitions.
- **Network recording in a side panel** — exactly the UX our capture/QA tooling would want when recording broker/exchange traffic from the browser.
- `unlimitedStorage` + session data handling shows how a heavy recorder keeps history under quota.

### 3.3 Borrow list

1. Tiered rule engine: DNR-static for hot paths + dynamic `chrome.declarativeNetRequest.updateDynamicRules` for user rules + `webRequest` for observe-only (recording). Never mix observe and modify in one path.
2. Network-recording side panel pattern.
3. `unlimitedStorage` + rollover strategy for long recording sessions.

---

## 4. Postman Interceptor v3.2.1 (ext-b) — nativeMessaging bridge

### 4.1 Observed surface

- **Manifest:** MV3, module service worker `background/background.js`, perms `webRequest, nativeMessaging, storage, cookies, scripting, tabs`. No host_permissions declared (intercept driven by the companion app + user-config).
- It's the browser half of Postman's desktop interceptor: cookies + traffic captured in-browser, shipped to the Postman desktop app over `chrome.runtime.connectNative`.

### 4.2 Why it matters to PICC

This is the **canonical pattern for browser ↔ local-desktop-daemon communication**: the browser extension collects (webRequest observations, cookie jar), the native host receives, the desktop app owns state. PICC's suite already has a local-server posture (dashboard server on localhost); an extension could forward browser-side broker/session traffic to it the same way. The nativeMessaging permission + a registered native host manifest is the whole architecture.

### 4.3 Borrow list

1. NativeMessaging bridge pattern (extension → native host → desktop app) for any browser-captured broker/exchange data we want in the suite.
2. Cookie capture via `cookies.getAll` with domain filtering + transport over native messages (respecting the browser's security model — do NOT attempt to read cookies cross-origin outside the API).

### 4.4 Caveat

Only the browser half is present (3 MB). The native host is in the Postman desktop app — not analyzable here. The manifest + service worker structure is the reusable part.

---

## 5. Simple WebSocket Client v0.3.14 (ext-c) — minimal feed client

### 5.1 Observed surface

- **Manifest:** MV3, module service worker `background.js`, **no permissions, no host_permissions** — a WS client with zero-privilege surface.
- Represents the minimum viable MV3 WebSocket client (connect from the service worker, send/receive, log).

### 5.2 Why it matters to PICC

- Shows the **smallest possible real-time feed shim**: a service-worker WebSocket with no permissions. For PICC this is the baseline for extension-side quote feeds (crypto exchanges' public WS) without touching broker creds.
- MV3 service workers can hold a WS connection while active; long-lived sessions need keepalive/heartbeat handling (SW lifecycle) — the valuable lesson, since MV3 SWs are evictable.

### 5.3 Borrow list

1. Zero-permission WS client shape for public-market feeds (exchanges, indices) in extension contexts.
2. SW-lifecycle-aware reconnect/heartbeat design for long-lived feeds.

---

## 6. Cross-cutting conclusions for PICC

1. **One model, many surfaces** (Selenium IDE) — record once, replay in IDE/CLI/headless, export to code. Adopt for capture engine.
2. **Tiered MV3 rule engine** (Requestly) — DNR-static + dynamic + webRequest-observe. Adopt for extension connectivity engine.
3. **NativeMessaging to local daemon** (Postman Interceptor) — the bridge for browser→suite data shipping. Adopt where a local daemon owns state.
4. **Minimal feed client** (SimpleWS) — the baseline for live quotes in extension context.
5. All four are **static analyses** — nothing was executed. Any claim here is about file structure, not runtime behavior.

## 7. Artifact access

- `C:\Users\sharv\AppData\Local\Temp\opencode\re\selenium-ide\selenium-ide-4.0.1-beta.14\`
- `C:\Users\sharv\AppData\Local\Temp\opencode\re\ext-a\` (Requestly) / `ext-b\` (Postman Interceptor) / `ext-c\` (SimpleWS)
- Keep outside the repo; do not commit extension payloads or the Selenium source tree.

---

## Resolution (2026-09-19)

**Disposition: RESEARCH-ARCHIVE (COMPLETE-as-research)** — a static findings record (Selenium IDE 4.0.1-beta.14, Requestly 26.7.27, Postman Interceptor 3.2.1, Simple WebSocket Client v0.3.14), created in `ed81b5f`. Nothing in the repo supersedes the analysis itself; no task boxes, no implementation claims to verify.

**Consumption record (evidence):** the borrow list fed `EXTENSION_CONNECTIVITY_ENGINE.md` (DNR-static tiering, nativeMessaging-to-local-daemon shape, minimal WS feed client) and the capture-engine direction (`PICC_HEADLESS_CAPTURE_ENGINE.md`). Post-D1 those downstream plans were replaced by the studio-capture model (`PICC_EMBEDDED_BROWSER_STUDIO_v1.md`); the findings themselves remain the accurate record of what those four artifacts contained (source trees kept outside the repo at `C:\Users\sharv\AppData\Local\Temp\opencode\re\`). The A-7 spec sweep classified this file EXEMPT as research (`PICC_EXTENSION_ERADICATION_AND_SUITES_REBUILD_v1.md:102`).