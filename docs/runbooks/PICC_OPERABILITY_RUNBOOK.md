# PICC Operability — Runbook

**Status:** living doc (WS-5 operability surfaces)
**Date:** 2026-09-24
**Author:** PICC WS-5 executor
**Purpose:** operator instructions for startup credential health, ExpertOption rotation, cross-tab
action locks, the isolated Playwright harness, the trading-suite surface map, and current venue
status. Code is authoritative when this runbook and an implementation disagree.

---

## 1. Startup health readout

### 1.1 Read the endpoint

The readout is auth-gated at:

```text
GET /api/command-centre/startup-health
```

With the Vite development server running on its strict port, use:

```powershell
Invoke-RestMethod -Uri "http://localhost:5173/api/command-centre/startup-health" | ConvertTo-Json -Depth 6
```

The standalone server uses port `3000` by default:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/command-centre/startup-health" | ConvertTo-Json -Depth 6
```

A localhost request passes the handler's local-request auth path. A remote request needs the
operator's existing authenticated `Authorization` header. Do not paste a session token into chat or
shell history.

The response field set is:

```text
{
  ok: boolean,
  at: ISO-8601 string,
  checks: [
    {
      id: string,
      severity: "ok" | "warning" | "error",
      deny: string | null,
      detail: string
    }
  ],
  generatedAt: ISO-8601 string
}
```

The current implementation evaluates once per server process and memoizes that result. Both
timestamps come from the same boot evaluation. Restart the dashboard after changing credentials or
environment configuration, then read the endpoint again.

### 1.2 Severity model

- `ok`: the check found no condition that needs operator action.
- `warning`: the readout found an unconfigured, incomplete, unverified, or otherwise degraded state.
  A warning can carry a named `deny`, but it does not change top-level `ok`.
- `error`: the readout found a condition that makes `ok:false`.

`ok:false` occurs if and only if at least one of the four checks has severity `error`. Warnings alone
leave `ok:true`.

### 1.3 The four checks

| ID | What it reads | Operator interpretation |
|---|---|---|
| `credential-stores` | `trading-credentials.json` under `PICC_TRADING_DATA_DIR` and `venue-credentials.json` under `PICC_AUTOMATOR_DATA_DIR` | A present store that cannot decrypt is an `error`. A missing store is a `warning` with `deny:null`. |
| `expertoption-expiry` | `expertoptionToken` and `expertoptionTokenCapturedAt` from the trading credential store | It never returns the token. When it mentions a configured token, it masks the value as `****`. |
| `ccxt-pair-completeness` | `PICC_CCXT_*` credential environment variables for keyed exchanges | A half-set API-key pair or wallet pair is a `warning`. A fully configured pair is `ok`. With no keyed exchange at all, the readout reports the existing Hyperliquid no-credentials refusal. |
| `perps-rail-mode` | `PICC_CCXT_SANDBOX_HYPERLIQUID`, `PICC_CCXT_SANDBOX`, and `PICC_CCXT_PERPS_MAINNET_ENABLED` | A sandbox flag is `ok`. With sandbox off, a mainnet request set to `1` is also reported `ok`, with a detail that ceremony authorization remains required. With both sandbox flags off and the mainnet request absent, the readout returns the existing `perps-rail-off` refusal as a `warning`. |

A `perps-rail-mode` result of `ok` is an environment-level readout, not proof of execution
authorization. The Hyperliquid adapter still checks the ceremony unlock before a mainnet instance
can proceed.

### 1.4 Exact startup deny strings

The following are the complete deny forms emitted by `startupHealth.mjs`. Dynamic source templates
are reproduced exactly; runtime values replace the JavaScript expressions in parentheses.

Present credential store that cannot decrypt, `error`:

```text
suite:deny:credential-store-unreadable (trading-credentials.json)
suite:deny:credential-store-unreadable (venue-credentials.json)
```

Configured ExpertOption token without a usable capture timestamp, `warning`:

```text
suite:deny:credential-capture-date-missing (expertoption, rotation record absent — re-capture to record it)
```

Expired ExpertOption token, `error`, source template:

```text
suite:deny:credential-expired (expertoption, age ${ageDays} days exceeds ${ttl.days})
```

No keyed CCXT exchange at all, `warning`:

```text
ccxt ordering seam: no HYPERLIQUID credentials configured — set either PICC_CCXT_APIKEY_HYPERLIQUID + PICC_CCXT_SECRET_HYPERLIQUID (CEX-style) or PICC_CCXT_WALLETADDRESS_HYPERLIQUID + PICC_CCXT_PRIVATEKEY_HYPERLIQUID (Hyperliquid-style) — the execution leg is inoperable without them
```

Half-set CCXT pair, `warning`, source template:

```text
suite:deny:credential-pair-incomplete (${first.suffix}: ${first.missing})
```

The first incomplete pair is returned in `deny`; `detail` lists every incomplete pair. The possible
missing variable is `PICC_CCXT_SECRET_<EX>` after a lone API key or
`PICC_CCXT_PRIVATEKEY_<EX>` after a lone wallet address.

Both perps flags off, `warning`:

```text
perps-rail-off: testnet not enabled (set PICC_CCXT_SANDBOX_HYPERLIQUID=1 or PICC_CCXT_SANDBOX=1) and mainnet not enabled (PICC_CCXT_PERPS_MAINNET_ENABLED absent)
```

### 1.5 Authority boundary

The startup readout is advisory and read-only with respect to credentials and execution. It reads
credential stores and environment values, then appends one `audit:startup-health` row. It enforces
nothing and does not block a proposal or execution.

The execution rails remain authoritative:

- `apps/dashboard/server/services/liveEO.mjs:685-699` still opens an ExpertOption session only when
  it can obtain a token.
- `apps/dashboard/server/services/ccxtOrdering.mjs:157` still refuses an order instance without a
  complete CCXT credential pair.

WS-5 did not change those call-time paths. Their behavior remains byte-identical.

---

## 2. Credentials, rotation, and expiry

### 2.1 Rotation record

`expertoptionTokenCapturedAt` is the ExpertOption rotation record. The existing credential save path
sets it to a new ISO timestamp whenever a nonblank replacement token is saved
(`apps/dashboard/server/services/trading.mjs:157-173`). Do not hand-edit this field.

Rotation is the existing re-capture or token-save flow. A successful nonblank token save replaces
the capture timestamp. Restart the server after the save because the startup readout is memoized for
the life of the process.

### 2.2 TTL behavior

The documented policy value is 30 days. The current runtime source of truth is:

```text
PICC_CRED_EXPIRY_DAYS_EXPERTOPTION
```

Code-truth behavior:

- A positive numeric value sets the TTL in days.
- An expired token produces `error` only when its whole-day age is greater than the configured TTL.
- If the variable is absent or blank, the expiry check is skipped. It returns a `warning` with
  `deny:null`; it does not invent an expiry denial.
- If the variable is nonnumeric or nonpositive, the check is also skipped with a `warning` and
  `deny:null`.
- With no configured ExpertOption token, there is no expiry denial.

The ratified spec and `.env.example` call `30` the default. The current `startupHealth.mjs` has no
runtime fallback to `30`; the variable must be present for the comparison to run. Operators should
set `PICC_CRED_EXPIRY_DAYS_EXPERTOPTION=30` in `apps/dashboard/.env` when they want the documented
30-day policy.

### 2.3 Incident actions

| Readout | Action |
|---|---|
| `suite:deny:credential-store-unreadable (...)` | Repair or re-create the named vault-backed store through the normal credential flow. Do not bypass the vault. |
| `suite:deny:credential-capture-date-missing (...)` | Re-capture or re-save the ExpertOption token so the server records a new timestamp. |
| `suite:deny:credential-expired (...)` | Re-capture or re-save the ExpertOption token, restart the server, and confirm the new check. |
| Expiry check skipped because the TTL variable is absent or invalid | Set a positive TTL, restart, and read the endpoint again. |
| Half-set CCXT pair | Add the missing half or remove the orphaned half. Do not guess which credential the venue expects. |

An execute-time expiry denial is out of scope. Adding one would change the WS-2 execution rail and
requires a separate owner decision.

---

## 3. Cross-tab lock semantics

### 3.1 Lock contract

`withActionLock(name, fn)` in
`apps/dashboard/src/lib/dangerousActionLock.ts` wraps a dangerous asynchronous action in the Web
Locks API:

```text
picc:action:<name>
```

The request timeout is `8_000` milliseconds. After acquisition, the wrapper runs `fn`; the platform
releases the lock when the callback settles. The platform also releases the lock when the holder tab
closes or crashes.

The current call sites use these names:

- `kill-switch`
- `command-centre-execute`
- `autopilot-config`

A missing `navigator.locks` implementation throws a named deny. It never calls `fn` and never falls
back to a `storage` event or another lock scheme.

### 3.2 Exact lock deny strings

Web Locks unavailable:

```text
suite:deny:lock-unavailable
```

Eight-second timeout, source template:

```text
suite:deny:lock-held (another tab holds the ${name} lock — wait or close the other tab)
```

For the kill-switch action, that resolves to:

```text
suite:deny:lock-held (another tab holds the kill-switch lock — wait or close the other tab)
```

The dash in the held message is the same em dash (`—`, U+2014) used by the implementation.

### 3.3 AC-4c manual two-tab matrix

Use two real tabs on the same dashboard origin. Do not use a unit-test stub.

| Step | Action | Expected observation |
|---|---|---|
| 1 | Open the trading Command Centre route in two real tabs. | Both tabs load the same-origin dashboard. |
| 2 | Start a kill-switch update in tab A and keep its request in flight. | Tab A holds `picc:action:kill-switch`. |
| 3 | Toggle the kill switch in tab B before tab A's callback settles. | After the eight-second timeout, tab B shows `suite:deny:lock-held (another tab holds the kill-switch lock — wait or close the other tab)`. No second POST reaches the server. |
| 4 | Close tab A. | The browser platform releases the held lock. |
| 5 | Retry the toggle in tab B. | The retry succeeds and the readout refreshes. |

The lock narrows a client race. Server gates, idempotency, and audit controls remain authoritative.

---

## 4. E2E harness

### 4.1 Prerequisites and run command

Install the Playwright-managed Chromium binary once:

```bash
npx playwright install chromium
```

From the repository root, run the workspace script:

```bash
npm run test:e2e --workspace @picc/dashboard
```

The Playwright config uses `testDir: "e2e/"`, `workers: 1`, and
`baseURL: "http://localhost:5173"`. It starts `npm run dev` with `reuseExistingServer: false`. The
Vite process serves the SPA and API together on strict port `5173`.

### 4.2 Per-run isolation root

Each config load mints a fresh root under:

```text
apps/dashboard/.playwright-tmp/<hash>
```

`<hash>` is the first 20 hexadecimal characters of a SHA-256 digest over the process ID, current
millisecond timestamp, and 24 random bytes. The root and created directories use mode `0700` where
the platform supports it. The helper does not delete the root after the run; retain it for test
artifacts or remove that exact hashed directory after inspection.

### 4.3 Full 20-variable contract

The isolation map is exactly 18 path variables plus two scalar variables. The order below matches
`ISOLATION_PATH_VARIABLES` and the environment map in
`apps/dashboard/e2e/helpers/isolatedEnv.mjs`.

| # | Variable | Isolated value |
|---:|---|---|
| 1 | `PICC_TRADING_DATA_DIR` | `<root>/trading` |
| 2 | `PICC_AUTOMATOR_DATA_DIR` | `<root>/automator` |
| 3 | `PICC_COMMAND_CENTRE_DATA_DIR` | `<root>/command-centre` |
| 4 | `PICC_AUTH_DATA_DIR` | `<root>/auth` |
| 5 | `PICC_BROWSER_DATA_DIR` | `<root>/browser` |
| 6 | `PICC_ACCOUNT_METRICS_DATA_DIR` | `<root>/account-metrics` |
| 7 | `PICC_ALERTS_DATA_DIR` | `<root>/alerts` |
| 8 | `PICC_CONNECTOR_DATA_DIR` | `<root>/connector` |
| 9 | `PICC_CAPTURE_CONFIG_DATA_DIR` | `<root>/capture-config` |
| 10 | `PICC_DISPATCH_DATA_DIR` | `<root>/dispatch` |
| 11 | `PICC_EWALLET_DATA_DIR` | `<root>/ewallet` |
| 12 | `PICC_JOURNAL_DATA_DIR` | `<root>/journal` |
| 13 | `PICC_NOTIFICATION_DATA_DIR` | `<root>/notification` |
| 14 | `PICC_PROFILE_DATA_DIR` | `<root>/profile` |
| 15 | `PICC_WATCHLIST_DATA_DIR` | `<root>/watchlist` |
| 16 | `PICC_DATA_DIR` | `<root>/data` |
| 17 | `PICC_SESSION_CAPTURE_SETTINGS_FILE` | `<root>/settings/session-capture-settings.json` |
| 18 | `PICC_LLM_SETTINGS_FILE` | `<root>/settings/llm-settings.json` |
| 19 | `PICC_VAULT_KEY` | Fresh 32 random bytes encoded as 64 lowercase hexadecimal characters |
| 20 | `PICC_ERROR_LOG` | Exactly `0` |

### 4.4 Containment assertion

Both `playwright.config.ts` and the helper call `assertIsolatedEnv`. The helper refuses to start the
run when any of these conditions is false:

- The environment map does not contain exactly the 20 required keys.
- A required key is missing or an unexpected key is present.
- Any of the 18 path values is empty, resolves outside `<root>`, or escapes after canonical parent
  resolution.
- `PICC_ERROR_LOG` is not exactly `0`.
- `PICC_VAULT_KEY` does not match the required 64-character lowercase hexadecimal format.
- A pre-existing `picc-vault.key` is present under the isolation root.

The configured persistence and vault-backed credential stores are therefore redirected under the
fresh root. A successfully contained run cannot write the real `apps/dashboard/server/data` paths or
decrypt their real vault-backed credentials through those mapped variables.

### 4.5 Current credential boundary

The current code does not implement a general secret-scrubbing sandbox. Playwright merges the
configured `webServer.env` values over its inherited process environment, and
`apps/dashboard/server/config.mjs` can load `apps/dashboard/.env` when the dev server imports the API
handlers. The 20-key assertion proves the mapped paths and vault key are isolated; it does not prove
that unrelated `PICC_CCXT_*`, LLM, payment, broker, or provider secrets are absent from the child
process.

Do not use this harness as the sole control around real external credentials. Run it from a clean
operator environment when external calls could cause harm. A blanket claim that it can never see any
real secret from the shell or `.env` is not established by the current code.

CI adoption is a later follow-up. WS-5 does not change the CI workflow.

---

## 5. The "13 screens" mapping

The phrase "13 screens" comes from `.superpowers/sdd/PICC_TRADING_SUITE_WS345_PIPELINE/plan.md`. It
is not a navigation map and does not describe 13 routes.

The historical `TradingSuite.tsx` inventory behind the phrase is 12 named exports plus the internal
`AssistantCard`:

1. `MarketsSuite`
2. `AutopilotSuite` (re-exported from `AutopilotSuite.tsx` after WS-5)
3. `SignalNotificationsCard`
4. `StatusCards`
5. `PredictionCard`
6. `ProAnalysisCard`
7. `PaperTradingCard`
8. `TradePlannerCard`
9. `WatchlistScannerCard`
10. `NewsCard`
11. `PaperAnalyticsCard`
12. `SignalsCard`
13. internal, non-exported `AssistantCard`

The `MarketsSuite` component remains a flat panel stack. `Suites.tsx` mounts it on the existing
`/suites/:suiteId` deep-link branch when an `asset`, `panel`, or `venue` query is present. Its chart
retains the `data-panel="chart"` anchor used by the existing `?panel=chart` deep-link behavior.
WS-5 added no route and no screen switcher for the 13-item inventory.

Current mount truth is narrower than the old prose: the 13 names do not all render together in one
route. `AutopilotSuite`, `SignalNotificationsCard`, and other exported cards are mounted by
pre-existing ministry rooms; `PaperAnalyticsCard` currently has no JSX mount. The only current
`data-panel` attribute in the source is `data-panel="chart"`. Treat "13 screens" as a count of
module-level renderable exports, not 13 simultaneously mounted screens or 13 navigable screens.

---

## 6. Venue status

WS-5 documents current status. It does not enable a venue, change a rail, or write a venue ADR.

| Venue | Current status | Code evidence and boundary |
|---|---|---|
| ExpertOption | Demo-locked; unofficial WebSocket client. Startup health reports token age but does not enforce execute-time expiry. | `apps/dashboard/server/services/expertoption.mjs:8-10,22` records the unofficial protocol, demo-only live refusal, and default WebSocket URL. Live enablement still requires re-engineering and an ADR. |
| IQ Option | Capture-only and unverified. The `ssid` source is marked `verified:false`; reconnect has no live leg; `metrics.extractVia` is empty, so no market-data mapping exists. | `apps/dashboard/server/services/captureProfiles.mjs:55-91+` contains the ExpertOption and IQ Option profiles; the IQ Option block is lines `76-95`. |
| Hyperliquid perps | Sandbox-gated by default. Mainnet requires both `PICC_CCXT_PERPS_MAINNET_ENABLED=1` and the ceremony unlock. | `apps/dashboard/server/services/venues/hyperliquidPerps.mjs:105-106` reads the mode flags and `:546-549` exports the adapter surface. The adapter label remains testnet-focused. |

Decision 11 in
`docs/specs/PICC_TRADING_SUITE_SEAL_ALL_GAPS_v1.md:37` remains the promotion rule: a venue earns live
status through an ADR-driven process. WS-5 added no venue ADR and changed no venue adapter, capture
profile, or execution rail.
